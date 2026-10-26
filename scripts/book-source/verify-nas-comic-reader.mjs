import assert from "node:assert/strict";
import { openAsBlob } from "node:fs";
import { readFile } from "node:fs/promises";
if (process.env.BOOKORBIT_VERIFY_ISOLATED !== "1") throw new Error("Use isolated verification instance only");
const base = "http://127.0.0.1:3000/api/v1";
const login = await fetch(base + "/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: await readFile("/data/.custom-verification-user.json", "utf8"),
});
assert.ok(login.ok);
const { accessToken } = await login.json();
const headers = { Authorization: `Bearer ${accessToken}` };
async function api(path) {
  const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(120000) });
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response.json();
}
const libraries = await api("/libraries");
const library = libraries.find((item) => item.name === "定制功能隔离验收");
assert.ok(library);
const form = new FormData();
form.append(
  "file",
  await openAsBlob("/tmp/bookorbit-public-comic.cbz", { type: "application/vnd.comicbook+zip" }),
  "public-domain-comic-" + Date.now() + ".cbz",
);
const response = await fetch(base + `/libraries/${library.id}/upload`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(180000) });
assert.ok(response.ok, await response.clone().text());
const upload = await response.json();
assert.equal(upload.format, "cbz");
let book;
const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  book = await api(`/books/${upload.bookId}`);
  if (book.coverSource) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const file = book.files.find((item) => item.format === "cbz");
assert.ok(file);
assert.ok(book.coverSource, "CBZ cover extraction must succeed");
const pages = await api(`/cbz/files/${file.id}/pages`);
assert.ok(pages.pageCount > 0);
const page = await fetch(base + `/cbz/files/${file.id}/pages/0`, { headers, signal: AbortSignal.timeout(60000) });
assert.ok(page.ok);
assert.match(page.headers.get("content-type"), /^image\//);
assert.ok((await page.arrayBuffer()).byteLength > 1000);
console.log(JSON.stringify({ check: "offline-comic-upload-cover-and-reader", bookId: upload.bookId, pageCount: pages.pageCount, passed: true }));
