import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GithubSourceFile, GithubSourceCandidate } from '@bookorbit/types';
import { safeFetch } from '../../common/utils/safe-fetch';
import { UploadValidatorService } from '../upload/upload-validator.service';
import { GithubSourceClient } from './github-source.client';
import { GithubSourceService, githubJobIdentity } from './github-source.service';
vi.mock('../../common/utils/safe-fetch', () => ({ safeFetch: vi.fn() }));
const content = Buffer.from('%PDF-1.7\nexample original ebook');
const file: GithubSourceFile = {
  repositoryId: 1,
  repository: 'owner/books',
  repositoryLabel: 'Books',
  branch: '',
  rootPath: '',
  path: '测试.pdf',
  commitSha: 'a'.repeat(40),
  blobSha: createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex'),
  format: 'pdf',
  sizeBytes: content.length,
  title: '测试',
  filename: '测试.pdf',
};
describe('GitHub original file acquisition', () => {
  let directory: string;
  let repository: { assertCurrent: ReturnType<typeof vi.fn>; entry: ReturnType<typeof vi.fn> };
  let source: GithubSourceService;
  beforeEach(async () => {
    vi.resetAllMocks();
    directory = await mkdtemp(join(tmpdir(), 'bookorbit-github-test-'));
    repository = { assertCurrent: vi.fn().mockResolvedValue(undefined), entry: vi.fn() };
    source = new GithubSourceService(
      repository as never,
      new GithubSourceClient(),
      new UploadValidatorService(),
      { appDataPath: directory } as never,
      { timeoutMs: 100 } as never,
    );
  });
  afterEach(async () => {
    await source.onModuleDestroy();
    await rm(directory, { recursive: true, force: true });
  });
  it('imports identical original bytes, reports progress and removes its staging folder', async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response(content));
    const progress = vi.fn();
    const useFile = vi.fn(async (path: string) => {
      expect(await readFile(path)).toEqual(content);
      return { bookId: 7 };
    });
    await expect(source.withDownload(file, new AbortController().signal, progress, useFile)).resolves.toEqual({ bookId: 7 });
    expect(repository.assertCurrent).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'validating', downloadedBytes: content.length, totalBytes: content.length }),
    );
    expect(await readdir(join(directory, 'github-source-downloads'))).toEqual([]);
    expect(vi.mocked(safeFetch).mock.calls[0]![0]).toContain(file.commitSha);
  });
  it('rejects a hash mismatch and cleans temporary files', async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response(Buffer.alloc(content.length, 65)));
    const useFile = vi.fn();
    await expect(source.withDownload(file, new AbortController().signal, undefined, useFile)).rejects.toThrow('blob hash');
    expect(useFile).not.toHaveBeenCalled();
    expect(await readdir(join(directory, 'github-source-downloads'))).toEqual([]);
  });
  it('rejects a Git LFS pointer or HTML content masquerading as EPUB', async () => {
    const bytes = Buffer.from('version https://git-lfs.github.com/spec/v1');
    const pointer = {
      ...file,
      format: 'epub' as const,
      sizeBytes: bytes.length,
      blobSha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    };
    vi.mocked(safeFetch).mockResolvedValue(new Response(bytes));
    await expect(source.withDownload(pointer, new AbortController().signal, undefined, vi.fn())).rejects.toThrow('contents');
  });
  it('times out only when the byte stream stops', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(content.subarray(0, 5));
          },
        }),
      ),
    );
    await expect(source.withDownload(file, new AbortController().signal, undefined, vi.fn())).rejects.toThrow('stalled');
    expect(await readdir(join(directory, 'github-source-downloads'))).toEqual([]);
  });
  it('continues when bytes advance for longer than the idle interval', async () => {
    source = new GithubSourceService(
      repository as never,
      new GithubSourceClient(),
      new UploadValidatorService(),
      { appDataPath: directory } as never,
      { timeoutMs: 1000 } as never,
    );
    let position = 0;
    vi.mocked(safeFetch).mockResolvedValue(
      new Response(
        new ReadableStream({
          async pull(controller) {
            await new Promise((resolve) => setTimeout(resolve, 40));
            if (position === content.length) {
              controller.close();
              return;
            }
            controller.enqueue(content.subarray(position, position + 1));
            position = Math.min(content.length, position + 1);
          },
        }),
      ),
    );
    await expect(source.withDownload(file, new AbortController().signal, undefined, async (path) => (await readFile(path)).length)).resolves.toEqual(
      content.length,
    );
  });
  it('supports cancellation and cleans the staged download', async () => {
    const controller = new AbortController();
    vi.mocked(safeFetch).mockImplementation(() => {
      controller.abort();
      return Promise.resolve(new Response(content));
    });
    await expect(source.withDownload(file, controller.signal, undefined, vi.fn())).rejects.toThrow();
    expect(await readdir(join(directory, 'github-source-downloads'))).toEqual([]);
  });
  it('does not contact GitHub after a repository is disabled', async () => {
    repository.assertCurrent.mockRejectedValue(new Error('disabled'));
    await expect(source.withDownload(file, new AbortController().signal, undefined, vi.fn())).rejects.toThrow('disabled');
    expect(safeFetch).not.toHaveBeenCalled();
  });
  it('resolves catalog metadata at its pinned commit before queueing', async () => {
    const candidate: GithubSourceCandidate = { ...file, id: 42, blobSha: null, sizeBytes: null };
    repository.entry.mockResolvedValue(candidate);
    const client = { fileMetadata: vi.fn().mockResolvedValue({ blobSha: file.blobSha, sizeBytes: file.sizeBytes }) };
    const prepared = new GithubSourceService(
      repository as never,
      client as never,
      new UploadValidatorService(),
      { appDataPath: directory } as never,
      { timeoutMs: 100 } as never,
    );
    await expect(prepared.prepare(42, null)).resolves.toEqual({ ...file, id: 42 });
    expect(client.fileMetadata).toHaveBeenCalledWith(candidate, expect.any(AbortSignal));
    expect(repository.assertCurrent).toHaveBeenCalledWith(expect.objectContaining({ blobSha: file.blobSha, sizeBytes: content.length }));
    await expect(prepared.prepare(42, 'c'.repeat(40))).rejects.toThrow('changed');
    expect(client.fileMetadata).toHaveBeenCalledTimes(1);
  });
  it('rejects disabled catalog entries before requesting their metadata', async () => {
    repository.entry.mockResolvedValue({ ...file, id: 42, blobSha: null, sizeBytes: null });
    repository.assertCurrent.mockRejectedValue(new Error('disabled'));
    const client = { fileMetadata: vi.fn() };
    const prepared = new GithubSourceService(
      repository as never,
      client as never,
      new UploadValidatorService(),
      { appDataPath: directory } as never,
      { timeoutMs: 100 } as never,
    );
    await expect(prepared.prepare(42, null)).rejects.toThrow('disabled');
    expect(client.fileMetadata).not.toHaveBeenCalled();
  });
  it('creates a stable queue identity within the existing database column', () => {
    expect(githubJobIdentity(file)).toHaveLength(25);
    expect(githubJobIdentity({ ...file, commitSha: 'b'.repeat(40) })).toBe(githubJobIdentity(file));
    expect(githubJobIdentity({ ...file, blobSha: 'b'.repeat(40) })).not.toBe(githubJobIdentity(file));
  });
});
