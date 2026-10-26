const assert = require("node:assert/strict");
assert.equal(process.env.BOOKORBIT_VERIFY_ISOLATED, "1");
const origin = new URL(process.env.BOOKORBIT_VERIFY_BASE_URL).origin;
assert.equal(new URL(origin).port, "18184", "Refuse production");
const fs = require("node:fs");
const path = require("node:path");
const fixtureIds = JSON.parse(process.env.BOOKORBIT_VERIFY_FORMAT_BOOK_IDS);
const { createHash } = require("node:crypto");
const { chromium } = require(process.env.BOOKORBIT_PLAYWRIGHT_MODULE);

const hash = (b) => createHash("sha256").update(b).digest("hex");
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BOOKORBIT_CHROMIUM_EXECUTABLE });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(origin);
    await page.locator("#username").waitFor({ timeout: 45000 });
    const credentials = JSON.parse(fs.readFileSync(process.env.BOOKORBIT_VERIFY_CREDENTIALS_FILE, "utf8"));
    await page.locator("#username").fill(credentials.username);
    await page.locator("#password").fill(credentials.password);
    const logged = page.waitForResponse((r) => r.url().endsWith("/api/v1/auth/login") && r.status() === 200);
    await page.locator("button[type=submit]").click();
    const token = (await (await logged).json()).accessToken;
    await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 45000 });
    const headers = { Authorization: "Bearer " + token };
    const base = origin + "/api/v1";
    const libs = await (await page.request.get(base + "/libraries", { headers })).json();
    const library = libs.find((x) => x.name === "定制功能隔离验收");
    assert.ok(library);

    for (const format of ["mobi", "azw3", "fb2"]) {
      assert.ok(fs.statSync(path.join(process.env.BOOKORBIT_VERIFY_SAMPLES_DIR, "bookorbit-format-sample." + format)).size <= 20 * 1024 * 1024);
      const bytes = fs.readFileSync(path.join(process.env.BOOKORBIT_VERIFY_SAMPLES_DIR, "bookorbit-format-sample." + format));
      const bookId = fixtureIds[format];
      assert.ok(Number.isSafeInteger(bookId) && bookId > 0);
      const book = await (await page.request.get(base + "/books/" + bookId, { headers })).json();
      assert.equal(book.libraryId, library.id, "Only isolated fixture library is allowed");
      const file = book.files.find((f) => f.format === format);
      assert.ok(file);
      console.log("selected-file", JSON.stringify({ bookId, format, role: file.role }));
      await page.goto(origin + "/book/" + bookId);
      await page.getByRole("button", { name: "阅读", exact: true }).first().waitFor();
      if (file.role !== "primary" && book.files.length > 1) {
        await page.getByTitle("选择格式", { exact: true }).first().click();
        await page
          .getByRole("button", { name: new RegExp(format.toUpperCase()) })
          .filter({ visible: true })
          .first()
          .click();
      } else {
        await page.getByRole("button", { name: "阅读", exact: true }).first().click();
      }
      await page.waitForURL((url) => url.pathname.startsWith("/read/"), { timeout: 45000 });
      assert.equal(new URL(page.url()).searchParams.get("format"), format);
      await page.waitForFunction(
        () => {
          const v = document.querySelector("foliate-view");
          return v?.book?.sections?.length > 0 && v?.renderer?.getContents?.().length > 0;
        },
        {},
        { timeout: 60000 },
      );
      await page.evaluate(async () => {
        const v = document.querySelector("foliate-view");
        const flatten = (items) => items.flatMap((x) => [x, ...flatten(x.subitems || [])]);
        const chapter = flatten(v.book.toc || []).find((x) => /CHAPTER|第一章|开始/i.test(x.label || ""));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await v.goTo(chapter?.href ?? Math.min(1, v.book.sections.length - 1));
      });
      await page.waitForFunction(
        (kind) => {
          const v = document.querySelector("foliate-view");
          const text =
            v?.renderer
              ?.getContents?.()
              .map((c) => c.doc?.body?.textContent || "")
              .join("") || "";
          return kind === "fb2" ? text.includes("FB2真实阅读验收正文") : /Alice|Rabbit|CHAPTER/i.test(text);
        },
        format,
        { timeout: 45000 },
      );
      const downloaded = await page.request.get(base + `/books/files/${file.id}/download`, { headers });
      assert.ok(downloaded.ok());
      assert.equal(hash(await downloaded.body()), hash(bytes));
      console.log(JSON.stringify({ check: "mainstream-format-upload-reader-navigation-original-preserved", format, bookId, passed: true }));
      await page.goto(origin + "/library/" + library.id);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
