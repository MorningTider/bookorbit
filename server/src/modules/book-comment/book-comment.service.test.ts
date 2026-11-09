import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { BookCommentService } from './book-comment.service';
import { BookCommentQueryDto, CreateBookCommentDto } from './dto/book-comment.dto';

const user = (id: number, permissions: Permission[] = []) => ({ id, name: `Reader ${id}`, permissions, isSuperuser: false }) as RequestUser;
const url = process.env.BOOKORBIT_COMMENT_TEST_URL;

describe('comment boundary validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  it('rejects unknown fields, oversized bodies and invalid target scopes', async () => {
    for (const body of [
      { body: 'hello', clientId: randomUUID(), userId: 999 },
      { body: 'x'.repeat(5001), clientId: randomUUID() },
      { body: 'hello', clientId: randomUUID(), scope: 'private' },
    ]) {
      await expect(pipe.transform(body, { type: 'body', metatype: CreateBookCommentDto })).rejects.toThrow(BadRequestException);
    }
  });
  it('bounds cursor pagination', async () => {
    for (const query of [{ limit: '51' }, { before: '0' }, { bookFileId: '-1' }]) {
      await expect(pipe.transform(query, { type: 'query', metatype: BookCommentQueryDto })).rejects.toThrow(BadRequestException);
    }
    expect(await pipe.transform({ before: '21', limit: '10' }, { type: 'query', metatype: BookCommentQueryDto })).toMatchObject({
      before: 21,
      limit: 10,
    });
  });
});

describe.runIf(!!url)('comments on an isolated PostgreSQL instance', () => {
  let pool: Pool;
  let service: BookCommentService;
  const books = { verifyBookAccess: vi.fn(), verifyFileAccess: vi.fn() };
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/bookorbit_comments_test') throw new Error('Isolated comment test database required');
    pool = new Pool({ connectionString: url });
    const module = await Test.createTestingModule({
      providers: [BookCommentService, { provide: DB, useValue: drizzle(pool, { schema }) }, { provide: BookService, useValue: books }],
    }).compile();
    service = module.get(BookCommentService);
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE book_comments, users, books, book_files RESTART IDENTITY CASCADE');
    await pool.query(
      "INSERT INTO users VALUES (1,'Reader 1'),(2,'Reader 2'),(3,'Moderator'); INSERT INTO books VALUES (1),(2); INSERT INTO book_files VALUES (11),(12)",
    );
    books.verifyBookAccess.mockReset().mockResolvedValue(undefined);
    books.verifyFileAccess.mockReset().mockImplementation((id: number) => Promise.resolve({ bookId: id === 11 ? 1 : 2 }));
  });
  const review = (body = 'A review') => ({ clientId: randomUUID(), body });
  it('shares reviews with other authorised server users', async () => {
    const row = await service.create(1, user(1), review());
    const page = await service.list(1, user(2), {});
    expect(page.items).toEqual([expect.objectContaining({ id: row.id, userId: 1, authorName: 'Reader 1', canDelete: false })]);
  });
  it('checks book access before reading, writing or deleting', async () => {
    books.verifyBookAccess.mockRejectedValue(new ForbiddenException());
    await expect(service.list(1, user(2), {})).rejects.toThrow(ForbiddenException);
    await expect(service.create(1, user(2), review())).rejects.toThrow(ForbiddenException);
    await expect(service.remove(1, 1, user(2))).rejects.toThrow(ForbiddenException);
    expect((await pool.query('SELECT count(*)::int AS n FROM book_comments')).rows[0].n).toBe(0);
  });
  it('makes concurrent duplicate submissions idempotent', async () => {
    const dto = review();
    const rows = await Promise.all([service.create(1, user(1), dto), service.create(1, user(1), dto)]);
    expect(rows[0].id).toBe(rows[1].id);
    await expect(service.create(1, user(1), { ...dto, body: 'Changed body' })).rejects.toThrow(ConflictException);
    await expect(service.create(2, user(1), dto)).rejects.toThrow(ConflictException);
  });
  it('supports replies to replies and preserves the root target', async () => {
    const root = await service.create(1, user(1), {
      ...review(),
      scope: 'chapter',
      bookFileId: 11,
      chapterHref: 'chapter.xhtml',
      chapterTitle: 'Chapter one',
    });
    const reply = await service.create(1, user(2), { ...review('Reply'), parentId: root.id, scope: 'review' });
    const nested = await service.create(1, user(1), { ...review('Reply again'), parentId: reply.id });
    expect(nested).toMatchObject({ parentId: reply.id, threadId: root.id, bookFileId: 11, scope: 'chapter', chapterTitle: 'Chapter one' });
    expect((await service.list(1, user(2), { threadId: root.id })).items.map((row) => row.id)).toEqual([nested.id, reply.id]);
    expect((await service.list(1, user(2), {})).items).toHaveLength(1);
  });
  it('rejects files and parent comments from another book', async () => {
    const root = await service.create(2, user(1), review());
    await expect(service.create(1, user(2), { ...review(), parentId: root.id })).rejects.toThrow();
    await expect(service.create(1, user(2), { ...review(), scope: 'chapter', bookFileId: 12, chapterHref: 'chapter.xhtml' })).rejects.toThrow(
      BadRequestException,
    );
  });
  it('keeps paragraph anchors separate even when the quote text is identical', async () => {
    for (const cfi of ['epubcfi(/6/2!/4/2)', 'epubcfi(/6/4!/4/2)'])
      await service.create(1, user(1), { ...review(), scope: 'paragraph', bookFileId: 11, cfi, quote: 'Same words' });
    const page = await service.list(1, user(2), { scope: 'paragraph', bookFileId: 11, cfi: 'epubcfi(/6/2!/4/2)' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].cfi).toBe('epubcfi(/6/2!/4/2)');
  });
  it('requires complete anchors and a nonempty trimmed body', async () => {
    for (const dto of [
      { ...review(), body: ' ' },
      { ...review(), scope: 'chapter' as const },
      { ...review(), scope: 'paragraph' as const, bookFileId: 11, cfi: 'bad', quote: 'text' },
    ])
      await expect(service.create(1, user(1), dto)).rejects.toThrow(BadRequestException);
    await expect(service.list(1, user(2), { cfi: 'epubcfi(/6/2)' })).rejects.toThrow(BadRequestException);
  });
  it('only lets authors or moderators delete and leaves replies readable', async () => {
    const root = await service.create(1, user(1), review());
    const reply = await service.create(1, user(2), { ...review('Still visible'), parentId: root.id });
    await expect(service.remove(1, root.id, user(2))).rejects.toThrow(ForbiddenException);
    await service.remove(1, root.id, user(1));
    expect((await service.list(1, user(2), {})).items[0]).toMatchObject({ body: '', deleted: true });
    expect((await service.list(1, user(2), { threadId: root.id })).items[0].id).toBe(reply.id);
    await service.remove(1, reply.id, user(3, [Permission.ManageUsers]));
    await expect(service.create(1, user(2), { ...review(), parentId: root.id })).rejects.toThrow(ConflictException);
  });
  it('uses a stable bounded cursor without skipping rows', async () => {
    for (let i = 0; i < 24; i++) await service.create(1, user(1), review(`Review ${i}`));
    const first = await service.list(1, user(2), { limit: 20 });
    const second = await service.list(1, user(2), { before: first.nextCursor!, limit: 20 });
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(4);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(24);
  });
});
