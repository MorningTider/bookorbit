import type { FastifyReply } from 'fastify';
import { basename, sep } from 'node:path';

// Native archives normalise mtimes, so size/mtime validators can collide across releases.
export const staticAssetCacheOptions = {
  etag: false,
  lastModified: false,
  cacheControl: false,
  setHeaders(response: FastifyReply, filePath: string) {
    const fingerprinted = filePath.includes(`${sep}assets${sep}`) && /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(basename(filePath));
    const versionedIcon = /[/\\]assets[/\\]lucide[/\\]\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?[/\\]/.test(filePath);
    response.header('Cache-Control', fingerprinted || versionedIcon ? 'public, max-age=31536000, immutable' : 'no-store');
  },
};
