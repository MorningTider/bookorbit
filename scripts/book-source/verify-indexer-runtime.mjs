import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { copyFile, mkdir, mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(process.env.BOOK_SOURCE_APP_ROOT || new URL("../../server/package.json", import.meta.url));
const { PluginLoaderService } = require("./dist/modules/book-request/indexers/plugins/plugin-loader.service.js");
const { forgetDispatchers } = require("./dist/common/utils/safe-fetch.js");
const { DirectDownloadService } = require("./dist/modules/book-request/fulfillment/direct-download.service.js");
const { ComicFormatExtractor } = require("./dist/modules/metadata/extractors/comic-format.extractor.js");
const { readCbzZipIndex } = require("./dist/common/cbz-zip-reader.js");
const { assertSourceEpub } = require("./dist/modules/book-source/validate-source-epub.js");
const pluginKey = process.env.BOOK_SOURCE_E2E_PLUGIN || "gutenberg";
const sources = {
  gutenberg: {
    type: "project-gutenberg",
    origin: "https://www.gutenberg.org",
    query: "A Modest Proposal",
    format: "epub",
    maxBytes: 4 * 1024 * 1024,
  },
  "internet-archive-comics": {
    type: "internet-archive-comics",
    origin: "https://archive.org",
    query: "Foxy Grandpa",
    format: "cbz",
    maxBytes: 256 * 1024 * 1024,
  },
};
const source = sources[pluginKey];
assert.ok(source, "Unknown verification plugin");
const root = await mkdtemp(join(tmpdir(), "bookorbit-gutenberg-check-"));
const clientKey = randomBytes(20).toString("hex");
let downloader;
try {
  const directory = join(root, "plugins/indexers", pluginKey);
  await mkdir(directory, { recursive: true });
  await copyFile(
    process.env.BOOK_SOURCE_PLUGIN_PATH || fileURLToPath(new URL(`../../plugins/${pluginKey}/index.mjs`, import.meta.url)),
    join(directory, "index.mjs"),
  );
  const loader = new PluginLoaderService({ appDataPath: root }, {});
  const adapters = await loader.load();
  const adapter = adapters.find((item) => item.type === source.type);
  assert.ok(adapter, "Compiled plugin loader must discover the selected source");
  assert.deepEqual(loader.loadFailures(), []);
  const config = {
    id: 1,
    managerId: null,
    managerPriority: null,
    name: "Indexer runtime verification",
    color: null,
    adapterType: source.type,
    baseUrl: source.origin,
    credential: null,
    credentialError: null,
    allowPrivateAddress: false,
    applyTrackerSeedGoals: false,
    seedRatioGoal: null,
    seedTimeMinutes: null,
    categories: { ebook: [], audiobook: [] },
    disabledMediaKinds: [],
    isbnSearchDisabled: true,
    settings: null,
    networkProfile: process.env.BOOK_SOURCE_PROXY_URL ? { proxyUrl: process.env.BOOK_SOURCE_PROXY_URL } : null,
    perIndexerTimeoutSeconds: 15,
    overallSearchBudgetSeconds: 20,
    autoExpandCategories: false,
  };
  const results = await adapter.search(
    {
      title: process.env.BOOK_SOURCE_E2E_QUERY || source.query,
      author: null,
      isbn13: null,
      isbn13s: [],
      mediaKind: "ebook",
      language: null,
      limit: 5,
    },
    config,
    AbortSignal.timeout(30000),
  );
  console.log(JSON.stringify({ stage: "search", results: results.length }));
  assert.ok(results.length, "Search must return actual file acquisition results");
  const selected = results.find((item) => item.sizeBytes && item.sizeBytes <= source.maxBytes);
  assert.ok(selected, "Choose a test query within the verification size bound");
  const resolved = await adapter.resolveFile(selected, config, AbortSignal.timeout(15000));
  console.log(JSON.stringify({ stage: "resolve", format: resolved.format, advertisedBytes: selected.sizeBytes }));
  const record = { id: 1, clientKey, directEtag: null, directLastModified: null, totalBytes: null };
  downloader = new DirectDownloadService(
    { appDataPath: root },
    {
      update: async (_id, values) => {
        Object.assign(record, values);
      },
      findById: async () => record,
    },
    { resolveConfig: async () => config },
  );
  await downloader.add({ downloadId: 1, indexerId: 1, clientKey, fileUrl: resolved.url, fileName: resolved.fileName, format: resolved.format });
  const deadline = Date.now() + 300000;
  let completed;
  while (Date.now() < deadline) {
    const [status] = await downloader.status([clientKey]);
    assert.ok(status, "Download status must remain visible");
    assert.ok(status.downloadedBytes <= source.maxBytes, "Verification download exceeds the configured bound");
    assert.notEqual(status.state, "failed", status.errorMessage || "Direct download failed");
    if (status.state === "completed") {
      completed = status;
      break;
    }
    await delay(250);
  }
  assert.ok(completed?.contentPath, "Direct download did not complete within the verification deadline");
  assert.ok((await stat(completed.contentPath)).size <= source.maxBytes);
  const fileSize = (await stat(completed.contentPath)).size;
  if (source.format === "epub") await assertSourceEpub(await readFile(completed.contentPath));
  else {
    const index = await readCbzZipIndex(completed.contentPath);
    assert.ok(
      index?.entries.some((entry) => /\.(?:jpe?g|png|webp)$/i.test(entry.name)),
      "CBZ must contain image pages",
    );
    const metadata = await new ComicFormatExtractor("cbz").extract(completed.contentPath);
    assert.ok(metadata?.cover?.length, "Actual comic extractor must read a cover");
  }
  if (process.env.BOOK_SOURCE_E2E_OUTPUT) await copyFile(completed.contentPath, process.env.BOOK_SOURCE_E2E_OUTPUT);
  console.log(
    JSON.stringify({
      compiledLoader: true,
      directDownloadService: true,
      results: results.length,
      format: resolved.format,
      bytes: fileSize,
      containerValidated: true,
      ...(process.env.BOOK_SOURCE_E2E_OUTPUT ? { output: process.env.BOOK_SOURCE_E2E_OUTPUT } : {}),
    }),
  );
} finally {
  await downloader?.remove(clientKey, { deleteFiles: true });
  forgetDispatchers();
  await rm(root, { recursive: true, force: true });
}
