import { mkdtemp, readFile, rm, truncate, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as unzipper from 'unzipper';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { convertTxtToEpub } from './txt-to-epub';

describe('convertTxtToEpub', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bookorbit-epub-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes a readable EPUB with escaped Chinese text', async () => {
    const source = join(directory, '剑来.txt');
    const destination = join(directory, '剑来.epub');
    await writeFile(source, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('第一章\n<天地>', 'utf8')]));

    await convertTxtToEpub(source, destination, '剑来');
    const entries = await unzipper.Open.file(destination);
    const names = entries.files.map((entry) => entry.path);
    expect(names).toEqual(expect.arrayContaining(['mimetype', 'META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/chapter.xhtml']));
    const chapter = await entries.files.find((entry) => entry.path === 'OEBPS/chapter.xhtml')!.buffer();
    expect(chapter.toString('utf8')).toContain('&lt;天地&gt;');
    expect((await readFile(destination)).length).toBeGreaterThan(0);
  });

  it('creates chapter navigation and supports manual GB18030 decoding', async () => {
    const source = join(directory, 'novel.txt');
    const destination = join(directory, 'novel.epub');
    const iconv = await import('iconv-lite');
    await writeFile(source, iconv.default.encode('第一章 开始\n天地\n第二章 继续\n山河', 'gb18030'));
    await convertTxtToEpub(source, destination, '小说', { encoding: 'gb18030', chapters: 'auto' });
    const archive = await unzipper.Open.file(destination);
    const nav = (await archive.files.find((e) => e.path === 'OEBPS/nav.xhtml')!.buffer()).toString();
    expect(nav).toContain('第一章 开始');
    expect(nav).toContain('第二章 继续');
    expect(archive.files.filter((e) => /OEBPS\/chapter.*xhtml/.test(e.path))).toHaveLength(2);
    expect((await archive.files.find((e) => e.path === 'OEBPS/content.opf')!.buffer()).toString()).toContain('dcterms:modified');
  });

  it.each([
    ['Chinese headings', 'chinese', '第一章 开始\n正文\nChapter 2\nEnglish text', ['第一章 开始'], 1],
    ['English headings', 'english', '第一章 开始\n中文正文\nChapter 2: The Way\nEnglish text', ['Chapter 2: The Way'], 2],
    ['automatic headings', 'auto', '第一章 开始\n正文\nChapter 2\nEnglish text', ['第一章 开始', 'Chapter 2'], 2],
  ] as const)('applies %s chapter selection', async (_label, chapters, text, expectedTitles, expectedChapterCount) => {
    const source = join(directory, 'chapters.txt');
    const destination = join(directory, 'chapters.epub');
    await writeFile(source, text);

    await convertTxtToEpub(source, destination, '章节测试', { chapters });

    const archive = await unzipper.Open.file(destination);
    const nav = (await archive.files.find((entry) => entry.path === 'OEBPS/nav.xhtml')!.buffer()).toString('utf8');
    for (const title of expectedTitles) expect(nav).toContain(title);
    expect(archive.files.filter((entry) => /OEBPS\/chapter(?:-\d+)?\.xhtml/.test(entry.path))).toHaveLength(expectedChapterCount);
  });

  it('converts explicitly selected UTF-16 BE text without losing its content', async () => {
    const source = join(directory, 'utf16be.txt');
    const destination = join(directory, 'utf16be.epub');
    const iconv = await import('iconv-lite');
    await writeFile(source, Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.default.encode('Chapter 1: Start\n正文', 'utf16be')]));

    await convertTxtToEpub(source, destination, 'UTF-16 BE', { encoding: 'utf16be', chapters: 'english' });

    const archive = await unzipper.Open.file(destination);
    const nav = (await archive.files.find((entry) => entry.path === 'OEBPS/nav.xhtml')!.buffer()).toString('utf8');
    const chapter = (await archive.files.find((entry) => entry.path === 'OEBPS/chapter.xhtml')!.buffer()).toString('utf8');
    expect(nav).toContain('Chapter 1: Start');
    expect(chapter).toContain('正文');
  });

  it('keeps a single chapter when detection is disabled and never overwrites output', async () => {
    const source = join(directory, 'novel.txt');
    const destination = join(directory, 'novel.epub');
    await writeFile(source, '第一章 开始\n内容\n第二章 继续\n内容');
    await convertTxtToEpub(source, destination, '小说', { chapters: 'single' });
    const before = await readFile(destination);
    const archive = await unzipper.Open.file(destination);
    expect(archive.files.filter((e) => /OEBPS\/chapter.*xhtml/.test(e.path))).toHaveLength(1);
    await expect(convertTxtToEpub(source, destination, '其他')).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(destination)).toEqual(before);
  });

  it('copies shared book metadata and cover into the EPUB package', async () => {
    const source = join(directory, 'novel.txt');
    const destination = join(directory, 'novel.epub');
    await writeFile(source, '正文');

    await convertTxtToEpub(source, destination, '书名', {
      authors: ['甲作者', '乙作者'],
      description: '共同元数据简介',
      publisher: '出版社',
      publishedDate: '2024-05-01',
      isbn: '9781234567890',
      cover: { bytes: Buffer.from('cover-bytes'), mediaType: 'image/jpeg' },
    });

    const archive = await unzipper.Open.file(destination);
    const opf = (await archive.files.find((entry) => entry.path === 'OEBPS/content.opf')!.buffer()).toString('utf8');
    expect(opf).toContain('<dc:title>书名</dc:title>');
    expect(opf.match(/<dc:creator>/g)).toHaveLength(2);
    expect(opf).toContain('共同元数据简介');
    expect(opf).toContain('<dc:publisher>出版社</dc:publisher>');
    expect(opf).toContain('<dc:date>2024-05-01</dc:date>');
    expect(opf).toContain('urn:isbn:9781234567890');
    expect(opf).toContain('properties="cover-image"');
    await expect(archive.files.find((entry) => entry.path === 'OEBPS/cover.jpg')!.buffer()).resolves.toEqual(Buffer.from('cover-bytes'));
  });

  it('rejects oversized TXT before creating an EPUB', async () => {
    const source = join(directory, 'large.txt');
    const destination = join(directory, 'large.epub');
    await writeFile(source, 'x');
    await truncate(source, 128 * 1024 * 1024 + 1);

    await expect(convertTxtToEpub(source, destination, 'large')).rejects.toThrow('conversion limit');
    await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('recognizes Chinese chapters without spaces and removes invalid XML control characters', async () => {
    const source = join(directory, 'plain.txt');
    const dest = join(directory, 'plain.epub');
    await writeFile(source, '第一章开始\n正文\u0001内容\n第二章：继续\n结尾');
    await convertTxtToEpub(source, dest, '测试');
    const zip = await unzipper.Open.file(dest);
    const nav = (await zip.files.find((f) => f.path === 'OEBPS/nav.xhtml')!.buffer()).toString();
    expect(nav).toContain('第一章开始');
    expect(nav).toContain('第二章：继续');
    const text = (await zip.files.find((f) => f.path === 'OEBPS/chapter.xhtml')!.buffer()).toString();
    expect(text).not.toContain('\u0001');
    expect(text).toContain('正文内容');
  });
  it.each(['', '  \n\t', '正文\0错误', '第一章 开始'])('rejects empty content or wrong encoding without creating output', async (content) => {
    const source = join(directory, 'invalid.txt');
    const dest = join(directory, 'invalid.epub');
    await writeFile(source, content);
    await expect(convertTxtToEpub(source, dest, '测试')).rejects.toThrow();
    await expect(readFile(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('supports cancellation without creating an output file', async () => {
    const source = join(directory, 'cancel.txt');
    const dest = join(directory, 'cancel.epub');
    await writeFile(source, '正文');
    const controller = new AbortController();
    controller.abort();
    await expect(convertTxtToEpub(source, dest, '测试', { signal: controller.signal })).rejects.toThrow();
    await expect(readFile(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects truncated or explicitly misidentified encodings instead of silently replacing text', async () => {
    const source = join(directory, 'encoding.txt');
    const dest = join(directory, 'encoding.epub');
    await writeFile(source, Buffer.from([0xc3, 0x28]));
    await expect(convertTxtToEpub(source, dest, '测试', { encoding: 'utf8' })).rejects.toThrow('UTF-8');
    await writeFile(source, Buffer.from([0xff, 0xfe, 0x41]));
    await expect(convertTxtToEpub(source, dest, '测试')).rejects.toThrow('UTF-16');
    await expect(readFile(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
