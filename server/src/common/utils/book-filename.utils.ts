import { basename, extname } from 'path';

export interface ParsedFilename {
  title: string;
  publishedYear: number | null;
}

/**
 * Derives a display title and optional year from a filename when embedded
 * metadata is absent. Does NOT attempt to extract author — filename
 * conventions vary too much (title-first, author-first, series prefixes, etc.)
 * and a wrong author is worse than no author.
 *
 * Transformations applied:
 *  - Strip file extension
 *  - Strip leading series index ("01. Title" → "Title")
 *  - Replace underscores with spaces
 *  - Collapse duplicate whitespace to single spaces
 *  - Strip trailing year "(YYYY)" and return it separately
 */
export function parseBookFilename(absolutePath: string): ParsedFilename {
  const stem = basename(absolutePath, extname(absolutePath))
    .replace(/^\d+\.\s*/, '') // strip leading "01. "
    .replace(/_+/g, ' ') // underscores → single spaces
    .replace(/\s+/g, ' ')
    .trim();

  // Strip trailing "(YYYY)" or "(YYYY) (extra stuff)" — keep only first 4-digit year
  const yearMatch = stem.match(/\((\d{4})\)/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  // Remove all parenthetical suffixes from the end: "(2020)", "(UK)", "(retail)", etc.
  let title = stem;
  let prev: string;
  do {
    prev = title;
    title = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
  } while (title !== prev);

  title = title.replace(/\s+/g, ' ').trim();

  return { title, publishedYear: year };
}
