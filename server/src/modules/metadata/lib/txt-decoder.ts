import iconv from 'iconv-lite';

export function decodeTxt(buffer: Buffer): string {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return buffer.subarray(3).toString('utf8');
  if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) return buffer.subarray(2).toString('utf16le');
  if (buffer.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
    return iconv.decode(buffer.subarray(2), 'utf16be');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return iconv.decode(buffer, 'gb18030');
  }
}
