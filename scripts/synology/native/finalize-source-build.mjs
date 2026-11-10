import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(process.argv[2]);
const app = path.join(root, "app");
const require = createRequire(path.join(app, "package.json"));
if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("Native application assets must be built on Linux x86_64");
}
const workspacePackagesChecked = ["@bookorbit/types", "@bookorbit/plugin-api"];
for (const name of workspacePackagesChecked) {
  const relative = path.relative(app, fs.realpathSync(require.resolve(name)));
  if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`Workspace package is outside the deploy tree: ${name}`);
  }
  require(name);
}
const sharp = require("sharp");
const image = await sharp({
  create: { width: 16, height: 12, channels: 3, background: "#336699" },
})
  .png()
  .toBuffer();
const metadata = await sharp(image).metadata();
if (metadata.width !== 16 || metadata.height !== 12) throw new Error("Sharp native check failed");
const serverTextLocalesChecked = ["en", "zh"];
const localizedText = require("./dist/common/i18n/server-text.js");
const challengeKey = "monthlyChallenge.streak-builder.title";
for (const locale of serverTextLocalesChecked) {
  const catalog = JSON.parse(fs.readFileSync(path.join(app, "locales", `${locale}.json`), "utf8"));
  const expected = catalog.serverText?.monthlyChallenge?.["streak-builder"]?.title;
  if (typeof expected !== "string" || expected.length === 0 || localizedText.serverText(locale, challengeKey, "Streak Builder") !== expected) {
    throw new Error(`Server text locale runtime check failed: ${locale}`);
  }
}
const excluded = [];
const sample = path.join(app, ".env.example");
if (fs.existsSync(sample) && !fs.lstatSync(sample).isSymbolicLink()) {
  fs.unlinkSync(sample);
  excluded.push(".env.example");
}
function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const link = fs.readlinkSync(file);
      if (
        path.relative(app, file) === "node_modules/.pnpm/node_modules/server" &&
        ["../../../../app/server", "../../../../source/server"].includes(link) &&
        !fs.existsSync(file)
      ) {
        fs.unlinkSync(file);
        excluded.push(path.relative(app, file));
        continue;
      }
      const resolved = fs.realpathSync(file);
      const relative = path.relative(app, resolved);
      if (path.isAbsolute(link) || relative === ".." || relative.startsWith("../")) {
        throw new Error(`Non-relocatable dependency link: ${path.relative(app, file)} -> ${link}`);
      }
    } else if (entry.isDirectory()) {
      inspect(file);
    } else if (entry.name === "settings.json" && path.basename(directory) === ".vscode") {
      fs.unlinkSync(file);
      excluded.push(path.relative(app, file));
    } else if (entry.name === ".env" || entry.name.startsWith(".env.") || ["credentials.json", "id_rsa", "id_ed25519"].includes(entry.name)) {
      throw new Error("Private configuration is forbidden in build output");
    }
  }
}
inspect(app);
const file = path.join(root, "source-build.json");
const report = JSON.parse(fs.readFileSync(file, "utf8"));
Object.assign(report, {
  nodeVersion: process.version,
  sharpVersion: sharp.versions.sharp,
  sharpNativeCheck: true,
  workspacePackagesChecked,
  serverTextLocalesChecked,
  excludedDevelopmentFiles: excluded.sort(),
});
fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
