import { sql } from 'drizzle-orm';
import { type AnyPgColumn, check, index, integer, pgTable, serial, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { books, bookFiles } from './books';

export const bookComments = pgTable(
  'book_comments',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').notNull(),
    parentId: integer('parent_id').references((): AnyPgColumn => bookComments.id, { onDelete: 'cascade' }),
    threadId: integer('thread_id').references((): AnyPgColumn => bookComments.id, { onDelete: 'cascade' }),
    scope: varchar('scope', { length: 16 }).notNull().$type<'review' | 'chapter' | 'paragraph'>(),
    bookFileId: integer('book_file_id').references(() => bookFiles.id, { onDelete: 'cascade' }),
    anchorKey: varchar('anchor_key', { length: 64 }).notNull(),
    chapterHref: varchar('chapter_href', { length: 2048 }),
    chapterTitle: varchar('chapter_title', { length: 500 }),
    cfi: text('cfi'),
    quote: text('quote'),
    body: text('body').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('book_comments_user_client_idx').on(t.userId, t.clientId),
    index('book_comments_book_roots_idx')
      .on(t.bookId, t.id)
      .where(sql`${t.threadId} is null`),
    index('book_comments_book_anchor_idx')
      .on(t.bookId, t.bookFileId, t.scope, t.anchorKey, t.id)
      .where(sql`${t.threadId} is null`),
    index('book_comments_thread_idx').on(t.bookId, t.threadId, t.id),
    index('book_comments_parent_idx').on(t.parentId),
    index('book_comments_user_idx').on(t.userId),
    index('book_comments_file_idx').on(t.bookFileId),
    check('book_comments_scope_chk', sql`${t.scope} in ('review', 'chapter', 'paragraph')`),
    check('book_comments_reply_chk', sql`(${t.parentId} is null) = (${t.threadId} is null)`),
    check('book_comments_body_chk', sql`length(${t.body}) <= 5000 and (${t.deletedAt} is not null or length(trim(${t.body})) > 0)`),
  ],
);
