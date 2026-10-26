const assert = require("node:assert/strict");
assert.equal(process.env.BOOKORBIT_VERIFY_ISOLATED, "1", "Explicit isolated verification required");
const origin = new URL(process.env.BOOKORBIT_VERIFY_BASE_URL).origin;
assert.equal(new URL(origin).port, "18184", "Refuse the production port");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { chromium } = require(process.env.BOOKORBIT_PLAYWRIGHT_MODULE);
const iconv = require(require.resolve("iconv-lite", { paths: [require("node:path").join(__dirname, "../../server")] }));
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
    const text =
      "第一章开始\n直接阅读验收正文<标签>&内容。" +
      "直接阅读验收正文。".repeat(50) +
      "\n第二章继续\n第二章直接阅读验收正文。" +
      "第二章直接阅读验收正文。".repeat(50);
    const cases = [
      ["utf8", Buffer.from(text)],
      ["gb18030", iconv.encode(text, "gb18030")],
      ["utf16le", Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, "utf16le")])],
      ["long", Buffer.from("正文😀".repeat(70000))],
    ];
    for (const [encoding, bytes] of cases) {
      const upload = await page.request.post(base + `/libraries/${library.id}/upload`, {
        headers,
        multipart: { file: { name: `TXT直接阅读-${encoding}-${Date.now()}.txt`, mimeType: "text/plain", buffer: bytes } },
        timeout: 120000,
      });
      assert.ok(upload.ok(), `Upload ${encoding}: ${upload.status()}`);
      const { bookId } = await upload.json();
      const before = await (await page.request.get(base + "/books/" + bookId, { headers })).json();
      const file = before.files.find((f) => f.format === "txt");
      assert.ok(file);
      assert.equal(before.files.filter((f) => f.format === "epub").length, 0);
      await page.goto(origin + "/book/" + bookId);
      await page.getByRole("button", { name: "阅读", exact: true }).first().click();
      await page.waitForURL((url) => url.pathname.startsWith("/read/"), { timeout: 45000 });
      assert.equal(new URL(page.url()).searchParams.get("format"), "txt");
      await page.waitForFunction(
        () => {
          const v = document.querySelector("foliate-view");
          return v?.book?.sections?.length > 0 && v?.renderer?.getContents?.().some((c) => (c.doc?.body?.textContent || "").trim().length > 20);
        },
        {},
        { timeout: 150000 },
      );
      const state = await page.evaluate(() => {
        const v = document.querySelector("foliate-view");
        return {
          sections: v.book.sections.length,
          toc: v.book.toc.map((x) => x.label),
          text: v.renderer
            .getContents()
            .map((c) => c.doc.body?.textContent || "")
            .join(""),
        };
      });
      if (encoding === "long") assert.ok(state.sections >= 3);
      else {
        assert.ok(state.toc.includes("第一章开始"));
        assert.ok(state.toc.includes("第二章继续"));
        assert.ok(state.text.includes("直接阅读验收正文"));
      }
      if (encoding === "utf8") {
        const saved = page.waitForResponse(
          (r) => {
            if (!r.url().endsWith(`/books/files/${file.id}/progress`) || r.request().method() !== "POST") return false;
            try {
              return r.request().postDataJSON().percentage > 0;
            } catch {
              return false;
            }
          },
          { timeout: 30000 },
        );
        await page.evaluate(async () => {
          const v = document.querySelector("foliate-view");
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          await v.goTo(1);
        });
        assert.ok((await saved).ok());
        const progress = await (await page.request.get(base + `/books/files/${file.id}/progress`, { headers })).json();
        assert.ok(progress.percentage > 0 && progress.cfi);
        await page.reload();
        await page.waitForFunction(
          () =>
            document
              .querySelector("foliate-view")
              ?.renderer?.getContents?.()
              .some((c) => c.index === 1),
          {},
          { timeout: 60000 },
        );
        console.log(JSON.stringify({ check: "txt-web-reading-progress-reload", bookId, passed: true }));
      }
      const after = await (await page.request.get(base + "/books/" + bookId, { headers })).json();
      assert.deepEqual(
        after.files.map((f) => ({ id: f.id, format: f.format, role: f.role })),
        before.files.map((f) => ({ id: f.id, format: f.format, role: f.role })),
      );
      const download = await page.request.get(base + `/books/files/${file.id}/download`, { headers });
      assert.ok(download.ok());
      assert.equal(hash(await download.body()), hash(bytes));
      console.log(
        JSON.stringify({ check: "txt-direct-reading-original-preserved-no-epub-import", encoding, bookId, sections: state.sections, passed: true }),
      );
      await page.goto(origin + "/library/" + library.id);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
