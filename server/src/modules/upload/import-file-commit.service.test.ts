import { describe, expect, it, vi } from 'vitest';
import { FileLockService, bookOperationLockKey } from '../../common/services/file-lock.service';
import type { RequestUser } from '../../common/types/request-user';
import { ImportFileCommitService } from './import-file-commit.service';

it('serializes confirmed replacements with the same book merge and rename lock', async () => {
  const locks = new FileLockService();
  const service = new ImportFileCommitService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, locks);
  const commit = vi.fn().mockResolvedValue({ bookId: 42 });
  Reflect.set(service, 'replaceLocked', commit);
  let release!: () => void;
  const holder = locks.withLock(bookOperationLockKey(42), () => new Promise<void>((resolve) => (release = resolve)));
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const input = { bookId: 42, fileId: 7, expectedSha256: 'a'.repeat(64), incoming: '/staged', format: 'epub' };
  const user = { id: 1 } as RequestUser;
  const replacing = service.replace(input, user);
  await Promise.resolve();
  expect(commit).not.toHaveBeenCalled();
  release();
  await holder;
  await expect(replacing).resolves.toEqual({ bookId: 42 });
  expect(commit).toHaveBeenCalledExactlyOnceWith(input, user);
  expect(locks.isLocked(bookOperationLockKey(42))).toBe(false);
});

describe('failed confirmed replacements', () => {
  it('releases the book lock when validation or publication fails', async () => {
    const locks = new FileLockService();
    const service = new ImportFileCommitService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, locks);
    Reflect.set(service, 'replaceLocked', vi.fn().mockRejectedValue(new Error('Changed file')));
    await expect(
      service.replace({ bookId: 42, fileId: 7, expectedSha256: 'a'.repeat(64), incoming: '/staged', format: 'epub' }, { id: 1 } as RequestUser),
    ).rejects.toThrow('Changed file');
    expect(locks.isLocked(bookOperationLockKey(42))).toBe(false);
  });
});
