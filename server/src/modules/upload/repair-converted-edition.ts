import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { basename, dirname, extname, join } from 'path';
import * as schema from '../../db/schema';
import { deleteBooksWithHashInvalidation } from '../../db/book-file-hash-history';

type Db = NodePgDatabase<typeof schema>;
const DISCARDED_METADATA = new Set([
  'book_authors',
  'book_narrators',
  'book_covers',
  'book_metadata',
  'book_genres',
  'book_tags',
  'book_series_memberships',
]);
const MOVED_RECORDS = new Set(['book_files', 'reading_attempts', 'reading_sessions', 'user_book_status']);

export function convertedEpubPath(txtPath: string): string {
  if (extname(txtPath).toLowerCase() !== '.txt') throw new ConflictException('The original book must contain a TXT file');
  return join(dirname(txtPath), basename(txtPath, extname(txtPath)) + '.epub');
}

export async function repairConvertedEdition(db: Db, targetId: number, libraryId: number) {
  const targets = await db
    .select()
    .from(schema.bookFiles)
    .where(and(eq(schema.bookFiles.bookId, targetId), eq(schema.bookFiles.format, 'txt')))
    .limit(2);
  if (targets.length !== 1) throw new ConflictException('Exactly one original TXT file is required');
  const expectedPath = convertedEpubPath(targets[0]!.absolutePath);
  const [initialFile] = await db.select().from(schema.bookFiles).where(eq(schema.bookFiles.absolutePath, expectedPath)).limit(1);
  if (!initialFile || initialFile.format !== 'epub' || initialFile.bookId === targetId)
    throw new ConflictException('No separately catalogued same-name EPUB was found');
  const sourceId = initialFile.bookId;
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.books)
      .where(inArray(schema.books.id, [targetId, sourceId]))
      .orderBy(asc(schema.books.id))
      .for('update');
    const target = rows.find((row) => row.id === targetId),
      source = rows.find((row) => row.id === sourceId);
    if (!target || !source) throw new NotFoundException('Book not found');
    if (target.libraryId !== libraryId || source.libraryId !== libraryId || target.libraryFolderId !== source.libraryFolderId)
      throw new ConflictException('Both editions must belong to the same library folder');
    const [library] = await tx.select().from(schema.libraries).where(eq(schema.libraries.id, libraryId)).limit(1);
    if (library?.organizationMode !== 'book_per_file') throw new ConflictException('Edition repair requires a file-per-book library');
    const files = await tx
      .select()
      .from(schema.bookFiles)
      .where(inArray(schema.bookFiles.bookId, [targetId, sourceId]))
      .orderBy(asc(schema.bookFiles.id))
      .for('update');
    const targetFiles = files.filter((file) => file.bookId === targetId),
      sourceFiles = files.filter((file) => file.bookId === sourceId);
    const txt = targetFiles.find((file) => file.id === targets[0]!.id),
      epub = sourceFiles[0];
    if (
      !txt ||
      targetFiles.length !== 1 ||
      sourceFiles.length !== 1 ||
      !epub ||
      epub.id !== initialFile.id ||
      epub.format !== 'epub' ||
      epub.role !== 'content' ||
      convertedEpubPath(txt.absolutePath) !== epub.absolutePath ||
      target.folderPath !== txt.absolutePath ||
      source.folderPath !== epub.absolutePath
    )
      throw new ConflictException('Edition ownership changed or the pair is ambiguous');
    const metadata = await tx
      .select({ bookId: schema.bookMetadata.bookId, title: schema.bookMetadata.title })
      .from(schema.bookMetadata)
      .where(inArray(schema.bookMetadata.bookId, [targetId, sourceId]))
      .for('update');
    const titles = metadata.map((row) => row.title?.normalize('NFKC').trim());
    if (titles.length !== 2 || !titles[0] || titles[0] !== titles[1])
      throw new ConflictException('The editions have different titles; manual review is required');
    const conflicts = await tx.execute<{ conflict: boolean }>(
      sql`SELECT EXISTS(SELECT 1 FROM user_book_status a JOIN user_book_status b ON a.user_id=b.user_id WHERE a.book_id=${targetId} AND b.book_id=${sourceId}) OR EXISTS(SELECT 1 FROM reading_attempts a JOIN reading_attempts b ON a.user_id=b.user_id WHERE a.book_id=${targetId} AND b.book_id=${sourceId} AND a.outcome IS NULL AND b.outcome IS NULL AND a.deleted_at IS NULL AND b.deleted_at IS NULL) AS conflict`,
    );
    if (conflicts.rows[0]?.conflict) throw new ConflictException('Both editions have overlapping reading states; manual review is required');
    const refs = await tx.execute<{ table_name: string; column_name: string }>(
      sql`SELECT DISTINCT r.relname AS table_name,s.attname AS column_name FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=r.relnamespace CROSS JOIN LATERAL unnest(c.conkey,c.confkey) AS k(src,dst) JOIN pg_attribute s ON s.attrelid=r.oid AND s.attnum=k.src JOIN pg_attribute d ON d.attrelid=c.confrelid AND d.attnum=k.dst WHERE c.contype='f' AND ns.nspname='public' AND c.confrelid='books'::regclass AND d.attname='id'`,
    );
    if (
      refs.rows.length > 100 ||
      [...MOVED_RECORDS].some((table) => !refs.rows.some((ref) => ref.table_name === table && ref.column_name === 'book_id'))
    )
      throw new ConflictException('Unexpected book relationships require review');
    for (const ref of refs.rows) {
      if (ref.column_name === 'book_id' && (DISCARDED_METADATA.has(ref.table_name) || MOVED_RECORDS.has(ref.table_name))) continue;
      if (!/^[a-z_]+$/.test(ref.table_name) || !/^[a-z_]+$/.test(ref.column_name)) throw new ConflictException('Unexpected book relationship');
      const related = await tx.execute<{ present: boolean }>(
        sql`SELECT EXISTS(SELECT 1 FROM ${sql.identifier(ref.table_name)} WHERE ${sql.identifier(ref.column_name)}=${sourceId}) AS present`,
      );
      if (related.rows[0]?.present) throw new ConflictException('This edition has additional linked records; manual review is required');
    }
    await tx
      .update(schema.bookFiles)
      .set({ bookId: targetId, updatedAt: sql`${schema.bookFiles.updatedAt}` })
      .where(eq(schema.bookFiles.id, epub.id));
    await tx
      .update(schema.readingAttempts)
      .set({ bookId: targetId, updatedAt: sql`${schema.readingAttempts.updatedAt}` })
      .where(eq(schema.readingAttempts.bookId, sourceId));
    await tx.update(schema.readingSessions).set({ bookId: targetId }).where(eq(schema.readingSessions.bookId, sourceId));
    await tx
      .update(schema.userBookStatus)
      .set({ bookId: targetId, updatedAt: sql`${schema.userBookStatus.updatedAt}` })
      .where(eq(schema.userBookStatus.bookId, sourceId));
    await deleteBooksWithHashInvalidation(tx, eq(schema.books.id, sourceId));
    return { bookId: targetId, fileId: epub.id, removedDuplicateBookId: sourceId };
  });
}
