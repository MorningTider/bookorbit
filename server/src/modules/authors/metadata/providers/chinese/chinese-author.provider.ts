import { AUTHOR_PROVIDER_SUPPORTED_FIELDS, type AuthorMetadataCandidate } from '@bookorbit/types';
import { ProviderConfigService } from '../../../../metadata-preferences/provider-config.service';
import { readBoundedText } from '../../../../../common/utils/bounded-response';
import { authorProviderFetch, authorRequestSignal } from '../author-fetch';
import { AuthorMetadataProviderError, type AuthorMetadataSearchParams, type IdentifiableAuthorMetadataProvider } from '../author-metadata-provider';
import { checkedAuthorPage, parseBaiduAuthor, parseDoubanBookAuthor, parseFanqieAuthor, parseQidianAuthor } from './chinese-author-page';

export const CHINESE_AUTHOR_SOURCES = {
  baiduBaike: '百度百科',
  douban: '豆瓣读书',
  fanqie: '番茄小说',
  qidian: '起点中文网',
} as const;
export type ChineseAuthorKey = keyof typeof CHINESE_AUTHOR_SOURCES;
const sameName = (a: string, b: string) => a.normalize('NFKC').replace(/\s|(?:原著|著)$/g, '') === b.normalize('NFKC').replace(/\s/g, '');

