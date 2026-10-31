import { BookSourceProgress } from './book-source-progress.service';
import { ForbiddenException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Permission } from '@bookorbit/types';
import { randomUUID } from 'node:crypto';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AuthService } from '../auth/auth.service';
import { BookSourceJobRepository } from './book-source-job.repository';
import { BookSourceService } from './book-source.service';

@Injectable()
export class BookSourceWorker implements OnModuleDestroy {
  private readonly logger = new Logger(BookSourceWorker.name);
  private readonly workerId = randomUUID();
  private ticking = false;
  private stopping = false;
  private active: { id: number; controller: AbortController; promise: Promise<void> } | null = null;

  constructor(
    private readonly progress: BookSourceProgress,
    private readonly repository: BookSourceJobRepository,
    private readonly sources: BookSourceService,
    private readonly auth: AuthService,
  ) {}

  @Interval(2000)
  async tick() {
    if (this.stopping || this.ticking) return;
    this.ticking = true;
    const startedAt = Date.now();
    try {
      const active = this.active;
      if (active) {
        const job = await this.repository.heartbeat(active.id, this.workerId);
        if (!job || job.cancelRequested) active.controller.abort();
        return;
      }
      const job = await this.repository.claim(this.workerId);
      if (!job) return;
      const controller = new AbortController();
      const promise = this.run(job, controller)
        .catch((error: unknown) => {
          this.logger.error(
            `[book_source.queue] [fail] jobId=${job.id} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - failed to persist task outcome`,
          );
        })
        .finally(() => {
          this.active = null;
        });
      this.active = { id: job.id, controller, promise };
    } catch (error) {
      this.active?.controller.abort();
      this.logger.warn(
        `[book_source.queue] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - queue poll failed`,
      );
    } finally {
      this.ticking = false;
    }
  }

  private async actingUser(userId: number) {
    const user = await this.auth.findActingUser(userId);
    if (
      !user ||
      (!user.isSuperuser &&
        ![Permission.LibraryUpload, Permission.BookRequestSelfFulfill].every((permission) => user.permissions.includes(permission)))
    )
      throw new ForbiddenException('下载权限已撤销');
    return user;
  }

  private async run(job: Awaited<ReturnType<BookSourceJobRepository['claim']>> & {}, controller: AbortController) {
    const startedAt = Date.now();
    let importing = false;
    this.progress.begin(job.id, job.userId);
    this.logger.log(`[book_source.job] [start] jobId=${job.id} userId=${job.userId} libraryId=${job.libraryId} - background acquisition started`);
    try {
      const user = await this.actingUser(job.userId);
      const isQidian = job.sourceBookId.startsWith('qidian:');
      const acquire = isQidian
        ? this.sources.acquireQidian.bind(this.sources)
        : job.sourceBookId.includes(':')
          ? this.sources.acquireRuleChapters.bind(this.sources)
          : this.sources.acquireTomato.bind(this.sources);
      const result = await acquire(
        job.libraryId,
        job.folderId ?? undefined,
        isQidian ? job.sourceBookId.slice(7) : job.sourceBookId,
        user,
        controller.signal,
        async (title) => {
          Object.assign(user, await this.actingUser(job.userId));
          controller.signal.throwIfAborted();
          if (!(await this.repository.beginImport(job.id, this.workerId, title))) throw new ForbiddenException('下载已取消或任务租约失效');
          importing = true;
        },
        (progress) => this.progress.update(job.id, progress),
      );
      await this.repository.finish(job.id, this.workerId, { status: 'completed', resultBookId: result.bookId, error: null });
      this.logger.log(
        `[book_source.job] [end] jobId=${job.id} userId=${job.userId} durationMs=${Date.now() - startedAt} resultBookId=${result.bookId} - background acquisition completed`,
      );
    } catch (error) {
      const message = controller.signal.aborted
        ? this.stopping
          ? '服务停止，下载中断，可重试'
          : '下载已取消或连接中断'
        : error instanceof Error
          ? error.message
          : '下载失败';
      await this.repository.finish(job.id, this.workerId, {
        status: controller.signal.aborted && !this.stopping && !importing ? 'cancelled' : 'failed',
        error: importing ? '入库未确认，请先核对书库。' : message.slice(0, 250),
      });
      this.logger.warn(
        `[book_source.job] [fail] jobId=${job.id} userId=${job.userId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - background acquisition failed`,
      );
    } finally {
      this.progress.end(job.id);
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    this.active?.controller.abort();
    await this.active?.promise;
  }
}
