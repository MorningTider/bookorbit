import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { basename, extname } from 'node:path';
import type { GithubRepositoryInput, GithubSourceCandidate } from '@bookorbit/types';
import { safeFetch } from '../../common/utils/safe-fetch';
import { boundedResponse, readBoundedText } from '../../common/utils/bounded-response';

type TreeItem = { path: string; type: string; mode: string; sha: string; size?: number };
type Tree = { tree: TreeItem[]; truncated: boolean };
export const GITHUB_FILE_LIMIT = 512 * 1024 * 1024;

export function normalizeGithubRepository(input: GithubRepositoryInput): GithubRepositoryInput {
  const repository = input.repository
    .trim()
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/\/$/, '')
    .replace(/\.git$/, '')
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/.test(repository) || repository.split('/')[1] === '..')
    throw new BadRequestException('Use a GitHub owner/repository address');
  const path = input.path.trim().replace(/^\/+|\/+$/g, '');
  if (/[\\\p{Cc}]/u.test(path) || (path && path.split('/').some((part) => !part || part === '.' || part === '..')))
    throw new BadRequestException('Invalid repository folder');
  const branch = input.branch.trim();
  if (/\p{Cc}/u.test(branch) || !input.label.trim()) throw new BadRequestException('Repository name or branch is invalid');
  return { ...input, repository, path, branch, label: input.label.trim() };
}

