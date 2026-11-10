import { staticAssetCacheOptions } from './static-asset-cache';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { IMMUTABLE_CACHE_CONTROL } from './utils/static-cache.utils';

describe('@fastify/static production compatibility', () => {
  let app: FastifyInstance | undefined;
  let testRoot: string;
  let publicRoot: string;

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'bookorbit-fastify-static-'));
    publicRoot = join(testRoot, 'public');
    await mkdir(join(publicRoot, 'assets'), { recursive: true });
    await mkdir(join(publicRoot, 'deep'), { recursive: true });
    await writeFile(join(publicRoot, 'index.html'), '<main>BookOrbit</main>');
    await writeFile(join(publicRoot, 'assets', 'app.js'), 'globalThis.bookOrbit = true;');
    await writeFile(join(publicRoot, 'deep', 'secret.txt'), 'protected');
    await writeFile(join(testRoot, 'outside.txt'), 'outside root');
  });

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
    }
    await rm(testRoot, { recursive: true, force: true });
  });

  it('serves built assets and supports the SPA fallback', async () => {
    app = Fastify();
    await app.register(fastifyStatic, {
      root: publicRoot,
      prefix: '/',
    });
    app.setNotFoundHandler((_request, reply) => reply.sendFile('index.html'));
    await app.ready();

    const assetResponse = await app.inject({ method: 'GET', url: '/assets/app.js' });
    const fallbackResponse = await app.inject({ method: 'GET', url: '/library/books/1' });

    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.body).toBe('globalThis.bookOrbit = true;');
    expect(fallbackResponse.statusCode).toBe(200);
    expect(fallbackResponse.body).toBe('<main>BookOrbit</main>');
  });

  it('serves changed same-size native entrypoints even with stale zero-mtime validators', async () => {
    const entry = join(publicRoot, 'index.html');
    const worker = join(publicRoot, 'sw.js');
    await writeFile(entry, '<main>Old</main>');
    await writeFile(worker, 'const version="old";');
    await utimes(entry, 0, 0);
    await utimes(worker, 0, 0);
    const legacy = Fastify();
    await legacy.register(fastifyStatic, { root: publicRoot, prefix: '/' });
    await legacy.ready();
    try {
      const unchanged = await legacy.inject({
        method: 'GET',
        url: '/',
        headers: { 'if-none-match': `W/"${Buffer.byteLength('<main>Old</main>').toString(16)}-0"` },
      });
      expect(unchanged.statusCode).toBe(304);
    } finally {
      await legacy.close();
    }
    app = Fastify();
    await app.register(fastifyStatic, { root: publicRoot, prefix: '/', ...staticAssetCacheOptions });
    app.setNotFoundHandler((_request, reply) => reply.sendFile('index.html'));
    await app.ready();
    await writeFile(entry, '<main>New</main>');
    await writeFile(worker, 'const version="new";');
    await utimes(entry, 0, 0);
    await utimes(worker, 0, 0);
    for (const [url, body] of [
      ['/', '<main>New</main>'],
      ['/authors', '<main>New</main>'],
      ['/sw.js', 'const version="new";'],
    ]) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { 'if-none-match': `W/"${Buffer.byteLength(body).toString(16)}-0"`, 'if-modified-since': 'Thu, 01 Jan 1970 00:00:00 GMT' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(body);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.etag).toBeUndefined();
      expect(response.headers['last-modified']).toBeUndefined();
    }
  });
  it('retains long-lived caching for fingerprinted assets while revalidating mutable files', async () => {
    await writeFile(join(publicRoot, 'assets', 'app-01234567.js'), 'built');
    app = Fastify();
    await app.register(fastifyStatic, { root: publicRoot, prefix: '/', ...staticAssetCacheOptions });
    await app.ready();
    const hashed = await app.inject({ method: 'GET', url: '/assets/app-01234567.js' });
    const mutable = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(hashed.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(mutable.headers['cache-control']).toBe('no-store');
  });
  it('caches hashed build output forever and keeps fixed-name files revalidating', async () => {
    await mkdir(join(publicRoot, 'assets', 'foliate'), { recursive: true });
    await mkdir(join(publicRoot, 'assets', 'lucide', '1.62.0'), { recursive: true });
    await writeFile(join(publicRoot, 'assets', 'index-AbCd1234.js'), 'export {};');
    await writeFile(join(publicRoot, 'assets', 'foliate', 'view.js'), 'export {};');
    await writeFile(join(publicRoot, 'assets', 'lucide', '1.62.0', 'folder-open.svg'), '<svg/>');
    await writeFile(join(publicRoot, 'sw.js'), 'self;');

    app = Fastify();
    await app.register(fastifyStatic, {
      root: publicRoot,
      prefix: '/',
      ...staticAssetCacheOptions,
    });
    app.setNotFoundHandler((_request, reply) => reply.sendFile('index.html'));
    await app.ready();

    const cacheControl = async (url: string) => {
      const response = await app!.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      return response.headers['cache-control'];
    };

    expect(await cacheControl('/assets/index-AbCd1234.js')).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(await cacheControl('/assets/lucide/1.62.0/folder-open.svg')).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(await cacheControl('/assets/foliate/view.js')).toBe('no-store');
    expect(await cacheControl('/index.html')).toBe('no-store');
    expect(await cacheControl('/sw.js')).toBe('no-store');
    expect(await cacheControl('/library/books/1')).toBe('no-store');
  });

  it.each(['/foo/../deep/secret.txt', '/foo/%2E%2E/deep/secret.txt', '/assets/../../outside.txt'])(
    'rejects non-canonical static path %s',
    async (url) => {
      app = Fastify();
      app.get('/deep/*', async (_request, reply) => reply.code(403).send());
      await app.register(fastifyStatic, {
        root: publicRoot,
        prefix: '/',
      });
      await app.ready();

      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).not.toBe(200);
      expect(response.body).not.toContain('protected');
      expect(response.body).not.toContain('outside root');
    },
  );
});
