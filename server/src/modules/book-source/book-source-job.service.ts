import { DownloadSourcePolicy } from './download-source-policy.service';
import { BadRequestException } from '@nestjs/common';
import { ChapterRuleRegistry } from './chapter-rule-registry.service';
import { ForbiddenException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { BookSourceJob, BookSourceJobPage, BookSourceJobStatus } from '@bookorbit/types';
import { bookSourceConfig } from '../../config/config';
import type { RequestUser } from '../../common/types/request-user';
import { bookSourceJobs } from '../../db/schema';
import { LibraryService } from '../library/library.service';
import { BookSourceJobRepository } from './book-source-job.repository';
import { qidianBookId } from './qidian-chapter-source';
import { tomatoBookId } from './tomato-protocol';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

export function sourceJobResponse(job: typeof bookSourceJobs.$inferSelect): BookSourceJob {
  return {
    id: job.id,
    libraryId: job.libraryId,
    sourceBookId: job.sourceBookId.includes(':') ? job.sourceBookId.split(':')[1]! : job.sourceBookId,
    ...(job.sourceBookId.includes(':') ? { source: job.sourceBookId.split(':')[0]! } : {}),
    title: job.title,
    status: job.status as BookSourceJobStatus,
    attempts: job.attempts,
    retryable: job.retryable,
    cancelRequested: job.cancelRequested,
    resultBookId: job.resultBookId,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

@Injectable()
export class BookSourceJobService {
  private readonly logger = new Logger(BookSourceJobService.name);
  constructor(
    private readonly downloadPolicy: DownloadSourcePolicy,
    private readonly repository: BookSourceJobRepository,
    private readonly libraries: LibraryService,
    private readonly rules: ChapterRuleRegistry,
    @Inject(bookSourceConfig.KEY) private readonly config: ConfigType<typeof bookSourceConfig>,
  ) {}

  async enqueue(libraryId: number, folderId: number | undefined, bookId: string, user: RequestUser) {
    return this.mutate('book_source.enqueue', `userId=${user.id} libraryId=${libraryId}`, async () => {
      await this.downloadPolicy.assertEnabled('fanqie');
      tomatoBookId(bookId);
      if (!this.config.tomatoBinaryPath) throw new ServiceUnavailableException('番茄下载器未配置');
      await this.libraries.verifyUserAccessLevel(user.id, libraryId, user.isSuperuser, 'editor');
      return sourceJobResponse(await this.repository.enqueue(user.id, libraryId, folderId, bookId));
    });
  }

  async enqueueQidian(libraryId: number, folderId: number | undefined, bookId: string, user: RequestUser) {
    return this.mutate('book_source.enqueue', `userId=${user.id} libraryId=${libraryId}`, async () => {
      await this.downloadPolicy.assertEnabled('qidian');
      qidianBookId(bookId);
      await this.libraries.verifyUserAccessLevel(user.id, libraryId, user.isSuperuser, 'editor');
      return sourceJobResponse(await this.repository.enqueue(user.id, libraryId, folderId, `qidian:${bookId}`));
    });
  }

  async enqueueRule(libraryId: number, folderId: number | undefined, source: string, bookId: string, user: RequestUser) {
    return this.mutate('book_source.enqueue', `userId=${user.id} libraryId=${libraryId}`, async () => {
      if (!/^[a-z][a-z0-9-]{0,6}$/.test(source) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,15}$/.test(bookId))
        throw new BadRequestException('书源或书籍编号无效');
      await this.libraries.verifyUserAccessLevel(user.id, libraryId, user.isSuperuser, 'editor');
      await this.rules.get(source);
      return sourceJobResponse(await this.repository.enqueue(user.id, libraryId, folderId, `${source}:${bookId}`));
    });
  }

  async list(user: RequestUser, cursor?: number): Promise<BookSourceJobPage> {
    const rows = await this.repository.list(user.id, cursor);
    return { items: rows.slice(0, 25).map(sourceJobResponse), nextCursor: rows.length > 25 ? rows[24]!.id : null };
  }

  async get(id: number, user: RequestUser) {
    return sourceJobResponse(await this.repository.owned(id, user.id));
  }

  async cancel(id: number, user: RequestUser) {
    return this.mutate('book_source.cancel', `jobId=${id} userId=${user.id}`, async () =>
      sourceJobResponse(await this.repository.cancel(id, user.id)),
    );
  }

  async retry(id: number, user: RequestUser) {
    return this.mutate('book_source.retry', `jobId=${id} userId=${user.id}`, async () => {
      const job = await this.repository.owned(id, user.id);
      if (!user.active) throw new ForbiddenException();
      if (job.sourceBookId.startsWith('qidian:')) await this.downloadPolicy.assertEnabled('qidian');
      else if (!job.sourceBookId.includes(':')) await this.downloadPolicy.assertEnabled('fanqie');
      await this.libraries.verifyUserAccessLevel(user.id, job.libraryId, user.isSuperuser, 'editor');
      if (job.sourceBookId.includes(':') && !job.sourceBookId.startsWith('qidian:')) await this.rules.get(job.sourceBookId.split(':')[0]!);
      if (!job.sourceBookId.includes(':') && !this.config.tomatoBinaryPath) throw new ServiceUnavailableException('番茄下载器未配置');
      return sourceJobResponse(await this.repository.retry(id, user.id));
    });
  }

  private async mutate(event: string, ids: string, operation: () => Promise<BookSourceJob>) {
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] ${ids} - task mutation started`);
    try {
      const job = await operation();
      this.logger.log(
        `[${event}] [end] ${ids} durationMs=${Date.now() - startedAt} resultJobId=${job.id} status=${job.status} - task mutation completed`,
      );
      return job;
    } catch (error) {
      this.logger.warn(
        `[${event}] [fail] ${ids} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - task mutation failed`,
      );
      throw error;
    }
  }
}
