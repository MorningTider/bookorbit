import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TxtFormatExtractor } from './txt-format.extractor';

describe('TxtFormatExtractor', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bookorbit-txt-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('extracts a Chinese title from UTF-8 BOM text without loading the full file', async () => {
    const path = join(directory, 'novel.txt');
    await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('剑来\n烽火戏诸侯\n正文', 'utf8')]));

    await expect(new TxtFormatExtractor().extract(path)).resolves.toEqual({
      title: '剑来',
      authors: [],
      genres: [],
      tags: [],
      cover: null,
      language: 'zh',
    });
  });

  it('uses the filename for long first lines and returns null for empty files', async () => {
    const longPath = join(directory, 'A Novel.txt');
    await writeFile(longPath, `${'x'.repeat(201)}\nbody`);
    await expect(new TxtFormatExtractor().extract(longPath)).resolves.toMatchObject({ title: 'A Novel' });

    const emptyPath = join(directory, 'empty.txt');
    await writeFile(emptyPath, '');
    await expect(new TxtFormatExtractor().extract(emptyPath)).resolves.toBeNull();
  });

  it('extracts explicit title and author labels from the text header', async () => {
    const path = join(directory, 'fallback.txt');
    await writeFile(path, '作者：烽火戏诸侯\n书名：剑来\n正文');

    await expect(new TxtFormatExtractor().extract(path)).resolves.toMatchObject({
      title: '剑来',
      authors: [{ name: '烽火戏诸侯', sortName: null }],
    });
  });
  it.each(['第一章 初见', '第1章初见', 'Chapter 1: Arrival', '他走进书房，打开了一本书。'])(
    'keeps the filename when the text starts with body content: %s',
    async (line) => {
      const path = join(directory, '剑来.txt');
      await writeFile(path, `${line}\n这是正文。`);
      await expect(new TxtFormatExtractor().extract(path)).resolves.toMatchObject({ title: '剑来' });
    },
  );
});
