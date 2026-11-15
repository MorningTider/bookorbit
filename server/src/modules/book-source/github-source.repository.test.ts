import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { GithubSourceRepository } from './github-source.repository';
const databaseUrl = process.env.GITHUB_SOURCE_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('GithubSourceRepository PostgreSQL integration', () => {
  let pool: Pool;
  let repository: GithubSourceRepository;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/bookorbit_github_sources_test')
      throw new Error('Use the dedicated local GitHub source test database');
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query('DROP TABLE IF EXISTS github_book_entries, github_book_repositories, book_source_jobs, app_settings CASCADE');
    await pool.query(
      'CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE TABLE book_source_jobs(id serial PRIMARY KEY); CREATE TABLE app_settings(id serial PRIMARY KEY, key varchar(100) UNIQUE NOT NULL, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())',
    );
    await pool.query(await readFile(new URL('../../db/migrations/0134_github_book_sources.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../../db/migrations/0135_github_catalog_search_index.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../../db/migrations/0136_github_catalog_pending_metadata.sql', import.meta.url), 'utf8'));
    repository = new GithubSourceRepository(drizzle(pool, { schema }));
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE github_book_entries, github_book_repositories, app_settings RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await pool?.end();
  });
  async function configure() {
    await repository.update({
      revision: '0',
      enabled: true,
      repositories: [{ label: '测试书源', repository: 'owner/books', branch: '', path: '', formats: ['epub'], enabled: true }],
    });
    return (await repository.config()).repositories[0]!;
  }
  async function stage(repositoryId: number, generation: string, count = 1, blobSha = 'a'.repeat(40)) {
    await repository.stage(
      repositoryId,
      generation,
      Array.from({ length: count }, (_, index) => ({
        repositoryId,
        generation,
        path: `${index}.epub`,
        title: `中文历史${index}`,
        format: 'epub' as const,
        blobSha: count === 1 ? blobSha : index.toString(16).padStart(40, '0'),
        commitSha: 'b'.repeat(40),
        sizeBytes: 100,
      })),
    );
  }
  it('rejects stale concurrent configuration saves and keeps prior configuration', async () => {
    await configure();
    await expect(repository.update({ revision: '0', enabled: false, repositories: [] })).rejects.toThrow('changed');
    expect((await repository.config()).enabled).toBe(true);
  });
  it('publishes a complete generation atomically and retains the previous one on failure', async () => {
    const repo = await configure();
    const first = randomUUID();
    await repository.claim(repo.id, first);
    await stage(repo.id, first);
    await repository.publish(repo.id, first, 1);
    const next = randomUUID();
    await repository.claim(repo.id, next);
    await stage(repo.id, next, 2);
    expect((await repository.search('中文历史')).items).toHaveLength(1);
    await repository.fail(repo.id, next, 'offline');
    expect((await repository.search('中文历史')).items).toHaveLength(1);
    expect((await repository.config()).repositories[0]!.indexState).toBe('failed');
  });
  it('deduplicates identical blobs across configured mirrors', async () => {
    const one = await configure();
    const config = await repository.config();
    await repository.update({
      ...config,
      repositories: [
        ...config.repositories.map(({ id, label, repository, branch, path, formats, enabled }) => ({
          id,
          label,
          repository,
          branch,
          path,
          formats,
          enabled,
        })),
        { label: '镜像', repository: 'other/books', branch: '', path: '', formats: ['epub'], enabled: true },
      ],
    });
    for (const repo of (await repository.config()).repositories) {
      const run = randomUUID();
      await repository.claim(repo.id, run);
      await stage(repo.id, run);
      await repository.publish(repo.id, run, 1);
    }
    expect((await repository.search('历史')).items).toHaveLength(1);
    expect(one.id).toBe(1);
  });
  it('uses a bounded cursor page and escapes wildcard search input', async () => {
    const repo = await configure();
    const run = randomUUID();
    await repository.claim(repo.id, run);
    await stage(repo.id, run, 45);
    await repository.publish(repo.id, run, 45);
    const first = await repository.search('历史');
    expect(first.items).toHaveLength(40);
    expect(first.nextCursor).not.toBeNull();
    const second = await repository.search('历史', first.nextCursor!);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect((await repository.search('%')).items).toHaveLength(0);
  });
  it('keeps catalog entries with unresolved hashes distinct across bounded pages', async () => {
    const repo = await configure();
    const run = randomUUID();
    await repository.claim(repo.id, run);
    await repository.stage(
      repo.id,
      run,
      Array.from({ length: 45 }, (_, index) => ({
        repositoryId: repo.id,
        generation: run,
        path: `${index}.epub`,
        title: `目录历史${index}`,
        format: 'epub' as const,
        blobSha: null,
        sizeBytes: null,
        commitSha: 'b'.repeat(40),
      })),
    );
    await repository.publish(repo.id, run, 45);
    const first = await repository.search('目录历史');
    expect(first.items).toHaveLength(40);
    expect(first.nextCursor).toMatch(/^pending:/);
    const next = await repository.search('目录历史', first.nextCursor!);
    expect(next.items).toHaveLength(5);
    expect(new Set([...first.items, ...next.items].map((item) => item.id)).size).toBe(45);
    expect(first.items[0]).toMatchObject({ blobSha: null, sizeBytes: null });
  });
  it('excludes disabled repositories and rejects stale file snapshots', async () => {
    const repo = await configure();
    const run = randomUUID();
    await repository.claim(repo.id, run);
    await stage(repo.id, run);
    await repository.publish(repo.id, run, 1);
    const entry = (await repository.search('历史')).items[0]!;
    const config = await repository.config();
    await repository.update({
      ...config,
      repositories: config.repositories.map(({ id, label, repository, branch, path, formats }) => ({
        id,
        label,
        repository,
        branch,
        path,
        formats,
        enabled: false,
      })),
    });
    expect((await repository.search('历史')).items).toHaveLength(0);
    await expect(repository.assertCurrent(entry)).rejects.toThrow('disabled');
  });
  it('reserves an active indexing lease and rejects obsolete publication', async () => {
    const repo = await configure();
    const run = randomUUID();
    await repository.claim(repo.id, run);
    await expect(repository.claim(repo.id, randomUUID())).rejects.toThrow('already');
    await expect(repository.publish(repo.id, randomUUID(), 10)).rejects.toThrow('changed');
    await repository.fail(repo.id, run, 'cancelled');
  });
});
