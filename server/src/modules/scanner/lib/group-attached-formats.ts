import type { BookCandidate } from './walk';

// Explicit database attachments take precedence over loose-file discovery.
export function groupAttachedFormats(
  candidates: BookCandidate[],
  books: Array<{ id: number; folderPath: string }>,
  files: Array<{ bookId: number; absolutePath: string }>,
): BookCandidate[] {
  const bookPaths = new Map(books.map(book => [book.id, book.folderPath]));
  const owners = new Map(files.map(file => [file.absolutePath, file.bookId]));
  const grouped = new Map<number, BookCandidate>();
  const result: BookCandidate[] = [];
  for (const candidate of candidates) {
    const owner = candidate.files.length === 1 ? owners.get(candidate.files[0]!.absolutePath) : undefined;
    const folderPath = owner === undefined ? undefined : bookPaths.get(owner);
    if (owner === undefined || !folderPath || !owners.has(folderPath)) {
      result.push(candidate);
      continue;
    }
    let group = grouped.get(owner);
    if (!group) {
      group = { folderPath, files: [] };
      grouped.set(owner, group);
      result.push(group);
    }
    group.files.push(...candidate.files);
  }
  return result;
}
