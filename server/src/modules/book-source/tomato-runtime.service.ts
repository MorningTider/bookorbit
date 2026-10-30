import { Interval } from '@nestjs/schedule';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { opendir, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { BadGatewayException, ConflictException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { bookSourceConfig, storageConfig } from '../../config/config';
import { readBoundedText } from '../../common/utils/bounded-response';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { assertSourceEpub } from './validate-source-epub';
import { assertTomatoComplete, tomatoBookId, tomatoJobId, tomatoJobState } from './tomato-protocol';

const RELEASE_HASHES: Record<string, string> = {
  x64: 'd9db872448e3cda78a18eaa3c7ee162ce631251ed51eb789f8e6676abe118722',
  arm64: '3df139fd891ebcf88c6c8b476c755b45e61b3c31075e0b465fc9d14c46800201',
};
const MAX_BOOK_BYTES = 64 * 1024 * 1024;

@Injectable()
export class TomatoRuntimeService {
  private busy = false;
  private readonly logger = new Logger(TomatoRuntimeService.name);
  constructor(
    @Inject(bookSourceConfig.KEY) private readonly config: ConfigType<typeof bookSourceConfig>,
    @Inject(storageConfig.KEY) private readonly storage: ConfigType<typeof storageConfig>,
  ) {}

  async download(bookId: string, signal: AbortSignal): Promise<{ content: Buffer; title: string }> {
    tomatoBookId(bookId);
    if (this.busy) throw new ConflictException('已有番茄下载正在执行，请等待当前任务完成');
    this.busy = true;
    const startedAt = Date.now();
    this.logger.log(`[book_source.tomato_download] [start] bookId=${bookId} - download started`);
    let root: string | undefined;
    let child: ChildProcess | undefined;
    try {
      await this.verifyBinary();
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]);
      deadline.throwIfAborted();
      const parent = join(this.storage.appDataPath, 'source-staging');
      await mkdir(parent, { recursive: true, mode: 0o700 });
      root = await mkdtemp(join(parent, 'tomato-'));
      const output = join(root, 'books');
      await mkdir(output, { mode: 0o700 });
      await writeFile(
        join(root, 'config.yml'),
        JSON.stringify({
          save_path: output,
          novel_format: 'epub',
          bulk_files: false,
          use_official_api: true,
          api_endpoints: [],
          preferred_book_name_field: 'book_name',
          ask_format_after_download: false,
          auto_open_downloaded_files: false,
          enable_audiobook: false,
          enable_segment_comments: false,
          max_workers: 1,
          max_retries: 1,
          request_timeout: 15,
        }),
        { mode: 0o600 },
      );
      const port = await reservePort();
      const password = randomBytes(32).toString('hex');
      child = spawn(
        process.execPath,
        [join(__dirname, 'tomato-runtime-guard.js'), this.config.tomatoBinaryPath, root, String(process.pid), String(this.config.timeoutMs + 10000)],
        {
          cwd: root,
          stdio: 'ignore',
          env: tomatoRuntimeEnvironment(root, port, password),
        },
      );
      let spawnError = false;
      child.on('error', () => {
        spawnError = true;
      });
      const request = async (path: string, body?: Record<string, string>): Promise<unknown> => {
        deadline.throwIfAborted();
        if (spawnError || child?.exitCode !== null) throw new BadGatewayException('番茄下载器无法启动或已退出');
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: body ? 'POST' : 'GET',
          redirect: 'error',
          signal: AbortSignal.any([deadline, AbortSignal.timeout(15000)]),
          headers: { 'x-tomato-password': password, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) throw new BadGatewayException(`番茄下载器请求失败 (HTTP ${response.status})`);
        let value: unknown;
        try {
          value = JSON.parse(await readBoundedText(response, 2 * 1024 * 1024));
        } catch {
          throw new BadGatewayException('番茄下载器响应格式无效');
        }
        if (value && typeof value === 'object' && 'error' in value && value.error) throw new BadGatewayException('番茄上游服务不可用');
        return value;
      };
      let ready = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        deadline.throwIfAborted();
        if (spawnError || child.exitCode !== null) throw new BadGatewayException('番茄下载器无法启动或已退出');
        try {
          await request('/api/status');
          ready = true;
          break;
        } catch {
          await delay(250, undefined, { signal: deadline });
        }
      }
      if (!ready) throw new BadGatewayException('番茄下载器启动超时');
      const preview = await request(`/api/preview/${bookId}`);
      if (
        !preview ||
        typeof preview !== 'object' ||
        !('book_id' in preview) ||
        String(preview.book_id) !== bookId ||
        !('book_name' in preview) ||
        typeof preview.book_name !== 'string' ||
        !preview.book_name.trim()
      )
        throw new BadGatewayException('番茄书名缺失或书籍不匹配');
      const title = preview.book_name.trim().slice(0, 200);
      const jobId = tomatoJobId(await request('/api/jobs', { book_id: bookId }));
      while (tomatoJobState(await request(`/api/jobs?id=${jobId}`), jobId, bookId) !== 'done') await delay(500, undefined, { signal: deadline });
      assertTomatoComplete(await request('/api/history?limit=1'), bookId);
      const files = (await readdir(output)).filter((name) => name.endsWith('.epub'));
      if (files.length !== 1) throw new BadGatewayException('番茄下载未生成唯一 EPUB');
      const file = join(output, files[0]!);
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > MAX_BOOK_BYTES)
        throw new BadGatewayException('番茄 EPUB 为空或超过 64 MiB');
      const bytes = await readFile(file);
      await assertSourceEpub(bytes);
      deadline.throwIfAborted();
      this.logger.log(
        `[book_source.tomato_download] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} bytes=${bytes.length} - download completed`,
      );
      return { content: bytes, title };
    } catch (error) {
      this.logger.warn(
        `[book_source.tomato_download] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - download failed`,
      );
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error;
      throw new BadGatewayException(signal.aborted ? '番茄下载已取消' : '番茄下载失败或超时');
    } finally {
      try {
        if (child && child.exitCode === null && child.pid) {
          const exited = once(child, 'exit');
          child.kill('SIGTERM');
          await Promise.race([exited, delay(5000, undefined, { ref: false })]);
        }
        if (root) await rm(root, { recursive: true, force: true });
      } finally {
        this.busy = false;
      }
    }
  }

  @Interval(60000)
  async cleanupStaging(): Promise<void> {
    const startedAt = Date.now();
    let removed = 0;
    try {
      const directory = await opendir(join(this.storage.appDataPath, 'source-staging')).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!directory) return;
      let scanned = 0;
      for await (const entry of directory) {
        if (++scanned > 1000) break;
        if (!entry.isDirectory() || !/^tomato-[a-zA-Z0-9]{6}$/.test(entry.name)) continue;
        const path = join(this.storage.appDataPath, 'source-staging', entry.name);
        const info = await lstat(path).catch(() => null);
        // Every guarded download is limited to one hour, including after a parent crash.
        if (!info?.isDirectory() || info.isSymbolicLink() || Date.now() - info.mtimeMs < 2 * 3600000) continue;
        await rm(path, { recursive: true, force: true });
        removed++;
      }
      if (removed) this.logger.log(`[book_source.cleanup] [end] durationMs=${Date.now() - startedAt} removed=${removed} - expired staging removed`);
    } catch (error) {
      this.logger.warn(
        `[book_source.cleanup] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - staging cleanup failed`,
      );
    }
  }

  private async verifyBinary(): Promise<void> {
    const expected = RELEASE_HASHES[process.arch];
    if (process.platform !== 'linux' || !expected || !isAbsolute(this.config.tomatoBinaryPath))
      throw new ServiceUnavailableException('番茄下载需要配置 Linux amd64/arm64 下载器');
    const info = await lstat(this.config.tomatoBinaryPath).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || info.size > 128 * 1024 * 1024) throw new ServiceUnavailableException('番茄下载器文件无效');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(this.config.tomatoBinaryPath)) hash.update(chunk);
    if (hash.digest('hex') !== expected) throw new ServiceUnavailableException('番茄下载器版本或 SHA-256 不匹配，需要 v2.4.15');
  }
}

async function reservePort(): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new ServiceUnavailableException('无法分配下载器端口');
    return address.port;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export function tomatoRuntimeEnvironment(root: string, port: number, password: string, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    LANG: 'C.UTF-8',
    PATH: '/usr/bin:/bin',
    HOME: root,
    CARGO: 'bookorbit-pinned-release',
    TOMATO_WEB_ADDR: `127.0.0.1:${port}`,
    TOMATO_WEB_PASSWORD: password,
    TMPDIR: root,
    ...(parent.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: parent.LD_LIBRARY_PATH } : {}),
  };
}
