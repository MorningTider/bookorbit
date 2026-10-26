import { BadGatewayException } from '@nestjs/common';
import { MetadataProviderKey, type MetadataCandidate } from '@bookorbit/types';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
export function parseQimaoSearch(value: unknown): MetadataCandidate[] {
  const data = record(record(value)?.data);
  if (!Array.isArray(data?.search_list)) throw new BadGatewayException('七猫未返回有效的搜索数据');
  const seen = new Set<string>();
  const results: MetadataCandidate[] = [];
  for (const raw of data.search_list.slice(0, 30)) {
    const item = record(raw);
    const id = text(item?.book_id, 25);
    const title = text(item?.title, 500);
    if (!/^\d+$/.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    let coverUrl: string | undefined;
    try {
      const url = new URL(text(item?.image_link, 2048));
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port && /(?:^|\.)(?:wtzw|qimao)\.com$/.test(url.hostname))
        coverUrl = url.href;
    } catch {
      /* Ignore missing or malformed source covers. */
    }
    const author = text(item?.author, 255);
    const description = text(item?.intro, 20000).replace(/\\n/g, '\n');
    const genre = text(item?.category2_name, 100);
    results.push({
      provider: MetadataProviderKey.QIMAO,
      providerId: id,
      title,
      authors: author ? [author] : [],
      description: description || undefined,
      language: 'zh',
      sourceUrl: `https://www.qimao.com/shuku/${id}/`,
      ...(coverUrl ? { coverUrl } : {}),
      ...(genre ? { genres: [genre] } : {}),
    });
    if (results.length >= 10) break;
  }
  return results;
}
