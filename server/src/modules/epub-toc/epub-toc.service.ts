import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { groupEpubTocEntries, type EpubTocOrganization, type OrganizeEpubTocRequest, type OrganizeEpubTocResult } from '@bookorbit/types';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RequestUser } from '../../common/types/request-user';
import { fullFileSha256 } from '../../common/utils/full-file-sha256.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookService } from '../book/book.service';
import { EpubService } from '../reader/epub/epub.service';
import { FileWriteService } from '../file-write/file-write.service';
import { ImportReviewService } from '../import-review/import-review.service';
import { ImportFileCommitService } from '../upload/import-file-commit.service';
import { buildTocPatches, suggestTocGroups } from './epub-toc-archive';

@Injectable()
export class EpubTocService {
  private readonly logger = new Logger(EpubTocService.name);
  constructor(
    private readonly books: BookService,
    private readonly epub: EpubService,
    private readonly writer: FileWriteService,
    private readonly reviews: ImportReviewService,
    private readonly commits: ImportFileCommitService,
  ) {}

  private async file(bookId: number, fileId: number, user: RequestUser) {
    await this.books.verifyBookAccess(bookId, user, 'editor');
    const file = await this.books.verifyFileAccess(fileId, user);
    if (file.bookId !== bookId || file.format !== 'epub') throw new BadRequestException('Select an EPUB belonging to this book');
    return file;
  }

  async inspect(bookId: number, fileId: number, user: RequestUser): Promise<EpubTocOrganization> {
    const file = await this.file(bookId, fileId, user);
    const version = await this.reviews.fileVersion(fileId, user);
    const info = await this.epub.getBookInfo(bookId, fileId, user);
    const entries = info.toc?.children ?? [];
    if (!entries.length) throw new BadRequestException('This EPUB has no directory to organize');
    return { bookId, fileId, sha256: version.sha256, entries, ...(await suggestTocGroups(file.absolutePath, info)) };
  }

  async organize(bookId: number, fileId: number, input: OrganizeEpubTocRequest, user: RequestUser): Promise<OrganizeEpubTocResult> {
    const event = 'epub_toc.organize';
    const started = Date.now();
    this.logger.log(
      `[${event}] [start] bookId=${bookId} fileId=${fileId} userId=${user.id} groups=${input.groups.length} - directory organization started`,
    );
    let directory: string | undefined;
    try {
      const file = await this.file(bookId, fileId, user);
      const version = await this.reviews.fileVersion(fileId, user);
      if (version.sha256 !== input.expectedSha256) throw new ConflictException('The EPUB changed; reload the directory before saving');
      directory = await mkdtemp(join(tmpdir(), 'bookorbit-toc-'));
      const staged = join(directory, 'organized.epub');
      await copyFile(file.absolutePath, staged);
      if ((await fullFileSha256(staged)) !== input.expectedSha256) throw new ConflictException('The EPUB changed while preparing the directory');
      const original = await this.epub.inspectFile(staged);
      const entries = original.toc?.children ?? [];
      let grouped;
      try {
        grouped = groupEpubTocEntries(entries, input.groups);
      } catch {
        throw new BadRequestException('Invalid directory group boundaries');
      }
      const changed = JSON.stringify(grouped) !== JSON.stringify(entries);
      if (changed) {
        const patches = await buildTocPatches(staged, original, grouped);
        await this.writer.patchTemporaryEpub(staged, patches);
        const checked = await this.epub.inspectFile(staged);
        if (
          JSON.stringify(checked.spine) !== JSON.stringify(original.spine) ||
          JSON.stringify(checked.metadata) !== JSON.stringify(original.metadata)
        ) {
          throw new BadRequestException('Directory preparation changed book content or metadata');
        }
        const normalize = (items: typeof grouped): unknown =>
          items.map((item) => ({ label: item.label, href: item.href ?? '', children: normalize(item.children ?? []) }));
        if (JSON.stringify(normalize(checked.toc?.children ?? [])) !== JSON.stringify(normalize(grouped))) {
          throw new BadRequestException('Prepared EPUB directory did not match the preview');
        }
        await this.commits.replace({ bookId, fileId, expectedSha256: input.expectedSha256, incoming: staged, format: 'epub' }, user);
      }
      this.logger.log(
        `[${event}] [end] bookId=${bookId} fileId=${fileId} durationMs=${Date.now() - started} groups=${input.groups.length} changed=${changed} - directory organization completed`,
      );
      return { bookId, fileId, changed, groupCount: input.groups.length };
    } catch (error) {
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} fileId=${fileId} durationMs=${Date.now() - started} errorClass=${error instanceof Error ? error.name : 'Unknown'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - directory organization failed`,
      );
      throw error;
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
}
