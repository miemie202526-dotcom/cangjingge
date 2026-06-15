/**
 * Local file → extracted text + metadata + Markdown 预览（表格类）
 */

const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const { SUPPORTED_TEXT_EXTENSIONS } = require("./file-capabilities");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const ExcelJS = require("exceljs");
const Papa = require("papaparse");
const { parseOfficeAsync } = require("officeparser");
const { ocrImageWithVision } = require("../openaiStructuredClient");

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

function countLines(s) {
  if (!s) return 0;
  return String(s).split(/\r?\n/).length;
}

function cellPlain(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v.text) return String(v.text);
  return String(v).replace(/\r?\n/g, " ").replace(/\t/g, " ").replace(/\|/g, "\\|");
}

function stripRtf(raw) {
  return String(raw || "")
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** @param {unknown[][]} rows */
function rowsToMarkdownTable(rows, maxRows = 40) {
  const slice = rows
    .filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim()))
    .slice(0, maxRows);
  if (!slice.length) return "";
  const width = Math.max(...slice.map((r) => r.length), 1);
  const norm = slice.map((r) => {
    const a = [...r];
    while (a.length < width) a.push("");
    return a.slice(0, width).map((c) => cellPlain(c));
  });
  const header = norm[0];
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...norm.slice(1).map((r) => `| ${r.join(" | ")} |`),
  ];
  return lines.join("\n");
}

async function extractPdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const result = await pdfParse(buffer);
  return {
    text: result.text || "",
    pages: typeof result.numpages === "number" ? result.numpages : undefined,
  };
}

async function extractXlsxMeta(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  let sheets = 0;
  let rows = 0;
  const chunks = [];
  let markdownPreview = "";
  let firstSheet = true;
  workbook.eachSheet((ws) => {
    sheets += 1;
    /** @type {unknown[][]} */
    const matrix = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      rows += 1;
      const n = Math.max(row.actualCellCount, 1);
      const parts = [];
      for (let c = 1; c <= n; c += 1) {
        parts.push(row.getCell(c).value);
      }
      matrix.push(parts);
    });
    const lines = [`### 工作表: ${ws.name}`];
    matrix.forEach((parts) => {
      lines.push(parts.map((v) => cellPlain(v)).join("\t"));
    });
    chunks.push(lines.join("\n"));
    if (firstSheet && matrix.length) {
      markdownPreview = `### 表格预览（${ws.name}）\n\n${rowsToMarkdownTable(matrix)}`;
      firstSheet = false;
    }
  });
  const text = chunks.join("\n\n");
  return { text, sheetCount: sheets, rowCount: rows, markdownPreview };
}

async function extractCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse(raw, { skipEmptyLines: false });
  const rows = parsed.data || [];
  const lineCount = rows.length;
  const colCount = rows[0] ? rows[0].length : 0;
  const text = rows.map((r) => (Array.isArray(r) ? r.join("\t") : String(r))).join("\n");
  const md = rows.length ? `### CSV 预览\n\n${rowsToMarkdownTable(/** @type {unknown[][]} */ (rows))}` : "";
  return { text, rowCount: lineCount, colCount, markdownPreview: md };
}

async function extractOffice(filePath) {
  const text = await parseOfficeAsync(filePath);
  return { text: String(text || "") };
}

async function extractImageOcr(filePath, apiKey) {
  const key = (apiKey || "").trim();
  if (key) {
    const buffer = fs.readFileSync(filePath);
    const b64 = buffer.toString("base64");
    const mimeType = mime.lookup(filePath) || "image/png";
    const { text } = await ocrImageWithVision({ apiKey: key, imageBase64: b64, mimeType });
    return { text, ocrSkipped: false, ocr: "vision" };
  }
  try {
    const Tesseract = require("tesseract.js");
    const r = await Tesseract.recognize(filePath, "chi_sim+eng", { logger: () => {} });
    const text = String(r?.data?.text || "").trim();
    if (text.length > 0) {
      return { text, ocrSkipped: false, ocr: "tesseract" };
    }
  } catch (e) {
    console.warn("[ingest] Tesseract OCR failed:", e?.message || e);
  }
  return {
    text: "",
    ocrSkipped: true,
    note: "图片已上传，可用于图像分析 Prompt。本地 OCR 未识别出文字时可配合分析页自定义问题使用。",
  };
}

/**
 * @param {string} filePath
 * @param {{ apiKey?: string }} opts
 */
async function ingestLocalFile(filePath, opts = {}) {
  const { apiKey = "" } = opts;
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_TEXT_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的文件类型「${ext}」。请在设置页查看支持的格式列表。`);
  }
  const stat = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  const mimeType = mime.lookup(filePath) || "application/octet-stream";

  let content = "";
  /** @type {Record<string, unknown>} */
  const extra = {};
  let markdownPreview = "";

  if (ext === ".pdf") {
    const r = await extractPdf(filePath);
    content = r.text;
    if (r.pages !== undefined) extra.pages = r.pages;
  } else if (ext === ".docx") {
    const r = await mammoth.extractRawText({ path: filePath });
    content = r.value || "";
  } else if (ext === ".xlsx") {
    const r = await extractXlsxMeta(filePath);
    content = r.text;
    extra.sheetCount = r.sheetCount;
    extra.rowCount = r.rowCount;
    markdownPreview = r.markdownPreview || "";
  } else if (ext === ".csv") {
    const r = await extractCsv(filePath);
    content = r.text;
    extra.rowCount = r.rowCount;
    extra.colCount = r.colCount;
    markdownPreview = r.markdownPreview || "";
  } else if (ext === ".pptx") {
    try {
      const r = await extractOffice(filePath);
      content = r.text;
      extra.slidesNote = "文本由 Office 解析器提取";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`无法解析 PPTX：${msg}`);
    }
  } else if (IMAGE_EXT.has(ext)) {
    const r = await extractImageOcr(filePath, apiKey);
    if (r.ocrSkipped) {
      content = `（图片：${fileName}）\n${r.note || "图片已上传。"}`;
      extra.imageOnly = true;
      extra.ocr = "skipped";
      if (r.note) extra.note = r.note;
      const buf = fs.readFileSync(filePath);
      extra.imageDataUrl = `data:${mimeType};base64,${buf.toString("base64")}`;
      markdownPreview = `### 图片\n\n已上传，可在分析/生成中作为参考资料引用文件名：**${fileName}**`;
    } else {
      content = r.text;
      extra.ocr = "vision";
    }
  } else {
    const raw = fs.readFileSync(filePath, "utf8");
    content = ext === ".rtf" ? stripRtf(raw) : raw;
    if (ext === ".md") markdownPreview = content.slice(0, 12000);
  }

  const charCount = content.length;
  const lineCount = countLines(content);
  const preview = content.slice(0, 600) + (content.length > 600 ? "…" : "");

  return {
    meta: {
      fileName,
      ext,
      mimeType,
      bytes: stat.size,
      charCount,
      lineCount,
      preview,
      ...extra,
    },
    content,
    markdownPreview: markdownPreview || (ext === ".csv" || ext === ".xlsx" ? "" : ext === ".md" ? content.slice(0, 8000) : ""),
  };
}

module.exports = {
  ingestLocalFile,
  IMAGE_EXT,
};
