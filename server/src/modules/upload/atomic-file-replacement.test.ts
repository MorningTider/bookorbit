import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicFileReplacement, ReplacementRecoveryRequiredError } from './atomic-file-replacement';
import { fullFileSha256 } from '../import-review/import-match.utils';
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bookorbit-replacement-'));
  roots.push(root);
  const target = join(root, 'book.epub');
  const incoming = join(root, 'incoming.epub');
  await writeFile(target, 'original library content');
  await writeFile(incoming, 'new edition content');
  return { root, target, incoming, expected: await fullFileSha256(target) };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('atomic file replacement', () => {
  it('publishes before the transaction mutation and removes temporary originals only after commit', async () => {
    const f = await fixture();
    const result = await atomicFileReplacement(f.incoming, f.target, f.expected, async (publish) => {
      await publish();
      expect(await readFile(f.target, 'utf8')).toBe('new edition content');
      expect((await readdir(f.root)).some((name) => name.endsWith('.original'))).toBe(true);
      return 7;
    });
    expect(result).toBe(7);
    expect((await readdir(f.root)).sort()).toEqual(['book.epub', 'incoming.epub']);
  });
  it('restores original bytes when a database commit fails after publication', async () => {
    const f = await fixture();
    await expect(
      atomicFileReplacement(f.incoming, f.target, f.expected, async (publish) => {
        await publish();
        throw new Error('commit failed');
      }),
    ).rejects.toThrow('commit failed');
    expect(await fullFileSha256(f.target)).toBe(f.expected);
    expect((await readdir(f.root)).sort()).toEqual(['book.epub', 'incoming.epub']);
  });
  it('rejects stale confirmation without changing the new library version', async () => {
    const f = await fixture();
    await writeFile(f.target, 'changed after user review');
    await expect(atomicFileReplacement(f.incoming, f.target, f.expected, (publish) => publish())).rejects.toThrow('changed');
    expect(await readFile(f.target, 'utf8')).toBe('changed after user review');
  });
  it('does not overwrite an external edit made after publication when rolling back', async () => {
    const f = await fixture();
    await expect(
      atomicFileReplacement(f.incoming, f.target, f.expected, async (publish) => {
        await publish();
        await writeFile(f.target, 'external edit');
        throw new Error('commit failed');
      }),
    ).rejects.toBeInstanceOf(ReplacementRecoveryRequiredError);
    expect(await readFile(f.target, 'utf8')).toBe('external edit');
    const saved = (await readdir(f.root)).find((name) => name.endsWith('.original'))!;
    expect(await fullFileSha256(join(f.root, saved))).toBe(f.expected);
  });
  it('refuses symlink targets', async () => {
    const f = await fixture();
    const symbolic = join(f.root, 'linked.epub');
    await symlink(f.target, symbolic);
    await expect(atomicFileReplacement(f.incoming, symbolic, f.expected, (publish) => publish())).rejects.toThrow('regular');
    expect(await fullFileSha256(f.target)).toBe(f.expected);
  });
});
