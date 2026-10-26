import assert from "node:assert/strict";
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
const config = await fetch(base + "/metadata-preferences/providers", {
  method: "PUT",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ baiduBaike: { enabled: true }, qimao: { enabled: true }, qidian: { enabled: true } }),
});
assert.ok(config.ok, await config.text());
for (const [provider, title] of [
  ["baiduBaike", "余罪"],
  ["qimao", "凡人修仙传"],
  ["qidian", "凡人修仙传"],
]) {
  const query = new URLSearchParams({ title, providers: provider, mediaKind: "ebook", cache: "refresh" });
  const response = await fetch(base + "/metadata-fetch/stream?" + query, { headers, signal: AbortSignal.timeout(60000) });
  assert.ok(response.ok, `Search HTTP ${response.status}`);
  const events = (await response.text()).split("\n\n").flatMap((block) =>
    block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5))),
  );
  const candidates = events.filter((item) => item.provider === provider && item.title);
  assert.ok(candidates.length, `${provider}: ${JSON.stringify(events)}`);
  if (provider === "baiduBaike") assert.ok(candidates.some((item) => item.authors.includes("常书欣")));
  const candidate = candidates.find((item) => item.coverUrl);
  assert.ok(candidate, `${provider} must return a cover URL`);
  const cover = await fetch(base + "/books/cover/proxy?url=" + encodeURIComponent(candidate.coverUrl), {
    headers,
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(cover.ok, `${provider} cover HTTP ${cover.status}`);
  assert.match(cover.headers.get("content-type"), /^image\//);
  assert.ok((await cover.arrayBuffer()).byteLength > 1000);
  console.log(JSON.stringify({ check: "live-metadata-and-cover", provider, count: candidates.length, passed: true }));
}
