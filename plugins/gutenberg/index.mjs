const API_VERSION = 1;
const BASE_URL = "https://www.gutenberg.org/ebooks/search.opds/";
const ACQUISITION_RELS = new Set(["http://opds-spec.org/acquisition/open-access", "http://opds-spec.org/acquisition"]);
const MAX_DETAIL_PAGES = 5;
const MAX_RESULTS = 20;

function decodeXml(value) {
  return value
    .replace(/&#x([\da-f]+);/gi, (_, code) => decodeCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => decodeCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function decodeCodePoint(code) {
  return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\ufffd";
}

function elementText(xml, localName) {
  const match = xml.match(new RegExp(`<(?:(?:[\\w.-]+):)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${localName}>`, "i"));
  if (!match) return null;
  return decodeXml(match[1].replace(/<[^>]*>/g, "").trim()) || null;
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/g)) result[match[1]] = decodeXml(match[3]);
  return result;
}

export function mapEntries(xml, limit = MAX_RESULTS) {
  const entries = xml.match(/<(?:[\w.-]+:)?entry\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?entry>/gi) ?? [];
  return entries.slice(0, boundedLimit(limit)).flatMap((entry) => {
    const title = elementText(entry, "title");
    const id = elementText(entry, "id");
    if (!title || !id) return [];

    let downloadUrl = null;
    let sizeBytes = null;
    for (const match of entry.matchAll(/<(?:[\w.-]+:)?link\b[^>]*\/?\s*>/gi)) {
      const attrs = attributes(match[0]);
      if (ACQUISITION_RELS.has(attrs.rel) && /^application\/epub\+zip(?:;|$)/i.test(attrs.type ?? "") && attrs.href) {
        const candidate = trustedUrl(attrs.href);
        if (candidate) {
          downloadUrl = candidate.href;
          const size = Number(attrs.length);
          if (Number.isSafeInteger(size) && size > 0) sizeBytes = size;
          break;
        }
      }
    }
    if (!downloadUrl) return [];

    const author = elementText(entry, "name");
    return [
      {
        guid: id,
        title,
        bookTitle: title,
        ...(author ? { author } : {}),
        downloadUrl,
        sizeBytes,
        seeders: null,
        leechers: null,
        format: "epub",
        ...(elementText(entry, "language") ? { language: elementText(entry, "language") } : {}),
      },
    ];
  });
}

function boundedLimit(limit) {
  return Number.isSafeInteger(limit) ? Math.max(0, Math.min(limit, MAX_RESULTS)) : MAX_RESULTS;
}

function trustedUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value, "https://www.gutenberg.org");
    return url.protocol === "https:" && !url.username && !url.password && !url.port && /^(www\.)?gutenberg\.org$/.test(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

export function catalogLinks(xml, limit = MAX_DETAIL_PAGES) {
  const result = new Set();
  const entries = xml.match(/<(?:[\w.-]+:)?entry\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?entry>/gi) ?? [];
  for (const entry of entries) {
    if (result.size >= Math.min(boundedLimit(limit), MAX_DETAIL_PAGES)) break;
    for (const match of entry.matchAll(/<(?:[\w.-]+:)?link\b[^>]*\/?\s*>/gi)) {
      const attrs = attributes(match[0]);
      if (attrs.rel !== "subsection" || !/^application\/atom\+xml(?:;|$)/i.test(attrs.type ?? "")) continue;
      const url = trustedUrl(attrs.href);
      if (url && /^\/ebooks\/\d+\.opds$/.test(url.pathname) && !url.search) result.add(url.href);
    }
  }
  return [...result];
}

async function readFeed(url, host) {
  const response = await host.fetch(url, { headers: { Accept: "application/atom+xml, application/xml;q=0.9" } });
  if (!response.ok) throw host.fail(response.status === 429 ? "throttled" : "error", `Gutenberg 返回 HTTP ${response.status}`);
  const xml = await response.text();
  if (new TextEncoder().encode(xml).byteLength > 2 * 1024 * 1024) throw host.fail("error", "Gutenberg 目录超过 2 MiB");
  if (!/<(?:[\w.-]+:)?feed\b/i.test(xml)) throw host.fail("error", "Gutenberg 未返回有效的 OPDS 目录");
  return xml;
}

const plugin = {
  apiVersion: API_VERSION,
  version: "1.1.0",
  type: "project-gutenberg",
  label: "Project Gutenberg（公版电子书）",
  requiresCredential: false,
  credentialKind: null,
  mediaKinds: ["ebook"],
  usesCategories: false,
  seedsBack: false,
  defaultBaseUrl: "https://www.gutenberg.org",
  baseUrlHint: "公版 EPUB 目录，仅下载来源公开提供的 EPUB 文件。",

  async search(query, _config, host) {
    const searchText = host.buildSearchText(query).trim().slice(0, 160);
    if (!searchText) return [];
    const url = new URL(BASE_URL);
    url.searchParams.set("query", searchText);
    const limit = boundedLimit(query.limit);
    if (!limit) return [];
    const xml = await readFeed(url.href, host);
    const results = mapEntries(xml, limit);
    const links = catalogLinks(xml, Math.min(limit, MAX_DETAIL_PAGES));
    const failures = [];
    for (let offset = 0; offset < links.length && results.length < limit; offset += 2) {
      const pages = await Promise.allSettled(links.slice(offset, offset + 2).map((link) => readFeed(link, host)));
      for (const page of pages) {
        if (page.status === "fulfilled") results.push(...mapEntries(page.value, limit));
        else failures.push(page.reason);
      }
    }
    if (!results.length && failures.length) throw failures[0];
    const seen = new Set();
    return results
      .filter((item) => {
        if (seen.has(item.downloadUrl)) return false;
        seen.add(item.downloadUrl);
        return true;
      })
      .slice(0, limit);
  },

  async test(_config, host) {
    try {
      await readFeed("https://www.gutenberg.org/ebooks/search.opds/?query=pride%20and%20prejudice", host);
      return { success: true, indexerName: "Project Gutenberg" };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async resolveFile(release, _config, _host) {
    const url = trustedUrl(release.downloadUrl);
    if (!url) {
      throw new Error("所选 EPUB 不在 Gutenberg 官方站点上");
    }
    return { url: url.href, fileName: `${release.title}.epub`, sizeBytes: null, format: "epub" };
  },
};

export default plugin;
