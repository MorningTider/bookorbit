import { ImportReviewRequiredException } from '../import-review/import-review.service';
import { BookSourceProgress } from './book-source-progress.service';
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { BookSourceService } from './book-source.service';
import { BookSourceJobRepository } from './book-source-job.repository';
import { BookSourceWorker } from './book-source-worker.service';

const repository = { reconcileReviews: vi.fn(), claim: vi.fn(), heartbeat: vi.fn(), beginImport: vi.fn(), finish: vi.fn() };
const sources = { acquireQidian: vi.fn(), acquireTomato: vi.fn() };
const auth = { findActingUser: vi.fn() };
const job = { id: 1, userId: 7, libraryId: 3, folderId: null, sourceBookId: '7290175791344651298' };
const user = { id: 7, active: true, isSuperuser: false, permissions: [Permission.LibraryUpload, Permission.BookRequestSelfFulfill] };
async function worker(progress = new BookSourceProgress()) {
  const module = await Test.createTestingModule({
    providers: [
      { provide: BookSourceProgress, useValue: progress },
      BookSourceWorker,
      { provide: BookSourceJobRepository, useValue: repository },
      { provide: BookSourceService, useValue: sources },
      { provide: AuthService, useValue: auth },
    ],
  }).compile();
  return module.get(BookSourceWorker);
}

