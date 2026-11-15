import { beforeEach, describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Permission } from '@bookorbit/types';
import { safeFetch } from '../../common/utils/safe-fetch';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { GithubSourceClient, githubRawUrl, normalizeGithubRepository } from './github-source.client';
import { GithubSourceConfigController, GithubSourceSearchController } from './github-source.controller';
import { AcquireGithubDto, GithubSourceConfigDto, GithubSourceSearchDto } from './dto/github-book-source.dto';
vi.mock('../../common/utils/safe-fetch', () => ({ safeFetch: vi.fn() }));
const repo = { label: '测试仓库', repository: 'owner/books', branch: '', path: '', formats: ['epub' as const], enabled: true };
const sha = 'a'.repeat(40);
const file = { path: '测试.epub', type: 'blob', mode: '100644', sha, size: 100 };
function response(value: unknown) {
  return new Response(JSON.stringify(value));
}
async function collect(client: GithubSourceClient, input = repo) {
  const files = [];
  for await (const item of client.files(input, new AbortController().signal)) files.push(item);
  return files;
}
function metadata() {
  vi.mocked(safeFetch)
    .mockResolvedValueOnce(response({ default_branch: 'main' }))
    .mockResolvedValueOnce(response({ sha, commit: { tree: { sha } } }));
}
describe('GitHub source repository adapter', () => {
  beforeEach(() => vi.resetAllMocks());
  it('normalizes repository URLs and keeps Unicode subfolders', () => {
    expect(normalizeGithubRepository({ ...repo, repository: 'https://github.com/Owner/Books.git/', path: '/古籍/历史/' })).toMatchObject({
      repository: 'owner/books',
      path: '古籍/历史',
    });
  });
  it.each(['https://evil.example/owner/books', 'owner/../secret', 'owner/books?x=1', 'owner/books#x'])(
    'rejects unexpected repository addresses %s',
    (repository) => {
      expect(() => normalizeGithubRepository({ ...repo, repository })).toThrow();
    },
  );
  it.each(['../secret', 'a/../b', 'a\\b', 'a//b'])('rejects invalid folder paths %s', (path) => {
    expect(() => normalizeGithubRepository({ ...repo, path })).toThrow();
  });
  it('builds an immutable raw URL and escapes reserved filename characters', () => {
    expect(githubRawUrl({ repository: repo.repository, commitSha: sha, path: '古籍/书 #1.epub' })).toBe(
      `https://raw.githubusercontent.com/owner/books/${sha}/%E5%8F%A4%E7%B1%8D/%E4%B9%A6%20%231.epub`,
    );
  });
  it('indexes real files and excludes symlinks, unsupported formats and empty files', async () => {
    metadata();
    vi.mocked(safeFetch).mockResolvedValueOnce(
      response({
        truncated: false,
        tree: [file, { ...file, path: 'link.epub', mode: '120000' }, { ...file, path: 'other.pdf' }, { ...file, path: 'empty.epub', size: 0 }],
      }),
    );
    expect(await collect(new GithubSourceClient())).toEqual([
      { path: '测试.epub', commitSha: sha, blobSha: sha, format: 'epub', sizeBytes: 100, title: '测试' },
    ]);
  });
  it('falls back to directory traversal for a truncated recursive response', async () => {
    metadata();
    vi.mocked(safeFetch)
      .mockResolvedValueOnce(response({ truncated: true, tree: [file] }))
      .mockResolvedValueOnce(response({ truncated: false, tree: [file, { path: 'deep', type: 'tree', sha }] }))
      .mockResolvedValueOnce(response({ truncated: false, tree: [{ ...file, path: '下一本.epub' }] }));
    expect((await collect(new GithubSourceClient())).map((item) => item.path)).toEqual(['测试.epub', 'deep/下一本.epub']);
  });
  it('indexes the Wenshuoge CSV without requesting its oversized recursive tree', async () => {
    metadata();
    vi.mocked(safeFetch).mockResolvedValueOnce(
      new Response('编号,书名,作者,简介\n425,隋唐演义,褚人获,"含逗号,以及换行\n的简介"\n426,三侠五义,石玉昆,含有"引号"与,额外逗号\n'),
    );
    const results = await collect(new GithubSourceClient(), { ...repo, repository: 'zhpelo/wenshuoge' });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ path: 'ebookfiles/425/文硕阁_隋唐演义.epub', blobSha: null, sizeBytes: null });
    expect(vi.mocked(safeFetch).mock.calls.some(([url]) => String(url).includes('recursive=1'))).toBe(false);
  });
  it('rejects a missing configured directory', async () => {
    metadata();
    vi.mocked(safeFetch).mockResolvedValueOnce(response({ truncated: false, tree: [] }));
    await expect(collect(new GithubSourceClient(), { ...repo, path: 'missing' })).rejects.toThrow('folder');
  });
  it('reports access throttling', async () => {
    vi.mocked(safeFetch).mockResolvedValueOnce(new Response('', { status: 429 }));
    await expect(collect(new GithubSourceClient())).rejects.toThrow('rate limit');
  });
  it('falls back to the official raw contents API after a connection failure', async () => {
    vi.mocked(safeFetch).mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(new Response('original'));
    const result = await new GithubSourceClient().openFile(
      { repository: repo.repository, commitSha: sha, path: '测试.epub', sizeBytes: 8 },
      new AbortController().signal,
    );
    expect(await result.text()).toBe('original');
    expect(vi.mocked(safeFetch).mock.calls[1]![0]).toContain(`/contents/%E6%B5%8B%E8%AF%95.epub?ref=${sha}`);
    expect(vi.mocked(safeFetch).mock.calls[1]![1]!.headers).toMatchObject({ Accept: 'application/vnd.github.raw+json' });
  });
  it('preserves cancellation without a fallback request', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(safeFetch).mockRejectedValueOnce(controller.signal.reason);
    await expect(
      new GithubSourceClient().openFile({ repository: repo.repository, commitSha: sha, path: '测试.epub' }, controller.signal),
    ).rejects.toThrow();
    expect(safeFetch).toHaveBeenCalledTimes(1);
  });
  it('requires explicit management and download permissions', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, GithubSourceConfigController)).toEqual(Permission.ManageMetadataConfig);
    expect(Reflect.getMetadata(PERMISSION_KEY, GithubSourceSearchController)).toEqual([Permission.LibraryUpload, Permission.BookRequestSelfFulfill]);
  });
  it('validates only supported acquisition and configuration fields', () => {
    const options = { whitelist: true, forbidNonWhitelisted: true };
    expect(validateSync(plainToInstance(AcquireGithubDto, { entryId: 1, blobSha: sha }), options)).toEqual([]);
    expect(validateSync(plainToInstance(AcquireGithubDto, { entryId: 1, blobSha: null }), options)).toEqual([]);
    expect(validateSync(plainToInstance(GithubSourceSearchDto, { query: '历史', cursor: 'pending:42' }), options)).toEqual([]);
    expect(validateSync(plainToInstance(AcquireGithubDto, { entryId: 1, blobSha: sha, url: 'https://evil.example' }), options)).not.toEqual([]);
    expect(validateSync(plainToInstance(GithubSourceConfigDto, { revision: '0', enabled: true, repositories: [repo] }), options)).toEqual([]);
    expect(
      validateSync(plainToInstance(GithubSourceConfigDto, { revision: '0', enabled: true, repositories: [{ ...repo, formats: ['exe'] }] }), options),
    ).not.toEqual([]);
  });
});
