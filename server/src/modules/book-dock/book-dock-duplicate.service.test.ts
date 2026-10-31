import { ConflictException, HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ImportReviewResponse } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { BookDockDuplicateService } from './book-dock-duplicate.service';
const user = { id: 7, active: true, isSuperuser: false } as RequestUser;
const review = { matches: [{ bookId: 12, canEdit: true }] } as ImportReviewResponse;
function setup() {
  const uploads = { addFileToBook: vi.fn().mockResolvedValue({ id: 1 }) };
  const commits = { replace: vi.fn().mockResolvedValue({ bookId: 12 }) };
  const auth = { findActingUser: vi.fn().mockResolvedValue(user) };
  const service = new BookDockDuplicateService(auth as never, {} as never, uploads as never, commits as never);
  return { service, uploads, commits, auth };
}
describe('Book Dock duplicate decisions', () => {
  it('replaces only the primary chosen file, appends remaining content and preserves existing metadata', async () => {
    const { service, uploads, commits } = setup();
    const resolution = { action: 'replace', bookId: 12, fileId: 30, expectedSha256: 'a'.repeat(64) } as const;
    expect(
      await service.importIntoExisting(
        review,
        resolution,
        [
          { sourcePath: '/stage/track-1.mp3', format: 'mp3', role: 'content' },
          { sourcePath: '/stage/cover.jpg', format: 'jpg', role: 'cover' },
          { sourcePath: '/stage/track-2.mp3', format: 'mp3', role: 'content' },
        ],
        user,
      ),
    ).toBe(12);
    expect(commits.replace).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: 12, fileId: 30, expectedSha256: resolution.expectedSha256, incoming: '/stage/track-1.mp3' }),
      user,
    );
    expect(uploads.addFileToBook).toHaveBeenCalledTimes(1);
    expect(uploads.addFileToBook).toHaveBeenCalledWith(12, 'track-2.mp3', expect.anything(), user, { preserveMetadata: true });
    for (const call of uploads.addFileToBook.mock.calls) call[2]?.destroy();
  });
  it('treats a verified identical attached file as already imported, but never hides other failures', async () => {
    const { service, uploads } = setup();
    const file = [{ sourcePath: '/stage/track.mp3', format: 'mp3', role: 'content' }];
    uploads.addFileToBook.mockImplementationOnce((_a, _b, stream) => {
      stream.destroy();
      return Promise.reject(new HttpException({ errorCode: 'UPLOAD_DUPLICATE' }, 409));
    });
    expect(await service.importIntoExisting(review, { action: 'attach', bookId: 12 }, file, user)).toBe(12);
    uploads.addFileToBook.mockImplementationOnce((_a, _b, stream) => {
      stream.destroy();
      return Promise.reject(new ConflictException('permission changed'));
    });
    await expect(service.importIntoExisting(review, { action: 'attach', bookId: 12 }, file, user)).rejects.toThrow('permission changed');
  });
  it('rejects a stale or read-only target before writing any file', async () => {
    const { service, uploads, commits } = setup();
    await expect(
      service.importIntoExisting(
        { matches: [{ bookId: 12, canEdit: false }] } as ImportReviewResponse,
        { action: 'replace', bookId: 12, fileId: 30, expectedSha256: 'a'.repeat(64) },
        [{ sourcePath: '/stage/book.epub', format: 'epub' }],
        user,
      ),
    ).rejects.toThrow();
    expect(uploads.addFileToBook).not.toHaveBeenCalled();
    expect(commits.replace).not.toHaveBeenCalled();
  });
  it('loads the current acting account and rejects inactive accounts', async () => {
    const { service, auth } = setup();
    expect(await service.actor(7, false)).toBe(user);
    auth.findActingUser.mockResolvedValueOnce({ ...user, active: false });
    await expect(service.actor(7, false)).rejects.toThrow('not active');
    await expect(service.actor(0, false)).rejects.toThrow();
  });
});
