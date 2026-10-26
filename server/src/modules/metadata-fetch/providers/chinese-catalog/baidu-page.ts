import { BadGatewayException } from '@nestjs/common';
import { MetadataProviderKey, type MetadataCandidate } from '@bookorbit/types';
import { load } from 'cheerio';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
function text(value: unknown, limit = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}
function cardValues(field: Record<string, unknown>): string[] {
  if (!Array.isArray(field.data)) return [];
  return field.data.slice(0, 20).flatMap((raw) => {
    const data = record(raw);
    if (!Array.isArray(data?.text)) return [];
    const value = data.text
      .map((token) => {
        const item = record(token);
        return item?.tag === 'text' || item?.tag === 'innerlink' ? text(item.text) : '';
      })
      .join('')
      .trim();
    return value ? [value] : [];
  });
}
function publicationFields(value: string): Pick<MetadataCandidate, 'publishedYear' | 'publishedDate'> {
  const match = value.match(/^(\d{4})年(?:(\d{1,2})月(?:(\d{1,2})日)?)?$/) ?? value.match(/^(\d{4})(?:[-./](\d{1,2}))?(?:[-./](\d{1,2}))?$/);
  if (!match) return {};
  const year = Number(match[1]);
  if (year < 1000 || year > 9999) return {};
  if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 12)) return {};
  if (!match[3]) return { publishedYear: year };
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return {};
  return { publishedYear: year, publishedDate: date };
}
export function parseBaiduMobilePage(html: string): { candidate: MetadataCandidate | null; related: { title: string; id: string }[] } {
  const $ = load(html);
  if (/安全验证|访问验证|验证码/.test($('title').text())) throw new BadGatewayException('百度百科要求访问验证，暂时无法获取元数据');
  const source = $('#__NEXT_DATA__').text();
  if (!source) throw new BadGatewayException('百度百科未返回有效的词条数据');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new BadGatewayException('百度百科词条数据无法解析');
  }
  const page = record(record(record(record(parsed)?.props)?.pageProps)?.pageData);
  if (!page) throw new BadGatewayException('百度百科未返回有效的词条数据');
  const navigation = record(page.navigation);
  const related = Array.isArray(navigation?.lemmas)
    ? navigation.lemmas
        .slice(0, 100)
        .flatMap((raw) => {
          const item = record(raw);
          const title = text(item?.lemmaTitle);
          const id = lemmaId(item?.lemmaId);
          const description = text(item?.lemmaDesc);
          const literature = Array.isArray(item?.classify) && item.classify.includes('文学作品');
          return /^\d{1,20}$/.test(id) &&
            title &&
            (literature || /小说|图书|著作|书籍|漫画/.test(description)) &&
            !/角色|人物|电视剧|电影|网剧/.test(description)
            ? [{ title, id }]
            : [];
        })
        .slice(0, 3)
    : [];
  const card = record(page.card);
  const fields = Array.isArray(card?.content) ? card.content.map(record).filter((field): field is Record<string, unknown> => !!field) : [];
  const author = fields.find((field) => field.key === 'author' || /^(作者|原作者)$/.test(text(field.title).replace(/\s/g, '')));
  const authors = author ? cardValues(author).slice(0, 20) : [];
  const id = lemmaId(page.lemmaId);
  const title = text(page.lemmaTitle);
  if (!authors.length || !title || !/^\d{1,20}$/.test(id)) return { candidate: null, related };
  let coverUrl: string | undefined;
  try {
    const url = new URL($('meta[property="og:image"]').attr('content') ?? '');
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && /(?:^|\.)(?:bcebos|bdimg|baidu)\.com$/.test(url.hostname))
      coverUrl = url.href;
  } catch {
    /* Ignore missing or malformed source covers. */
  }
  const description = $('meta[name="description"]').attr('content')?.trim().slice(0, 20000);
  const publisher = fields.find((field) => /^(出版社|出版机构)$/.test(text(field.title).replace(/\s/g, '')));
  const isbn = fields.find((field) => /^ISBN$/i.test(text(field.title).replace(/\s/g, '')));
  const valueFor = (labels: RegExp): string => {
    const field = fields.find((item) => labels.test(text(item.title).replace(/\s/g, '')));
    return field ? cardValues(field).join('、').trim() : '';
  };
  const publication = publicationFields(valueFor(/^(出版时间|出版日期|出版年)$/).replace(/\s/g, ''));
  const rawPages = valueFor(/^(页数|页码)$/).replace(/[,，\s]/g, '');
  const pageCount = /^\d+(?:页)?$/.test(rawPages) ? Number(rawPages.replace(/页$/, '')) : undefined;
  const seriesName = valueFor(/^(丛书|丛书名|丛书名称)$/);

  const isbnValue = isbn
    ? cardValues(isbn)
        .join('')
        .replace(/[^\dXx]/g, '')
    : '';
  return {
    candidate: {
      provider: MetadataProviderKey.BAIDU_BAIKE,
      providerId: id,
      title,
      authors,
      description: description || undefined,
      language: 'zh',
      sourceUrl: `https://wapbaike.baidu.com/item/${encodeURIComponent(title)}/${id}`,
      ...(coverUrl ? { coverUrl } : {}),
      ...(publisher ? { publisher: cardValues(publisher).join('、') } : {}),
      ...publication,
      ...(pageCount && Number.isSafeInteger(pageCount) && pageCount <= 1000000 ? { pageCount } : {}),
      ...(seriesName ? { seriesName } : {}),
      ...(/^\d{13}$/.test(isbnValue) ? { isbn13: isbnValue } : {}),
      ...(/^[\dXx]{10}$/.test(isbnValue) ? { isbn10: isbnValue } : {}),
    },
    related,
  };
}

function lemmaId(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
