import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFileHash } from '../../common/utils/file-hash.utils';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_IMPORT_DUPLICATE_POLICY } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { ImportReviewService, ImportReviewRequiredException } from './import-review.service';
const user = { id: 7, isSuperuser: false } as RequestUser;
function fixture() {
  const policy = { forLibrary: vi.fn().mockResolvedValue({ effective: { ...DEFAULT_IMPORT_DUPLICATE_POLICY } }) };
  const repository = {
    findCandidates: vi.fn().mockResolvedValue({
      rows: [{ bookId: 12, libraryId: 3, libraryName: 'Ebooks', title: '猎罪神探', isbn10: null, isbn13: null, primaryFormat: 'epub' }],
      authors: [{ bookId: 12, name: '道门老九' }],
      files: [{ id: 30, bookId: 12, absolutePath: '/books/novel.epub', format: 'epub', sizeBytes: 123, updatedAt: new Date() }],
      origins: [{ bookId: 12, provider: 'fanqie', providerBookId: '123', originalTitle: '原书名', originalAuthors: ['原作者'] }],
    }),
  };
  const libraries = { findAccessibleLibraryIds: vi.fn().mockResolvedValue([3, 4]), findEditableLibraryIds: vi.fn().mockResolvedValue([3]) };
  const service = new ImportReviewService(
    policy as never,
    repository as never,
    libraries as never,
    {} as never,
    {} as never,
    { getOrThrow: () => '/tmp' } as never,
  );
  return { service, policy, repository, libraries };
}
describe('duplicate import matching', () => {
  it('marks title and author matches as possible rather than proof of identity', async () => {
    const { service, repository, libraries } = fixture();
    const result = await service.checkCandidates(3, [{ key: 'book', identity: { title: ' 猎罪神探 ', authors: ['道门老九'], format: 'txt' } }], user);
    expect(result[0].matches[0]).toMatchObject({ bookId: 12, exact: false, reasons: ['title_author'] });
    expect(repository.findCandidates).toHaveBeenCalledWith(expect.anything(), [3], expect.anything(), user, undefined);
    expect(libraries.findAccessibleLibraryIds).not.toHaveBeenCalled();
  });
  it('retains source identity even after scraped title and author change', async () => {
    const { service } = fixture();
    const [matches] = await service.matches(
      3,
      [{ title: 'Changed', authors: ['Changed'], format: 'epub', origin: { provider: 'fanqie', id: '123' } }],
      user,
    );
    expect(matches[0]).toMatchObject({ exact: true, reasons: ['source_identity'] });
  });
  it('does not confuse an audiobook or a different author with the ebook', async () => {
    const { service } = fixture();
    expect(
      await service.matches(
        3,
        [
          { title: '猎罪神探', authors: ['不同作者'], format: 'epub' },
          { title: '猎罪神探', authors: ['道门老九'], format: 'm4b', origin: { provider: 'fanqie', id: '123' } },
        ],
        user,
      ),
    ).toEqual([[], []]);
  });
  it('passes only accessible libraries when cross-library checks are enabled', async () => {
    const { service, policy, repository } = fixture();
    policy.forLibrary.mockResolvedValue({ effective: { ...DEFAULT_IMPORT_DUPLICATE_POLICY, acrossLibraries: true } });
    await service.matches(3, [{ title: '猎罪神探' }], user);
    expect(repository.findCandidates).toHaveBeenCalledWith(expect.anything(), [3, 4], expect.anything(), user, undefined);
  });
  it('compares full content when KOReader partial fingerprints collide', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bookorbit-import-hash-'));
    try {
      const incoming = join(root, 'incoming.epub');
      const existing = join(root, 'existing.epub');
      const content = Buffer.alloc(6000, 65);
      await writeFile(incoming, content);
      content[3000] = 66;
      await writeFile(existing, content);
      const hash = await computeFileHash(incoming);
      expect(await computeFileHash(existing)).toBe(hash);
      const { service, policy, repository } = fixture();
      policy.forLibrary.mockResolvedValue({
        effective: { ...DEFAULT_IMPORT_DUPLICATE_POLICY, sourceIdentity: false, isbn: false, titleAndAuthor: false },
      });
      const found = await repository.findCandidates();
      found.files[0] = { ...found.files[0], absolutePath: existing, fileHash: hash, sizeBytes: content.length } as never;
      Object.assign(repository, { file: vi.fn().mockResolvedValue({ root }) });
      Object.assign(service, { paths: { assertWithinRoot: vi.fn() } });
      expect(await service.matches(3, [{ format: 'epub' }], user, { path: incoming, size: content.length })).toEqual([[]]);
      content[3000] = 65;
      await writeFile(existing, content);
      expect((await service.matches(3, [{ format: 'epub' }], user, { path: incoming, size: content.length }))[0][0]).toMatchObject({
        exact: true,
        reasons: ['content_hash'],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('provides a review identifier through the standard scalar error metadata', () => {
    const review = { id: 'review-1' };
    const error = new ImportReviewRequiredException(review as never);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ errorCode: 'IMPORT_REVIEW_REQUIRED', errorMeta: { reviewId: 'review-1' } });
    expect(error.getResponse()).not.toHaveProperty('review');
  });
});
