import assert from "node:assert/strict";
import { readFile, mkdir, chown } from "node:fs/promises";
if (process.env.BOOKORBIT_VERIFY_ISOLATED !== "1") throw new Error("Use isolated verification instance only");
const base = "http://127.0.0.1:3000/api/v1";
let token;
async function api(path, body, method = body ? "POST" : "GET") {
  const response = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${(await response.text()).slice(0, 500)}`);
  return response.status === 204 ? null : response.json();
}
token = (await api("/auth/login", JSON.parse(await readFile("/data/.custom-verification-user.json", "utf8")))).accessToken;
const saved = await api("/book-metadata-fetch/config");
console.log(JSON.stringify({ check: "auto-config-read", keys: Object.keys(saved) }));
const config = saved.config ?? saved;
try {
  await api(
    "/book-metadata-fetch/config",
    {
      enabled: true,
      triggerOnImport: true,
      conditions: {
        scoreThreshold: { enabled: false, threshold: 50 },
        missingFields: { enabled: true, fields: ["description", "cover"] },
        neverFetched: { enabled: true },
      },
    },
    "PUT",
  );
  await api("/book-metadata-fetch/resume", {});
  const folder = "/books/auto-verification-" + Date.now();
  await mkdir(folder);
  await chown(folder, Number(process.env.PUID || 1000), Number(process.env.PGID || 1000));
  const library = await api("/libraries", { name: "自动刮削隔离验收-" + Date.now(), icon: "book-open", folders: [folder] });
  const form = new FormData();
  form.append("file", new Blob(["书名：余罪\n作者：常书欣\n\n第一章 初见\n" + "隔离验证正文。".repeat(300)], { type: "text/plain" }), "余罪.txt");
  const upload = await fetch(base + `/libraries/${library.id}/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  assert.ok(upload.ok, await upload.clone().text());
  const { bookId } = await upload.json();
  let book;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    book = await api(`/books/${bookId}`);
    if (book.description?.length > 30 && book.coverSource) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.ok(
    book.description?.length > 30 && book.coverSource,
    JSON.stringify({
      bookId,
      title: book.title,
      description: book.description,
      coverSource: book.coverSource,
      status: await api("/book-metadata-fetch/status"),
    }),
  );
  assert.equal(book.title, "余罪");
  console.log(JSON.stringify({ check: "automatic-upload-metadata-and-cover", bookId, passed: true }));
} finally {
  await api(
    "/book-metadata-fetch/config",
    { enabled: config.enabled, triggerOnImport: config.triggerOnImport, conditions: config.conditions },
    "PUT",
  );
}
