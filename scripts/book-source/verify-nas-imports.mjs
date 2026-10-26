import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";

if (process.env.BOOKORBIT_VERIFY_ISOLATED !== "1") throw new Error("Run only against the isolated verification instance");
const base = "http://127.0.0.1:3000/api/v1";
const statePath = "/data/.custom-verification-user.json";
let token;
async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path}: HTTP ${response.status} ${(await response.text()).slice(0, 600)}`);
  return response.status === 204 ? undefined : response.json();
}
const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const setup = await request("/auth/setup-status");
let credentials;
if (setup.needsSetup) {
  credentials = { username: "custom-verification", password: `VerifyA1${randomBytes(24).toString("hex")}` };
  const session = await request("/auth/setup", {
    ...json({ ...credentials, name: "定制功能隔离验收", email: "verification@example.invalid" }),
    headers: { "Content-Type": "application/json", "x-setup-token": process.env.SETUP_BOOTSTRAP_TOKEN || "" },
  });
  token = session.accessToken;
  await writeFile(statePath, JSON.stringify(credentials), { mode: 0o600 });
} else {
  credentials = JSON.parse(await readFile(statePath, "utf8"));
  token = (await request("/auth/login", json(credentials))).accessToken;
}
assert.ok(token, "Authentication must return an access token");
let libraries = await request("/libraries");
assert.ok(Array.isArray(libraries));
let library = libraries.find((item) => item.name === "定制功能隔离验收");
if (!library) library = await request("/libraries", json({ name: "定制功能隔离验收", icon: "book-open", folders: ["/books"] }));
console.log(JSON.stringify({ check: "authentication-and-library", libraryId: library.id, passed: true }));
const form = new FormData();
const title = `隔离测试小说-${Date.now()}`;
form.append(
  "file",
  new Blob(["第一章 初见\n\n这是用于验证上传的第一章正文。\n".repeat(30) + "\n第二章 再会\n\n这是第二章正文。\n".repeat(30)], { type: "text/plain" }),
  `${title}.txt`,
);
const upload = await request(`/libraries/${library.id}/upload`, { method: "POST", body: form });
assert.equal(upload.format, "txt");
let book = await request(`/books/${upload.bookId}`);
const metadataDeadline = Date.now() + 60000;
while (book.title === null && Date.now() < metadataDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  book = await request(`/books/${upload.bookId}`);
}
assert.equal(book.title, title, "A chapter heading must not replace the TXT filename title");
assert.equal(book.files.filter((item) => item.format === "txt").length, 1);
assert.equal(book.files.filter((item) => item.format === "epub").length, 0, "TXT upload must not convert automatically");
console.log(JSON.stringify({ check: "txt-upload-without-auto-conversion", bookId: upload.bookId, passed: true }));
await request(`/books/${upload.bookId}/convert-txt-to-epub`, json({ encoding: "utf8", chapters: "chinese" }));
book = await request(`/books/${upload.bookId}`);
assert.equal(book.files.filter((item) => item.format === "txt").length, 1);
assert.equal(book.files.filter((item) => item.format === "epub").length, 1);
console.log(JSON.stringify({ check: "manual-conversion-same-book", bookId: upload.bookId, passed: true }));
const scannedTitle = `扫描测试-${Date.now()}`;
await writeFile(`/books/${scannedTitle}.txt`, `书名：${scannedTitle}\n作者：隔离作者\n\n第一章 起始\n` + "扫描正文。".repeat(300));
await request(`/scanner/libraries/${library.id}/scan`, json({}));
let scanned;
const scanDeadline = Date.now() + 120000;
while (Date.now() < scanDeadline) {
  const page = await request(`/libraries/${library.id}/books`, json({ q: scannedTitle, sort: [], pagination: { page: 0, size: 10 } }));
  scanned = page.items?.[0];
  if (scanned) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
assert.ok(scanned, "Filesystem scan must discover the TXT file");
const scannedBook = await request(`/books/${scanned.id}`);
assert.ok(scannedBook.files.some((item) => item.format === "txt"));
assert.ok(!scannedBook.files.some((item) => item.format === "epub"));
console.log(JSON.stringify({ check: "txt-filesystem-scan-without-conversion", bookId: scanned.id, passed: true }));

const source = await request("/book-sources/status");
assert.equal(source.fanqie.configured, true);
const job = await request(`/libraries/${library.id}/sources/fanqie`, json({ bookId: "7632840875923491865" }));
assert.ok(job.id);
console.log(JSON.stringify({ check: "background-download-enqueued", jobId: job.id, status: job.status, passed: true }));
const deadline = Date.now() + 180000;
let result;
while (Date.now() < deadline) {
  result = await request(`/book-sources/jobs/${job.id}`);
  if (["completed", "failed", "cancelled"].includes(result.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
assert.equal(result.status, "completed", JSON.stringify(result));
console.log(JSON.stringify({ check: "background-download-imported", jobId: job.id, bookId: result.resultBookId, passed: true }));

const settings = await request("/metadata-preferences/providers");
for (const key of ["douban", "fanqie", "baiduBaike", "qimao", "qidian"]) assert.ok(settings.config[key], `Missing provider: ${key}`);
console.log(JSON.stringify({ check: "chinese-provider-registration", passed: true }));
await request("/metadata-preferences/providers", { ...json({ douban: { enabled: true }, qidian: { enabled: true } }), method: "PUT" });
const metadata = await request("/metadata-fetch/lookup?provider=douban&id=26613724&cache=refresh");
assert.equal(metadata.title, "余罪");
assert.ok(metadata.authors.includes("常书欣"));
assert.ok(metadata.description.length > 30);
assert.ok(metadata.coverUrl);
const coverResponse = await fetch(base + "/books/cover/proxy?url=" + encodeURIComponent(metadata.coverUrl), {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(30000),
});
assert.ok(coverResponse.ok, `Cover proxy HTTP ${coverResponse.status}`);
assert.match(coverResponse.headers.get("content-type"), /^image\//);
assert.ok((await coverResponse.arrayBuffer()).byteLength > 1000);
console.log(JSON.stringify({ check: "douban-full-metadata-and-cover", passed: true }));

const audioPath = `/tmp/bookorbit-nas-audio-${randomUUID()}.m4a`;
try {
  await promisify(execFileCallback)(
    process.env.FFMPEG_PATH || "ffmpeg",
    [
      "-nostdin",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=10",
      "-c:a",
      "aac",
      "-b:a",
      "32k",
      "-metadata",
      `album=隔离测试有声书-${randomUUID()}`,
      "-metadata",
      "album_artist=隔离作者",
      "-metadata",
      "artist=隔离演播者",
      "-y",
      audioPath,
    ],
    { timeout: 30000 },
  );
  const audioForm = new FormData();
  audioForm.append("file", new Blob([await readFile(audioPath)], { type: "audio/mp4" }), `隔离有声书-${Date.now()}.m4a`);
  const audioUpload = await request(`/libraries/${library.id}/upload`, { method: "POST", body: audioForm });
  assert.equal(audioUpload.format, "m4a");
  let manifest = await request(`/audiobooks/${audioUpload.bookId}/manifest`);
  const audioDeadline = Date.now() + 60000;
  while (manifest.totalDurationMs < 9000 && Date.now() < audioDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    manifest = await request(`/audiobooks/${audioUpload.bookId}/manifest`);
  }
  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].format, "m4a");
  assert.ok(manifest.totalDurationMs >= 9000);
  const asset = manifest.assets[0];
  const range = await fetch(base + `/audiobooks/${audioUpload.bookId}/assets/${asset.assetId}/content`, {
    headers: { Authorization: `Bearer ${token}`, Range: "bytes=0-127" },
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 128);
  await request(`/audiobooks/${audioUpload.bookId}/playback-state`, {
    ...json({
      assetId: asset.assetId,
      positionMs: 3000,
      capturedAt: new Date().toISOString(),
      operationId: randomUUID(),
      baseRevision: 0,
      manifestRevision: manifest.revision,
    }),
    method: "PUT",
  });
  token = (await request("/auth/login", json(credentials))).accessToken;
  const progress = await request(`/audiobooks/${audioUpload.bookId}/playback-state`);
  assert.equal(progress.positionMs, 3000);
  assert.equal(progress.assetId, asset.assetId);
  console.log(JSON.stringify({ check: "m4a-upload-range-playback-and-second-session-progress", bookId: audioUpload.bookId, passed: true }));
} finally {
  await unlink(audioPath).catch(() => {});
}
