import { ConflictException, NotFoundException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { BookSourceJobRepository } from './book-source-job.repository';

function setup(removed: unknown[] = [], owned = true) {
  const predicate = vi.fn().mockReturnValue({ returning: () => Promise.resolve(removed) });
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockReturnValue({ where: predicate }),
    select: vi.fn().mockReturnValue({ from: () => ({ where: () => ({ limit: () => Promise.resolve(owned ? [{ id: 11 }] : []) }) }) }),
  };
  return {
    tx,
    predicate,
    repository: new BookSourceJobRepository({ transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as never),
  };
}
describe('terminal source task removal', () => {
  it('atomically scopes deletion to the owner and terminal states, retaining the result book', async () => {
    const row = { id: 11, status: 'completed', resultBookId: 31 };
    const { repository, tx, predicate } = setup([row]);
    expect(await repository.remove(11, 7)).toEqual(row);
    const query = new PgDialect().sqlToQuery(predicate.mock.calls[0]![0]);
    expect(query.sql).toContain('"book_source_jobs"."user_id"');
    expect(query.params).toEqual([11, 7, 'completed', 'failed', 'cancelled']);
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(tx.select).not.toHaveBeenCalled();
  });
  it('rejects active tasks without deleting library data', async () => {
    await expect(setup().repository.remove(11, 7)).rejects.toThrow(ConflictException);
  });
  it('does not disclose another user task', async () => {
    await expect(setup([], false).repository.remove(11, 8)).rejects.toThrow(NotFoundException);
  });
});

describe('source job library pagination', () => {
  function listing() {
    const where = vi.fn().mockReturnValue({ orderBy: () => ({ limit: () => Promise.resolve([]) }) });
    const select = vi.fn().mockReturnValue({ from: () => ({ where }) });
    return { repository: new BookSourceJobRepository({ select } as never), select, where };
  }
  it('filters by both user and library before the cursor limit', async () => {
    const { repository, where } = listing();
    await repository.list(7, 100, [3]);
    const query = new PgDialect().sqlToQuery(where.mock.calls[0]![0]);
    expect(query.sql).toContain('"book_source_jobs"."library_id"');
    expect(query.params).toEqual([7, 100, 3]);
  });
  it('returns no jobs for an empty visible library scope', async () => {
    const { repository, select } = listing();
    expect(await repository.list(7, undefined, [])).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });
});
