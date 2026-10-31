import type { BookSourceJobProgress } from '@bookorbit/types';
import { randomUUID } from 'node:crypto';
import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { bookSourceConfig } from '../../config/config';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { convertTxtToEpub } from '../metadata/lib/txt-to-epub';
import { assertSourceEpub } from './validate-source-epub';
import type { ChapterSourceAdapter } from './chapter-source';

@Injectable()
export class ChapterDownloadService {
  private readonly logger = new Logger(ChapterDownloadService.name);
  constructor(@Inject(bookSourceConfig.KEY) private readonly config: ConfigType<typeof bookSourceConfig>) {}

  async download(adapter: ChapterSourceAdapter, bookId: string, signal: AbortSignal, onProgress?: (progress: BookSourceJobProgress) => void) {
    const startedAt = Date.now();
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]);
    this.logger.log(`[book_source.chapters] [start] provider=${adapter.key} bookId=${bookId} - chapter acquisition started`);
    const root = await mkdtemp(join(tmpdir(), 'bookorbit-chapters-'));
    try {
      deadline.throwIfAborted();
      const catalog = await adapter.catalog(bookId, deadline);
      if (!catalog.chapters.length || catalog.chapters.length > 1000) throw new BadGatewayException('章节数量超过限制或为空');
      const title = `${catalog.title}（公开免费章节选集）`;
      onProgress?.({ phase: 'downloading', title, completedChapters: 0, totalChapters: catalog.chapters.length });
      const path = join(root, 'source.txt');
      const output = await open(path, 'wx', 0o600);
      let bytes = 0;
      const chapterMarker = `BOOKORBIT-${randomUUID()}:`;
      try {
        for (const [index, chapter] of catalog.chapters.entries()) {
          deadline.throwIfAborted();
          if (index) await delay(1000, undefined, { signal: deadline });
          const paragraphs = await adapter.chapter(bookId, chapter, deadline);
          if (!paragraphs.length || paragraphs.some((p) => !p.trim())) throw new BadGatewayException('章节为空，不保存不完整作品');
          const content = `${chapterMarker}${chapter.title.replace(/[\r\n]/g, ' ')}\n${paragraphs.map((p) => p.replace(/[\r\n]+/g, ' ')).join('\n')}\n`;
          bytes += Buffer.byteLength(content);
          if (bytes > 64 * 1024 * 1024) throw new BadGatewayException('章节正文超过64 MiB限制');
          await output.writeFile(content);
          onProgress?.({ phase: 'downloading', title, completedChapters: index + 1, totalChapters: catalog.chapters.length });
        }
      } finally {
        await output.close();
      }
      deadline.throwIfAborted();
      onProgress?.({ phase: 'validating', title, completedChapters: catalog.chapters.length, totalChapters: catalog.chapters.length });
      const epub = join(root, 'book.epub');
      await convertTxtToEpub(path, epub, title, {
        encoding: 'utf8',
        chapters: 'english',
        chapterMarker,
        authors: catalog.authors,
        description: `来自${adapter.key}的公开免费章节选集，共${catalog.chapters.length}章，未包含${catalog.excludedChapters}章。不是完整作品。`,
        signal: deadline,
      });
      if ((await stat(epub)).size > 64 * 1024 * 1024) throw new BadGatewayException('EPUB超过64 MiB限制');
      const content = await readFile(epub);
      await assertSourceEpub(content);
      deadline.throwIfAborted();
      this.logger.log(
        `[book_source.chapters] [end] provider=${adapter.key} bookId=${bookId} durationMs=${Date.now() - startedAt} chapters=${catalog.chapters.length} bytes=${content.length} - chapter acquisition completed`,
      );
      return { title, content };
    } catch (error) {
      this.logger.warn(
        `[book_source.chapters] [fail] provider=${adapter.key} bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - chapter acquisition failed`,
      );
      throw error;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
