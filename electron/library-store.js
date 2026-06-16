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

function updateMetadata(id, patch) {
  const rec = readRecord(id);
  if (!rec) throw new Error("文件不存在。");
  const next = { ...rec };
  const allowed = ["fileName", "category", "priority", "annotationNote", "memoryNote", "tags", "preview", "charCount", "lineCount", "editedAt"];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, key)) next[key] = patch[key];
  }
  if (typeof next.fileName === "string") {
    next.fileName = path.basename(next.fileName).replace(/[\\/]/g, "_").trim() || rec.fileName;
  }
  fs.writeFileSync(path.join(itemDir(id), "meta.json"), JSON.stringify(next, null, 2));
  return next;
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
const TEXT_EXT = new Set([".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".log"]);

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sheetToHtml(fp) {
  const xlsx = require("xlsx");
  const wb = xlsx.readFile(fp, { cellDates: true, cellStyles: true });
  const sheetNames = wb.SheetNames;
  const tabs = sheetNames
    .map((name, idx) => `<button type="button" data-sheet="${idx}" class="sheet-tab${idx === 0 ? " active" : ""}">${escapeHtml(name)}</button>`)
    .join("");
  const mergeKey = (r, c) => `${r}:${c}`;
  const colLabel = (idx) => {
    let n = idx + 1;
    let out = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  };
  const cellStyle = (cell, colInfo) => {
    const styles = [];
    const width = Number(colInfo?.wch || 0);
    if (Number.isFinite(width) && width > 0) styles.push(`min-width:${Math.min(Math.max(width * 8, 56), 320)}px`);
    const s = cell?.s || {};
    const fill = s.fill?.fgColor?.rgb || s.fill?.patternFill?.fgColor?.rgb;
    if (fill && /^[0-9a-f]{6,8}$/i.test(fill)) styles.push(`background:#${fill.slice(-6)}`);
    const color = s.font?.color?.rgb;
    if (color && /^[0-9a-f]{6,8}$/i.test(color)) styles.push(`color:#${color.slice(-6)}`);
    if (s.font?.bold) styles.push("font-weight:700");
    if (s.font?.italic) styles.push("font-style:italic");
    const align = s.alignment?.horizontal;
    if (align) styles.push(`text-align:${align === "center" ? "center" : align === "right" ? "right" : "left"}`);
    return styles.length ? ` style="${styles.join(";")}"` : "";
  };
  const sheets = sheetNames
    .map((name, idx) => {
      const ws = wb.Sheets[name];
      const ref = ws?.["!ref"];
      if (!ref) {
        return `<section class="sheet-page${idx === 0 ? " active" : ""}" data-sheet-page="${idx}"><div class="muted" style="padding:18px">空工作表</div></section>`;
      }
      const range = xlsx.utils.decode_range(ref);
      const colCount = range.e.c - range.s.c + 1;
      const merges = Array.isArray(ws["!merges"]) ? ws["!merges"] : [];
      const skip = new Set();
      const starts = new Map();
      for (const m of merges) {
        const rowSpan = m.e.r - m.s.r + 1;
        const colSpan = m.e.c - m.s.c + 1;
        starts.set(mergeKey(m.s.r, m.s.c), { rowSpan, colSpan });
        for (let r = m.s.r; r <= m.e.r; r += 1) {
          for (let c = m.s.c; c <= m.e.c; c += 1) {
            if (r === m.s.r && c === m.s.c) continue;
            skip.add(mergeKey(r, c));
          }
        }
      }
      const colHeads = Array.from({ length: colCount }, (_, i) => `<th>${colLabel(range.s.c + i)}</th>`).join("");
      let body = "";
      for (let r = range.s.r; r <= range.e.r; r += 1) {
        let cells = "";
        for (let c = range.s.c; c <= range.e.c; c += 1) {
          if (skip.has(mergeKey(r, c))) continue;
          const addr = xlsx.utils.encode_cell({ r, c });
          const cell = ws[addr];
          const merge = starts.get(mergeKey(r, c));
          const attrs = [
            merge?.rowSpan > 1 ? `rowspan="${merge.rowSpan}"` : "",
            merge?.colSpan > 1 ? `colspan="${merge.colSpan}"` : "",
            cellStyle(cell, ws["!cols"]?.[c]),
          ].filter(Boolean).join(" ");
          cells += `<td${attrs ? ` ${attrs}` : ""}>${escapeHtml(cell ? xlsx.utils.format_cell(cell) : "")}</td>`;
        }
        body += `<tr><th>${r + 1}</th>${cells}</tr>`;
      }
      return `<section class="sheet-page${idx === 0 ? " active" : ""}" data-sheet-page="${idx}"><table><thead><tr><th></th>${colHeads}</tr></thead><tbody>${body}</tbody></table></section>`;
    })
    .join("");
  return { tabs, sheets, sheetCount: sheetNames.length };
}

async function saveTextContent(id, text, apiKey) {
  const rec = readRecord(id);
  if (!rec) throw new Error("文件不存在。");
  const fp = storedFilePath(rec);
  if (!fs.existsSync(fp)) throw new Error("文件数据缺失。");
  const ext = path.extname(fp).toLowerCase();
  if (!TEXT_EXT.has(ext)) throw new Error("此文件格式暂不支持在软件内直接写回，请用系统打开编辑。");
  fs.writeFileSync(fp, String(text ?? ""), "utf8");
  const { meta, content, markdownPreview } = await ingestLocalFile(fp, { apiKey: apiKey || "" });
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
    editedAt: Date.now(),
  };
  fs.writeFileSync(path.join(itemDir(id), "meta.json"), JSON.stringify(next, null, 2));
  return { record: next, content, markdownPreview: markdownPreview || "" };
}

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
  if (TEXT_EXT.has(ext)) {
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
  if (ext === ".xlsx" || ext === ".xls") {
    try {
      const sheet = sheetToHtml(fp);
      return { kind: "spreadsheet_html", ...sheet, fileName: rec.fileName };
    } catch (e) {
      const { content } = await ingestLocalFile(fp, { apiKey: apiKey || "" });
      const t = content || "";
      return { kind: "text", text: t.slice(0, maxText), truncated: t.length > maxText, note: e?.message || "由解析引擎提取的文本预览" };
    }
  }
  if (ext === ".pptx") {
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
  updateMetadata,
  openOriginal,
  getPreview,
  saveTextContent,
  reparseItem,
};
