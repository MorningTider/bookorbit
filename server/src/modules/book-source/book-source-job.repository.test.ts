import { Test } from '@nestjs/testing';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import { BookSourceJobRepository } from './book-source-job.repository';

const databaseUrl = process.env.BOOK_SOURCE_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('BookSourceJobRepository PostgreSQL integration', () => {
  let pool: Pool;
  let repository: BookSourceJobRepository;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/bookorbit_source_jobs_test')
      throw new Error('Use the dedicated local bookorbit_source_jobs_test database');
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(
      'CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY); CREATE TABLE IF NOT EXISTS libraries (id serial PRIMARY KEY); CREATE TABLE IF NOT EXISTS library_folders (id serial PRIMARY KEY); CREATE TABLE IF NOT EXISTS books (id serial PRIMARY KEY)',
    );
    const migration = await readFile(new URL('../../db/migrations/0125_book-source-background-jobs.sql', import.meta.url), 'utf8');
    await pool.query('DROP TABLE IF EXISTS book_source_jobs');
    await pool.query(migration);
    await pool.query(await readFile(new URL('../../db/migrations/0126_book-source-active-index.sql', import.meta.url), 'utf8'));
    await pool.query('INSERT INTO users(id) VALUES (7),(8) ON CONFLICT DO NOTHING; INSERT INTO libraries(id) VALUES (3),(4) ON CONFLICT DO NOTHING');
    const module = await Test.createTestingModule({
      providers: [BookSourceJobRepository, { provide: DB, useValue: drizzle(pool, { schema }) }],
    }).compile();
    repository = module.get(BookSourceJobRepository);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE book_source_jobs RESTART IDENTITY');
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('deduplicates concurrent submissions and isolates users', async () => {
    const [a, b] = await Promise.all([
      repository.enqueue(7, 3, undefined, '7290175791344651298'),
      repository.enqueue(7, 3, undefined, '7290175791344651298'),
    ]);
    expect(a.id).toBe(b.id);
    await expect(repository.owned(a.id, 8)).rejects.toThrow('不存在');
    expect(await repository.list(8)).toEqual([]);
    await expect(repository.cancel(a.id, 8)).rejects.toThrow('不存在');
  });
  it('keeps equal book IDs from different sources separate and accepts the maximum namespaced identity', async () => {
    const [fanqie, qidian, rule] = await Promise.all([
      repository.enqueue(7, 3, undefined, '101'),
      repository.enqueue(7, 3, undefined, 'qidian:101'),
      repository.enqueue(7, 3, undefined, 'sample7:1234567890123456'),
    ]);
    expect(new Set([fanqie.id, qidian.id, rule.id]).size).toBe(3);
    expect((await repository.enqueue(7, 3, undefined, 'qidian:101')).id).toBe(qidian.id);
    expect(await repository.list(8)).toEqual([]);
  });
  it('claims only one download globally across worker replicas', async () => {
    await repository.enqueue(7, 3, undefined, '7290175791344651298');
    await repository.enqueue(8, 4, undefined, '7290175791344651299');
    const claims = await Promise.all([repository.claim('worker-a'), repository.claim('worker-b')]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const job = claims.find(Boolean)!;
    expect(await repository.beginImport(job.id, job.workerId!, '测试小说')).toBe(true);
    expect(await repository.claim('worker-c')).toBeNull();
  });
  it('cancels queued jobs and fences importing jobs against cancellation or retry', async () => {
    const job = await repository.enqueue(7, 3, undefined, '7290175791344651298');
    expect((await repository.cancel(job.id, 7)).status).toBe('cancelled');
    expect((await repository.retry(job.id, 7)).status).toBe('queued');
    await repository.claim('worker');
    await repository.beginImport(job.id, 'worker', '书名');
    await expect(repository.cancel(job.id, 7)).rejects.toThrow('已开始入库');
    await repository.finish(job.id, 'worker', { status: 'failed', error: '入库未确认' });
    await expect(repository.retry(job.id, 7)).rejects.toThrow('不能重试');
    expect((await repository.enqueue(7, 3, undefined, job.sourceBookId)).id).toBe(job.id);
  });
  it('recovers expired download leases and rejects stale worker writes', async () => {
    const job = await repository.enqueue(7, 3, undefined, '7290175791344651298');
    await repository.claim('old');
    await pool.query("UPDATE book_source_jobs SET lease_until = now() - interval '1 minute'");
    await repository.claim('new');
    expect((await repository.owned(job.id, 7)).status).toBe('failed');
    expect(await repository.beginImport(job.id, 'old', '书名')).toBe(false);
    await repository.retry(job.id, 7);
    expect((await repository.claim('new'))?.attempts).toBe(2);
    await repository.finish(job.id, 'old', { status: 'completed' });
    expect((await repository.owned(job.id, 7)).status).toBe('downloading');
  });
  it('allows a fresh download after the previously imported book was deleted', async () => {
    const job = await repository.enqueue(7, 3, undefined, '7290175791344651298');
    await pool.query('INSERT INTO books(id) VALUES (11) ON CONFLICT DO NOTHING');
    await repository.claim('worker');
    await repository.beginImport(job.id, 'worker', '书名');
    await repository.finish(job.id, 'worker', { status: 'completed', resultBookId: 11 });
    expect((await repository.enqueue(7, 3, undefined, job.sourceBookId)).id).toBe(job.id);
    await pool.query('DELETE FROM books WHERE id = 11');
    const next = await repository.enqueue(7, 3, undefined, job.sourceBookId);
    expect(next.id).not.toBe(job.id);
    expect(next.status).toBe('queued');
  });

  it('bounds queues and history reads with indexed cursor pagination', async () => {
    for (let i = 0; i < 20; i++) await repository.enqueue(7, 3, undefined, String(7290175790 + i));
    await expect(repository.enqueue(7, 3, undefined, '8290175790')).rejects.toThrow('20');
    await pool.query("UPDATE book_source_jobs SET status = 'cancelled'");
    for (let i = 0; i < 10; i++) await repository.enqueue(7, 3, undefined, String(8290175790 + i));
    const page = await repository.list(7);
    expect(page).toHaveLength(26);
    const next = await repository.list(7, page[24]!.id);
    expect(next).toHaveLength(5);
    expect(next.every((job) => job.id < page[24]!.id)).toBe(true);
  });
});
