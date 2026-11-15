import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, ilike, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { GithubBookSourceConfig, GithubBookSourceUpdate, GithubSourceCandidate, GithubSourceFile } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { githubBookRepositories as repos, githubBookEntries as entries, appSettings } from '../../db/schema';

const SETTING = 'github_book_sources';
const LEASE_MS = 120_000;
type Entry = typeof entries.$inferInsert;

@Injectable()
export class GithubSourceRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async config(): Promise<GithubBookSourceConfig> {
    const [setting, rows] = await this.db.transaction(
      (tx) =>
        Promise.all([
          tx.select().from(appSettings).where(eq(appSettings.key, SETTING)).limit(1),
          tx.select().from(repos).orderBy(asc(repos.id)).limit(50),
        ]),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
    const saved = setting[0] ? (JSON.parse(setting[0].value) as { enabled: boolean; revision: string }) : { enabled: false, revision: '0' };
    return {
      ...saved,
      repositories: rows.map((row) => ({
        id: row.id,
        label: row.label,
        repository: row.repository,
        branch: row.branch,
        path: row.path,
        formats: row.formats,
        enabled: row.enabled,
        indexState: row.indexState as 'idle' | 'indexing' | 'ready' | 'failed',
        fileCount: row.fileCount,
        indexedAt: row.indexedAt?.toISOString() ?? null,
        error: row.error,
      })),
    };
  }

