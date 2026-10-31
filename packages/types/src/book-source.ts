import type { ImportResolution } from "./import-review";
export interface FanqieAcquisitionRequest {
  bookId: string;
  folderId?: number;
  importResolution?: ImportResolution;
}

export type ChapterAcquisitionRequest = FanqieAcquisitionRequest;

export interface BookSourceStatus {
  qidian?: { enabled?: boolean; configured: boolean; format: "epub"; scope: "public-free-volumes" };
  fanqie: { enabled?: boolean; configured: boolean; format: "epub" };
}

export type BookSourceJobStatus = "queued" | "downloading" | "importing" | "completed" | "failed" | "cancelled" | "awaiting_choice";
export interface BookSourceJobProgress {
  phase: "preparing" | "downloading" | "validating";
  completedChapters?: number;
  totalChapters?: number;
  title?: string;
}
export interface BookSourceJob {
  id: number;
  libraryId: number;
  sourceBookId: string;
  source?: string;
  title: string;
  status: BookSourceJobStatus;
  retryable: boolean;
  attempts: number;
  progress?: BookSourceJobProgress;
  cancelRequested: boolean;
  resultBookId: number | null;
  reviewId?: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface BookSourceJobPage {
  items: BookSourceJob[];
  nextCursor: number | null;
}

export interface PublicChapterRule {
  key: string;
  label: string;
  origin: string;
  bookPath: string;
  catalogPath: string;
  titleSelector: string;
  authorSelector: string;
  chapterLinkSelector: string;
  chapterPublicSelector: string;
  chapterRestrictedSelector: string;
  chapterHeadingSelector: string;
  publicPageSelector: string;
  restrictedPageSelector: string;
  contentSelector: string;
}
export interface PublicChapterSource {
  key: string;
  label: string;
}
export interface RuleChapterAcquisitionRequest {
  source: string;
  bookId: string;
  folderId?: number;
}
export interface PublicChapterRulesUpdate {
  sources: PublicChapterRule[];
}

export interface BookSourceRetryRequest {
  confirmedImportNotCompleted?: true;
}
