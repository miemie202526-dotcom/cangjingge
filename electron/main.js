const path = require("path");
const fs = require("fs");
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  safeStorage,
  shell,
} = require("electron");
const {
  runStructuredAnalysis,
  generateFileFromInstruction,
  runCreativeTask,
  runWorkspaceInsightAnalysis,
} = require("../openaiStructuredClient");
const { ingestLocalFile } = require("./document-ingest");
const libraryStore = require("./library-store");
const { SUPPORTED_TEXT_EXTENSIONS } = require("./file-capabilities");
const {
  getDesktopManifest,
  getPickFileDialogFilters,
  getSaveGeneratedFilters,
  getExportReportFilters,
  getJsonFileFilter,
  getPngFileFilter,
  dialogs,
} = require("./desktop-manifest");
const {
  markdownToDocxBuffer,
  markdownToRichXlsxBuffer,
  markdownToRichCsvBuffer,
  utf8TextWithBom,
  markdownToPptxBuffer,
} = require("./export-rich-formats");

const SAVE_GENERATED_FORMATS = new Set([
  "txt",
  "md",
  "csv",
  "json",
  "docx",
  "xlsx",
  "pdf",
  "html",
  "pptx",
  "slides_html",
]);

/**
 * @param {string} filePath
 * @param {string} selectedFormat
 * @param {string} content
 * @param {Record<string, unknown>} [payload]
 */
async function writeGeneratedExportToPath(filePath, selectedFormat, content, payload = {}) {
  const exportMeta = payload?.exportMeta && typeof payload.exportMeta === "object" ? payload.exportMeta : {};
  if (selectedFormat === "docx") {
    fs.writeFileSync(filePath, await markdownToDocxBuffer(content, exportMeta));
  } else if (selectedFormat === "xlsx") {
    fs.writeFileSync(filePath, await markdownToRichXlsxBuffer(content, exportMeta));
  } else if (selectedFormat === "pptx") {
    fs.writeFileSync(filePath, await markdownToPptxBuffer(content, exportMeta));
  } else if (selectedFormat === "pdf") {
    fs.writeFileSync(
      filePath,
      await textToPdfBuffer(content, {
        embedPdfImages: Boolean(payload?.embedPdfImages),
        meta: exportMeta,
      })
    );
  } else if (selectedFormat === "csv") {
    fs.writeFileSync(filePath, markdownToRichCsvBuffer(content, exportMeta));
  } else if (selectedFormat === "txt") {
    fs.writeFileSync(filePath, utf8TextWithBom(content, exportMeta));
  } else {
    fs.writeFileSync(filePath, String(content ?? ""), "utf8");
  }
}

function resolveApiKey(explicitFromRenderer) {
  const ex = typeof explicitFromRenderer === "string" ? explicitFromRenderer.trim() : "";
  if (ex) return ex;
  const stored = loadApiKeySecurely().trim();
  if (stored) return stored;
  return (process.env.OPENAI_API_KEY || "").trim();
}

async function extractTextFromFile(filePath, explicitApiKey) {
  const { content } = await ingestLocalFile(filePath, {
    apiKey: resolveApiKey(explicitApiKey),
  });
  return content;
}

