import { describe, expect, it, vi } from 'vitest';
import { assertRemovedPodcastDataEmpty } from './removed-podcast-migration-guard';

const migrations = [{ sql: ['DROP TABLE "podcasts" CASCADE;'] }];

describe('removed podcast migration guard', () => {
  it('ignores migrations which keep the podcast tables', async () => {
    const pool = { query: vi.fn() };
    await assertRemovedPodcastDataEmpty(pool as never, [{ sql: ['SELECT 1'] }]);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('allows fresh schemas and already upgraded schemas', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ name: null }] }) };
    await assertRemovedPodcastDataEmpty(pool as never, migrations);
    expect(pool.query).toHaveBeenCalledTimes(12);
  });
  it('allows empty removed tables and book libraries', async () => {
    const query = vi.fn((statement: string) => Promise.resolve({ rows: statement.includes('to_regclass') ? [{ name: 'table' }] : [] }));
    await assertRemovedPodcastDataEmpty({ query } as never, migrations);
    expect(query).toHaveBeenCalledTimes(25);
  });
  it('refuses populated tables before schema changes', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ name: 'collection_podcasts' }] })
      .mockResolvedValueOnce({ rows: [{ value: 1 }] });
    await expect(assertRemovedPodcastDataEmpty({ query } as never, migrations)).rejects.toThrow('still contains data');
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('also preserves configured podcast libraries without episodes', async () => {
    const query = vi.fn((statement: string) =>
      Promise.resolve({
        rows: statement.includes('to_regclass') ? [{ name: 'table' }] : statement.includes('libraries') ? [{ value: 1 }] : [],
      }),
    );
    await expect(assertRemovedPodcastDataEmpty({ query } as never, migrations)).rejects.toThrow('Review those libraries');
  });
});
