#!/usr/bin/env node
/**
 * 生成手动更新源 JSON。
 *
 * 用法：
 *   node scripts/write-update-manifest.js
 *
 * 可选环境变量：
 *   RELEASE_BASE_URL=https://example.com/downloads/
 *   UPDATE_CHANNEL=stable
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const releaseDir = path.join(root, "release");
const pkg = require(path.join(root, "package.json"));
const baseUrl = String(process.env.RELEASE_BASE_URL || "").trim();
const channel = String(process.env.UPDATE_CHANNEL || "stable").trim() || "stable";

function sha256(filePath) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(filePath));
  return h.digest("hex");
}

function humanSize(bytes) {
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${Math.round(mb)} MB`;
}

function urlFor(fileName) {
  if (!baseUrl) return fileName;
  return new URL(fileName, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
}

function addDownload(downloads, key, fileName) {
  const fp = path.join(releaseDir, fileName);
  if (!fs.existsSync(fp)) return;
  const st = fs.statSync(fp);
  downloads[key] = {
    platform: key,
    fileName,
    url: urlFor(fileName),
    sizeBytes: st.size,
    sizeLabel: humanSize(st.size),
    sha256: sha256(fp),
  };
}

if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

const version = pkg.version;
const downloads = {};
addDownload(downloads, "darwin-arm64", `藏经阁-v${version}-Mac-arm64.zip`);
addDownload(downloads, "mac", `藏经阁-v${version}-Mac-arm64.zip`);
addDownload(downloads, "latest", "Cangjingge-latest-Mac-arm64.zip");

const winPortable = `藏经阁-v${version}-Windows-x64.zip`;
const winSetup = `藏经阁-Setup-v${version}.exe`;
addDownload(downloads, "win32-x64", fs.existsSync(path.join(releaseDir, winSetup)) ? winSetup : winPortable);
addDownload(downloads, "windows", fs.existsSync(path.join(releaseDir, winSetup)) ? winSetup : winPortable);

const manifest = {
  name: "藏经阁",
  channel,
  enabled: true,
  version,
  releaseDate: new Date().toISOString().slice(0, 10),
  mandatory: false,
  notes: [
    "新增软件更新中心：用户可手动检查新版并选择是否下载更新。",
    "发布者通过 latest.json 控制最新版本、下载地址和更新说明。",
  ],
  downloads,
};

const out = path.join(releaseDir, "Cangjingge-latest.json");
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`[write-update-manifest] ${path.relative(root, out)} version=${version}`);
