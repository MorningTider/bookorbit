import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

if (process.env.BOOKORBIT_VERIFY_ISOLATED !== "1") throw new Error("Run only against the isolated verification instance");

const base = "http://127.0.0.1:3000/api/v1";
const pluginPath = process.env.BOOK_SOURCE_PLUGIN_PATH;
if (!pluginPath) throw new Error("BOOK_SOURCE_PLUGIN_PATH is required");

const credentials = JSON.parse(await readFile("/data/.custom-verification-user.json", "utf8"));
async function request(path, options = {}, token) {
  const response = await fetch(base + path, {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    signal: AbortSignal.timeout(120000),
  });
  const body = response.status === 204 ? undefined : await response.text();
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path}: HTTP ${response.status} ${body?.slice(0, 600) || ""}`.trim());
  return body ? JSON.parse(body) : undefined;
}

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const { accessToken } = await request("/auth/login", json(credentials));
assert.ok(accessToken, "Authentication must return an access token");

const source = await readFile(pluginPath);
const form = new FormData();
form.append("file", new Blob([source], { type: "text/javascript" }), "index.mjs");
const inspection = await request("/admin/request-indexers/plugins", { method: "POST", body: form }, accessToken);
assert.ok(inspection.type, "Installed plugin must declare its adapter type");
console.log(JSON.stringify({ check: "plugin-installed", type: inspection.type, version: inspection.version ?? null, passed: true }));

const adapterResult = await request("/admin/request-indexers/adapters", {}, accessToken);
const adapter = adapterResult.adapters.find((item) => item.type === inspection.type);
assert.ok(adapter, "Installed plugin must appear in the runtime adapter list");
assert.deepEqual(adapterResult.pluginFailures, []);
console.log(JSON.stringify({ check: "plugin-loaded", type: adapter.type, builtIn: adapter.builtIn, passed: true }));

const existing = await request("/admin/request-indexers", {}, accessToken);
let indexer = existing.indexers.find((item) => item.adapterType === adapter.type);
if (!indexer) {
  indexer = await request(
    "/admin/request-indexers",
    json({
      name: `${adapter.label} 隔离验收`,
      adapterType: adapter.type,
      baseUrl: adapter.defaultBaseUrl ?? "",
      enabled: true,
      allowPrivateAddress: false,
      categories: { ebook: [], audiobook: [] },
      isbnSearchDisabled: true,
    }),
    accessToken,
  );
  console.log(JSON.stringify({ check: "indexer-created", id: indexer.id, passed: true }));
} else {
  console.log(JSON.stringify({ check: "indexer-found", id: indexer.id, passed: true }));
}

const result = await request(`/admin/request-indexers/${indexer.id}/test`, { method: "POST" }, accessToken);
assert.equal(result.success, true, result.error || "Indexer test failed");
console.log(JSON.stringify({ check: "indexer-connectivity", id: indexer.id, indexerName: result.indexerName ?? null, passed: true }));
