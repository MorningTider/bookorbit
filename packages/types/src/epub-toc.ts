import type { EpubTocItem } from "./epub";

// XML 1.0 allows these whitespace controls and valid Unicode scalars.
export const EPUB_TOC_GROUP_LABEL_PATTERN = /^[\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]+$/u;

export interface EpubTocGroupStart {
  /** Zero-based position in the current directory root entries. */
  index: number;
  label: string;
}

export interface EpubTocOrganization {
  bookId: number;
  fileId: number;
  sha256: string;
  entries: EpubTocItem[];
  suggestedGroups: EpubTocGroupStart[];
  suggestionSource: "existing" | "contents" | "headings" | "none";
}

export interface OrganizeEpubTocRequest {
  expectedSha256: string;
  groups: EpubTocGroupStart[];
}

export interface OrganizeEpubTocResult {
  bookId: number;
  fileId: number;
  changed: boolean;
  groupCount: number;
}

/** Existing root entries become group headings, retaining their original opening links. */
export function groupEpubTocEntries(entries: readonly EpubTocItem[], groups: readonly EpubTocGroupStart[]): EpubTocItem[] {
  let previous = -1;
  for (const group of groups) {
    if (
      !Number.isInteger(group.index) ||
      group.index <= previous ||
      group.index >= entries.length ||
      !group.label.trim() ||
      !EPUB_TOC_GROUP_LABEL_PATTERN.test(group.label)
    ) {
      throw new Error("Invalid EPUB directory group boundary");
    }
    previous = group.index;
  }
  const starts = new Map(groups.map((group) => [group.index, group.label.trim()]));
  const result: EpubTocItem[] = [];
  let current: EpubTocItem | null = null;
  entries.forEach((entry, index) => {
    const label = starts.get(index);
    if (label !== undefined) {
      current = { ...entry, label, children: entry.children?.length ? [...entry.children] : undefined };
      result.push(current);
    } else if (current) {
      (current.children ??= []).push(entry);
    } else {
      result.push(entry);
    }
  });
  return result;
}
