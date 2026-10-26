import { BadGatewayException } from '@nestjs/common';
import type { PublicChapterRule } from '@bookorbit/types';
import { load } from 'cheerio';
import { safeFetch } from '../../common/utils/safe-fetch';
import { readBoundedText } from '../../common/utils/bounded-response';
import type { ChapterSourceAdapter, SourceChapter } from './chapter-source';

export class RuleChapterSource implements ChapterSourceAdapter {
  readonly key: string;
  constructor(private readonly rule: PublicChapterRule) {
    this.key = rule.key;
  }

  private async read(path: string, signal: AbortSignal) {
    const url = new URL(path, this.rule.origin);
    if (url.origin !== this.rule.origin || url.username || url.password || url.hash) throw new BadGatewayException('章节链接离开了已配置来源');
    const response = await safeFetch(
      url.href,
      {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        redirect: 'error',
        headers: { Accept: 'text/html', 'User-Agent': 'BookOrbit/3.5 (public-chapter-reader)' },
      },
      { pinResolvedAddress: true },
    );
    if (!response.ok) throw new BadGatewayException(`书源请求失败 (HTTP ${response.status})`);
    const $ = load(await readBoundedText(response, 2 * 1024 * 1024));
    if (/验证|登录|访问受限/.test($('title').text())) throw new BadGatewayException('书源要求验证或登录');
    return $;
  }

  async catalog(bookId: string, signal: AbortSignal) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,15}$/.test(bookId)) throw new BadGatewayException('书源编号无效');
    const info = await this.read(this.rule.bookPath.replace('{id}', encodeURIComponent(bookId)), signal);
    const title = info(this.rule.titleSelector).first().text().trim().slice(0, 180);
    const authors = info(this.rule.authorSelector)
      .toArray()
      .slice(0, 20)
      .map((e) => info(e).text().trim())
      .filter(Boolean);
    if (!title) throw new BadGatewayException('书源未返回书名');
    const path = this.rule.catalogPath.replace('{id}', encodeURIComponent(bookId));
    const $ = this.rule.catalogPath === this.rule.bookPath ? info : await this.read(path, signal);
    const chapters: SourceChapter[] = [];
    const seen = new Set<string>();
    const links = $(this.rule.chapterLinkSelector).toArray();
    if (!links.length || links.length > 1000) throw new BadGatewayException('目录为空或超过1000章限制');
    let excludedChapters = 0;
    for (const element of links) {
      const link = $(element);
      if (link.is(this.rule.chapterRestrictedSelector) || link.find(this.rule.chapterRestrictedSelector).length) {
        excludedChapters++;
        continue;
      }
      if (!link.is(this.rule.chapterPublicSelector) && !link.find(this.rule.chapterPublicSelector).length)
        throw new BadGatewayException('目录包含未确认公开状态的章节');
      const raw = link.attr('href');
      if (!raw) throw new BadGatewayException('目录缺少章节链接');
      const url = new URL(raw, new URL(path, this.rule.origin));
      if (url.origin !== this.rule.origin || url.username || url.password || url.hash || seen.has(url.href))
        throw new BadGatewayException('目录包含外站或重复章节');
      seen.add(url.href);
      const name = link.text().trim().slice(0, 200);
      if (!name) throw new BadGatewayException('章节标题缺失');
      chapters.push({ id: url.href, title: name });
    }
    return { title, authors, chapters, excludedChapters };
  }

  async chapter(_bookId: string, chapter: SourceChapter, signal: AbortSignal) {
    const $ = await this.read(chapter.id, signal);
    if ($(this.rule.restrictedPageSelector).length || !$(this.rule.publicPageSelector).length)
      throw new BadGatewayException('章节不是明确公开的正文');
    if ($(this.rule.chapterHeadingSelector).first().text().trim() !== chapter.title) throw new BadGatewayException('章节标题与目录不匹配');
    const body = $(this.rule.contentSelector).clone();
    body.find('script,style,iframe,nav,button').remove();
    const paragraphs = body
      .find('p')
      .addBack('p')
      .toArray()
      .map((e) => $(e).text().trim())
      .filter(Boolean);
    if (!paragraphs.length || paragraphs.join('').length > 100000) throw new BadGatewayException('章节正文为空或超过限制');
    return paragraphs;
  }
}
