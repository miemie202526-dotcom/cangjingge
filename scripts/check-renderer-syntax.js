/**
 * 对 electron/renderer 下全部 .js 执行 node --check（ESM 与 CJS 均可语法检查）。
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const rendererRoot = path.join(root, "electron", "renderer");

function walkJs(dir) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkJs(p));
    else if (ent.isFile() && ent.name.endsWith(".js")) out.push(p);
  }
  return out;
}

const files = walkJs(rendererRoot);
if (!files.length) {
  console.error("[check-renderer-syntax] no files under", rendererRoot);
  process.exit(1);
}
for (const f of files) {
  try {
    execSync(`node --check "${f}"`, { stdio: "inherit", cwd: root });
  } catch {
    process.exit(1);
  }
}
console.log("[check-renderer-syntax]", files.length, "files OK");
