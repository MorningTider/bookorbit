const { chromium } = require(process.env.BOOKORBIT_PLAYWRIGHT_MODULE || "@playwright/test");
const base = process.argv[2];
if (!base) throw new Error("Provide a base URL; API responses use synthetic fixtures");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9224");
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1600, height: 1200 } });
  await context.route("**/socket.io/**", (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const config = Object.fromEntries(
    [
      "baiduBaike",
      "qimao",
      "qidian",
      "fanqie",
      "douban",
      "google",
      "amazon",
      "goodreads",
      "hardcover",
      "openLibrary",
      "itunes",
      "audible",
      "audnexus",
      "librofm",
      "comicvine",
      "ranobedb",
      "kobo",
      "lubimyczytac",
      "aladin",
    ].map((key) => [key, { enabled: ["baiduBaike", "qimao", "qidian", "fanqie", "douban", "lubimyczytac"].includes(key) }]),
  );
  Object.assign(config.google, { apiKey: "" });
  Object.assign(config.amazon, { domain: "amazon.com", cookie: "" });
  Object.assign(config.hardcover, { apiKey: "" });
  Object.assign(config.itunes, { coverResolution: "high" });
  Object.assign(config.audible, { domain: "audible.com" });
  Object.assign(config.comicvine, { apiKey: "" });
  Object.assign(config.kobo, { country: "us", language: "en" });
  Object.assign(config.aladin, { ttbKey: "" });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data = [];
    if (path.endsWith("/auth/refresh")) data = { accessToken: "synthetic-browser-only" };
    else if (path.endsWith("/auth/me"))
      data = { id: 1, username: "synthetic-preview", isSuperuser: true, permissions: [], settings: { onboarding: { tourCompleted: true } } };
    else if (path.endsWith("/auth/setup-status")) data = { needsSetup: false, allowRegistration: false };
    else if (path.endsWith("/user-preferences/locale")) data = { settings: { locale: "zh" } };
    else if (path.endsWith("/metadata-preferences/providers"))
      data = {
        config,
        statuses: Object.entries(config).map(([key, value]) => ({ key, label: key, enabled: value.enabled, configured: key !== "aladin" })),
      };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto(base.replace(/\/$/, "") + "/settings/metadata/providers", { waitUntil: "domcontentloaded" });
  await page.getByText("百度百科", { exact: true }).waitFor({ timeout: 30000 });
  const names = ["baiduBaike.ico", "qimao.ico", "qidian.ico", "fanqie.png", "douban.ico"];
  for (const name of names) {
    const icon = page.locator(`img[src$="/${name}"]`).first();
    await icon.waitFor();
    await icon.evaluate((image) => image.decode());
    if (!(await icon.evaluate((image) => image.naturalWidth > 0))) throw new Error("Icon failed: " + name);
  }
  const text = await page.locator("body").innerText();
  const locale = require("../../../client/src/locales/zh.json");
  function findHints(value) {
    if (!value || typeof value !== "object") return null;
    if (value.hints?.baiduBaike) return value.hints;
    for (const child of Object.values(value)) {
      const found = findHints(child);
      if (found) return found;
    }
    return null;
  }
  const hints = findHints(locale);
  if (!hints || Object.keys(hints).length !== 19) throw new Error("Expected 19 provider descriptions");
  for (const phrase of Object.values(hints)) if (!text.includes(phrase)) throw new Error("Missing description: " + phrase);
  if (text.includes("Polish book catalog") || text.includes("不提供付费正文下载")) throw new Error("Old regional description remains");
  if (errors.length) throw new Error(errors.join("; "));
  await page.getByText("Aladin", { exact: true }).first().scrollIntoViewIfNeeded();
  if (process.env.BOOKORBIT_SCREENSHOT) await page.screenshot({ path: process.env.BOOKORBIT_SCREENSHOT });
  console.log(
    JSON.stringify({
      passed: true,
      iconsLoaded: names,
      regionalDescriptionsPassed: true,
      descriptionsChecked: Object.keys(hints).length,
      syntheticApiFixtures: true,
      productionAccountUsed: false,
      pageErrors: errors,
    }),
  );
  await context.close();
  process.exit(0);
})().catch((error) => {
  console.log(JSON.stringify({ passed: false, error: error.name, message: error.message.slice(0, 1000) }));
  process.exit(1);
});