/** 供 pdfkit 嵌入的中日韩字体（.ttf 优先；.ttc 部分环境不支持） */
function resolvePdfCjkFontPath() {
  if (process.platform === "win32") {
    const windir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
    const candidates = [
      path.join(windir, "Fonts", "simhei.ttf"),
      path.join(windir, "Fonts", "simfang.ttf"),
      path.join(windir, "Fonts", "msyh.ttf"),
      path.join(windir, "Fonts", "msyhbd.ttf"),
      path.join(windir, "Fonts", "simsun.ttc"),
      path.join(windir, "Fonts", "msyh.ttc"),
    ];
    for (const fp of candidates) {
      if (fs.existsSync(fp)) return fp;
    }
  } else if (process.platform === "darwin") {
    const mac = [
      "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
      "/Library/Fonts/Arial Unicode.ttf",
      "/System/Library/Fonts/PingFang.ttc",
    ];
    for (const fp of mac) {
      if (fs.existsSync(fp)) return fp;
    }
  } else {
    const linux = [
      "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ];
    for (const fp of linux) {
      if (fs.existsSync(fp)) return fp;
    }
  }
  return null;
}

async function fetchHttpBufferForPdf(urlStr) {
  const u = new URL(urlStr);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("仅支持 http(s) 图片");
  }
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(u.href, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new Error("图片过大");
    return buf;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Markdown / 纯文本 → PDF：识别标题、列表、引用、分隔线；可选按行内 `![](https...)` 拉取并嵌入图片。
 */
function textToPdfBuffer(text, opts = {}) {
  const embedImages = Boolean(opts.embedPdfImages);
  const meta = opts.meta && typeof opts.meta === "object" ? opts.meta : {};
  const titleStr = String(meta.title || "").trim();
  const confLvl = String(meta.confidentialLevel || "").trim();
  const genAtIso = meta.generatedAt ? String(meta.generatedAt) : "";
  let genAt;
  try {
    const d = genAtIso ? new Date(genAtIso) : new Date();
    genAt = Number.isNaN(d.getTime()) ? new Date().toLocaleString("zh-CN", { hour12: false }) : d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    genAt = new Date().toLocaleString("zh-CN", { hour12: false });
  }

  const PDFDocument = require("pdfkit");
  const raw = String(text ?? "");
  const lines = raw.split(/\r?\n/);
  const pageTextWidth = 500;
  const baseSize = 10;

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 50, size: "A4", bufferPages: true });
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const fontPath = resolvePdfCjkFontPath();
    let bodyFont = "Helvetica";
    if (fontPath) {
      try {
        doc.registerFont("CJKBody", fontPath);
        bodyFont = "CJKBody";
      } catch (e) {
        console.warn("[pdf] 无法注册中文字体:", fontPath, e?.message || e);
      }
    } else {
      console.warn("[pdf] 未找到系统中文字体文件，PDF 中文可能乱码。请安装黑体/雅黑或 Noto CJK。");
    }
    doc.font(bodyFont);
    doc.fillColor("#000000");
    doc.fontSize(baseSize);

    (async () => {
      try {
        doc.font(bodyFont).fontSize(8.5).fillColor("#64748b").text(`交付文稿 · ${genAt}`, {
          align: "right",
          width: pageTextWidth,
        });
        doc.moveDown(0.35);
        if (titleStr) {
          doc.font(bodyFont).fontSize(14).fillColor("#0f172a").text(titleStr, { width: pageTextWidth });
          doc.moveDown(0.28);
        }
        if (confLvl === "internal") {
          doc.font(bodyFont).fontSize(9.5).fillColor("#b45309").text("内部资料 · 请勿擅自对外转发", {
            width: pageTextWidth,
          });
          doc.moveDown(0.18);
        }
        if (confLvl === "confidential") {
          doc.font(bodyFont).fontSize(9.5).fillColor("#991b1b").text("保密文件 · 仅限授权人员查阅", {
            width: pageTextWidth,
          });
          doc.moveDown(0.18);
        }
        const ruleY = doc.y;
        doc.save();
        doc.strokeColor("#e2e8f0").lineWidth(0.9).moveTo(50, ruleY).lineTo(545, ruleY).stroke();
        doc.restore();
        doc.moveDown(0.5);
        doc.fillColor("#000000").font(bodyFont).fontSize(baseSize);

        for (const line of lines) {
          const trimmed = line.trimEnd();
          if (!trimmed.trim()) {
            doc.moveDown(0.12);
            continue;
          }

          if (/^[\s\-*_]{3,}$/.test(trimmed)) {
            doc.moveDown(0.22);
            const y = doc.y;
            doc.save();
            doc.strokeColor("#cccccc").lineWidth(0.5).moveTo(50, y).lineTo(545, y).stroke();
            doc.restore();
            doc.moveDown(0.32);
            continue;
          }

          const h = trimmed.match(/^(#{1,6})\s+(.+)$/);
          if (h) {
            const level = h[1].length;
            const size = level <= 1 ? 19 : level === 2 ? 14.5 : level === 3 ? 12 : 10.5;
            doc.moveDown(level <= 2 ? 0.35 : 0.2);
            doc.font(bodyFont).fontSize(size).text(h[2], { width: pageTextWidth });
            doc.fontSize(baseSize);
            doc.moveDown(0.2);
            continue;
          }

          const img = trimmed.match(/^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\s*$/);
          if (img) {
            if (!embedImages) {
              doc.font(bodyFont).fontSize(9).fillColor("#555555").text(`[图] ${img[1] || "image"}\n${img[2]}`, {
                width: pageTextWidth,
              });
              doc.fillColor("#000000").fontSize(baseSize);
              doc.moveDown(0.15);
              continue;
            }
            try {
              const buf = await fetchHttpBufferForPdf(img[2]);
              doc.moveDown(0.2);
              doc.image(buf, { fit: [pageTextWidth, 260], align: "center" });
              doc.moveDown(0.25);
              if (img[1]) {
                doc.font(bodyFont).fontSize(8.5).fillColor("#666666").text(img[1], { width: pageTextWidth, align: "center" });
                doc.fillColor("#000000").fontSize(baseSize);
              }
            } catch (e) {
              console.warn("[pdf] image:", img[2], e?.message || e);
              doc.font(bodyFont).fontSize(9).fillColor("#991b1b").text(`[图片未载入] ${img[1] || img[2]}`.trim(), {
                width: pageTextWidth,
              });
              doc.fillColor("#000000").fontSize(baseSize);
            }
            continue;
          }

          const bullet = trimmed.match(/^[\-\*]\s+(.+)$/);
          if (bullet) {
            doc.font(bodyFont).fontSize(baseSize).text(`•  ${bullet[1]}`, { width: pageTextWidth, indent: 12 });
            continue;
          }

          const num = trimmed.match(/^(\d+)\.\s+(.+)$/);
          if (num) {
            doc.font(bodyFont).fontSize(baseSize).text(`${num[1]}. ${num[2]}`, { width: pageTextWidth, indent: 8 });
            continue;
          }

          const bq = trimmed.match(/^>\s?(.+)$/);
          if (bq) {
            doc.font(bodyFont).fontSize(baseSize).fillColor("#1e293b").text(bq[1], { width: pageTextWidth - 16, indent: 12 });
            doc.fillColor("#000000");
            continue;
          }

          doc.font(bodyFont).fontSize(baseSize).text(trimmed, { width: pageTextWidth });
        }
        const range = doc.bufferedPageRange();
        const confSuffix =
          confLvl === "internal" ? " · 内部" : confLvl === "confidential" ? " · 保密" : "";
        for (let i = 0; i < range.count; i += 1) {
          doc.switchToPage(range.start + i);
          const bh = doc.page.height;
          doc.save();
          doc.font(bodyFont).fontSize(7.5).fillColor("#94a3b8").text(
            `AI Content Studio Pro · 第 ${i + 1} / ${range.count} 页 · ${genAt}${confSuffix}`,
            50,
            bh - 36,
            { width: pageTextWidth - 2, align: "center" }
          );
          doc.restore();
        }
        doc.end();
      } catch (err) {
        reject(err);
      }
    })();
  });
}

