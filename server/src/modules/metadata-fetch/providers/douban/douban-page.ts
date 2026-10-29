import { BadGatewayException } from '@nestjs/common';
import { MetadataProviderKey, type MetadataCandidate } from '@bookorbit/types';
import { load } from 'cheerio';

export function doubanCoverUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value, 'https://book.douban.com');
    if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)doubanio\.com$/i.test(url.hostname)) return undefined;
    return url.href.replace('/s/public/', '/l/public/');
  } catch {
    return undefined;
  }
}

export function parseDoubanPage(html: string, providerId: string): MetadataCandidate {
  const $ = load(html);
  if (/验证|验证码|访问受限/.test($('title').text())) throw new BadGatewayException('豆瓣要求访问验证，无法获取详情');
  const title = $('h1 [property="v:itemreviewed"]').first().text().trim();
  if (!title || !$('#info').length) throw new BadGatewayException('豆瓣未返回有效的图书详情');
  const canonical = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content');
  if (canonical) {
    try {
      if (new URL(canonical, 'https://book.douban.com').pathname !== `/subject/${providerId}/`)
        throw new BadGatewayException('豆瓣详情与书籍标识不匹配');
    } catch {
      throw new BadGatewayException('豆瓣详情与书籍标识不匹配');
    }
  }
  const fields = new Map<string, string>();
  const authors: string[] = [];
  $('#info .pl').each((_, element) => {
    const label = $(element);
    const name = label.text().replace(/[\s:：]/g, '');
    const siblings = label.parent().contents().toArray();
    const parts: string[] = [];
    for (const node of siblings.slice(siblings.indexOf(element) + 1)) {
      if ($(node).is('br')) break;
      parts.push($(node).text());
      if (name === '作者') {
        if ($(node).is('a')) authors.push($(node).text().trim());
        else
          $(node)
            .find('a')
            .each((_, anchor) => {
              authors.push($(anchor).text().trim());
            });
      }
    }
    fields.set(
      name,
      parts
        .join('')
        .replace(/^\s*[:：]\s*/, '')
        .trim()
        .slice(0, 1000),
    );
  });
  const descriptions = $('#link-report .intro')
    .toArray()
    .map((element) => {
      const copy = $(element).clone();
      copy.find('script, style, .a_show_full').remove();
      return copy.find('p').length
        ? copy
            .find('p')
            .toArray()
            .map((p) => $(p).text().trim())
            .filter(Boolean)
            .join('\n\n')
        : copy.text().trim();
    });
  const description = descriptions.sort((a, b) => b.length - a.length)[0]?.slice(0, 20000);
  const isbn = fields
    .get('ISBN')
    ?.replace(/[^0-9X]/gi, '')
    .toUpperCase();
  const pages = Number(fields.get('页数'));
  const publication = fields.get('出版年')?.match(/^(\d{4})(?:[-年](\d{1,2}))?(?:[-月](\d{1,2}))?/);
  const year = publication ? Number(publication[1]) : undefined;
  let publishedDate: string | undefined;
  if (publication?.[2] && publication[3]) {
    const date = `${publication[1]}-${publication[2].padStart(2, '0')}-${publication[3].padStart(2, '0')}`;
    const parsed = new Date(date);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(date)) publishedDate = date;
  }
  const coverUrl = doubanCoverUrl($('#mainpic img').first().attr('src'));
  return {
    provider: MetadataProviderKey.DOUBAN,
    providerId,
    title,
    language: 'zh',
    sourceUrl: `https://book.douban.com/subject/${providerId}/`,
    ...(authors.length ? { authors: [...new Set(authors.filter(Boolean))].slice(0, 10) } : {}),
    ...(description ? { description } : {}),
    ...(fields.get('出版社') ? { publisher: fields.get('出版社') } : {}),
    ...(year && year > 0 ? { publishedYear: year } : {}),
    ...(publishedDate ? { publishedDate } : {}),
    ...(Number.isSafeInteger(pages) && pages > 0 && pages <= 1000000 ? { pageCount: pages } : {}),
    ...(isbn?.length === 13 ? { isbn13: isbn } : isbn?.length === 10 ? { isbn10: isbn } : {}),
    ...(fields.get('丛书') ? { seriesName: fields.get('丛书') } : {}),
    ...(coverUrl ? { coverUrl } : {}),
  };
}

export function parseDoubanSearchPage(html: string): MetadataCandidate[] {
  const $ = load(html);
  if (/验证|验证码|访问受限/.test($('title').text())) throw new BadGatewayException('豆瓣要求访问验证，无法搜索图书');
  if (!$('.search-result').length) throw new BadGatewayException('豆瓣未返回有效的图书搜索页');
  const results: MetadataCandidate[] = [];
  const seen = new Set<string>();
  $('.result-list .result')
    .slice(0, 30)
    .each((_, element) => {
      if (results.length >= 10) return;
      const row = $(element);
      const anchor = row.find('.title h3 a').first();
      let target: URL;
      try {
        target = new URL(anchor.attr('href') ?? '', 'https://www.douban.com');
        if (target.origin === 'https://www.douban.com' && target.pathname === '/link2/') target = new URL(target.searchParams.get('url') ?? '');
      } catch {
        return;
      }
      if (target.origin !== 'https://book.douban.com' || target.username || target.password) return;
      const id = target.pathname.match(/^\/subject\/(\d{1,20})\/$/)?.[1];
      const title = anchor.text().trim().slice(0, 200);
      if (!id || !title || seen.has(id)) return;
      seen.add(id);
      const fields = row
        .find('.subject-cast')
        .text()
        .split(' / ')
        .map((value) => value.trim());
      const year = Number(fields.at(-1));
      const coverUrl = doubanCoverUrl(row.find('.pic img').attr('src'));
      const description = row.find('.content > p').text().trim().slice(0, 20000);
      results.push({
        provider: MetadataProviderKey.DOUBAN,
        providerId: id,
        title,
        authors: fields[0] ? [fields[0]] : [],
        language: 'zh',
        sourceUrl: target.href,
        ...(fields.length >= 3 && fields[1] ? { publisher: fields[1] } : {}),
        ...(Number.isInteger(year) && year > 0 ? { publishedYear: year } : {}),
        ...(coverUrl ? { coverUrl } : {}),
        ...(description ? { description } : {}),
      });
    });
  return results;
}
