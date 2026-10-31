import { Test } from '@nestjs/testing';
import { describe, it, expect, vi } from 'vitest';
import * as unzipper from 'unzipper';
import { bookSourceConfig } from '../../config/config';
import { ChapterDownloadService } from './chapter-download.service';
import type { ChapterSourceAdapter } from './chapter-source';
async function setup() {
  const module = await Test.createTestingModule({
    providers: [ChapterDownloadService, { provide: bookSourceConfig.KEY, useValue: { timeoutMs: 10000 } }],
  }).compile();
  return module.get(ChapterDownloadService);
}
function adapter(): ChapterSourceAdapter {
  return {
    key: 'test',
    catalog: vi.fn().mockResolvedValue({ title: '测试作品', authors: ['作者'], chapters: [{ id: '1', title: '开端' }], excludedChapters: 2 }),
    chapter: vi.fn().mockResolvedValue(['第一章这是一段正文', 'Chapter 2: this is prose', '正文<&>']),
  };
}
describe('reusable chapter downloader', () => {
  it('builds a validated EPUB selection with metadata, source titles, and escaped paragraphs', async () => {
    const progress = vi.fn();
    const result = await (await setup()).download(adapter(), '101', new AbortController().signal, progress);
    expect(progress.mock.calls.map(([value]) => [value.phase, value.completedChapters, value.totalChapters])).toEqual([
      ['downloading', 0, 1],
      ['downloading', 1, 1],
      ['validating', 1, 1],
    ]);
    expect(result.title).toBe('测试作品（公开免费章节选集）');
    const zip = await unzipper.Open.buffer(result.content);
    const nav = (await zip.files.find((f) => f.path === 'OEBPS/nav.xhtml')!.buffer()).toString();
    expect(nav).toContain('开端');
    expect(nav).not.toContain('Chapter 2: this is prose');
    const text = (await zip.files.find((f) => f.path === 'OEBPS/chapter.xhtml')!.buffer()).toString();
    expect(text).toContain('正文&lt;&amp;&gt;');
    expect(text).toContain('Chapter 2: this is prose');
    const opf = (await zip.files.find((f) => f.path === 'OEBPS/content.opf')!.buffer()).toString();
    expect(opf).toContain('未包含2章');
    expect(opf).toContain('不是完整作品');
  });
  it('fails when any chapter is unavailable, rather than generating a partial success', async () => {
    const source = adapter();
    vi.mocked(source.chapter).mockRejectedValue(new Error('restricted'));
    await expect((await setup()).download(source, '101', new AbortController().signal)).rejects.toThrow('restricted');
  });
  it('rejects empty chapters and cancels before any network request', async () => {
    const source = adapter();
    vi.mocked(source.chapter).mockResolvedValue([]);
    await expect((await setup()).download(source, '101', new AbortController().signal)).rejects.toThrow('章节为空');
    vi.mocked(source.catalog).mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect((await setup()).download(source, '101', controller.signal)).rejects.toThrow();
    expect(source.catalog).not.toHaveBeenCalled();
  });
});
