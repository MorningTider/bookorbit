const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const { parse } = createRequire(path.join(root, "client/package.json"))("vue/compiler-sfc");
const technicalLabels = new Set([
  "Book",
  "Orbit",
  "Lucide",
  "ISBN",
  "ISBN-13",
  "ISBN-10",
  "CSV",
  "JSON",
  "Markdown",
  "UTF-8",
  "GB18030 / GBK",
  "UTF-16 LE",
  "UTF-16 BE",
  "DuckDuckGo",
  "iTunes",
  "AudiobookCovers",
  "convert",
  "Hardcover",
  "BookOrbit",
  "booklore",
  "Keycloak",
  "keycloak",
  "KOReader",
  "BOOK_DOCK_PATH",
  "bookorbit.koplugin",
  "bookorbit:custom:",
  "custom.",
  "_storygraph_session",
  "remember_user_token",
  "token:",
  "userinfo:",
  "jwks:",
  "pkce:",
  "scopes:",
  "backchannel logout:",
]);
function technical(text) {
  return (
    technicalLabels.has(text) ||
    /^(?:https?:\/\/|magnet:|[/.@])/.test(text) ||
    /^[\w.-]+\.[a-z]{2,}(?:[/:]|$)/i.test(text) ||
    /^[\w.+-]+@[\w.-]+$/.test(text) ||
    text === "koreader/plugins/"
  );
}
const findings = [];
let templates = 0;
function inspect(directory) {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    if (fs.statSync(file).isDirectory()) {
      inspect(file);
      continue;
    }
    if (!file.endsWith(".vue")) continue;
    const { descriptor, errors } = parse(fs.readFileSync(file, "utf8"));
    if (errors.length) throw new Error("Invalid Vue component: " + path.relative(root, file));
    if (!descriptor.template) continue;
    templates++;
    function check(text, location, attribute) {
      text = text.trim().replace(/\s+/g, " ");
      if (/[A-Za-z]{3}/.test(text) && !technical(text))
        findings.push({ file: path.relative(root, file), line: location.start.line, attribute, text });
    }
    function visit(node) {
      if (node.type === 2) check(node.content, node.loc);
      if (node.type === 1)
        for (const prop of node.props || []) {
          if (prop.type === 6 && ["title", "placeholder", "aria-label", "alt"].includes(prop.name) && prop.value)
            check(prop.value.content, prop.loc, prop.name);
        }
      for (const child of node.children || []) visit(child);
    }
    visit(descriptor.template.ast);
  }
}
function flatten(value, prefix = "", result = new Set()) {
  for (const [key, item] of Object.entries(value)) {
    const full = prefix ? prefix + "." + key : key;
    if (typeof item === "string") result.add(full);
    else flatten(item, full, result);
  }
  return result;
}
inspect(path.join(root, "client/src"));
const en = flatten(JSON.parse(fs.readFileSync(path.join(root, "client/src/locales/en.json"), "utf8")));
const zh = flatten(JSON.parse(fs.readFileSync(path.join(root, "client/src/locales/zh.json"), "utf8")));
const missingChineseKeys = [...en].filter((key) => !zh.has(key));

const ts = createRequire(path.join(root, "client/package.json"))("typescript");
const scriptUiCandidates = [];
function inspectScripts(directory) {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    if (fs.statSync(file).isDirectory()) {
      if (!["__tests__", "test", "locales"].includes(name)) inspectScripts(file);
      continue;
    }
    if (!/\.(ts|vue)$/.test(name) || /\.(test|spec)\.ts$/.test(name)) continue;
    const raw = fs.readFileSync(file, "utf8");
    const descriptor = name.endsWith(".vue") ? parse(raw).descriptor : null;
    const source = descriptor ? [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join("\n") : raw;
    const ast = ts.createSourceFile(file + ".ts", source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (
        ts.isPropertyAssignment(node) &&
        ["label", "title", "header", "description", "placeholder", "message"].includes(node.name.getText(ast)) &&
        ts.isStringLiteralLike(node.initializer)
      ) {
        const text = node.initializer.text;
        if (/^[A-Z][A-Za-z ]{2,}$/.test(text) && !technical(text))
          scriptUiCandidates.push({ file: path.relative(root, file), property: node.name.getText(ast), text });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
}
inspectScripts(path.join(root, "client/src"));

console.log(
  JSON.stringify(
    { templates, unexpectedStaticEnglish: findings, missingChineseKeys, scriptUiCandidates, scriptCandidatesRequireConsumerReview: true },
    null,
    2,
  ),
);
if (findings.length || missingChineseKeys.length) process.exitCode = 1;
