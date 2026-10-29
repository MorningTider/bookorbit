import { BadGatewayException } from '@nestjs/common';
import { MetadataProviderKey } from '@bookorbit/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithThrottle = vi.hoisted(() => vi.fn());
vi.mock('../../fetch-with-throttle', () => ({ fetchWithThrottle }));

import { DoubanProvider, mapDoubanSuggestions } from './douban.provider';

describe('DoubanProvider', () => {
  beforeEach(() => fetchWithThrottle.mockReset());

  it('maps valid book candidates and ignores unsafe or malformed covers', () => {
    const results = mapDoubanSuggestions([
      { type: 'b', id: '123', title: '三体', author_name: '刘慈欣', year: '2008', pic: 'https://img3.doubanio.com/view/subject/s/public/cover.jpg' },
      { type: 'b', id: 789, title: '数字 ID', author_name: '作者' },
      { type: 'b', id: '456', title: '无效封面', pic: 'not a url' },
      { type: 'm', id: '789', title: '电影' },
      { type: 'b', id: 'javascript:1', title: '无效ID' },
    ]);

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      provider: MetadataProviderKey.DOUBAN,
      providerId: '123',
      title: '三体',
      authors: ['刘慈欣'],
      publishedYear: 2008,
      coverUrl: 'https://img3.doubanio.com/view/subject/l/public/cover.jpg',
    });
    expect(results[1]).toMatchObject({ providerId: '789', title: '数字 ID' });
    expect(results[2]).not.toHaveProperty('coverUrl');
  });

  it('rejects an unrecognized response and performs a bounded search when enabled', async () => {
    expect(() => mapDoubanSuggestions({})).toThrow(BadGatewayException);
    fetchWithThrottle
      .mockResolvedValueOnce(new Response(JSON.stringify([{ type: 'b', id: '42', title: '书' }])))
      .mockRejectedValueOnce(new Error('detail unavailable'));
    const provider = new DoubanProvider({ getConfig: () => Promise.resolve({ douban: { enabled: true } }) } as never);

    await expect(provider.search({ title: '书', author: '作者' })).resolves.toMatchObject([{ providerId: '42', title: '书' }]);
    expect(fetchWithThrottle).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchWithThrottle.mock.calls[0]?.[0])).searchParams.get('q')).toBe('书 作者');
  });

  it('does not call the remote source when disabled', async () => {
    const provider = new DoubanProvider({ getConfig: () => Promise.resolve({ douban: { enabled: false } }) } as never);

    await expect(provider.search({ title: '书' })).resolves.toEqual([]);
    expect(fetchWithThrottle).not.toHaveBeenCalled();
  });
  it('retries a title-only query when an author query has no suggestions', async () => {
    fetchWithThrottle
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ type: 'b', id: '42', title: '书' }])))
      .mockRejectedValueOnce(new Error('detail unavailable'));
    const provider = new DoubanProvider({ getConfig: () => Promise.resolve({ douban: { enabled: true } }) } as never);
    expect(await provider.search({ title: '书', author: '错误作者' })).toMatchObject([{ providerId: '42' }]);
    expect(new URL(String(fetchWithThrottle.mock.calls[1]?.[0])).searchParams.get('q')).toBe('书');
  });

  it('never broadens an ISBN query or starts more than three detail calls', async () => {
    const provider = new DoubanProvider({ getConfig: () => Promise.resolve({ douban: { enabled: true } }) } as never);
    fetchWithThrottle.mockResolvedValueOnce(new Response('[]'));
    expect(await provider.search({ title: '书', author: '作者', isbn: '9787544362320' })).toEqual([]);
    expect(fetchWithThrottle).toHaveBeenCalledTimes(1);
    fetchWithThrottle
      .mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ type: 'b', id: String(i + 1), title: '书' })))))
      .mockImplementation(() => Promise.resolve(new Response('unavailable', { status: 503 })));
    expect(await provider.search({ title: '书' })).toHaveLength(10);
    expect(fetchWithThrottle).toHaveBeenCalledTimes(4);
  });

  it('falls back to public book search only after both suggestions are empty', async () => {
    fetchWithThrottle
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(
        new Response(
          '<div class="search-result"><div class="result-list"><div class="result"><div class="title"><h3><a href="https://book.douban.com/subject/1916726/">鬼吹灯之龙岭迷窟</a></h3><span class="subject-cast">天下霸唱 / 出版社 / 2006</span></div></div></div></div>',
        ),
      )
      .mockRejectedValueOnce(new Error('detail unavailable'));
    const provider = new DoubanProvider({ getConfig: () => Promise.resolve({ douban: { enabled: true } }) } as never);
    expect(await provider.search({ title: '龙岭迷窟', author: '天下霸唱' })).toMatchObject([{ providerId: '1916726', authors: ['天下霸唱'] }]);
    const url = new URL(String(fetchWithThrottle.mock.calls[2]?.[0]));
    expect(url.origin).toBe('https://www.douban.com');
    expect(url.searchParams.get('q')).toBe('龙岭迷窟');
    expect(url.searchParams.get('cat')).toBe('1001');
  });

  it('rejects unsafe lookup identities without calling a remote server', async () => {
    const provider = new DoubanProvider({ getConfig: () => Promise.resolve({ douban: { enabled: true } }) } as never);
    expect(await provider.lookupById('../secret')).toBeNull();
    expect(fetchWithThrottle).not.toHaveBeenCalled();
  });

  it('does not hide caller cancellation behind partial search metadata', async () => {
    const controller = new AbortController();
    fetchWithThrottle.mockResolvedValueOnce(new Response(JSON.stringify([{ type: 'b', id: '42', title: '书' }]))).mockImplementationOnce(() => {
      controller.abort();
      return Promise.reject(new Error('aborted'));
    });
    const provider = new DoubanProvider({ getConfig: () => Promise.resolve({ douban: { enabled: true } }) } as never);
    await expect(provider.search({ title: '书', signal: controller.signal })).rejects.toThrow();
  });
});