  async update(input: GithubBookSourceUpdate) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(192835, 1)`);
      const [setting] = await tx.select().from(appSettings).where(eq(appSettings.key, SETTING)).limit(1);
      const revision = setting ? (JSON.parse(setting.value) as { revision: string }).revision : '0';
      if (revision !== input.revision) throw new ConflictException('GitHub configuration changed; reload before saving');
      const previous = await tx.select().from(repos).limit(50);
      const ids = input.repositories.flatMap((row) => (row.id ? [row.id] : []));
      if (new Set(ids).size !== ids.length || ids.some((id) => !previous.some((row) => row.id === id)))
        throw new BadRequestException('Unknown or duplicate repository id');
      const removed = previous.filter(
        (old) =>
          !ids.includes(old.id) ||
          input.repositories.some(
            (row) => row.id === old.id && (row.repository !== old.repository || row.branch !== old.branch || row.path !== old.path),
          ),
      );
      if (removed.length)
        await tx.delete(repos).where(
          inArray(
            repos.id,
            removed.map((row) => row.id),
          ),
        );
      for (const inputRow of input.repositories) {
        const { id, ...row } = inputRow;
        const old = previous.find((value) => value.id === id && !removed.some((item) => item.id === id));
        if (old) {
          const formatChanged = JSON.stringify(old.formats) !== JSON.stringify(row.formats);
          await tx
            .update(repos)
            .set({ ...row, ...(formatChanged ? { indexId: null, runId: null, indexState: 'idle', fileCount: 0, error: null } : {}) })
            .where(eq(repos.id, old.id));
        } else await tx.insert(repos).values(row);
      }
      await tx
        .insert(appSettings)
        .values({ key: SETTING, value: JSON.stringify({ enabled: input.enabled, revision: randomUUID() }) })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify({ enabled: input.enabled, revision: randomUUID() }) } });
    });
    return this.config();
  }

  async find(id: number) {
    const [row] = await this.db.select().from(repos).where(eq(repos.id, id)).limit(1);
    if (!row) throw new NotFoundException('GitHub repository no longer exists');
    return row;
  }

  async claim(id: number, runId: string) {
    const [row] = await this.db
      .update(repos)
      .set({ runId, indexState: 'indexing', leaseUntil: new Date(Date.now() + LEASE_MS), error: null })
      .where(and(eq(repos.id, id), or(ne(repos.indexState, 'indexing'), lt(repos.leaseUntil, new Date()))))
      .returning();
    if (!row) throw new ConflictException('Repository is already being indexed or was removed');
    await this.db.delete(entries).where(and(eq(entries.repositoryId, id), row.indexId ? ne(entries.generation, row.indexId) : undefined));
    return row;
  }

  async stage(id: number, runId: string, batch: Entry[]) {
    await this.db.transaction(async (tx) => {
      const [lease] = await tx
        .update(repos)
        .set({ leaseUntil: new Date(Date.now() + LEASE_MS) })
        .where(and(eq(repos.id, id), eq(repos.runId, runId)))
        .returning({ id: repos.id });
      if (!lease) throw new ConflictException('Repository indexing lease expired');
      if (batch.length) await tx.insert(entries).values(batch);
    });
  }

  async publish(id: number, runId: string, fileCount: number) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(repos)
        .set({ indexId: runId, runId: null, leaseUntil: null, indexState: 'ready', fileCount, indexedAt: new Date(), error: null })
        .where(and(eq(repos.id, id), eq(repos.runId, runId)))
        .returning({ id: repos.id });
      if (!row) throw new ConflictException('Repository configuration changed during indexing');
      await tx.delete(entries).where(and(eq(entries.repositoryId, id), ne(entries.generation, runId)));
    });
  }

  async fail(id: number, runId: string, error: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(repos)
        .set({ runId: null, leaseUntil: null, indexState: 'failed', error: error.slice(0, 400) })
        .where(and(eq(repos.id, id), eq(repos.runId, runId)));
      await tx.delete(entries).where(and(eq(entries.repositoryId, id), eq(entries.generation, runId)));
    });
  }

  async search(query: string, cursor?: string) {
    const terms = query
      .trim()
      .split(/\s+/)
      .slice(0, 10)
      .map((term) => '%' + term.replace(/[\\%_]/g, '\\$&') + '%');
    const cursorKey = sql<string>`coalesce(${entries.blobSha}, 'pending:' || ${entries.id}::text)`;
    const rows = await this.db
      .selectDistinctOn([cursorKey], { entry: entries, repo: repos, cursorKey })
      .from(entries)
      .innerJoin(repos, and(eq(repos.id, entries.repositoryId), eq(repos.indexId, entries.generation)))
      .where(and(eq(repos.enabled, true), cursor ? gt(cursorKey, cursor) : undefined, ...terms.map((term) => ilike(entries.title, term))))
      .orderBy(asc(cursorKey), asc(entries.id))
      .limit(41);
    return {
      items: rows.slice(0, 40).map(({ entry, repo }) => this.candidate(entry, repo)),
      nextCursor: rows.length > 40 ? rows[39]!.cursorKey : null,
    };
  }

  async entry(id: number): Promise<GithubSourceCandidate> {
    const [row] = await this.db
      .select({ entry: entries, repo: repos })
      .from(entries)
      .innerJoin(repos, and(eq(repos.id, entries.repositoryId), eq(repos.indexId, entries.generation)))
      .where(eq(entries.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Search result expired; search again');
    return this.candidate(row.entry, row.repo);
  }

  private candidate(entry: typeof entries.$inferSelect, repo: typeof repos.$inferSelect): GithubSourceCandidate {
    return {
      id: entry.id,
      repositoryId: repo.id,
      repository: repo.repository,
      repositoryLabel: repo.label,
      branch: repo.branch,
      rootPath: repo.path,
      path: entry.path,
      commitSha: entry.commitSha,
      blobSha: entry.blobSha,
      format: entry.format,
      sizeBytes: entry.sizeBytes,
      title: entry.title,
      filename: basename(entry.path),
    };
  }

  async assertCurrent(file: GithubSourceFile | GithubSourceCandidate) {
    const config = await this.config();
    const repo = config.repositories.find((row) => row.id === file.repositoryId);
    if (!config.enabled || !repo?.enabled) throw new ConflictException('GitHub source or repository is disabled');
    if (repo.repository !== file.repository || repo.branch !== file.branch || repo.path !== file.rootPath || !repo.formats.includes(file.format))
      throw new ConflictException('Repository configuration changed; submit a fresh search result');
  }
}
