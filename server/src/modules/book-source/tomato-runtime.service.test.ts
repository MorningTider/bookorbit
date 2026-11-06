import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { bookSourceConfig, storageConfig } from '../../config/config';
import { TomatoRuntimeService, tomatoRuntimeEnvironment } from './tomato-runtime.service';

describe('TomatoRuntimeService configuration boundary', () => {
  async function service() {
    const module = await Test.createTestingModule({
      providers: [
        TomatoRuntimeService,
        { provide: bookSourceConfig.KEY, useValue: { tomatoBinaryPath: '', timeoutMs: 5000 } },
        { provide: storageConfig.KEY, useValue: { appDataPath: '/tmp/bookorbit-test' } },
      ],
    }).compile();
    return module.get(TomatoRuntimeService);
  }
  it('rejects invalid identities before invoking a runtime', async () => {
    await expect((await service()).download('../file', new AbortController().signal)).rejects.toThrow('ID 无效');
  });
  it('reports missing runtime configuration and releases the concurrency slot', async () => {
    const runtime = await service();
    const signal = new AbortController().signal;
    await expect(runtime.download('7290175791344651298', signal)).rejects.toThrow('配置 Linux');
    await expect(runtime.download('7290175791344651298', signal)).rejects.toThrow('配置 Linux');
  });
});

import { mkdtemp, mkdir, rm, symlink, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('cleans abandoned staging without following symlinks or removing live downloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bookorbit-cleanup-test-'));
  try {
    const staging = join(root, 'source-staging');
    await mkdir(staging);
    const expired = join(staging, 'tomato-abc123');
    const live = join(staging, 'tomato-new123');
    const unrelated = join(staging, 'user-files');
    const outside = join(root, 'outside');
    const resume = join(staging, 'tomato-resume-7328230298259295294');
    const expiredResume = join(staging, 'tomato-resume-7294485363593055286');
    for (const directory of [expired, live, unrelated, outside, resume, expiredResume]) await mkdir(directory);
    const old = new Date(Date.now() - 3 * 3600000);
    await utimes(expired, old, old);
    await utimes(unrelated, old, old);
    await utimes(resume, old, old);
    const weekOld = new Date(Date.now() - 8 * 24 * 3600000);
    await utimes(expiredResume, weekOld, weekOld);
    await symlink(outside, join(staging, 'tomato-link12'));
    const runtime = new TomatoRuntimeService(
      { tomatoBinaryPath: '', timeoutMs: 5000 },
      { appDataPath: root, bookDockPath: root, libraryBrowseRoot: root },
    );
    await runtime.cleanupStaging();
    expect((await readdir(staging)).sort()).toEqual(['tomato-link12', 'tomato-new123', 'tomato-resume-7328230298259295294', 'user-files']);
    expect(await readdir(outside)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('retains native loader libraries for the Node guard without leaking application credentials', () => {
  const env = tomatoRuntimeEnvironment('/private/staging', 12345, 'loopback-only', {
    LD_LIBRARY_PATH: '/package/lib',
    DATABASE_URL: 'private-db',
    JWT_SECRET: 'private-jwt',
    LD_PRELOAD: '/unsafe.so',
    HOME: '/administrator',
  });
  expect(env.LD_LIBRARY_PATH).toBe('/package/lib');
  expect(env.HOME).toBe('/private/staging');
  expect(env.PATH).toBe('/usr/bin:/bin');
  expect(env.TOMATO_WEB_ADDR).toBe('127.0.0.1:12345');
  expect(env).not.toHaveProperty('DATABASE_URL');
  expect(env).not.toHaveProperty('JWT_SECRET');
  expect(env).not.toHaveProperty('LD_PRELOAD');
  expect(tomatoRuntimeEnvironment('/private/staging', 12345, 'loopback-only', {})).not.toHaveProperty('LD_LIBRARY_PATH');
});