async function readSupportedFilesFromFolder(folderPath) {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(folderPath, entry.name);
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_TEXT_EXTENSIONS.has(ext)) continue;
    try {
      const content = await extractTextFromFile(filePath);
      files.push({
        filePath,
        fileName: entry.name,
        extension: ext,
        content,
      });
    } catch {
      // Skip unreadable files and continue.
    }
  }

  return files;
}

async function ingestBufferToResult({ fileName, base64, apiKey }) {
  if (!fileName || typeof fileName !== "string" || !base64 || typeof base64 !== "string") {
    throw new Error("缺少文件名或文件数据。");
  }
  const safeBase = path.basename(fileName).replace(/[\\/]/g, "_");
  const tmp = path.join(app.getPath("temp"), `aiws-${Date.now()}-${safeBase}`);
  fs.writeFileSync(tmp, Buffer.from(base64, "base64"));
  try {
    return await ingestLocalFile(tmp, { apiKey: resolveApiKey(apiKey) });
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

function getApiKeyStorePath() {
  return path.join(app.getPath("userData"), "apikey.bin");
}

function saveApiKeySecurely(apiKey) {
  const storePath = getApiKeyStorePath();
  if (!apiKey) {
    if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage is not available on this system.");
  }
  const encrypted = safeStorage.encryptString(apiKey);
  fs.writeFileSync(storePath, encrypted);
}

function loadApiKeySecurely() {
  const storePath = getApiKeyStorePath();
  if (!fs.existsSync(storePath)) return "";
  if (!safeStorage.isEncryptionAvailable()) return "";
  const encrypted = fs.readFileSync(storePath);
  return safeStorage.decryptString(encrypted);
}

function compareVersions(a, b) {
  const pa = String(a || "0.0.0").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b || "0.0.0").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function validateHttpUrl(raw, label = "URL") {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    throw new Error(`${label} 格式不正确。`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`${label} 只支持 http(s)。`);
  }
  return u;
}

function pickUpdateDownload(manifest) {
  const platform = process.platform;
  const arch = process.arch;
  const exact = `${platform}-${arch}`;
  const downloads = manifest?.downloads && typeof manifest.downloads === "object" ? manifest.downloads : {};
  const candidates = [
    downloads[exact],
    downloads[platform],
    platform === "darwin" ? downloads.mac : null,
    platform === "win32" ? downloads.windows : null,
    downloads.latest,
    typeof manifest.downloadUrl === "string" ? { url: manifest.downloadUrl } : null,
  ].filter(Boolean);
  const chosen = candidates.find((x) => typeof x?.url === "string" && x.url.trim()) || null;
  return chosen ? { ...chosen, platform: chosen.platform || exact } : null;
}

async function fetchUpdateManifest(feedUrl) {
  const u = validateHttpUrl(feedUrl, "更新源地址");
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(u.href, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "application/json,text/json,*/*" },
    });
    if (!res.ok) {
      throw new Error(`更新源返回 HTTP ${res.status}`);
    }
    const text = await res.text();
    let manifest;
    try {
      manifest = JSON.parse(text);
    } catch {
      throw new Error("更新源不是有效 JSON。");
    }
    if (manifest?.enabled === false) {
      return { disabled: true, message: manifest?.message || "发布者暂时关闭更新通道。" };
    }
    const latestVersion = String(manifest?.version || manifest?.latestVersion || "").trim();
    if (!/^\d+\.\d+\.\d+/.test(latestVersion)) {
      throw new Error("更新源缺少 version，例如 1.0.60。");
    }
    const download = pickUpdateDownload(manifest);
    let downloadUrl = download?.url || "";
    if (downloadUrl) {
      try {
        downloadUrl = new URL(downloadUrl, u.href).href;
      } catch {
        downloadUrl = "";
      }
    }
    return {
      disabled: false,
      name: String(manifest?.name || "藏经阁"),
      currentVersion: app.getVersion(),
      latestVersion,
      hasUpdate: compareVersions(latestVersion, app.getVersion()) > 0,
      mandatory: Boolean(manifest?.mandatory),
      releaseDate: String(manifest?.releaseDate || manifest?.publishedAt || ""),
      notes: Array.isArray(manifest?.notes)
        ? manifest.notes.map((x) => String(x))
        : String(manifest?.notes || manifest?.releaseNotes || "").trim(),
      downloadUrl,
      sha256: download?.sha256 || "",
      fileName: download?.fileName || "",
      platform: download?.platform || `${process.platform}-${process.arch}`,
      raw: manifest,
    };
  } finally {
    clearTimeout(tid);
  }
}

