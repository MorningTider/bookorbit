export interface SourceChapter {
  id: string;
  title: string;
}

export interface SourceCatalog {
  title: string;
  authors: string[];
  chapters: SourceChapter[];
  excludedChapters: number;
}

export interface ChapterSourceAdapter {
  key: string;
  catalog(bookId: string, signal: AbortSignal): Promise<SourceCatalog>;
  chapter(bookId: string, chapter: SourceChapter, signal: AbortSignal): Promise<string[]>;
}
