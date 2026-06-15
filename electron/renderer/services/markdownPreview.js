/* 使用相对路径：打包后 file:// + asar 下裸包名 `marked` 常无法解析，会导致整页脚本失败 */
import { marked } from "../../../node_modules/marked/lib/marked.esm.js";
import DOMPurify from "../../../node_modules/dompurify/dist/purify.es.mjs";

marked.setOptions({ gfm: true, breaks: false, async: false });

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Markdown → 安全 HTML（用于应用内预览；仅渲染进程有 DOM）
 * @param {string} md
 * @returns {string}
 */
export function markdownToSafeHtml(md) {
  const raw = marked.parse(String(md ?? ""));
  if (typeof raw !== "string") {
    throw new Error("Markdown 解析返回非字符串");
  }
  if (typeof DOMPurify.sanitize !== "function") {
    return escapeHtml(raw);
  }
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

/**
 * Inject stable ids on h2/h3 for in-app TOC navigation (preview only).
 * @param {string} html
 * @returns {string}
 */
export function injectHeadingAnchors(html) {
  let n = 0;
  return String(html || "").replace(/<h([2-3])([^>]*)>([\s\S]*?)<\/h\1>/gi, (full, level, attrs, inner) => {
    const a = attrs || "";
    if (/\bid\s*=/.test(a)) return full;
    const plain = inner.replace(/<[^>]+>/g, "").trim();
    const slug = `sec-${++n}-${slugifyHeading(plain)}`;
    return `<h${level}${a} id="${escapeHtmlAttr(slug)}">${inner}</h${level}>`;
  });
}

/**
 * @param {string} md
 */
export function markdownToSafeHtmlWithAnchors(md) {
  return injectHeadingAnchors(markdownToSafeHtml(md));
}

/**
 * Build a compact TOC `<nav>` from preview HTML (expects ids on headings).
 * @param {string} html
 */
export function buildPreviewTocHtml(html) {
  const re = /<h([2-3])[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/gi;
  const items = [];
  let m;
  while ((m = re.exec(String(html || ""))) !== null) {
    const depth = m[1] === "3" ? 2 : 1;
    const id = m[2];
    const label = m[3].replace(/<[^>]+>/g, "").trim();
    if (!id || !label) continue;
    items.push({ depth, id, label });
  }
  if (!items.length) return `<p class="wb-toc-empty">（暂无目录）</p>`;
  const lis = items
    .map(
      (it) =>
        `<li class="wb-toc-li wb-toc-depth-${it.depth}"><a href="#${escapeHtmlAttr(it.id)}">${escapeHtml(
          it.label
        )}</a></li>`
    )
    .join("");
  return `<nav class="wb-toc-nav" aria-label="目录"><ul class="wb-toc-ul">${lis}</ul></nav>`;
}

function slugifyHeading(s) {
  return String(s)
    .slice(0, 36)
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "section";
}

function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 可用于清单同步的主题 id（与 UI value 一致） */
export const HTML_PRINT_THEME_IDS = ["default", "slate", "forest", "rose", "midnight"];

const PRINT_THEME_VARS = {
  default:
    ":root { --p-text:#1e293b; --p-muted:#64748b; --p-border:#e2e8f0; --p-accent:#4f46e5; --p-cover-title:#0f172a; --p-body-bg:#ffffff; }",
  slate:
    ":root { --p-text:#0f172a; --p-muted:#475569; --p-border:#cbd5e1; --p-accent:#0ea5e9; --p-cover-title:#020617; --p-body-bg:#f8fafc; }",
  forest:
    ":root { --p-text:#14532d; --p-muted:#3f6212; --p-border:#bbf7d0; --p-accent:#15803d; --p-cover-title:#052e16; --p-body-bg:#f7fee7; }",
  rose:
    ":root { --p-text:#4c0519; --p-muted:#9f1239; --p-border:#fecdd3; --p-accent:#be123c; --p-cover-title:#881337; --p-body-bg:#fff1f2; }",
  midnight:
    ":root { --p-text:#e2e8f0; --p-muted:#94a3b8; --p-border:#334155; --p-accent:#818cf8; --p-cover-title:#f8fafc; --p-body-bg:#0f172a; }",
};

/**
 * @param {string} [themeId]
 */
export function buildPrintDocumentCss(themeId = "default") {
  const tid = PRINT_THEME_VARS[themeId] ? themeId : "default";
  const vars = PRINT_THEME_VARS[tid];
  const midnightExtras =
    tid === "midnight"
      ? `
  body { background: var(--p-body-bg); color: var(--p-text); }
  .doc-print-cover .doc-cover-title { color: var(--p-cover-title) !important; }
  .doc-toc { background: #1e293b !important; border-color: var(--p-border) !important; }
  .doc-toc-title { color: #f8fafc !important; }
  .doc-toc li { color: #cbd5e1 !important; }
  .doc-prose h2 { color: #f1f5f9 !important; }
  .doc-prose h3 { color: #e2e8f0 !important; }
  .doc-prose th { background: #1e293b !important; color: #e2e8f0; }
  .doc-prose blockquote { background: #1e293b !important; color: #cbd5e1 !important; }
  .doc-prose code { background: #334155 !important; color: #f8fafc; }
  .doc-prose pre { background: #020617 !important; }
  @media print {
    :root { --p-text:#1e293b; --p-muted:#64748b; --p-border:#e2e8f0; --p-accent:#4f46e5; --p-cover-title:#0f172a; --p-body-bg:#ffffff; }
    body { background: #fff !important; color: #1e293b !important; }
    .doc-print-cover .doc-cover-title { color: #0f172a !important; }
    .doc-toc { background: #f8fafc !important; border-color: #e2e8f0 !important; }
    .doc-toc-title { color: #0f172a !important; }
    .doc-toc li { color: #334155 !important; }
    .doc-prose h2, .doc-prose h3 { color: inherit !important; }
    .doc-prose th { background: #f1f5f9 !important; color: inherit !important; }
    .doc-prose blockquote { background: #f8fafc !important; color: #334155 !important; }
    .doc-prose code { background: #f1f5f9 !important; color: inherit !important; }
    .doc-prose pre { background: #0f172a !important; color: #e2e8f0 !important; }
  }
`
      : "";
  return `
  ${vars}
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 32px 48px; font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; color: var(--p-text); background: var(--p-body-bg); }
  ${midnightExtras}
  .doc-confidential-strip { font-size: 0.78rem; font-weight: 650; color: #b45309; margin: 0 0 10px; letter-spacing: 0.04em; }
  .doc-prose { font-size: 15px; line-height: 1.7; max-width: 820px; margin: 0 auto; }
  .doc-prose h1 { font-size: 1.85rem; font-weight: 700; margin: 1.25em 0 0.45em; padding-bottom: 0.35em; border-bottom: 2px solid var(--p-border); letter-spacing: -0.02em; }
  .doc-prose h2 { font-size: 1.35rem; font-weight: 650; margin: 1.1em 0 0.4em; color: var(--p-cover-title); }
  .doc-prose h3 { font-size: 1.12rem; font-weight: 600; margin: 1em 0 0.35em; color: var(--p-muted); }
  .doc-prose h4, .doc-prose h5, .doc-prose h6 { font-size: 1rem; font-weight: 600; margin: 0.85em 0 0.3em; }
  .doc-prose p { margin: 0.55em 0; }
  .doc-prose ul, .doc-prose ol { margin: 0.5em 0; padding-left: 1.35em; }
  .doc-prose li { margin: 0.25em 0; }
  .doc-prose blockquote { margin: 1em 0; padding: 0.5em 0 0.5em 1em; border-left: 4px solid var(--p-accent); background: #f8fafc; color: #334155; }
  .doc-prose code { font-family: Consolas, "Cascadia Code", ui-monospace, monospace; font-size: 0.88em; background: #f1f5f9; padding: 0.12em 0.35em; border-radius: 4px; }
  .doc-prose pre { background: #0f172a; color: #e2e8f0; padding: 14px 16px; border-radius: 10px; overflow: auto; font-size: 0.86rem; line-height: 1.5; }
  .doc-prose pre code { background: none; color: inherit; padding: 0; }
  .doc-prose table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.92rem; }
  .doc-prose th, .doc-prose td { border: 1px solid var(--p-border); padding: 8px 12px; text-align: left; vertical-align: top; }
  .doc-prose th { background: #f1f5f9; font-weight: 600; }
  .doc-prose img { max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 1em auto; }
  .doc-prose hr { border: none; border-top: 1px solid var(--p-border); margin: 1.5em 0; }
  .doc-prose a { color: var(--p-accent); }
  .doc-print-cover { border-bottom: 1px solid var(--p-border); padding-bottom: 18px; margin-bottom: 22px; page-break-after: avoid; }
  .doc-print-cover .doc-cover-kicker { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--p-muted); margin: 0 0 6px; }
  .doc-print-cover .doc-cover-title { font-size: 1.65rem; font-weight: 700; margin: 0 0 10px; letter-spacing: -0.02em; color: var(--p-cover-title); }
  .doc-print-cover .doc-cover-meta { font-size: 0.88rem; color: var(--p-muted); line-height: 1.65; margin: 0; white-space: pre-wrap; }
  .doc-toc { margin: 0 0 26px; padding: 14px 18px; background: #f8fafc; border: 1px solid var(--p-border); border-radius: 10px; page-break-inside: avoid; }
  .doc-toc-title { font-weight: 650; margin: 0 0 10px; font-size: 0.92rem; color: var(--p-cover-title); }
  .doc-toc ul { margin: 0; padding: 0; list-style: none; }
  .doc-toc li { margin: 5px 0; font-size: 0.88rem; line-height: 1.45; color: #334155; }
  @media print { body { padding: 12px; } .doc-prose { max-width: none; } .doc-print-cover { margin-bottom: 16px; } }
`;
}

/**
 * @param {string} md
 * @returns {{ level: number, text: string }[]}
 */
function extractMdOutline(md) {
  const lines = String(md ?? "").split(/\r?\n/);
  /** @type {{ level: number, text: string }[]} */
  const out = [];
  for (const line of lines) {
    const m = line.trim().match(/^(#{1,6})\s+(.+)$/);
    if (!m) continue;
    let text = m[2].trim();
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[(.*?)\]\([^)]*\)/g, "$1").trim();
    out.push({ level: m[1].length, text });
  }
  return out;
}

/**
 * @param {string} md
 * @returns {string}
 */
function buildTocHtml(md) {
  const items = extractMdOutline(md);
  if (!items.length) return "";
  const lis = items
    .map((it) => {
      const pad = Math.min(Math.max(it.level - 1, 0), 6) * 15;
      return `<li style="padding-left:${pad}px">${escapeHtml(it.text)}</li>`;
    })
    .join("");
  return `<nav class="doc-toc" aria-label="目录"><div class="doc-toc-title">目录</div><ul>${lis}</ul></nav>`;
}

/**
 * @param {Record<string, unknown>=} meta
 */
function formatHtmlCoverMeta(meta) {
  const m = meta && typeof meta === "object" ? meta : {};
  const parts = [];
  const cl = String(m.confidentialLevel || "").trim();
  if (cl === "internal") parts.push("内部资料 · 请勿擅自对外转发");
  if (cl === "confidential") parts.push("保密文件 · 仅限授权人员查阅");
  const pu = String(m.purpose || m.projectName || "").trim();
  const au = String(m.audience || "").trim();
  if (pu) parts.push(pu);
  if (au) parts.push(`读者：${au}`);
  const iso = m.generatedAt ? String(m.generatedAt) : "";
  let when;
  try {
    const d = iso ? new Date(iso) : new Date();
    when = Number.isNaN(d.getTime()) ? new Date().toLocaleString("zh-CN", { hour12: false }) : d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    when = new Date().toLocaleString("zh-CN", { hour12: false });
  }
  parts.push(when);
  return parts.join(" · ");
}

/**
 * Markdown 导出前写入 YAML front matter（交付元数据）。
 * @param {string} md
 * @param {Record<string, unknown>=} meta
 */
export function prependDeliverableYaml(md, meta = {}) {
  const body = String(md ?? "");
  const m = meta && typeof meta === "object" ? meta : {};
  const titleRaw = String(m.title || "").trim();
  const h1 = body.match(/^\s*#\s+(.+)$/m);
  const title = titleRaw || (h1 ? h1[1].trim() : "") || "未命名文稿";
  const lines = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `generated_at: "${m.generatedAt ? String(m.generatedAt) : new Date().toISOString()}"`,
    `generator: "AI Content Studio Pro"`,
    `language: zh-CN`,
    `status: draft`,
    `version: "V1.0"`,
  ];
  const pn = String(m.projectName || "").trim();
  const pu = String(m.purpose || "").trim();
  const au = String(m.audience || "").trim();
  if (pn) lines.push(`project: ${JSON.stringify(pn)}`);
  if (pu) lines.push(`purpose: ${JSON.stringify(pu)}`);
  if (au) lines.push(`audience: ${JSON.stringify(au)}`);
  const cl = String(m.confidentialLevel || "").trim();
  if (cl && cl !== "public") lines.push(`confidential_level: ${JSON.stringify(cl)}`);
  lines.push("# 以上为交付元数据；对外发行前可按需删减。", "---", "");
  return `${lines.join("\n")}${body}`;
}

/**
 * @param {Record<string, unknown>=} meta
 */
function confidentialBannerHtml(meta) {
  const m = meta && typeof meta === "object" ? meta : {};
  const cl = String(m.confidentialLevel || "").trim();
  if (cl === "internal") return `<p class="doc-confidential-strip">内部资料 · 请勿擅自对外转发</p>`;
  if (cl === "confidential") return `<p class="doc-confidential-strip">保密文件 · 仅限授权人员查阅</p>`;
  return "";
}

/**
 * 由 Markdown 按 `#` / `##` 切块生成演示级单文件 HTML（键盘 ← → 翻页）。
 * @param {string} md
 * @param {string} [title]
 * @param {Record<string, unknown>=} [meta]
 * @param {{ themeId?: string }=} opts
 */
export function buildSlidesHtmlDocument(md, title = "Slides", meta = {}, opts = {}) {
  const themeId = opts.themeId && HTML_PRINT_THEME_IDS.includes(opts.themeId) ? opts.themeId : "slate";
  const slides = splitMarkdownIntoSlides(md, title);
  const t = escapeHtmlAttr(String(title || "Slides").slice(0, 200));
  const metaLine = escapeHtml(formatHtmlCoverMeta(meta));
  const slideSections = slides
    .map(
      (s, idx) => `
<section class="slide" id="s-${idx}" tabindex="0">
  <div class="slide-inner">
    <h2 class="slide-title">${escapeHtml(s.title)}</h2>
    <div class="slide-body doc-prose">${markdownToSafeHtml(s.bodyMd)}</div>
    <span class="slide-idx">${idx + 1} / ${slides.length}</span>
  </div>
</section>`
    )
    .join("\n");
  const accent =
    themeId === "forest"
      ? "#15803d"
      : themeId === "rose"
        ? "#be123c"
        : themeId === "midnight"
          ? "#818cf8"
          : "#0ea5e9";
  const css = `
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; font-family: "Segoe UI","Microsoft YaHei",system-ui,sans-serif; background: #0f172a; color: #e2e8f0; }
  .deck-toolbar { position: fixed; top: 0; left: 0; right: 0; z-index: 20; padding: 10px 18px; font-size: 0.78rem; background: rgba(15,23,42,0.92); border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .deck-toolbar span { color: #94a3b8; }
  .deck-stage { height: 100vh; overflow-y: scroll; scroll-snap-type: y mandatory; scroll-behavior: smooth; padding-top: 46px; }
  .slide { min-height: calc(100vh - 46px); scroll-snap-align: start; display: flex; align-items: stretch; justify-content: center; padding: 28px 20px 40px; border-bottom: 1px solid #1e293b; }
  .slide-inner { width: min(960px, 100%); position: relative; padding: 28px 32px 48px; border-radius: 14px; background: linear-gradient(145deg, #1e293b 0%, #0f172a 100%); box-shadow: 0 18px 50px rgba(0,0,0,0.35); border: 1px solid #334155; }
  .slide-title { margin: 0 0 18px; font-size: 1.65rem; color: #f8fafc; border-left: 5px solid ${accent}; padding-left: 14px; line-height: 1.35; }
  .slide-body { font-size: 1.02rem; line-height: 1.62; color: #cbd5e1; max-height: min(62vh, 520px); overflow: auto; }
  .slide-body table { font-size: 0.88rem; }
  .slide-body th { background: #334155 !important; color: #f8fafc !important; }
  .slide-body td { border-color: #475569 !important; }
  .slide-idx { position: absolute; right: 22px; bottom: 18px; font-size: 0.72rem; color: #64748b; }
  .deck-help { font-size: 0.72rem; color: #64748b; }
`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${t}</title>
<style>${css}</style>
</head>
<body>
<nav class="deck-toolbar"><strong style="color:${accent}">${t}</strong><span>${metaLine}</span><span class="deck-help">← → 翻页 · P 演讲者备注见正文底部</span></nav>
<div class="deck-stage" id="deck">${slideSections}</div>
<script>
(function(){
  var deck=document.getElementById('deck'); if(!deck) return;
  var slides=[].slice.call(deck.querySelectorAll('.slide'));
  function idx(){for(var i=0;i<slides.length;i++){var r=slides[i].getBoundingClientRect(); if(r.top>=-20&&r.top<innerHeight/2)return i;}return 0;}
  document.addEventListener('keydown',function(e){
    var i=idx();
    if(e.key==='ArrowRight'||e.key==='ArrowDown'||e.key==='PageDown'){e.preventDefault(); if(i<slides.length-1) slides[i+1].scrollIntoView({behavior:'smooth'});}
    if(e.key==='ArrowLeft'||e.key==='ArrowUp'||e.key==='PageUp'){e.preventDefault(); if(i>0) slides[i-1].scrollIntoView({behavior:'smooth'});}
  });
})();
</script>
</body>
</html>`;
}

/**
 * @param {string} md
 * @param {string} fallbackTitle
 */
function splitMarkdownIntoSlides(md, fallbackTitle) {
  const lines = String(md ?? "").split(/\r?\n/);
  /** @type {{ title: string, bodyMd: string }[]} */
  const out = [];
  let buf = [];
  let slideTitle = "";

  function flush() {
    const t = slideTitle.trim() || String(fallbackTitle || "演示").trim() || "演示";
    const bodyMd = buf.join("\n").trim();
    buf = [];
    out.push({ title: t, bodyMd: bodyMd || "_（本页可补充要点或表格）_" });
  }

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)\s*$/);
    const h2 = line.match(/^##\s+(.+)\s*$/);
    if (h1) {
      const text = h1[1].trim();
      if (!out.length && !slideTitle && !buf.some((x) => String(x).trim())) {
        slideTitle = text;
        continue;
      }
      flush();
      slideTitle = text;
      continue;
    }
    if (h2) {
      const text = h2[1].trim();
      if (slideTitle || buf.some((x) => String(x).trim())) flush();
      slideTitle = text;
      continue;
    }
    buf.push(line);
  }
  flush();
  return out.length ? out : [{ title: String(fallbackTitle || "演示"), bodyMd: String(md ?? "").trim() || "_" }];
}

/**
 * 自包含 HTML（可用浏览器打开、打印为 PDF；正文中的网络图片会保留）
 * @param {string} md
 * @param {string} [title]
 * @param {Record<string, unknown>=} [meta] 封面与目录元数据（用途、受众、导出时间等）
 * @param {{ themeId?: string }=} [options]
 * @returns {string}
 */
export function buildPrintableHtmlDocument(md, title = "Document", meta = {}, options = {}) {
  const themeId =
    options.themeId && typeof options.themeId === "string" && HTML_PRINT_THEME_IDS.includes(options.themeId)
      ? options.themeId
      : "default";
  const body = markdownToSafeHtml(md);
  const t = escapeHtmlAttr(String(title || "Document").slice(0, 200));
  const coverMeta = escapeHtml(formatHtmlCoverMeta(meta));
  const toc = buildTocHtml(md);
  const confBanner = confidentialBannerHtml(meta);
  const cover = `<header class="doc-print-cover">
${confBanner}
<p class="doc-cover-kicker">交付文稿 · 可直接修订后对外</p>
<h1 class="doc-cover-title">${t}</h1>
<p class="doc-cover-meta">${coverMeta}</p>
</header>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${t}</title>
<style>${buildPrintDocumentCss(themeId)}</style>
</head>
<body>
${cover}
${toc}
<article class="doc-prose doc-prose--report">${body}</article>
</body>
</html>`;
}
