import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '../../db/schema';
const remove = vi.hoisted(() => vi.fn());
vi.mock('../../db/book-file-hash-history', () => ({ deleteBooksWithHashInvalidation: remove }));
import { convertedEpubPath, repairConvertedEdition } from './repair-converted-edition';
function chain(value: unknown): unknown {
  const promise = Promise.resolve(value);
  const proxy = new Proxy({}, { get: (_target, key) => (key === 'then' ? promise.then.bind(promise) : () => proxy) });
  return proxy;
}
function setup(options: { conflict?: boolean; extra?: boolean; title?: string; libraryId?: number } = {}) {
  const txt = { id: 41, bookId: 10, absolutePath: '/library/余罪.txt', format: 'txt', role: 'content' };
  const epub = { id: 42, bookId: 25, absolutePath: '/library/余罪.epub', format: 'epub', role: 'content' };
  const initial: unknown[] = [[txt], [epub]];
  const selects: unknown[] = [
    [
      { id: 10, libraryId: 1, libraryFolderId: 1, folderPath: txt.absolutePath },
      { id: 25, libraryId: options.libraryId ?? 1, libraryFolderId: 1, folderPath: epub.absolutePath },
    ],
    [{ organizationMode: 'book_per_file' }],
    [txt, epub],
    [
      { bookId: 10, title: '余罪' },
      { bookId: 25, title: options.title ?? '余罪' },
    ],
  ];
  const executes = [
    { rows: [{ conflict: options.conflict ?? false }] },
    {
      rows: [
        ...['book_files', 'reading_attempts', 'reading_sessions', 'user_book_status'].map((table_name) => ({ table_name, column_name: 'book_id' })),
        ...(options.extra ? [{ table_name: 'annotations', column_name: 'book_id' }] : []),
      ],
    },
    { rows: [{ present: true }] },
  ];
  const writes: { table: unknown; values: unknown }[] = [];
  const tx = {
    select: vi.fn(() => chain(selects.shift())),
    execute: vi.fn(() => Promise.resolve(executes.shift())),
    update: vi.fn((table: unknown) => ({
      set: (values: unknown) => {
        writes.push({ table, values });
        return { where: () => Promise.resolve() };
      },
    })),
  };
  const db = { select: vi.fn(() => chain(initial.shift())), transaction: vi.fn((work: (value: unknown) => Promise<unknown>) => work(tx)) };
  return { db, tx, writes };
}
beforeEach(() => remove.mockReset().mockResolvedValue(undefined));
describe('converted EPUB repair', () => {
  it('only derives a same-directory EPUB from a TXT identity', () => {
    expect(convertedEpubPath('/library/余罪.txt')).toBe('/library/余罪.epub');
    expect(() => convertedEpubPath('/library/余罪.pdf')).toThrow();
  });
  it('retains the original book and file IDs and moves reading records before removing only the duplicate', async () => {
    const { db, tx, writes } = setup();
    expect(await repairConvertedEdition(db as never, 10, 1)).toEqual({ bookId: 10, fileId: 42, removedDuplicateBookId: 25 });
    expect(writes.map((x) => x.table)).toEqual([schema.bookFiles, schema.readingAttempts, schema.readingSessions, schema.userBookStatus]);
    expect(writes.every((x) => (x.values as { bookId: number }).bookId === 10)).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]?.[0]).toBe(tx);
    expect(new PgDialect().sqlToQuery(remove.mock.calls[0]![1]).params).toEqual([25]);
  });
  it.each([{ conflict: true }, { extra: true }, { title: '其他小说' }, { libraryId: 2 }])(
    'rejects unsafe or conflicting source records before writing: %j',
    async (options) => {
      const { db, writes } = setup(options);
      await expect(repairConvertedEdition(db as never, 10, 1)).rejects.toThrow();
      expect(writes).toEqual([]);
      expect(remove).not.toHaveBeenCalled();
    },
  );
});
