/**
 * 用户文件库：持久化在用户目录，供各页面复用。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, shell } = require("electron");
const { ingestLocalFile } = require("./document-ingest");

function getLibraryRoot() {
  return path.join(app.getPath("userData"), "ai-content-studio-pro", "library");
}

function itemDir(id) {
  return path.join(getLibraryRoot(), id);
}

function readRecord(id) {
  const metaPath = path.join(itemDir(id), "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  try {
    const rec = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (!rec.id) rec.id = id;
    return rec;
  } catch {
    return null;
  }
}

function storedFilePath(record) {
  return path.join(itemDir(record.id), record.storedRelPath || record.fileName);
}

function listLibraryItems() {
  const root = getLibraryRoot();
  if (!fs.existsSync(root)) return [];
  const names = fs.readdirSync(root, { withFileTypes: true });
  const out = [];
  for (const ent of names) {
    if (!ent.isDirectory()) continue;
    const rec = readRecord(ent.name);
    if (rec) out.push(rec);
  }
  out.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
  return out;
}

async function addFromPath(filePath, apiKey) {
  const id = crypto.randomUUID();
  const root = getLibraryRoot();
  const dir = itemDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(filePath);
  const dest = path.join(dir, base);
  fs.copyFileSync(filePath, dest);
  const { meta, content, markdownPreview } = await ingestLocalFile(dest, { apiKey });
  const record = {
    id,
    fileName: base,
    storedRelPath: base,
    uploadedAt: Date.now(),
    tags: [],
    ...meta,
    charCount: meta.charCount,
    preview: typeof meta.preview === "string" ? meta.preview : (content || "").slice(0, 600),
    markdownPreview: markdownPreview || "",
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(record, null, 2));
  return { record, content, markdownPreview: markdownPreview || "" };
}

async function addFromBuffer(fileName, buffer, apiKey) {
  const id = crypto.randomUUID();
  const root = getLibraryRoot();
  const dir = itemDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const safe = path.basename(fileName).replace(/[\\/]/g, "_");
  const dest = path.join(dir, safe);
  fs.writeFileSync(dest, buffer);
  const { meta, content, markdownPreview } = await ingestLocalFile(dest, { apiKey });
  const record = {
    id,
    fileName: safe,
    storedRelPath: safe,
    uploadedAt: Date.now(),
    tags: [],
    ...meta,
    charCount: meta.charCount,
    preview: typeof meta.preview === "string" ? meta.preview : (content || "").slice(0, 600),
    markdownPreview: markdownPreview || "",
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(record, null, 2));
  return { record, content, markdownPreview: markdownPreview || "" };
}

function deleteItem(id) {
  const dir = itemDir(id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

async function getFullText(id, apiKey) {
  const rec = readRecord(id);
  if (!rec) throw new Error("文件不存在。");
  const fp = storedFilePath(rec);
  if (!fs.existsSync(fp)) throw new Error("文件数据缺失。");
  const { content } = await ingestLocalFile(fp, { apiKey });
  return { record: rec, content };
}

function updateTags(id, tags) {
  const rec = readRecord(id);
  if (!rec) throw new Error("文件不存在。");
  rec.tags = Array.isArray(tags) ? tags.map(String) : [];
  fs.writeFileSync(path.join(itemDir(id), "meta.json"), JSON.stringify(rec, null, 2));
  return rec;
}

async function reparseItem(id, apiKey) {
  const rec = readRecord(id);
  if (!rec) throw new Error("文件不存在。");
  const fp = storedFilePath(rec);
  if (!fs.existsSync(fp)) throw new Error("文件数据缺失。");
  const { meta, content, markdownPreview } = await ingestLocalFile(fp, { apiKey });
  const next = {
    ...rec,
    ...meta,
    id: rec.id,
    fileName: rec.fileName,
    storedRelPath: rec.storedRelPath,
    uploadedAt: rec.uploadedAt,
    tags: Array.isArray(rec.tags) ? rec.tags : [],
    charCount: meta.charCount,
    preview: typeof meta.preview === "string" ? meta.preview : (content || "").slice(0, 600),
    markdownPreview: markdownPreview || "",
  };
  fs.writeFileSync(path.join(itemDir(id), "meta.json"), JSON.stringify(next, null, 2));
  return { record: next, content, markdownPreview: markdownPreview || "" };
}

function openOriginal(id) {
  const rec = readRecord(id);
  if (!rec) throw new Error("文件不存在。");
  const fp = storedFilePath(rec);
  if (!fs.existsSync(fp)) throw new Error("文件数据缺失。");
  shell.openPath(fp);
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

async function getPreview(id, apiKey, maxText = 12000) {
  const rec = readRecord(id);
  if (!rec) throw new Error("文件不存在。");
  const fp = storedFilePath(rec);
  if (!fs.existsSync(fp)) throw new Error("文件数据缺失。");
  const ext = path.extname(fp).toLowerCase();
  if (IMAGE_EXT.has(ext)) {
    const buf = fs.readFileSync(fp);
    const mime = require("mime-types").lookup(fp) || "application/octet-stream";
    return { kind: "image", mime, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
  }
  if (ext === ".pdf") {
    const { pathToFileURL } = require("url");
    return { kind: "pdf", url: pathToFileURL(fp).href, fileName: rec.fileName };
  }
  if (ext === ".html") {
    const { pathToFileURL } = require("url");
    return { kind: "html_url", url: pathToFileURL(fp).href, fileName: rec.fileName };
  }
  if (ext === ".txt" || ext === ".md" || ext === ".csv" || ext === ".json" || ext === ".xml") {
    const raw = fs.readFileSync(fp, "utf8");
    return { kind: "text", text: raw.slice(0, maxText), truncated: raw.length > maxText };
  }
  if (ext === ".docx") {
    try {
      const mammoth = require("mammoth");
      const r = await mammoth.convertToHtml({ path: fp });
      return { kind: "docx_html", html: String(r.value || ""), fileName: rec.fileName };
    } catch {
      const { content } = await ingestLocalFile(fp, { apiKey: apiKey || "" });
      const t = content || "";
      return { kind: "text", text: t.slice(0, maxText), truncated: t.length > maxText, note: "由解析引擎提取的文本预览" };
    }
  }
  if (ext === ".xlsx" || ext === ".pptx") {
    const { content } = await ingestLocalFile(fp, { apiKey: apiKey || "" });
    const t = content || "";
    return { kind: "text", text: t.slice(0, maxText), truncated: t.length > maxText, note: "由解析引擎提取的文本预览" };
  }
  return { kind: "binary", ext, fileName: rec.fileName };
}

module.exports = {
  listLibraryItems,
  addFromPath,
  addFromBuffer,
  deleteItem,
  getFullText,
  updateTags,
  openOriginal,
  getPreview,
  reparseItem,
};
