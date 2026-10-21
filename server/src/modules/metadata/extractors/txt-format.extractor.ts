import { open } from 'fs/promises';

import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';
import { decodeTxt } from '../lib/txt-decoder';

const MAX_METADATA_BYTES = 512 * 1024;

function titleFromPath(absolutePath: string): string {
  const name = absolutePath.split(/[\\/]/).pop() ?? 'Untitled';
  return name.replace(/\.txt$/i, '').trim() || 'Untitled';
}

export class TxtFormatExtractor implements FormatExtractor {
  async extract(absolutePath: string): Promise<ParsedBookData | null> {
    const handle = await open(absolutePath, 'r');
    let buffer: Buffer;
    try {
      const stat = await handle.stat();
      if (stat.size === 0) return null;
      buffer = Buffer.alloc(Math.min(stat.size, MAX_METADATA_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      buffer = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    const text = decodeTxt(buffer);
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const title = lines[0] && lines[0].length <= 200 ? lines[0] : titleFromPath(absolutePath);
    return {
      title,
      authors: [],
      genres: [],
      tags: [],
      cover: null,
      language: /[\u4e00-\u9fff]/.test(text) ? 'zh' : null,
    };
  }
}
