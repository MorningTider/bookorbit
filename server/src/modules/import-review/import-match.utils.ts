import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { ImportIdentity } from '@bookorbit/types';
import { canonicalizeIsbn, mediaFamilyForFormat } from '../book-duplicates/book-duplicate-normalize';

export function normalizeImportText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}
export function importMediaKind(format?: string | null) {
  return format?.toLowerCase() === 'txt' ? ('ebook' as const) : mediaFamilyForFormat(format ?? null);
}
export function importIsbn(identity: ImportIdentity) {
  return canonicalizeIsbn(identity.isbn10 ?? null, identity.isbn13 ?? null);
}
export function matchingImportAuthors(a: string[], b: string[]) {
  const names = new Set(a.map(normalizeImportText).filter(Boolean));
  return b.some((name) => names.has(normalizeImportText(name)));
}
export async function fullFileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function importIsbn10(identity: ImportIdentity): string | null {
  const canonical = importIsbn(identity);
  if (!canonical?.startsWith('978')) return null;
  const body = canonical.slice(3, 12);
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
  const check = (11 - (sum % 11)) % 11;
  return body + (check === 10 ? 'X' : String(check));
}
