import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
const fetchWithThrottle = vi.hoisted(() => vi.fn());
vi.mock('../../fetch-with-throttle', () => ({ fetchWithThrottle }));
import { parseCatalogPage, parseQidianSearchPage, QidianProvider, BaiduBaikeProvider, QimaoProvider } from './chinese-catalog.provider';

describe('Chinese catalog parsing', () => {
  it.each(['baiduBaike', 'qimao', 'qidian'] as const)('maps public book metadata for %s', (key) => {
    const html =
      '<h1>凡人修仙传</h1><meta property="og:novel:author" content="忘语"><meta name="description" content="小说简介"><meta property="og:image" content="https://images.example/cover.jpg">';
    expect(parseCatalogPage(html, key, 'https://example.com/book/1/')).toMatchObject({
      title: '凡人修仙传',
      authors: ['忘语'],
      description: '小说简介',
      coverUrl: 'https://images.example/cover.jpg',
      language: 'zh',
    });
  });
  it('reports a Baidu challenge rather than an empty success', () => {
    expect(() => parseCatalogPage('<title>百度安全验证</title>', 'baiduBaike', 'https://baike.baidu.com/item/test')).toThrow('要求访问验证');
  });
  it('recognizes a Qimao WAF challenge with an empty title', () => {
    expect(() => parseCatalogPage('<meta name="aliyun_waf_aa" content="challenge"><title></title>', 'qimao', 'https://www.qimao.com/')).toThrow(
      '要求访问验证',
    );
  });
  it('does not interpret a non-book Baidu entry as book metadata', () => {
    expect(parseCatalogPage('<h1>同名人物</h1><p>百科简介</p>', 'baiduBaike', 'https://baike.baidu.com/item/test')).toBeNull();
    expect(parseCatalogPage('<h1>书名</h1><dl><dt>作 者</dt><dd>忘语</dd></dl>', 'baiduBaike', 'https://baike.baidu.com/item/test')).toMatchObject({
      authors: ['忘语'],
    });
  });
  it('reports a Qidian script challenge', () => {
    expect(() => parseCatalogPage('<script src="/challenge/probe.js"></script>', 'qidian', 'https://www.qidian.com/search')).toThrow('要求访问验证');
  });
  it('ignores malformed image URLs and missing titles', () => {
    expect(
      parseCatalogPage('<h1>书名</h1><meta property="og:image" content="javascript:alert(1)">', 'qimao', 'https://www.qimao.com/shuku/1/'),
    ).not.toHaveProperty('coverUrl');
    expect(parseCatalogPage('<html></html>', 'qimao', 'https://www.qimao.com/shuku/1/')).toBeNull();
  });
});

describe('Qidian public mobile search', () => {
  it('extracts matching cards and preserves distinct same-title works', () => {
    const card = (id: string, author: string) =>
      `<a data-bid="${id}"><h2 class="_searchBookName_hash"><mark>凡人修仙传</mark></h2><p class="_searchBookAuthor_hash">${author}</p><p class="_searchBookDesc_hash">简介</p><img src="https://placeholder.example/loading.png" data-src="//bookcover.yuewen.com/qdbimg/349573/${id}/180"></a>`;
    const results = parseQidianSearchPage(card('107580', '忘语') + card('107580', '忘语') + card('123', '其他作者'));
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      provider: 'qidian',
      providerId: '107580',
      title: '凡人修仙传',
      authors: ['忘语'],
      coverUrl: 'https://bookcover.yuewen.com/qdbimg/349573/107580/180',
    });
    expect(results[1]?.authors).toEqual(['其他作者']);
  });
  it('distinguishes an empty search from an unexpected page', () => {
    expect(parseQidianSearchPage('<input name="kw">')).toEqual([]);
    expect(() => parseQidianSearchPage('<title>首页</title>')).toThrow('有效的搜索页面');
  });
  it('bounds results and rejects cover hosts outside the provider CDN', () => {
    const html = Array.from(
      { length: 20 },
      (_, i) => `<a data-bid="${i}"><h2 class="searchBookName">书${i}</h2><img src="https://invalid.example/cover.jpg"></a>`,
    ).join('');
    const results = parseQidianSearchPage(html);
    expect(results).toHaveLength(10);
    expect(results.every((result) => result.coverUrl === undefined)).toBe(true);
  });
});

