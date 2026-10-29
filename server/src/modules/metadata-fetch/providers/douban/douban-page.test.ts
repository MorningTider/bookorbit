import { describe, expect, it } from 'vitest';
import { doubanCoverUrl, parseDoubanPage, parseDoubanSearchPage } from './douban-page';
const page = `<html><head><link rel="canonical" href="https://book.douban.com/subject/42/"></head><body>
<h1><span property="v:itemreviewed">测试图书</span></h1><div id="mainpic"><img src="https://img9.doubanio.com/view/subject/s/public/cover.jpg"></div>
<div id="info"><span><span class="pl">作者</span>: <a>作者甲</a> / <a>作者乙</a></span><br>
<span class="pl">出版社:</span> 测试出版社<br><span class="pl">出版年:</span> 2015-10-1<br>
<span class="pl">ISBN:</span> 978-7-5443-6232-0<br><span class="pl">页数:</span> 296<br>
<span class="pl">丛书:</span> <a>测试丛书</a><br></div>
<div id="link-report"><div class="intro"><p>简略介绍</p></div><div class="intro"><p>这是完整介绍第一段。</p><p>这是第二段。</p><a class="a_show_full">展开全部</a></div></div></body></html>`;

describe('Douban detail parser', () => {
  it('extracts edition metadata and the full introduction, with paragraph boundaries', () => {
    expect(parseDoubanPage(page, '42')).toMatchObject({
      title: '测试图书',
      authors: ['作者甲', '作者乙'],
      publisher: '测试出版社',
      publishedDate: '2015-10-01',
      publishedYear: 2015,
      isbn13: '9787544362320',
      pageCount: 296,
      seriesName: '测试丛书',
      description: '这是完整介绍第一段。\n\n这是第二段。',
      coverUrl: 'https://img9.doubanio.com/view/subject/l/public/cover.jpg',
    });
  });
  it('rejects verification, unrelated pages and mismatched subject identities', () => {
    expect(() => parseDoubanPage('<title>安全验证</title>', '42')).toThrow('验证');
    expect(() => parseDoubanPage('<h1>豆瓣</h1>', '42')).toThrow('有效的图书');
    expect(() => parseDoubanPage(page, '99')).toThrow('不匹配');
  });
  it('ignores impossible dates and invalid page counts', () => {
    const result = parseDoubanPage(page.replace('2015-10-1', '2015-2-31').replace('296<br>', '-20<br>'), '42');
    expect(result.publishedYear).toBe(2015);
    expect(result.publishedDate).toBeUndefined();
    expect(result.pageCount).toBeUndefined();
  });
  it('does not treat a translator as an author or copy author biographies as book descriptions', () => {
    const result = parseDoubanPage(page.replace('作者</span>', '译者</span>').replace('id="link-report"', 'id="author-report"'), '42');
    expect(result.authors).toBeUndefined();
    expect(result.description).toBeUndefined();
  });
  it('allows only HTTPS Douban image hosts without embedded credentials', () => {
    for (const url of [
      'https://img9.doubanio.com.evil.test/cover',
      'http://img9.doubanio.com/a',
      'https://user:secret@img9.doubanio.com/a',
      'javascript:alert(1)',
    ])
      expect(doubanCoverUrl(url)).toBeUndefined();
    expect(doubanCoverUrl('//img9.doubanio.com/view/subject/s/public/a.jpg')).toBe('https://img9.doubanio.com/view/subject/l/public/a.jpg');
  });
});

describe('Douban public search', () => {
  const row = (url: string, title = '鬼吹灯之龙岭迷窟') =>
    `<div class="result"><div class="pic"><img src="https://img9.doubanio.com/view/subject/s/public/a.jpg"></div><div class="content"><div class="title"><h3><a href="${url}">${title}</a></h3><span class="subject-cast">天下霸唱 / 安徽文艺出版社 / 2006</span></div><p>图书简介</p></div></div>`;
  const wrap = (body: string) => `<div class="search-result"><div class="result-list">${body}</div></div>`;
  it('parses encoded book links and retains author, edition and cover', () => {
    expect(parseDoubanSearchPage(wrap(row('https://www.douban.com/link2/?url=https%3A%2F%2Fbook.douban.com%2Fsubject%2F1916726%2F')))).toMatchObject([
      {
        providerId: '1916726',
        title: '鬼吹灯之龙岭迷窟',
        authors: ['天下霸唱'],
        publisher: '安徽文艺出版社',
        publishedYear: 2006,
        description: '图书简介',
        coverUrl: 'https://img9.doubanio.com/view/subject/l/public/a.jpg',
      },
    ]);
  });
  it('rejects movies, forged hosts, credentials and redirect destinations', () => {
    const urls = [
      'https://movie.douban.com/subject/42/',
      'https://book.douban.com.evil.test/subject/42/',
      'https://user@book.douban.com/subject/42/',
      'https://evil.test/link2/?url=https%3A%2F%2Fbook.douban.com%2Fsubject%2F42%2F',
    ];
    expect(parseDoubanSearchPage(wrap(urls.map((url) => row(url)).join('')))).toEqual([]);
  });
  it('deduplicates and bounds candidates and recognizes genuine empty pages', () => {
    expect(parseDoubanSearchPage(wrap(row('https://book.douban.com/subject/42/').repeat(2)))).toHaveLength(1);
    expect(parseDoubanSearchPage(wrap(Array.from({ length: 35 }, (_, i) => row(`https://book.douban.com/subject/${i + 1}/`)).join('')))).toHaveLength(
      10,
    );
    expect(parseDoubanSearchPage(wrap(''))).toEqual([]);
  });
  it('reports verification and changed markup instead of pretending no matches', () => {
    expect(() => parseDoubanSearchPage('<title>安全验证</title>')).toThrow('验证');
    expect(() => parseDoubanSearchPage('<h1>unrelated</h1>')).toThrow('有效');
  });
});
