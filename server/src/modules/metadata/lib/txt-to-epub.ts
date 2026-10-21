import { createWriteStream } from 'fs';
import { mkdir, readFile, stat } from 'fs/promises';
import { dirname, basename } from 'path';
import { pipeline } from 'stream/promises';
import { ZipArchive } from 'archiver';
import iconv from 'iconv-lite';
import { BadRequestException } from '@nestjs/common';
import { decodeTxt } from './txt-decoder';

const MAX_TXT_CONVERSION_BYTES = 128 * 1024 * 1024;
export interface TxtConversionOptions {
  encoding?: 'auto' | 'utf8' | 'gb18030' | 'utf16le';
  chapters?: 'auto' | 'single';
  language?: string;
  authors?: string[];
  description?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  isbn?: string | null;
  cover?: { bytes: Buffer; mediaType: 'image/jpeg' | 'image/png' };
}
function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}
export async function convertTxtToEpub(sourcePath: string, destinationPath: string, title: string, options: TxtConversionOptions = {}): Promise<void> {
  const sourceStat = await stat(sourcePath);
  if (sourceStat.size > MAX_TXT_CONVERSION_BYTES) throw new BadRequestException('TXT exceeds conversion limit of 128 MiB');
  const source = await readFile(sourcePath);
  const text = options.encoding && options.encoding !== 'auto' ? iconv.decode(source, options.encoding) : decodeTxt(source);
  const sections: { title: string; lines: string[] }[] = [{ title, lines: [] }];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = options.chapters !== 'single' && line.length <= 100 && /^(第[零〇一二三四五六七八九十百千万两\d]+[章节卷回部篇]|chapter\s+\d+)/i.test(line);
    if (heading) {
      if (sections.length >= 10000) throw new BadRequestException('Too many chapters (maximum 10000)');
      sections.push({ title: line, lines: [] });
    } else sections[sections.length - 1]!.lines.push(line);
  }
  if (sections.length > 1 && !sections[0]!.lines.length) sections.shift();
  await mkdir(dirname(destinationPath), { recursive: true });
  const output = createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 });
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const completed = pipeline(archive, output);
  void completed.catch(() => {});
  archive.append('application/epub+zip', { name: 'mimetype', store: true });
  archive.append('<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', { name: 'META-INF/container.xml' });
  const filename = (i: number) => i === 0 ? 'chapter.xhtml' : `chapter-${i}.xhtml`;
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const coverItem = options.cover && options.cover.bytes.length <= 10 * 1024 * 1024
    ? `<item id="cover-image" href="cover.${options.cover.mediaType === 'image/png' ? 'png' : 'jpg'}" media-type="${options.cover.mediaType}" properties="cover-image"/>`
    : '';
  const identifier = options.isbn?.trim() ? `urn:isbn:${escapeXml(options.isbn.trim())}` : escapeXml(basename(sourcePath));
  const creators = (options.authors ?? []).map((author) => `<dc:creator>${escapeXml(author)}</dc:creator>`).join('');
  const description = options.description?.trim() ? `<dc:description>${escapeXml(options.description.trim())}</dc:description>` : '';
  const publisher = options.publisher?.trim() ? `<dc:publisher>${escapeXml(options.publisher.trim())}</dc:publisher>` : '';
  const publishedDate = options.publishedDate?.trim() ? `<dc:date>${escapeXml(options.publishedDate.trim())}</dc:date>` : '';
  archive.append(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${escapeXml(title)}</dc:title><dc:language>${escapeXml(options.language || 'zh')}</dc:language>${creators}${description}${publisher}${publishedDate}<meta property="dcterms:modified">${modified}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${coverItem}${sections.map((_, i) => `<item id="c${i}" href="${filename(i)}" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${sections.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`, { name: 'OEBPS/content.opf' });
  if (coverItem && options.cover) archive.append(options.cover.bytes, { name: `OEBPS/cover.${options.cover.mediaType === 'image/png' ? 'png' : 'jpg'}` });
  archive.append(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><h1>目录</h1><ol>${sections.map((s, i) => `<li><a href="${filename(i)}">${escapeXml(s.title)}</a></li>`).join('')}</ol></nav></body></html>`, { name: 'OEBPS/nav.xhtml' });
  sections.forEach((section, i) => archive.append(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(section.title)}</title></head><body><h1>${escapeXml(section.title)}</h1>${section.lines.map(line => `<p>${escapeXml(line)}</p>`).join('\n')}</body></html>`, { name: `OEBPS/${filename(i)}` }));
  await Promise.all([archive.finalize(), completed]);
}
