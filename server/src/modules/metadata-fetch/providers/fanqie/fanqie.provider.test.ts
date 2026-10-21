import { BadGatewayException } from '@nestjs/common';
import { MetadataProviderKey } from '@bookorbit/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithThrottle = vi.hoisted(() => vi.fn());
vi.mock('../../fetch-with-throttle', () => ({ fetchWithThrottle }));

import { FanqieProvider, mapFanqieResults } from './fanqie.provider';

describe('FanqieProvider', () => {
  beforeEach(() => fetchWithThrottle.mockReset());

  it('maps Chinese book results and rejects unsafe cover URLs', () => {
    const results = mapFanqieResults({ code: 0, data: { ret_data: [
      { book_id: '7290175791344651298', title: '剑来', author: '烽火戏诸侯', abstract: '简介', category: '玄幻', thumb_url: 'https://p6-tt.bytecdn.cn/cover.jpg' },
      { book_id: '123456789012', title: '无封面', thumb_url: 'http://127.0.0.1/secret.jpg' },
      { book_id: 'bad', title: '无效ID' },
    ] } });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      provider: MetadataProviderKey.FANQIE,
      providerId: '7290175791344651298',
      title: '剑来',
      authors: ['烽火戏诸侯'],
      description: '简介',
      genres: ['玄幻'],
      coverUrl: 'https://p6-tt.bytecdn.cn/cover.jpg',
    });
    expect(results[1]).not.toHaveProperty('coverUrl');
  });

  it('rejects failed responses and uses the expected search endpoint', async () => {
    expect(() => mapFanqieResults({ code: 12, data: { ret_data: [] } })).toThrow(BadGatewayException);
    fetchWithThrottle.mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { ret_data: [] } }) });
    const provider = new FanqieProvider({ getConfig: async () => ({ fanqie: { enabled: true } }) } as never);

    await expect(provider.search({ title: '剑来' })).resolves.toEqual([]);
    const requestUrl = String(fetchWithThrottle.mock.calls[0]?.[0]);
    expect(requestUrl).toContain('/api/novel/channel/homepage/search/search/v1/');
    expect(requestUrl).toContain('aid=1967');
    expect(requestUrl).toContain('q=%E5%89%91%E6%9D%A5');
  });

  it('does not make a remote request while disabled', async () => {
    const provider = new FanqieProvider({ getConfig: async () => ({ fanqie: { enabled: false } }) } as never);

    await expect(provider.search({ title: '剑来' })).resolves.toEqual([]);
    expect(fetchWithThrottle).not.toHaveBeenCalled();
  });
});
