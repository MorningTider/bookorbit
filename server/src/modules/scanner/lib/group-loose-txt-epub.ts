import { basename, dirname, extname, resolve } from 'path';

import type { BookCandidate } from './walk';

interface EditionCandidates {
  txt: BookCandidate[];
  epub: BookCandidate[];
}

function editionKey(candidate: BookCandidate): { key: string; format: 'txt' | 'epub' } | null {
  if (candidate.files.length !== 1) return null;

  const file = candidate.files[0]!;
  const format = file.format?.toLowerCase();
  if (format !== 'txt' && format !== 'epub') return null;

  const path = file.absolutePath;
  const stem = basename(path, extname(path)).trim().toLowerCase();
  if (!stem) return null;

  return { key: `${resolve(dirname(path))}\0${stem}`, format };
}

/** Joins a matching loose TXT and EPUB before an initial scan creates duplicate book records. */
export function groupLooseTxtEpubCandidates(candidates: BookCandidate[]): BookCandidate[] {
  const editions = new Map<string, EditionCandidates>();
  for (const candidate of candidates) {
    const edition = editionKey(candidate);
    if (!edition) continue;

    const current = editions.get(edition.key) ?? { txt: [], epub: [] };
    current[edition.format].push(candidate);
    editions.set(edition.key, current);
  }

  const grouped = new Map<BookCandidate, BookCandidate | null>();
  for (const { txt, epub } of editions.values()) {
    if (txt.length !== 1 || epub.length !== 1) continue;

    const [textCandidate] = txt;
    const [epubCandidate] = epub;
    if (!textCandidate || !epubCandidate) continue;

    grouped.set(textCandidate, {
      folderPath: textCandidate.folderPath,
      files: [...textCandidate.files, ...epubCandidate.files],
    });
    grouped.set(epubCandidate, null);
  }

  return candidates.flatMap((candidate) => {
    if (!grouped.has(candidate)) return [candidate];
    const match = grouped.get(candidate);
    return match ? [match] : [];
  });
}
