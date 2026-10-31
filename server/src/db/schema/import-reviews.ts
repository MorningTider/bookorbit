import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, varchar, bigint } from 'drizzle-orm/pg-core';
import type { ImportIdentity, ImportOrigin } from '@bookorbit/types';
import { books } from './books';
import { users } from './auth';
import { libraries, libraryFolders } from './libraries';

export const bookImportIdentities = pgTable(
  'book_import_identities',
  {
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 50 }).notNull(),
    providerBookId: varchar('provider_book_id', { length: 255 }).notNull(),
    originalTitle: varchar('original_title', { length: 1000 }),
    originalAuthors: text('original_authors').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.provider, t.providerBookId] }),
    index('book_import_identity_lookup_idx').on(t.provider, t.providerBookId),
  ],
);

export const bookImportReviews = pgTable(
  'book_import_reviews',
  {
    id: uuid('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    folderId: integer('folder_id').references(() => libraryFolders.id, { onDelete: 'set null' }),
    filename: varchar('filename', { length: 500 }).notNull(),
    stagingPath: text('staging_path').notNull(),
    format: varchar('format', { length: 20 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    incomingSha256: varchar('incoming_sha256', { length: 64 }).notNull(),
    identity: jsonb('identity').$type<ImportIdentity>().notNull(),
    origin: jsonb('origin').$type<ImportOrigin>(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    resultBookId: integer('result_book_id').references(() => books.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('book_import_reviews_owner_idx').on(t.userId, t.id),
    index('book_import_reviews_expiry_idx').on(t.status, t.expiresAt),
    index('book_import_reviews_pending_idx')
      .on(t.userId, t.createdAt)
      .where(sql`${t.status} in ('pending', 'processing')`),
  ],
);
