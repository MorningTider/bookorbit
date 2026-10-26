import { describe, expect, it } from 'vitest';
import { parseBaiduMobilePage } from './baidu-page';
function html(page: Record<string, unknown>) {
  return `<title>余罪_百度百科</title><meta name="description" content="小说简介"><meta property="og:image" content="https://bkimg.cdn.bcebos.com/pic/cover.jpg"><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { pageData: page } } })}</script>`;
}
const book = {
  lemmaId: 2970484,
  lemmaTitle: '余罪',
  lemmaDesc: '常书欣创作都市类小说',
  card: {
    content: [
      {
        key: 'author',
        title: '作者',
        data: [
          {
            text: [
              { tag: 'innerlink', text: '常书欣' },
              { tag: 'ref', text: '错误引用' },
            ],
          },
        ],
      },
      { title: '出版社', data: [{ text: [{ tag: 'text', text: '海南出版社' }] }] },
      { title: 'ISBN', data: [{ text: [{ tag: 'text', text: '978-7544362320' }] }] },
    ],
  },
};
describe('Baidu public mobile data', () => {
  it('extracts real Next.js card structure without reference footnotes', () => {
    expect(parseBaiduMobilePage(html(book)).candidate).toMatchObject({
      provider: 'baiduBaike',
      providerId: '2970484',
      title: '余罪',
      authors: ['常书欣'],
      publisher: '海南出版社',
      isbn13: '9787544362320',
      description: '小说简介',
      coverUrl: 'https://bkimg.cdn.bcebos.com/pic/cover.jpg',
    });
  });
  it('follows literary homonyms and excludes television series and fictional characters', () => {
    const page = {
      lemmaId: 17366760,
      lemmaTitle: '余罪',
      card: { content: [{ key: 'originalAuthor', title: '原著', data: [{ text: [{ tag: 'text', text: '常书欣' }] }] }] },
      navigation: {
        lemmas: [
          { lemmaId: 2970484, lemmaTitle: '余罪', lemmaDesc: '常书欣创作都市类小说', classify: ['文学作品'] },
          { lemmaId: 19768831, lemmaTitle: '余罪', lemmaDesc: '小说中的角色' },
          { lemmaId: 17366760, lemmaTitle: '余罪', lemmaDesc: '同名电视剧' },
          { lemmaId: 'http://127.0.0.1', lemmaTitle: '坏链接', lemmaDesc: '小说' },
        ],
      },
    };
    expect(parseBaiduMobilePage(html(page))).toEqual({ candidate: null, related: [{ id: '2970484', title: '余罪' }] });
  });
  it('bounds related pages and refuses invalid payloads and security challenges', () => {
    const page = { navigation: { lemmas: Array.from({ length: 300 }, (_, i) => ({ lemmaId: i + 1, lemmaTitle: '书籍', lemmaDesc: '小说' })) } };
    expect(parseBaiduMobilePage(html(page)).related).toHaveLength(3);
    expect(() => parseBaiduMobilePage('<title>百度安全验证</title>')).toThrow('访问验证');
    expect(() => parseBaiduMobilePage('<html>首页</html>')).toThrow('有效的词条');
    expect(() => parseBaiduMobilePage('<script id="__NEXT_DATA__">bad</script>')).toThrow('无法解析');
  });
  it('does not return a non-book as an empty-author candidate or accept unsafe cover URLs', () => {
    expect(parseBaiduMobilePage(html({ lemmaId: 1, lemmaTitle: '同名人物' })).candidate).toBeNull();
    expect(
      parseBaiduMobilePage(html(book).replace('https://bkimg.cdn.bcebos.com/pic/cover.jpg', 'https://user:secret@bkimg.cdn.bcebos.com/cover'))
        .candidate?.coverUrl,
    ).toBeUndefined();
    expect(
      parseBaiduMobilePage(html(book).replace('https://bkimg.cdn.bcebos.com/pic/cover.jpg', 'https://example.org/cover')).candidate?.coverUrl,
    ).toBeUndefined();
  });
  function withFields(values: Record<string, string>) {
    return html({
      ...book,
      card: {
        content: [
          ...book.card.content,
          ...Object.entries(values).map(([title, value]) => ({ title, data: [{ text: [{ tag: 'text', text: value }] }] })),
        ],
      },
    });
  }
  it('extracts publication date, page count and series from explicit book fields', () => {
    expect(parseBaiduMobilePage(withFields({ 出版时间: '2015年10月1日', 页数: '296页', 丛书名称: '余罪系列' })).candidate).toMatchObject({
      publishedYear: 2015,
      publishedDate: '2015-10-01',
      pageCount: 296,
      seriesName: '余罪系列',
    });
  });
  it.each(['2015', '2015年10月', '2015-10'])('preserves year without inventing an exact date: %s', (value) => {
    const candidate = parseBaiduMobilePage(withFields({ 出版日期: value })).candidate;
    expect(candidate?.publishedYear).toBe(2015);
    expect(candidate?.publishedDate).toBeUndefined();
  });
  it.each(['2015-02-29', '2024-02-30', '2024-00-10', '2024-13-01', '2024年春', '2020-2021', '未知'])(
    'does not infer a date from invalid or ambiguous values: %s',
    (value) => {
      const candidate = parseBaiduMobilePage(withFields({ 出版时间: value })).candidate;
      expect(candidate?.publishedYear).toBeUndefined();
      expect(candidate?.publishedDate).toBeUndefined();
    },
  );
  it('accepts a leap day and bounded page counts, without treating word counts as pages', () => {
    expect(parseBaiduMobilePage(withFields({ 出版时间: '2024/2/29', 页数: '1,296' })).candidate).toMatchObject({
      publishedDate: '2024-02-29',
      pageCount: 1296,
    });
    expect(parseBaiduMobilePage(withFields({ 字数: '123456' })).candidate?.pageCount).toBeUndefined();
  });
  it.each(['0', '-1', '1000001', '300万字', '296-300', '未知'])('ignores invalid page counts: %s', (value) => {
    expect(parseBaiduMobilePage(withFields({ 页数: value })).candidate?.pageCount).toBeUndefined();
  });
});
