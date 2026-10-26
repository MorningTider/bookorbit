import { Injectable, Logger, BadGatewayException } from '@nestjs/common';
import { MetadataProviderKey, type MetadataCandidate } from '@bookorbit/types';
import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { normalizeRemoteImageUrl } from '../../../../common/utils/remote-image-headers';
import type { MetadataProvider } from '../metadata-provider';
import type { MetadataSearchParams } from '../metadata-search-params';

export function mapFanqieResults(data: unknown): MetadataCandidate[] {
  if (!data || typeof data !== 'object') throw new BadGatewayException('番茄返回了无法识别的数据');
  const response = data as { code?: number; data?: { ret_data?: unknown[] } };
  if (response.code !== 0 || !Array.isArray(response.data?.ret_data)) throw new BadGatewayException('番茄搜索暂不可用');
  return response.data.ret_data.slice(0, 10).flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Record<string, unknown>;
    if (typeof item.book_id !== 'string' || !/^\d{10,25}$/.test(item.book_id) || typeof item.title !== 'string') return [];
    let coverUrl: string | undefined;
    if (typeof item.thumb_url === 'string') {
      try {
        const url = new URL(item.thumb_url);
        if (url.protocol === 'https:' && /(^|\.)(byteimg\.com|bytecdn\.cn)$/.test(url.hostname)) {
          coverUrl = normalizeRemoteImageUrl(url).href;
        }
      } catch {
        /* Ignore invalid upstream image URLs. */
      }
    }
    return [
      {
        provider: MetadataProviderKey.FANQIE,
        providerId: item.book_id,
        title: item.title,
        authors: typeof item.author === 'string' && item.author ? [item.author] : [],
        description: typeof item.abstract === 'string' ? item.abstract : undefined,
        genres: typeof item.category === 'string' && item.category ? [item.category] : [],
        language: 'zh',
        ...(coverUrl ? { coverUrl } : {}),
        sourceUrl: `https://fanqienovel.com/page/${item.book_id}`,
      },
    ];
  });
}

@Injectable()
export class FanqieProvider implements MetadataProvider {
  readonly key = MetadataProviderKey.FANQIE;
  readonly label = '番茄小说';
  readonly identifiable = false;
  readonly coverShape = 'portrait' as const;
  private readonly logger = new Logger(FanqieProvider.name);
  constructor(private readonly config: ProviderConfigService) {}
  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    if (!(await this.config.getConfig()).fanqie.enabled) return [];
    const query = (params.isbn?.trim() || [params.title, params.author].filter(Boolean).join(' ')).trim().slice(0, 200);
    if (!query) return [];
    const startedAt = Date.now();
    this.logger.log('[metadata.fanqie] [start] - Fanqie search started');
    try {
      const url = new URL('https://api-lf.fanqiesdk.com/api/novel/channel/homepage/search/search/v1/');
      url.searchParams.set('q', query);
      url.searchParams.set('offset', '0');
      url.searchParams.set('aid', '1967');
      const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
      const response = await fetchWithThrottle(url, { signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      if (!response.ok) throw new BadGatewayException(`番茄访问失败 (HTTP ${response.status})`);
      const result = mapFanqieResults(await response.json());
      this.logger.log(`[metadata.fanqie] [end] durationMs=${Date.now() - startedAt} count=${result.length} - Fanqie search completed`);
      return result;
    } catch (error) {
      this.logger.warn(
        `[metadata.fanqie] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - Fanqie search failed`,
      );
      throw error;
    }
  }
}
