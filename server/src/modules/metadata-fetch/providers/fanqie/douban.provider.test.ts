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
      { type: 'b', id: '456', title: '无效封面', pic: 'not a url' },
      { type: 'm', id: '789', title: '电影' },
      { type: 'b', id: 'javascript:1', title: '无效ID' },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      provider: MetadataProviderKey.DOUBAN,
      providerId: '123',
      title: '三体',
      authors: ['刘慈欣'],
      publishedYear: 2008,
      coverUrl: 'https://img3.doubanio.com/view/subject/l/public/cover.jpg',
    });
    expect(results[1]).not.toHaveProperty('coverUrl');
  });

  it('rejects an unrecognized response and performs a bounded search when enabled', async () => {
    expect(() => mapDoubanSuggestions({})).toThrow(BadGatewayException);
    fetchWithThrottle.mockResolvedValue({ ok: true, json: async () => [{ type: 'b', id: '42', title: '书' }] });
    const provider = new DoubanProvider({ getConfig: async () => ({ douban: { enabled: true } }) } as never);

    await expect(provider.search({ title: '书' })).resolves.toMatchObject([{ providerId: '42', title: '书' }]);
    expect(fetchWithThrottle).toHaveBeenCalledOnce();
    expect(String(fetchWithThrottle.mock.calls[0]?.[0])).toContain('q=%E4%B9%A6');
  });

  it('does not call the remote source when disabled', async () => {
    const provider = new DoubanProvider({ getConfig: async () => ({ douban: { enabled: false } }) } as never);

    await expect(provider.search({ title: '书' })).resolves.toEqual([]);
    expect(fetchWithThrottle).not.toHaveBeenCalled();
  });
});
