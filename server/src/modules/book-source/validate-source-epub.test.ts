import { describe, expect, it } from 'vitest';
import { ZipArchive } from 'archiver';
import { assertSourceEpub } from './validate-source-epub';

async function epub(overrides: Record<string, string | null> = {}): Promise<Buffer> {
  const entries: Record<string, string | null> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    'OEBPS/content.opf': '<package><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
    'OEBPS/chapter.xhtml': '<html><body>测试章节</body></html>',
    ...overrides,
  };
  const archive = new ZipArchive();
  const bytes: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => bytes.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(bytes)));
    archive.on('error', reject);
  });
  for (const [name, value] of Object.entries(entries)) if (value !== null) archive.append(value, { name });
  await archive.finalize();
  return result;
}

describe('downloaded EPUB validation', () => {
  it('accepts a complete reading order', async () => {
    await expect(assertSourceEpub(await epub())).resolves.toBeUndefined();
  });
  it('rejects an HTML error page masquerading as EPUB', async () => {
    await expect(assertSourceEpub(Buffer.from('<html>访问受限</html>'))).rejects.toThrow('有效的 EPUB');
  });
  it('rejects missing package or chapter files', async () => {
    await expect(assertSourceEpub(await epub({ 'OEBPS/content.opf': null }))).rejects.toThrow('OPF 缺失');
    await expect(assertSourceEpub(await epub({ 'OEBPS/chapter.xhtml': null }))).rejects.toThrow('资源缺失');
  });
  it('rejects an invalid media type and oversized structural XML', async () => {
    await expect(assertSourceEpub(await epub({ mimetype: 'text/html' }))).rejects.toThrow('类型标识无效');
    await expect(assertSourceEpub(await epub({ 'META-INF/container.xml': 'x'.repeat(1024 * 1024 + 1) }))).rejects.toThrow('过大');
  });
  it('rejects external manifest resources and nonexistent spine references', async () => {
    await expect(
      assertSourceEpub(
        await epub({
          'OEBPS/content.opf':
            '<package><manifest><item id="chapter" href="https://example.com/file"/></manifest><spine><itemref idref="chapter"/></spine></package>',
        }),
      ),
    ).rejects.toThrow('资源无效');
    await expect(
      assertSourceEpub(
        await epub({
          'OEBPS/content.opf':
            '<package><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="missing"/></spine></package>',
        }),
      ),
    ).rejects.toThrow('章节缺失');
  });
});
