import type { ImportResolution } from "./import-review";

export const GITHUB_BOOK_FORMATS = ["epub", "pdf", "mobi", "azw3", "txt", "fb2"] as const;
export type GithubBookFormat = (typeof GITHUB_BOOK_FORMATS)[number];

export interface GithubRepositoryInput {
  id?: number;
  label: string;
  repository: string;
  branch: string;
  path: string;
  formats: GithubBookFormat[];
  enabled: boolean;
}
export interface GithubBookRepository extends GithubRepositoryInput {
  id: number;
  indexState: "idle" | "indexing" | "ready" | "failed";
  fileCount: number;
  indexedAt: string | null;
  error: string | null;
}
export interface GithubBookSourceConfig {
  revision: string;
  enabled: boolean;
  repositories: GithubBookRepository[];
}
export interface GithubBookSourceUpdate {
  revision: string;
  enabled: boolean;
  repositories: GithubRepositoryInput[];
}
export interface GithubSourceFile {
  repositoryId: number;
  repository: string;
  repositoryLabel: string;
  branch: string;
  rootPath: string;
  path: string;
  commitSha: string;
  blobSha: string;
  format: GithubBookFormat;
  sizeBytes: number;
  title: string;
  filename: string;
}
export interface GithubSourceCandidate extends Omit<GithubSourceFile, "blobSha" | "sizeBytes"> {
  id: number;
  blobSha: string | null;
  sizeBytes: number | null;
}
export interface GithubSourceSearchPage {
  items: GithubSourceCandidate[];
  nextCursor: string | null;
}
export interface GithubAcquisitionRequest {
  entryId: number;
  blobSha: string | null;
  folderId?: number;
  importResolution?: ImportResolution;
}
