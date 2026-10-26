import { describe, expect, it } from 'vitest';
import { groupAttachedFormats } from './group-attached-formats';
import type { BookCandidate, FileStat } from './walk';
const candidate = (path: string): BookCandidate => ({ folderPath: path, files: [{ absolutePath: path } as FileStat] });
describe('groupAttachedFormats', () => {
  it('preserves an explicitly attached EPUB and TXT as one book over repeated scans', () => {
    const books = [{ id: 22, folderPath: '/books/story.txt' }];
    const files = [
      { bookId: 22, absolutePath: '/books/story.txt' },
      { bookId: 22, absolutePath: '/books/story.epub' },
    ];
    for (let scan = 0; scan < 2; scan++) {
      const result = groupAttachedFormats(
        [candidate('/books/story.epub'), candidate('/books/story.txt'), candidate('/books/other.txt')],
        books,
        files,
      );
      expect(result).toHaveLength(2);
      expect(result[0].folderPath).toBe('/books/story.txt');
      expect(result[0].files.map((file) => file.absolutePath)).toEqual(['/books/story.epub', '/books/story.txt']);
    }
  });
  it('does not merge unrelated files or change folder-based books', () => {
    const input = [candidate('/books/a.txt'), candidate('/books/a.epub')];
    expect(groupAttachedFormats(input, [{ id: 1, folderPath: '/books' }], [{ bookId: 1, absolutePath: '/books/a.txt' }])).toEqual(input);
    expect(groupAttachedFormats(input, [], [])).toEqual(input);
  });

  it('keeps a newly discovered matching format with the existing book identity', () => {
    const attached = {
      folderPath: '/books/story.txt',
      files: [candidate('/books/story.txt').files[0]!, candidate('/books/story.epub').files[0]!],
    };

    const result = groupAttachedFormats([attached], [{ id: 22, folderPath: '/books/story.txt' }], [{ bookId: 22, absolutePath: '/books/story.txt' }]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ folderPath: '/books/story.txt' });
    expect(result[0]!.files.map((file) => file.absolutePath)).toEqual(['/books/story.txt', '/books/story.epub']);
  });

  it('does not merge matching editions that already belong to separate books', () => {
    const attached = {
      folderPath: '/books/story.txt',
      files: [candidate('/books/story.txt').files[0]!, candidate('/books/story.epub').files[0]!],
    };

    const result = groupAttachedFormats(
      [attached],
      [
        { id: 22, folderPath: '/books/story.txt' },
        { id: 23, folderPath: '/books/story.epub' },
      ],
      [
        { bookId: 22, absolutePath: '/books/story.txt' },
        { bookId: 23, absolutePath: '/books/story.epub' },
      ],
    );

    expect(result.map((item) => item.folderPath)).toEqual(['/books/story.txt', '/books/story.epub']);
    expect(result.map((item) => item.files.map((file) => file.absolutePath))).toEqual([['/books/story.txt'], ['/books/story.epub']]);
  });
});
