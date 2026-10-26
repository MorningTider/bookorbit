import { Injectable, Logger, BadGatewayException } from '@nestjs/common';
import { MetadataProviderKey, type MetadataCandidate } from '@bookorbit/types';
import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import type { IdentifiableProvider } from '../metadata-provider';
import { readBoundedText } from '../../../../common/utils/bounded-response';
import { doubanCoverUrl, parseDoubanPage } from './douban-page';
import type { MetadataSearchParams } from '../metadata-search-params';

export function mapDoubanSuggestions(data: unknown): MetadataCandidate[] {
  if (!Array.isArray(data)) throw new BadGatewayException('豆瓣返回了无法识别的数据');
  return data.slice(0, 10).flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Record<string, unknown>;
    const providerId = typeof item.id === 'number' ? String(item.id) : item.id;
    if (item.type !== 'b' || typeof providerId !== 'string' || !/^\d{1,20}$/.test(providerId) || typeof item.title !== 'string') return [];
    const coverUrl = doubanCoverUrl(item.pic);
    const year = Number(item.year);
    return [
      {
        provider: MetadataProviderKey.DOUBAN,
        providerId,
        title: item.title,
        authors: typeof item.author_name === 'string' && item.author_name ? [item.author_name] : [],
        language: 'zh',
        ...(Number.isInteger(year) && year > 0 ? { publishedYear: year } : {}),
        ...(coverUrl ? { coverUrl } : {}),
        sourceUrl: `https://book.douban.com/subject/${providerId}/`,
      },
    ];
  });
}

@Injectable()
export class DoubanProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.DOUBAN;
  readonly label = '豆瓣读书';
  readonly identifiable = true as const;
  readonly timeoutMs = 15000;
  readonly coverShape = 'portrait' as const;
  private readonly logger = new Logger(DoubanProvider.name);
  constructor(private readonly config: ProviderConfigService) {}
  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    if (!(await this.config.getConfig()).douban.enabled) return [];
    const query = (params.isbn?.trim() || [params.title, params.author].filter(Boolean).join(' ')).trim().slice(0, 200);
    if (!query) return [];
    const startedAt = Date.now();
    this.logger.log('[metadata.douban] [start] - Douban search started');
    try {
      const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(14000)]) : AbortSignal.timeout(14000);
      const suggest = async (text: string) => {
        const url = new URL('https://book.douban.com/j/subject_suggest');
        url.searchParams.set('q', text);
        const response = await fetchWithThrottle(url, {
          signal,
          redirect: 'error',
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        });
        if (!response.ok) throw new BadGatewayException(`豆瓣访问失败 (HTTP ${response.status})`);
        return mapDoubanSuggestions(JSON.parse(await readBoundedText(response, 512 * 1024)) as unknown);
      };
      let result = await suggest(query);
      if (!result.length && !params.isbn?.trim() && params.title?.trim() && params.author?.trim())
        result = await suggest(params.title.trim().slice(0, 200));
      const details = await Promise.allSettled(result.slice(0, 3).map((candidate) => this.readDetails(candidate.providerId, signal)));
      signal.throwIfAborted();
      result = result.map((candidate, index) => {
        const detail = details[index];
        if (detail?.status === 'fulfilled') return { ...candidate, ...detail.value };
        if (detail?.status === 'rejected')
          this.logger.warn(
            `[metadata.douban_detail] [fail] providerId=${candidate.providerId} durationMs=${Date.now() - startedAt} errorClass=${detail.reason instanceof Error ? detail.reason.name : 'Error'} error="${sanitizeLogValue(detail.reason instanceof Error ? detail.reason.message : String(detail.reason))}" - retaining search metadata after detail failure`,
          );
        return candidate;
      });
      this.logger.log(`[metadata.douban] [end] durationMs=${Date.now() - startedAt} count=${result.length} - Douban search completed`);
      return result;
    } catch (error) {
      this.logger.warn(
        `[metadata.douban] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - Douban search failed`,
      );
      throw error;
    }
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    if (!(await this.config.getConfig()).douban.enabled || !/^\d{1,20}$/.test(providerId)) return null;
    const startedAt = Date.now();
    this.logger.log(`[metadata.douban_lookup] [start] providerId=${providerId} - detail lookup started`);
    try {
      const result = await this.readDetails(providerId, signal);
      this.logger.log(`[metadata.douban_lookup] [end] providerId=${providerId} durationMs=${Date.now() - startedAt} - detail lookup completed`);
      return result;
    } catch (error) {
      this.logger.warn(
        `[metadata.douban_lookup] [fail] providerId=${providerId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - detail lookup failed`,
      );
      throw error;
    }
  }

  private async readDetails(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate> {
    const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000);
    const response = await fetchWithThrottle(`https://book.douban.com/subject/${providerId}/`, {
      signal: deadline,
      redirect: 'error',
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    });
    if (!response.ok) throw new BadGatewayException(`豆瓣详情访问失败 (HTTP ${response.status})`);
    return parseDoubanPage(await readBoundedText(response, 2 * 1024 * 1024), providerId);
  }
}
