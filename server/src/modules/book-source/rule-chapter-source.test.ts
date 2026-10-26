import { beforeEach, describe, it, expect, vi } from 'vitest';
import { safeFetch } from '../../common/utils/safe-fetch';
import { RuleChapterSource } from './rule-chapter-source';
import { publicRule } from '../../../test/fixtures/public-chapter-rule';
vi.mock('../../common/utils/safe-fetch', () => ({ safeFetch: vi.fn() }));
const fetch = vi.mocked(safeFetch);
const signal = new AbortController().signal;
beforeEach(() => vi.resetAllMocks());
describe('rule-based chapter adapter', () => {
  it('uses declared selectors, excludes restricted chapters and fetches safe public content', async () => {
    fetch
      .mockResolvedValueOnce(new Response('<h1>测试作品</h1><span class="author">作者</span>'))
      .mockResolvedValueOnce(new Response('<a class="chapter free" href="/chapter/1">开端</a><a class="chapter vip" href="/chapter/2">受限</a>'))
      .mockResolvedValueOnce(new Response('<h1>开端</h1><main class="public-content"><p>测试公开正文</p></main>'));
    const source = new RuleChapterSource(publicRule);
    const catalog = await source.catalog('101', signal);
    expect(catalog).toMatchObject({
      title: '测试作品',
      authors: ['作者'],
      excludedChapters: 1,
      chapters: [{ id: 'https://books.example.org/chapter/1', title: '开端' }],
    });
    expect(await source.chapter('101', catalog.chapters[0]!, signal)).toEqual(['测试公开正文']);
    expect(fetch).toHaveBeenCalledWith('https://books.example.org/chapter/1', expect.objectContaining({ redirect: 'error' }), {
      pinResolvedAddress: true,
    });
  });
  it.each([
    '<a class="chapter free" href="https://evil.example/chapter">开端</a>',
    '<a class="chapter" href="/chapter/1">未知权限</a>',
    '<a class="chapter free" href="/chapter/1">开端</a><a class="chapter free" href="/chapter/1">重复</a>',
  ])('rejects external, unknown and duplicate catalogue entries', async (html) => {
    fetch.mockResolvedValueOnce(new Response('<h1>作品</h1>')).mockResolvedValueOnce(new Response(html));
    await expect(new RuleChapterSource(publicRule).catalog('101', signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    '<h1>开端</h1><main><p>无公开声明</p></main>',
    '<h1>开端</h1><main class="public-content"><div class="paywall">购买</div><p>预览</p></main>',
    '<h1>另一章</h1><main class="public-content"><p>错误正文</p></main>',
  ])('rejects missing public markers, paywalls and mismatches', async (html) => {
    fetch.mockResolvedValueOnce(new Response(html));
    await expect(new RuleChapterSource(publicRule).chapter('101', { id: '/chapter/1', title: '开端' }, signal)).rejects.toThrow();
  });
  it('rejects external chapter URLs before making a network request', async () => {
    await expect(new RuleChapterSource(publicRule).chapter('101', { id: 'https://evil.example/chapter', title: '开端' }, signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
