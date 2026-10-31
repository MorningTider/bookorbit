import { ConflictException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { BookDockMetadata, ImportResolution, ImportReviewResponse } from '@bookorbit/types';
import { EMPTY_CONTENT_FILTER_RULES, UploadErrorCode } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { AuthService } from '../auth/auth.service';
import { ImportReviewService } from '../import-review/import-review.service';
import { importResolutionFromDto } from '../import-review/dto/import-review.dto';
import { UploadService } from '../upload/upload.service';
import { ImportFileCommitService } from '../upload/import-file-commit.service';

export interface DockImportFile {
  sourcePath: string;
  format: string | null;
  role?: string;
}
@Injectable()
export class BookDockDuplicateService {
  constructor(
    private readonly auth: AuthService,
    private readonly reviews: ImportReviewService,
    private readonly uploads: UploadService,
    private readonly commits: ImportFileCommitService,
  ) {}
  async actor(userId: number, system: boolean): Promise<RequestUser> {
    if (userId > 0) {
      const user = await this.auth.findActingUser(userId);
      if (!user?.active) throw new ForbiddenException('The importing account is not active');
      return user;
    }
    if (!system) throw new ForbiddenException('An importing user is required');
    return {
      id: 0,
      username: 'system',
      name: 'System',
      email: null,
      active: true,
      isSuperuser: true,
      isDefaultPassword: false,
      tokenVersion: 0,
      settings: {},
      avatarUrl: null,
      provisioningMethod: 'system',
      permissions: [],
      contentFilters: { ...EMPTY_CONTENT_FILTER_RULES },
    };
  }
  async inspect(
    libraryId: number,
    filename: string,
    format: string,
    primary: string,
    metadata: BookDockMetadata,
    count: number,
    user: RequestUser,
    destinationPath?: string,
  ): Promise<ImportReviewResponse | null> {
    const identity = await this.reviews.extractIdentity(primary, filename, format);
    if (metadata.title) identity.title = metadata.title;
    if (metadata.authors?.length) identity.authors = metadata.authors;
    if (metadata.isbn10) identity.isbn10 = metadata.isbn10;
    if (metadata.isbn13) identity.isbn13 = metadata.isbn13;
    const sizeBytes = (await lstat(primary)).size;
    const destinationBookId = destinationPath ? await this.reviews.destinationOwner(libraryId, destinationPath, user) : undefined;
    const [matches] = await this.reviews.matches(libraryId, [identity], user, { path: primary, size: sizeBytes }, destinationBookId);
    if (!matches?.length) return null;
    return { id: '', libraryId, filename, format, sizeBytes, matches, expiresAt: '', incomingFileCount: count };
  }
  async importIntoExisting(
    review: ImportReviewResponse | null,
    input: ImportResolution,
    files: DockImportFile[],
    user: RequestUser,
  ): Promise<number> {
    const resolution = importResolutionFromDto(input);
    if (resolution.action === 'new') throw new ConflictException('A new book must use the normal filing process');
    const match = review?.matches.find((row) => row.bookId === resolution.bookId && row.canEdit !== false);
    if (!match) throw new ConflictException('The selected duplicate changed; review the library again');
    const content = files.filter((file) => file.role === undefined || file.role === 'content');
    if (!content.length) throw new ConflictException('No book files are selected');
    for (let index = 0; index < content.length; index++) {
      const file = content[index]!;
      const format = file.format ?? extname(file.sourcePath).slice(1).toLowerCase();
      if (index === 0 && resolution.action === 'replace') {
        await this.commits.replace({ ...resolution, incoming: file.sourcePath, format }, user);
      } else {
        const stream = Readable.from(readSource(file.sourcePath));
        try {
          await this.uploads.addFileToBook(resolution.bookId, basename(file.sourcePath), stream, user, { preserveMetadata: true });
        } catch (error) {
          const response = error instanceof HttpException ? error.getResponse() : null;
          if (typeof response !== 'object' || response === null || !('errorCode' in response) || response.errorCode !== UploadErrorCode.Duplicate)
            throw error;
        } finally {
          stream.destroy();
        }
      }
    }
    return resolution.bookId;
  }
}

async function* readSource(path: string): AsyncGenerator<Buffer> {
  for await (const chunk of createReadStream(path)) yield chunk as Buffer;
}
