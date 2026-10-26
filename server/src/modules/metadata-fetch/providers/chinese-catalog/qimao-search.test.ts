import { describe, expect, it } from 'vitest';
import { parseQimaoSearch } from './qimao-search';
const row = {
  book_id: '1996719',
  title: '凡人修仙',
  author: '测试作者',
  intro: '第一段\\n第二段',
  image_link: 'https://cdn.wtzw.com/bookimg/cover.jpg',
  category2_name: '东方玄幻',
};
describe('Qimao public website API', () => {
  it('maps source identifiers, authors, descriptions, genres and cover URLs', () => {
    expect(parseQimaoSearch({ data: { search_list: [row] } })).toEqual([
      expect.objectContaining({
        provider: 'qimao',
        providerId: '1996719',
        title: '凡人修仙',
        authors: ['测试作者'],
        description: '第一段\n第二段',
        coverUrl: row.image_link,
        genres: ['东方玄幻'],
        sourceUrl: 'https://www.qimao.com/shuku/1996719/',
      }),
    ]);
  });
  it('deduplicates IDs, keeps distinct same-title works and limits results', () => {
    const items = [row, row, ...Array.from({ length: 30 }, (_, i) => ({ ...row, book_id: String(i + 1) }))];
    expect(parseQimaoSearch({ data: { search_list: items } })).toHaveLength(10);
  });
  it('rejects error responses and invalid rows while preserving valid empty searches', () => {
    expect(() => parseQimaoSearch({ code: 1, message: 'failed' })).toThrow('有效的搜索数据');
    expect(parseQimaoSearch({ data: { search_list: [] } })).toEqual([]);
    expect(parseQimaoSearch({ data: { search_list: [null, { book_id: '../bad', title: '坏链接' }, { book_id: '1' }] } })).toEqual([]);
  });
  it('ignores external, credentialed and malformed cover URLs', () => {
    for (const image_link of ['https://example.org/cover', 'javascript:alert(1)', 'https://u:p@cdn.wtzw.com/cover']) {
      expect(parseQimaoSearch({ data: { search_list: [{ ...row, image_link }] } })[0]?.coverUrl).toBeUndefined();
    }
  });
});
