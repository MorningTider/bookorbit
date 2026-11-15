import { BadRequestException } from '@nestjs/common';
import type { EpubBookInfo, EpubTocGroupStart, EpubTocItem, EpubTocOrganization } from '@bookorbit/types';
import { load, type CheerioAPI } from 'cheerio';
import { XMLValidator } from 'fast-xml-parser';
import { posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as unzipper from 'unzipper';
import { resolveHref, findEpubZipEntry } from '../../common/utils/epub-navigation-path.utils';

type XmlNode = ReturnType<CheerioAPI>[0];
type Selection = ReturnType<CheerioAPI>;
const MAX_XML_BYTES = 64 * 1024 * 1024;
const CONTENTS_LABEL = /^(总?目录|目次|contents|table of contents)$/i;

function tag(node: XmlNode): string {
  return 'name' in node && typeof node.name === 'string' ? node.name : '';
}
function localName(node: XmlNode): string {
  return tag(node).split(':').at(-1) ?? '';
}
function childrenNamed(node: Selection, name: string): Selection {
  return node.children().filter((_index, child) => localName(child) === name);
}
function descendantsNamed(node: Selection, name: string): Selection {
  return node.find('*').filter((_index, child) => localName(child) === name);
}
function prefixedName(node: Selection, name: string): string {
  const value = node[0] ? tag(node[0]) : '';
  return value.includes(':') ? value.slice(0, value.indexOf(':') + 1) + name : name;
}
function isTocNav(node: Selection): boolean {
  const attributes = node.attr() ?? {};
  return Object.entries(attributes).some(([key, value]) => (key === 'type' || key.endsWith(':type')) && value.split(/\s+/).includes('toc'));
}
function labelKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
function flatten(entries: readonly EpubTocItem[]): EpubTocItem[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
}

async function readXml(entry: unzipper.File): Promise<CheerioAPI> {
  if (entry.uncompressedSize > MAX_XML_BYTES) throw new BadRequestException('EPUB directory exceeds the XML inspection limit');
  const stream = entry.stream();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > MAX_XML_BYTES) throw new BadRequestException('EPUB directory exceeds the inflated XML inspection limit');
      chunks.push(bytes);
    }
  } finally {
    stream.destroy();
  }
  const text = Buffer.concat(chunks).toString('utf-8');
  if (XMLValidator.validate(text) !== true) throw new BadRequestException('EPUB directory XML is malformed');
  return load(text, { xmlMode: true });
}

function relativeHref(href: string, documentPath: string): string {
  if (!href || /^[a-z][a-z\d+.-]*:/i.test(href)) return href;
  const hash = href.indexOf('#');
  const path = hash < 0 ? href : href.slice(0, hash);
  return posix.relative(posix.dirname(documentPath), path) + (hash < 0 ? '' : href.slice(hash));
}
function hrefMap($: CheerioAPI, node: Selection, documentPath: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const element of node.find('*').toArray()) {
    const item = $(element);
    const raw = localName(element) === 'content' ? item.attr('src') : localName(element) === 'a' ? item.attr('href') : undefined;
    if (raw !== undefined) result.set(resolveHref(raw, posix.dirname(documentPath) + '/'), raw);
  }
  return result;
}
function htmlList($: CheerioAPI, template: Selection, entries: readonly EpubTocItem[], refs: Map<string, string>, path: string): Selection {
  const list = $(`<${prefixedName(template, 'ol')}/>`);
  for (const entry of entries) {
    const item = $(`<${prefixedName(template, 'li')}/>`);
    const text = $(`<${prefixedName(template, entry.href ? 'a' : 'span')}/>`).text(entry.label);
    if (entry.href) text.attr('href', refs.get(entry.href) ?? relativeHref(entry.href, path));
    item.append(text);
    if (entry.children?.length) item.append(htmlList($, template, entry.children, refs, path));
    list.append(item);
  }
  return list;
}
function filterInline(entries: readonly EpubTocItem[], refs: Map<string, string>): EpubTocItem[] {
  return entries.flatMap((entry) => {
    const children = filterInline(entry.children ?? [], refs);
    return (entry.href && refs.has(entry.href)) || children.length ? [{ ...entry, children }] : [];
  });
}
function extraNcxEntries($: CheerioAPI, parent: Selection, known: Set<string>, path: string): EpubTocItem[] {
  return childrenNamed(parent, 'navPoint')
    .toArray()
    .flatMap((node) => {
      const point = $(node);
      const children = extraNcxEntries($, point, known, path);
      const raw = childrenNamed(point, 'content').attr('src');
      const href = raw === undefined ? undefined : resolveHref(raw, posix.dirname(path) + '/');
      if (href && known.has(href)) return children;
      const label = childrenNamed(childrenNamed(point, 'navLabel'), 'text').text().trim();
      return label ? [{ label, href, children: children.length ? children : undefined }] : children;
    });
}
function depth(entries: readonly EpubTocItem[]): number {
  return entries.reduce((maximum, entry) => Math.max(maximum, 1 + depth(entry.children ?? [])), 0);
}

function serializeXml($: CheerioAPI): string {
  // Literal Unicode also supports clients that retain numeric entities in navigation labels.
  return $.xml().replace(/&#x([0-9a-f]+);/gi, (entity: string, hex: string) => {
    const point = Number.parseInt(hex, 16);
    return point >= 0x80 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff) ? String.fromCodePoint(point) : entity;
  });
}

