import { DownloadSourcePolicy } from './download-source-policy.service';
import { ChapterRuleRegistry } from './chapter-rule-registry.service';
import { RuleChapterSource } from './rule-chapter-source';
import type { BookSourceStatus, BookSourceJobProgress, ImportResolution } from '@bookorbit/types';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Readable } from 'node:stream';
import { bookSourceConfig } from '../../config/config';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LibraryService } from '../library/library.service';
import { UploadService } from '../upload/upload.service';
import { UploadValidatorService } from '../upload/upload-validator.service';
import { TomatoRuntimeService } from './tomato-runtime.service';
import { ChapterDownloadService } from './chapter-download.service';
import { QidianChapterSource, qidianBookId } from './qidian-chapter-source';
import { tomatoBookId } from './tomato-protocol';

@Injectable()
export class BookSourceService {
  private readonly logger = new Logger(BookSourceService.name);
  constructor(
    private readonly downloadPolicy: DownloadSourcePolicy,
    @Inject(bookSourceConfig.KEY) private readonly config: ConfigType<typeof bookSourceConfig>,
    private readonly libraries: LibraryService,
    private readonly upload: UploadService,
    private readonly validator: UploadValidatorService,
    private readonly tomato: TomatoRuntimeService,
    private readonly chapters: ChapterDownloadService,
    private readonly qidian: QidianChapterSource,
    private readonly rules: ChapterRuleRegistry,
  ) {}

  async status(): Promise<BookSourceStatus> {
    return {
      fanqie: { enabled: await this.downloadPolicy.enabled('fanqie'), configured: this.config.tomatoBinaryPath.length > 0, format: 'epub' as const },
      qidian: {
        enabled: await this.downloadPolicy.enabled('qidian'),
        configured: true,
        format: 'epub' as const,
        scope: 'public-free-volumes' as const,
      },
    };
  }

  async chapterSources() {
    return (await this.rules.all()).map(({ key, label }) => ({ key, label }));
  }

  async acquireRuleChapters(
    libraryId: number,
    folderId: number | undefined,
    identity: string,
    user: RequestUser,
    signal: AbortSignal,
    beforeImport?: (title: string) => Promise<void>,
    onProgress?: (progress: BookSourceJobProgress) => void,
    importResolution?: ImportResolution,
  ) {
    if (!/^[a-z][a-z0-9-]{0,6}:[a-zA-Z0-9][a-zA-Z0-9_-]{0,15}$/.test(identity)) throw new BadRequestException('书源任务标识无效');
    const [key, bookId] = identity.split(':');
    await this.libraries.verifyAccessLevel(user, libraryId, 'editor');
    const adapter = new RuleChapterSource(await this.rules.get(key!));
    const file = await this.chapters.download(adapter, bookId!, signal, onProgress);
    signal.throwIfAborted();
    await beforeImport?.(file.title);
    await this.libraries.verifyAccessLevel(user, libraryId, 'editor');
    return this.upload.upload(libraryId, folderId, this.validator.sanitizeFilename(`${file.title}.epub`), Readable.from([file.content]), user, {
      ...(importResolution ? { resolution: importResolution } : {}),
      origin: { provider: adapter.key, id: bookId! },
    });
  }

  async acquireQidian(
    libraryId: number,
    folderId: number | undefined,
    bookId: string,
    user: RequestUser,
    signal: AbortSignal,
    beforeImport?: (title: string) => Promise<void>,
    onProgress?: (progress: BookSourceJobProgress) => void,
    importResolution?: ImportResolution,
  ) {
    await this.downloadPolicy.assertEnabled('qidian');
    qidianBookId(bookId);
    await this.libraries.verifyAccessLevel(user, libraryId, 'editor');
    const file = await this.chapters.download(this.qidian, bookId, signal, onProgress);
    signal.throwIfAborted();
    await beforeImport?.(file.title);
    await this.libraries.verifyAccessLevel(user, libraryId, 'editor');
    return this.upload.upload(libraryId, folderId, this.validator.sanitizeFilename(`${file.title}.epub`), Readable.from([file.content]), user, {
      ...(importResolution ? { resolution: importResolution } : {}),
      origin: { provider: 'qidian', id: bookId },
    });
  }

  async acquireTomato(
    libraryId: number,
    folderId: number | undefined,
    bookId: string,
    user: RequestUser,
    signal: AbortSignal,
    beforeImport?: (title: string) => Promise<void>,
    onProgress?: (progress: BookSourceJobProgress) => void,
    importResolution?: ImportResolution,
  ) {
    await this.downloadPolicy.assertEnabled('fanqie');
    tomatoBookId(bookId);
    await this.libraries.verifyAccessLevel(user, libraryId, 'editor');
    const startedAt = Date.now();
    this.logger.log(`[book_source.acquire] [start] userId=${user.id} libraryId=${libraryId} bookId=${bookId} - acquisition started`);
    try {
      const file = await this.tomato.download(bookId, signal, onProgress);
      signal.throwIfAborted();
      await beforeImport?.(file.title);
      await this.libraries.verifyAccessLevel(user, libraryId, 'editor');
      const result = await this.upload.upload(
        libraryId,
        folderId,
        this.validator.sanitizeFilename(`${file.title}.epub`),
        Readable.from([file.content]),
        user,
        { ...(importResolution ? { resolution: importResolution } : {}), origin: { provider: 'fanqie', id: bookId } },
      );
      this.logger.log(
        `[book_source.acquire] [end] userId=${user.id} libraryId=${libraryId} bookId=${bookId} durationMs=${Date.now() - startedAt} importedBookId=${result.bookId} - acquisition imported`,
      );
      return result;
    } catch (error) {
      this.logger.warn(
        `[book_source.acquire] [fail] userId=${user.id} libraryId=${libraryId} bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - acquisition failed`,
      );
      throw error;
    }
  }
}
