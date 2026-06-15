const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pagesDir = path.join(root, "electron", "renderer", "pages");

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile() && p.endsWith(".js")) out.push(p);
  }
  return out;
}

function stripButtonMarkupWithId(src, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return src.replace(new RegExp(`<button[^>]*\\bid=["']${escaped}["'][\\s\\S]*?<\\/button>`, "g"), "");
}

const ignore = new Set([
  // Built inside temporary dialogs and wired immediately through the dialog node.
  "dgDiffClose",
  "dgDiffRefresh",
  "dgKbdClose",
  "bpClose",
  "bpSave",
  "bpClear",
  "phDialogCancel",
  "phDialogOk",
]);

const misses = [];
let total = 0;

for (const file of walk(pagesDir)) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  const re = /<button\b[^>]*\bid=["']([^"']+)["'][^>]*>/g;
  let match;
  while ((match = re.exec(src))) {
    const id = match[1];
    if (!id || ignore.has(id)) continue;
    total += 1;
    const withoutMarkup = stripButtonMarkupWithId(src, id);
    const patterns = [
      `#${id}`,
      `getElementById("${id}")`,
      `getElementById('${id}')`,
    ];
    const wired = patterns.some((p) => withoutMarkup.includes(p));
    if (!wired) misses.push(`${rel}: button #${id}`);
  }
}

if (misses.length) {
  console.error("[button-audit] buttons without obvious handlers:");
  for (const miss of misses) console.error(` - ${miss}`);
  process.exit(1);
}

console.log(`[button-audit] checked ${total} id buttons; all have obvious handlers`);
