import { createHash } from 'crypto';
import sharp from 'sharp';

/**
 * Fingerprints of the "no cover" image Google Books serves in place of art. It is a full-size
 * portrait PNG, so neither a size floor nor a shape check can tell it from a real jacket.
 */
export const GOOGLE_BOOKS_PLACEHOLDER_LENGTHS: ReadonlySet<number> = new Set([9_103]);
export const GOOGLE_BOOKS_PLACEHOLDER_HASHES: ReadonlySet<string> = new Set(['3efa8c43e5b4348f303a528c81adf435f0111ea752fe9f0f6241478b60987fa6']);

export function isKnownPlaceholderCover(bytes: Buffer): boolean {
  if (!GOOGLE_BOOKS_PLACEHOLDER_LENGTHS.has(bytes.length)) return false;
  return GOOGLE_BOOKS_PLACEHOLDER_HASHES.has(createHash('sha256').update(bytes).digest('hex'));
}

/** The generated jacket's fixed white branding distinguishes it from an illustrated cover. */
export async function isGeneratedGutenbergCover(bytes: Buffer): Promise<boolean> {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  try {
    const image = sharp(bytes, { limitInputPixels: 1600 * 2400 });
    const metadata = await image.metadata();
    if (metadata.width !== 1600 || metadata.height !== 2400) return false;
    const { data, info } = await image
      .extract({ left: 800, top: 2160, width: 800, height: 240 })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mask = Buffer.alloc(info.width * info.height);
    for (let index = 0; index < mask.length; index++) {
      const offset = index * info.channels;
      mask[index] = data[offset]! > 245 && data[offset + 1]! > 245 && data[offset + 2]! > 245 ? 1 : 0;
    }
    return createHash('sha256').update(mask).digest('hex') === '5216a57ec8e3bfd8a14eb4d6aabddb6e120b9001c896a09620d69caefee5b0e2';
  } catch {
    return false;
  }
}
