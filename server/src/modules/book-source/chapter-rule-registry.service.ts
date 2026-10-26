import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { load } from 'cheerio';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { PublicChapterRule } from '@bookorbit/types';
import { storageConfig } from '../../config/config';
import { PublicChapterRulesDto } from './dto/public-chapter-rules.dto';

export function validateChapterRules(input: unknown): PublicChapterRule[] {
  const dto = plainToInstance(PublicChapterRulesDto, input);
  if (!dto || validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length) throw new BadRequestException('书源规则格式无效');
  const keys = new Set<string>();
  for (const source of dto.sources) {
    if (keys.has(source.key) || ['qidian', 'fanqie'].includes(source.key)) throw new BadRequestException('书源标识重复或为内置来源');
    keys.add(source.key);
    let origin: URL;
    try {
      origin = new URL(source.origin);
    } catch {
      throw new BadRequestException('书源地址无效');
    }
    if (
      origin.protocol !== 'https:' ||
      origin.origin !== source.origin ||
      origin.port ||
      origin.username ||
      origin.password ||
      origin.hostname === 'localhost' ||
      origin.hostname.endsWith('.local')
    )
      throw new BadRequestException('书源必须使用固定HTTPS公开域名');
    for (const path of [source.bookPath, source.catalogPath]) {
      if (
        !path.startsWith('/') ||
        path.startsWith('//') ||
        path.includes('\\') ||
        path.split('{id}').length !== 2 ||
        path.includes('?') ||
        path.includes('#') ||
        path.includes('..') ||
        new URL(path.replace('{id}', '1'), origin).origin !== source.origin
      )
        throw new BadRequestException('书源路径必须在同站点并包含一个{id}');
    }
    const $ = load('<div/>');
    for (const [key, selector] of Object.entries(source))
      if (key.endsWith('Selector')) {
        try {
          $(selector);
        } catch {
          throw new BadRequestException('书源选择器无效');
        }
      }
  }
  return dto.sources;
}

@Injectable()
export class ChapterRuleRegistry {
  private readonly logger = new Logger(ChapterRuleRegistry.name);
  private mutation: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  constructor(@Inject(storageConfig.KEY) private readonly storage: ConfigType<typeof storageConfig>) {
    this.path = join(storage.appDataPath, 'public-chapter-sources.json');
  }

  async all(): Promise<PublicChapterRule[]> {
    try {
      const info = await lstat(this.path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) throw new BadRequestException('书源规则文件无效或过大');
      return validateChapterRules(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
      if (error instanceof SyntaxError) throw new BadRequestException('书源规则JSON无效');
      throw error;
    }
  }

  async get(key: string) {
    const source = (await this.all()).find((item) => item.key === key);
    if (!source) throw new NotFoundException('书源已移除或尚未配置');
    return source;
  }

  async update(input: unknown) {
    const next = validateChapterRules(input);
    const startedAt = Date.now();
    this.logger.log(`[book_source.rules] [start] sources=${next.length} - rules update started`);
    const operation = this.mutation.then(async () => {
      const current = await this.all();
      for (const old of current) {
        const changed = next.find((item) => item.key === old.key);
        if (changed && Object.keys(old).some((key) => old[key as keyof PublicChapterRule] !== changed[key as keyof PublicChapterRule]))
          throw new ConflictException('修改规则请使用新的书源标识，避免已有任务下载到不同来源');
      }
      // Keep removed identities reserved so queued tasks cannot silently resolve to different rules.
      const historyPath = this.path + '.identities';
      let history: Record<string, PublicChapterRule> = {};
      try {
        history = JSON.parse(await readFile(historyPath, 'utf8')) as Record<string, PublicChapterRule>;
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      for (const source of [...current, ...next]) {
        const old = history[source.key];
        if (old && Object.keys(source).some((key) => old[key as keyof PublicChapterRule] !== source[key as keyof PublicChapterRule]))
          throw new ConflictException('该书源标识已用于其他规则，请使用新标识');
        history[source.key] = source;
      }
      if (Object.keys(history).length > 200) throw new BadRequestException('历史书源标识达到200个限制');
      await mkdir(this.storage.appDataPath, { recursive: true, mode: 0o700 });
      const save = async (path: string, data: unknown) => {
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
          await rename(temporary, path);
        } finally {
          await rm(temporary, { force: true });
        }
      };
      await save(historyPath, history);
      await save(this.path, { sources: next });
      return { sources: next };
    });
    this.mutation = operation.catch(() => {});
    void operation.then(
      () => this.logger.log(`[book_source.rules] [end] durationMs=${Date.now() - startedAt} sources=${next.length} - rules update completed`),
      (error: unknown) =>
        this.logger.warn(
          `[book_source.rules] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} - rules update failed`,
        ),
    );
    return operation;
  }
}
