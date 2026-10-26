import { Test } from '@nestjs/testing';
import { BadRequestException, GatewayTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, truncate, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as unzipper from 'unzipper';
import { TXT_READER_CACHE_DIRECTORY, TxtReaderCacheService } from './txt-reader-cache.service';
import { convertTxtToEpub } from '../../metadata/lib/txt-to-epub';
vi.mock('../../metadata/lib/txt-to-epub', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../metadata/lib/txt-to-epub')>();
  return { ...actual, convertTxtToEpub: vi.fn(actual.convertTxtToEpub) };
});
let root: string;
let source: string;
let cache: string;
let service: TxtReaderCacheService;
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), 'bookorbit-reader-test-'));
  source = join(root, 'sample.txt');
  cache = join(root, 'cache');
  await writeFile(source, '第一章开始\n正文第一段。\n第二章继续\n正文第二段。');
  const module = await Test.createTestingModule({
    providers: [TxtReaderCacheService, { provide: TXT_READER_CACHE_DIRECTORY, useValue: cache }],
  }).compile();
  service = module.get(TxtReaderCacheService);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe('temporary TXT reading cache', () => {
  it('creates a chaptered reading projection without changing the source or adding library files', async () => {
    const original = await readFile(source);
    const path = await service.prepare(7, 9, source);
    const zip = await unzipper.Open.file(path);
    const nav = (await zip.files.find((file) => file.path === 'OEBPS/nav.xhtml')!.buffer()).toString();
    expect(nav).toContain('第一章开始');
    expect(nav).toContain('第二章继续');
    expect(await readFile(source)).toEqual(original);
    expect((await readdir(root)).sort()).toEqual(['cache', 'sample.txt']);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
  it('reuses one projection for concurrent requests and invalidates it when the source changes', async () => {
    const [first, second] = await Promise.all([service.prepare(7, 9, source), service.prepare(7, 9, source)]);
    expect(first).toBe(second);
    expect(convertTxtToEpub).toHaveBeenCalledTimes(1);
    expect(await service.prepare(7, 9, source)).toBe(first);
    await writeFile(source, '第一章变化\n这是更新后的不同正文，长度也不同。');
    const updated = await service.prepare(7, 9, source);
    expect(updated).not.toBe(first);
    expect(convertTxtToEpub).toHaveBeenCalledTimes(2);
  });
  it('rejects oversized source files without starting a conversion', async () => {
    await truncate(source, 128 * 1024 * 1024 + 1);
    await expect(service.prepare(7, 9, source)).rejects.toBeInstanceOf(BadRequestException);
    expect(convertTxtToEpub).not.toHaveBeenCalled();
  });
  it('refuses an exhausted active cache and evicts old cache entries for a new reader', async () => {
    await mkdir(cache);
    const files = Array.from({ length: 16 }, (_, i) => join(cache, i.toString(16).padStart(64, '0') + '.epub'));
    await Promise.all(files.map((file) => writeFile(file, 'fixture')));
    await expect(service.prepare(7, 9, source)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const old = new Date(Date.now() - 11 * 60 * 1000);
    await Promise.all(files.map((file) => utimes(file, old, old)));
    expect(await service.prepare(7, 9, source)).toMatch(/\.epub$/);
    expect((await readdir(cache)).length).toBeLessThanOrEqual(16);
  });
  it('splits a large unchaptered TXT into bounded reading sections without losing astral characters', async () => {
    await writeFile(source, '正文😀'.repeat(70000));
    const path = await service.prepare(7, 9, source);
    const zip = await unzipper.Open.file(path);
    const chapters = zip.files.filter((file) => /^OEBPS\/chapter(?:-\d+)?\.xhtml$/.test(file.path));
    expect(chapters.length).toBeGreaterThanOrEqual(3);
    const contents = await Promise.all(chapters.map(async (file) => (await file.buffer()).toString()));
    expect(contents.every((content) => content.length < 110000)).toBe(true);
    expect(contents.join('').match(/😀/gu)?.length).toBe(70000);
  });
  it('cleans a timed-out preparation and permits a subsequent retry', async () => {
    vi.mocked(convertTxtToEpub).mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));
    await expect(service.prepare(7, 9, source)).rejects.toBeInstanceOf(GatewayTimeoutException);
    expect(await readdir(cache)).toEqual([]);
    expect(await service.prepare(7, 9, source)).toMatch(/\.epub$/);
  });
  it('keeps projection modification times stable when reusing cached reading resources', async () => {
    const path = await service.prepare(7, 9, source);
    const old = new Date(Date.now() - 20000);
    await utimes(path, old, old);
    const mtime = (await stat(path)).mtimeMs;
    expect(await service.prepare(7, 9, source)).toBe(path);
    expect((await stat(path)).mtimeMs).toBe(mtime);
    expect(convertTxtToEpub).toHaveBeenCalledTimes(1);
  });
});