export function githubRawUrl(file: { repository: string; commitSha: string; path: string }) {
  if (
    !/^[a-f0-9]{40,64}$/.test(file.commitSha) ||
    !/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/.test(file.repository) ||
    file.path.split('/').some((part) => !part || part === '.' || part === '..') ||
    /[\\\p{Cc}]/u.test(file.path)
  )
    throw new BadRequestException('Invalid GitHub file snapshot');
  return `https://raw.githubusercontent.com/${file.repository}/${file.commitSha}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
}

@Injectable()
export class GithubSourceClient {
  async json<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await safeFetch(
      'https://api.github.com' + path,
      {
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BookOrbit', 'X-GitHub-Api-Version': '2022-11-28' },
      },
      { pinResolvedAddress: true },
    );
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 403 || response.status === 429) throw new BadGatewayException('GitHub rate limit or access restriction; retry later');
      throw new BadGatewayException(`GitHub request failed (HTTP ${response.status})`);
    }
    const text = await readBoundedText(response, 12 * 1024 * 1024);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new BadGatewayException('Invalid GitHub response');
    }
  }

  async resolve(repo: GithubRepositoryInput, signal: AbortSignal) {
    const metadata = await this.json<{ default_branch: string }>(`/repos/${repo.repository}`, signal);
    const branch = repo.branch || metadata.default_branch;
    if (!branch) throw new BadGatewayException('GitHub default branch is missing');
    const commit = await this.json<{ sha: string; commit: { tree: { sha: string } } }>(
      `/repos/${repo.repository}/commits/${encodeURIComponent(branch)}`,
      signal,
    );
    if (!/^[a-f0-9]{40,64}$/.test(commit.sha) || !/^[a-f0-9]{40,64}$/.test(commit.commit?.tree?.sha))
      throw new BadGatewayException('Invalid GitHub commit');
    let treeSha = commit.commit.tree.sha;
    for (const part of repo.path ? repo.path.split('/') : []) {
      const tree = await this.tree(repo.repository, treeSha, false, signal);
      const directory = tree.tree.find((entry) => entry.type === 'tree' && entry.path === part);
      if (!directory) throw new BadGatewayException('Configured repository folder does not exist');
      treeSha = directory.sha;
    }
    return { commitSha: commit.sha, treeSha, branch };
  }

  async openFile(file: { repository: string; commitSha: string; path: string; sizeBytes?: number }, signal: AbortSignal) {
    const url = githubRawUrl(file);
    const headersDeadline = new AbortController();
    const timer = setTimeout(() => headersDeadline.abort(), 8000);
    let direct: Response | undefined;
    try {
      direct = await safeFetch(
        url,
        {
          redirect: 'error',
          signal: AbortSignal.any([signal, headersDeadline.signal]),
          headers: { 'User-Agent': 'BookOrbit' },
        },
        { pinResolvedAddress: true, http1Only: true },
      );
      if (direct.status < 500 || (file.sizeBytes && file.sizeBytes > 100 * 1024 * 1024)) return direct;
      await direct.body?.cancel();
    } catch (error) {
      signal.throwIfAborted();
      if (file.sizeBytes && file.sizeBytes > 100 * 1024 * 1024) throw error;
    } finally {
      clearTimeout(timer);
    }
    const path = file.path.split('/').map(encodeURIComponent).join('/');
    return safeFetch(
      `https://api.github.com/repos/${file.repository}/contents/${path}?ref=${file.commitSha}`,
      {
        redirect: 'error',
        signal,
        headers: { 'User-Agent': 'BookOrbit', Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' },
      },
      { pinResolvedAddress: true, http1Only: true },
    );
  }

  async fileMetadata(file: GithubSourceCandidate, signal: AbortSignal) {
    const path = file.path.split('/').map(encodeURIComponent).join('/');
    const info = await this.json<{ type: string; path: string; size: number; sha: string }>(
      `/repos/${file.repository}/contents/${path}?ref=${file.commitSha}`,
      signal,
    );
    if (
      info.type !== 'file' ||
      info.path !== file.path ||
      !Number.isSafeInteger(info.size) ||
      info.size < 1 ||
      info.size > GITHUB_FILE_LIMIT ||
      !/^[a-f0-9]{40,64}$/.test(info.sha)
    )
      throw new BadGatewayException('Invalid GitHub file snapshot');
    return { sizeBytes: info.size, blobSha: info.sha };
  }

  private async *wenshuogeCatalog(repo: GithubRepositoryInput, commitSha: string, signal: AbortSignal) {
    const response = await this.openFile(
      { repository: repo.repository, commitSha, path: '文硕阁公版书目录.csv' },
      AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new BadGatewayException(`GitHub request failed (HTTP ${response.status})`);
    }
    const bounded = boundedResponse(response, 64 * 1024 * 1024);
    const source = Readable.fromWeb(bounded.body as ReadableStream<Uint8Array>);
    const records = parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      max_record_size: 1024 * 1024,
    });
    const completed = pipeline(source, records);
    void completed.catch(() => {});
    let count = 0;
    try {
      for await (const record of records as AsyncIterable<Record<string, string>>) {
        signal.throwIfAborted();
        if (++count > 100_000) throw new BadGatewayException('Repository index exceeds 100000 entries');
        const id = record['编号'];
        const title = record['书名']?.trim();
        if (!id || !/^\d{1,10}$/.test(id) || !title) throw new BadGatewayException('Invalid GitHub book catalog');
        if (/[/\\\p{Cc}]/u.test(title)) continue;
        for (const format of repo.formats.filter((value) => value === 'epub' || value === 'pdf')) {
          yield { path: `ebookfiles/${id}/文硕阁_${title}.${format}`, commitSha, blobSha: null, format, sizeBytes: null, title: title.slice(0, 500) };
        }
      }
      await completed;
    } finally {
      source.destroy();
      records.destroy();
      await completed.catch(() => {});
    }
  }

  private async tree(repository: string, sha: string, recursive: boolean, signal: AbortSignal) {
    const data = await this.json<Tree>(`/repos/${repository}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`, signal);
    if (!Array.isArray(data.tree) || data.tree.length > 100_000) throw new BadGatewayException('Invalid or oversized GitHub tree');
    return data;
  }

  async *files(repo: GithubRepositoryInput, signal: AbortSignal) {
    const { commitSha, treeSha } = await this.resolve(repo, signal);
    if (repo.repository === 'zhpelo/wenshuoge' && ['', 'ebookfiles'].includes(repo.path)) {
      yield* this.wenshuogeCatalog(repo, commitSha, signal);
      return;
    }
    const recursive = await this.tree(repo.repository, treeSha, true, signal);
    const pending = recursive.truncated ? [{ sha: treeSha, prefix: repo.path }] : [];
    let visited = 0;
    const convert = (item: TreeItem, prefix: string) => {
      const path = [prefix, item.path].filter(Boolean).join('/');
      if (path.split('/').some((part) => !part || part === '.' || part === '..') || /[\\\p{Cc}]/u.test(path))
        throw new BadGatewayException('Invalid GitHub tree path');
      const format = extname(item.path).slice(1).toLowerCase();
      if (item.type !== 'blob' || !['100644', '100755'].includes(item.mode) || !repo.formats.includes(format as never)) return null;
      if (!Number.isSafeInteger(item.size) || !item.size || item.size > GITHUB_FILE_LIMIT || !/^[a-f0-9]{40,64}$/.test(item.sha)) return null;
      const title = basename(item.path, extname(item.path))
        .replace(/^文硕阁[_ -]+/, '')
        .slice(0, 500);
      return { path, commitSha, blobSha: item.sha, format: format as (typeof repo.formats)[number], sizeBytes: item.size, title };
    };
    if (!recursive.truncated) {
      for (const item of recursive.tree) {
        const file = convert(item, repo.path);
        if (file) {
          yield file;
        }
      }
      return;
    }
    while (pending.length) {
      signal.throwIfAborted();
      if (++visited > 100_000) throw new BadGatewayException('Repository index exceeds 100000 entries');
      const directory = pending.pop()!;
      const tree = await this.tree(repo.repository, directory.sha, false, signal);
      if (tree.truncated) throw new BadGatewayException('GitHub directory is truncated');
      for (const item of tree.tree) {
        if (++visited > 100_000) throw new BadGatewayException('Repository index exceeds 100000 entries');
        if (item.type === 'tree') pending.push({ sha: item.sha, prefix: [directory.prefix, item.path].filter(Boolean).join('/') });
        const file = convert(item, directory.prefix);
        if (file) {
          yield file;
        }
      }
    }
  }
}
