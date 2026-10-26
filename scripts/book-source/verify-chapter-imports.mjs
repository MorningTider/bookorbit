import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire("/app/package.json");
const unzipper = require("unzipper");
const iconv = require("iconv-lite");
assert.equal(process.env.BOOKORBIT_VERIFY_ISOLATED, "1", "Run only against the isolated test instance");
const host = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : process.env.POSTGRES_HOST;
assert.equal(host, "bookorbit-db-verify", "Refuse a production database");
const base = "http://127.0.0.1:3000/api/v1";
const credentials = JSON.parse(await readFile("/data/.custom-verification-user.json", "utf8"));
let token;
async function request(path, options = {}, expected) {
  const response = await fetch(base + path, {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    signal: AbortSignal.timeout(120000),
  });
  if (expected !== undefined) {
    assert.equal(response.status, expected, `Unexpected status for ${path}`);
    return response;
  }
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}
const post = (data) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
token = (await request("/auth/login", post(credentials))).accessToken;
assert.ok(token);
console.log(JSON.stringify({ check: "isolated-login", passed: true, version: process.env.APP_VERSION }));
const libraries = await request("/libraries");
const library = libraries.find((row) => row.name === "定制功能隔离验收");
assert.ok(library, "The existing isolated test library must exist");
async function upload(bytes, name) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "text/plain" }), name);
  return request(`/libraries/${library.id}/upload`, { method: "POST", body: form });
}
const name = `章节转换验收-${Date.now()}`;
const uploaded = await upload(Buffer.from("第一章开始\n正文<&>内容\n第二章：继续\n另一段正文"), `${name}.txt`);
let book = await request(`/books/${uploaded.bookId}`);
assert.equal(book.files.filter((file) => file.format === "epub").length, 0);
await request(`/books/${uploaded.bookId}/convert-txt-to-epub`, post({ encoding: "utf8", chapters: "chinese" }));
book = await request(`/books/${uploaded.bookId}`);
assert.equal(book.files.filter((file) => file.format === "txt").length, 1);
assert.equal(book.files.filter((file) => file.format === "epub").length, 1);
const file = book.files.find((row) => row.format === "epub");
const download = await request(`/books/files/${file.id}/download`, {}, 200);
const zip = await unzipper.Open.buffer(Buffer.from(await download.arrayBuffer()));
const nav = (await zip.files.find((item) => item.path === "OEBPS/nav.xhtml").buffer()).toString();
assert.ok(nav.includes("第一章开始") && nav.includes("第二章：继续"));
await request(`/books/${uploaded.bookId}/convert-txt-to-epub`, post({ encoding: "utf8", chapters: "auto" }), 400);
console.log(JSON.stringify({ check: "txt-manual-conversion-same-book-navigation-no-overwrite", passed: true, bookId: uploaded.bookId }));
const gbk = await upload(iconv.encode("第一章开始\n编码验收正文", "gb18030"), `编码验收-${Date.now()}.txt`);
await request(`/books/${gbk.bookId}/convert-txt-to-epub`, post({ encoding: "utf8", chapters: "chinese" }), 400);
assert.equal((await request(`/books/${gbk.bookId}`)).files.filter((item) => item.format === "epub").length, 0);
await request(`/books/${gbk.bookId}/convert-txt-to-epub`, post({ encoding: "gb18030", chapters: "chinese" }));
console.log(JSON.stringify({ check: "txt-wrong-encoding-rejected-and-correct-encoding-retry", passed: true, bookId: gbk.bookId }));
const rules = await request("/book-sources/chapter-rules");
const key = "v" + Date.now().toString(36).slice(-6);
const sample = {
  key,
  label: "隔离规则验收",
  origin: "https://books.example.org",
  bookPath: "/book/{id}/",
  catalogPath: "/book/{id}/toc/",
  titleSelector: "h1",
  authorSelector: ".author",
  chapterLinkSelector: "a.chapter",
  chapterPublicSelector: ".free",
  chapterRestrictedSelector: ".vip",
  chapterHeadingSelector: "h1",
  publicPageSelector: ".public-content",
  restrictedPageSelector: ".paywall",
  contentSelector: "main",
};
try {
  await request("/book-sources/chapter-rules", { ...post({ sources: [...rules.sources, sample] }), method: "PUT" });
  assert.ok((await request("/book-sources/chapter-sources")).some((source) => source.key === key));
  await request(
    "/book-sources/chapter-rules",
    { ...post({ sources: [...rules.sources, { ...sample, origin: "https://changed.example.org" }] }), method: "PUT" },
    409,
  );
  console.log(JSON.stringify({ check: "generic-rule-import-list-and-immutable-identity", passed: true }));
} finally {
  await request("/book-sources/chapter-rules", { ...post(rules), method: "PUT" });
}
if (process.env.BOOK_SOURCE_VERIFY_QIDIAN === "1") {
  const queued = await request(`/libraries/${library.id}/sources/qidian`, post({ bookId: "1010868264" }));
  const again = await request(`/libraries/${library.id}/sources/qidian`, post({ bookId: "1010868264" }));
  assert.equal(again.id, queued.id);
  console.log(JSON.stringify({ check: "qidian-queued-and-deduplicated", jobId: queued.id, passed: true }));
  const until = Date.now() + 650000;
  let result;
  let last = 0;
  while (Date.now() < until) {
    result = await request(`/book-sources/jobs/${queued.id}`);
    if (["completed", "failed", "cancelled"].includes(result.status)) break;
    if (Date.now() - last > 15000) {
      console.log(JSON.stringify({ check: "qidian-task-progress", status: result.status }));
      last = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.equal(result.status, "completed", result.error || "Qidian task did not complete");
  assert.ok(result.resultBookId);
  const imported = await request(`/books/${result.resultBookId}`);
  const metadataUntil = Date.now() + 30000;
  let current = imported;
  while (!current.title && Date.now() < metadataUntil) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    current = await request(`/books/${result.resultBookId}`);
  }
  assert.ok(current.title.endsWith("（公开免费章节选集）"));
  assert.ok(current.files.some((row) => row.format === "epub"));
  console.log(JSON.stringify({ check: "qidian-public-selection-imported", passed: true, jobId: result.id, bookId: result.resultBookId }));
}
console.log(JSON.stringify({ check: "chapter-import-verification", passed: true }));
