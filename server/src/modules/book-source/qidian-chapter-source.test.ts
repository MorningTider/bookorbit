import { describe, it, expect } from 'vitest';
import { parseQidianCatalog, parseQidianChapter, qidianBookId } from './qidian-chapter-source';
function page(pageData: unknown) {
  return `<title>公开阅读</title><script id="vite-plugin-ssr_pageContext">${JSON.stringify({ pageContext: { pageProps: { pageData } } })}</script>`;
}
const chapter = { id: '201', title: '第一章开始' };
const catalog = {
  bookId: 101,
  bookName: '公开测试作品',
  chapterTotalCnt: 2,
  authorInfo: { authorName: '作者' },
  vs: [
    { vS: 0, cs: [{ id: 201, cN: chapter.title }] },
    { vS: 1, cs: [{ id: 202, cN: 'VIP章节' }] },
  ],
};
const body = {
  bookInfo: { bookId: 101 },
  chapterInfo: { chapterId: 201, chapterName: chapter.title, vipStatus: 0, limitFree: 0, wordsCount: 6, content: '<p>公开正文一段</p><p>另一段</p>' },
};
describe('Qidian public chapter boundaries', () => {
  it('selects free volumes and excludes VIP even when HTML labels say free', () => {
    expect(parseQidianCatalog(page(catalog) + '<a>VIP章节 免费</a>', '101')).toEqual({
      title: '公开测试作品',
      authors: ['作者'],
      chapters: [chapter],
      excludedChapters: 1,
    });
  });
  it('rejects mismatched books, incomplete catalogues, unknown access and duplicates', () => {
    expect(() => parseQidianCatalog(page(catalog), '102')).toThrow('不匹配');
    expect(() => parseQidianCatalog(page({ ...catalog, chapterTotalCnt: 3 }), '101')).toThrow('不完整');
    expect(() => parseQidianCatalog(page({ ...catalog, vs: [{ vS: 2, cs: [] }] }), '101')).toThrow('公开状态');
    expect(() => parseQidianCatalog(page({ ...catalog, vs: [catalog.vs[0], catalog.vs[0]] }), '101')).toThrow('重复');
  });
  it.each(['../x', 'https://localhost/', '1?x=1', '0', '12345678901234567'])('rejects invalid source IDs %s', (id) =>
    expect(() => qidianBookId(id)).toThrow(),
  );
  it('extracts paragraphs only after chapter identity and access checks', () => {
    expect(parseQidianChapter(page(body), '101', chapter)).toEqual(['公开正文一段', '另一段']);
  });
  it.each([
    { vipStatus: 1 },
    { vipStatus: undefined },
    { limitFree: 1 },
    { content: '' },
    { content: '<p>订阅本章</p>' },
    { wordsCount: 10000 },
    { chapterId: 202 },
  ])('rejects restricted, preview, changed or incomplete content %j', (fields) => {
    expect(() => parseQidianChapter(page({ ...body, chapterInfo: { ...body.chapterInfo, ...fields } }), '101', chapter)).toThrow();
  });
  it('rejects login or challenge pages instead of treating them as chapter text', () => {
    expect(() => parseQidianChapter('<title>访问验证</title>', '101', chapter)).toThrow('验证');
  });
  it('does not mistake ordinary story text about verification for a challenge page', () => {
    const value = { ...body, chapterInfo: { ...body.chapterInfo, content: '<p>他收到了验证码，随后继续故事。</p>' } };
    expect(parseQidianChapter(page(value), '101', chapter)).toEqual(['他收到了验证码，随后继续故事。']);
  });
});