export class ChineseAuthorProvider implements IdentifiableAuthorMetadataProvider {
  readonly identifiable = true as const;
  readonly label: string;
  readonly supportedFields;
  constructor(
    readonly key: ChineseAuthorKey,
    private readonly config: ProviderConfigService,
  ) {
    this.label = CHINESE_AUTHOR_SOURCES[key];
    this.supportedFields = AUTHOR_PROVIDER_SUPPORTED_FIELDS[key];
  }
  private async read(url: URL | string, signal: AbortSignal): Promise<string> {
    const response = await authorProviderFetch(url, {
      signal,
      redirect: 'error',
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html,application/json' },
    });
    if (!response.ok)
      throw new AuthorMetadataProviderError(`${this.label}访问失败 (HTTP ${response.status})`, {
        httpStatus: response.status,
        transient: response.status === 429 || response.status >= 500,
      });
    return readBoundedText(response, 2 * 1024 * 1024);
  }
  async search(params: AuthorMetadataSearchParams): Promise<AuthorMetadataCandidate[]> {
    if (!(await this.config.getConfig())[this.key].enabled) return [];
    const name = params.name.trim().slice(0, 100);
    if (!name) return [];
    const signal = authorRequestSignal(14000, params.signal);
    if (this.key === 'baiduBaike') {
      const candidate = parseBaiduAuthor(await this.read(`https://wapbaike.baidu.com/item/${encodeURIComponent(name)}`, signal));
      return candidate && sameName(candidate.name, name) ? [candidate] : [];
    }
    const ids: string[] = [];
    if (this.key === 'douban') {
      const url = new URL('https://www.douban.com/search');
      url.searchParams.set('q', name);
      url.searchParams.set('cat', '1001');
      const $ = checkedAuthorPage(await this.read(url, signal));
      if (!$('.search-result').length) throw new AuthorMetadataProviderError('豆瓣未返回可识别的作者作品搜索页');
      $('.result')
        .slice(0, 20)
        .each((_, node) => {
          if (!sameName($(node).find('.subject-cast').text().split(' / ')[0] ?? '', name)) return;
          try {
            let link = new URL($(node).find('.title h3 a').attr('href') ?? '', 'https://www.douban.com');
            if (link.origin === 'https://www.douban.com' && link.pathname === '/link2/') link = new URL(link.searchParams.get('url') ?? '');
            const id =
              link.origin === 'https://book.douban.com' && !link.username && !link.password
                ? link.pathname.match(/^\/subject\/(\d{1,20})\/$/)?.[1]
                : undefined;
            if (id) ids.push(id);
          } catch {
            /* Ignore unrelated search links. */
          }
        });
    } else if (this.key === 'qidian') {
      const $ = checkedAuthorPage(await this.read(`https://m.qidian.com/so/${encodeURIComponent(name)}.html`, signal));
      const books = $('a')
        .toArray()
        .flatMap((node) => {
          if (!sameName($(node).find('[class*="searchBookAuthor"]').text(), name)) return [];
          const id =
            $(node).attr('data-bid') ??
            $(node)
              .attr('href')
              ?.match(/\/(?:chapter|book)\/(\d+)\//)?.[1];
          return id && /^\d{1,20}$/.test(id) ? [id] : [];
        });
      for (const book of [...new Set(books)].slice(0, 2)) {
        const page = checkedAuthorPage(await this.read(`https://m.qidian.com/book/${book}/`, signal));
        page('a[href*="/author/"]').each((_, node) => {
          if (!sameName(page(node).text(), name)) return;
          const id = page(node)
            .attr('href')
            ?.match(/^(?:https:)?\/\/m\.qidian\.com\/author\/(\d{1,20})\/$/)?.[1];
          if (id) ids.push(id);
        });
        if (ids.length) break;
      }
    } else {
      const url = new URL('https://api-lf.fanqiesdk.com/api/novel/channel/homepage/search/search/v1/');
      url.searchParams.set('q', name);
      url.searchParams.set('offset', '0');
      url.searchParams.set('aid', '1967');
      const data = JSON.parse(await this.read(url, signal)) as { code?: number; data?: { ret_data?: { author?: string; book_id?: string }[] } };
      if (data.code !== 0 || !Array.isArray(data.data?.ret_data)) throw new AuthorMetadataProviderError('番茄未返回可识别的作者作品目录');
      const books = data.data.ret_data
        .slice(0, 10)
        .filter((row) => typeof row.author === 'string' && sameName(row.author, name) && /^\d{10,25}$/.test(row.book_id ?? ''));
      for (const book of books.slice(0, 2)) {
        const html = await this.read(`https://fanqienovel.com/page/${book.book_id}`, signal);
        const $ = checkedAuthorPage(html);
        if (!sameName($('.author-name-text').first().text(), name)) continue;
        const id = html.match(/"authorId"\s*:\s*"(\d{1,25})"/)?.[1];
        if (id) ids.push(id);
      }
    }
    const candidates: AuthorMetadataCandidate[] = [];
    for (const id of [...new Set(ids)].slice(0, Math.min(3, Math.max(1, params.limit ?? 3)))) {
      const candidate =
        this.key === 'douban'
          ? parseDoubanBookAuthor(await this.read(`https://book.douban.com/subject/${id}/`, signal), id, name)
          : await this.lookupById(id, undefined, signal);
      if (candidate && sameName(candidate.name, name)) candidates.push(candidate);
    }
    return candidates;
  }
  async lookupById(id: string, _region?: string, callerSignal?: AbortSignal): Promise<AuthorMetadataCandidate | null> {
    if (!(await this.config.getConfig())[this.key].enabled) return null;
    const signal = authorRequestSignal(14000, callerSignal);
    if (this.key === 'baiduBaike') {
      const match = id.match(/^([^/]{1,100})\/(\d{1,20})$/);
      if (!match) return null;
      const candidate = parseBaiduAuthor(await this.read(`https://wapbaike.baidu.com/item/${encodeURIComponent(match[1]!)}/${match[2]}`, signal));
      return candidate?.providerId === id ? candidate : null;
    }
    if (!/^\d{1,25}$/.test(id)) return null;
    if (this.key === 'qidian') return parseQidianAuthor(await this.read(`https://m.qidian.com/author/${id}/`, signal), id);
    if (this.key === 'fanqie') return parseFanqieAuthor(await this.read(`https://fanqienovel.com/author-page/${id}`, signal), id);
    return parseDoubanBookAuthor(await this.read(`https://book.douban.com/subject/${id}/`, signal), id);
  }
}
