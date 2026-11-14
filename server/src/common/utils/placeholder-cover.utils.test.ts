import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import sharp from 'sharp';

import {
  GOOGLE_BOOKS_PLACEHOLDER_HASHES,
  GOOGLE_BOOKS_PLACEHOLDER_LENGTHS,
  isGeneratedGutenbergCover,
  isKnownPlaceholderCover,
} from './placeholder-cover.utils';

describe('isKnownPlaceholderCover', () => {
  it('matches only bytes of the placeholder length and hash', () => {
    const [length] = [...GOOGLE_BOOKS_PLACEHOLDER_LENGTHS];
    const sameLength = Buffer.alloc(length!, 1);

    expect(GOOGLE_BOOKS_PLACEHOLDER_HASHES.has(createHash('sha256').update(sameLength).digest('hex'))).toBe(false);
    expect(isKnownPlaceholderCover(sameLength)).toBe(false);
    expect(isKnownPlaceholderCover(Buffer.alloc(10))).toBe(false);
  });
});

describe('isGeneratedGutenbergCover', () => {
  // Generated cover from https://www.gutenberg.org/ebooks/23835, using gutenbergtools/libgutenberg Cover.draw.
  const fixture = new URL('./__fixtures__/gutenberg-generated-cover.png', import.meta.url);

  it('recognizes the generated branding independently of the title and artwork colours', async () => {
    const bytes = await readFile(fixture);
    expect(await isGeneratedGutenbergCover(bytes)).toBe(true);
    const changed = await sharp(bytes)
      .composite([{ input: Buffer.from('<svg width="1600" height="2000"><rect width="1600" height="2000" fill="red"/></svg>'), top: 0, left: 0 }])
      .png()
      .toBuffer();
    expect(await isGeneratedGutenbergCover(changed)).toBe(true);
  });

  it('preserves other covers with the same dimensions', async () => {
    const bytes = await sharp({ create: { width: 1600, height: 2400, channels: 3, background: '#114477' } })
      .png()
      .toBuffer();
    expect(await isGeneratedGutenbergCover(bytes)).toBe(false);
  });

  it('handles ordinary JPEG covers and unreadable images', async () => {
    const jpeg = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#224466' } })
      .jpeg()
      .toBuffer();
    expect(await isGeneratedGutenbergCover(jpeg)).toBe(false);
    expect(await isGeneratedGutenbergCover(Buffer.from('invalid image'))).toBe(false);
    expect(await isGeneratedGutenbergCover(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(false);
  });
});
