import * as idb from "../services/idbStore.js";
import { el, emptyState } from "../core/ui.js";
import { createUndoController } from "../core/undoController.js";

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escAttr(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escRe(s) {
  return String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fmtTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

function downloadBlob(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

const UNCATEGORIZED = "未分类";

const CATEGORY_PALETTE = [
  { bg: "linear-gradient(135deg, rgba(96,165,250,0.18), rgba(168,85,247,0.16))", bd: "rgba(96,165,250,0.5)", fg: "#bfdbfe" },
  { bg: "linear-gradient(135deg, rgba(250,204,21,0.18), rgba(251,146,60,0.18))", bd: "rgba(250,204,21,0.55)", fg: "#fde68a" },
  { bg: "linear-gradient(135deg, rgba(74,222,128,0.18), rgba(45,212,191,0.16))", bd: "rgba(74,222,128,0.55)", fg: "#bbf7d0" },
  { bg: "linear-gradient(135deg, rgba(248,113,113,0.18), rgba(244,114,182,0.18))", bd: "rgba(248,113,113,0.55)", fg: "#fecaca" },
  { bg: "linear-gradient(135deg, rgba(192,132,252,0.18), rgba(96,165,250,0.16))", bd: "rgba(192,132,252,0.55)", fg: "#e9d5ff" },
  { bg: "linear-gradient(135deg, rgba(45,212,191,0.18), rgba(96,165,250,0.16))", bd: "rgba(45,212,191,0.55)", fg: "#a5f3fc" },
];

function pickPalette(name) {
  const s = String(name || UNCATEGORIZED);
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}

function makeTitle(text) {
  const raw = String(text || "").trim();
  if (!raw) return { head: "", body: "" };
  const firstLine = raw.split(/\r?\n/)[0] || "";
  const sentenceMatch = firstLine.match(/^(.{4,60}?[。！？!?；;.])/);
  if (sentenceMatch) {
    const head = sentenceMatch[1];
    const body = raw.slice(head.length).trim();
    return { head, body };
  }
  if (firstLine.length > 0 && firstLine.length <= 60) {
    const body = raw.slice(firstLine.length).trim();
    return { head: firstLine, body };
  }
  return { head: "", body: raw };
}

function splitBlocks(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const byBlank = raw.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  const lines = raw.split(/\r?\n/);
  const groups = [];
  let cur = [];
  const startRe = /^\s*(?:\d+[\.、)]|[①-⑳]|[-•·*])\s+/;
  for (const ln of lines) {
    if (startRe.test(ln) && cur.length) {
      groups.push(cur.join("\n").trim());
      cur = [ln];
    } else {
      cur.push(ln);
    }
  }
  if (cur.length) groups.push(cur.join("\n").trim());
  const cleaned = groups.filter(Boolean);
  return cleaned.length > 1 ? cleaned : [raw];
}

// 同时转义并按关键词高亮（关键词数组，大小写不敏感）
function highlightHtml(text, keywords) {
  const raw = String(text || "");
  if (!raw) return "";
  const kws = (Array.isArray(keywords) ? keywords : [keywords])
    .map((k) => String(k || "").trim())
    .filter(Boolean);
  if (!kws.length) return escHtml(raw);
  const re = new RegExp(`(${kws.map(escRe).join("|")})`, "gi");
  let out = "";
  let last = 0;
  raw.replace(re, (m, _g, idx) => {
    out += escHtml(raw.slice(last, idx));
    out += `<mark style="background:#fde047;color:#0b1220;padding:0 2px;border-radius:3px;font-weight:600">${escHtml(m)}</mark>`;
    last = idx + m.length;
    return m;
  });
  out += escHtml(raw.slice(last));
  return out;
}

export async function mountPhrasebook(root, ctx) {
  // 清理上一次挂载留下的全局键盘监听，防止重复触发
  if (root.__phbKeydown) {
    document.removeEventListener("keydown", root.__phbKeydown);
    root.__phbKeydown = null;
  }
  root.innerHTML = "";
  const m = ctx.manifest();
  const p = m.pages?.phrasebook || {};
  const presetCats = Array.isArray(p.defaultCategories) ? p.defaultCategories : [];

  root.appendChild(
    el(`
    <div id="phStickyHead" style="position:sticky;top:0;z-index:40;padding:6px 4px 10px;margin:-6px -4px 6px;background:linear-gradient(180deg,rgba(11,18,32,0.96) 0%,rgba(15,23,42,0.94) 80%,rgba(15,23,42,0.6) 100%);backdrop-filter:blur(16px) saturate(140%);-webkit-backdrop-filter:blur(16px) saturate(140%);box-shadow:0 14px 30px rgba(2,6,23,0.45),0 1px 0 rgba(148,163,184,0.16) inset;border-bottom:1px solid rgba(148,163,184,0.22);border-radius:0 0 14px 14px">
    <div class="page-head" style="margin-bottom:8px">
      <div>
        <h1 class="page-title" id="phHeadTitle" style="font-size:2rem;letter-spacing:0.02em;font-weight:900">${escHtml(p.title || "金句库")}</h1>
        <p class="page-sub" id="phHeadSub" style="margin-top:6px;font-size:0.92rem">${escHtml(p.subtitle || "")}</p>
      </div>
      <div class="row" style="flex-wrap:wrap;gap:6px">
        <button type="button" class="btn btn-secondary btn-sm hidden" id="phBackToCats">← 返回分类</button>
        <button type="button" class="btn btn-primary btn-sm" id="phNewProject" title="创建一个新的金句项目 / 分类">新建项目</button>
        <button type="button" class="btn btn-primary btn-sm" id="phAdd" title="新增单条金句（快捷键 N）">${escHtml(p.addBtn || "新增金句")}</button>
        <button type="button" class="btn btn-primary btn-sm" id="phBulk" title="一次粘贴多条金句（快捷键 B）">＋ 批量粘贴</button>
        <button type="button" class="btn btn-secondary btn-sm" id="phExportJson">${escHtml(p.exportBtn || "导出 JSON")}</button>
        <button type="button" class="btn btn-secondary btn-sm" id="phExportTxt">${escHtml(p.exportTxtBtn || "导出 TXT")}</button>
        <button type="button" class="btn btn-ghost btn-sm" id="phImport">${escHtml(p.importBtn || "导入备份…")}</button>
        <input type="file" id="phImportInput" accept="application/json" style="display:none" />
      </div>
    </div>

    <div id="phUndoBar" class="hidden" style="margin:8px 0;padding:10px 14px;border-radius:10px;background:linear-gradient(135deg,rgba(250,204,21,0.16),rgba(251,146,60,0.14));border:1px solid rgba(250,204,21,0.45);display:flex;align-items:center;gap:10px">
      <span id="phUndoMsg" style="flex:1;color:#fde68a;font-size:0.88rem"></span>
      <span id="phUndoTimer" class="muted" style="font-size:0.72rem"></span>
      <button type="button" class="btn btn-secondary btn-sm" id="phUndoBtn">撤销</button>
      <button type="button" class="btn btn-ghost btn-sm" id="phUndoClose" style="font-size:0.9rem;padding:2px 8px">×</button>
    </div>

    <div class="toolbar" style="flex-wrap:wrap;gap:8px;margin:0">
      <div id="phSearchWrap" style="display:flex;align-items:center;gap:10px;flex:1 1 360px;max-width:640px">
        <input type="search" class="inp" style="flex:1;min-width:0;font-size:0.96rem;padding:8px 12px" id="phSearch" placeholder="${escAttr(p.searchPh || "搜索…（按 / 聚焦，回车跳转下一个）")}" />
        <div id="phHitNav" class="hidden phHitNav">
          <span id="phHitCount" class="phHitCount">0 / 0</span>
          <button type="button" class="phHitBtn" id="phHitPrev" title="上一个 (Shift+Enter)" aria-label="上一个">↑</button>
          <button type="button" class="phHitBtn" id="phHitNext" title="下一个 (Enter)" aria-label="下一个">↓</button>
          <button type="button" class="phHitBtn phHitBtnClose" id="phHitClose" title="清除搜索" aria-label="清除">×</button>
        </div>
      </div>
      <select class="inp" style="max-width:200px" id="phSort">
        <option value="recent">${escHtml(p.sortRecent || "排序：最近更新")}</option>
        <option value="created">${escHtml(p.sortCreated || "排序：最早创建")}</option>
        <option value="category">${escHtml(p.sortCategory || "排序：按分类")}</option>
        <option value="copies">排序：最常复制</option>
        <option value="length">排序：内容长度</option>
      </select>
      <label class="muted" style="display:flex;align-items:center;gap:6px;font-size:0.84rem;padding:4px 10px;border:1px solid rgba(148,163,184,0.32);border-radius:999px">
        <input type="checkbox" id="phOnlyFav" /> ${escHtml(p.onlyFav || "只看收藏")}
      </label>
      <span id="phStat" class="muted" style="font-size:0.78rem;margin-left:auto"></span>
    </div>

    <div id="phTagBar" class="hidden" style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0;align-items:center"></div>

    <div id="phCatHeader" class="hidden" style="display:flex;align-items:center;gap:12px;margin:10px 0 0;padding:10px 16px;border-radius:12px;border:1px solid rgba(148,163,184,0.32);background:linear-gradient(135deg,rgba(15,23,42,0.55),rgba(30,41,59,0.4))">
      <div id="phCatHeaderInner" style="flex:1;display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-width:0"></div>
      <div class="row" style="gap:6px;flex-wrap:wrap;flex-shrink:0">
        <button type="button" class="btn btn-ghost btn-sm" id="phMulti" title="进入多选模式（再次点击退出）">☑ 多选</button>
        <button type="button" class="btn btn-ghost btn-sm" id="phRandom" title="随机一句（快捷键 R）">🎲 随机</button>
        <button type="button" class="btn btn-ghost btn-sm" id="phFlash" title="翻牌模式：内容默认隐藏，点击显示，适合背诵">🃏 翻牌</button>
        <button type="button" class="btn btn-ghost btn-sm" id="phRename" title="重命名当前分类">✎ 重命名</button>
        <button type="button" class="btn btn-ghost btn-sm" id="phViewGrid" title="多列卡片">▦ 卡片</button>
        <button type="button" class="btn btn-ghost btn-sm" id="phViewReader" title="单列阅读">▤ 阅读</button>
      </div>
    </div>
    <div id="phMultiBar" class="hidden" style="margin:8px 0 0;padding:10px 14px;border-radius:10px;border:1px solid rgba(96,165,250,0.45);background:linear-gradient(135deg,rgba(96,165,250,0.10),rgba(168,85,247,0.10));display:flex;align-items:center;flex-wrap:wrap;gap:8px">
      <span id="phMultiCount" style="color:#cbd5e1;font-size:0.86rem">已选 0 条</span>
      <button type="button" class="btn btn-ghost btn-sm" id="phMultiAll">全选当前页</button>
      <button type="button" class="btn btn-ghost btn-sm" id="phMultiNone">清空</button>
      <span style="flex:1"></span>
      <button type="button" class="btn btn-secondary btn-sm" id="phMultiCopy">📋 复制全部</button>
      <button type="button" class="btn btn-secondary btn-sm" id="phMultiMove">📂 移动到分类…</button>
      <button type="button" class="btn btn-secondary btn-sm" id="phMultiTag">🏷 加标签…</button>
      <button type="button" class="btn btn-secondary btn-sm" id="phMultiExport">📄 导出</button>
      <button type="button" class="btn btn-danger btn-sm" id="phMultiDelete">🗑 删除</button>
      <button type="button" class="btn btn-ghost btn-sm" id="phMultiExit">退出多选</button>
    </div>
    </div>

    <div id="phEditor" class="card hidden" style="margin:12px 0;padding:18px 20px;border:1px solid rgba(148,163,184,0.28);border-radius:14px;background:linear-gradient(180deg,rgba(15,23,42,0.55),rgba(30,41,59,0.35))">
      <h3 id="phEditorTitle" style="margin:0 0 12px;font-size:1.1rem">${escHtml(p.detailTitle || "金句详情")}</h3>
      <label class="muted" style="font-size:0.82rem">${escHtml(p.formText || "金句内容")}</label>
      <textarea class="inp" id="phText" rows="3" style="margin-top:4px;font-size:0.95rem;line-height:1.65" placeholder="${escAttr(p.formText || "金句内容")}"></textarea>
      <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px">
        <div style="flex:1 1 220px;min-width:200px">
          <label class="muted" style="font-size:0.82rem">${escHtml(p.formCategory || "分类")}</label>
          <input class="inp" id="phEditCategory" list="phCategoryList" placeholder="例如：销售话术 / 客户回应" />
          <datalist id="phCategoryList"></datalist>
        </div>
        <div style="flex:1 1 220px;min-width:200px">
          <label class="muted" style="font-size:0.82rem">${escHtml(p.formTags || "标签")}</label>
          <input class="inp" id="phEditTags" placeholder="多个标签用逗号分隔" />
        </div>
        <div style="flex:1 1 220px;min-width:200px">
          <label class="muted" style="font-size:0.82rem">${escHtml(p.formSource || "出处")}</label>
          <input class="inp" id="phEditSource" placeholder="例如：聊天记录 2024-04-21" />
        </div>
      </div>
      <label class="muted" style="font-size:0.82rem;margin-top:10px;display:block">${escHtml(p.formNote || "备注 / 学习点")}</label>
      <textarea class="inp" id="phEditNote" rows="2" style="margin-top:4px" placeholder="为什么收藏？关键学习点是什么？"></textarea>
      <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
        ${(presetCats || [])
          .map((c) => `<button type="button" class="btn btn-ghost btn-sm phPresetCat" data-cat="${escAttr(c)}" style="border-radius:999px">${escHtml(c)}</button>`)
          .join("")}
      </div>
      <div class="row" style="margin-top:14px;gap:8px;justify-content:flex-end">
        <button type="button" class="btn btn-ghost btn-sm" id="phCancel">${escHtml(p.cancelBtn || "取消")}</button>
        <button type="button" class="btn btn-primary btn-sm" id="phSave">${escHtml(p.saveBtn || "保存")}</button>
      </div>
    </div>

    <div id="phBulkPanel" class="card hidden" style="margin:12px 0;padding:18px 20px;border:1px solid rgba(96,165,250,0.4);border-radius:14px;background:linear-gradient(180deg,rgba(15,23,42,0.55),rgba(30,41,59,0.35))">
      <h3 style="margin:0 0 8px;font-size:1.1rem">批量粘贴新增</h3>
      <p class="muted" style="margin:0 0 10px;font-size:0.82rem">把整段聊天 / 文档复制进来，自动按分隔切成多条独立金句。</p>
      <textarea class="inp" id="phBulkText" rows="8" style="font-size:0.92rem;line-height:1.65" placeholder="把多条金句一次性粘贴在这里…&#10;&#10;例如：&#10;1. 第一句话。&#10;2. 第二句话。&#10;&#10;或者&#10;&#10;第一段&#10;&#10;第二段"></textarea>
      <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px;align-items:flex-end">
        <div style="flex:1 1 200px;min-width:180px">
          <label class="muted" style="font-size:0.82rem">分隔方式</label>
          <select class="inp" id="phBulkSep">
            <option value="auto">智能识别（空行 / 1. / ① / -）</option>
            <option value="blank">仅按空行切分</option>
            <option value="newline">每行一条</option>
            <option value="number">按编号 1. 2. 3. 切分</option>
          </select>
        </div>
        <div style="flex:1 1 220px;min-width:200px">
          <label class="muted" style="font-size:0.82rem">归入分类</label>
          <input class="inp" id="phBulkCategory" list="phCategoryList" placeholder="留空则放到「未分类」" />
        </div>
        <div style="flex:1 1 200px;min-width:180px">
          <label class="muted" style="font-size:0.82rem">统一标签（可选）</label>
          <input class="inp" id="phBulkTags" placeholder="多个用逗号分隔" />
        </div>
      </div>
      <div id="phBulkPreview" class="muted" style="margin-top:10px;font-size:0.82rem"></div>
      <div class="row" style="margin-top:14px;gap:8px;justify-content:flex-end">
        <button type="button" class="btn btn-ghost btn-sm" id="phBulkCancel">取消</button>
        <button type="button" class="btn btn-primary btn-sm" id="phBulkSave">全部保存</button>
      </div>
    </div>

    <div id="phCategoryView">
      <div id="phCategoryGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-top:6px"></div>
      <div id="phEmpty"></div>
    </div>

    <div id="phPhraseView" class="hidden">
      <div id="phList" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:14px;align-items:start"></div>
      <div id="phPhraseEmpty"></div>
    </div>
  `),
  );

  const headTitle = root.querySelector("#phHeadTitle");
  const headSub = root.querySelector("#phHeadSub");
  const backBtn = root.querySelector("#phBackToCats");
  const newProjectBtn = root.querySelector("#phNewProject");
  const search = root.querySelector("#phSearch");
  const sortSel = root.querySelector("#phSort");
  const onlyFav = root.querySelector("#phOnlyFav");
  const stat = root.querySelector("#phStat");
  const tagBar = root.querySelector("#phTagBar");

  const undoBar = root.querySelector("#phUndoBar");
  const undoMsg = root.querySelector("#phUndoMsg");
  const undoTimer = root.querySelector("#phUndoTimer");
  const undoBtn = root.querySelector("#phUndoBtn");
  const undoClose = root.querySelector("#phUndoClose");

  const editor = root.querySelector("#phEditor");
  const editorTitle = root.querySelector("#phEditorTitle");
  const editorText = root.querySelector("#phText");
  const editorCategory = root.querySelector("#phEditCategory");
  const editorTags = root.querySelector("#phEditTags");
  const editorSource = root.querySelector("#phEditSource");
  const editorNote = root.querySelector("#phEditNote");
  const categoryList = root.querySelector("#phCategoryList");
  const importInput = root.querySelector("#phImportInput");

  const bulkPanel = root.querySelector("#phBulkPanel");
  const bulkText = root.querySelector("#phBulkText");
  const bulkSep = root.querySelector("#phBulkSep");
  const bulkCategory = root.querySelector("#phBulkCategory");
  const bulkTags = root.querySelector("#phBulkTags");
  const bulkPreview = root.querySelector("#phBulkPreview");

  const categoryView = root.querySelector("#phCategoryView");
  const categoryGrid = root.querySelector("#phCategoryGrid");
  const emptyHost = root.querySelector("#phEmpty");

  const phraseView = root.querySelector("#phPhraseView");
  const catHeader = root.querySelector("#phCatHeader");
  const catHeaderInner = root.querySelector("#phCatHeaderInner");
  const list = root.querySelector("#phList");
  const phraseEmpty = root.querySelector("#phPhraseEmpty");
  const viewGridBtn = root.querySelector("#phViewGrid");
  const viewReaderBtn = root.querySelector("#phViewReader");
  const randomBtn = root.querySelector("#phRandom");
  const flashBtn = root.querySelector("#phFlash");
  const renameBtn = root.querySelector("#phRename");

  /** @type {"grid"|"reader"} */
  let viewMode = "grid";
  let flashMode = false;
  /** @type {string[]} */
  let customCats = [];

  function normalizeCategoryName(name) {
    return String(name || "").trim().replace(/\s+/g, " ").slice(0, 48);
  }

  function allCategoryNames() {
    const cats = new Set();
    for (const c of presetCats) {
      const name = normalizeCategoryName(c);
      if (name) cats.add(name);
    }
    for (const c of customCats) {
      const name = normalizeCategoryName(c);
      if (name) cats.add(name);
    }
    for (const it of items) {
      const name = normalizeCategoryName(it.category);
      if (name) cats.add(name);
    }
    return [...cats].sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
  }

  async function saveCustomCategories(next) {
    const normalized = [...new Set((next || []).map(normalizeCategoryName).filter(Boolean))];
    customCats = normalized;
    try {
      await idb.storeSet("phrasebook.customCategories", normalized);
    } catch {
      // Empty project names are a convenience layer; phrase records remain the source of truth.
    }
  }

  async function ensureCustomCategory(name) {
    const normalized = normalizeCategoryName(name);
    if (!normalized) return "";
    if (!customCats.includes(normalized) && !presetCats.includes(normalized)) {
      await saveCustomCategories([...customCats, normalized]);
    }
    return normalized;
  }

  function askTextDialog({ title, value = "", placeholder = "", okText = "保存" }) {
    return new Promise((resolve) => {
      const dlg = el(`
        <div class="phDialogBackdrop" role="dialog" aria-modal="true">
          <div class="phDialog">
            <h3>${escHtml(title || "输入内容")}</h3>
            <input class="inp" id="phDialogInput" value="${escAttr(value)}" placeholder="${escAttr(placeholder)}" />
            <div class="phDialogActions">
              <button type="button" class="btn btn-ghost btn-sm" id="phDialogCancel">取消</button>
              <button type="button" class="btn btn-primary btn-sm" id="phDialogOk">${escHtml(okText)}</button>
            </div>
          </div>
        </div>
      `);
      root.appendChild(dlg);
      const input = dlg.querySelector("#phDialogInput");
      const close = (result) => {
        dlg.remove();
        resolve(result);
      };
      dlg.querySelector("#phDialogCancel")?.addEventListener("click", () => close(null));
      dlg.querySelector("#phDialogOk")?.addEventListener("click", () => close(String(input.value || "")));
      dlg.addEventListener("click", (e) => {
        if (e.target === dlg) close(null);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") close(String(input.value || ""));
        if (e.key === "Escape") close(null);
      });
      window.setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    });
  }

  async function createProject(prefill = "") {
    const raw = await askTextDialog({
      title: "新建金句项目",
      value: prefill,
      placeholder: "例如：客户A话术 / 黄金交易 / 美国经济话题",
      okText: "创建",
    });
    if (raw == null) return;
    const name = normalizeCategoryName(raw);
    if (!name) {
      ctx.toast("项目名称不能为空", true);
      return;
    }
    await ensureCustomCategory(name);
    activeCategory = name;
    activeTags.clear();
    render();
    openEditor({ category: name });
    ctx.toast(`已创建项目「${name}」，可以开始添加金句`);
  }

  function applyViewMode() {
    if (viewMode === "reader") {
      list.style.gridTemplateColumns = "minmax(0, 760px)";
      list.style.justifyContent = "center";
      viewReaderBtn.style.background = "rgba(96,165,250,0.18)";
      viewReaderBtn.style.borderColor = "rgba(96,165,250,0.5)";
      viewGridBtn.style.background = "";
      viewGridBtn.style.borderColor = "";
    } else {
      list.style.gridTemplateColumns = "repeat(auto-fit, minmax(420px, 1fr))";
      list.style.justifyContent = "start";
      viewGridBtn.style.background = "rgba(96,165,250,0.18)";
      viewGridBtn.style.borderColor = "rgba(96,165,250,0.5)";
      viewReaderBtn.style.background = "";
      viewReaderBtn.style.borderColor = "";
    }
  }
  viewGridBtn.addEventListener("click", () => { viewMode = "grid"; applyViewMode(); });
  viewReaderBtn.addEventListener("click", () => { viewMode = "reader"; applyViewMode(); });
  applyViewMode();

  flashBtn.addEventListener("click", () => {
    flashMode = !flashMode;
    if (flashMode) {
      flashBtn.style.background = "rgba(192,132,252,0.22)";
      flashBtn.style.borderColor = "rgba(192,132,252,0.6)";
      ctx.toast("已开启翻牌模式：点卡片显示内容，再点隐藏");
    } else {
      flashBtn.style.background = "";
      flashBtn.style.borderColor = "";
    }
    render();
  });

  /** @type {any[]} */
  let items = [];
  let editingId = null;
  /** @type {string|null} */
  let activeCategory = null;
  /** @type {Set<string>} */
  const activeTags = new Set();
  // —— 多选模式 ——
  let multiSelectMode = false;
  /** @type {Set<string>} */
  const multiSelected = new Set();
  const multiBar = root.querySelector("#phMultiBar");
  const multiCount = root.querySelector("#phMultiCount");
  const multiBtn = root.querySelector("#phMulti");

  function setMultiMode(on) {
    multiSelectMode = Boolean(on);
    if (!multiSelectMode) multiSelected.clear();
    if (multiSelectMode) {
      multiBar.classList.remove("hidden");
      multiBar.style.display = "flex";
      multiBtn.style.background = "rgba(96,165,250,0.22)";
      multiBtn.style.borderColor = "rgba(96,165,250,0.55)";
    } else {
      multiBar.classList.add("hidden");
      multiBar.style.display = "none";
      multiBtn.style.background = "";
      multiBtn.style.borderColor = "";
    }
    refreshMultiCount();
    render();
  }
  function refreshMultiCount() {
    if (multiCount) multiCount.textContent = `已选 ${multiSelected.size} 条`;
  }
  function toggleMultiId(id) {
    if (multiSelected.has(id)) multiSelected.delete(id);
    else multiSelected.add(id);
    refreshMultiCount();
    const card = list.querySelector(`.phCard[data-id="${cssEscape(id)}"]`);
    if (card) {
      card.classList.toggle("phb-selected", multiSelected.has(id));
      const cb = card.querySelector(".phMultiCb");
      if (cb instanceof HTMLInputElement) cb.checked = multiSelected.has(id);
    }
  }
  function cssEscape(s) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(String(s));
    return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
  }

  // —— 撤销栈（基于通用控制器）——
  const undoMgr = createUndoController({
    bar: undoBar,
    msg: undoMsg,
    timer: undoTimer,
    undoBtn,
    closeBtn: undoClose,
    defaultSeconds: 15,
    onSuccess: (n) => {
      ctx.toast(`已撤销，恢复 ${n} 条`);
      void reload();
    },
    onError: (e) => ctx.toast(e?.message || "撤销失败", true),
  });

  /**
   * 调用方习惯沿用 showUndo(records, label)：直接转发到通用控制器。
   * @param {any[]} records
   * @param {string} label
   */
  function showUndo(records, label) {
    undoMgr.register({
      records,
      label,
      restore: async (recs) => {
        for (const r of recs) {
          // putPhrase 会保留传入的 id 和 createdAt
          await idb.putPhrase(r);
        }
      },
    });
  }
  function clearUndo() {
    undoMgr.clear();
  }

  // —— 多选工具条事件 ——
  multiBtn.addEventListener("click", () => setMultiMode(!multiSelectMode));
  root.querySelector("#phMultiExit").addEventListener("click", () => setMultiMode(false));
  root.querySelector("#phMultiAll").addEventListener("click", () => {
    list.querySelectorAll(".phCard").forEach((card) => {
      const id = card.getAttribute("data-id");
      if (id) multiSelected.add(id);
    });
    refreshMultiCount();
    render();
  });
  root.querySelector("#phMultiNone").addEventListener("click", () => {
    multiSelected.clear();
    refreshMultiCount();
    render();
  });

  function selectedRecords() {
    return items.filter((x) => multiSelected.has(x.id));
  }

  root.querySelector("#phMultiCopy").addEventListener("click", async () => {
    const recs = selectedRecords();
    if (!recs.length) return ctx.toast("请先勾选金句", true);
    const text = recs.map((r) => String(r.text || "").trim()).filter(Boolean).join("\n\n---\n\n");
    const ok = await copyTextSafe(text);
    if (ok) {
      for (const r of recs) await bumpCopyCount(r);
      ctx.toast(`已复制 ${recs.length} 条`);
    } else {
      ctx.toast("复制失败", true);
    }
  });
  root.querySelector("#phMultiMove").addEventListener("click", async () => {
    const recs = selectedRecords();
    if (!recs.length) return ctx.toast("请先勾选金句", true);
    const target = window.prompt(`把 ${recs.length} 条金句移动到哪个分类？\n（输入分类名，留空则放到「未分类」）`, "");
    if (target == null) return;
    const cat = String(target).trim();
    for (const r of recs) {
      try { await idb.patchPhrase(r.id, { category: cat }); } catch { /* ignore */ }
    }
    ctx.toast(`已移动 ${recs.length} 条到「${cat || "未分类"}」`);
    multiSelected.clear();
    await reload();
  });
  root.querySelector("#phMultiTag").addEventListener("click", async () => {
    const recs = selectedRecords();
    if (!recs.length) return ctx.toast("请先勾选金句", true);
    const raw = window.prompt(`给 ${recs.length} 条金句追加标签：\n（多个用逗号分隔，留空取消）`, "");
    if (raw == null) return;
    const newTags = String(raw).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (!newTags.length) return;
    for (const r of recs) {
      const existing = Array.isArray(r.tags) ? r.tags : [];
      const merged = Array.from(new Set([...existing, ...newTags]));
      try { await idb.patchPhrase(r.id, { tags: merged }); } catch { /* ignore */ }
    }
    ctx.toast(`已为 ${recs.length} 条加标签：${newTags.join(", ")}`);
    await reload();
  });
  root.querySelector("#phMultiExport").addEventListener("click", async () => {
    const recs = selectedRecords();
    if (!recs.length) return ctx.toast("请先勾选金句", true);
    const text = recs
      .map((r, i) => {
        const tags = Array.isArray(r.tags) && r.tags.length ? `\n标签：${r.tags.join(", ")}` : "";
        return `[${i + 1}] 分类：${r.category || "未分类"}${tags}\n${(r.text || "").trim()}\n${r.note ? `备注：${r.note}\n` : ""}${r.source ? `出处：${r.source}\n` : ""}`;
      })
      .join("\n---\n\n");
    try {
      const r = await ctx.ipc.saveGeneratedFile({
        suggestedName: `phrasebook-export-${Date.now()}.md`,
        content: `# 金句导出（${recs.length} 条）\n\n${text}`,
        format: "md",
      });
      ctx.toast(r?.canceled ? "已取消" : `已导出：${r.filePath}`);
    } catch (e) {
      ctx.toast(e?.message || "导出失败", true);
    }
  });
  root.querySelector("#phMultiDelete").addEventListener("click", async () => {
    const recs = selectedRecords();
    if (!recs.length) return ctx.toast("请先勾选金句", true);
    if (!confirm(`确认删除已选的 ${recs.length} 条金句？\n（删除后 15s 内可在顶部撤销）`)) return;
    const snapshot = recs.map((r) => ({ ...r }));
    for (const r of recs) {
      try { await idb.deletePhrase(r.id); } catch { /* ignore */ }
    }
    showUndo(snapshot, `已删除 ${snapshot.length} 条 · 15s 内可撤销`);
    multiSelected.clear();
    await reload();
  });

  function refreshCategoryDatalist() {
    categoryList.innerHTML = allCategoryNames().map((c) => `<option value="${escAttr(c)}"></option>`).join("");
  }

  function getKeywords() {
    return String(search.value || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function openEditor(rec) {
    closeBulk();
    editingId = rec?.id || null;
    editor.classList.remove("hidden");
    editor.style.display = "block";
    editorTitle.textContent = editingId ? "编辑金句" : (rec?.category ? `新增金句 · ${rec.category}` : "新增金句");
    editorText.value = rec?.text || "";
    editorCategory.value = rec?.category || "";
    editorTags.value = Array.isArray(rec?.tags) ? rec.tags.join(", ") : "";
    editorSource.value = rec?.source || "";
    editorNote.value = rec?.note || "";
    setTimeout(() => editorText.focus(), 0);
  }

  function closeEditor() {
    editingId = null;
    editor.classList.add("hidden");
    editor.style.display = "none";
  }

  function openBulk() {
    closeEditor();
    bulkPanel.classList.remove("hidden");
    bulkPanel.style.display = "block";
    if (activeCategory && activeCategory !== "__all__") bulkCategory.value = activeCategory;
    setTimeout(() => bulkText.focus(), 0);
    refreshBulkPreview();
  }
  function closeBulk() {
    bulkPanel.classList.add("hidden");
    bulkPanel.style.display = "none";
  }

  function parseBulk() {
    const raw = String(bulkText.value || "").trim();
    if (!raw) return [];
    const mode = bulkSep.value;
    if (mode === "blank") {
      return raw.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
    }
    if (mode === "newline") {
      return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
    if (mode === "number") {
      const lines = raw.split(/\r?\n/);
      const groups = [];
      let cur = [];
      const re = /^\s*\d+[\.、)]\s*/;
      for (const ln of lines) {
        if (re.test(ln) && cur.length) {
          groups.push(cur.join("\n").trim());
          cur = [ln.replace(re, "")];
        } else if (re.test(ln)) {
          cur = [ln.replace(re, "")];
        } else {
          cur.push(ln);
        }
      }
      if (cur.length) groups.push(cur.join("\n").trim());
      return groups.filter(Boolean);
    }
    return splitBlocks(raw);
  }
  function refreshBulkPreview() {
    const blocks = parseBulk();
    if (!blocks.length) {
      bulkPreview.textContent = "（未识别到内容）";
      return;
    }
    const previewN = Math.min(3, blocks.length);
    const samples = blocks
      .slice(0, previewN)
      .map((b, i) => `${i + 1}. ${b.length > 60 ? b.slice(0, 60) + "…" : b}`)
      .join("\n");
    bulkPreview.innerHTML = `<span style="color:#bfdbfe">将切分为 <b>${blocks.length}</b> 条</span>，前 ${previewN} 条预览：\n<pre style="margin:6px 0 0;padding:8px 10px;background:rgba(15,23,42,0.4);border-radius:6px;white-space:pre-wrap;font-size:0.78rem;color:#cbd5e1">${escHtml(samples)}</pre>`;
  }
  bulkText.addEventListener("input", refreshBulkPreview);
  bulkSep.addEventListener("change", refreshBulkPreview);

  root.querySelector("#phBulkCancel").addEventListener("click", closeBulk);
  root.querySelector("#phBulkSave").addEventListener("click", async () => {
    const blocks = parseBulk();
    if (!blocks.length) {
      ctx.toast("没有可保存的内容", true);
      return;
    }
    const cat = String(bulkCategory.value || "").trim();
    const tags = String(bulkTags.value || "")
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      if (cat) await ensureCustomCategory(cat);
      for (const b of blocks) {
        await idb.putPhrase({
          text: b,
          category: cat,
          tags,
          favorite: false,
        });
      }
      ctx.toast(`已批量保存 ${blocks.length} 条`);
      bulkText.value = "";
      bulkPreview.textContent = "";
      closeBulk();
      await reload();
    } catch (e) {
      ctx.toast(e?.message || "保存失败", true);
    }
  });

  async function reload() {
    try {
      const savedCats = await idb.storeGet("phrasebook.customCategories");
      customCats = Array.isArray(savedCats)
        ? savedCats.map(normalizeCategoryName).filter(Boolean)
        : [];
      items = await idb.listPhrases();
    } catch (e) {
      ctx.toast(`金句库加载失败：${e?.message || e}`, true);
      items = [];
    }
    refreshCategoryDatalist();
    render();
  }

  function matchesSearch(rec) {
    if (onlyFav.checked && !rec.favorite) return false;
    if (activeTags.size) {
      const recTags = new Set(Array.isArray(rec.tags) ? rec.tags : []);
      for (const t of activeTags) if (!recTags.has(t)) return false;
    }
    const q = String(search.value || "").trim().toLowerCase();
    if (!q) return true;
    const hay = [
      rec.text,
      rec.category,
      Array.isArray(rec.tags) ? rec.tags.join(" ") : rec.tags,
      rec.note,
      rec.source,
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return q.split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
  }

  function setHeadingForView() {
    if (activeCategory) {
      const display = activeCategory === "__all__" ? "全部分类" : activeCategory;
      headTitle.textContent = `${p.title || "金句库"} · ${display}`;
      headSub.textContent = `当前查看分类：${display}`;
      backBtn.classList.remove("hidden");
    } else {
      headTitle.textContent = p.title || "金句库";
      headSub.textContent = p.subtitle || "";
      backBtn.classList.add("hidden");
    }
  }

  function renderTagBar() {
    // 顶部标签筛选条：当前 scope 下所有 tag 的统计
    const scope = activeCategory == null
      ? items
      : (activeCategory === "__all__" ? items : items.filter((it) => (String(it.category || "").trim() || UNCATEGORIZED) === activeCategory));
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const it of scope) {
      if (!Array.isArray(it.tags)) continue;
      for (const t of it.tags) {
        const k = String(t || "").trim();
        if (!k) continue;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    const all = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    if (!all.length && !activeTags.size) {
      tagBar.classList.add("hidden");
      tagBar.innerHTML = "";
      return;
    }
    tagBar.classList.remove("hidden");
    tagBar.innerHTML =
      `<span class="muted" style="font-size:0.74rem;letter-spacing:0.06em;margin-right:4px">标签</span>` +
      all
        .map(([t, n]) => {
          const active = activeTags.has(t);
          return `<button type="button" class="phTagChip" data-tag="${escAttr(t)}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:0.78rem;cursor:pointer;border:1px solid ${active ? "rgba(96,165,250,0.7)" : "rgba(148,163,184,0.32)"};background:${active ? "rgba(96,165,250,0.22)" : "rgba(148,163,184,0.1)"};color:${active ? "#bfdbfe" : "#cbd5e1"}">#${escHtml(t)}<span class="muted" style="font-size:10px">${n}</span></button>`;
        })
        .join("") +
      (activeTags.size
        ? `<button type="button" id="phTagClear" class="btn btn-ghost btn-sm" style="font-size:0.74rem;padding:2px 8px;margin-left:4px">清除标签筛选</button>`
        : "");
    tagBar.querySelectorAll(".phTagChip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-tag") || "";
        if (activeTags.has(t)) activeTags.delete(t);
        else activeTags.add(t);
        render();
      });
    });
    tagBar.querySelector("#phTagClear")?.addEventListener("click", () => {
      activeTags.clear();
      render();
    });
  }

  function render() {
    setHeadingForView();
    renderTagBar();
    if (activeCategory == null) {
      phraseView.classList.add("hidden");
      categoryView.classList.remove("hidden");
      catHeader.classList.add("hidden");
      renderCategoryGrid();
    } else {
      categoryView.classList.add("hidden");
      phraseView.classList.remove("hidden");
      catHeader.classList.remove("hidden");
      renderPhraseList();
    }
    refreshHitNav();
  }

  // —— 关键词跳转 / 上下条命中 ——
  /** @type {HTMLElement[]} */
  let hitMarks = [];
  let hitIndex = 0;
  let lastHitQuery = "";

  function refreshHitNav() {
    const hitNav = root.querySelector("#phHitNav");
    const q = String(search.value || "").trim();
    const scope = activeCategory == null ? categoryGrid : list;
    const marks = scope ? Array.from(scope.querySelectorAll("mark")) : [];
    hitMarks = marks;
    marks.forEach((m, i) => m.setAttribute("data-hit-index", String(i)));
    if (!q || !marks.length) {
      hitNav.classList.add("hidden");
      hitIndex = 0;
      lastHitQuery = q;
      return;
    }
    hitNav.classList.remove("hidden");
    if (q !== lastHitQuery) {
      hitIndex = 0;
      lastHitQuery = q;
      requestAnimationFrame(() => scrollToHit(0, false));
    } else if (hitIndex >= marks.length) {
      hitIndex = 0;
    }
    updateHitLabel();
    markCurrentHit();
  }

  function updateHitLabel() {
    const hitCount = root.querySelector("#phHitCount");
    if (!hitCount) return;
    if (!hitMarks.length) {
      hitCount.textContent = "0/0";
      return;
    }
    hitCount.textContent = `${hitIndex + 1}/${hitMarks.length}`;
  }

  function markCurrentHit() {
    hitMarks.forEach((m, i) => {
      if (i === hitIndex) {
        m.classList.add("phHitCurrent");
      } else {
        m.classList.remove("phHitCurrent");
      }
    });
  }

  function scrollToHit(idx, smooth) {
    if (!hitMarks.length) return;
    const safe = ((idx % hitMarks.length) + hitMarks.length) % hitMarks.length;
    hitIndex = safe;
    const el = hitMarks[safe];
    if (!el) return;
    markCurrentHit();
    updateHitLabel();
    el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center", inline: "nearest" });
    el.classList.add("phHitFlash");
    setTimeout(() => el.classList.remove("phHitFlash"), 900);
  }

  function gotoNextHit(delta) {
    if (!hitMarks.length) return;
    scrollToHit(hitIndex + delta, true);
  }

  function renderCategoryGrid() {
    categoryGrid.innerHTML = "";
    emptyHost.innerHTML = "";

    const filtered = items.filter(matchesSearch);
    /** @type {Map<string, any[]>} */
    const map = new Map();
    for (const it of filtered) {
      const key = String(it.category || "").trim() || UNCATEGORIZED;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    for (const c of allCategoryNames()) if (!map.has(c)) map.set(c, []);

    const cats = [...map.entries()].sort((a, b) => {
      const aFav = a[1].some((x) => x.favorite) ? 1 : 0;
      const bFav = b[1].some((x) => x.favorite) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      return b[1].length - a[1].length;
    });

    stat.textContent = `共 ${items.length} 条 · ${cats.length} 个分类`;

    if (!filtered.length && !allCategoryNames().length) {
      emptyState(emptyHost, p.empty || "暂无金句", p.emptyHint || "");
      return;
    }

    const allCard = el(`
      <div class="card phCatCard phCatCardAll" data-cat="">
        ${items.length ? `<button type="button" class="phCatClearAll" title="清空整个金句库">×</button>` : ""}
        <span class="phCatWatermark" aria-hidden="true">藏</span>
        <div class="phCatHead">
          <span class="phCatStamp phCatStampAll">总 览</span>
          <span class="phCatStar" title="收藏数">${items.filter((x) => x.favorite).length} ★</span>
        </div>
        <div class="phCatTitle">全部分类</div>
        <div class="phCatSample muted">浏览所有分类下的全部金句</div>
        <div class="phCatFoot">
          <span class="phCatNum">${items.length}</span>
          <span class="phCatUnit muted">条金句</span>
        </div>
      </div>
    `);
    allCard.addEventListener("click", () => {
      activeCategory = "__all__";
      render();
    });
    const clearAllBtn = allCard.querySelector(".phCatClearAll");
    if (clearAllBtn) {
      clearAllBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const total = items.length;
        if (!confirm(`【高风险】确定要清空整个金句库的全部 ${total} 条金句吗？\n建议先点「导出 JSON」备份一份。`)) return;
        if (!confirm(`再次确认：将永久删除 ${total} 条金句。`)) return;
        const snapshot = items.map((it) => ({ ...it }));
        try {
          for (const it of items) await idb.deletePhrase(it.id);
          showUndo(snapshot, `已清空全部 ${total} 条金句`);
          ctx.toast(`已清空 ${total} 条金句（15 秒内可撤销）`);
          await reload();
        } catch (err) {
          ctx.toast(err?.message || "清空失败", true);
        }
      });
    }
    categoryGrid.appendChild(allCard);

    for (const [name, arr] of cats) {
      const pal = pickPalette(name);
      const sample = arr[0]?.text ? makeTitle(arr[0].text).head : "—";
      const hasItems = arr.length > 0;
      const isCustom = customCats.includes(name);
      const watermarkChar = String(name || "—").trim().charAt(0) || "·";
      const card = el(`
        <div class="card phCatCard" data-cat="${escAttr(name)}" style="--pal-bd:${pal.bd};--pal-bg:${pal.bg};--pal-fg:${pal.fg}">
          ${(hasItems || isCustom) ? `<button type="button" class="phCatDel" title="删除项目「${escAttr(name)}」">×</button>` : ""}
          <span class="phCatWatermark" aria-hidden="true">${escHtml(watermarkChar)}</span>
          <div class="phCatHead">
            <span class="phCatStamp">分 类</span>
            <span class="phCatStar" title="收藏数">${arr.filter((x) => x.favorite).length} ★</span>
          </div>
          <div class="phCatTitle">${escHtml(name)}</div>
          <div class="phCatSample muted">${escHtml(sample)}</div>
          <div class="phCatActions">
            <button type="button" class="phCatAction" data-action="add">新增金句</button>
            <button type="button" class="phCatAction" data-action="rename">改名</button>
          </div>
          <div class="phCatFoot">
            <span class="phCatNum">${arr.length}</span>
            <span class="phCatUnit muted">条金句</span>
          </div>
        </div>
      `);
      card.addEventListener("click", () => {
        activeCategory = name;
        render();
      });
      const delBtn = card.querySelector(".phCatDel");
      if (delBtn) {
        delBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (hasItems && !confirm(`确定删除整个项目「${name}」？\n该项目下共有 ${arr.length} 条金句，将一并删除。`)) return;
          if (!hasItems && !confirm(`确定删除空项目「${name}」？`)) return;
          const snapshot = arr.map((it) => ({ ...it }));
          try {
            for (const it of arr) await idb.deletePhrase(it.id);
            if (isCustom) await saveCustomCategories(customCats.filter((c) => c !== name));
            if (snapshot.length) showUndo(snapshot, `已删除项目「${name}」（${arr.length} 条）`);
            ctx.toast(hasItems ? `已删除项目「${name}」（15 秒内可撤销）` : `已删除空项目「${name}」`);
            await reload();
          } catch (err) {
            ctx.toast(err?.message || "删除失败", true);
          }
        });
      }
      card.querySelector('[data-action="add"]')?.addEventListener("click", async (e) => {
        e.stopPropagation();
        await ensureCustomCategory(name);
        activeCategory = name;
        activeTags.clear();
        render();
        openEditor({ category: name });
      });
      card.querySelector('[data-action="rename"]')?.addEventListener("click", async (e) => {
        e.stopPropagation();
        await renameCategory(name);
      });
      categoryGrid.appendChild(card);
    }
  }

  function renderPhraseList() {
    list.innerHTML = "";
    phraseEmpty.innerHTML = "";

    const cat = activeCategory;
    const inCat = items.filter((it) => {
      if (cat === "__all__") return true;
      const k = String(it.category || "").trim() || UNCATEGORIZED;
      return k === cat;
    });
    const filtered = inCat.filter(matchesSearch);

    const sortBy = sortSel.value;
    if (sortBy === "created") {
      filtered.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    } else if (sortBy === "category") {
      filtered.sort((a, b) => String(a.category || "").localeCompare(String(b.category || ""), "zh-CN") || (b.updatedAt || 0) - (a.updatedAt || 0));
    } else if (sortBy === "copies") {
      filtered.sort((a, b) => (b.copyCount || 0) - (a.copyCount || 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
    } else if (sortBy === "length") {
      filtered.sort((a, b) => String(b.text || "").length - String(a.text || "").length);
    } else {
      filtered.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    }

    const pal = pickPalette(cat === "__all__" ? "全部" : cat);
    const display = cat === "__all__" ? "全部分类" : cat;
    catHeaderInner.innerHTML = `
      <div style="width:14px;height:44px;border-radius:6px;background:${pal.bg};border:1px solid ${pal.bd}"></div>
      <div style="flex:1;min-width:160px">
        <div style="font-size:0.74rem;color:#94a3b8;letter-spacing:0.1em">CATEGORY</div>
        <div style="font-size:1.4rem;font-weight:700;color:#f8fafc">${escHtml(display)}</div>
      </div>
      <div class="muted" style="font-size:0.82rem;text-align:right">共 ${inCat.length} 条 · 当前展示 ${filtered.length}</div>
      ${inCat.length ? `<button type="button" class="btn btn-danger btn-sm" id="phCatDelInside" style="white-space:nowrap">${cat === "__all__" ? "清空全部" : "删除整个分类"}</button>` : ""}
    `;
    stat.textContent = `分类「${display}」· 共 ${inCat.length} 条`;
    const delInside = catHeaderInner.querySelector("#phCatDelInside");
    if (delInside) {
      delInside.addEventListener("click", async () => {
        const isAll = cat === "__all__";
        const tip = isAll
          ? `【高风险】确定要清空整个金句库的全部 ${inCat.length} 条金句吗？\n建议先点「导出 JSON」备份。`
          : `确定删除整个分类「${display}」？\n该分类下共有 ${inCat.length} 条金句，将一并删除。`;
        if (!confirm(tip)) return;
        if (isAll && !confirm(`再次确认：将永久删除 ${inCat.length} 条金句。`)) return;
        const snapshot = inCat.map((it) => ({ ...it }));
        try {
          for (const it of inCat) await idb.deletePhrase(it.id);
          showUndo(snapshot, isAll ? `已清空 ${inCat.length} 条` : `已删除分类「${display}」（${inCat.length} 条）`);
          ctx.toast(isAll ? `已清空（15 秒内可撤销）` : `已删除分类（15 秒内可撤销）`);
          activeCategory = null;
          await reload();
        } catch (err) {
          ctx.toast(err?.message || "删除失败", true);
        }
      });
    }

    // 重命名分类按钮：仅对真实分类启用
    if (cat === "__all__") {
      renameBtn.disabled = true;
      renameBtn.style.opacity = "0.4";
      renameBtn.style.cursor = "not-allowed";
    } else {
      renameBtn.disabled = false;
      renameBtn.style.opacity = "";
      renameBtn.style.cursor = "";
    }

    if (!filtered.length) {
      emptyState(phraseEmpty, "这里还没有匹配的金句", "试试清掉搜索 / 标签筛选，或点「批量粘贴」一次导入。");
      return;
    }

    const kws = getKeywords();
    for (const rec of filtered) list.appendChild(renderPhraseCard(rec, kws));
  }

  async function copyTextSafe(text) {
    try {
      if (ctx.ipc?.copyText) await ctx.ipc.copyText(String(text || ""));
      else await navigator.clipboard.writeText(String(text || ""));
      return true;
    } catch {
      return false;
    }
  }
  async function bumpCopyCount(rec) {
    try {
      await idb.patchPhrase(rec.id, { copyCount: (rec.copyCount || 0) + 1, lastCopiedAt: Date.now() });
    } catch {
      // 静默失败：复制本身已成功
    }
  }

  function renderPhraseCard(rec, keywords) {
    const tags = Array.isArray(rec.tags) ? rec.tags : [];
    const fullText = String(rec.text || "");
    const blocks = splitBlocks(fullText);
    const isMulti = blocks.length > 1;
    const pal = pickPalette(rec.category || UNCATEGORIZED);
    const copyCount = rec.copyCount || 0;

    let bodyHtml = "";
    if (isMulti) {
      const blockItems = blocks
        .map((block, i) => {
          const idx = i + 1;
          return `
            <li class="phBlock" data-idx="${idx}" style="position:relative;display:grid;grid-template-columns:32px 1fr auto;gap:12px;align-items:start;padding:12px 14px;border-radius:10px;background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.2);transition:background 120ms ease,border-color 120ms ease">
              <div style="width:30px;height:30px;border-radius:50%;background:${pal.bg};border:1px solid ${pal.bd};color:#f8fafc;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center">${idx}</div>
              <div class="phBlockText" style="font-size:1rem;line-height:1.85;white-space:pre-wrap;word-break:break-word;color:#e8edf5;user-select:text;cursor:text">${highlightHtml(block, keywords)}</div>
              <div class="row" style="gap:4px;flex-wrap:wrap;justify-content:flex-end">
                <button type="button" class="btn btn-ghost btn-sm phBlockCopy" title="复制这一句" style="font-size:11px;padding:4px 8px">复制</button>
                <button type="button" class="btn btn-ghost btn-sm phBlockSplit" title="拆出为单独金句" style="font-size:11px;padding:4px 8px">独立</button>
                <button type="button" class="btn btn-ghost btn-sm phBlockDel" title="删除这一句" style="font-size:11px;padding:4px 8px;color:#fecaca;border-color:rgba(248,113,113,0.45)">删除</button>
              </div>
            </li>`;
        })
        .join("");
      bodyHtml = `
        <div class="muted" style="font-size:0.78rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:rgba(96,165,250,0.18);color:#bfdbfe;border:1px solid rgba(96,165,250,0.4);font-size:11px;font-weight:600">${blocks.length} 句</span>
          <span>每一句独立可复制 / 删除</span>
        </div>
        <ol class="phBlocks" style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px">${blockItems}</ol>
      `;
    } else {
      const { head, body } = makeTitle(fullText);
      const headHl = head ? highlightHtml(head, keywords) : "";
      const bodyHl = body ? highlightHtml(body, keywords) : (head ? "" : highlightHtml(fullText, keywords));
      bodyHtml = `
        ${headHl ? `<h3 class="phHead" style="margin:0;font-size:1.2rem;line-height:1.5;font-weight:700;color:#f8fafc">${headHl}</h3>` : ""}
        ${bodyHl ? `<div class="phBody" style="font-size:1rem;line-height:1.85;white-space:pre-wrap;word-break:break-word;color:#e8edf5">${bodyHl}</div>` : ""}
      `;
    }

    const flashOverlay = flashMode
      ? `<div class="phFlashOverlay" style="position:absolute;inset:0;background:rgba(15,23,42,0.85);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;border-radius:14px;cursor:pointer;z-index:2"><div style="text-align:center;color:#cbd5e1"><div style="font-size:2rem;margin-bottom:6px">🃏</div><div style="font-size:0.92rem">点击翻牌查看内容</div></div></div>`
      : "";

    const isSelected = multiSelected.has(rec.id);
    const multiCheckbox = multiSelectMode
      ? `<label class="phMultiCbWrap" title="选择该条" style="position:absolute;top:10px;left:10px;z-index:3;display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:999px;background:rgba(15,23,42,0.7);border:1px solid rgba(148,163,184,0.4);cursor:pointer">
          <input type="checkbox" class="phMultiCb" ${isSelected ? "checked" : ""} />
          <span style="font-size:11px;color:#cbd5e1">选中</span>
        </label>`
      : "";
    const card = el(`
      <article class="card phCard${isSelected ? " phb-selected" : ""}" data-id="${escAttr(rec.id)}" style="position:relative;display:flex;flex-direction:column;gap:12px;padding:18px 20px;border-radius:14px;border:1px solid ${isSelected ? "rgba(96,165,250,0.7)" : "rgba(148,163,184,0.28)"};background:linear-gradient(180deg,rgba(15,23,42,0.55),rgba(30,41,59,0.34));${isSelected ? "box-shadow:0 0 0 2px rgba(96,165,250,0.5);" : ""}">
        ${multiCheckbox}
        ${flashOverlay}
        <header style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;${multiSelectMode ? "padding-left:80px;" : ""}">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${rec.category ? `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${pal.bg};color:${pal.fg};border:1px solid ${pal.bd};font-size:11px;letter-spacing:0.04em">${escHtml(rec.category)}</span>` : `<span class="muted" style="font-size:11px">未分类</span>`}
            <span class="muted" style="font-size:11px">${escHtml(fmtTime(rec.updatedAt || rec.createdAt))}</span>
            ${copyCount > 0 ? `<span title="累计复制次数" style="display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:999px;background:rgba(74,222,128,0.16);color:#bbf7d0;border:1px solid rgba(74,222,128,0.4);font-size:11px">⎘ ${copyCount}</span>` : ""}
          </div>
          <button type="button" class="btn btn-ghost btn-sm phFav" title="收藏" style="font-size:1.05rem;line-height:1;padding:4px 8px;color:${rec.favorite ? "#f59e0b" : "#94a3b8"}">${rec.favorite ? "★" : "☆"}</button>
        </header>
        ${bodyHtml}
        ${tags.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${tags.map((t) => `<span class="phCardTag" data-tag="${escAttr(t)}" title="点击按此标签筛选" style="cursor:pointer;display:inline-block;padding:2px 9px;border-radius:999px;background:rgba(148,163,184,0.16);color:#cbd5e1;border:1px solid rgba(148,163,184,0.32);font-size:11px">#${escHtml(t)}</span>`).join("")}</div>` : ""}
        ${rec.note ? `<div class="muted" style="font-size:0.82rem;line-height:1.6;border-left:3px solid ${pal.bd};padding:6px 10px;background:rgba(148,163,184,0.08);border-radius:8px">${highlightHtml(rec.note, keywords)}</div>` : ""}
        ${rec.source ? `<div class="muted" style="font-size:0.74rem">出处：${highlightHtml(rec.source, keywords)}</div>` : ""}
        <footer class="row" style="gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:8px;border-top:1px dashed rgba(148,163,184,0.18)">
          <button type="button" class="btn btn-secondary btn-sm phEdit">编辑</button>
          <button type="button" class="btn btn-secondary btn-sm phCopy">${isMulti ? "复制全部" : escHtml(p.copyBtn || "复制")}</button>
          ${isMulti ? `<button type="button" class="btn btn-secondary btn-sm phSplitAll" title="把这条拆分为 ${blocks.length} 条独立金句">一键拆为 ${blocks.length} 条</button>` : ""}
          <button type="button" class="btn btn-danger btn-sm phDel" style="margin-left:auto">${isMulti ? "删除整条" : escHtml(p.delBtn || "删除")}</button>
        </footer>
      </article>
    `);

    // 多选模式：勾选 / 卡片点击切换选中
    if (multiSelectMode) {
      const cb = card.querySelector(".phMultiCb");
      cb?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleMultiId(rec.id);
      });
      card.querySelector(".phMultiCbWrap")?.addEventListener("click", (e) => {
        if (e.target instanceof HTMLInputElement) return;
        e.stopPropagation();
        toggleMultiId(rec.id);
      });
      card.addEventListener("click", (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (t.closest(".phMultiCbWrap") || t.closest("button") || t.closest("a") || t.closest(".phBlock")) return;
        toggleMultiId(rec.id);
      });
    }

    // 翻牌模式：点击遮罩切换显示
    if (flashMode) {
      const overlay = card.querySelector(".phFlashOverlay");
      let revealed = false;
      overlay?.addEventListener("click", () => {
        revealed = !revealed;
        if (revealed) overlay.style.display = "none";
        else overlay.style.display = "flex";
      });
      card.addEventListener("click", (e) => {
        // 点击卡片本体也可隐藏（仅在已揭开时）
        if (!revealed) return;
        if (e.target.closest("button") || e.target.closest("a")) return;
        if (e.target.closest(".phBlock") && window.getSelection()?.toString()) return;
        revealed = false;
        if (overlay) overlay.style.display = "flex";
      });
    }

    card.querySelector(".phFav").addEventListener("click", async () => {
      try {
        await idb.patchPhrase(rec.id, { favorite: !rec.favorite });
        await reload();
      } catch (e) {
        ctx.toast(e?.message || "失败", true);
      }
    });
    card.querySelector(".phEdit").addEventListener("click", () => openEditor(rec));
    card.querySelector(".phCopy").addEventListener("click", async () => {
      const ok = await copyTextSafe(rec.text || "");
      if (ok) {
        await bumpCopyCount(rec);
        ctx.toast(p.copied || "已复制到剪贴板");
        await reload();
      } else {
        ctx.toast("复制失败", true);
      }
    });
    card.querySelector(".phDel").addEventListener("click", async () => {
      if (!confirm(p.confirmDelete || "确定删除这条金句？")) return;
      const snapshot = { ...rec };
      try {
        await idb.deletePhrase(rec.id);
        showUndo([snapshot], `已删除「${makeTitle(rec.text).head || rec.text.slice(0, 24)}…」`);
        ctx.toast(`已删除（15 秒内可撤销）`);
        await reload();
      } catch (e) {
        ctx.toast(e?.message || "删除失败", true);
      }
    });

    // 标签 chip 点击：加入筛选
    card.querySelectorAll(".phCardTag").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = chip.getAttribute("data-tag") || "";
        if (!t) return;
        if (activeTags.has(t)) activeTags.delete(t);
        else activeTags.add(t);
        render();
      });
    });

    if (isMulti) {
      card.querySelectorAll(".phBlock").forEach((li) => {
        const idx = parseInt(li.getAttribute("data-idx") || "0", 10);
        const block = blocks[idx - 1] || "";
        const copyBtn = li.querySelector(".phBlockCopy");
        const splitBtn = li.querySelector(".phBlockSplit");
        const delBlockBtn = li.querySelector(".phBlockDel");
        li.addEventListener("mouseenter", () => {
          li.style.background = "rgba(96,165,250,0.12)";
          li.style.borderColor = "rgba(96,165,250,0.45)";
        });
        li.addEventListener("mouseleave", () => {
          li.style.background = "rgba(148,163,184,0.08)";
          li.style.borderColor = "rgba(148,163,184,0.2)";
        });
        copyBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          const ok = await copyTextSafe(block);
          if (ok) {
            await bumpCopyCount(rec);
            ctx.toast(`已复制第 ${idx} 句`);
            await reload();
          } else {
            ctx.toast("复制失败", true);
          }
        });
        splitBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm(`把第 ${idx} 句拆出来作为单独的金句保存？\n（原条目保留，新条目继承当前分类、标签）`)) return;
          try {
            await idb.putPhrase({
              text: block,
              category: rec.category || "",
              tags: Array.isArray(rec.tags) ? [...rec.tags] : [],
              source: rec.source || "",
              note: rec.note || "",
              favorite: false,
            });
            ctx.toast("已拆出为新的金句");
            await reload();
          } catch (err) {
            ctx.toast(err?.message || "拆分失败", true);
          }
        });
        delBlockBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          const remaining = blocks.filter((_, i) => i !== idx - 1);
          if (!remaining.length) {
            if (!confirm(`这是最后一句了，删除后整条金句记录也会被删除。继续？`)) return;
            const snapshot = { ...rec };
            try {
              await idb.deletePhrase(rec.id);
              showUndo([snapshot], `已删除「${makeTitle(rec.text).head || rec.text.slice(0, 24)}…」`);
              ctx.toast("已删除（15 秒内可撤销）");
              await reload();
            } catch (err) {
              ctx.toast(err?.message || "删除失败", true);
            }
            return;
          }
          if (!confirm(`确定删除第 ${idx} 句？\n（剩余 ${remaining.length} 句仍保留在这条金句中）`)) return;
          const snapshot = { ...rec };
          try {
            await idb.patchPhrase(rec.id, { text: remaining.join("\n\n") });
            showUndo([snapshot], `已删除第 ${idx} 句`);
            ctx.toast(`已删除（15 秒内可撤销整条恢复）`);
            await reload();
          } catch (err) {
            ctx.toast(err?.message || "删除失败", true);
          }
        });
      });

      const splitAllBtn = card.querySelector(".phSplitAll");
      splitAllBtn?.addEventListener("click", async () => {
        if (!confirm(`把这条拆分为 ${blocks.length} 条独立金句？\n（原条目会被替换为这 ${blocks.length} 条新条目）`)) return;
        const snapshot = { ...rec };
        try {
          for (const b of blocks) {
            await idb.putPhrase({
              text: b,
              category: rec.category || "",
              tags: Array.isArray(rec.tags) ? [...rec.tags] : [],
              source: rec.source || "",
              note: rec.note || "",
              favorite: false,
            });
          }
          await idb.deletePhrase(rec.id);
          showUndo([snapshot], `已拆分为 ${blocks.length} 条`);
          ctx.toast(`已拆分为 ${blocks.length} 条（15 秒内可撤销）`);
          await reload();
        } catch (err) {
          ctx.toast(err?.message || "拆分失败", true);
        }
      });
    }

    return card;
  }

  // —— 顶部按钮事件 ——
  backBtn.addEventListener("click", () => {
    activeCategory = null;
    activeTags.clear();
    render();
  });
  newProjectBtn.addEventListener("click", () => createProject());
  root.querySelector("#phAdd").addEventListener("click", () => {
    const prefill = activeCategory && activeCategory !== "__all__" ? { category: activeCategory } : null;
    openEditor(prefill);
  });
  root.querySelector("#phBulk").addEventListener("click", openBulk);
  root.querySelector("#phCancel").addEventListener("click", closeEditor);
  root.querySelectorAll(".phPresetCat").forEach((btn) => {
    btn.addEventListener("click", () => {
      editorCategory.value = btn.getAttribute("data-cat") || "";
    });
  });
  root.querySelector("#phSave").addEventListener("click", async () => {
    const text = String(editorText.value || "").trim();
    if (!text) {
      ctx.toast(p.needText || "请输入金句内容", true);
      return;
    }
    const tags = String(editorTags.value || "")
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = {
      text,
      category: String(editorCategory.value || "").trim(),
      tags,
      note: String(editorNote.value || "").trim(),
      source: String(editorSource.value || "").trim(),
    };
    try {
      if (payload.category) await ensureCustomCategory(payload.category);
      if (editingId) {
        await idb.patchPhrase(editingId, payload);
      } else {
        await idb.putPhrase({ ...payload, favorite: false });
      }
      ctx.toast(p.saved || "已保存");
      closeEditor();
      await reload();
    } catch (e) {
      ctx.toast(e?.message || "保存失败", true);
    }
  });

  async function renameCategory(oldName) {
    if (!oldName || oldName === "__all__") return;
    const next = await askTextDialog({
      title: `重命名项目「${oldName}」`,
      value: oldName,
      placeholder: "输入新的项目名称",
      okText: "保存名称",
    });
    if (next == null) return;
    const newName = normalizeCategoryName(next);
    if (!newName || newName === oldName) return;
    const affected = items.filter((it) => (String(it.category || "").trim() || UNCATEGORIZED) === oldName);
    try {
      for (const it of affected) {
        await idb.patchPhrase(it.id, { category: newName === UNCATEGORIZED ? "" : newName });
      }
      const nextCats = customCats.map((c) => (c === oldName ? newName : c));
      if (!nextCats.includes(newName) && !presetCats.includes(newName)) nextCats.push(newName);
      await saveCustomCategories(nextCats.filter((c) => c !== oldName || c === newName));
      ctx.toast(`已将 ${affected.length} 条迁移到「${newName}」`);
      activeCategory = newName === UNCATEGORIZED ? UNCATEGORIZED : newName;
      await reload();
    } catch (e) {
      ctx.toast(e?.message || "重命名失败", true);
    }
  }

  // —— 重命名分类 ——
  renameBtn.addEventListener("click", async () => {
    if (renameBtn.disabled) return;
    await renameCategory(activeCategory);
  });

  // —— 随机一句：从当前过滤结果里随机闪烁一张卡片 ——
  randomBtn.addEventListener("click", () => {
    const cards = [...list.querySelectorAll(".phCard")];
    if (!cards.length) {
      ctx.toast("当前没有金句可随机", true);
      return;
    }
    const pick = cards[Math.floor(Math.random() * cards.length)];
    pick.scrollIntoView({ behavior: "smooth", block: "center" });
    pick.style.transition = "box-shadow 200ms ease, transform 200ms ease";
    pick.style.boxShadow = "0 0 0 3px rgba(250,204,21,0.7), 0 14px 40px rgba(2,6,23,0.55)";
    pick.style.transform = "translateY(-2px)";
    setTimeout(() => {
      pick.style.boxShadow = "";
      pick.style.transform = "";
    }, 1600);
  });

  search.addEventListener("input", render);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (!hitMarks.length) return;
      e.preventDefault();
      gotoNextHit(e.shiftKey ? -1 : 1);
    }
  });
  root.querySelector("#phHitNext")?.addEventListener("click", () => gotoNextHit(1));
  root.querySelector("#phHitPrev")?.addEventListener("click", () => gotoNextHit(-1));
  root.querySelector("#phHitClose")?.addEventListener("click", () => {
    search.value = "";
    render();
    search.focus();
  });
  sortSel.addEventListener("change", render);
  onlyFav.addEventListener("change", render);

  root.querySelector("#phExportJson").addEventListener("click", () => {
    const json = JSON.stringify({ exportedAt: Date.now(), phrases: items }, null, 2);
    downloadBlob(`金句库-${Date.now()}.json`, "application/json", json);
  });
  root.querySelector("#phExportTxt").addEventListener("click", () => {
    const lines = items.map((r) => {
      const head = [r.category, ...(r.tags || [])].filter(Boolean).join(" / ");
      const note = r.note ? `\n  · ${r.note}` : "";
      const source = r.source ? `\n  来源：${r.source}` : "";
      return `${head ? `【${head}】 ` : ""}${r.text || ""}${note}${source}`;
    });
    downloadBlob(`金句库-${Date.now()}.txt`, "text/plain;charset=utf-8", lines.join("\n\n"));
  });
  root.querySelector("#phImport").addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const arr = Array.isArray(data?.phrases) ? data.phrases : Array.isArray(data) ? data : [];
      let n = 0;
      for (const p2 of arr) {
        if (p2 && (p2.text || typeof p2 === "string")) {
          await idb.putPhrase(typeof p2 === "string" ? { text: p2 } : p2);
          n += 1;
        }
      }
      ctx.toast(`已导入 ${n} 条`);
      await reload();
    } catch (e) {
      ctx.toast(e?.message || "导入失败", true);
    } finally {
      importInput.value = "";
    }
  });

  // —— 键盘快捷键：仅当本页可见时生效 ——
  function isInputTarget(t) {
    if (!t) return false;
    const tag = (t.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
  }
  function onKeydown(e) {
    if (!root.isConnected || root.offsetParent === null) return;
    // Esc 处理：关闭编辑器 / 批量 / 撤销条 / 返回分类
    if (e.key === "Escape") {
      if (!editor.classList.contains("hidden")) { closeEditor(); e.preventDefault(); return; }
      if (!bulkPanel.classList.contains("hidden")) { closeBulk(); e.preventDefault(); return; }
      if (activeCategory != null) { activeCategory = null; activeTags.clear(); render(); e.preventDefault(); return; }
      return;
    }
    if (isInputTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); search.focus(); search.select(); return; }
    if (e.key === "n" || e.key === "N") { e.preventDefault(); root.querySelector("#phAdd").click(); return; }
    if (e.key === "b" || e.key === "B") { e.preventDefault(); root.querySelector("#phBulk").click(); return; }
    if (e.key === "f" || e.key === "F") { e.preventDefault(); onlyFav.checked = !onlyFav.checked; render(); return; }
    if (e.key === "r" || e.key === "R") {
      if (activeCategory != null) { e.preventDefault(); randomBtn.click(); }
      return;
    }
  }
  document.addEventListener("keydown", onKeydown);
  root.__phbKeydown = onKeydown;

  // 来自文件阅读器的「保存到金句库」预填
  if (ctx.navPayload && typeof ctx.navPayload === "object" && ctx.navPayload.phrasePrefill) {
    const pf = ctx.navPayload.phrasePrefill;
    openEditor({
      text: String(pf.text || ""),
      category: String(pf.category || ""),
      tags: Array.isArray(pf.tags) ? pf.tags : [],
      source: String(pf.source || ""),
      note: String(pf.note || ""),
    });
  }

  await reload();
}
