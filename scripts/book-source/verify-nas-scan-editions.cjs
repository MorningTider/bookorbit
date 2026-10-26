const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const appRequire = createRequire(process.env.BOOK_SOURCE_APP_ROOT || "/app/package.json");
const { convertTxtToEpub } = appRequire("./dist/modules/metadata/lib/txt-to-epub.js");
(async () => {
  assert.equal(process.env.BOOKORBIT_VERIFY_ISOLATED, "1");
  const stamp = Date.now();
  const root = "/books/scan-editions-" + stamp;
  await fs.mkdir(root, { recursive: false });
  const c = JSON.parse(await fs.readFile("/data/.custom-verification-user.json", "utf8"));
  const base = "http://127.0.0.1:3000/api/v1";
  let token;
  async function api(p, b) {
    const r = await fetch(base + p, {
      method: b ? "POST" : "GET",
      headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" },
      ...(b ? { body: JSON.stringify(b) } : {}),
      signal: AbortSignal.timeout(120000),
    });
    if (r.status === 409 && p.endsWith("/scan")) return { alreadyRunning: true };
    assert.ok(r.ok, p + " " + r.status);
    return r.status === 204 ? null : r.json();
  }
  token = (await api("/auth/login", c)).accessToken;
  const paths = [];
  async function txt(p, title) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, "书名：" + title + "\n作者：隔离扫描验收\n第一章 初见\n" + "这是一份独立的扫描测试文本。".repeat(80));
    paths.push(p);
  }
  const a = root + "/唯一配对.txt";
  await txt(a, "唯一配对");
  await convertTxtToEpub(a, root + "/唯一配对.epub", "唯一配对");
  paths.push(root + "/唯一配对.epub");
  const b = root + "/歧义版本.txt";
  await txt(b, "歧义版本一");
  await txt(root + "/歧义版本.TXT", "歧义版本二");
  await convertTxtToEpub(b, root + "/歧义版本.epub", "歧义版本三");
  paths.push(root + "/歧义版本.epub");
  await txt(root + "/目录甲/同名.txt", "跨目录甲");
  const seed = root + "/seed.txt";
  await fs.writeFile(seed, "第一章 验收\n" + "跨目录独立版本。".repeat(80));
  await fs.mkdir(root + "/目录乙");
  await convertTxtToEpub(seed, root + "/目录乙/同名.epub", "跨目录乙");
  await fs.unlink(seed);
  paths.push(root + "/目录乙/同名.epub");
  const hashes = await Promise.all(
    paths.map(async (p) => [
      p,
      createHash("sha256")
        .update(await fs.readFile(p))
        .digest("hex"),
    ]),
  );
  const lib = await api("/libraries", { name: "格式归并隔离验收-" + stamp, icon: "book-open", folders: [root], watch: false });
  async function scan() {
    const before = await api("/scanner/libraries/" + lib.id + "/scan-history");
    const started = await api("/scanner/libraries/" + lib.id + "/scan", {});
    for (let i = 0; i < 150; i++) {
      const h = await api("/scanner/libraries/" + lib.id + "/scan-history");
      const list = Array.isArray(h) ? h : h.items;
      const prev = Array.isArray(before) ? before : before.items;
      if (list?.[0] && (started.alreadyRunning || list[0].id !== prev?.[0]?.id) && ["completed", "failed"].includes(list[0].status)) {
        assert.equal(list[0].status, "completed");
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw Error("scan timeout");
  }
  await scan();
  const list = () => api("/libraries/" + lib.id + "/books", { q: "", sort: [], pagination: { page: 0, size: 20 } });
  let books = await list();
  assert.equal(books.items.length, 6, "Expect one unique pair, three ambiguous editions and two cross-folder books");
  const records = await Promise.all(books.items.map((x) => api("/books/" + x.id)));
  const groups = records.map((x) => ({
    id: x.id,
    formats: x.files.map((f) => f.format).sort(),
    files: x.files.map((f) => f.absolutePath || f.path || f.filePath),
  }));
  assert.equal(groups.filter((x) => x.formats.includes("txt") && x.formats.includes("epub")).length, 1);
  assert.equal(groups.filter((x) => x.formats.length === 1).length, 5);
  const ids = books.items.map((x) => x.id).sort((a, b) => a - b);
  await scan();
  books = await list();
  assert.deepEqual(
    books.items.map((x) => x.id).sort((a, b) => a - b),
    ids,
  );
  for (const [p, hash] of hashes)
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(p))
        .digest("hex"),
      hash,
    );
  console.log(
    JSON.stringify({
      check: "nas-scan-unique-ambiguous-cross-folder-repeat",
      libraryId: lib.id,
      books: 6,
      files: paths.length,
      groups,
      passed: true,
    }),
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
