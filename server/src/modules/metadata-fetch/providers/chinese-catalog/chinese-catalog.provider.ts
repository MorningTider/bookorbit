import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { MetadataProviderKey, type MetadataCandidate } from '@bookorbit/types';
import { load } from 'cheerio';
import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { parseQimaoSearch } from './qimao-search';
import { parseBaiduMobilePage } from './baidu-page';
import { readBoundedText } from '../../../../common/utils/bounded-response';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import type { MetadataProvider } from '../metadata-provider';
import type { MetadataSearchParams } from '../metadata-search-params';

type CatalogKey = 'baiduBaike' | 'qimao' | 'qidian';
const CATALOGS = {
  baiduBaike: { label: '百度百科', origin: 'https://wapbaike.baidu.com', path: /^\/item\// },
  qimao: { label: '七猫小说', origin: 'https://www.qimao.com', path: /^\/shuku\/\d+\// },
  qidian: { label: '起点中文网', origin: 'https://m.qidian.com', path: /^\/book\/\d+\// },
};

export function parseCatalogPage(html: string, key: CatalogKey, pageUrl: string): MetadataCandidate | null {
  const $ = load(html);
  if (
    /安全验证|访问验证|验证码/.test($('title').text()) ||
    $('script[src*="probe.js"], meta[name^="aliyun_waf_"], #aliyunCaptcha-sliding-slider').length
  ) {
    throw new BadGatewayException(`${CATALOGS[key].label}要求访问验证，暂时无法获取元数据`);
  }
  const title = ($('meta[property="og:novel:book_name"]').attr('content') || $('h1').first().text()).trim();
  if (!title) return null;
  let authors = ($('meta[property="og:novel:author"]').attr('content') || $('[class*="author"] a').first().text()).trim();
  if (key === 'baiduBaike') {
    const authorLabel = $('dt')
      .filter((_, item) => /^(作者|原作者)$/.test($(item).text().replace(/\s/g, '')))
      .first();
    if (!authors)
      authors = authorLabel
        .next('dd')
        .text()
        .replace(/\[\d+\]/g, '')
        .trim();
    if (!authors && !$('meta[property="og:novel:book_name"]').length) return null;
  }
  const description = ($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '').trim();
  const rawCover = $('meta[property="og:image"]').attr('content');
  let coverUrl: string | undefined;
  if (rawCover) {
    try {
      const url = new URL(rawCover, pageUrl);
      if (url.protocol === 'https:') coverUrl = url.href;
    } catch {
      /* Ignore malformed source images. */
    }
  }
  return {
    provider: MetadataProviderKey[key === 'baiduBaike' ? 'BAIDU_BAIKE' : key === 'qimao' ? 'QIMAO' : 'QIDIAN'],
    providerId: new URL(pageUrl).pathname,
    title,
    authors: authors ? [authors] : [],
    description: description || undefined,
    language: 'zh',
    sourceUrl: pageUrl,
    ...(coverUrl ? { coverUrl } : {}),
  };
}

export function parseQidianSearchPage(html: string): MetadataCandidate[] {
  parseCatalogPage(html, 'qidian', 'https://m.qidian.com/');
  const $ = load(html);
  const seen = new Set<string>();
  const results: MetadataCandidate[] = [];
  $('a[data-bid]').each((_, element) => {
    if (results.length >= 10) return;
    const card = $(element);
    const id = card.attr('data-bid') ?? '';
    const title = card.find('[class*="searchBookName"]').text().trim();
    if (!/^\d+$/.test(id) || !title || seen.has(id)) return;
    seen.add(id);
    const author = card.find('[class*="searchBookAuthor"]').text().trim();
    const description = card.find('[class*="searchBookDesc"]').text().trim();
    const imageNode = card.find('img').first();
    const image = imageNode.attr('data-src') || imageNode.attr('src');
    let coverUrl: string | undefined;
    if (image) {
      try {
        const url = new URL(image, 'https://m.qidian.com');
        if (url.protocol === 'https:' && url.hostname === 'bookcover.yuewen.com') coverUrl = url.href;
      } catch {
        /* Ignore malformed cover URLs. */
      }
    }
    results.push({
      provider: MetadataProviderKey.QIDIAN,
      providerId: id,
      title,
      authors: author ? [author] : [],
      description: description || undefined,
      language: 'zh',
      sourceUrl: `https://www.qidian.com/book/${id}/`,
      ...(coverUrl ? { coverUrl } : {}),
    });
  });
  if (!results.length && !$('input[name="kw"]').length) throw new BadGatewayException('起点未返回有效的搜索页面');
  return results;
}

class ChineseCatalogProvider implements MetadataProvider {
  readonly identifiable = false;
  readonly coverShape = 'portrait' as const;
  readonly timeoutMs = 15000;
  private readonly logger = new Logger(ChineseCatalogProvider.name);
  constructor(
    readonly key: CatalogKey,
    readonly label: string,
    private readonly config: ProviderConfigService,
  ) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    if (!(await this.config.getConfig())[this.key].enabled || !params.title?.trim()) return [];
    const startedAt = Date.now();
    this.logger.log(`[metadata.chinese_catalog] [start] provider=${this.key} - catalog search started`);
    try {
      const catalog = CATALOGS[this.key];
      const url = new URL(
        this.key === 'baiduBaike'
          ? `/item/${encodeURIComponent(params.title.trim())}`
          : this.key === 'qidian'
            ? `/so/${encodeURIComponent(params.title.trim())}.html`
            : '/api/search/result',
        this.key === 'qimao' ? 'https://api-www.qimao.com' : catalog.origin,
      );
      if (this.key === 'qimao') {
        url.searchParams.set('keyword', params.title.trim());
        url.searchParams.set('page', '1');
      }
      const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(14000)]) : AbortSignal.timeout(14000);
      const read = async (target: string) => {
        const response = await fetchWithThrottle(target, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          headers: {
            'User-Agent': 'Mozilla/5.0',
            Accept: 'text/html,application/json',
            'Accept-Encoding': 'identity',
            Referer: catalog.origin + '/',
          },
        });
        if (!response.ok) throw new BadGatewayException(`${catalog.label}访问失败 (HTTP ${response.status})`);
        const html = await readBoundedText(response, 2_000_000);
        if (html.length > 2_000_000) throw new BadGatewayException('来源页面过大');
        return html;
      };
      const html = await read(url.href);
      const results: MetadataCandidate[] = [];
      if (this.key === 'qidian') {
        results.push(...parseQidianSearchPage(html));
      } else if (this.key === 'qimao') {
        let data: unknown;
        try {
          data = JSON.parse(html);
        } catch {
          throw new BadGatewayException('七猫未返回有效的搜索数据');
        }
        results.push(...parseQimaoSearch(data));
      } else {
        const initial = parseBaiduMobilePage(html);
        if (initial.candidate) results.push(initial.candidate);
        const seen = new Set(results.map((item) => item.providerId));
        const failures: unknown[] = [];
        for (const related of initial.related) {
          if (seen.has(related.id)) continue;
          seen.add(related.id);
          try {
            const page = await read(`https://wapbaike.baidu.com/item/${encodeURIComponent(related.title)}/${related.id}`);
            const { candidate } = parseBaiduMobilePage(page);
            if (candidate) results.push(candidate);
          } catch (error) {
            if (params.signal?.aborted) throw error;
            failures.push(error);
            this.logger.warn(
              `[metadata.chinese_catalog_detail] [fail] provider=${this.key} providerId=${related.id} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - related book entry failed`,
            );
          }
        }
        if (!results.length && failures.length) throw failures[0];
      }
      this.logger.log(
        `[metadata.chinese_catalog] [end] provider=${this.key} durationMs=${Date.now() - startedAt} count=${results.length} - catalog search completed`,
      );
      return results;
    } catch (error) {
      this.logger.warn(
        `[metadata.chinese_catalog] [fail] provider=${this.key} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - catalog search failed`,
      );
      throw error;
    }
  }
}
@Injectable()
export class BaiduBaikeProvider extends ChineseCatalogProvider {
  constructor(config: ProviderConfigService) {
    super('baiduBaike', '百度百科', config);
  }
}
@Injectable()
export class QimaoProvider extends ChineseCatalogProvider {
  constructor(config: ProviderConfigService) {
    super('qimao', '七猫小说', config);
  }
}
@Injectable()
export class QidianProvider extends ChineseCatalogProvider {
  constructor(config: ProviderConfigService) {
    super('qidian', '起点中文网', config);
  }
}
