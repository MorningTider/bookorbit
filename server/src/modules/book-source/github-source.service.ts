import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { BookSourceJobProgress, GithubBookSourceUpdate, GithubSourceFile } from '@bookorbit/types';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { bookSourceConfig, storageConfig } from '../../config/config';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { UploadValidatorService } from '../upload/upload-validator.service';
import { GithubSourceClient, normalizeGithubRepository, GITHUB_FILE_LIMIT } from './github-source.client';
import { GithubSourceRepository } from './github-source.repository';
import { DownloadIdleDeadline } from './download-idle-deadline';
import { assertSourceEpub } from './validate-source-epub';

export function githubJobIdentity(file: GithubSourceFile) {
  const key = createHash('sha256')
    .update(JSON.stringify([file.repository, file.path, file.blobSha]))
    .digest('hex')
    .slice(0, 18);
  return `github:${key}`;
}

@Injectable()
export class GithubSourceService implements OnModuleDestroy {
  private readonly logger = new Logger(GithubSourceService.name);
  private readonly active = new Map<number, { controller: AbortController; promise: Promise<void> }>();
  constructor(
    private readonly repository: GithubSourceRepository,
    private readonly client: GithubSourceClient,
    private readonly validator: UploadValidatorService,
    @Inject(storageConfig.KEY) private readonly storage: ConfigType<typeof storageConfig>,
    @Inject(bookSourceConfig.KEY) private readonly settings: ConfigType<typeof bookSourceConfig>,
  ) {}

  config() {
    return this.repository.config();
  }
  async update(input: GithubBookSourceUpdate) {
    const repositories = input.repositories.map(normalizeGithubRepository);
    const identities = repositories.map((row) => JSON.stringify([row.repository, row.branch, row.path]));
    if (new Set(identities).size !== identities.length) throw new BadRequestException('Duplicate repository branch and folder');
    const startedAt = Date.now();
    this.logger.log(`[github_source.config] [start] repositories=${repositories.length} enabled=${input.enabled} - settings update started`);
    try {
      const config = await this.repository.update({ ...input, repositories });
      this.logger.log(`[github_source.config] [end] durationMs=${Date.now() - startedAt} repositories=${repositories.length} - settings saved`);
      return config;
    } catch (error) {
      this.logger.warn(
        `[github_source.config] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - settings update failed`,
      );
      throw error;
    }
  }
  async status() {
    const config = await this.repository.config();
    const enabled = config.repositories.filter((row) => row.enabled);
    return {
      enabled: config.enabled,
      configured: enabled.some((row) => row.indexedAt !== null && row.fileCount > 0),
      repositoryCount: enabled.length,
    };
  }
  async search(query: string, cursor?: string) {
    if (!(await this.repository.config()).enabled) throw new ConflictException('GitHub source is disabled');
    if (!query.trim()) return { items: [], nextCursor: null };
    return this.repository.search(query, cursor);
  }
  async prepare(entryId: number, blobSha: string | null | undefined) {
    const file = await this.repository.entry(entryId);
    if (file.blobSha !== (blobSha ?? null)) throw new ConflictException('Search result changed; search again');
    await this.repository.assertCurrent(file);
    const metadata =
      file.blobSha !== null && file.sizeBytes !== null
        ? { blobSha: file.blobSha, sizeBytes: file.sizeBytes }
        : await this.client.fileMetadata(file, new AbortController().signal);
    const resolved: GithubSourceFile = { ...file, ...metadata };
    await this.repository.assertCurrent(resolved);
    return resolved;
  }
  assertCurrent(file: GithubSourceFile) {
    return this.repository.assertCurrent(file);
  }
  async test(id: number) {
    const startedAt = Date.now();
    this.logger.log(`[github_source.test] [start] repositoryId=${id} - connection test started`);
    try {
      const repo = await this.repository.find(id);
      const result = await this.client.resolve(repo, new AbortController().signal);
      this.logger.log(`[github_source.test] [end] repositoryId=${id} durationMs=${Date.now() - startedAt} - repository and folder accessible`);
      return { repository: repo.repository, branch: result.branch, commitSha: result.commitSha };
    } catch (error) {
      this.logger.warn(
        `[github_source.test] [fail] repositoryId=${id} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - connection test failed`,
      );
      throw error;
    }
  }

  async refresh(id: number) {
    if (this.active.has(id)) throw new ConflictException('Repository is already being indexed');
    if (this.active.size >= 2) throw new ConflictException('Two repository indexes are running; retry when one finishes');
    const runId = randomUUID();
    const repo = await this.repository.claim(id, runId);
    const controller = new AbortController();
    const promise = this.index(repo, runId, controller).finally(() => this.active.delete(id));
    this.active.set(id, { controller, promise });
    return { repositoryId: id, indexState: 'indexing' as const };
  }

