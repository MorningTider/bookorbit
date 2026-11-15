import { BadRequestException, ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { groupEpubTocEntries } from '@bookorbit/types';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as unzipper from 'unzipper';
import { fullFileSha256 } from '../../common/utils/full-file-sha256.utils';
import { writeZipArchive } from '../file-write/formats/shared/zip-rewrite';
import { patch } from '../file-write/formats/epub/epub-zip-patcher';
import { EpubService } from '../reader/epub/epub.service';
import { buildTocPatches, suggestTocGroups } from './epub-toc-archive';
import { EpubTocService } from './epub-toc.service';
import { OrganizeEpubTocDto } from './epub-toc.dto';

const inspector = new EpubService({} as never, {} as never);
const user = { id: 1 } as never;
const groups = [
  { index: 2, label: '甲集 & 上册' },
  { index: 4, label: '乙集' },
];
const labels = ['引言', '总目录', '甲集 & 上册', '第二章', '乙集', '第二章'];
const paths = ['intro.xhtml', 'contents.xhtml', 'a 1.xhtml', 'a2.xhtml', 'b1.xhtml', 'b2.xhtml'];
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
let directory: string;
let file: string;

async function fixture(mode: 'both' | 'nav' | 'ncx' = 'both') {
  const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><h1>目录</h1><ol>${labels.map((label, index) => `<li><a href="${encodeURI(paths[index]!)}">${escape(label)}</a></li>`).join('')}</ol></nav></body></html>`;
  const ncx = `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><head><meta name="dtb:depth" content="1"/></head><navMap>${labels.map((label, index) => `<navPoint id="old-${index}"><navLabel><text>${escape(label)}</text></navLabel><content src="../${encodeURI(paths[index]!)}"/></navPoint>`).join('')}</navMap></ncx>`;
  const opf = `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>合集测试</dc:title><dc:creator>测试作者</dc:creator><dc:language>zh</dc:language></metadata><manifest>${mode !== 'ncx' ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}${mode !== 'nav' ? '<item id="ncx" href="legacy/toc.ncx" media-type="application/x-dtbncx+xml"/>' : ''}${paths.map((path, index) => `<item id="chapter-${index}" href="${encodeURI(path)}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine toc="ncx">${paths.map((_path, index) => `<itemref idref="chapter-${index}"/>`).join('')}</spine></package>`;
  const entries = [
    { name: 'mimetype', source: Buffer.from('application/epub+zip'), store: true },
    { name: 'META-INF/container.xml', source: Buffer.from('<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>') },
    { name: 'OPS/content.opf', source: Buffer.from(opf) },
    { name: 'OPS/nav.xhtml', source: Buffer.from(nav) },
    { name: 'OPS/legacy/toc.ncx', source: Buffer.from(ncx) },
    ...paths.map((path, index) => ({
      name: `OPS/${path}`,
      source: Buffer.from(
        `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>${escape(labels[index]!)}</h1>${index === 1 ? '<p>甲集 &amp; 上册</p><p>乙集</p>' : '<p id="start">正文文本保持一致。</p>'}</body></html>`,
      ),
    })),
  ];
  await writeZipArchive(file, entries);
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'epub-toc-test-'));
  file = join(directory, 'book.epub');
  await fixture();
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function flattened(items: NonNullable<Awaited<ReturnType<typeof inspector.inspectFile>>['toc']>['children']): { label: string; href?: string }[] {
  return (items ?? []).flatMap((item) => [{ label: item.label, href: item.href }, ...flattened(item.children)]);
}

describe('generic EPUB directory organization', () => {
  it('finds book boundaries from an internal contents page without a fixed book-name list', async () => {
    const info = await inspector.inspectFile(file);
    expect(await suggestTocGroups(file, info)).toEqual({ suggestedGroups: groups, suggestionSource: 'contents' });
  });
  it.each(['both', 'nav', 'ncx'] as const)('writes %s navigation while preserving text, spine, metadata and URI targets', async (mode) => {
    await fixture(mode);
    const original = await inspector.inspectFile(file);
    const bytes = await unzipper.Open.file(file);
    const unchanged = new Map(
      await Promise.all(
        bytes.files
          .filter((entry) => !entry.path.endsWith('nav.xhtml') && !entry.path.endsWith('.ncx'))
          .map(async (entry) => [entry.path, await entry.buffer()] as const),
      ),
    );
    const organized = groupEpubTocEntries(original.toc!.children!, groups);
    const patches = await buildTocPatches(file, original, organized);
    expect(patches.has('OPS/nav.xhtml')).toBe(mode !== 'ncx');
    expect(patches.has('OPS/legacy/toc.ncx')).toBe(mode !== 'nav');
    await patch(file, patches);
    const updated = await inspector.inspectFile(file);
    expect(updated.toc?.children).toHaveLength(4);
    expect(updated.toc?.children?.[2]).toMatchObject({ label: '甲集 & 上册', href: 'OPS/a 1.xhtml', children: [{ label: '第二章' }] });
    expect(flattened(updated.toc?.children)).toEqual(flattened(original.toc?.children));
    expect(updated.metadata).toEqual(original.metadata);
    expect(updated.spine).toEqual(original.spine);
    for (const entry of (await unzipper.Open.file(file)).files) {
      if (unchanged.has(entry.path)) expect(await entry.buffer()).toEqual(unchanged.get(entry.path));
    }
    expect(await suggestTocGroups(file, updated)).toEqual({
      suggestedGroups: [
        { index: 2, label: groups[0]!.label },
        { index: 3, label: groups[1]!.label },
      ],
      suggestionSource: 'existing',
    });
  });
  it('updates an inline TOC with direct list items while preserving its original link targets', async () => {
    const original = await inspector.inspectFile(file);
    const inline = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><p>分组目录</p>${labels
      .slice(2)
      .map((label, offset) => `<li><a href="${encodeURI(paths[offset + 2]!)}">${escape(label)}</a></li>`)
      .join('')}<ol/></nav></body></html>`;
    await patch(file, new Map([['OPS/contents.xhtml', Buffer.from(inline)]]));
    const patches = await buildTocPatches(file, original, groupEpubTocEntries(original.toc!.children!, groups));
    expect(patches.has('OPS/contents.xhtml')).toBe(true);
    const { load } = await import('cheerio');
    const $ = load(patches.get('OPS/contents.xhtml')!.toString(), { xmlMode: true });
    expect($('nav > ol > li')).toHaveLength(2);
    expect(
      $('a')
        .map((_index, item) => $(item).attr('href'))
        .get(),
    ).toEqual(paths.slice(2).map(encodeURI));
    expect($('nav > p').text()).toBe('分组目录');
  });
  it('decodes original numeric entities before writing labels and link targets', async () => {
    for (const path of ['OPS/nav.xhtml', 'OPS/legacy/toc.ncx']) {
      const archive = await unzipper.Open.file(file);
      const entry = archive.files.find((entry) => entry.path === path)!;
      const xml = (await entry.buffer()).toString().replaceAll('甲集', '&#x7532;&#38598;').replaceAll('a%201.xhtml', 'a&#32;1.xhtml');
      await patch(file, new Map([[path, Buffer.from(xml)]]));
    }
    const original = await inspector.inspectFile(file);
    expect(original.toc!.children![2]).toMatchObject({ label: '甲集 & 上册', href: 'OPS/a 1.xhtml' });
    await patch(file, await buildTocPatches(file, original, groupEpubTocEntries(original.toc!.children!, groups)));
    const updated = await inspector.inspectFile(file);
    expect(flattened(updated.toc?.children)).toEqual(flattened(original.toc?.children));
    expect(updated.toc!.children![2]!.label).toBe('甲集 & 上册');
  });
  it('retains supplemental NCX and inline contents links absent from EPUB3 navigation', async () => {
    const archive = await unzipper.Open.file(file);
    const ncx = archive.files.find((entry) => entry.path.endsWith('.ncx'))!;
    const xml = (await ncx.buffer())
      .toString()
      .replace(
        '</navPoint>',
        '<navPoint id="appendix"><navLabel><text>附录</text></navLabel><content src="../appendix.xhtml"/></navPoint></navPoint>',
      );
    const inline =
      '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="appendix.xhtml">补充目录</a></li></ol></nav></body></html>';
    await patch(
      file,
      new Map([
        ['OPS/legacy/toc.ncx', Buffer.from(xml)],
        ['OPS/contents.xhtml', Buffer.from(inline)],
      ]),
    );
    const original = await inspector.inspectFile(file);
    const patches = await buildTocPatches(file, original, groupEpubTocEntries(original.toc!.children!, groups));
    expect(patches.has('OPS/contents.xhtml')).toBe(false);
    const { load } = await import('cheerio');
    const $ = load(patches.get('OPS/legacy/toc.ncx')!.toString(), { xmlMode: true });
    expect($('navMap > navPoint').last().find('text').text()).toBe('附录');
    expect($('content[src="../appendix.xhtml"]')).toHaveLength(1);
    await patch(file, patches);
    expect(flattened((await inspector.inspectFile(file)).toc?.children)).toEqual(flattened(original.toc?.children));
  });
  it('retains unlinked group headings and their nested entries', async () => {
    const archive = await unzipper.Open.file(file);
    const nav = archive.files.find((entry) => entry.path === 'OPS/nav.xhtml')!;
    const xml = (await nav.buffer()).toString().replace('<a href="a%201.xhtml">甲集 &amp; 上册</a>', '<span>甲集 &amp; 上册</span>');
    await patch(file, new Map([['OPS/nav.xhtml', Buffer.from(xml)]]));
    const original = await inspector.inspectFile(file);
    expect(original.toc!.children![2]).toMatchObject({ label: '甲集 & 上册', href: undefined });
    await patch(file, await buildTocPatches(file, original, groupEpubTocEntries(original.toc!.children!, groups)));
    expect((await inspector.inspectFile(file)).toc!.children![2]).toMatchObject({ label: '甲集 & 上册', children: [{ label: '第二章' }] });
  });
  it('keeps optional malformed contents pages from blocking valid directory organization', async () => {
    const info = await inspector.inspectFile(file);
    await patch(file, new Map([['OPS/contents.xhtml', Buffer.from('<html><body><p>Unclosed optional contents')]]));
    expect(await suggestTocGroups(file, info)).toMatchObject({ suggestionSource: 'headings' });
    const patches = await buildTocPatches(file, info, groupEpubTocEntries(info.toc!.children!, groups));
    expect(patches.has('OPS/nav.xhtml')).toBe(true);
    expect(patches.has('OPS/contents.xhtml')).toBe(false);
  });
  it('falls back to generic numbered chapter restarts and leaves ambiguous directories to manual selection', async () => {
    const info = await inspector.inspectFile(file);
    info.toc!.children![1]!.label = '前言';
    expect(await suggestTocGroups(file, info)).toEqual({ suggestedGroups: groups, suggestionSource: 'headings' });
    info.toc!.children = [
      { label: '无编号标题', href: 'OPS/a 1.xhtml' },
      { label: '另一个标题', href: 'OPS/b1.xhtml' },
    ];
    expect(await suggestTocGroups(file, info)).toEqual({ suggestedGroups: [], suggestionSource: 'none' });
  });
  it('keeps nested subdirectories when top-level entries are grouped', () => {
    const source = [
      { label: 'Part A', href: 'a', children: [{ label: 'Nested', href: 'a1' }] },
      { label: 'Part B', href: 'b' },
    ];
    const original = JSON.stringify(source);
    expect(groupEpubTocEntries(source, [{ index: 0, label: 'Collection' }])[0]?.children).toEqual([
      { label: 'Nested', href: 'a1' },
      { label: 'Part B', href: 'b' },
    ]);
    expect(JSON.stringify(source)).toBe(original);
  });
  it.each([
    [{ index: -1, label: 'A' }],
    [{ index: 100, label: 'A' }],
    [{ index: 0, label: ' ' }],
    [
      { index: 0, label: 'A' },
      { index: 0, label: 'B' },
    ],
    [
      { index: 1, label: 'A' },
      { index: 0, label: 'B' },
    ],
  ])('rejects invalid boundaries %j', (starts) => {
    expect(() => groupEpubTocEntries([{ label: 'A' }, { label: 'B' }], starts)).toThrow();
  });
  it('treats a selected leaf with an unchanged name as an unchanged directory', () => {
    const entries = [{ label: 'Only entry', href: 'only.xhtml' }];
    expect(JSON.stringify(groupEpubTocEntries(entries, [{ index: 0, label: 'Only entry' }]))).toBe(JSON.stringify(entries));
  });
  it('handles a large directory without dropping or mutating entries', () => {
    const entries = Array.from({ length: 20000 }, (_value, index) => ({ label: `Chapter ${index}`, href: `${index}.xhtml` }));
    const result = groupEpubTocEntries(entries, [
      { index: 1, label: 'First' },
      { index: 10000, label: 'Second' },
    ]);
    expect(flattened(result)).toHaveLength(20000);
    expect(result).toHaveLength(3);
    expect(entries[1]?.label).toBe('Chapter 1');
  });
});

describe('authenticated, versioned directory writes', () => {
  function service() {
    const books = {
      verifyBookAccess: vi.fn().mockResolvedValue(undefined),
      verifyFileAccess: vi.fn().mockResolvedValue({ bookId: 7, format: 'epub', absolutePath: file }),
    };
    const epub = { inspectFile: inspector.inspectFile.bind(inspector), getBookInfo: () => inspector.inspectFile(file) };
    const writer = { patchTemporaryEpub: vi.fn(patch) };
    const reviews = { fileVersion: vi.fn(async () => ({ fileId: 11, bookId: 7, sha256: await fullFileSha256(file) })) };
    const commits = {
      replace: vi.fn(async (input: { incoming: string; expectedSha256: string }) => {
        if ((await fullFileSha256(file)) !== input.expectedSha256) throw new ConflictException();
        await copyFile(input.incoming, file);
      }),
    };
    return {
      value: new EpubTocService(books as never, epub as never, writer as never, reviews as never, commits as never),
      books,
      writer,
      reviews,
      commits,
    };
  }
  it('checks editor access before inspecting a file', async () => {
    const target = service();
    target.books.verifyBookAccess.mockRejectedValue(new ForbiddenException());
    await expect(target.value.inspect(7, 11, user)).rejects.toThrow(ForbiddenException);
    expect(target.reviews.fileVersion).not.toHaveBeenCalled();
  });
  it('rejects another book file and non-EPUB formats', async () => {
    const target = service();
    target.books.verifyFileAccess.mockResolvedValue({ bookId: 8, format: 'epub', absolutePath: file });
    await expect(target.value.inspect(7, 11, user)).rejects.toThrow(BadRequestException);
    target.books.verifyFileAccess.mockResolvedValue({ bookId: 7, format: 'pdf', absolutePath: file });
    await expect(target.value.inspect(7, 11, user)).rejects.toThrow(BadRequestException);
  });
  it('passes the expected SHA and original record IDs to the existing atomic commit', async () => {
    const target = service();
    const state = await target.value.inspect(7, 11, user);
    expect(await target.value.organize(7, 11, { expectedSha256: state.sha256, groups }, user)).toEqual({
      bookId: 7,
      fileId: 11,
      changed: true,
      groupCount: 2,
    });
    expect(target.commits.replace).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: 7, fileId: 11, expectedSha256: state.sha256, format: 'epub' }),
      user,
    );
    const refreshed = await target.value.inspect(7, 11, user);
    await expect(target.value.organize(7, 11, { expectedSha256: refreshed.sha256, groups: refreshed.suggestedGroups }, user)).resolves.toMatchObject({
      changed: false,
    });
    expect(target.commits.replace).toHaveBeenCalledTimes(1);
  });
  it('refuses a stale version before writing and preserves the original file', async () => {
    const target = service();
    const before = await readFile(file);
    await expect(target.value.organize(7, 11, { expectedSha256: 'a'.repeat(64), groups }, user)).rejects.toThrow(ConflictException);
    expect(await readFile(file)).toEqual(before);
    expect(target.commits.replace).not.toHaveBeenCalled();
  });
  it('leaves the original intact when archive preparation fails', async () => {
    const target = service();
    const sha = await fullFileSha256(file);
    target.writer.patchTemporaryEpub.mockRejectedValue(new Error('Disk write failed'));
    await expect(target.value.organize(7, 11, { expectedSha256: sha, groups }, user)).rejects.toThrow('Disk write failed');
    expect(await fullFileSha256(file)).toBe(sha);
    expect(target.commits.replace).not.toHaveBeenCalled();
  });
  it('rechecks optimistic concurrency at the atomic commit', async () => {
    const target = service();
    const sha = await fullFileSha256(file);
    target.commits.replace.mockRejectedValue(new ConflictException('Changed concurrently'));
    await expect(target.value.organize(7, 11, { expectedSha256: sha, groups }, user)).rejects.toThrow(ConflictException);
    expect(await fullFileSha256(file)).toBe(sha);
  });
  it('rejects unrecognised fields and unbounded label values at the HTTP boundary', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    for (const body of [
      { expectedSha256: 'a'.repeat(64), groups, userId: 2 },
      { expectedSha256: 'bad', groups },
      { expectedSha256: 'a'.repeat(64), groups: [{ index: 0, label: '\u0001' }] },
      { expectedSha256: 'a'.repeat(64), groups: [{ index: 0, label: 'x'.repeat(501) }] },
    ]) {
      await expect(pipe.transform(body, { type: 'body', metatype: OrganizeEpubTocDto })).rejects.toThrow(BadRequestException);
    }
  });
});
