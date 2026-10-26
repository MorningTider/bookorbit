import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
assert.equal(process.env.BOOKORBIT_VERIFY_ISOLATED, "1");
const host = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : process.env.POSTGRES_HOST;
assert.equal(host, "bookorbit-db-verify");
const base = "http://127.0.0.1:3000/api/v1";
const login = await fetch(base + "/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: await readFile("/data/.custom-verification-user.json", "utf8"),
  signal: AbortSignal.timeout(30000),
});
assert.ok(login.ok);
const { accessToken } = await login.json();
let withPublication = 0;
for (const title of ["余罪", "三体", "活着"]) {
  console.log(JSON.stringify({ check: "live-publication-start", title }));
  const query = new URLSearchParams({ title, providers: "baiduBaike", mediaKind: "ebook", cache: "refresh" });
  const response = await fetch(base + "/metadata-fetch/stream?" + query, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(75000),
  });
  assert.ok(response.ok);
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)));
  const candidates = events.filter((event) => event.provider === "baiduBaike" && event.title);
  console.log(
    JSON.stringify({
      check: "live-publication-fields",
      title,
      count: candidates.length,
      candidates: candidates.map((c) => ({
        title: c.title,
        providerId: c.providerId,
        publisher: c.publisher,
        publishedYear: c.publishedYear,
        publishedDate: c.publishedDate,
        pageCount: c.pageCount,
        seriesName: c.seriesName,
      })),
    }),
  );
  for (const candidate of candidates) {
    if (candidate.publishedYear != null) {
      assert.ok(candidate.publishedYear >= 1000);
      withPublication++;
    }
    if (candidate.pageCount != null) assert.ok(Number.isSafeInteger(candidate.pageCount) && candidate.pageCount > 0);
    if (candidate.publishedDate) assert.equal(new Date(candidate.publishedDate).toISOString().slice(0, 10), candidate.publishedDate);
  }
}
console.log(JSON.stringify({ check: "live-publication-summary", withPublication, passed: withPublication > 0 }));
if (!withPublication) process.exitCode = 2;
