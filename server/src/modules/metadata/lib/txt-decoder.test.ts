import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';

import { decodeTxt } from './txt-decoder';

describe('decodeTxt', () => {
  it('decodes UTF-8 and UTF-16 BOMs', () => {
    expect(decodeTxt(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('中文', 'utf8')]))).toBe('中文');
    expect(decodeTxt(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文', 'utf16le')]))).toBe('中文');
    expect(decodeTxt(Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode('中文', 'utf16be')]))).toBe('中文');
  });

  it('falls back to GB18030 when the bytes are not valid UTF-8', () => {
    const bytes = iconv.encode('中文内容', 'gb18030');
    expect(decodeTxt(bytes)).toBe('中文内容');
  });
});
