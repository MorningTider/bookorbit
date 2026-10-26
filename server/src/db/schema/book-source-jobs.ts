import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { libraries, libraryFolders } from './libraries';
import { books } from './books';

export const bookSourceJobs = pgTable(
  'book_source_jobs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    folderId: integer('folder_id').references(() => libraryFolders.id, { onDelete: 'set null' }),
    sourceBookId: varchar('source_book_id', { length: 25 }).notNull(),
    title: varchar('title', { length: 200 }).notNull().default(''),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    retryable: boolean('retryable').notNull().default(true),
    attempts: integer('attempts').notNull().default(0),
    resultBookId: integer('result_book_id').references(() => books.id, { onDelete: 'set null' }),
    error: text('error'),
    workerId: varchar('worker_id', { length: 36 }),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('book_source_jobs_user_id_idx').on(t.userId, t.id),
    index('book_source_jobs_queue_idx').on(t.status, t.id),
    index('book_source_jobs_user_active_idx')
      .on(t.userId)
      .where(sql`${t.status} in ('queued', 'downloading', 'importing')`),
    uniqueIndex('book_source_jobs_identity_uidx')
      .on(t.userId, t.libraryId, t.sourceBookId)
      .where(sql`${t.status} not in ('failed', 'cancelled') or ${t.retryable} = false`),
    uniqueIndex('book_source_jobs_worker_uidx')
      .on(t.status)
      .where(sql`${t.status} = 'downloading'`),
    check('book_source_jobs_status_chk', sql`${t.status} in ('queued', 'downloading', 'importing', 'completed', 'failed', 'cancelled')`),
  ],
);