describe('Qidian provider integration', () => {
  beforeEach(() => fetchWithThrottle.mockReset());

  async function provider(enabled: boolean) {
    const module = await Test.createTestingModule({
      providers: [QidianProvider, { provide: ProviderConfigService, useValue: { getConfig: () => Promise.resolve({ qidian: { enabled } }) } }],
    }).compile();
    return module.get(QidianProvider);
  }

  it('does not contact disabled sources', async () => {
    await expect((await provider(false)).search({ title: '凡人修仙传' })).resolves.toEqual([]);
    expect(fetchWithThrottle).not.toHaveBeenCalled();
  });

  it('uses the public mobile endpoint and maps its lazy cover images', async () => {
    fetchWithThrottle.mockResolvedValue(
      new Response(
        '<a data-bid="107580"><h2 class="searchBookName">凡人修仙传</h2><p class="searchBookAuthor">忘语</p><img data-src="//bookcover.yuewen.com/qdbimg/349573/107580/180"></a>',
      ),
    );
    const source = await provider(true);
    await expect(source.search({ title: '凡人修仙传' })).resolves.toMatchObject([
      { providerId: '107580', authors: ['忘语'], coverUrl: 'https://bookcover.yuewen.com/qdbimg/349573/107580/180' },
    ]);
    expect(String(fetchWithThrottle.mock.calls[0]?.[0])).toBe('https://m.qidian.com/so/%E5%87%A1%E4%BA%BA%E4%BF%AE%E4%BB%99%E4%BC%A0.html');
  });

  it('reports HTTP failures instead of returning no matches', async () => {
    fetchWithThrottle.mockResolvedValue(new Response(null, { status: 503 }));
    await expect((await provider(true)).search({ title: '凡人修仙传' })).rejects.toThrow('HTTP 503');
  });
});

describe('Public Chinese source endpoint integration', () => {
  beforeEach(() => fetchWithThrottle.mockReset());
  async function source<T>(type: new (config: ProviderConfigService) => T, key: string) {
    const module = await Test.createTestingModule({
      providers: [type, { provide: ProviderConfigService, useValue: { getConfig: () => Promise.resolve({ [key]: { enabled: true } }) } }],
    }).compile();
    return module.get(type);
  }
  it('queries the Qimao website JSON API instead of the empty search shell', async () => {
    fetchWithThrottle.mockResolvedValue(Response.json({ data: { search_list: [{ book_id: '1', title: '书名', author: '作者' }] } }));
    const provider = await source(QimaoProvider, 'qimao');
    expect(await provider.search({ title: '书名' })).toMatchObject([{ provider: 'qimao', authors: ['作者'] }]);
    const url = new URL(String(fetchWithThrottle.mock.calls[0]?.[0]));
    expect(url.origin).toBe('https://api-www.qimao.com');
    expect(url.pathname).toBe('/api/search/result');
    expect(url.searchParams.get('keyword')).toBe('书名');
    expect(url.searchParams.get('page')).toBe('1');
  });
  it('finds a literary homonym when the default Baidu page describes a television show', async () => {
    const page = (data: Record<string, unknown>) =>
      `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { pageData: data } } })}</script>`;
    fetchWithThrottle
      .mockResolvedValueOnce(
        new Response(
          page({ lemmaId: 100, lemmaTitle: '余罪', navigation: { lemmas: [{ lemmaId: 2970484, lemmaTitle: '余罪', lemmaDesc: '都市小说' }] } }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          page({ lemmaId: 2970484, lemmaTitle: '余罪', card: { content: [{ key: 'author', data: [{ text: [{ tag: 'text', text: '常书欣' }] }] }] } }),
        ),
      );
    const provider = await source(BaiduBaikeProvider, 'baiduBaike');
    expect(await provider.search({ title: '余罪' })).toMatchObject([{ providerId: '2970484', authors: ['常书欣'] }]);
    expect(fetchWithThrottle).toHaveBeenCalledTimes(2);
    expect(String(fetchWithThrottle.mock.calls[1]?.[0])).toBe('https://wapbaike.baidu.com/item/%E4%BD%99%E7%BD%AA/2970484');
  });
  it('does not conceal an inaccessible related book behind a successful empty result', async () => {
    const data = { props: { pageProps: { pageData: { navigation: { lemmas: [{ lemmaId: 1, lemmaTitle: '书名', lemmaDesc: '小说' }] } } } } };
    fetchWithThrottle
      .mockResolvedValueOnce(new Response(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`))
      .mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect((await source(BaiduBaikeProvider, 'baiduBaike')).search({ title: '书名' })).rejects.toThrow('HTTP 403');
  });
});
