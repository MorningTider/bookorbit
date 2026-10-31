import type { ImportResolution } from '@bookorbit/types';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import { bookSourceJobs as jobs } from '../../db/schema';

@Injectable()
export class BookSourceJobRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async enqueue(userId: number, libraryId: number, folderId: number | undefined, sourceBookId: string, importResolution?: ImportResolution) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(192834, ${userId})`);
      const [existing] = await tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.libraryId, libraryId),
            eq(jobs.sourceBookId, sourceBookId),
            sql`(${jobs.status} in ('queued', 'downloading', 'importing', 'awaiting_choice') or (${jobs.status} = 'failed' and ${jobs.retryable} = false))`,
          ),
        )
        .limit(1);
      if (existing) return existing;
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(and(eq(jobs.userId, userId), inArray(jobs.status, ['queued', 'downloading', 'importing', 'awaiting_choice'])));
      if (count >= 20) throw new ConflictException('最多同时保留 20 个未完成下载任务');
      const [created] = await tx
        .insert(jobs)
        .values({ userId, libraryId, folderId, sourceBookId, ...(importResolution ? { importResolution } : {}) })
        .returning();
      return created;
    });
  }

  async list(userId: number, cursor?: number) {
    return this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, userId), cursor ? lt(jobs.id, cursor) : undefined))
      .orderBy(desc(jobs.id))
      .limit(26);
  }

  async owned(id: number, userId: number) {
    const [job] = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.userId, userId)))
      .limit(1);
    if (!job) throw new NotFoundException('下载任务不存在');
    return job;
  }

  async cancel(id: number, userId: number) {
    await this.owned(id, userId);
    await this.db
      .update(jobs)
      .set({ cancelRequested: true, status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(jobs.id, id), eq(jobs.userId, userId), inArray(jobs.status, ['queued', 'awaiting_choice'])));
    await this.db
      .update(jobs)
      .set({ cancelRequested: true, updatedAt: new Date() })
      .where(and(eq(jobs.id, id), eq(jobs.userId, userId), eq(jobs.status, 'downloading')));
    const job = await this.owned(id, userId);
    if (job.status === 'importing') throw new ConflictException('已开始入库，请等待完成');
    return job;
  }

  async retry(id: number, userId: number, confirmedImportNotCompleted = false) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(192834, ${userId})`);
      const [job] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, id), eq(jobs.userId, userId)))
        .limit(1);
      if (!job) throw new NotFoundException('下载任务不存在');
      const reviewed = confirmedImportNotCompleted && job.status === 'failed' && !job.retryable && job.resultBookId === null;
      if (!['failed', 'cancelled'].includes(job.status) || (!job.retryable && !reviewed))
        throw new ConflictException('当前任务不能重试。入库中断需先核对书库。');
      const [duplicate] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            ne(jobs.id, id),
            eq(jobs.libraryId, job.libraryId),
            eq(jobs.sourceBookId, job.sourceBookId),
            sql`(${jobs.status} in ('queued', 'downloading', 'importing', 'awaiting_choice') or (${jobs.status} = 'failed' and ${jobs.retryable} = false))`,
          ),
        )
        .limit(1);
      if (duplicate) throw new ConflictException('该书已有下载或入库记录');
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(and(eq(jobs.userId, userId), inArray(jobs.status, ['queued', 'downloading', 'importing', 'awaiting_choice'])));
      if (count >= 20) throw new ConflictException('最多同时保留 20 个未完成下载任务');
      const [retried] = await tx
        .update(jobs)
        .set({
          status: 'queued',
          retryable: true,
          cancelRequested: false,
          reviewId: null,
          importResolution: null,
          error: null,
          updatedAt: new Date(),
        })
        .where(and(eq(jobs.id, id), eq(jobs.userId, userId)))
        .returning();
      return retried;
    });
  }

  async remove(id: number, userId: number) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(192834, ${userId})`);
      const [removed] = await tx
        .delete(jobs)
        .where(and(eq(jobs.id, id), eq(jobs.userId, userId), inArray(jobs.status, ['completed', 'failed', 'cancelled'])))
        .returning();
      if (removed) return removed;
      const [existing] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.id, id), eq(jobs.userId, userId)))
        .limit(1);
      if (!existing) throw new NotFoundException('下载任务不存在');
      throw new ConflictException('请先取消下载并等待任务结束，再删除记录');
    });
  }

  async reconcileReviews() {
    const reviews = schema.bookImportReviews;
    await this.db
      .update(jobs)
      .set({
        status: sql`case when ${reviews.status}='completed' then 'completed' when ${reviews.status}='cancelled' then 'cancelled' else 'failed' end`,
        resultBookId: reviews.resultBookId,
        retryable: true,
        error: sql`case when ${reviews.status}='expired' or ${reviews.expiresAt}<now() then 'Import review expired; submit the download again' else null end`,
        reviewId: null,
        updatedAt: new Date(),
      })
      .from(reviews)
      .where(
        and(
          eq(jobs.status, 'awaiting_choice'),
          eq(jobs.reviewId, reviews.id),
          or(inArray(reviews.status, ['completed', 'cancelled', 'expired']), and(eq(reviews.status, 'pending'), lt(reviews.expiresAt, new Date()))),
        ),
      );
  }

  async claim(workerId: string) {
    return this.db.transaction(async (tx) => {
      // Serialize claims and stale-lease recovery across application replicas.
      await tx.execute(sql`select pg_advisory_xact_lock(192835, 0)`);
      await tx
        .update(jobs)
        .set({ status: 'failed', error: '服务中断。请核对书库后重新提交下载。', workerId: null, leaseUntil: null, updatedAt: new Date() })
        .where(and(inArray(jobs.status, ['downloading', 'importing']), lt(jobs.leaseUntil, new Date())));
      const [active] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(inArray(jobs.status, ['downloading', 'importing']))
        .limit(1);
      if (active) return null;
      const [candidate] = await tx.select().from(jobs).where(eq(jobs.status, 'queued')).orderBy(asc(jobs.id)).limit(1);
      if (!candidate) return null;
      const [claimed] = await tx
        .update(jobs)
        .set({
          status: 'downloading',
          workerId,
          leaseUntil: new Date(Date.now() + 60000),
          attempts: sql`${jobs.attempts} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(jobs.id, candidate.id), eq(jobs.status, 'queued')))
        .returning();
      return claimed ?? null;
    });
  }

  async heartbeat(id: number, workerId: string) {
    const [job] = await this.db
      .update(jobs)
      .set({ leaseUntil: new Date(Date.now() + 60000), updatedAt: new Date() })
      .where(and(eq(jobs.id, id), eq(jobs.workerId, workerId), inArray(jobs.status, ['downloading', 'importing'])))
      .returning();
    return job;
  }

  async beginImport(id: number, workerId: string, title: string) {
    const [job] = await this.db
      .update(jobs)
      .set({ status: 'importing', retryable: false, title, updatedAt: new Date() })
      .where(and(eq(jobs.id, id), eq(jobs.workerId, workerId), eq(jobs.status, 'downloading'), eq(jobs.cancelRequested, false)))
      .returning();
    return !!job;
  }

  async finish(id: number, workerId: string, values: Pick<typeof jobs.$inferInsert, 'status' | 'resultBookId' | 'error' | 'reviewId' | 'retryable'>) {
    await this.db
      .update(jobs)
      .set({ ...values, workerId: null, leaseUntil: null, updatedAt: new Date() })
      .where(and(eq(jobs.id, id), eq(jobs.workerId, workerId), inArray(jobs.status, ['downloading', 'importing'])));
  }
}