describe('BookSourceWorker durable orchestration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repository.claim.mockResolvedValueOnce(job).mockResolvedValue(null);
    repository.heartbeat.mockResolvedValue({ ...job, cancelRequested: false });
    repository.beginImport.mockResolvedValue(true);
    auth.findActingUser.mockResolvedValue({ ...user });
  });
  it('retains a downloaded artifact for user choice instead of marking it failed or redownloading', async () => {
    sources.acquireTomato.mockRejectedValue(new ImportReviewRequiredException({ id: 'review-uuid' } as never));
    const instance = await worker();
    await instance.tick();
    await vi.waitFor(() =>
      expect(repository.finish).toHaveBeenCalledWith(1, expect.any(String), {
        status: 'awaiting_choice',
        reviewId: 'review-uuid',
        retryable: true,
        error: null,
      }),
    );
    expect(sources.acquireTomato).toHaveBeenCalledTimes(1);
    await instance.onModuleDestroy();
  });
  it('routes namespaced Qidian jobs through the chapter engine without invoking Tomato', async () => {
    repository.claim
      .mockReset()
      .mockResolvedValueOnce({ ...job, sourceBookId: 'qidian:1010868264' })
      .mockResolvedValue(null);
    sources.acquireQidian.mockResolvedValue({ bookId: 12 });
    const instance = await worker();
    await instance.tick();
    await vi.waitFor(() =>
      expect(repository.finish).toHaveBeenCalledWith(1, expect.any(String), { status: 'completed', resultBookId: 12, error: null }),
    );
    expect(sources.acquireQidian).toHaveBeenCalledWith(
      3,
      undefined,
      '1010868264',
      expect.objectContaining({ id: 7 }),
      expect.any(AbortSignal),
      expect.any(Function),
      expect.any(Function),
      undefined,
    );
    expect(sources.acquireTomato).not.toHaveBeenCalled();
    await instance.onModuleDestroy();
  });
  it('returns from queue polling while a download is running and persists the imported book', async () => {
    let complete!: (value: { bookId: number }) => void;
    sources.acquireTomato.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const instance = await worker();
    await instance.tick();
    await vi.waitFor(() => expect(sources.acquireTomato).toHaveBeenCalled());
    expect(repository.finish).not.toHaveBeenCalled();
    await instance.tick();
    expect(repository.claim).toHaveBeenCalledTimes(1);
    expect(repository.heartbeat).toHaveBeenCalled();
    complete({ bookId: 11 });
    await vi.waitFor(() =>
      expect(repository.finish).toHaveBeenCalledWith(1, expect.any(String), { status: 'completed', resultBookId: 11, error: null }),
    );
    await instance.onModuleDestroy();
  });
  it('cancels running work through a database flag without importing', async () => {
    sources.acquireTomato.mockImplementation(
      (_a, _b, _c, _d, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    const instance = await worker();
    await instance.tick();
    repository.heartbeat.mockResolvedValue({ ...job, cancelRequested: true });
    await instance.tick();
    await vi.waitFor(() => expect(repository.finish).toHaveBeenCalledWith(1, expect.any(String), expect.objectContaining({ status: 'cancelled' })));
    expect(repository.beginImport).not.toHaveBeenCalled();
    await instance.onModuleDestroy();
  });
  it('rechecks current permissions before touching a source', async () => {
    auth.findActingUser.mockResolvedValue({ ...user, permissions: [] });
    const instance = await worker();
    await instance.tick();
    await vi.waitFor(() => expect(repository.finish).toHaveBeenCalledWith(1, expect.any(String), expect.objectContaining({ status: 'failed' })));
    expect(sources.acquireTomato).not.toHaveBeenCalled();
    await instance.onModuleDestroy();
  });
  it('refuses import when a job was cancelled or its lease was replaced', async () => {
    repository.beginImport.mockResolvedValue(false);
    sources.acquireTomato.mockImplementation(async (_a, _b, _c, _d, _e, beforeImport: (title: string) => Promise<void>) => {
      await beforeImport('测试书名');
      throw new Error('should not import');
    });
    const instance = await worker();
    await instance.tick();
    await vi.waitFor(() => expect(repository.finish).toHaveBeenCalledWith(1, expect.any(String), expect.objectContaining({ status: 'failed' })));
    expect(auth.findActingUser).toHaveBeenCalledTimes(2);
    expect(repository.finish).not.toHaveBeenCalledWith(1, expect.any(String), expect.objectContaining({ status: 'completed' }));
    await instance.onModuleDestroy();
  });
  it('handles a download completing while its heartbeat query is pending', async () => {
    let complete!: (value: { bookId: number }) => void;
    let heartbeatComplete!: (value: null) => void;
    sources.acquireTomato.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const instance = await worker();
    const warning = vi.spyOn(Logger.prototype, 'warn');
    try {
      await instance.tick();
      await vi.waitFor(() => expect(sources.acquireTomato).toHaveBeenCalled());
      repository.heartbeat.mockImplementation(
        () =>
          new Promise((resolve) => {
            heartbeatComplete = resolve;
          }),
      );
      const poll = instance.tick();
      complete({ bookId: 11 });
      await vi.waitFor(() => expect(repository.finish).toHaveBeenCalled());
      await new Promise((resolve) => setImmediate(resolve));
      heartbeatComplete(null);
      await poll;
      expect(warning).not.toHaveBeenCalled();
      await instance.tick();
      expect(repository.claim).toHaveBeenCalledTimes(2);
    } finally {
      warning.mockRestore();
      await instance.onModuleDestroy();
    }
  });
});

it('publishes real worker progress only to the owner and clears it after completion', async () => {
  vi.resetAllMocks();
  auth.findActingUser.mockResolvedValue({ ...user });
  repository.claim.mockReset().mockResolvedValueOnce(job).mockResolvedValue(null);
  const progress = new BookSourceProgress();
  let finish!: (value: { bookId: number }) => void;
  sources.acquireTomato.mockImplementation((_a, _b, _c, _d, _e, _f, report) => {
    report({ phase: 'downloading', completedChapters: 25, totalChapters: 100, title: '测试作品' });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const instance = await worker(progress);
  await instance.tick();
  await vi.waitFor(() => expect(progress.read(1, 7)?.completedChapters).toBe(25));
  expect(progress.read(1, 8)).toBeUndefined();
  finish({ bookId: 12 });
  await vi.waitFor(() => expect(progress.read(1, 7)).toBeUndefined());
  await instance.onModuleDestroy();
});
