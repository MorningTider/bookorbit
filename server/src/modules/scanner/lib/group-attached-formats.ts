import type { BookCandidate } from './walk';

// Explicit database attachments take precedence over loose-file discovery.
export function groupAttachedFormats(
  candidates: BookCandidate[],
  books: Array<{ id: number; folderPath: string }>,
  files: Array<{ bookId: number; absolutePath: string }>,
): BookCandidate[] {
  const bookPaths = new Map(books.map((book) => [book.id, book.folderPath]));
  const owners = new Map(files.map((file) => [file.absolutePath, file.bookId]));
  const grouped = new Map<number, BookCandidate>();
  const result: BookCandidate[] = [];
  for (const candidate of candidates) {
    const candidateOwners = new Set(
      candidate.files.flatMap((file) => {
        const owner = owners.get(file.absolutePath);
        return owner === undefined ? [] : [owner];
      }),
    );

    if (candidateOwners.size > 1) {
      const split = new Map<number | string, BookCandidate>();
      for (const file of candidate.files) {
        const owner = owners.get(file.absolutePath);
        const key = owner ?? `unowned:${file.absolutePath}`;
        let group = split.get(key);
        if (!group) {
          group = { folderPath: owner === undefined ? file.absolutePath : (bookPaths.get(owner) ?? file.absolutePath), files: [] };
          split.set(key, group);
        }
        group.files.push(file);
      }
      result.push(...split.values());
      continue;
    }

    const owner = candidateOwners.values().next().value as number | undefined;
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
