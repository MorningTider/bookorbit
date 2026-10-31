export interface ImportDuplicatePolicy {
  contentHash: boolean;
  sourceIdentity: boolean;
  isbn: boolean;
  titleAndAuthor: boolean;
  sameMediaKind: boolean;
  acrossLibraries: boolean;
}
export const DEFAULT_IMPORT_DUPLICATE_POLICY: ImportDuplicatePolicy = {
  contentHash: true,
  sourceIdentity: true,
  isbn: true,
  titleAndAuthor: true,
  sameMediaKind: true,
  acrossLibraries: false,
};
export interface ImportOrigin {
  provider: string;
  id: string;
}
export interface ImportIdentity {
  title?: string;
  authors?: string[];
  isbn10?: string;
  isbn13?: string;
  origin?: ImportOrigin;
  format?: string;
}
export type ImportDuplicateReason = "content_hash" | "source_identity" | "isbn" | "title_author";
export interface ImportDuplicateFile {
  id: number;
  filename: string;
  format: string | null;
  sizeBytes: number | null;
  updatedAt: string;
}
export interface ImportDuplicateMatch {
  bookId: number;
  libraryId: number;
  libraryName: string;
  title: string;
  authors: string[];
  mediaKind: "ebook" | "comic" | "audiobook" | "unknown";
  reasons: ImportDuplicateReason[];
  exact: boolean;
  canEdit?: boolean;
  files: ImportDuplicateFile[];
}
export type ImportResolution =
  { action: "new" } | { action: "attach"; bookId: number } | { action: "replace"; bookId: number; fileId: number; expectedSha256: string };
export interface ImportReviewResponse {
  id: string;
  libraryId: number;
  filename: string;
  format: string;
  sizeBytes: number;
  matches: ImportDuplicateMatch[];
  expiresAt: string;
  incomingFileCount?: number;
}
export interface ImportPolicyResponse {
  global: ImportDuplicatePolicy;
  override: ImportDuplicatePolicy | null;
  effective: ImportDuplicatePolicy;
}
export interface ImportCandidateCheck {
  key: string;
  identity: ImportIdentity;
}
