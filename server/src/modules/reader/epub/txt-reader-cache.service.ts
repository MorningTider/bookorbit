import type { Stats } from 'node:fs';
import {
  BadRequestException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { convertTxtToEpub } from '../../metadata/lib/txt-to-epub';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';

export const TXT_READER_CACHE_DIRECTORY = Symbol('TXT_READER_CACHE_DIRECTORY');
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const MAX_CACHE_FILES = 16;
const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

@Injectable()
export class TxtReaderCacheService {
  private readonly logger = new Logger(TxtReaderCacheService.name);
  private readonly pending = new Map<string, Promise<string>>();
  private readonly lastAccess = new Map<string, number>();

  constructor(@Inject(TXT_READER_CACHE_DIRECTORY) private readonly directory: string) {}

  async prepare(bookId: number, fileId: number, source: string): Promise<string> {
    let before: Stats;
    try {
      before = await stat(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException('TXT file no longer exists');
      throw error;
    }
    if (!before.isFile() || before.size === 0 || before.size > MAX_SOURCE_BYTES)
      throw new BadRequestException('TXT reading requires a nonempty file up to 128 MiB');
    const fingerprint = `${fileId}:${source}:${before.size}:${before.mtimeMs}:${before.ctimeMs}:v1`;
    const key = createHash('sha256').update(fingerprint).digest('hex');
    const destination = join(this.directory, key + '.epub');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directory = await lstat(this.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new BadRequestException('Invalid TXT reader cache directory');
    await chmod(this.directory, 0o700);
    try {
      const cached = await lstat(destination);
      if (!cached.isFile() || cached.isSymbolicLink()) throw new BadRequestException('Invalid TXT reader cache');
      this.lastAccess.set(destination, Date.now());
      return destination;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size) throw new ServiceUnavailableException('Another TXT is being prepared; retry shortly');
    const preparing = this.build(bookId, fileId, source, before, destination).finally(() => this.pending.delete(key));
    this.pending.set(key, preparing);
    return preparing;
  }

  private async makeRoom() {
    const names = (await readdir(this.directory)).filter((name) => /^[a-f0-9]{64}\.epub$/.test(name) || /^[a-f0-9-]+\.part\.epub$/.test(name));
    const entries = await Promise.all(
      names.map(async (name) => ({ path: join(this.directory, name), info: await lstat(join(this.directory, name)) })),
    );
    const present = new Set(entries.map((entry) => entry.path));
    for (const path of this.lastAccess.keys()) if (!present.has(path)) this.lastAccess.delete(path);
    const accessed = (entry: (typeof entries)[number]) => this.lastAccess.get(entry.path) ?? entry.info.mtimeMs;
    let bytes = entries.reduce((sum, entry) => sum + entry.info.size, 0);
    let count = entries.length;
    for (const entry of entries.sort((a, b) => accessed(a) - accessed(b))) {
      if (bytes <= MAX_CACHE_BYTES - MAX_SOURCE_BYTES && count < MAX_CACHE_FILES) break;
      if (Date.now() - accessed(entry) < ACTIVE_WINDOW_MS) continue;
      await rm(entry.path, { force: true });
      this.lastAccess.delete(entry.path);
      bytes -= entry.info.size;
      count--;
    }
    if (bytes > MAX_CACHE_BYTES - MAX_SOURCE_BYTES || count >= MAX_CACHE_FILES)
      throw new ServiceUnavailableException('TXT reading cache is busy; retry later');
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9-]+\.part\.epub$/.test(name)) continue;
      const path = join(this.directory, name);
      if (Date.now() - (await lstat(path)).mtimeMs > ACTIVE_WINDOW_MS) await rm(path, { force: true });
    }
  }

  private async build(bookId: number, fileId: number, source: string, before: Stats, destination: string) {
    const startedAt = Date.now();
    const temporary = join(this.directory, randomUUID() + '.part.epub');
    this.logger.log(`[book.prepare_txt_reader] [start] bookId=${bookId} fileId=${fileId} - preparing temporary TXT reading cache`);
    try {
      await this.makeRoom();
      await convertTxtToEpub(source, temporary, basename(source).replace(/\.txt$/i, ''), {
        signal: AbortSignal.timeout(120000),
        maxSectionCharacters: 100000,
      });
      const after = await stat(source);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
        throw new BadRequestException('TXT changed while preparing; retry');
      if ((await stat(temporary)).size > MAX_SOURCE_BYTES) throw new BadRequestException('TXT reading cache exceeds 128 MiB');
      await chmod(temporary, 0o600);
      await rename(temporary, destination);
      this.lastAccess.set(destination, Date.now());
      this.logger.log(
        `[book.prepare_txt_reader] [end] bookId=${bookId} fileId=${fileId} durationMs=${Date.now() - startedAt} - temporary TXT reading cache ready`,
      );
      return destination;
    } catch (error) {
      this.logger.warn(
        `[book.prepare_txt_reader] [fail] bookId=${bookId} fileId=${fileId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - TXT reading preparation failed`,
      );
      if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
        throw new GatewayTimeoutException('TXT reading preparation timed out');
      throw error;
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
