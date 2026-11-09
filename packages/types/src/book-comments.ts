export type BookCommentScope = "review" | "chapter" | "paragraph";

export interface BookComment {
  id: number;
  bookId: number;
  userId: number;
  authorName: string;
  parentId: number | null;
  threadId: number | null;
  scope: BookCommentScope;
  bookFileId: number | null;
  chapterHref: string | null;
  chapterTitle: string | null;
  cfi: string | null;
  quote: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  canDelete: boolean;
  deleteMode: "own" | "moderate" | null;
}

export interface BookCommentPage {
  items: BookComment[];
  nextCursor: number | null;
}

export interface CreateBookComment {
  clientId: string;
  body: string;
  parentId?: number;
  scope?: BookCommentScope;
  bookFileId?: number;
  chapterHref?: string;
  chapterTitle?: string;
  cfi?: string;
  quote?: string;
}
