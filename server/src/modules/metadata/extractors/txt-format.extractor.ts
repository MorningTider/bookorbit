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
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20);
    const explicitTitle = lines.find((line) => /^(?:书名|title)\s*[:：]/i.test(line));
    const firstLine = lines.find((line) => !/^(?:作者|作\s*者|author)\s*[:：]/i.test(line));
    const isChapter =
      /^(?:第[零〇一二三四五六七八九十百千万两\d]+[章节卷回部篇]|序章|序言|楔子|前言|后记|尾声|番外|chapter\s+[\divxlcdm]+(?:\b|[.:]))/i.test(
        firstLine ?? '',
      );
    const titleLine = explicitTitle ?? (isChapter || /[。！？]/.test(firstLine ?? '') ? undefined : firstLine);
    const rawTitle = titleLine && titleLine.length <= 200 ? titleLine : titleFromPath(absolutePath);
    const title = rawTitle.replace(/^(?:书名|title)\s*[:：]\s*/i, '').trim() || titleFromPath(absolutePath);
    const authorLine = lines.find((line) => /^(?:作者|作\s*者|author)\s*[:：]/i.test(line));
    const author = authorLine?.replace(/^(?:作者|作\s*者|author)\s*[:：]\s*/i, '').trim();
    return {
      title,
      authors: author ? [{ name: author, sortName: null }] : [],
      genres: [],
      tags: [],
      cover: null,
      language: /[\u4e00-\u9fff]/.test(text) ? 'zh' : null,
    };
  }
}
