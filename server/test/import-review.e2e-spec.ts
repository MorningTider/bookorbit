import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createE2EContext, closeE2EContext, seedLibrary, type E2EContext } from './e2e/app-harness';
import { AuthService } from '../src/modules/auth/auth.service';
import { UploadService } from '../src/modules/upload/upload.service';
import { ImportReviewRequiredException } from '../src/modules/import-review/import-review.service';
import { fullFileSha256 } from '../src/modules/import-review/import-match.utils';
import * as schema from '../src/db/schema';
import type { RequestUser } from '../src/common/types/request-user';

describe('duplicate import decisions on PostgreSQL', { timeout: 120000 }, () => {
  let ctx: E2EContext;
  let root: string;
  let user: RequestUser;
  const libraryIds: number[] = [];
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/bookorbit_e2e')
      throw new Error('Dedicated local E2E database required');
    root = await mkdtemp(join(tmpdir(), 'bookorbit-import-e2e-'));
    ctx = await createE2EContext({ isolateAppData: true, multipart: true });
    const [admin] = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, 'scanner-e2e-admin'));
    user = (await ctx.app.get(AuthService).findActingUser(admin.id))!;
  });
  afterAll(async () => {
    if (ctx) {
      for (const id of libraryIds) await ctx.db.delete(schema.libraries).where(eq(schema.libraries.id, id));
      await closeE2EContext(ctx);
    }
    if (root) await rm(root, { recursive: true, force: true });
  });
  for (const mode of ['book_per_file', 'book_per_folder'] as const) {
    it(`${mode}: preserves book, metadata and reading identities when replacing, attaching and creating`, async () => {
      const folder = join(root, mode);
      await mkdir(folder);
      const { libraryId, libraryFolderId } = await seedLibrary(ctx.db, { rootPath: folder, mode, allowedFormats: ['txt'] });
      libraryIds.push(libraryId);
      const upload = ctx.app.get(UploadService);
      const origin = { provider: 'fanqie', id: `source-${mode}` };
      const original = await upload.upload(libraryId, libraryFolderId, 'book.txt', Readable.from(['Original readable content']), user, { origin });
      const [file] = await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, original.bookId));
      await ctx.db
        .insert(schema.bookMetadata)
        .values({ bookId: original.bookId, title: 'Preserved title', description: 'Preserved description' })
        .onConflictDoUpdate({ target: schema.bookMetadata.bookId, set: { title: 'Preserved title', description: 'Preserved description' } });
      await ctx.db.insert(schema.userBookStatus).values({ userId: user.id, bookId: original.bookId, status: 'reading', source: 'manual' });
      await ctx.db.insert(schema.readingProgress).values({ userId: user.id, bookFileId: file.id, percentage: 37, pageNumber: 4 });
      const [metadataBefore] = await ctx.db.select().from(schema.bookMetadata).where(eq(schema.bookMetadata.bookId, original.bookId));
      const [progressBefore] = await ctx.db.select().from(schema.readingProgress).where(eq(schema.readingProgress.bookFileId, file.id));
      const [statusBefore] = await ctx.db.select().from(schema.userBookStatus).where(eq(schema.userBookStatus.bookId, original.bookId));
      async function stage(text: string) {
        try {
          await upload.upload(libraryId, libraryFolderId, 'book.txt', Readable.from([text]), user, { origin });
        } catch (error) {
          if (error instanceof ImportReviewRequiredException) return error.review.id;
          throw error;
        }
        throw new Error('Expected duplicate review before publication');
      }
      const headers = { authorization: `Bearer ${ctx.adminToken}` };
      const reviewId = await stage('Replacement readable content');
      expect(await readFile(file.absolutePath, 'utf8')).toBe('Original readable content');
      const expectedSha256 = await fullFileSha256(file.absolutePath);
      const replaced = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/imports/reviews/${reviewId}/resolve`,
        headers,
        payload: { action: 'replace', bookId: original.bookId, fileId: file.id, expectedSha256 },
      });
      expect(replaced.statusCode, replaced.body).toBe(201);
      expect(replaced.json().bookId).toBe(original.bookId);
      expect(await readFile(file.absolutePath, 'utf8')).toBe('Replacement readable content');
      expect(await ctx.db.select().from(schema.bookFileHashHistory).where(eq(schema.bookFileHashHistory.bookFileId, file.id))).toEqual(
        expect.arrayContaining([expect.objectContaining({ fileHash: file.fileHash, reason: 'file_write' })]),
      );
      expect((await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, original.bookId))).map((row) => row.id)).toEqual([
        file.id,
      ]);
      expect((await ctx.db.select().from(schema.bookMetadata).where(eq(schema.bookMetadata.bookId, original.bookId)))[0]).toEqual(metadataBefore);
      expect((await ctx.db.select().from(schema.readingProgress).where(eq(schema.readingProgress.bookFileId, file.id)))[0]).toEqual(progressBefore);
      expect((await ctx.db.select().from(schema.userBookStatus).where(eq(schema.userBookStatus.bookId, original.bookId)))[0]).toEqual(statusBefore);
      const repeated = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/imports/reviews/${reviewId}/resolve`,
        headers,
        payload: { action: 'replace', bookId: original.bookId, fileId: file.id, expectedSha256 },
      });
      expect(repeated.statusCode, repeated.body).toBe(201);
      const attachedReview = await stage('Additional edition readable content');
      const attached = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/imports/reviews/${attachedReview}/resolve`,
        headers,
        payload: { action: 'attach', bookId: original.bookId },
      });
      expect(attached.statusCode, attached.body).toBe(201);
      expect(attached.json().bookId).toBe(original.bookId);
      expect(await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, original.bookId))).toHaveLength(2);
      const newReview = await stage('Independent edition readable content');
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/imports/reviews/${newReview}/resolve`,
        headers,
        payload: { action: 'new' },
      });
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json().bookId).not.toBe(original.bookId);
      expect(await ctx.db.select().from(schema.books).where(eq(schema.books.libraryId, libraryId))).toHaveLength(2);
      expect((await ctx.db.select().from(schema.bookMetadata).where(eq(schema.bookMetadata.bookId, original.bookId)))[0]).toEqual(metadataBefore);
    });
  }
  for (const grouped of [false, true]) {
    it(`batch dock import preserves metadata and records for ${grouped ? 'a grouped unit' : 'a single file'}`, async () => {
      const folder = join(root, grouped ? 'dock-grouped-library' : 'dock-single-library');
      await mkdir(folder);
      const { libraryId, libraryFolderId } = await seedLibrary(ctx.db, { rootPath: folder, mode: 'book_per_folder', allowedFormats: ['txt'] });
      libraryIds.push(libraryId);
      const title = grouped ? 'Grouped existing book' : 'Single existing book';
      const upload = ctx.app.get(UploadService);
      const original = await upload.upload(libraryId, libraryFolderId, 'book.txt', Readable.from(['Original preserved book bytes']), user);
      const [file] = await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, original.bookId));
      await ctx.db
        .insert(schema.bookMetadata)
        .values({ bookId: original.bookId, title, description: 'Keep this metadata' })
        .onConflictDoUpdate({ target: schema.bookMetadata.bookId, set: { title, description: 'Keep this metadata' } });
      const [author] = await ctx.db
        .insert(schema.authors)
        .values({ name: title + ' author ' + randomUUID() })
        .returning();
      await ctx.db.insert(schema.bookAuthors).values({ bookId: original.bookId, authorId: author.id });
      await ctx.db.insert(schema.readingProgress).values({ userId: user.id, bookFileId: file.id, percentage: 42, pageNumber: 7 });
      const [before] = await ctx.db.select().from(schema.bookMetadata).where(eq(schema.bookMetadata.bookId, original.bookId));
      const source = join(root, grouped ? 'incoming-group' : 'incoming-single');
      await mkdir(source);
      const primary = join(source, 'book.txt');
      await writeFile(primary, 'Incoming different book bytes');
      const [dock] = await ctx.db
        .insert(schema.bookDockFiles)
        .values({
          fileName: 'book.txt',
          absolutePath: primary,
          format: 'txt',
          fileSize: 29,
          unitDirectory: grouped ? source : null,
          status: 'ready',
          uploadedBy: user.id,
          autoFinalizeSuppressed: true,
          targetLibraryId: libraryId,
          targetFolderId: libraryFolderId,
          selectedMetadata: { title, authors: [author.name] },
        })
        .returning();
      if (grouped) {
        const second = join(source, 'part-2.txt');
        await writeFile(second, 'Second part content');
        await ctx.db.insert(schema.bookDockUnitFiles).values([
          { dockFileId: dock.id, fileName: 'book.txt', absolutePath: primary, format: 'txt', role: 'content', sortOrder: 0 },
          { dockFileId: dock.id, fileName: 'part-2.txt', absolutePath: second, format: 'txt', role: 'content', sortOrder: 1 },
        ]);
      }
      const headers = { authorization: `Bearer ${ctx.adminToken}` };
      const preview = await ctx.app.inject({ method: 'POST', url: '/api/v1/book-dock/finalize', headers, payload: { fileIds: [dock.id] } });
      expect(preview.statusCode, preview.body).toBe(201);
      expect(preview.json().results[0]).toMatchObject({
        success: false,
        isDuplicate: true,
        importReview: { incomingFileCount: grouped ? 2 : 1, matches: [{ bookId: original.bookId }] },
      });
      expect(await readFile(primary, 'utf8')).toBe('Incoming different book bytes');
      const resolution = grouped
        ? { action: 'replace', bookId: original.bookId, fileId: file.id, expectedSha256: await fullFileSha256(file.absolutePath) }
        : { action: 'attach', bookId: original.bookId };
      const resolved = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/book-dock/finalize',
        headers,
        payload: { fileIds: [dock.id], overrides: [{ fileId: dock.id, importResolution: resolution }] },
      });
      expect(resolved.statusCode, resolved.body).toBe(201);
      expect(resolved.json().results[0]).toMatchObject({ success: true, bookId: original.bookId });
      expect((await ctx.db.select().from(schema.bookMetadata).where(eq(schema.bookMetadata.bookId, original.bookId)))[0]).toEqual(before);
      expect(await ctx.db.select().from(schema.books).where(eq(schema.books.libraryId, libraryId))).toHaveLength(1);
      expect(await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, original.bookId))).toHaveLength(2);
      expect((await ctx.db.select().from(schema.readingProgress).where(eq(schema.readingProgress.bookFileId, file.id)))[0]).toMatchObject({
        percentage: 42,
        pageNumber: 7,
      });
      expect(await ctx.db.select().from(schema.bookDockFiles).where(eq(schema.bookDockFiles.id, dock.id))).toHaveLength(0);
    });
  }
  it('returns an owner-scoped review through the real multipart HTTP error contract', async () => {
    const folder = join(root, 'http-upload-library');
    await mkdir(folder);
    const { libraryId, libraryFolderId } = await seedLibrary(ctx.db, { rootPath: folder, mode: 'book_per_file', allowedFormats: ['txt'] });
    libraryIds.push(libraryId);
    const text = 'Same whole file content for duplicate review';
    const original = await ctx.app.get(UploadService).upload(libraryId, libraryFolderId, 'original.txt', Readable.from([text]), user);
    const boundary = 'bookorbit-import-' + randomUUID();
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="another-name.txt"\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--${boundary}--\r\n`,
    );
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/libraries/${libraryId}/upload?folderId=${libraryFolderId}`,
      headers: { authorization: `Bearer ${ctx.adminToken}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ errorCode: 'IMPORT_REVIEW_REQUIRED', errorMeta: { reviewId: expect.any(String) } });
    expect(response.body).not.toContain(root);
    const id = response.json().errorMeta.reviewId;
    const review = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/imports/reviews/${id}`,
      headers: { authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(review.statusCode, review.body).toBe(200);
    expect(review.json().matches[0]).toMatchObject({ bookId: original.bookId, exact: true, reasons: ['content_hash'] });
    const discarded = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/imports/reviews/${id}`,
      headers: { authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(discarded.statusCode, discarded.body).toBe(200);
    expect(await ctx.db.select().from(schema.books).where(eq(schema.books.libraryId, libraryId))).toHaveLength(1);
  });
  it('keeps matching and file selection paginated for a book with 2614 audio tracks', async () => {
    const folder = join(root, 'large-audio-library');
    await mkdir(folder);
    const { libraryId, libraryFolderId } = await seedLibrary(ctx.db, { rootPath: folder, mode: 'book_per_folder', allowedFormats: ['txt', 'm4a'] });
    libraryIds.push(libraryId);
    const origin = { provider: 'fanqie', id: 'large-audio-scale-fixture' };
    const original = await ctx.app
      .get(UploadService)
      .upload(libraryId, libraryFolderId, 'metadata.txt', Readable.from(['Scale test metadata']), user, { origin });
    let firstTrackId: number | undefined;
    for (let offset = 0; offset < 2614; offset += 500) {
      const rows = await ctx.db
        .insert(schema.bookFiles)
        .values(
          Array.from({ length: Math.min(500, 2614 - offset) }, (_, index) => ({
            bookId: original.bookId,
            libraryFolderId,
            absolutePath: join(folder, `track-${offset + index}.m4a`),
            relPath: `track-${offset + index}.m4a`,
            ino: BigInt(100000 + offset + index),
            sizeBytes: 100,
            format: 'm4a',
            role: 'content',
            sortOrder: offset + index,
          })),
        )
        .returning({ id: schema.bookFiles.id });
      firstTrackId ??= rows[0].id;
    }
    await ctx.db.update(schema.books).set({ primaryFileId: firstTrackId }).where(eq(schema.books.id, original.bookId));
    const headers = { authorization: `Bearer ${ctx.adminToken}` };
    const check = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/imports/check',
      headers,
      payload: { libraryId, candidates: [{ key: 'large', identity: { origin, format: 'm4a' } }] },
    });
    expect(check.statusCode, check.body).toBe(201);
    expect(check.json()[0].matches[0]).toMatchObject({ bookId: original.bookId, exact: true });
    expect(check.json()[0].matches[0].files).toHaveLength(50);
    const first = await ctx.app.inject({ method: 'GET', url: `/api/v1/imports/books/${original.bookId}/files?format=m4a`, headers });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().items).toHaveLength(50);
    expect(first.json().nextCursor).toBeTypeOf('number');
    const second = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/imports/books/${original.bookId}/files?format=m4a&cursor=${first.json().nextCursor}`,
      headers,
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().items).toHaveLength(50);
    expect(second.json().items.every((file: { id: number }) => file.id > first.json().nextCursor)).toBe(true);
  });
  it('offers replacement for changed plain TXT content even without author or ISBN', async () => {
    const folder = join(root, 'plain-text-collision-library');
    await mkdir(folder);
    const { libraryId, libraryFolderId } = await seedLibrary(ctx.db, { rootPath: folder, mode: 'book_per_file', allowedFormats: ['txt'] });
    libraryIds.push(libraryId);
    const original = await ctx.app.get(UploadService).upload(libraryId, libraryFolderId, 'plain.txt', Readable.from(['Original plain text']), user);
    const [file] = await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, original.bookId));
    const boundary = 'bookorbit-plain-' + randomUUID();
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="plain.txt"\r\nContent-Type: text/plain\r\n\r\nChanged plain text\r\n--${boundary}--\r\n`,
    );
    const headers = { authorization: `Bearer ${ctx.adminToken}` };
    const incoming = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/libraries/${libraryId}/upload?folderId=${libraryFolderId}`,
      headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(incoming.statusCode, incoming.body).toBe(409);
    const id = incoming.json().errorMeta.reviewId;
    const review = await ctx.app.inject({ method: 'GET', url: `/api/v1/imports/reviews/${id}`, headers });
    expect(review.statusCode, review.body).toBe(200);
    expect(review.json().matches[0]).toMatchObject({ bookId: original.bookId, exact: false, reasons: ['destination_path'] });
    expect(await readFile(file.absolutePath, 'utf8')).toBe('Original plain text');
    const replaced = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/imports/reviews/${id}/resolve`,
      headers,
      payload: { action: 'replace', bookId: original.bookId, fileId: file.id, expectedSha256: await fullFileSha256(file.absolutePath) },
    });
    expect(replaced.statusCode, replaced.body).toBe(201);
    expect(replaced.json().bookId).toBe(original.bookId);
    expect(await readFile(file.absolutePath, 'utf8')).toBe('Changed plain text');
    expect(await ctx.db.select().from(schema.books).where(eq(schema.books.libraryId, libraryId))).toHaveLength(1);
  });
});
