import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../server/package.json", import.meta.url));
const binary = process.env.TOMATO_DOWNLOADER_PATH;
const bookId = process.env.BOOK_SOURCE_E2E_BOOK_ID;
assert.equal(process.platform, "linux", "Run this check inside Linux with built server dependencies");
assert.ok(binary && /^\d{10,25}$/.test(bookId ?? ""), "Set TOMATO_DOWNLOADER_PATH and BOOK_SOURCE_E2E_BOOK_ID to a publicly available test book");
require("reflect-metadata");
const { TomatoRuntimeService } = require("./dist/modules/book-source/tomato-runtime.service.js");
const root = await mkdtemp(join(tmpdir(), "bookorbit-runtime-check-"));

async function assertClean(directory) {
  const files = await readdir(join(directory, "source-staging")).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  assert.equal(files.length, 0, "Download staging must be empty");
  for (const pid of (await readdir("/proc")).filter((name) => /^\d+$/.test(name))) {
    const command = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
    assert.ok(!(command.includes(binary) && command.includes(root)), "Downloader child must exit");
  }
}

try {
  for (const mode of ["success", "cancel", "timeout"]) {
    const directory = join(root, mode);
    const runtime = new TomatoRuntimeService({ tomatoBinaryPath: binary, timeoutMs: mode === "timeout" ? 250 : 120000 }, { appDataPath: directory });
    const controller = new AbortController();
    const timer = mode === "cancel" ? setTimeout(() => controller.abort(), 300) : undefined;
    try {
      if (mode === "success") {
        const result = await runtime.download(bookId, controller.signal);
        assert.ok(result.content.length > 0);
        assert.ok(result.title.length > 0);
        console.log(JSON.stringify({ mode, bytes: result.content.length }));
      } else {
        await assert.rejects(runtime.download(bookId, controller.signal), (error) => {
          assert.match(error.message, mode === "cancel" ? /已取消/ : /超时/);
          return true;
        });
      }
    } finally {
      clearTimeout(timer);
    }
    await assertClean(directory);
    console.log(JSON.stringify({ mode, stagingClean: true, childExited: true }));
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
