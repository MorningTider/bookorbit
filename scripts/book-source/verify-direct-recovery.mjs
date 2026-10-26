import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
const self = fileURLToPath(import.meta.url);
const require = createRequire(process.env.BOOK_SOURCE_APP_ROOT || new URL("../../server/package.json", import.meta.url));
const { DirectDownloadService, directDownloadRoot } = require("./dist/modules/book-request/fulfillment/direct-download.service.js");
const { forgetDispatchers } = require("./dist/common/utils/safe-fetch.js");
const digest = (b) => createHash("sha256").update(b).digest("hex");
const key = "b".repeat(40);
if (process.argv[2] === "worker") {
  const [root, port, mode] = process.argv.slice(3);
  const snapshot = join(root, "snapshot.json");
  const record = JSON.parse(await readFile(snapshot, "utf8"));
  const service = new DirectDownloadService(
    { appDataPath: root },
    {
      findById: async () => record,
      update: async (_id, patch) => {
        Object.assign(record, patch);
        await writeFile(snapshot + ".tmp", JSON.stringify(record));
        await rename(snapshot + ".tmp", snapshot);
      },
    },
    { resolveConfig: async () => ({ networkProfile: { proxyUrl: "http://127.0.0.1:" + port } }) },
  );
  try {
    const started =
      mode === "resume"
        ? await service.resume(record)
        : !!(await service.add({
            downloadId: 1,
            indexerId: 1,
            clientKey: key,
            fileUrl: record.directUrl,
            fileName: record.directFileName,
            format: "cbz",
          }));
    if (!started) {
      process.send({ kind: "refused" });
    } else {
      const end = Date.now() + 20000;
      while (true) {
        const [s] = await service.status([key]);
        process.send({ kind: "progress", bytes: s?.downloadedBytes || 0 });
        if (s && ["completed", "failed"].includes(s.state)) {
          if (s.state === "completed") {
            const data = await readFile(s.contentPath);
            process.send({ kind: "terminal", state: s.state, bytes: data.length, sha256: digest(data) });
          } else {
            let exists = true;
            const cleanupDeadline = Date.now() + 10000;
            while (exists && Date.now() < cleanupDeadline) {
              try {
                await stat(join(directDownloadRoot(root), key));
                await delay(50);
              } catch (error) {
                if (error.code !== "ENOENT") throw error;
                exists = false;
              }
            }
            process.send({ kind: "terminal", state: s.state, cleaned: !exists, error: s.errorMessage });
          }
          break;
        }
        assert.ok(Date.now() < end, "Transfer did not settle");
        await delay(25);
      }
    }
  } finally {
    await service.remove(key, { deleteFiles: true });
    forgetDispatchers();
  }
  process.disconnect();
} else {
  const root = await mkdtemp(join(tmpdir(), "bookorbit-recovery-"));
  const payload = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 31) % 251;
  const expected = digest(payload);
  let phase = "";
  let requests = [];
  const children = new Set();
  const server = createServer((req, res) => {
    if (!req.url?.includes("example.com/fixture.cbz")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const offset = Number(/^bytes=(\d+)-$/.exec(req.headers.range || "")?.[1] || 0);
    requests.push({ range: offset, ifRange: req.headers["if-range"] || null });
    const changed = phase === "changed" && offset > 0;
    const badRange = phase === "bad-range" && offset > 0;
    const headers = {
      "content-type": "application/octet-stream",
      "content-length": payload.length - offset,
      etag: changed ? '"version-2"' : '"version-1"',
    };
    if (offset) headers["content-range"] = `bytes ${badRange ? offset + 1 : offset}-${payload.length - 1}/${payload.length}`;
    res.writeHead(offset ? 206 : 200, headers);
    let at = offset;
    const drop = phase === "drop" && requests.length === 1;
    const holdPartial = phase === "kill";
    const timer = setInterval(() => {
      if (holdPartial && at >= 262144) return;
      if (at >= payload.length) {
        clearInterval(timer);
        res.end();
        return;
      }
      const end = Math.min(at + 65536, payload.length);
      res.write(payload.subarray(at, end));
      at = end;
      if (drop && at >= 196608) {
        clearInterval(timer);
        res.destroy();
      }
    }, 15);
    res.on("close", () => clearInterval(timer));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  async function seed(name) {
    const dir = join(root, name);
    await (await import("node:fs/promises")).mkdir(dir);
    await writeFile(
      join(dir, "snapshot.json"),
      JSON.stringify({
        id: 1,
        indexerId: 1,
        source: "direct_url",
        clientKey: key,
        directUrl: "http://example.com/fixture.cbz",
        directFileName: "fixture.cbz",
        directEtag: null,
        directLastModified: null,
        totalBytes: null,
      }),
    );
    return dir;
  }
  async function run(dir, mode, kill = false) {
    const child = fork(self, ["worker", dir, String(port), mode], { stdio: ["ignore", "pipe", "pipe", "ipc"], env: process.env });
    children.add(child);
    let result,
      logs = "",
      killed = false;
    child.stdout.on("data", (d) => (logs += d));
    child.stderr.on("data", (d) => (logs += d));
    let checkingDisk = false;
    child.on("message", async (m) => {
      if (m.kind === "terminal" || m.kind === "refused") result = m;
      if (kill && !killed && !checkingDisk && m.kind === "progress" && m.bytes >= 131072) {
        checkingDisk = true;
        try {
          const bytes = (await stat(join(directDownloadRoot(dir), key, "fixture.cbz"))).size;
          if (!killed && bytes >= 65536 && bytes < payload.length) {
            killed = true;
            child.kill("SIGKILL");
          }
        } catch (error) {
          if (error.code !== "ENOENT") child.kill("SIGKILL");
        } finally {
          checkingDisk = false;
        }
      }
    });
    const [code, signal] = await once(child, "exit");
    children.delete(child);
    if (kill) {
      assert.equal(signal, "SIGKILL");
      const record = JSON.parse(await readFile(join(dir, "snapshot.json"), "utf8"));
      assert.equal(record.directEtag, '"version-1"');
      const partial = (await stat(join(directDownloadRoot(dir), key, "fixture.cbz"))).size;
      assert.ok(partial > 0 && partial < payload.length);
      return partial;
    }
    assert.equal(code, 0, logs);
    assert.ok(result, logs);
    return result;
  }
  const checks = [];
  try {
    phase = "drop";
    requests = [];
    let dir = await seed("drop");
    let result = await run(dir, "add");
    assert.equal(result.state, "completed");
    assert.equal(result.sha256, expected);
    assert.ok(requests.some((r) => r.range > 0 && r.ifRange === '"version-1"'));
    checks.push("socket-reset-retry-exact-range");
    for (const mode of ["restart", "changed", "bad-range", "no-validator"]) {
      phase = "kill";
      requests = [];
      dir = await seed(mode);
      const partial = await run(dir, "add", true);
      if (mode === "no-validator") {
        const file = join(dir, "snapshot.json");
        const record = JSON.parse(await readFile(file, "utf8"));
        record.directEtag = null;
        await writeFile(file, JSON.stringify(record));
      }
      phase = mode;
      requests = [];
      result = await run(dir, "resume");
      if (mode === "restart") {
        assert.equal(result.state, "completed");
        assert.equal(result.sha256, expected);
        assert.equal(requests[0].range, partial);
        checks.push("sigkill-new-process-resume-hash-identical");
      } else if (mode === "no-validator") {
        assert.equal(result.kind, "refused");
        assert.equal(requests.length, 0);
        checks.push("unvalidated-partial-refused");
      } else {
        assert.equal(result.state, "failed");
        assert.equal(result.cleaned, true, mode + " failure staging was not cleaned");
        checks.push(mode + "-rejected-and-cleaned");
      }
    }
    console.log(JSON.stringify({ check: "compiled-direct-download-recovery", payloadBytes: payload.length, checks, passed: true }));
  } finally {
    for (const child of children) child.kill("SIGKILL");
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
    forgetDispatchers();
  }
}
