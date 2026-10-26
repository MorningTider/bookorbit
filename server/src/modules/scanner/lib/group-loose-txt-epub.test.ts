import { describe, expect, it } from 'vitest';

import type { BookCandidate, FileStat } from './walk';
import { groupLooseTxtEpubCandidates } from './group-loose-txt-epub';

function candidate(path: string, format: string): BookCandidate {
  return { folderPath: path, files: [{ absolutePath: path, format } as FileStat] };
}

describe('groupLooseTxtEpubCandidates', () => {
  it('pairs one same-folder TXT and EPUB before a first scan', () => {
    const input = [candidate('/books/story.epub', 'epub'), candidate('/books/story.txt', 'txt'), candidate('/books/other.txt', 'txt')];

    expect(groupLooseTxtEpubCandidates(input)).toEqual([
      {
        folderPath: '/books/story.txt',
        files: [
          { absolutePath: '/books/story.txt', format: 'txt' },
          { absolutePath: '/books/story.epub', format: 'epub' },
        ],
      },
      input[2],
    ]);
  });

  it('does not pair different directories, other formats, or ambiguous duplicate editions', () => {
    const input = [
      candidate('/books/a/story.txt', 'txt'),
      candidate('/books/b/story.epub', 'epub'),
      candidate('/books/story.pdf', 'pdf'),
      candidate('/books/duplicate.txt', 'txt'),
      candidate('/books/duplicate.epub', 'epub'),
      candidate('/books/duplicate.epub', 'epub'),
    ];

    expect(groupLooseTxtEpubCandidates(input)).toEqual(input);
  });

  it('leaves folder candidates containing multiple files untouched', () => {
    const folder = {
      folderPath: '/books/story',
      files: [
        { absolutePath: '/books/story/story.txt', format: 'txt' },
        { absolutePath: '/books/story/story.epub', format: 'epub' },
      ] as FileStat[],
    };

    expect(groupLooseTxtEpubCandidates([folder])).toEqual([folder]);
  });
});
