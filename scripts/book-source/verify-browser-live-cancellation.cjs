const fs = require("node:fs");
const assert = require("node:assert/strict");
assert.equal(process.env.BOOKORBIT_VERIFY_ISOLATED, "1");
const { chromium } = require(process.env.BOOKORBIT_PLAYWRIGHT_MODULE);
const target = new URL(process.env.BOOKORBIT_VERIFY_BASE_URL);
assert.equal(target.port, "18184");
assert.ok(["http:", "https:"].includes(target.protocol));
const base = target.origin;
const fixtureName = process.env.BOOKORBIT_VERIFY_CANCEL_LIBRARY_NAME;
const fixtureFolder = process.env.BOOKORBIT_VERIFY_CANCEL_LIBRARY_FOLDER;
assert.ok(fixtureName?.startsWith("下载取消隔离验收-"));
assert.ok(fixtureFolder?.startsWith("/books/cancellation-"));
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BOOKORBIT_CHROMIUM_EXECUTABLE });
  let api, job;
  try {
    const page = await browser.newPage();
    await page.goto(base);
    await page.locator("#username").waitFor({ timeout: 45000 });
    const c = JSON.parse(fs.readFileSync(process.env.BOOKORBIT_VERIFY_CREDENTIALS_FILE));
    await page.locator("#username").fill(c.username);
    await page.locator("#password").fill(c.password);
    const login = page.waitForResponse((r) => r.url().endsWith("/auth/login") && r.ok());
    await page.locator("button[type=submit]").click();
    const token = (await (await login).json()).accessToken;
    api = async (path, body) => {
      const r = await page.request.fetch(base + "/api/v1" + path, {
        method: body ? "POST" : "GET",
        headers: { Authorization: "Bearer " + token },
        ...(body ? { data: body } : {}),
      });
      assert.ok(r.ok(), path + " HTTP " + r.status());
      return r.status() === 204 ? null : r.json();
    };
    const libs = await api("/libraries");
    let lib = libs.find((x) => x.name === fixtureName);
    if (!lib) lib = await api("/libraries", { name: fixtureName, icon: "book-open", folders: [fixtureFolder], watch: false });
    assert.notEqual(lib.id, 1);
    const jobs = await api("/book-sources/jobs");
    assert.ok(!jobs.items.some((x) => x.libraryId === lib.id), "Use a fresh isolated fixture");
    assert.ok(!jobs.items.some((x) => ["queued", "downloading", "importing"].includes(x.status)), "Isolated queue must be idle");
    const existing = jobs.items.find((x) => x.status === "completed" && (!x.source || x.source === "fanqie"));
    assert.ok(existing, "Requires previously verified completed Fanqie fixture");
    job = await api("/libraries/" + lib.id + "/sources/fanqie", { bookId: existing.sourceBookId });
    assert.equal(job.libraryId, lib.id);
    console.log(JSON.stringify({ phase: "submitted", id: job.id, libraryId: lib.id }));
    await page.goto(base + "/requests");
    await page.locator("#requests-tab-sources").click();
    const panel = page.locator('section[aria-label="小说书源"]');
    const row = panel
      .locator("li")
      .filter({ has: page.getByRole("button", { name: "取消任务", exact: true }) })
      .first();
    await row.getByRole("button", { name: "取消任务", exact: true }).click();
    async function waitStatus(allowed) {
      for (let i = 0; i < 80; i++) {
        const j = await api("/book-sources/jobs/" + job.id);
        if (allowed.includes(j.status)) return j;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw Error("Timed out waiting for " + allowed);
    }
    let state = await waitStatus(["cancelled"]);
    assert.equal(state.resultBookId, null);
    console.log("live-cancel-no-import: passed");
    await page.reload();
    await panel.getByText("已取消", { exact: true }).waitFor({ timeout: 30000 });
    const cancelled = panel
      .locator("li")
      .filter({ hasText: "已取消" })
      .filter({ has: page.getByRole("button", { name: "重试下载", exact: true }) })
      .first();
    await cancelled.getByRole("button", { name: "重试下载", exact: true }).click();
    state = await waitStatus(["downloading"]);
    console.log(JSON.stringify({ phase: "retry-downloading", attempts: state.attempts }));
    const active = panel
      .locator("li")
      .filter({ has: page.getByRole("button", { name: "取消任务", exact: true }) })
      .first();
    await active.getByRole("button", { name: "取消任务", exact: true }).click();
    state = await waitStatus(["cancelled"]);
    assert.equal(state.resultBookId, null);
    await page.reload();
    await panel.getByText("已取消", { exact: true }).waitFor({ timeout: 30000 });
    const restored = await api("/book-sources/jobs/" + job.id);
    assert.equal(restored.status, "cancelled");
    assert.equal(restored.resultBookId, null);
    console.log(
      JSON.stringify({
        check: "live-fanqie-ui-cancel-retry-cancel-reload",
        jobId: job.id,
        libraryId: lib.id,
        attempts: restored.attempts,
        passed: true,
      }),
    );
  } finally {
    if (api && job) {
      try {
        const j = await api("/book-sources/jobs/" + job.id);
        if (["queued", "downloading"].includes(j.status)) await api("/book-sources/jobs/" + job.id + "/cancel", {});
      } catch {
        console.error("fixture cleanup requires inspection");
      }
    }
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
