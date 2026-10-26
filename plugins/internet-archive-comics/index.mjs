const ORIGIN = "https://archive.org";
const MAX_DETAILS = 5;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
const LICENSE = /^https?:\/\/(?:www\.)?creativecommons\.org\/publicdomain\/(?:mark|zero)\/1\.0\/?$/;

function strings(value) {
  return (Array.isArray(value) ? value : [value]).filter((item) => typeof item === "string");
}

function fileAllowed(file) {
  return (
    typeof file?.name === "string" &&
    file.name.length <= 500 &&
    !/[\\/\x00-\x1f]/.test(file.name) &&
    /\.cbz$/i.test(file.name) &&
    ![true, "true", "1", 1].includes(file.private) &&
    Number.isSafeInteger(Number(file.size)) &&
    Number(file.size) > 0 &&
    Number(file.size) <= MAX_FILE_BYTES
  );
}

export function mapItem(item, identifier) {
  const metadata = item?.metadata;
  if (
    !SAFE_ID.test(identifier) ||
    !metadata ||
    metadata.identifier !== identifier ||
    metadata.mediatype !== "texts" ||
    [true, "true", "1", 1].includes(metadata["access-restricted-item"]) ||
    [true, "true", "1", 1].includes(item.is_dark) ||
    !strings(metadata.licenseurl).some((value) => LICENSE.test(value))
  )
    return [];
  const title = strings(metadata.title)[0]?.trim().slice(0, 500);
  if (!title) return [];
  const author = strings(metadata.creator).slice(0, 5).join(", ").slice(0, 500);
  const language = strings(metadata.language)[0];
  const files = (Array.isArray(item.files) ? item.files : []).filter(fileAllowed).sort((a, b) => Number(a.size) - Number(b.size));
  const file = files[0];
  if (!file) return [];
  return [
    {
      guid: `${identifier}/${file.name}`,
      title,
      bookTitle: title,
      ...(author ? { author } : {}),
      ...(language ? { language } : {}),
      infoUrl: `${ORIGIN}/details/${identifier}`,
      downloadUrl: `${ORIGIN}/download/${identifier}/${encodeURIComponent(file.name)}`,
      sizeBytes: Number(file.size),
      seeders: null,
      leechers: null,
      format: "cbz",
      primaryFileCount: 1,
      fileCount: 1,
    },
  ];
}

async function readJson(url, host) {
  const response = await host.fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw host.fail(response.status === 429 ? "throttled" : "error", `Internet Archive 返回 HTTP ${response.status}`);
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024) throw host.fail("error", "Internet Archive 响应超过 2 MiB");
  try {
    return JSON.parse(text);
  } catch {
    throw host.fail("error", "Internet Archive 未返回有效 JSON");
  }
}

function queryUrl(title, limit) {
  const url = new URL("/advancedsearch.php", ORIGIN);
  const escaped = title.replace(/[\\"]/g, "\\$&");
  url.searchParams.set(
    "q",
    `mediatype:texts AND (subject:comics OR subject:"comic books" OR collection:comic_books) AND format:"Comic Book ZIP" AND licenseurl:*publicdomain* AND NOT access-restricted-item:true AND title:"${escaped}"`,
  );
  url.searchParams.set("output", "json");
  url.searchParams.set("rows", String(limit));
  url.searchParams.set("page", "1");
  url.searchParams.append("fl[]", "identifier");
  return url.href;
}

export default {
  apiVersion: 1,
  version: "1.0.0",
  type: "internet-archive-comics",
  label: "Internet Archive（公版漫画 CBZ）",
  requiresCredential: false,
  credentialKind: null,
  mediaKinds: ["ebook"],
  usesCategories: false,
  seedsBack: false,
  defaultBaseUrl: ORIGIN,
  baseUrlHint: "检索来源标注为公版或 CC0 的公开 CBZ，不支持借阅及受限项目。",
  async search(query, _config, host) {
    if (query.mediaKind !== "ebook") throw host.fail("unsupportedMedium", "此书源只提供漫画 CBZ");
    const title = query.title?.trim().slice(0, 160);
    const limit = Number.isSafeInteger(query.limit) ? Math.max(0, Math.min(query.limit, MAX_DETAILS)) : MAX_DETAILS;
    if (!title || !limit) return [];
    const result = await readJson(queryUrl(title, limit), host);
    if (!Array.isArray(result?.response?.docs)) throw host.fail("error", "Internet Archive 未返回有效搜索结果");
    const ids = [...new Set(result.response.docs.map((item) => item.identifier).filter((id) => typeof id === "string" && SAFE_ID.test(id)))].slice(
      0,
      limit,
    );
    const candidates = [];
    const failures = [];
    for (let offset = 0; offset < ids.length; offset += 2) {
      const batch = ids.slice(offset, offset + 2);
      const pages = await Promise.allSettled(batch.map((id) => readJson(`${ORIGIN}/metadata/${id}`, host)));
      pages.forEach((page, index) => {
        if (page.status === "fulfilled") candidates.push(...mapItem(page.value, batch[index]));
        else failures.push(page.reason);
      });
    }
    if (!candidates.length && failures.length) throw failures[0];
    return candidates.slice(0, limit);
  },
  async test(_config, host) {
    try {
      const result = await readJson(queryUrl("Foxy Grandpa", 1), host);
      if (!Array.isArray(result?.response?.docs)) throw host.fail("error", "Internet Archive 未返回有效搜索结果");
      return { success: true, indexerName: "Internet Archive" };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  async resolveFile(release, _config, host) {
    const separator = release.guid.indexOf("/");
    const id = release.guid.slice(0, separator);
    const name = release.guid.slice(separator + 1);
    if (separator < 1 || !SAFE_ID.test(id)) throw host.fail("error", "无效的漫画资源标识");
    const [current] = mapItem(await readJson(`${ORIGIN}/metadata/${id}`, host), id);
    if (!current || current.guid !== `${id}/${name}`) throw host.fail("error", "漫画文件已变更、受限或不再公开提供");
    return { url: current.downloadUrl, fileName: name, sizeBytes: current.sizeBytes, format: "cbz" };
  },
};
