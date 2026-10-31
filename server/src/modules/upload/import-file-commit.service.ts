import { recordBookFileHashHistory } from '../../db/book-file-hash-history';
import { isAudioFormat } from '@bookorbit/types';
import { parseAudioDuration } from '../metadata/extractors/audio.extractor';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import { bookFiles, bookImportReviews, books, libraryFolders } from '../../db/schema';
import type { RequestUser } from '../../common/types/request-user';
import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import { computeFileHash } from '../../common/utils/file-hash.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LibraryService } from '../library/library.service';
import { PathPolicyService } from '../path/path-policy.service';
import { ImportReviewService } from '../import-review/import-review.service';
import { MetadataExtractionService } from '../metadata/metadata-extraction.service';
import { inspectEpubMediaOverlayFields } from '../reader/epub/epub-media-overlay-capability';
import { atomicFileReplacement } from './atomic-file-replacement';

@Injectable()
export class ImportFileCommitService {
  private readonly logger = new Logger(ImportFileCommitService.name);
  constructor(
    @Inject(DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly libraries: LibraryService,
    private readonly paths: PathPolicyService,
    private readonly reviews: ImportReviewService,
    private readonly selfWrites: SelfWriteRegistry,
    private readonly extraction: MetadataExtractionService,
  ) {}

  async replace(
    input: { bookId: number; fileId: number; expectedSha256: string; incoming: string; format: string; reviewId?: string },
    user: RequestUser,
  ) {
    const startedAt = Date.now();
    const version = await this.reviews.fileVersion(input.fileId, user);
    if (version.bookId !== input.bookId || version.sha256 !== input.expectedSha256)
      throw new ConflictException('The selected file changed; review it again');
    const [target] = await this.db
      .select({ file: bookFiles, libraryId: books.libraryId, root: libraryFolders.path })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .innerJoin(libraryFolders, eq(libraryFolders.id, bookFiles.libraryFolderId))
      .where(and(eq(bookFiles.id, input.fileId), eq(bookFiles.bookId, input.bookId)))
      .limit(1);
    if (!target) throw new NotFoundException('Replacement target no longer exists');
    if (target.file.format !== input.format) throw new ConflictException('Only a file of the same format can be replaced');
    await this.paths.assertWithinRoot(target.file.absolutePath, target.root);
    const fileHash = await computeFileHash(input.incoming);
    const durationSeconds = isAudioFormat(input.format) ? await parseAudioDuration(input.incoming) : undefined;
    if (durationSeconds === null) throw new ConflictException('Unable to measure the incoming audio file duration');
    const isFixedLayout = await this.extraction.detectFixedLayout(input.incoming, input.format);
    const overlay = await inspectEpubMediaOverlayFields(input.incoming, input.format, (error) =>
      this.logger.warn(
        `[upload.replace_file] [fail] fileId=${input.fileId} error="${sanitizeLogValue(String(error))}" - media overlay inspection failed`,
      ),
    );
    this.selfWrites.begin([target.file.absolutePath]);
    this.logger.log(`[upload.replace_file] [start] bookId=${input.bookId} fileId=${input.fileId} userId=${user.id} - replacing confirmed file`);
    try {
      const result = await atomicFileReplacement(input.incoming, target.file.absolutePath, input.expectedSha256, (publish) =>
        this.db.transaction(async (tx) => {
          const [book] = await tx
            .select({ id: books.id, libraryId: books.libraryId })
            .from(books)
            .where(and(eq(books.id, input.bookId), eq(books.libraryId, target.libraryId)))
            .for('update')
            .limit(1);
          if (!book) throw new ConflictException('The target book moved; review it again');
          await this.libraries.verifyUserAccessLevel(user.id, book.libraryId, user.isSuperuser, 'editor');
          const [file] = await tx
            .select()
            .from(bookFiles)
            .where(and(eq(bookFiles.id, input.fileId), eq(bookFiles.bookId, book.id)))
            .for('update')
            .limit(1);
          if (!file || file.absolutePath !== target.file.absolutePath || file.format !== input.format)
            throw new ConflictException('The selected file changed; review it again');
          await this.paths.assertWithinRoot(file.absolutePath, target.root);
          await publish();
          const current = await stat(file.absolutePath, { bigint: true });
          if (file.fileHash && file.fileHash !== fileHash) await recordBookFileHashHistory(tx, file.id, file.fileHash, 'file_write');
          await tx
            .update(bookFiles)
            .set({
              ino: current.ino,
              sizeBytes: Number(current.size),
              mtime: current.mtime,
              fileHash,
              ...(durationSeconds !== undefined ? { durationSeconds } : {}),
              isFixedLayout,
              ...overlay,
              updatedAt: new Date(),
            })
            .where(eq(bookFiles.id, input.fileId));
          await tx.update(books).set({ status: 'present', updatedAt: new Date() }).where(eq(books.id, book.id));
          if (input.reviewId)
            await tx
              .update(bookImportReviews)
              .set({ status: 'completed', resultBookId: book.id, updatedAt: new Date() })
              .where(and(eq(bookImportReviews.id, input.reviewId), eq(bookImportReviews.userId, user.id)));
          return {
            bookId: book.id,
            libraryId: book.libraryId,
            absolutePath: file.absolutePath,
            filename: basename(file.absolutePath),
            format: input.format,
            sizeBytes: Number(current.size),
            created: false,
            preserveMetadata: true,
          };
        }),
      );
      this.logger.log(
        `[upload.replace_file] [end] bookId=${input.bookId} fileId=${input.fileId} userId=${user.id} durationMs=${Date.now() - startedAt} - replacement committed with record identities preserved`,
      );
      return result;
    } catch (error) {
      this.logger.warn(
        `[upload.replace_file] [fail] bookId=${input.bookId} fileId=${input.fileId} userId=${user.id} durationMs=${Date.now() - startedAt} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - replacement failed`,
      );
      throw error;
    } finally {
      this.selfWrites.end([target.file.absolutePath]);
    }
  }
}
