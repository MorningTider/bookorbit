import { describe, expect, it } from 'vitest';
import { tomatoJobProgress, assertTomatoComplete, tomatoBookId, tomatoJobId, tomatoJobState } from './tomato-protocol';

describe('Tomato download protocol', () => {
  it('accepts numeric book identities and rejects paths or commands', () => {
    expect(tomatoBookId('7290175791344651298')).toBe('7290175791344651298');
    for (const value of ['../../etc/passwd', '1; echo test', '123', 'https://example.com']) expect(() => tomatoBookId(value)).toThrow('ID 无效');
  });
  it('requires a positive safe integer job ID', () => {
    expect(tomatoJobId({ id: 1 })).toBe(1);
    for (const value of [{ id: '1' }, { id: 0 }, { id: NaN }, {}, null]) expect(() => tomatoJobId(value)).toThrow('有效任务 ID');
  });
  it('tracks only the selected job and book', () => {
    expect(tomatoJobState({ items: [{ id: 1, book_id: 'book', state: 'done' }] }, 1, 'book')).toBe('done');
    expect(() => tomatoJobState({ items: [{ id: 1, book_id: 'wrong', state: 'done' }] }, 1, 'book')).toThrow('不匹配');
    expect(() => tomatoJobState({ items: [] }, 1, 'book')).toThrow('任务丢失');
  });
  it('refuses failed or interactive jobs', () => {
    expect(() => tomatoJobState({ items: [{ id: 1, book_id: 'book', state: 'failed' }] }, 1, 'book')).toThrow('下载失败');
    expect(() => tomatoJobState({ items: [{ id: 1, book_id: 'book', state: 'running', format_options: ['txt'] }] }, 1, 'book')).toThrow(
      '交互选择格式',
    );
  });
  it('requires all selected chapters before allowing import', () => {
    expect(() =>
      assertTomatoComplete({ items: [{ book_id: 'book', selected_chapters: 10, success_chapters: 10, failed_chapters: 0 }] }, 'book'),
    ).not.toThrow();
    for (const row of [
      { selected_chapters: 0, success_chapters: 0, failed_chapters: 0 },
      { selected_chapters: 10, success_chapters: 9, failed_chapters: 1 },
      { selected_chapters: 10, success_chapters: 10 },
      { selected_chapters: '10', success_chapters: '10', failed_chapters: 0 },
    ])
      expect(() => assertTomatoComplete({ items: [{ book_id: 'book', ...row }] }, 'book')).toThrow('完整性无法确认');
    expect(() => assertTomatoComplete({ items: [{ book_id: 'other' }] }, 'book')).toThrow('完整性无法确认');
  });
});

it('reports only valid counts for the selected job and book, without estimating missing progress', () => {
  const job = { id: 1, book_id: 'book', progress: { saved_chapters: 25, chapter_total: 100 } };
  expect(tomatoJobProgress({ items: [job] }, 1, 'book')).toEqual({ phase: 'downloading', completedChapters: 25, totalChapters: 100 });
  expect(tomatoJobProgress({ items: [job] }, 2, 'book')).toBeUndefined();
  expect(tomatoJobProgress({ items: [job] }, 1, 'other')).toBeUndefined();
  for (const progress of [
    null,
    {},
    { saved_chapters: '2', chapter_total: 10 },
    { saved_chapters: 11, chapter_total: 10 },
    { saved_chapters: -1, chapter_total: 10 },
    { saved_chapters: 0, chapter_total: 0 },
  ]) {
    expect(tomatoJobProgress({ items: [{ ...job, progress }] }, 1, 'book')).toBeUndefined();
  }
});
