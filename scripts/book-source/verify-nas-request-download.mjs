import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
if (process.env.BOOKORBIT_VERIFY_ISOLATED !== "1") throw new Error("Use isolated verification instance only");
const base = "http://127.0.0.1:3000/api/v1";
let token;
async function api(path, body) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${(await response.text()).slice(0, 600)}`);
  return response.json();
}
token = (await api("/auth/login", JSON.parse(await readFile("/data/.custom-verification-user.json", "utf8")))).accessToken;
const libraries = await api("/libraries");
const library = libraries.find((item) => item.name === "定制功能隔离验收");
assert.ok(library);
const { indexers } = await api("/admin/request-indexers");
let indexer = indexers.find((item) => item.adapterType === "project-gutenberg");
if (!indexer)
  indexer = await api("/admin/request-indexers", {
    name: "公共领域 EPUB 验收",
    adapterType: "project-gutenberg",
    baseUrl: "https://www.gutenberg.org",
    enabled: true,
  });
console.log(JSON.stringify({ check: "indexer-configured", indexerId: indexer.id, passed: true }));
const submitted = await api("/book-requests", {
  title: "Pride and Prejudice",
  authors: ["Jane Austen"],
  mediaKind: "ebook",
  preferredFormats: ["epub"],
  targetLibraryId: library.id,
  selfServe: true,
});
const requestId = submitted.request.id;
console.log(JSON.stringify({ check: "request-created", requestId, status: submitted.request.status, passed: true }));
if (submitted.request.matchedBookId) {
  console.log(JSON.stringify({ check: "already-imported", bookId: submitted.request.matchedBookId, passed: true }));
  process.exit(0);
}
const releases = await api(`/book-request-fulfilment/${requestId}/releases/search`, {
  title: "Pride and Prejudice",
  authors: ["Jane Austen"],
  preferredFormats: ["epub"],
});
const release = releases.releases.find((item) => item.indexerId === indexer.id);
assert.ok(release, JSON.stringify(releases.indexers));
console.log(JSON.stringify({ check: "live-source-search", count: releases.releases.length, passed: true }));
await api(`/book-request-fulfilment/${requestId}/grab`, { indexerId: indexer.id, releaseGuid: release.guid });
let state;
const deadline = Date.now() + 240000;
while (Date.now() < deadline) {
  state = await api(`/book-requests/${requestId}`);
  if (state.matchedBookId || ["failed", "rejected", "cancelled"].includes(state.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
assert.ok(state.matchedBookId, JSON.stringify({ status: state.status, reason: state.statusReason, download: state.download }));
const book = await api(`/books/${state.matchedBookId}`);
assert.ok(book.files.some((file) => file.format === "epub"));
console.log(JSON.stringify({ check: "request-direct-download-and-import", requestId, bookId: state.matchedBookId, passed: true }));
