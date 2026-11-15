import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import type { GithubBookFormat } from '@bookorbit/types';

export const githubBookRepositories = pgTable(
  'github_book_repositories',
  {
    id: serial('id').primaryKey(),
    label: varchar('label', { length: 120 }).notNull(),
    repository: varchar('repository', { length: 200 }).notNull(),
    branch: varchar('branch', { length: 200 }).notNull().default(''),
    path: text('path').notNull().default(''),
    formats: jsonb('formats').$type<GithubBookFormat[]>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    indexId: uuid('index_id'),
    runId: uuid('run_id'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    indexState: varchar('index_state', { length: 16 }).notNull().default('idle'),
    fileCount: integer('file_count').notNull().default(0),
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [uniqueIndex('github_book_repositories_identity_idx').on(t.repository, t.branch, t.path)],
);

export const githubBookEntries = pgTable(
  'github_book_entries',
  {
    id: serial('id').primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => githubBookRepositories.id, { onDelete: 'cascade' }),
    generation: uuid('generation').notNull(),
    path: text('path').notNull(),
    commitSha: varchar('commit_sha', { length: 64 }).notNull(),
    blobSha: varchar('blob_sha', { length: 64 }),
    format: varchar('format', { length: 8 }).$type<GithubBookFormat>().notNull(),
    sizeBytes: integer('size_bytes'),
    title: text('title').notNull(),
  },
  (t) => [
    index('github_book_entries_generation_idx').on(t.repositoryId, t.generation),
    index('github_book_entries_blob_idx').on(t.blobSha, t.id),
    index('github_book_entries_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
  ],
);
