const { chromium } = require(process.env.BOOKORBIT_PLAYWRIGHT_MODULE || "@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const base = process.argv[2];
if (!base) throw new Error("Provide a base URL; all API calls use synthetic fixtures");
const url = new URL(base);
if (url.username || url.password) throw new Error("Do not provide credentials");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9224");
  const c = await b.newContext({ serviceWorkers: "block" });
  await c.route("**/socket.io/**", (r) => r.abort());
  const p = await c.newPage();
  const issues = [];
  p.on("pageerror", (e) => issues.push(e.message));
  const meta = fs.readFileSync(path.resolve(__dirname, "../../../client/src/features/statistics/statistics-chart-meta.ts"), "utf8");
  const ids = [...meta.matchAll(/^  '([^']+)': \{/gm)].map((m) => m[1]);
  await p.route("**/api/v1/**", async (route) => {
    const u = new URL(route.request().url());
    let data = [];
    if (u.pathname.endsWith("/auth/refresh")) data = { accessToken: "local-fixture-only" };
    else if (u.pathname.endsWith("/auth/setup-status")) data = { needsSetup: false, allowRegistration: false };
    else if (u.pathname.endsWith("/auth/me"))
      data = {
        id: 1,
        username: "isolated-browser-fixture",
        isSuperuser: true,
        permissions: [],
        settings: {
          onboarding: { tourCompleted: true },
          statisticsConfig: {
            charts: ids.map((id, order) => ({ id, order, visible: ["library-metadata-completeness", "library-integrity-gauge"].includes(id) })),
          },
        },
      };
    else if (u.pathname.endsWith("/user-preferences/locale")) data = { settings: { locale: "zh" } };
    else if (u.pathname.endsWith("/statistics/library-metadata-completeness"))
      data = {
        unknownCount: 0,
        items: [
          "Title",
          "Cover",
          "Author",
          "Genres",
          "Tags",
          "Description",
          "Publisher",
          "Year",
          "Language",
          "Page Count",
          "Rating",
          "Series",
          "ISBN",
        ].map((field) => ({ libraryName: "测试书库", field, percent: 50, presentCount: 1, totalCount: 2 })),
      };
    else if (u.pathname.endsWith("/statistics/library-integrity-gauge"))
      data = { totalBooks: 2, presentCount: 2, primaryFileCount: 2, metadataCount: 2, integrityScore: 100 };
    else if (u.pathname.endsWith("/statistics/summary"))
      data = {
        totalBooks: 2,
        totalFiles: 2,
        totalStorageBytes: 2000,
        totalPublishers: 1,
        totalLanguages: 1,
        booksAddedThisYear: 2,
        publicationYearMin: 2020,
        publicationYearMax: 2026,
        totalAuthors: 1,
        totalSeries: 1,
        totalGenres: 1,
        totalPages: 200,
        oldestYear: 2020,
        newestYear: 2026,
      };
    else if (u.pathname.endsWith("/auth/login-options")) data = { localAuthEnabled: true, oidcProviders: [] };
    else if (u.pathname.includes("/browse-counts")) data = {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await p.goto(base.replace(/\/$/, "") + "/statistics", { waitUntil: "domcontentloaded" });
  await p.getByRole("button", { name: "配置", exact: true }).click({ timeout: 30000 });
  const heatmap = p.locator("svg").filter({ hasText: "测试书库" }).first();
  const heatmapText = await heatmap.textContent();
  for (const label of ["书名", "封面", "作者", "类型", "标签", "简介", "出版社", "年份", "语言", "页数", "评分", "丛书", "ISBN"]) {
    if (!heatmapText.includes(label)) throw new Error("Missing heatmap field: " + label);
  }
  if (/Page Count|Description|Publisher/.test(heatmapText)) throw new Error("English heatmap field remains");
  if (issues.length) throw new Error("Browser page errors: " + issues.join("; "));
  const rendered = await p.locator("body").innerText();
  for (const label of ["元数据新鲜度", "入库延迟", "格式分布", "页数分布"])
    if (!rendered.includes(label)) throw new Error("Missing localized chart label: " + label);
  if (/Library Integrity|Format Distribution|Page Count Distribution/.test(rendered)) throw new Error("English configuration label remains");
  console.log(
    JSON.stringify({
      url: p.url(),
      configurationLabelsPassed: true,
      heatmapFieldsPassed: true,
      syntheticApiFixtures: true,
      productionAccountUsed: false,
      text: (await p.locator("body").innerText()).slice(-4000),
      pageErrors: issues,
    }),
  );
  if (process.env.BOOKORBIT_SCREENSHOT) await p.screenshot({ path: process.env.BOOKORBIT_SCREENSHOT, fullPage: true });
  await c.close();
  process.exit(0);
})().catch((e) => {
  console.log(JSON.stringify({ error: e.name, message: e.message.slice(0, 900) }));
  process.exit(1);
});
