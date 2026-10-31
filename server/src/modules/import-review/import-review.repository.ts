import type { Pool } from 'pg';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, exists, getTableColumns, gt, inArray, isNotNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ImportDuplicatePolicy, ImportIdentity } from '@bookorbit/types';
import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import {
  authors,
  bookAuthors,
  bookFiles,
  bookImportIdentities,
  bookImportReviews,
  bookMetadata,
  books,
  bookSourceJobs,
  libraries,
  libraryFolders,
} from '../../db/schema';
import type { RequestUser } from '../../common/types/request-user';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { importIsbn, importIsbn10, normalizeImportText } from './import-match.utils';

@Injectable()
export class ImportReviewRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema> & { $client: Pool }) {}

  async findCandidates(
    identities: ImportIdentity[],
    libraryIds: number[],
    policy: ImportDuplicatePolicy,
    user: RequestUser,
    fingerprint?: { hash: string; size: number },
    destinationBookId?: number,
  ) {
    if (!libraryIds.length || !identities.length) return { rows: [], files: [], authors: [], origins: [] };
    const conditions: SQL[] = [];
    if (destinationBookId) conditions.push(eq(books.id, destinationBookId));
    const titles = [...new Set(identities.map((x) => normalizeImportText(x.title ?? '')).filter(Boolean))];
    if (policy.titleAndAuthor && titles.length)
      conditions.push(
        or(
          inArray(sql`lower(${bookMetadata.title})`, titles),
          exists(
            this.db
              .select({ one: sql`1` })
              .from(bookImportIdentities)
              .where(and(eq(bookImportIdentities.bookId, books.id), inArray(sql`lower(${bookImportIdentities.originalTitle})`, titles))),
          ),
        )!,
      );
    if (policy.isbn) {
      const canonical = identities.map(importIsbn).filter((x): x is string => !!x);
      const raw10 = identities.map(importIsbn10).filter((x): x is string => !!x);
      if (canonical.length) conditions.push(inArray(sql`regexp_replace(upper(${bookMetadata.isbn13}), '[^0-9X]', '', 'g')`, canonical));
      if (raw10.length) conditions.push(inArray(sql`regexp_replace(upper(${bookMetadata.isbn10}), '[^0-9X]', '', 'g')`, raw10));
    }
    if (policy.sourceIdentity) {
      const origins = identities.flatMap((x) => (x.origin ? [x.origin] : []));
      if (origins.length) {
        conditions.push(
          exists(
            this.db
              .select({ one: sql`1` })
              .from(bookImportIdentities)
              .where(
                and(
                  eq(bookImportIdentities.bookId, books.id),
                  or(...origins.map((x) => and(eq(bookImportIdentities.provider, x.provider), eq(bookImportIdentities.providerBookId, x.id)))),
                ),
              ),
          ),
        );
        conditions.push(
          exists(
            this.db
              .select({ one: sql`1` })
              .from(bookSourceJobs)
              .where(
                and(
                  eq(bookSourceJobs.resultBookId, books.id),
                  eq(bookSourceJobs.userId, user.id),
                  eq(bookSourceJobs.status, 'completed'),
                  inArray(
                    bookSourceJobs.sourceBookId,
                    origins.map((x) => (x.provider === 'fanqie' ? x.id : `${x.provider}:${x.id}`)),
                  ),
                ),
              ),
          ),
        );
      }
    }
    if (policy.contentHash && fingerprint)
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(bookFiles)
            .where(and(eq(bookFiles.bookId, books.id), eq(bookFiles.fileHash, fingerprint.hash), eq(bookFiles.sizeBytes, fingerprint.size))),
        ),
      );
    if (!conditions.length) return { rows: [], files: [], authors: [], origins: [] };
    const rows = await this.db
      .select({
        bookId: books.id,
        libraryId: books.libraryId,
        libraryName: libraries.name,
        title: bookMetadata.title,
        isbn10: bookMetadata.isbn10,
        isbn13: bookMetadata.isbn13,
        primaryFormat: sql<string | null>`(select f.format from book_files f where f.id=${books.primaryFileId} and f.book_id=${books.id})`,
      })
      .from(books)
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(
        and(
          inArray(books.libraryId, libraryIds),
          eq(books.status, 'present'),
          or(...conditions),
          ...(!user.isSuperuser && user.contentFilters ? buildContentFilterClauses(user.contentFilters, this.db) : []),
        ),
      )
      .orderBy(books.id)
      .limit(201);
    const ids = rows.slice(0, 200).map((x) => x.bookId);
    if (!ids.length) return { rows: [], files: [], authors: [], origins: [] };
    const rankedFiles = this.db
      .select({
        ...getTableColumns(bookFiles),
        previewRank: sql<number>`row_number() over (partition by ${bookFiles.bookId} order by ${bookFiles.id})`.as('preview_rank'),
      })
      .from(bookFiles)
      .where(and(inArray(bookFiles.bookId, ids), eq(bookFiles.role, 'content')))
      .as('ranked_import_files');
    const [previewFiles, fingerprintFiles, authorRows, origins] = await Promise.all([
      this.db.select().from(rankedFiles).where(lte(rankedFiles.previewRank, 50)).limit(10000),
      fingerprint
        ? this.db
            .select()
            .from(bookFiles)
            .where(
              and(
                inArray(bookFiles.bookId, ids),
                eq(bookFiles.role, 'content'),
                eq(bookFiles.fileHash, fingerprint.hash),
                eq(bookFiles.sizeBytes, fingerprint.size),
              ),
            )
            .orderBy(bookFiles.id)
            .limit(21)
        : Promise.resolve([]),
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, ids))
        .orderBy(bookAuthors.displayOrder)
        .limit(2001),
      this.db.select().from(bookImportIdentities).where(inArray(bookImportIdentities.bookId, ids)).limit(2001),
    ]);
    const files = [...new Map([...previewFiles, ...fingerprintFiles].map((file) => [file.id, file])).values()];
    const completed = policy.sourceIdentity
      ? await this.db
          .select({ bookId: bookSourceJobs.resultBookId, source: bookSourceJobs.sourceBookId })
          .from(bookSourceJobs)
          .where(and(inArray(bookSourceJobs.resultBookId, ids), eq(bookSourceJobs.userId, user.id), eq(bookSourceJobs.status, 'completed')))
          .limit(2001)
      : [];
    return { rows: rows.slice(0, 200), files, authors: authorRows, origins, completed };
  }

  async destinationOwner(libraryId: number, path: string, user: RequestUser) {
    const [row] = await this.db
      .select({ bookId: books.id })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(
        and(
          eq(books.libraryId, libraryId),
          eq(bookFiles.absolutePath, path),
          eq(bookFiles.role, 'content'),
          ...(!user.isSuperuser && user.contentFilters ? buildContentFilterClauses(user.contentFilters, this.db) : []),
        ),
      )
      .limit(1);
    return row?.bookId;
  }

  async file(id: number, user?: RequestUser) {
    const [file] = await this.db
      .select({ file: bookFiles, libraryId: books.libraryId, root: libraryFolders.path })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .innerJoin(libraryFolders, eq(libraryFolders.id, bookFiles.libraryFolderId))
      .where(
        and(eq(bookFiles.id, id), ...(!user?.isSuperuser && user?.contentFilters ? buildContentFilterClauses(user.contentFilters, this.db) : [])),
      )
      .limit(1);
    return file ?? null;
  }
  async filesPage(bookId: number, cursor: number | undefined, format: string | undefined, user: RequestUser) {
    const [book] = await this.db
      .select({ libraryId: books.libraryId })
      .from(books)
      .where(and(eq(books.id, bookId), ...(!user.isSuperuser && user.contentFilters ? buildContentFilterClauses(user.contentFilters, this.db) : [])))
      .limit(1);
    if (!book) return null;
    const files = await this.db
      .select({
        id: bookFiles.id,
        filename: bookFiles.absolutePath,
        format: bookFiles.format,
        sizeBytes: bookFiles.sizeBytes,
        updatedAt: bookFiles.updatedAt,
      })
      .from(bookFiles)
      .where(and(eq(bookFiles.bookId, bookId), cursor ? gt(bookFiles.id, cursor) : undefined, format ? eq(bookFiles.format, format) : undefined))
      .orderBy(bookFiles.id)
      .limit(51);
    return { ...book, files };
  }
  async recordOrigin(bookId: number, identity: ImportIdentity) {
    if (!identity.origin) return;
    await this.db
      .insert(bookImportIdentities)
      .values({
        bookId,
        provider: identity.origin.provider,
        providerBookId: identity.origin.id,
        originalTitle: identity.title,
        originalAuthors: identity.authors,
      })
      .onConflictDoNothing();
  }
  async createReview(values: typeof bookImportReviews.$inferInsert) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(192836, ${values.userId})`);
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(bookImportReviews)
        .where(and(eq(bookImportReviews.userId, values.userId), inArray(bookImportReviews.status, ['pending', 'processing'])));
      if (count >= 20) throw new ConflictException('Resolve or discard pending imports before uploading more duplicates');
      const [row] = await tx.insert(bookImportReviews).values(values).returning();
      return row!;
    });
  }
  async listReviews(userId: number, libraryIds: number[]) {
    if (!libraryIds.length) return [];
    return this.db
      .select({
        id: bookImportReviews.id,
        libraryId: bookImportReviews.libraryId,
        filename: bookImportReviews.filename,
        format: bookImportReviews.format,
        sizeBytes: bookImportReviews.sizeBytes,
        status: bookImportReviews.status,
        createdAt: bookImportReviews.createdAt,
        expiresAt: bookImportReviews.expiresAt,
      })
      .from(bookImportReviews)
      .where(
        and(
          eq(bookImportReviews.userId, userId),
          inArray(bookImportReviews.libraryId, libraryIds),
          inArray(bookImportReviews.status, ['pending', 'processing']),
          gt(bookImportReviews.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(bookImportReviews.createdAt))
      .limit(20);
  }
  async expiredReviews() {
    return this.db
      .select()
      .from(bookImportReviews)
      .where(and(inArray(bookImportReviews.status, ['pending', 'processing']), lt(bookImportReviews.expiresAt, new Date())))
      .orderBy(bookImportReviews.expiresAt)
      .limit(100);
  }
  async withReviewLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const client = await this.db.$client.connect();
    let locked = false;
    let releaseError: Error | undefined;
    try {
      const result = await client.query<{ locked: boolean }>('select pg_try_advisory_lock(192837, hashtext($1)) as locked', [id]);
      locked = result.rows[0]?.locked === true;
      if (!locked) throw new ConflictException('This import is already being processed');
      return await operation();
    } finally {
      if (locked) {
        try {
          await client.query('select pg_advisory_unlock(192837, hashtext($1))', [id]);
        } catch (error) {
          releaseError = error instanceof Error ? error : new Error(String(error));
        }
      }
      client.release(releaseError);
    }
  }
  async expireReview(id: string, userId: number) {
    const [row] = await this.db
      .update(bookImportReviews)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          eq(bookImportReviews.id, id),
          eq(bookImportReviews.userId, userId),
          inArray(bookImportReviews.status, ['pending', 'processing']),
          lt(bookImportReviews.expiresAt, new Date()),
        ),
      )
      .returning();
    return row ?? null;
  }

  async legacyOrigins(after: number) {
    return this.db
      .select({ id: bookSourceJobs.id, bookId: bookSourceJobs.resultBookId, sourceId: bookSourceJobs.sourceBookId, title: bookSourceJobs.title })
      .from(bookSourceJobs)
      .where(and(gt(bookSourceJobs.id, after), eq(bookSourceJobs.status, 'completed'), isNotNull(bookSourceJobs.resultBookId)))
      .orderBy(bookSourceJobs.id)
      .limit(500);
  }
  async insertOrigins(values: (typeof bookImportIdentities.$inferInsert)[]) {
    if (values.length) await this.db.insert(bookImportIdentities).values(values).onConflictDoNothing();
  }

  async ownedReview(id: string, userId: number) {
    const [row] = await this.db
      .select()
      .from(bookImportReviews)
      .where(and(eq(bookImportReviews.id, id), eq(bookImportReviews.userId, userId)))
      .limit(1);
    return row ?? null;
  }
  async claimReview(id: string, userId: number) {
    const [row] = await this.db
      .update(bookImportReviews)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(and(eq(bookImportReviews.id, id), eq(bookImportReviews.userId, userId), eq(bookImportReviews.status, 'pending')))
      .returning();
    return row ?? null;
  }
  async updateReview(id: string, userId: number, values: Partial<Pick<typeof bookImportReviews.$inferInsert, 'status' | 'resultBookId'>>) {
    const [row] = await this.db
      .update(bookImportReviews)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(bookImportReviews.id, id), eq(bookImportReviews.userId, userId)))
      .returning();
    return row ?? null;
  }
}
