import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'fs';
import { mkdir, open, rm, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { createInterface } from 'readline';
import { finished, pipeline } from 'stream/promises';
import { once } from 'events';
import type { Transform } from 'node:stream';
import { ZipArchive } from 'archiver';
import iconv from 'iconv-lite';
import { BadRequestException } from '@nestjs/common';

const MAX_TXT_CONVERSION_BYTES = 128 * 1024 * 1024;
const MAX_CHAPTERS = 10000;

type TxtEncoding = 'utf8' | 'gb18030' | 'utf16le' | 'utf16be';
type TxtChapterMode = 'auto' | 'chinese' | 'english' | 'single';

export interface TxtConversionOptions {
  signal?: AbortSignal;
  maxSectionCharacters?: number;
  chapterMarker?: string;
  encoding?: 'auto' | TxtEncoding;
  chapters?: TxtChapterMode;
  language?: string;
  authors?: string[];
  description?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  isbn?: string | null;
  cover?: { bytes: Buffer; mediaType: 'image/jpeg' | 'image/png' };
}

interface TxtSection {
  title: string;
  path: string;
  stream: WriteStream;
  completion: Promise<void>;
  hasParagraphs: boolean;
}

function escapeXml(value: string): string {
  return value
    .replace(/[\p{Cc}\uFFFE\uFFFF]/gu, (character) => (['\t', '\n', '\r'].includes(character) ? character : ''))
    .replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

async function detectTxtEncoding(
  sourcePath: string,
  requested: TxtConversionOptions['encoding'],
  signal?: AbortSignal,
): Promise<{ encoding: TxtEncoding; bomBytes: number }> {
  const file = await open(sourcePath, 'r');
  const prefix = Buffer.alloc(3);
  let bytesRead: number;
  try {
    ({ bytesRead } = await file.read(prefix, 0, prefix.length, 0));
  } finally {
    await file.close();
  }

  const header = prefix.subarray(0, bytesRead);
  const hasUtf8Bom = header.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  const hasUtf16LeBom = header.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]));
  const hasUtf16BeBom = header.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]));

  if (requested && requested !== 'auto') {
    const bomBytes =
      (requested === 'utf8' && hasUtf8Bom) || (requested === 'utf16le' && hasUtf16LeBom) || (requested === 'utf16be' && hasUtf16BeBom)
        ? requested === 'utf8'
          ? 3
          : 2
        : 0;
    return { encoding: requested, bomBytes };
  }

  if (hasUtf8Bom) return { encoding: 'utf8', bomBytes: 3 };
  if (hasUtf16LeBom) return { encoding: 'utf16le', bomBytes: 2 };
  if (hasUtf16BeBom) return { encoding: 'utf16be', bomBytes: 2 };
  return { encoding: (await isValidUtf8(sourcePath, signal)) ? 'utf8' : 'gb18030', bomBytes: 0 };
}