  private async index(repo: Awaited<ReturnType<GithubSourceRepository['find']>>, runId: string, controller: AbortController) {
    const startedAt = Date.now();
    this.logger.log(`[github_source.index] [start] repositoryId=${repo.id} - indexing started`);
    const heartbeat = setInterval(() => {
      void this.repository.stage(repo.id, runId, []).catch((error) => controller.abort(error));
    }, 30_000);
    heartbeat.unref();
    let count = 0;
    try {
      let batch: Parameters<GithubSourceRepository['stage']>[2] = [];
      for await (const file of this.client.files(repo, controller.signal)) {
        controller.signal.throwIfAborted();
        batch.push({ ...file, repositoryId: repo.id, generation: runId });
        count++;
        if (batch.length === 500) {
          await this.repository.stage(repo.id, runId, batch);
          batch = [];
        }
      }
      if (!count)
        throw new BadGatewayException(
          'No supported ebook files found; check the folder and formats. External download indexes need a separate adapter',
        );
      await this.repository.stage(repo.id, runId, batch);
      await this.repository.publish(repo.id, runId, count);
      this.logger.log(`[github_source.index] [end] repositoryId=${repo.id} durationMs=${Date.now() - startedAt} files=${count} - index published`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'GitHub indexing failed';
      await this.repository
        .fail(repo.id, runId, message)
        .catch((failure) =>
          this.logger.error(
            `[github_source.index] [fail] repositoryId=${repo.id} durationMs=${Date.now() - startedAt} errorClass=${failure instanceof Error ? failure.name : 'Error'} error="${sanitizeLogValue(failure instanceof Error ? failure.message : String(failure))}" - failed to save index outcome`,
          ),
        );
      this.logger.warn(
        `[github_source.index] [fail] repositoryId=${repo.id} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - index update failed`,
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  async withDownload<T>(
    file: GithubSourceFile,
    signal: AbortSignal,
    onProgress: ((progress: BookSourceJobProgress) => void) | undefined,
    useFile: (path: string) => Promise<T>,
  ): Promise<T> {
    await this.repository.assertCurrent(file);
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > GITHUB_FILE_LIMIT)
      throw new BadRequestException('GitHub ebook size is invalid');
    const startedAt = Date.now();
    this.logger.log(`[github_source.download] [start] repositoryId=${file.repositoryId} bytes=${file.sizeBytes} - download started`);
    const parent = join(this.storage.appDataPath, 'github-source-downloads');
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(parent, 'download-'));
    const path = join(directory, `book.${file.format}`);
    const idle = new DownloadIdleDeadline(this.settings.timeoutMs, signal, 'Download stalled with no new bytes; retry the task');
    let received = 0;
    try {
      const response = await this.client.openFile(file, idle.signal);
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new BadGatewayException(`GitHub file download failed (HTTP ${response.status})`);
      }
      const hash = createHash(file.blobSha.length === 64 ? 'sha256' : 'sha1').update(`blob ${file.sizeBytes}\0`);
      let lastReport = 0;
      const report = () => onProgress?.({ phase: 'downloading', title: file.title, downloadedBytes: received, totalBytes: file.sizeBytes });
      report();
      const counted = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          if (received > file.sizeBytes) {
            callback(new BadGatewayException('GitHub file exceeds its indexed size'));
            return;
          }
          hash.update(chunk);
          idle.advance(received);
          if (Date.now() - lastReport >= 200) {
            report();
            lastReport = Date.now();
          }
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), counted, createWriteStream(path, { flags: 'wx', mode: 0o600 }), {
        signal: idle.signal,
      });
      idle.dispose();
      report();
      if (received !== file.sizeBytes || hash.digest('hex') !== file.blobSha)
        throw new BadGatewayException('GitHub file size or blob hash does not match the indexed version');
      onProgress?.({ phase: 'validating', title: file.title, downloadedBytes: received, totalBytes: file.sizeBytes });
      await this.validator.validateContent(path, file.format);
      if (file.format === 'epub') await assertSourceEpub(path);
      signal.throwIfAborted();
      await this.repository.assertCurrent(file);
      const result = await useFile(path);
      this.logger.log(
        `[github_source.download] [end] repositoryId=${file.repositoryId} durationMs=${Date.now() - startedAt} bytes=${received} - file handed to importer`,
      );
      return result;
    } catch (error) {
      const cause = idle.signal.aborted && !signal.aborted ? (idle.signal.reason as unknown) : error;
      this.logger.warn(
        `[github_source.download] [fail] repositoryId=${file.repositoryId} durationMs=${Date.now() - startedAt} bytes=${received} errorClass=${cause instanceof Error ? cause.name : 'Error'} error="${sanitizeLogValue(cause instanceof Error ? cause.message : String(cause))}" - file acquisition stopped`,
      );
      throw cause;
    } finally {
      idle.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }

  async onModuleDestroy() {
    for (const active of this.active.values()) active.controller.abort();
    await Promise.allSettled([...this.active.values()].map((active) => active.promise));
  }
}
