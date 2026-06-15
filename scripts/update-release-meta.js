#!/usr/bin/env node
/**
 * 把 release/ 下最新一份「藏经阁-Setup-*.exe」与「藏经阁-portable-*.zip」
 * 的版本、大小、SHA256 写回 docs/releases.json，让官网保持与产物一致。
 *
 * 用法：
 *   node scripts/update-release-meta.js
 *
 * 退出码：
 *   0  写入成功（或无变化）
 *   1  找不到任何产物
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const RELEASE_DIR = path.join(ROOT, "release");
const SITE_META = path.join(ROOT, "docs", "releases.json");
const FALLBACK_META = {
  $schema: "https://json-schema.org/draft-07/schema#",
  _comment: "由 scripts/update-release-meta.js 自动维护；手动改也可以，但下次构建会被覆盖。",
  name: "藏经阁",
  tagline: "私人典籍 · 智能编修",
  version: "0.0.0",
  releaseDate: "",
  platform: "win32-x64",
  minOs: "Windows 10 / 11 (x64)",
  license: "MIT",
  github: { owner: "", repo: "", url: "" },
  downloads: {
    installer: { fileName: "", sizeBytes: 0, sizeLabel: "—", sha256: "", kind: "nsis", recommended: true },
    portable:  { fileName: "", sizeBytes: 0, sizeLabel: "—", sha256: "", kind: "zip" },
  },
};

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = fs.createReadStream(filePath);
    s.on("error", reject);
    s.on("data", (c) => h.update(c));
    s.on("end", () => resolve(h.digest("hex")));
  });
}

function humanSize(bytes) {
  if (!bytes) return "—";
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return (mb / 1024).toFixed(2) + " GB";
  return Math.round(mb) + " MB";
}

function findLatest(reMatch) {
  const all = fs.readdirSync(RELEASE_DIR, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.join(RELEASE_DIR, d.name))
    .filter((p) => reMatch.test(path.basename(p)))
    .map((p) => ({ p, st: fs.statSync(p) }))
    .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  return all[0]?.p || null;
}

function parseVersion(name) {
  const m = name.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

async function main() {
  if (!fs.existsSync(RELEASE_DIR)) {
    console.error("[update-release-meta] release/ 目录不存在");
    process.exit(1);
  }

  const installer = findLatest(/^藏经阁-Setup-.*\.exe$/);
  const portable = findLatest(/^藏经阁-portable-.*\.zip$/);

  if (!installer && !portable) {
    console.error("[update-release-meta] 找不到任何 藏经阁-Setup-*.exe / 藏经阁-portable-*.zip");
    process.exit(1);
  }

  let prev = FALLBACK_META;
  if (fs.existsSync(SITE_META)) {
    try {
      prev = JSON.parse(fs.readFileSync(SITE_META, "utf8"));
    } catch {
      console.warn("[update-release-meta] 旧的 releases.json 损坏，使用默认模板");
    }
  }

  const meta = JSON.parse(JSON.stringify({ ...FALLBACK_META, ...prev }));

  const verCandidates = [installer, portable].filter(Boolean).map((p) => parseVersion(path.basename(p))).filter(Boolean);
  if (verCandidates.length) {
    meta.version = verCandidates[0];
  }
  meta.releaseDate = new Date().toISOString().slice(0, 10);

  if (installer) {
    const st = fs.statSync(installer);
    const hash = await sha256(installer);
    meta.downloads.installer = {
      fileName: path.basename(installer),
      sizeBytes: st.size,
      sizeLabel: humanSize(st.size),
      sha256: hash,
      kind: "nsis",
      recommended: true,
    };
    console.log(`[installer] ${path.basename(installer)}  ${humanSize(st.size)}  ${hash}`);
  }

  if (portable) {
    const st = fs.statSync(portable);
    const hash = await sha256(portable);
    meta.downloads.portable = {
      fileName: path.basename(portable),
      sizeBytes: st.size,
      sizeLabel: humanSize(st.size),
      sha256: hash,
      kind: "zip",
    };
    console.log(`[portable ] ${path.basename(portable)}  ${humanSize(st.size)}  ${hash}`);
  }

  if (!fs.existsSync(path.dirname(SITE_META))) {
    fs.mkdirSync(path.dirname(SITE_META), { recursive: true });
  }
  fs.writeFileSync(SITE_META, JSON.stringify(meta, null, 2) + "\n", "utf8");
  console.log(`[update-release-meta] 写入 ${path.relative(ROOT, SITE_META)}  version=${meta.version}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