function createWindow() {
  const iconPngPath = path.join(__dirname, "assets", "app-icon.png");
  const icon = nativeImage.createFromPath(iconPngPath);

  const manifest = getDesktopManifest();
  const win = new BrowserWindow({
    title: manifest.windowTitle,
    width: 1320,
    height: 880,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"), {
    query: { wt: encodeURIComponent(manifest.windowTitle) },
  });
}

app.whenReady().then(() => {
  ipcMain.handle("desktop-manifest-get", async () => getDesktopManifest());

  ipcMain.handle("app-update-check", async (_event, payload) => {
    const feedUrl = payload?.feedUrl;
    if (!feedUrl || typeof feedUrl !== "string") {
      throw new Error("请先填写更新源 JSON 地址。");
    }
    return fetchUpdateManifest(feedUrl);
  });

  ipcMain.handle("open-external-url", async (_event, payload) => {
    const u = validateHttpUrl(payload?.url, "打开链接");
    await shell.openExternal(u.href);
    return { ok: true };
  });

  ipcMain.handle("api-key-get", async () => {
    const value = loadApiKeySecurely();
    return { value };
  });

  ipcMain.handle("api-key-set", async (_event, payload) => {
    const { value } = payload || {};
    if (typeof value !== "string") {
      throw new Error("Invalid API key value.");
    }
    saveApiKeySecurely(value.trim());
    return { ok: true };
  });

  ipcMain.handle("api-key-clear", async () => {
    saveApiKeySecurely("");
    return { ok: true };
  });

  ipcMain.handle("run-analysis", async (_event, payload) => {
    const { apiKey, prompt, data, model } = payload || {};
    const key = resolveApiKey(apiKey);
    return runStructuredAnalysis({ apiKey: key, prompt, data, model });
  });

  ipcMain.handle("openai-key-status", async () => {
    const env = Boolean((process.env.OPENAI_API_KEY || "").trim());
    const stored = Boolean(loadApiKeySecurely().trim());
    return { hasEnvKey: env, hasStoredKey: stored };
  });

  /**
   * 轻量校验 OpenAI Key 是否可用。
   * 调用 GET /v1/models（成本极低、不消耗对话额度），把状态翻译成中文。
   * 同时检查 key 字符串里是不是混进了掩码 / 不可见字符，提前拦下"复制时带星号"这种最常见的坑。
   */
  ipcMain.handle("api-key-test", async (_event, payload) => {
    const explicit = typeof payload?.apiKey === "string" ? payload.apiKey : "";
    const key = resolveApiKey(explicit);
    if (!key) {
      return { ok: false, status: 0, reason: "empty", message: "未填写 API Key。请在上方输入框粘贴 sk- 开头的密钥后保存。" };
    }
    if (/\s/.test(key)) {
      return { ok: false, status: 0, reason: "whitespace", message: "Key 里混入了空格或换行，OpenAI 一定会拒绝。请去 OpenAI Dashboard 重新「Copy」整段 Key，重新保存。" };
    }
    if (/[*\u2022]|\.{3,}|…/.test(key)) {
      return { ok: false, status: 0, reason: "masked", message: "Key 里含有 *、… 等掩码字符。这通常是因为你只看到了控制台里被隐藏的中段。请在 OpenAI Dashboard 重新生成（Create new secret key）一把，一次性 Copy 整段。" };
    }
    if (!/^sk-[A-Za-z0-9_\-]{16,}$/.test(key)) {
      return { ok: false, status: 0, reason: "format", message: "Key 格式不像有效 OpenAI 密钥（应以 sk- 开头、20+ 位字母数字）。请检查粘贴是否完整。" };
    }
    try {
      const resp = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
      });
      if (resp.ok) {
        return { ok: true, status: resp.status, message: "✓ Key 可用，云端连通正常。" };
      }
      let body = "";
      try { body = await resp.text(); } catch { /* ignore */ }
      let detail = "";
      try {
        const j = JSON.parse(body);
        detail = j?.error?.message || "";
      } catch { detail = body; }
      const map = {
        401: "Key 被 OpenAI 拒绝（401 invalid_api_key）。最常见的两种：① Key 已被 revoke 或所在 project 被删；② 复制时漏了字符或带了掩码。请去 https://platform.openai.com/api-keys 重新生成一把。",
        403: "Key 没有当前接口的访问权限（403）。检查该 project 是否启用了所需模型。",
        429: "请求被限流或额度已用完（429）。如果是 quota 用尽，需要去 OpenAI 账户绑卡 / 充值。",
        500: "OpenAI 服务暂时异常（500），稍后重试即可。",
        502: "OpenAI 上游网关错误（502），稍后重试。",
        503: "OpenAI 服务暂时不可用（503），稍后重试。",
      };
      return {
        ok: false,
        status: resp.status,
        reason: "openai",
        message: (map[resp.status] || `OpenAI 返回 ${resp.status}`) + (detail ? `\n\n[原文] ${detail}` : ""),
      };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        reason: "network",
        message: `无法连接 OpenAI：${e?.message || e}。\n可能是：网络断开 / 防火墙拦截 / 需要科学上网 / DNS 解析失败。`,
      };
    }
  });

  ipcMain.handle("ingest-buffer", async (_event, payload) => {
    const { fileName, base64, apiKey } = payload || {};
    const result = await ingestBufferToResult({ fileName, base64, apiKey });
    return { meta: result.meta, content: result.content, markdownPreview: result.markdownPreview || "" };
  });

  ipcMain.handle("workspace-run-analysis", async (_event, payload) => {
    const { apiKey, mode, userInstruction, documentText, model, depth } = payload || {};
    const key = resolveApiKey(apiKey);
    return runWorkspaceInsightAnalysis({
      apiKey: key,
      mode: typeof mode === "string" ? mode : "business",
      userInstruction: typeof userInstruction === "string" ? userInstruction : "",
      documentText: typeof documentText === "string" ? documentText : "",
      model,
      depth: typeof depth === "string" ? depth : "standard",
    });
  });

  ipcMain.handle("pick-file", async (_event, payload) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: dialogs.pickFile,
      properties: ["openFile"],
      filters: getPickFileDialogFilters(),
    });
    if (canceled || filePaths.length === 0) {
      return { canceled: true };
    }
    const filePath = filePaths[0];
    const ext = path.extname(filePath).toLowerCase();
    const key = resolveApiKey(payload?.apiKey);
    const { meta, content, markdownPreview } = await ingestLocalFile(filePath, { apiKey: key });
    return {
      canceled: false,
      filePath,
      fileName: path.basename(filePath),
      extension: ext,
      content,
      meta,
      markdownPreview: markdownPreview || "",
    };
  });

  ipcMain.handle("pick-folder-files", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: dialogs.pickFolderBatch,
      properties: ["openDirectory"],
    });
    if (canceled || filePaths.length === 0) {
      return { canceled: true };
    }
    const folderPath = filePaths[0];
    const files = await readSupportedFilesFromFolder(folderPath);
    return { canceled: false, folderPath, files };
  });

  ipcMain.handle("generate-file", async (_event, payload) => {
    const { apiKey, instruction, sourceFileName, sourceContent, model, genTypeKey, genControls } = payload || {};
    const key = resolveApiKey(apiKey);
    const gk = typeof genTypeKey === "string" && genTypeKey.trim() ? genTypeKey.trim() : "";
    let typeTail = "";
    if (gk === "bp") {
      typeTail =
        "\n\n【商业计划书·硬性要求】输出中文 Markdown；**全文中文字符不少于 5200 字**（过短视为不合格）。必须包含并充分展开：执行摘要；公司与愿景；市场机会与规模（须含 TAM/SAM/SOM 占位表）；目标客户与获客策略；产品/服务与技术路线；商业模式与定价；竞争格局与壁垒；营销与销售体系；运营计划与关键里程碑；管理团队与组织架构；财务预测与核心假设（**至少 2 张** Markdown 表：如利润表摘要、现金流或敏感性）；融资需求与资金用途；风险因素与缓释；附录。每个大章节下**不少于 3 个 ### 子节**，每子节**不少于两段**正文；禁止只列标题。文末可附一小段 **TSV**（三年收入/毛利/净利）便于粘贴 Excel。";
    } else if (["im", "dd_report", "fin_analysis", "market_deep", "comp_report", "feasibility"].includes(gk)) {
      typeTail = `\n\n【长文档类型：${gk}】须输出**不少于 4500 汉字**的专业 Markdown；多层级标题、表格与编号列表；禁止简略提纲式回答。`;
    } else if (gk) {
      typeTail = `\n\n（文档类型预设：${gk}。须输出**不少于 3200 汉字**的可交付长文 Markdown，含必要表格；表格类文档可在文末附 TSV。）`;
    }
    let ctrlTail = "";
    if (genControls && typeof genControls === "object") {
      const c = genControls;
      const bits = [];
      if (c.docPurpose) bits.push(`文档用途：${String(c.docPurpose)}`);
      if (c.docAudience) bits.push(`受众画像：${String(c.docAudience)}`);
      if (c.docStructure) bits.push(`输出结构：${String(c.docStructure)}`);
      if (c.lengthTier) bits.push(`长度档位：${String(c.lengthTier)}`);
      if (c.purpose) bits.push(`用途（自由）：${String(c.purpose)}`);
      if (c.audience) bits.push(`受众（自由）：${String(c.audience)}`);
      if (c.length) bits.push(`篇幅说明：${String(c.length)}`);
      if (c.industry) bits.push(`行业：${String(c.industry)}`);
      if (c.citeFiles != null) bits.push(`引用上传文件：${c.citeFiles ? "是" : "否"}`);
      if (bits.length) ctrlTail = `\n\n（写作控制：${bits.join("；")}）`;
    }
    if (genControls && genControls.citeFiles === true) {
      ctrlTail +=
        "\n\n【引用标注】凡引用上传文件必须在段落末或脚注标明文件名与摘录位置（可使用 Markdown 脚注或括号出处）；勿留无法核验的断言。";
    }
    const deliverableTail =
      "\n\n【交付质量】正文须可直接对外使用（仅需读者微调公司与数字）：禁止孤立占位词（「示例」「样板」「待补充」「TBD」「XXX」「此处填写」等）；表格单元格须有实质内容；虚构数据须写成完整可信叙述并可标注假设。";
    return generateFileFromInstruction({
      apiKey: key,
      instruction: `${String(instruction ?? "")}${typeTail}${ctrlTail}${deliverableTail}`,
      sourceFileName,
      sourceContent,
      model,
    });
  });

  ipcMain.handle("run-creative-task", async (_event, payload) => {
    const { apiKey, instruction, sourceContent, model } = payload || {};
    const key = resolveApiKey(apiKey);
    return runCreativeTask({ apiKey: key, instruction, sourceContent, model });
  });

  ipcMain.handle("copy-image-base64", (_event, payload) => {
    const b64 = payload?.b64;
    if (!b64 || typeof b64 !== "string") {
      throw new Error("无图片数据。");
    }
    let buf;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      throw new Error("图片数据无效。");
    }
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) {
      throw new Error("无效图片，无法写入剪贴板。");
    }
    clipboard.writeImage(img);
    return { ok: true };
  });

  ipcMain.handle("save-generated-file", async (_event, payload) => {
    const { suggestedName, content, format } = payload || {};
    const selectedFormat = SAVE_GENERATED_FORMATS.has(format) ? format : "txt";
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: dialogs.saveGenerated,
      defaultPath: suggestedName || `generated-file.${selectedFormat}`,
      filters: getSaveGeneratedFilters(selectedFormat),
    });
    if (canceled || !filePath) {
      return { canceled: true };
    }

    await writeGeneratedExportToPath(filePath, selectedFormat, content, payload);
    return { canceled: false, filePath };
  });

  ipcMain.handle("save-deliverable-bundle", async (_event, payload) => {
    const { items } = payload || {};
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("交付包为空。");
    }
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: dialogs.selectDeliverableBundleFolder,
      properties: ["openDirectory", "createDirectory"],
    });
    if (canceled || !filePaths?.length) {
      return { canceled: true };
    }
    const outputDir = filePaths[0];
    const embedDefault = Boolean(payload?.embedPdfImages);
    for (const it of items) {
      const safeName = String(it.fileName || "output.bin").replace(/[\\/:*?"<>|]/g, "_");
      const fp = path.join(outputDir, safeName);
      const fmt = SAVE_GENERATED_FORMATS.has(it.format) ? it.format : "txt";
      await writeGeneratedExportToPath(fp, fmt, String(it.content ?? ""), {
        embedPdfImages: it.embedPdfImages != null ? Boolean(it.embedPdfImages) : embedDefault,
        exportMeta:
          it.exportMeta && typeof it.exportMeta === "object"
            ? it.exportMeta
            : payload?.exportMeta && typeof payload.exportMeta === "object"
              ? payload.exportMeta
              : {},
      });
    }
    return { canceled: false, outputDir, count: items.length };
  });

  ipcMain.handle("save-image-file", async (_event, payload) => {
    const { b64, suggestedName } = payload || {};
    if (!b64 || typeof b64 !== "string") {
      throw new Error("Missing image bytes.");
    }
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: dialogs.saveImage,
      defaultPath: suggestedName || "image.png",
      filters: getPngFileFilter(),
    });
    if (canceled || !filePath) {
      return { canceled: true };
    }
    const buffer = Buffer.from(b64, "base64");
    fs.writeFileSync(filePath, buffer);
    return { canceled: false, filePath };
  });

  ipcMain.handle("save-batch-results", async (_event, payload) => {
    const { items, format } = payload || {};
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("No batch items to save.");
    }
    const selectedFormat = SAVE_GENERATED_FORMATS.has(format) ? format : "txt";
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: dialogs.selectBatchOutputFolder,
      properties: ["openDirectory", "createDirectory"],
    });
    if (canceled || filePaths.length === 0) {
      return { canceled: true };
    }
    const outputDir = filePaths[0];
    const exportMetaBase = payload?.exportMeta && typeof payload.exportMeta === "object" ? payload.exportMeta : {};
    for (const item of items) {
      const safeBase = String(item.fileName || "output")
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\.[^.]+$/, "");
      const ext =
        selectedFormat === "slides_html"
          ? "html"
          : selectedFormat === "md"
            ? "md"
            : selectedFormat;
      const filePath = path.join(outputDir, `${safeBase}.${ext}`);
      const exportMeta = { ...exportMetaBase, title: exportMetaBase.title || safeBase.replace(/_/g, " ") };
      await writeGeneratedExportToPath(filePath, selectedFormat, item.content, {
        embedPdfImages: Boolean(payload?.embedPdfImages),
        exportMeta,
      });
    }
    return { canceled: false, outputDir, count: items.length };
  });

  ipcMain.handle("export-template-market", async (_event, payload) => {
    const { jsonText } = payload || {};
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: dialogs.exportTemplateMarket,
      defaultPath: "template-market.json",
      filters: getJsonFileFilter(),
    });
    if (canceled || !filePath) {
      return { canceled: true };
    }
    fs.writeFileSync(filePath, String(jsonText ?? "{}"), "utf8");
    return { canceled: false, filePath };
  });

  ipcMain.handle("import-template-market", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: dialogs.importTemplateMarket,
      properties: ["openFile"],
      filters: getJsonFileFilter(),
    });
    if (canceled || filePaths.length === 0) {
      return { canceled: true };
    }
    const filePath = filePaths[0];
    const jsonText = fs.readFileSync(filePath, "utf8");
    return { canceled: false, filePath, jsonText };
  });

  ipcMain.handle("copy-text", (_event, text) => {
    clipboard.writeText(String(text ?? ""));
    return { ok: true };
  });

  ipcMain.handle("save-buffer-dialog", async (_event, payload) => {
    const { defaultName, base64 } = payload || {};
    if (!defaultName || !base64) throw new Error("缺少文件名或数据。");
    const buf = Buffer.from(base64, "base64");
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: dialogs.saveGenerated,
      defaultPath: defaultName,
      filters: [{ name: "文件", extensions: ["*"] }],
    });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, buf);
    return { canceled: false, filePath };
  });

  ipcMain.handle("export-report", async (_event, payload) => {
    const { type, content, suggestedName } = payload || {};
    const selectedType = type === "md" || type === "csv" ? type : "txt";
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: dialogs.exportReport,
      defaultPath: suggestedName || `ai-report.${selectedType}`,
      filters: getExportReportFilters(selectedType),
    });
    if (canceled || !filePath) {
      return { canceled: true };
    }
    fs.writeFileSync(filePath, String(content ?? ""), "utf8");
    return { canceled: false, filePath };
  });

  ipcMain.handle("library-list", async () => libraryStore.listLibraryItems());

  ipcMain.handle("library-add-from-path", async (_event, payload) => {
    const { filePath, apiKey } = payload || {};
    if (!filePath || typeof filePath !== "string") throw new Error("缺少 filePath。");
    const key = resolveApiKey(apiKey);
    const { record, content, markdownPreview } = await libraryStore.addFromPath(filePath, key);
    return { record, content, markdownPreview };
  });

  ipcMain.handle("library-add-from-buffer", async (_event, payload) => {
    const { fileName, base64, apiKey } = payload || {};
    if (!fileName || !base64) throw new Error("缺少文件数据。");
    const key = resolveApiKey(apiKey);
    const buf = Buffer.from(base64, "base64");
    const { record, content, markdownPreview } = await libraryStore.addFromBuffer(fileName, buf, key);
    return { record, content, markdownPreview };
  });

  ipcMain.handle("library-reparse", async (_event, payload) => {
    const { id, apiKey } = payload || {};
    if (!id) throw new Error("缺少 id。");
    const key = resolveApiKey(apiKey);
    return libraryStore.reparseItem(id, key);
  });

  ipcMain.handle("library-delete", async (_event, payload) => {
    const { id } = payload || {};
    if (!id) throw new Error("缺少 id。");
    libraryStore.deleteItem(id);
    return { ok: true };
  });

  ipcMain.handle("library-get-content", async (_event, payload) => {
    const { id, apiKey } = payload || {};
    if (!id) throw new Error("缺少 id。");
    const key = resolveApiKey(apiKey);
    return libraryStore.getFullText(id, key);
  });

  ipcMain.handle("library-update-tags", async (_event, payload) => {
    const { id, tags } = payload || {};
    if (!id) throw new Error("缺少 id。");
    return libraryStore.updateTags(id, tags);
  });

  ipcMain.handle("library-open-original", async (_event, payload) => {
    const { id } = payload || {};
    if (!id) throw new Error("缺少 id。");
    libraryStore.openOriginal(id);
    return { ok: true };
  });

  ipcMain.handle("library-get-preview", async (_event, payload) => {
    const { id, apiKey } = payload || {};
    if (!id) throw new Error("缺少 id。");
    const key = resolveApiKey(apiKey);
    return libraryStore.getPreview(id, key);
  });

  ipcMain.handle("library-save-text-content", async (_event, payload) => {
    const { id, text, apiKey } = payload || {};
    if (!id) throw new Error("缺少 id。");
    const key = resolveApiKey(apiKey);
    return libraryStore.saveTextContent(id, String(text ?? ""), key);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
