import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { load } from 'cheerio';
import { safeFetch } from '../../common/utils/safe-fetch';
import { readBoundedText } from '../../common/utils/bounded-response';
import type { ChapterSourceAdapter, SourceCatalog, SourceChapter } from './chapter-source';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadGatewayException('起点页面结构已变化');
  return value as Record<string, unknown>;
}

export function qidianBookId(value: string): string {
  if (!/^[1-9]\d{0,15}$/.test(value)) throw new BadRequestException('起点书籍编号无效');
  return value;
}

export function qidianPageData(html: string): Record<string, unknown> {
  const $ = load(html);
  if (/验证|访问受限|登录/.test($('title').text())) throw new BadGatewayException('起点要求登录或访问验证');
  try {
    const data = object(JSON.parse($('#vite-plugin-ssr_pageContext').text()));
    return object(object(object(data.pageContext).pageProps).pageData);
  } catch {
    throw new BadGatewayException('起点未返回有效的公开章节数据');
  }
}

export function parseQidianCatalog(html: string, bookId: string): SourceCatalog {
  const page = qidianPageData(html);
  if (String(page.bookId) !== bookId || typeof page.bookName !== 'string' || !page.bookName.trim() || !Array.isArray(page.vs))
    throw new BadGatewayException('起点目录与书籍不匹配');
  const chapters: SourceChapter[] = [];
  const ids = new Set<string>();
  let excludedChapters = 0;
  let total = 0;
  if (page.vs.length > 1000) throw new BadGatewayException('起点目录超过限制');
  for (const raw of page.vs) {
    const volume = object(raw);
    if (!Array.isArray(volume.cs) || ![0, 1].includes(volume.vS as number)) throw new BadGatewayException('无法确认起点卷的公开状态');
    for (const item of volume.cs) {
      const row = object(item);
      const id = String(row.id);
      if (!/^[1-9]\d{0,19}$/.test(id) || typeof row.cN !== 'string' || !row.cN.trim() || ids.has(id))
        throw new BadGatewayException('起点目录包含无效或重复章节');
      ids.add(id);
      if (++total > 10000) throw new BadGatewayException('起点目录超过10000章');
      if (volume.vS !== 0) {
        excludedChapters++;
        continue;
      }
      chapters.push({ id, title: row.cN.trim().slice(0, 200) });
    }
  }
  if (!Number.isSafeInteger(page.chapterTotalCnt) || page.chapterTotalCnt !== total) throw new BadGatewayException('起点目录不完整');
  if (!chapters.length || chapters.length > 1000) throw new BadGatewayException('未找到公开免费卷，或免费章节超过1000章限制');
  const author = object(page.authorInfo);
  return {
    title: page.bookName.trim().slice(0, 180),
    authors: typeof author.authorName === 'string' ? [author.authorName.slice(0, 200)] : [],
    chapters,
    excludedChapters,
  };
}

export function parseQidianChapter(html: string, bookId: string, chapter: SourceChapter): string[] {
  const page = qidianPageData(html);
  const info = object(page.chapterInfo);
  const book = object(page.bookInfo);
  if (String(book.bookId) !== bookId || String(info.chapterId) !== chapter.id || info.chapterName !== chapter.title)
    throw new BadGatewayException('起点章节与请求不匹配');
  if (info.vipStatus !== 0 || info.limitFree !== 0 || typeof info.content !== 'string' || !info.content.trim())
    throw new BadGatewayException('章节不是明确公开的免费正文');
  const $ = load(info.content);
  $('script,style,iframe').remove();
  const paragraphs = $('p')
    .toArray()
    .map((p) => $(p).text().trim())
    .filter(Boolean);
  if (!paragraphs.length) throw new BadGatewayException('起点章节正文缺失');
  const text = paragraphs.join('');
  if (/^(?:订阅本章|购买本章|登录后阅读|解锁本章|内容加载失败|请输入验证码)[。！!\s]*$/.test(text))
    throw new BadGatewayException('章节需要验证、购买或未完整加载');
  if (typeof info.wordsCount !== 'number' || info.wordsCount <= 0 || text.length < info.wordsCount * 0.8 || text.length > 100000)
    throw new BadGatewayException('起点章节长度不完整或超过限制');
  return paragraphs;
}

@Injectable()
export class QidianChapterSource implements ChapterSourceAdapter {
  readonly key = 'qidian';

  private async read(path: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
    const response = await safeFetch(
      `https://m.qidian.com${path}`,
      { redirect: 'error', signal: deadline, headers: { Accept: 'text/html', 'User-Agent': 'BookOrbit/3.5 (public-chapter-reader)' } },
      { pinResolvedAddress: true },
    );
    if (!response.ok) throw new BadGatewayException(`起点访问失败 (HTTP ${response.status})`);
    return readBoundedText(response, 2 * 1024 * 1024);
  }

  async catalog(bookId: string, signal: AbortSignal) {
    qidianBookId(bookId);
    return parseQidianCatalog(await this.read(`/book/${bookId}/catalog/`, signal), bookId);
  }

  async chapter(bookId: string, chapter: SourceChapter, signal: AbortSignal) {
    qidianBookId(bookId);
    if (!/^[1-9]\d{0,19}$/.test(chapter.id)) throw new BadRequestException('章节编号无效');
    return parseQidianChapter(await this.read(`/chapter/${bookId}/${chapter.id}/`, signal), bookId, chapter);
  }
}