async function isValidUtf8(sourcePath: string, signal?: AbortSignal): Promise<boolean> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const input = createReadStream(sourcePath, { signal });
  let invalid = false;
  try {
    for await (const chunk of input) {
      if (invalid) continue;
      try {
        decoder.decode(chunk as Buffer, { stream: true });
      } catch {
        invalid = true;
      }
    }
    if (invalid) return false;
    decoder.decode();
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

function isChapterHeading(line: string, mode: TxtChapterMode | undefined): boolean {
  if (line.length > 100 || mode === 'single') return false;
  const chineseHeading =
    /^(?:第[零〇一二三四五六七八九十百千万两\d]+[章节卷回部篇].*|(?:序章|序言|楔子|前言|后记|尾声|番外(?:篇)?)(?:[\s:：].*)?)$/.test(line);
  const englishHeading = /^chapter\s+\d+(?:\s*[:.-].*|\s+.*)?$/i.test(line);
  if (mode === 'chinese') return chineseHeading;
  if (mode === 'english') return englishHeading;
  return chineseHeading || englishHeading;
}

async function startSection(directory: string, index: number, title: string): Promise<TxtSection> {
  const path = join(directory, `section-${index}.xhtml`);
  const stream = createWriteStream(path, { flags: 'wx', mode: 0o600 });
  const completion = finished(stream);
  void completion.catch(() => {});
  await once(stream, 'open');
  const section = { title, path, stream, completion, hasParagraphs: false };
  await writeSection(
    section,
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(title)}</title></head><body><h1>${escapeXml(title)}</h1>`,
  );
  return section;
}

async function writeSection(section: TxtSection, value: string): Promise<void> {
  if (!section.stream.write(value)) await once(section.stream, 'drain');
}

async function finishSection(section: TxtSection): Promise<void> {
  await writeSection(section, '</body></html>');
  section.stream.end();
  await section.completion;
}

async function parseSections(sourcePath: string, directory: string, title: string, options: TxtConversionOptions): Promise<TxtSection[]> {
  const { encoding, bomBytes } = await detectTxtEncoding(sourcePath, options.encoding, options.signal);
  if (encoding === 'utf8' && (options.encoding === 'utf8' || bomBytes === 3) && !(await isValidUtf8(sourcePath, options.signal)))
    throw new BadRequestException('TXT不是有效UTF-8，请选择正确的编码');
  if ((encoding === 'utf16le' || encoding === 'utf16be') && ((await stat(sourcePath)).size - bomBytes) % 2 !== 0)
    throw new BadRequestException('UTF-16文件字节不完整');
  const sections = [await startSection(directory, 0, title)];
  let current = sections[0]!;
  const input = createReadStream(sourcePath, { start: bomBytes, signal: options.signal });
  const decoded = input.pipe(iconv.decodeStream(encoding)) as Transform;
  input.on('error', (error) => decoded.destroy(error));
  const lines = createInterface({ input: decoded, crlfDelay: Infinity });

  let hasText = false;
  let sectionCharacters = 0;
  let continuation = 1;
  let headingTitle = title;
  const sectionLimit = options.maxSectionCharacters ?? Number.POSITIVE_INFINITY;
  try {
    for await (const raw of lines) {
      options.signal?.throwIfAborted();
      if (raw.length > 1024 * 1024) throw new BadRequestException('TXT单行超过1 MiB，请先分段');
      if (raw.includes('\0')) throw new BadRequestException('TXT编码不正确，请选择正确的编码');
      const line = raw.trim();
      if (!line) continue;
      hasText = true;
      const marked = options.chapterMarker && line.startsWith(options.chapterMarker);
      if (options.chapterMarker ? marked : isChapterHeading(line, options.chapters)) {
        if (sections.length >= MAX_CHAPTERS) throw new BadRequestException(`Too many chapters (maximum ${MAX_CHAPTERS})`);
        await finishSection(current);
        current = await startSection(directory, sections.length, marked ? line.slice(options.chapterMarker!.length) : line);
        sections.push(current);
        headingTitle = current.title;
        sectionCharacters = 0;
        continuation = 1;
      } else {
        for (let offset = 0; offset < line.length;) {
          let end = Math.min(line.length, offset + sectionLimit - sectionCharacters);
          if (end < line.length && /[\uD800-\uDBFF]/.test(line[end - 1] ?? '')) end--;
          if (end <= offset) {
            if (sections.length >= MAX_CHAPTERS) throw new BadRequestException(`Too many chapters (maximum ${MAX_CHAPTERS})`);
            await finishSection(current);
            current = await startSection(directory, sections.length, `${headingTitle} (${++continuation})`);
            sections.push(current);
            sectionCharacters = 0;
            continue;
          }
          current.hasParagraphs = true;
          const paragraph = line.slice(offset, end);
          await writeSection(current, `<p>${escapeXml(paragraph)}</p>`);
          sectionCharacters += paragraph.length;
          offset = end;
        }
      }
    }
    if (!hasText || !sections.some((section) => section.hasParagraphs)) throw new BadRequestException('TXT没有可转换的正文');
    await finishSection(current);
  } catch (error) {
    input.destroy();
    current.stream.destroy();
    throw error;
  } finally {
    lines.close();
    input.destroy();
    decoded.destroy();
  }

  if (sections.length > 1 && !sections[0]!.hasParagraphs) {
    await rm(sections[0]!.path, { force: true });
    sections.shift();
  }
  return sections;
}

function buildPackageDocument(title: string, sections: TxtSection[], options: TxtConversionOptions, includeCover: boolean): string {
  const filename = (index: number) => (index === 0 ? 'chapter.xhtml' : `chapter-${index}.xhtml`);
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const coverItem = includeCover
    ? `<item id="cover-image" href="cover.${options.cover!.mediaType === 'image/png' ? 'png' : 'jpg'}" media-type="${options.cover!.mediaType}" properties="cover-image"/>`
    : '';
  const identifier = options.isbn?.trim() ? `urn:isbn:${escapeXml(options.isbn.trim())}` : `urn:uuid:${randomUUID()}`;
  const creators = (options.authors ?? []).map((author) => `<dc:creator>${escapeXml(author)}</dc:creator>`).join('');
  const description = options.description?.trim() ? `<dc:description>${escapeXml(options.description.trim())}</dc:description>` : '';
  const publisher = options.publisher?.trim() ? `<dc:publisher>${escapeXml(options.publisher.trim())}</dc:publisher>` : '';
  const publishedDate = options.publishedDate?.trim() ? `<dc:date>${escapeXml(options.publishedDate.trim())}</dc:date>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${escapeXml(title)}</dc:title><dc:language>${escapeXml(options.language || 'zh')}</dc:language>${creators}${description}${publisher}${publishedDate}<meta property="dcterms:modified">${modified}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${coverItem}${sections.map((_, index) => `<item id="c${index}" href="${filename(index)}" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${sections.map((_, index) => `<itemref idref="c${index}"/>`).join('')}</spine></package>`;
}

function buildNavigationDocument(sections: TxtSection[]): string {
  const filename = (index: number) => (index === 0 ? 'chapter.xhtml' : `chapter-${index}.xhtml`);
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><h1>目录</h1><ol>${sections.map((section, index) => `<li><a href="${filename(index)}">${escapeXml(section.title)}</a></li>`).join('')}</ol></nav></body></html>`;
}

export async function convertTxtToEpub(
  sourcePath: string,
  destinationPath: string,
  title: string,
  options: TxtConversionOptions = {},
): Promise<void> {
  options.signal?.throwIfAborted();
  if (options.maxSectionCharacters !== undefined && (!Number.isSafeInteger(options.maxSectionCharacters) || options.maxSectionCharacters < 1024))
    throw new BadRequestException('Invalid reading section size');
  const sourceStat = await stat(sourcePath);
  if (sourceStat.size > MAX_TXT_CONVERSION_BYTES) throw new BadRequestException('TXT exceeds conversion limit of 128 MiB');

  const workDirectory = await import('fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'bookorbit-txt-epub-')));
  let destinationCreated = false;
  try {
    const sections = await parseSections(sourcePath, workDirectory, title, options);
    await mkdir(dirname(destinationPath), { recursive: true });
    const destination = await open(destinationPath, 'wx', 0o600);
    destinationCreated = true;
    const output = destination.createWriteStream();
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const archiveCompletion = pipeline(archive, output, { signal: options.signal });
    void archiveCompletion.catch(() => {});
    archive.append('application/epub+zip', { name: 'mimetype', store: true });
    archive.append(
      '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      { name: 'META-INF/container.xml' },
    );
    const includeCover = !!options.cover && options.cover.bytes.length <= 10 * 1024 * 1024;
    archive.append(buildPackageDocument(title, sections, options, includeCover), { name: 'OEBPS/content.opf' });
    if (includeCover) archive.append(options.cover!.bytes, { name: `OEBPS/cover.${options.cover!.mediaType === 'image/png' ? 'png' : 'jpg'}` });
    archive.append(buildNavigationDocument(sections), { name: 'OEBPS/nav.xhtml' });
    sections.forEach((section, index) => {
      archive.file(section.path, { name: `OEBPS/${index === 0 ? 'chapter.xhtml' : `chapter-${index}.xhtml`}` });
    });
    await Promise.all([archive.finalize(), archiveCompletion]);
  } catch (error) {
    if (destinationCreated) await rm(destinationPath, { force: true });
    throw error;
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}
