import assert from "node:assert/strict";
import test from "node:test";
import plugin, { mapItem } from "./index.mjs";

function item(changes = {}) {
  return {
    metadata: {
      identifier: "test-comic",
      mediatype: "texts",
      title: "测试漫画",
      creator: "测试作者",
      language: "zh",
      licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/",
      ...changes,
    },
    files: [{ name: "comic.cbz", size: "1024" }],
  };
}
const host = (fetch) => ({ fetch, fail: (_kind, message) => new Error(message) });
test("maps only public downloadable CBZ with a stable identity and source information", () => {
  const [release] = mapItem(item(), "test-comic");
  assert.equal(release.format, "cbz");
  assert.equal(release.guid, "test-comic/comic.cbz");
  assert.equal(release.sizeBytes, 1024);
  assert.equal(release.author, "测试作者");
  assert.equal(release.infoUrl, "https://archive.org/details/test-comic");
});
test("rejects restricted, unlicensed, dark, mismatched and private resources", () => {
  for (const changes of [
    { "access-restricted-item": true },
    { "access-restricted-item": "true" },
    { licenseurl: "https://example.org/publicdomain/" },
    { identifier: "other" },
    { mediatype: "audio" },
  ])
    assert.deepEqual(mapItem(item(changes), "test-comic"), []);
  assert.deepEqual(mapItem({ ...item(), is_dark: true }, "test-comic"), []);
  assert.deepEqual(mapItem({ ...item(), files: [{ name: "comic.cbz", size: "1024", private: true }] }, "test-comic"), []);
});
test("rejects unsafe filenames, invalid lengths and oversized files; selects the smallest valid CBZ", () => {
  const files = ["../comic.cbz", "dir/comic.cbz", "dir\\comic.cbz", "image.zip", "comic\x00.cbz"].map((name) => ({ name, size: "10" }));
  files.push({ name: "too-large.cbz", size: String(513 * 1024 * 1024) }, { name: "empty.cbz", size: "0" }, { name: "invalid.cbz", size: "Infinity" });
  assert.deepEqual(mapItem({ ...item(), files }, "test-comic"), []);
  files.push({ name: "large.cbz", size: "2048" }, { name: "small.cbz", size: "1024" });
  assert.equal(mapItem({ ...item(), files }, "test-comic")[0].guid, "test-comic/small.cbz");
});
test("limits details and concurrent requests and cannot broaden the fixed license restrictions", async () => {
  let active = 0,
    peak = 0,
    details = 0;
  const mockHost = host(async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://archive.org");
    if (parsed.pathname.includes("advancedsearch")) {
      assert.equal(parsed.searchParams.get("rows"), "5");
      assert.ok(parsed.searchParams.get("q").includes('title:"bad\\" OR *:*"'));
      return Response.json({ response: { docs: Array.from({ length: 20 }, (_, index) => ({ identifier: "comic-" + index })) } });
    }
    details++;
    active++;
    peak = Math.max(active, peak);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    const id = parsed.pathname.split("/").pop();
    return Response.json({ ...item({ identifier: id }) });
  });
  assert.equal((await plugin.search({ title: 'bad" OR *:*', mediaKind: "ebook", limit: 50 }, {}, mockHost)).length, 5);
  assert.equal(details, 5);
  assert.equal(peak, 2);
});
test("resolve ignores supplied download URLs and rechecks public availability", async () => {
  const release = mapItem(item(), "test-comic")[0];
  const resolved = await plugin.resolveFile(
    { ...release, downloadUrl: "http://127.0.0.1/secret" },
    {},
    host(async () => Response.json(item())),
  );
  assert.equal(resolved.url, "https://archive.org/download/test-comic/comic.cbz");
  await assert.rejects(
    plugin.resolveFile(
      release,
      {},
      host(async () => Response.json(item({ "access-restricted-item": "true" }))),
    ),
    /不再公开/,
  );
  await assert.rejects(
    plugin.resolveFile(
      { guid: "../../secret" },
      {},
      host(() => assert.fail("Must not fetch")),
    ),
    /标识/,
  );
});
test("fails transparently on invalid JSON, throttling and all failed metadata requests", async () => {
  await assert.rejects(
    plugin.search(
      { title: "Comic", mediaKind: "ebook", limit: 1 },
      {},
      host(async () => new Response("bad")),
    ),
    /JSON/,
  );
  await assert.rejects(
    plugin.search(
      { title: "Comic", mediaKind: "ebook", limit: 1 },
      {},
      host(async () => new Response("", { status: 429 })),
    ),
    /429/,
  );
  await assert.rejects(
    plugin.search(
      { title: "Comic", mediaKind: "ebook", limit: 1 },
      {},
      host(async (url) =>
        url.includes("advancedsearch") ? Response.json({ response: { docs: [{ identifier: "test-comic" }] } }) : new Response("", { status: 500 }),
      ),
    ),
    /500/,
  );
});
test("empty input does not make network requests and unsupported media are explicit", async () => {
  const mockHost = host(() => assert.fail("Must not fetch"));
  assert.deepEqual(await plugin.search({ title: "", mediaKind: "ebook", limit: 5 }, {}, mockHost), []);
  assert.deepEqual(await plugin.search({ title: "Comic", mediaKind: "ebook", limit: 0 }, {}, mockHost), []);
  await assert.rejects(plugin.search({ title: "Comic", mediaKind: "audiobook", limit: 5 }, {}, mockHost), /CBZ/);
});