/** Rebuild navigation resources while leaving the OPF, spine and all chapter documents intact. */
export async function buildTocPatches(path: string, info: EpubBookInfo, entries: EpubTocItem[]): Promise<Map<string, Buffer>> {
  const zip = await unzipper.Open.file(path);

  const navigationPaths = new Set(
    info.manifest
      .filter((item) => item.properties?.includes('nav') || item.mediaType.toLowerCase() === 'application/x-dtbncx+xml')
      .map((item) => item.href),
  );
  const inlinePaths = new Set(
    flatten(info.toc?.children ?? [])
      .filter((item) => CONTENTS_LABEL.test(item.label))
      .map((item) => item.href?.split('#')[0])
      .filter((value): value is string => !!value),
  );
  const known = new Set(
    flatten(info.toc?.children ?? [])
      .map((entry) => entry.href)
      .filter((href): href is string => !!href),
  );
  const patches = new Map<string, Buffer>();
  for (const documentPath of new Set([...navigationPaths, ...inlinePaths])) {
    const file = findEpubZipEntry(zip.files, documentPath);
    if (!file) continue;
    let $: CheerioAPI;
    try {
      $ = await readXml(file);
    } catch (error) {
      if (navigationPaths.has(documentPath)) throw error;
      continue;
    }
    const root = $.root();
    const navMap = descendantsNamed(root, 'navMap').first();
    let changed = false;
    if (navMap.length && navigationPaths.has(documentPath)) {
      const refs = hrefMap($, navMap, documentPath);
      const complete = [...entries, ...extraNcxEntries($, navMap, known, documentPath)];
      let ordinal = 0;
      const idPrefix = `bookorbit-${randomUUID()}`;
      const build = (items: EpubTocItem[]): Selection[] =>
        items.map((item) => {
          const point = $(`<${prefixedName(navMap, 'navPoint')}/>`).attr({ id: `${idPrefix}-${++ordinal}`, playOrder: String(ordinal) });
          const label = $(`<${prefixedName(navMap, 'navLabel')}/>`).append($(`<${prefixedName(navMap, 'text')}/>`).text(item.label));
          point.append(label);
          const href = item.href || flatten(item.children ?? []).find((child) => child.href)?.href;
          if (href) point.append($(`<${prefixedName(navMap, 'content')}/>`).attr('src', refs.get(href) ?? relativeHref(href, documentPath)));
          for (const child of build(item.children ?? [])) point.append(child);
          return point;
        });
      navMap.empty();
      for (const node of build(complete)) navMap.append(node);
      descendantsNamed(root, 'meta')
        .filter((_index, node) => $(node).attr('name') === 'dtb:depth')
        .attr('content', String(depth(complete)));
      changed = true;
    }
    for (const node of descendantsNamed(root, 'nav').toArray()) {
      const nav = $(node);
      if (!isTocNav(nav)) continue;
      const refs = hrefMap($, nav, documentPath);
      // Supplemental contents can include links absent from the canonical navigation.
      if ([...refs.keys()].some((href) => !known.has(href))) continue;
      const items = navigationPaths.has(documentPath) ? entries : filterInline(entries, refs);
      if (!items.length) continue;
      const oldList = childrenNamed(nav, 'ol').first();
      const list = htmlList($, oldList.length ? oldList : nav, items, refs, documentPath);
      childrenNamed(nav, 'li').remove();
      if (oldList.length) oldList.replaceWith(list);
      else nav.append(list);
      changed = true;
    }
    if (changed) patches.set(file.path, Buffer.from(serializeXml($), 'utf-8'));
  }
  if (!patches.size) throw new BadRequestException('EPUB has no writable navigation document');
  return patches;
}

function startsNearBeginning(label: string): boolean {
  const match = label.match(/^(?:卷|第)\s*([0-9０-９零〇一二三四五六七八九十百千万两壹贰]+)|^(?:chapter|part|book|volume)\s+(\d+)/i);
  const value = match?.[1] ?? match?.[2];
  return value !== undefined && /^(?:0*[12]|[１２一二壹贰])$/.test(value);
}

export async function suggestTocGroups(path: string, info: EpubBookInfo): Promise<Pick<EpubTocOrganization, 'suggestedGroups' | 'suggestionSource'>> {
  const entries = info.toc?.children ?? [];
  const existing = entries.flatMap((entry, index) => (entry.children?.length ? [{ index, label: entry.label }] : []));
  if (existing.length) return { suggestedGroups: existing, suggestionSource: 'existing' };
  const zip = await unzipper.Open.file(path);

  for (const contents of entries.filter((entry) => CONTENTS_LABEL.test(entry.label)).slice(0, 3)) {
    const file = contents.href ? findEpubZipEntry(zip.files, contents.href.split('#')[0]!) : undefined;
    if (!file) continue;
    let $: CheerioAPI;
    try {
      $ = await readXml(file);
    } catch {
      continue;
    }
    const names = new Set(
      $('p, li, a, h1, h2, h3')
        .toArray()
        .map((node) => labelKey($(node).text())),
    );
    const found = entries.flatMap((entry, index) =>
      !CONTENTS_LABEL.test(entry.label) && names.has(labelKey(entry.label)) ? [{ index, label: entry.label }] : [],
    );
    if (found.length >= 2 && found.length < entries.length / 2) return { suggestedGroups: found, suggestionSource: 'contents' };
  }
  const headings: EpubTocGroupStart[] = [];
  entries.forEach((entry, index) => {
    if (
      index + 1 < entries.length &&
      !/^(?:卷|第|chapter\s|part\s|book\s|volume\s)/i.test(entry.label) &&
      startsNearBeginning(entries[index + 1]!.label)
    ) {
      headings.push({ index, label: entry.label });
    }
  });
  return headings.length >= 2 ? { suggestedGroups: headings, suggestionSource: 'headings' } : { suggestedGroups: [], suggestionSource: 'none' };
}
