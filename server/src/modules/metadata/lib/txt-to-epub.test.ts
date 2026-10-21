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
    const nav = (await archive.files.find(e => e.path === 'OEBPS/nav.xhtml')!.buffer()).toString();
    expect(nav).toContain('第一章 开始');
    expect(nav).toContain('第二章 继续');
    expect(archive.files.filter(e => /OEBPS\/chapter.*xhtml/.test(e.path))).toHaveLength(2);
    expect((await archive.files.find(e => e.path === 'OEBPS/content.opf')!.buffer()).toString()).toContain('dcterms:modified');
  });

  it('keeps a single chapter when detection is disabled and never overwrites output', async () => {
    const source = join(directory, 'novel.txt');
    const destination = join(directory, 'novel.epub');
    await writeFile(source, '第一章 开始\n内容\n第二章 继续\n内容');
    await convertTxtToEpub(source, destination, '小说', { chapters: 'single' });
    const before = await readFile(destination);
    const archive = await unzipper.Open.file(destination);
    expect(archive.files.filter(e => /OEBPS\/chapter.*xhtml/.test(e.path))).toHaveLength(1);
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
});
