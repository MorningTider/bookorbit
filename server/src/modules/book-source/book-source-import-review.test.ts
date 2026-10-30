import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BookSourceJobRepository } from './book-source-job.repository';

const failed = { id: 1, userId: 7, libraryId: 3, sourceBookId: '6982529841564224526', status: 'failed', retryable: false, resultBookId: null };
function createRepository(job: typeof failed | null = failed) {
  const chain = (rows: unknown[]) => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) });
  const update = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ ...failed, status: 'queued', retryable: true }]),
  };
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi
      .fn()
      .mockReturnValueOnce(chain(job ? [job] : []))
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([{ count: 0 }]) }) }),
    update: vi.fn().mockReturnValue(update),
  };
  const repository = new BookSourceJobRepository({
    transaction: (callback: (value: typeof tx) => unknown) => Promise.resolve(callback(tx)),
  } as never);
  return { repository, tx, update };
}
describe('reviewed import retry', () => {
  it('rejects an unconfirmed import retry', async () => {
    const { repository, tx } = createRepository();
    await expect(repository.retry(1, 7)).rejects.toThrow(ConflictException);
    expect(tx.update).not.toHaveBeenCalled();
  });
  it('queues only after an explicit review and restores ordinary retry state', async () => {
    const { repository, update } = createRepository();
    await expect(repository.retry(1, 7, true)).resolves.toMatchObject({ id: 1, status: 'queued', retryable: true });
    expect(update.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued', retryable: true, error: null }));
  });
  it.each(['importing', 'completed', 'cancelled'])('does not bypass %s state', async (status) => {
    const { repository, tx } = createRepository({ ...failed, status });
    await expect(repository.retry(1, 7, true)).rejects.toThrow(ConflictException);
    expect(tx.update).not.toHaveBeenCalled();
  });
  it('keeps missing or unowned jobs private', async () => {
    const { repository, tx } = createRepository(null);
    await expect(repository.retry(1, 8, true)).rejects.toThrow(NotFoundException);
    expect(tx.update).not.toHaveBeenCalled();
  });
});
