import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mapEntries } from "./index.mjs";

const feed = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://www.gutenberg.org/ebooks/1342</id>
    <title>Pride &amp; Prejudice</title>
    <author><name>Jane Austen</name></author>
    <link rel="http://opds-spec.org/acquisition/open-access" type="application/epub+zip" href="/ebooks/1342.epub.images" />
  </entry>
  <entry>
    <id>https://www.gutenberg.org/ebooks/11</id>
    <title>Alice&apos;s Adventures in Wonderland</title>
    <link rel="http://opds-spec.org/acquisition/open-access" type="text/html" href="/ebooks/11.html" />
  </entry>
</feed>`;

test("maps downloadable open-access EPUB entries and ignores non-EPUB entries", () => {
  assert.deepEqual(mapEntries(feed), [
    {
      guid: "https://www.gutenberg.org/ebooks/1342",
      title: "Pride & Prejudice",
      bookTitle: "Pride & Prejudice",
      author: "Jane Austen",
      downloadUrl: "https://www.gutenberg.org/ebooks/1342.epub.images",
      sizeBytes: null,
      seeders: null,
      leechers: null,
      format: "epub",
    },
  ]);
});

test("bounds the result count and rejects malformed or non-Gutenberg download links", async () => {
  assert.equal(mapEntries(feed, 0).length, 0);
  const plugin = (await import("./index.mjs")).default;
  const changed = feed.replace("/ebooks/1342.epub.images", "https://example.com/book.epub");
  assert.equal(mapEntries(changed).length, 0);
  assert.equal(typeof plugin.resolveFile, "function");
});

test("declares a compatible direct-download plugin contract", async () => {
  const plugin = (await import("./index.mjs")).default;
  assert.equal(plugin.apiVersion, 1);
  assert.equal(plugin.type, "project-gutenberg");
  assert.deepEqual(plugin.mediaKinds, ["ebook"]);
  assert.equal(plugin.seedsBack, false);
});

test("follows real OPDS subsection catalogs and accepts Gutenberg acquisition links", async () => {
  const plugin = (await import("./index.mjs")).default;
  const calls = [];
  const catalog =
    '<feed><entry><id>book</id><title>Book</title><link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/1342.opds"/></entry></feed>';
  const detail = feed
    .replace("acquisition/open-access", "acquisition")
    .replace('href="/ebooks/1342.epub.images"', 'length="561102" href="/ebooks/1342.epub.images"')
    .replace("<title>Pride &amp; Prejudice</title>", "<title>Pride &amp; Prejudice</title><dcterms:language>zh</dcterms:language>");
  const host = {
    buildSearchText: () => "Pride and Prejudice",
    fetch: async (url) => {
      calls.push(url);
      return new Response(url.includes("search.opds") ? catalog : detail);
    },
    fail: (_kind, message) => new Error(message),
  };
  const result = await plugin.search({ limit: 5 }, {}, host);
  assert.equal(calls.length, 2);
  assert.equal(result[0].title, "Pride & Prejudice");
  assert.equal(result[0].language, "zh");
  assert.equal(result[0].sizeBytes, 561102);
});

test("bounds catalog requests to five pages with at most two requests in flight", async () => {
  const plugin = (await import("./index.mjs")).default;
  const catalog = `<feed>${Array.from({ length: 30 }, (_, i) => `<entry><title>Book</title><link type="application/atom+xml" rel="subsection" href="/ebooks/${i + 1}.opds"/></entry>`).join("")}</feed>`;
  let calls = 0;
  let active = 0;
  let peak = 0;
  const host = {
    buildSearchText: () => "Book",
    fetch: async (url) => {
      calls++;
      if (url.includes("search.opds")) return new Response(catalog);
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return new Response("<feed></feed>");
    },
    fail: (_kind, message) => new Error(message),
  };
  assert.deepEqual(await plugin.search({ limit: 20 }, {}, host), []);
  assert.equal(calls, 6);
  assert.equal(peak, 2);
});

test("reports detail failures instead of presenting them as zero resources", async () => {
  const plugin = (await import("./index.mjs")).default;
  const host = {
    buildSearchText: () => "Book",
    fetch: async (url) =>
      url.includes("search.opds")
        ? new Response('<feed><entry><link rel="subsection" type="application/atom+xml" href="/ebooks/1.opds"/></entry></feed>')
        : new Response("unavailable", { status: 503 }),
    fail: (_kind, message) => new Error(message),
  };
  await assert.rejects(plugin.search({ limit: 5 }, {}, host), /503/);
});

test("rejects untrusted catalog links and malformed download URLs", async () => {
  const { catalogLinks } = await import("./index.mjs");
  for (const url of [
    "https://example.com/ebooks/1.opds",
    "https://user:secret@www.gutenberg.org/ebooks/1.opds",
    "https://www.gutenberg.org:8443/ebooks/1.opds",
    "/ebooks/author/1.opds",
  ]) {
    assert.deepEqual(catalogLinks(`<feed><entry><link rel="subsection" type="application/atom+xml" href="${url}"/></entry></feed>`), []);
  }
  assert.equal(mapEntries(feed.replace("/ebooks/1342.epub.images", "https://[")).length, 0);
  assert.equal(mapEntries(feed, -1).length, 0);
});
