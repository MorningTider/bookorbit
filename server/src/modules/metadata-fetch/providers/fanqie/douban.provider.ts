import { Injectable, Logger, BadGatewayException } from '@nestjs/common';
import { MetadataProviderKey, type MetadataCandidate } from '@bookorbit/types';
import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import type { MetadataProvider } from '../metadata-provider';
import type { MetadataSearchParams } from '../metadata-search-params';

export function mapDoubanSuggestions(data: unknown): MetadataCandidate[] {
  if (!Array.isArray(data)) throw new BadGatewayException('豆瓣返回了无法识别的数据');
  return data.slice(0, 10).flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Record<string, unknown>;
    if (item.type !== 'b' || typeof item.id !== 'string' || !/^\d+$/.test(item.id) || typeof item.title !== 'string') return [];
    let coverUrl: string | undefined;
    if (typeof item.pic === 'string') {
      try {
        const url = new URL(item.pic);
        if (url.protocol === 'https:' && /(^|\.)doubanio\.com$/.test(url.hostname)) coverUrl = url.href.replace('/s/public/', '/l/public/');
      } catch {
        // Ignore invalid upstream image URLs.
      }
    }
    const year = Number(item.year);
    return [{ provider: MetadataProviderKey.DOUBAN, providerId: item.id, title: item.title,
      authors: typeof item.author_name === 'string' && item.author_name ? [item.author_name] : [],
      language: 'zh', ...(Number.isInteger(year) && year > 0 ? { publishedYear: year } : {}),
      ...(coverUrl ? { coverUrl } : {}), sourceUrl: `https://book.douban.com/subject/${item.id}/` }];
  });
}

@Injectable()
export class DoubanProvider implements MetadataProvider {
  readonly key = MetadataProviderKey.DOUBAN;
  readonly label = '豆瓣读书';
  readonly identifiable = false;
  readonly coverShape = 'portrait' as const;
  private readonly logger = new Logger(DoubanProvider.name);
  constructor(private readonly config: ProviderConfigService) {}
  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    if (!(await this.config.getConfig()).douban.enabled) return [];
    const query = (params.isbn || params.title || '').trim().slice(0, 200);
    if (!query) return [];
    const startedAt = Date.now();
    this.logger.log('[metadata.douban] [start] - Douban search started');
    try {
      const url = new URL('https://book.douban.com/j/subject_suggest');
      url.searchParams.set('q', query);
      const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
      const response = await fetchWithThrottle(url, { signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      if (!response.ok) throw new BadGatewayException(`豆瓣访问失败 (HTTP ${response.status})`);
      const result = mapDoubanSuggestions(await response.json());
      this.logger.log(`[metadata.douban] [end] durationMs=${Date.now() - startedAt} count=${result.length} - Douban search completed`);
      return result;
    } catch (error) {
      this.logger.warn(`[metadata.douban] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - Douban search failed`);
      throw error;
    }
  }
}
