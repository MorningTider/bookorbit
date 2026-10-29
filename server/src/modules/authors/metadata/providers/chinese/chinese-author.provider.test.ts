import { beforeEach, describe, expect, it, vi } from 'vitest';
const remote = vi.hoisted(() => vi.fn());
vi.mock('../author-fetch', () => ({
  authorProviderFetch: remote,
  authorRequestSignal: (_timeout: number, signal?: AbortSignal) => signal ?? new AbortController().signal,
}));
import { ChineseAuthorProvider } from './chinese-author.provider';
const config = {
  getConfig: () =>
    Promise.resolve({ baiduBaike: { enabled: true }, qidian: { enabled: true }, douban: { enabled: true }, fanqie: { enabled: true } }),
};
describe('ChineseAuthorProvider', () => {
  beforeEach(() => remote.mockReset());
  it('makes no requests when a source is disabled or identity is unsafe', async () => {
    const provider = new ChineseAuthorProvider('qidian', { getConfig: () => Promise.resolve({ qidian: { enabled: false } }) } as never);
    expect(await provider.search({ name: '忘语' })).toEqual([]);
    expect(await new ChineseAuthorProvider('fanqie', config as never).lookupById('../private')).toBeNull();
    expect(remote).not.toHaveBeenCalled();
  });
  it('returns the exact author from a trusted Qidian book and author page', async () => {
    remote
      .mockResolvedValueOnce(new Response('<a data-bid="107580"><p class="_searchBookAuthor_hash">忘语</p></a>'))
      .mockResolvedValueOnce(new Response('<a href="//m.qidian.com/author/4362771/">忘语</a>'))
      .mockResolvedValueOnce(new Response('<div class="_authorName_hash"><h2>忘语</h2></div><p class="_authorDesc_hash">作家介绍</p>'));
    expect(await new ChineseAuthorProvider('qidian', config as never).search({ name: '忘语' })).toMatchObject([
      { providerId: '4362771', name: '忘语', description: '作家介绍' },
    ]);
    expect(remote).toHaveBeenCalledTimes(3);
  });
  it('never follows an unrelated author link or silently accepts a failed response', async () => {
    remote.mockResolvedValueOnce(new Response('<a data-bid="42"><p class="_searchBookAuthor_hash">其他人</p></a>'));
    expect(await new ChineseAuthorProvider('qidian', config as never).search({ name: '忘语' })).toEqual([]);
    expect(remote).toHaveBeenCalledTimes(1);
    remote.mockReset().mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    await expect(new ChineseAuthorProvider('qidian', config as never).search({ name: '忘语' })).rejects.toMatchObject({
      httpStatus: 429,
      transient: true,
    });
  });
  it('uses only a single author biography and does not fetch movie results from Douban', async () => {
    remote
      .mockResolvedValueOnce(
        new Response(
          '<div class="search-result"><div class="result"><div class="title"><h3><a href="https://book.douban.com/subject/42/">作品</a></h3></div><span class="subject-cast">天下霸唱 / 出版社 / 2020</span></div></div>',
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<div id="info"><span><span class="pl">作者:</span><a>天下霸唱</a></span></div><div id="author-report"><div class="intro">作家介绍</div></div>',
        ),
      );
    expect(await new ChineseAuthorProvider('douban', config as never).search({ name: '天下霸唱' })).toMatchObject([
      { name: '天下霸唱', description: '作家介绍', provider: 'douban' },
    ]);
  });
  it('does not promote a publishing credit without a Fanqie author identity', async () => {
    remote
      .mockResolvedValueOnce(Response.json({ code: 0, data: { ret_data: [{ author: '天下霸唱 著', book_id: '6839607279780629518' }] } }))
      .mockResolvedValueOnce(new Response('<span class="author-name-text">天下霸唱</span><script>{"authorId":""}</script>'));
    expect(await new ChineseAuthorProvider('fanqie', config as never).search({ name: '天下霸唱' })).toEqual([]);
  });
  it('passes cancellation and a bounded reader to the remote request', async () => {
    const c = new AbortController();
    c.abort();
    remote.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    await expect(new ChineseAuthorProvider('baiduBaike', config as never).search({ name: '天下霸唱', signal: c.signal })).rejects.toThrow('Aborted');
    expect(remote.mock.calls[0]?.[1]).toMatchObject({ signal: c.signal, redirect: 'error' });
  });
});
