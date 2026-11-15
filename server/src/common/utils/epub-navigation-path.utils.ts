import type * as unzipper from 'unzipper';

function safeDecodeURI(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

function joinZipPath(path: string): string {
  const resolved: string[] = [];
  for (const part of path.replace(/^\/+/, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  return resolved.join('/');
}

export function normalizeZipPath(path: string): string {
  return joinZipPath(safeDecodeURI((path ?? '').replace(/\\/g, '/')));
}

export function cleanEpubZipPath(path: string): string {
  return joinZipPath((path ?? '').replace(/\\/g, '/'));
}

export function resolveHref(href: string, basePath: string): string {
  if (!href || /^[a-z][a-z\d+.-]*:/i.test(href)) return href;
  const decoded = safeDecodeURI(href);
  const [pathWithQuery, fragment] = decoded.split('#');
  const path = pathWithQuery.split('?')[0];
  const resolvedPath = path.startsWith('/') ? normalizeZipPath(path) : normalizeZipPath(basePath + path);
  return fragment ? `${resolvedPath}#${fragment}` : resolvedPath;
}

/**
 * An entry named exactly `path` wins. Decoded names are compared only after that: hrefs arrive
 * decoded, so an entry whose name holds a literal escape such as `%20` is found only that way, but
 * it must not answer for the entry its escape decodes to.
 */
export function findEpubZipEntry(files: unzipper.File[], path: string): unzipper.File | undefined {
  const exact = cleanEpubZipPath(path);
  const clean = normalizeZipPath(path);
  const cleanLower = clean.toLowerCase();
  let decodedMatch: unzipper.File | undefined;
  let ciMatch: unzipper.File | undefined;
  for (const file of files) {
    if (cleanEpubZipPath(file.path) === exact) return file;
    const fp = normalizeZipPath(file.path);
    if (!decodedMatch && fp === clean) decodedMatch = file;
    if (!ciMatch && fp.toLowerCase() === cleanLower) ciMatch = file;
  }
  return decodedMatch ?? ciMatch;
}

export { normalizeZipPath as normalizeEpubZipPath, resolveHref as resolveEpubHref };
