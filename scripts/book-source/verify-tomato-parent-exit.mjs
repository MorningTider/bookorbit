import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const binary = process.env.TOMATO_DOWNLOADER_PATH;
const bookId = process.env.BOOK_SOURCE_E2E_BOOK_ID;
assert.equal(process.platform, "linux");
assert.ok(binary && /^\d{10,25}$/.test(bookId ?? ""));
const root = await mkdtemp(join(tmpdir(), "bookorbit-parent-exit-"));
const modulePath = fileURLToPath(new URL("../../server/dist/modules/book-source/tomato-runtime.service.js", import.meta.url));
const code = `const {TomatoRuntimeService}=require(process.argv[1]);new TomatoRuntimeService({tomatoBinaryPath:process.argv[2],timeoutMs:120000},{appDataPath:process.argv[3]}).download(process.argv[4],new AbortController().signal).catch(()=>{process.exitCode=1})`;
const parent = spawn(process.execPath, ["-e", code, modulePath, binary, root, bookId], { stdio: "ignore" });
async function commands() {
  const output = [];
  for (const pid of (await readdir("/proc")).filter((value) => /^\d+$/.test(value))) {
    const command = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
    if (command.includes(binary) && command.includes(root)) output.push(command);
  }
  return output;
}
try {
  let started = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await commands()).some((command) => command.split("\0")[0] === binary)) {
      started = true;
      break;
    }
    if (parent.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(started, "Pinned downloader must start before simulating a crash");
  const exited = once(parent, "exit");
  parent.kill("SIGKILL");
  await exited;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!(await commands()).length) break;
    await delay(100);
  }
  assert.equal((await commands()).length, 0, "Guard and downloader must exit after the application crashes");
  console.log(JSON.stringify({ parentCrash: true, guardExited: true, downloaderExited: true }));
} finally {
  if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL");
  await rm(root, { recursive: true, force: true });
}
