import { BadGatewayException } from '@nestjs/common';
import * as unzipper from 'unzipper';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { posix } from 'node:path';

const MAX_XML_BYTES = 1024 * 1024;
const parser = new XMLParser({ ignoreAttributes: false, processEntities: false });

export async function assertSourceEpub(bytes: Buffer): Promise<void> {
  try {
    const zip = await unzipper.Open.buffer(bytes);
    if (zip.files.length > 10000) throw new BadGatewayException('EPUB 文件数量过多');
    const paths = new Set<string>();
    let expandedBytes = 0;
    for (const entry of zip.files) {
      const path = entry.path;
      if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || paths.has(path))
        throw new BadGatewayException('EPUB 路径无效或重复');
      paths.add(path);
      expandedBytes += entry.uncompressedSize;
      if (!Number.isSafeInteger(expandedBytes) || expandedBytes > 256 * 1024 * 1024) throw new BadGatewayException('EPUB 解压体积过大');
    }
    const read = async (path: string): Promise<string> => {
      const entry = zip.files.find((file) => file.path === path);
      if (!entry || entry.type !== 'File' || entry.uncompressedSize > MAX_XML_BYTES) throw new BadGatewayException('EPUB 结构文件缺失或过大');
      const stream = entry.stream();
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of stream) {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          size += data.length;
          if (size > MAX_XML_BYTES) throw new BadGatewayException('EPUB 结构文件过大');
          chunks.push(data);
        }
      } finally {
        stream.destroy();
      }
      return Buffer.concat(chunks).toString('utf8');
    };
    if ((await read('mimetype')).trim() !== 'application/epub+zip') throw new BadGatewayException('EPUB 类型标识无效');
    const container = await read('META-INF/container.xml');
    if (XMLValidator.validate(container) !== true) throw new BadGatewayException('EPUB 容器 XML 无效');
    const parsed = parser.parse(container) as {
      container?: { rootfiles?: { rootfile?: { '@_full-path'?: string } | { '@_full-path'?: string }[] } };
    };
    const roots = parsed.container?.rootfiles?.rootfile;
    const opfPath = (Array.isArray(roots) ? roots[0] : roots)?.['@_full-path'];
    if (!opfPath || !paths.has(opfPath)) throw new BadGatewayException('EPUB OPF 缺失');
    const opf = await read(opfPath);
    if (XMLValidator.validate(opf) !== true) throw new BadGatewayException('EPUB OPF XML 无效');
    const data = parser.parse(opf) as { package?: { manifest?: { item?: unknown }; spine?: { itemref?: unknown } } };
    const manifest = toItems(data.package?.manifest?.item);
    const spine = toItems(data.package?.spine?.itemref);
    if (!manifest.length || !spine.length) throw new BadGatewayException('EPUB 缺少阅读顺序');
    const ids = new Set<string>();
    for (const item of manifest) {
      const id = item['@_id'];
      const href = item['@_href'];
      if (typeof id !== 'string' || ids.has(id) || typeof href !== 'string' || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(href))
        throw new BadGatewayException('EPUB 资源无效');
      ids.add(id);
      const resolved = posix.normalize(posix.join(posix.dirname(opfPath), decodeURIComponent(href.split('#')[0]!)));
      if (!paths.has(resolved)) throw new BadGatewayException('EPUB 引用的资源缺失');
    }
    if (spine.some((item) => typeof item['@_idref'] !== 'string' || !ids.has(item['@_idref']))) throw new BadGatewayException('EPUB 阅读章节缺失');
  } catch (error) {
    if (error instanceof BadGatewayException) throw error;
    throw new BadGatewayException('下载文件不是有效的 EPUB');
  }
}

function toItems(value: unknown): Record<string, unknown>[] {
  const items: unknown[] = Array.isArray(value) ? value : value ? [value] : [];
  return items.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item));
}
