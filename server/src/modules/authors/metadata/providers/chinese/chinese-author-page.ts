import { load } from 'cheerio';
import { AuthorMetadataProviderKey, type AuthorMetadataCandidate } from '@bookorbit/types';
import { AuthorMetadataProviderError } from '../author-metadata-provider';

export function checkedAuthorPage(html: string) {
  const $ = load(html);
  if (/验证|访问受限|Just a moment/i.test($('title').text()) || $('form#sec, #captcha').length)
    throw new AuthorMetadataProviderError('来源要求访问验证，暂时无法获取作者资料', { transient: true });
  return $;
}

export function authorImage(value: unknown, domains: string[]): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
    if (!domains.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain))) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function parseBaiduAuthor(html: string): AuthorMetadataCandidate | null {
  const $ = checkedAuthorPage(html);
  let json: unknown;
  try {
    json = JSON.parse($('#__NEXT_DATA__').text());
  } catch {
    throw new AuthorMetadataProviderError('百度百科未返回可识别的作者词条');
  }
  const page = record(record(record(record(json)?.props)?.pageProps)?.pageData);
  if (!page) throw new AuthorMetadataProviderError('百度百科未返回可识别的作者词条');
  const fields = record(page.card)?.content;
  if (!Array.isArray(fields)) return null;
  const values = new Map<string, string>();
  for (const raw of fields.slice(0, 80)) {
    const field = record(raw);
    if (!field || !Array.isArray(field.data)) continue;
    const text = field.data
      .slice(0, 20)
      .flatMap((rawPart) => {
        const part = record(rawPart);
        return Array.isArray(part?.text)
          ? part.text.slice(0, 100).flatMap((rawToken) => {
              const token = record(rawToken);
              return token && (token.tag === 'text' || token.tag === 'innerlink') && typeof token.text === 'string' ? [token.text] : [];
            })
          : [];
      })
      .join('')
      .slice(0, 2000);
    if (typeof field.key === 'string') values.set(field.key, text);
  }
  if (!/作家|小说家|诗人|文学家|编剧|漫画家|作者/.test(values.get('occupation') ?? (typeof page.lemmaDesc === 'string' ? page.lemmaDesc : '')))
    return null;
  const name = typeof page.lemmaTitle === 'string' ? page.lemmaTitle.trim().slice(0, 255) : '';
  const id = typeof page.lemmaId === 'string' || typeof page.lemmaId === 'number' ? String(page.lemmaId) : '';
  if (!name || !/^\d{1,20}$/.test(id)) return null;
  const birth = values.get('dateOfBirth')?.match(/^(\d{4})(?:年(?:(\d{1,2})月(?:(\d{1,2})日)?)?)?$/);
  const imageUrl = authorImage($('meta[property="og:image"]').attr('content'), ['bcebos.com', 'bdimg.com', 'baidu.com']);
  const sourceUrl = `https://wapbaike.baidu.com/item/${encodeURIComponent(name)}/${id}`;
  return {
    provider: AuthorMetadataProviderKey.BAIDU_BAIKE,
    providerId: `${name}/${id}`,
    name,
    description: $('meta[name="description"]').attr('content')?.trim().slice(0, 20000),
    sourceUrl,
    ...(imageUrl ? { imageUrl } : {}),
    ...(birth ? { birthYear: Number(birth[1]) } : {}),
  };
}

export function parseQidianAuthor(html: string, id: string): AuthorMetadataCandidate {
  const $ = checkedAuthorPage(html);
  const name = $('[class*="authorName"] h2').first().text().trim().slice(0, 255);
  const description = $('[class*="authorDesc"]').first().text().trim().slice(0, 20000);
  if (!name || !/^\d{1,20}$/.test(id)) throw new AuthorMetadataProviderError('起点未返回有效的作者主页');
  const avatar = html.match(/"avatar"\s*:\s*"(https:[^"\s]+)"/)?.[1];
  const imageUrl = authorImage(avatar, ['yuewen.com']);
  return {
    provider: AuthorMetadataProviderKey.QIDIAN,
    providerId: id,
    name,
    ...(description ? { description } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    sourceUrl: `https://m.qidian.com/author/${id}/`,
  };
}

export function parseFanqieAuthor(html: string, id: string): AuthorMetadataCandidate {
  const $ = checkedAuthorPage(html);
  const name = $('h1.title').first().text().trim();
  if (!name || !/^\d{1,25}$/.test(id)) throw new AuthorMetadataProviderError('番茄未返回有效的作者主页');
  const rawDescription = $('h1.title').parent().parent().find('.desc').first().text().trim();
  const description = /[\ue000-\uf8ff]/u.test(rawDescription) ? undefined : rawDescription.slice(0, 20000);
  const imageUrl = authorImage($('[class*="avatar"] img').first().attr('src'), ['fqnovelpic.com', 'byteimg.com', 'bytecdn.cn']);
  return {
    provider: AuthorMetadataProviderKey.FANQIE,
    providerId: id,
    name,
    ...(description ? { description } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    sourceUrl: `https://fanqienovel.com/author-page/${id}`,
  };
}

export function parseDoubanBookAuthor(html: string, id: string, expectedName?: string): AuthorMetadataCandidate | null {
  const $ = checkedAuthorPage(html);
  if (!$('#info').length || !/^\d{1,20}$/.test(id)) throw new AuthorMetadataProviderError('豆瓣未返回有效的图书作者资料');
  const labels = $('#info .pl')
    .toArray()
    .filter(
      (node) =>
        $(node)
          .text()
          .replace(/[\s:：]/g, '') === '作者',
    );
  const names: string[] = [];
  for (const label of labels) {
    for (const node of $(label)
      .parent()
      .contents()
      .toArray()
      .slice($(label).parent().contents().toArray().indexOf(label) + 1)) {
      if ($(node).is('br')) break;
      if ($(node).is('a')) names.push($(node).text().trim());
      else
        $(node)
          .find('a')
          .each((_, a) => {
            names.push($(a).text().trim());
          });
    }
  }
  const normalized = (value: string) => value.normalize('NFKC').replace(/\s/g, '');
  const name = expectedName ? names.find((value) => normalized(value) === normalized(expectedName)) : names.length === 1 ? names[0] : undefined;
  if (!name || names.length !== 1) return null;
  const section = $('h2')
    .filter((_, node) => $(node).find('span').first().text().trim() === '作者简介')
    .first();
  const biography = $('#author-report .intro').length ? $('#author-report .intro') : section.nextUntil('h2').find('.intro');
  const intro = biography
    .toArray()
    .map((node) => $(node).text().trim())
    .sort((a, b) => b.length - a.length)[0];
  if (!intro) return null;
  return {
    provider: AuthorMetadataProviderKey.DOUBAN,
    providerId: id,
    name,
    description: intro.slice(0, 20000),
    sourceUrl: `https://book.douban.com/subject/${id}/`,
  };
}
