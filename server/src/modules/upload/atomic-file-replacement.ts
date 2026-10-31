import { ConflictException } from '@nestjs/common';
import { constants } from 'node:fs';
import { copyFile, link, lstat, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fullFileSha256 } from '../import-review/import-match.utils';

export class ReplacementRecoveryRequiredError extends Error {
  constructor(readonly recoveryPath: string) {
    super('File replacement failed; the original was retained for administrator recovery');
  }
}
export async function atomicFileReplacement<T>(
  incoming: string,
  target: string,
  expectedSha256: string,
  transaction: (publish: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const prefix = join(dirname(target), `.${basename(target)}.bookorbit-${randomUUID()}`);
  const staged = `${prefix}.new`;
  const original = `${prefix}.original`;
  let linked = false;
  let published = false;
  let retainOriginal = false;
  let nextHash: string | null = null;
  try {
    await copyFile(incoming, staged, constants.COPYFILE_EXCL);
    nextHash = await fullFileSha256(staged);
    const result = await transaction(async () => {
      const before = await lstat(target);
      if (!before.isFile() || before.isSymbolicLink()) throw new ConflictException('The replacement target is not a regular file');
      await link(target, original);
      linked = true;
      const saved = await lstat(original);
      const current = await lstat(target);
      if (
        !saved.isFile() ||
        saved.isSymbolicLink() ||
        saved.ino !== current.ino ||
        saved.dev !== current.dev ||
        (await fullFileSha256(original)) !== expectedSha256
      )
        throw new ConflictException('The library file changed; review the current version before replacing it');
      await rename(staged, target);
      published = true;
    });
    return result;
  } catch (error) {
    if (published) {
      const currentHash = await fullFileSha256(target).catch(() => null);
      if (currentHash !== nextHash) {
        retainOriginal = true;
        throw new ReplacementRecoveryRequiredError(original);
      }
      try {
        await rename(original, target);
        linked = false;
      } catch {
        retainOriginal = true;
        throw new ReplacementRecoveryRequiredError(original);
      }
    }
    throw error;
  } finally {
    await unlink(staged).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (linked && !retainOriginal) await unlink(original);
  }
}
