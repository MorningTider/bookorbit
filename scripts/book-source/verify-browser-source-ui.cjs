const assert = require("node:assert/strict");
assert.equal(process.env.BOOKORBIT_VERIFY_ISOLATED, "1", "Explicit isolated verification required");
const base = new URL(process.env.BOOKORBIT_VERIFY_BASE_URL);
assert.equal(base.port, "18184", "Refuse the production port");
assert.ok(["http:", "https:"].includes(base.protocol));
const { chromium } = require(process.env.BOOKORBIT_PLAYWRIGHT_MODULE);
const fs = require("node:fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BOOKORBIT_CHROMIUM_EXECUTABLE,
  });
  try {
    const page = await browser.newPage();
    await page.goto(base.href);
    await page.locator("#username").waitFor({ timeout: 45000 });
    const credentials = JSON.parse(fs.readFileSync(process.env.BOOKORBIT_VERIFY_CREDENTIALS_FILE, "utf8"));
    await page.locator("#username").fill(credentials.username);
    await page.locator("input[type=password]").fill(credentials.password);
    await page.locator("button[type=submit]").click();
    await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 45000 });
    let failRules = true;
    await page.route("**/api/v1/book-sources/chapter-rules", async (route) => {
      if (failRules && route.request().method() === "GET") {
        failRules = false;
        return route.fulfill({ status: 503, json: { message: "isolated-browser-test-unavailable" } });
      }
      return route.continue();
    });
    let holdNext = false,
      held = null,
      cancelled = false;
    const job = (id, status = "queued") => ({
      id,
      libraryId: 1,
      sourceBookId: "browser-fixture-" + id,
      title: "浏览器并发验收" + id,
      status,
      retryable: true,
      attempts: 0,
      cancelRequested: false,
      resultBookId: null,
      error: null,
      createdAt: "2026-10-25T00:00:00Z",
      updatedAt: "2026-10-25T00:00:00Z",
    });
    await page.route("**/api/v1/book-sources/jobs**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/800/cancel")) {
        cancelled = true;
        return route.fulfill({ json: job(800, "cancelled") });
      }
      const older = url.searchParams.has("cursor");
      const data = {
        items: older ? [job(800, cancelled ? "cancelled" : "queued")] : [job(900), { ...job(901, "failed"), source: "removed" }],
        nextCursor: older ? null : 900,
      };
      if (holdNext) {
        holdNext = false;
        held = () => route.fulfill({ json: data });
        return;
      }
      return route.fulfill({ json: data });
    });
    await page.goto(new URL("/requests", base).href);
    await page.locator("#requests-tab-sources").click();
    await page.getByText("浏览器并发验收900", { exact: true }).waitFor();
    await page.getByText("管理公开章节书源", { exact: true }).click();
    const textarea = page.getByRole("textbox", { name: "章节书源 JSON 规则" });
    assert.equal(await textarea.isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "保存规则", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await textarea.waitFor();
    await page.waitForFunction(() => !document.querySelector("textarea").disabled);
    console.log("rules-load-failure-save-blocked-and-retry: passed");
    const removed = page.locator("li").filter({ hasText: "浏览器并发验收901" });
    assert.equal(await removed.getByRole("button", { name: "重试下载" }).isDisabled(), true);
    holdNext = true;
    for (let i = 0; i < 120 && !held; i++) await sleep(100);
    assert.ok(held, "poll must be in flight");
    await page.getByRole("button", { name: "更早任务", exact: true }).click();
    let release = held;
    held = null;
    await release();
    await page.getByText("浏览器并发验收800", { exact: true }).waitFor();
    assert.equal(await page.getByText("浏览器并发验收900", { exact: true }).count(), 0);
    console.log("pagination-during-poll-without-reload: passed");
    holdNext = true;
    for (let i = 0; i < 120 && !held; i++) await sleep(100);
    assert.ok(held);
    await page.getByRole("button", { name: "取消任务", exact: true }).click();
    for (let i = 0; i < 100 && !cancelled; i++) await sleep(50);
    assert.ok(cancelled);
    release = held;
    held = null;
    await release();
    await page.getByText("已取消", { exact: true }).waitFor();
    console.log("cancel-during-poll-without-reload: passed");
    console.log("removed-source-retry-disabled: passed");
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(300);
    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(width.content <= width.viewport, JSON.stringify(width));
    console.log("mobile-390-layout: passed");
    await page.unroute("**/api/v1/book-sources/jobs**");
    await page.goto(new URL("/requests", base).href);
    await page.locator("#requests-tab-sources").click();
    await page.getByText("后台下载任务", { exact: true }).first().waitFor();
    console.log("real-isolated-task-list: passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
