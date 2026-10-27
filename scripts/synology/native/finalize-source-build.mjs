import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(process.argv[2]);
const app = path.join(root, "app");
const require = createRequire(path.join(app, "package.json"));
if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("Native application assets must be built on Linux x86_64");
}
const sharp = require("sharp");
const image = await sharp({
  create: { width: 16, height: 12, channels: 3, background: "#336699" },
})
  .png()
  .toBuffer();
const metadata = await sharp(image).metadata();
if (metadata.width !== 16 || metadata.height !== 12) throw new Error("Sharp native check failed");
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
      if (path.relative(app, file) === "node_modules/.pnpm/node_modules/server" && link === "../../../../app/server" && !fs.existsSync(file)) {
        fs.unlinkSync(file);
        excluded.push(path.relative(app, file));
        continue;
      }
      const resolved = fs.realpathSync(file);
      const relative = path.relative(app, resolved);
      if (path.isAbsolute(link) || relative === ".." || relative.startsWith("../")) {
        throw new Error("Non-relocatable dependency link");
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
  excludedDevelopmentFiles: excluded.sort(),
});
fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
