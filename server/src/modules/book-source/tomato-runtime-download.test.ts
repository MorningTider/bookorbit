import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { TomatoRuntimeService } from './tomato-runtime.service';

const mock = vi.hoisted(() => ({ children: [] as unknown[] }));
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    spawn: vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null as number | null, connected: true, send: vi.fn(), kill: vi.fn() });
      child.kill.mockImplementation(() => {
        queueMicrotask(() => {
          child.exitCode = 0;
          child.emit('exit', 0);
        });
        return true;
      });
      mock.children.push(child);
      return child;
    }),
  };
});
vi.mock('./validate-source-epub', () => ({ assertSourceEpub: vi.fn(async () => {}) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mock.children.length = 0;
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tomato-flow-'));
  const bookId = '7328230298259295294';
  const cache = join(root, 'source-staging', `tomato-resume-${bookId}`);
  const runtime = new TomatoRuntimeService(
    { tomatoBinaryPath: '/verified/helper', timeoutMs: 1100 },
    { appDataPath: root, bookDockPath: root, libraryBrowseRoot: root },
  );
  vi.spyOn(runtime as unknown as { verifyBinary(): Promise<void> }, 'verifyBinary').mockResolvedValue();
  let count = 0;
  let fail = false;
  let stalled = false;
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/api/status')) return Response.json({});
    if (url.includes('/api/preview/')) return Response.json({ book_id: bookId, book_name: '长篇测试' });
    if (url.endsWith('/api/jobs')) {
      count = 0;
      await mkdir(join(cache, 'books', bookId), { recursive: true });
      await writeFile(join(cache, 'books', bookId, 'downloaded_chapters.jsonl'), 'saved chapter');
      return Response.json({ id: 1 });
    }
    if (url.includes('/api/jobs?id=')) {
      if (!stalled || count === 0) count++;
      if (fail) throw new Error('simulated network failure');
      if (count === 4) await writeFile(join(cache, 'books', 'book.epub'), 'complete epub');
      return Response.json({
        items: [{ id: 1, book_id: bookId, state: count === 4 ? 'done' : 'running', progress: { saved_chapters: count, chapter_total: 4 } }],
      });
    }
    return Response.json({ items: [{ book_id: bookId, selected_chapters: 4, success_chapters: 4, failed_chapters: 0 }] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    root,
    cache,
    runtime,
    bookId,
    fail: () => {
      fail = true;
    },
    stall: () => {
      stalled = true;
    },
    retry: () => {
      fail = false;
    },
  };
}

it('runs longer than its idle timeout while chapters advance and cleans successful cache', async () => {
  const f = await fixture();
  try {
    const result = await f.runtime.download(f.bookId, new AbortController().signal);
    expect(result.title).toBe('长篇测试');
    expect((mock.children[0] as EventEmitter & { send: ReturnType<typeof vi.fn> }).send).toHaveBeenCalledTimes(4);
    expect(await readdir(join(f.root, 'source-staging'))).toEqual([]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it('retains failed chapter journals and reuses the same directory on retry', async () => {
  const f = await fixture();
  try {
    f.fail();
    await expect(f.runtime.download(f.bookId, new AbortController().signal)).rejects.toThrow();
    const journal = join(f.cache, 'books', f.bookId, 'downloaded_chapters.jsonl');
    expect(await readFile(journal, 'utf8')).toBe('saved chapter');
    f.retry();
    await f.runtime.download(f.bookId, new AbortController().signal);
    expect(await readdir(join(f.root, 'source-staging'))).toEqual([]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it('stops a live downloader whose chapter count never advances and retains its journal', async () => {
  const f = await fixture();
  try {
    f.stall();
    await expect(f.runtime.download(f.bookId, new AbortController().signal)).rejects.toThrow('无新增章节');
    expect(await readFile(join(f.cache, 'books', f.bookId, 'downloaded_chapters.jsonl'), 'utf8')).toBe('saved chapter');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
