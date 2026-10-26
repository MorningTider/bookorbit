import assert from "node:assert/strict";
import { readFile, mkdir, stat, chown } from "node:fs/promises";
if (process.env.BOOKORBIT_VERIFY_ISOLATED !== "1") throw new Error("Use isolated verification instance only");
const base = "http://127.0.0.1:3000/api/v1";
let token;
async function api(path, body) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}
token = (await api("/auth/login", JSON.parse(await readFile("/data/.custom-verification-user.json", "utf8")))).accessToken;
let title = process.env.BOOKORBIT_VERIFY_COMIC_TITLE?.trim();
const sourceRequestId = Number(process.env.BOOKORBIT_VERIFY_COMIC_TITLE_FROM_REQUEST_ID);
if (!title && Number.isSafeInteger(sourceRequestId) && sourceRequestId > 0) {
  const previous = await api(`/book-requests/${sourceRequestId}`);
  title = previous.download?.releaseTitle?.trim();
}
assert.ok(title && title.length <= 500, "Provide the exact public comic title or a verified source request ID");
const stamp = Date.now();
const folder = `/books/comic-online-${stamp}`;
await mkdir(folder);
if (process.getuid() === 0) {
  const owner = await stat("/books");
  await chown(folder, owner.uid, owner.gid);
}
const library = await api("/libraries", { name: `在线漫画隔离验收-${stamp}`, icon: "book-open", folders: [folder], watch: false });
const { indexers } = await api("/admin/request-indexers");
let indexer = indexers.find((item) => item.adapterType === "internet-archive-comics" && item.enabled);
if (!indexer)
  indexer = await api("/admin/request-indexers", {
    name: "公共领域漫画在线验收",
    adapterType: "internet-archive-comics",
    baseUrl: "https://archive.org",
    enabled: true,
    allowPrivateAddress: false,
    categories: { ebook: [], audiobook: [] },
    isbnSearchDisabled: true,
  });
let requestId;
let completed = false;
try {
  const submitted = await api("/book-requests", {
    title,
    authors: [],
    mediaKind: "ebook",
    preferredFormats: ["cbz"],
    targetLibraryId: library.id,
    selfServe: true,
  });
  requestId = submitted.request.id;
  assert.ok(!submitted.request.matchedBookId, "A fresh request is required to verify actual online acquisition");
  console.log(JSON.stringify({ check: "comic-request-created", requestId, libraryId: library.id }));
  const releases = await api(`/book-request-fulfilment/${requestId}/releases/search`, {
    title,
    authors: [],
    preferredFormats: ["cbz"],
  });
  const release = releases.releases
    .filter((item) => item.indexerId === indexer.id && item.sizeBytes > 0 && item.sizeBytes <= 256 * 1024 * 1024)
    .sort((a, b) => a.sizeBytes - b.sizeBytes)[0];
  assert.ok(release, "No permitted comic release within the verification size limit");
  await api(`/book-request-fulfilment/${requestId}/grab`, { indexerId: indexer.id, releaseGuid: release.guid });
  let state;
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    state = await api(`/book-requests/${requestId}`);
    if (state.matchedBookId || ["failed", "rejected", "cancelled", "needs_review"].includes(state.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.ok(state?.matchedBookId, JSON.stringify({ status: state?.status, reason: state?.statusReason }));
  let book = await api(`/books/${state.matchedBookId}`);
  const coverDeadline = Date.now() + 60000;
  while (!book.coverSource && Date.now() < coverDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    book = await api(`/books/${state.matchedBookId}`);
  }
  assert.equal(book.libraryId, library.id);
  assert.doesNotMatch(book.title, /^request-\d+-/, "A staging prefix must not become the library title");
  const file = book.files.find((item) => item.format === "cbz");
  assert.ok(file);
  assert.ok(book.coverSource, "Online import must produce a comic cover");
  const pages = await api(`/cbz/files/${file.id}/pages`);
  assert.ok(pages.pageCount > 0);
  const page = await fetch(base + `/cbz/files/${file.id}/pages/0`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60000),
  });
  assert.ok(page.ok);
  assert.match(page.headers.get("content-type"), /^image\//);
  assert.ok((await page.arrayBuffer()).byteLength > 1000);
  completed = true;
  console.log(
    JSON.stringify({
      check: "comic-live-request-search-download-import-cover-reader",
      requestId,
      libraryId: library.id,
      bookId: book.id,
      fileId: file.id,
      pageCount: pages.pageCount,
      title: book.title,
      passed: true,
    }),
  );
} finally {
  if (!completed && requestId) {
    const state = await api(`/book-requests/${requestId}`);
    if (!state.matchedBookId) {
      if (state.download?.id) await api(`/book-requests/${requestId}/downloads/${state.download.id}/cancel`, {}).catch(() => {});
      await api(`/book-requests/${requestId}/cancel`, {}).catch(() => {});
    }
  }
}
