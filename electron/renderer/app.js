import { loadSettings, saveSettings } from "./services/settingsStore.js";
import * as idb from "./services/idbStore.js";
import * as orchestrator from "./services/aiOrchestrator.js";
import { toast } from "./core/ui.js";
import { mountDashboard } from "./pages/dashboardPage.js";
import { mountFileLibrary } from "./pages/fileLibraryPage.js";
import { mountAiAnalysis } from "./pages/aiAnalysisPage.js";
import { mountDocumentGenerator } from "./pages/documentGeneratorPage.js";
import { mountPhrasebook } from "./pages/phrasebookPage.js";
import { mountHistory } from "./pages/historyPage.js";
import { mountSettings } from "./pages/settingsPage.js";

const PROJECT_KEY = "aiPro.projectName.v1";
const THEME_OPTIONS = [
  { value: "graphite", label: "石墨" },
  { value: "forest", label: "护眼" },
  { value: "ocean", label: "海盐" },
  { value: "paper", label: "暖纸" },
  { value: "dusk", label: "暮蓝" },
  { value: "dark", label: "深色" },
  { value: "light", label: "浅色" },
];
const VIEW_OPTIONS = [
  { value: "standard", label: "标准" },
  { value: "focus", label: "宽屏" },
  { value: "large", label: "大字" },
  { value: "compact", label: "紧凑" },
];
const LIGHT_THEMES = new Set(["light", "paper", "ocean"]);
const THEME_CLASS_NAMES = ["theme-dark", "theme-light", ...THEME_OPTIONS.map((x) => `theme-${x.value}`)];
const VIEW_CLASS_NAMES = VIEW_OPTIONS.map((x) => `view-${x.value}`);
const PAGE_ICON_LABELS = {
  dashboard: "⌘",
  library: "▦",
  analysis: "✦",
  generator: "✎",
  phrasebook: "❝",
  history: "↺",
  settings: "⚙",
};
const COMMAND_PAGE_ORDER = [
  "dashboard",
  "library",
  "analysis",
  "generator",
  "phrasebook",
  "history",
  "settings",
];

/** @type {HTMLElement | null} */
let globalApiKeyInput = null;
/** @type {(() => void) | null} */
let activeDestroy = null;
/** @type {string} */
let currentPage = "dashboard";

function getToastHost() {
  return document.getElementById("toastHost");
}

function getApiKeyForIpc() {
  return globalApiKeyInput?.value?.trim() ?? "";
}

function applyTheme(theme) {
  const body = document.body;
  const themeValue = THEME_OPTIONS.some((x) => x.value === theme) ? theme : "graphite";
  body.classList.remove(...THEME_CLASS_NAMES);
  body.classList.add(`theme-${themeValue}`);
  body.classList.add(LIGHT_THEMES.has(themeValue) ? "theme-light" : "theme-dark");
  body.dataset.theme = themeValue;
  const sel = document.getElementById("headerThemeBtn");
  if (sel) sel.value = themeValue;
}

function applyViewMode(mode) {
  const body = document.body;
  const viewValue = VIEW_OPTIONS.some((x) => x.value === mode) ? mode : "standard";
  body.classList.remove(...VIEW_CLASS_NAMES);
  body.classList.add(`view-${viewValue}`);
  body.dataset.view = viewValue;
  const sel = document.getElementById("headerViewMode");
  if (sel) sel.value = viewValue;
}

function navigate(page, payload) {
  const safePage = page === "icon" || page === "image-edit" ? "library" : page;
  if (payload && typeof payload === "object") {
    sessionStorage.setItem("aiPro.navPayload", JSON.stringify({ targetPage: safePage, ...payload }));
  } else {
    sessionStorage.removeItem("aiPro.navPayload");
  }
  void setActivePage(safePage).catch((e) => {
    console.error("[navigate]", e);
    toast(getToastHost(), `无法打开页面：${e?.message || e}`, true);
  });
}

function consumeNavPayload(page) {
  const raw = sessionStorage.getItem("aiPro.navPayload");
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o.targetPage !== page) return null;
    sessionStorage.removeItem("aiPro.navPayload");
    return o;
  } catch {
    sessionStorage.removeItem("aiPro.navPayload");
    return null;
  }
}

async function setActivePage(page) {
  currentPage = page;
  const navRoot = document.getElementById("sidebarNav");
  if (navRoot) {
    navRoot.querySelectorAll(".nav-item").forEach((b) => {
      b.classList.remove("active");
      b.removeAttribute("aria-current");
      if (b instanceof HTMLElement) b.blur();
    });
    navRoot.querySelectorAll(".nav-item").forEach((b) => {
      if (b.getAttribute("data-page") === page) {
        b.classList.add("active");
        b.setAttribute("aria-current", "page");
      }
    });
  }
  document.querySelectorAll(".page-stack .page").forEach((p) => {
    p.classList.toggle("active", p.id === `page-${page}`);
  });

  if (activeDestroy) {
    try {
      activeDestroy();
    } catch (e) {
      console.error(e);
    }
    activeDestroy = null;
  }

  const inner = document.querySelector(`#page-${page} .page-inner`);
  if (!inner) return;

  const ctx = buildCtx(inner);
  ctx.navPayload = consumeNavPayload(page);

  const mounts = {
    dashboard: mountDashboard,
    library: mountFileLibrary,
    analysis: mountAiAnalysis,
    generator: mountDocumentGenerator,
    phrasebook: mountPhrasebook,
    history: mountHistory,
    settings: mountSettings,
  };
  const fn = mounts[page];
  if (fn) {
    try {
      const r = await Promise.resolve(fn(inner, ctx));
      activeDestroy = r?.destroy ?? null;
    } catch (e) {
      console.error("[setActivePage]", page, e);
      inner.innerHTML = "";
      const box = document.createElement("div");
      box.className = "card err-box";
      box.style.padding = "16px";
      box.textContent = `页面加载失败：${e?.message || e}`;
      inner.appendChild(box);
      activeDestroy = null;
    }
  }
}

function buildCtx(root) {
  /** @type {any} */
  const ctx = {
    root,
    ipc: window.aiDesktop,
    manifest: () => window.__aiProManifest,
    toast: (msg, err) => toast(getToastHost(), msg, err),
    navigate,
    getApiKey: () => getApiKeyForIpc(),
    getModel: () => document.getElementById("headerModel")?.value || "gpt-4.1-mini",
    settings: loadSettings,
    saveSettings,
    applyTheme,
    applyViewMode,
    emitLibraryChanged: () => {
      window.dispatchEvent(new CustomEvent("ai-pro-library-changed"));
      window.dispatchEvent(new CustomEvent(idb.STORE_CHANGED_EVENT));
    },
    emitStoreChanged: () => window.dispatchEvent(new CustomEvent(idb.STORE_CHANGED_EVENT)),
  };
  ctx.runAnalysis = (opts) => orchestrator.runAnalysis(ctx, opts);
  ctx.runDocumentGenerate = (opts) => orchestrator.runDocumentGenerate(ctx, opts);
  ctx.runPolish = (opts) => orchestrator.runPolish(ctx, opts);
  return ctx;
}

function pageLabelFromManifest(manifest, page) {
  const n = manifest?.chrome?.nav || {};
  const map = {
    dashboard: n.dashboard || "工作台",
    library: n.library || "文件库",
    analysis: n.analysis || "AI 分析",
    generator: n.generate || "文件生成",
    phrasebook: n.phrasebook || "金句库",
    history: n.history || "历史记录",
    settings: n.settings || "设置",
  };
  return map[page] || page;
}

function commandHaystack(item) {
  return [item.title, item.subtitle, item.keywords, item.page, item.kind].filter(Boolean).join(" ").toLowerCase();
}

function makeCommandItems(query) {
  const manifest = window.__aiProManifest || {};
  const q = String(query || "").trim();
  const pageItems = COMMAND_PAGE_ORDER.map((page) => ({
    kind: "page",
    page,
    icon: PAGE_ICON_LABELS[page] || "•",
    title: pageLabelFromManifest(manifest, page),
    subtitle: page === currentPage ? "当前页面" : "打开页面",
    keywords: `${page} ${pageLabelFromManifest(manifest, page)} 导航 打开`,
  }));
  const taskItems = [
    {
      kind: "action",
      action: "library-qa",
      icon: "?",
      title: q ? `问资料库：${q}` : "问整个文件库",
      subtitle: "跨文件回答，给证据文件、风险和下一步动作",
      keywords: "问资料库 问文件库 知识库 qa 问答 答案 证据",
    },
    {
      kind: "action",
      action: "library-search",
      icon: "⌕",
      title: q ? `在文件库搜索「${q}」` : "搜索资料库",
      subtitle: "文件名、正文、标签、分类、标注一起查",
      keywords: "搜索 查找 文件 资料 聊天 记录 library",
    },
    {
      kind: "action",
      action: "analysis",
      icon: "✦",
      title: q ? `分析：${q}` : "进入 AI 分析",
      subtitle: "总结、风险、聊天洞察、财务表格、老板汇报",
      keywords: "分析 总结 风险 审查 洞察 AI",
    },
    {
      kind: "action",
      action: "generator",
      icon: "✎",
      title: q ? `生成文件：${q}` : "进入文件生成",
      subtitle: "报告、方案、表格、纪要、合同、PPT 大纲",
      keywords: "生成 文件 报告 方案 表格 文档",
    },
    {
      kind: "action",
      action: "upload",
      icon: "＋",
      title: "上传资料入库",
      subtitle: "把 PDF / Word / Excel / 聊天记录放进文件库",
      keywords: "上传 导入 入库 文件 资料",
    },
    {
      kind: "action",
      action: "settings",
      icon: "⚙",
      title: "配置密钥与导出设置",
      subtitle: "模型、API Key、默认导出格式、本地备份",
      keywords: "设置 密钥 api key 模型 导出",
    },
  ];
  const all = [...taskItems, ...pageItems];
  if (!q) return all.slice(0, 10);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return all
    .map((item) => {
      const hay = commandHaystack(item);
      const score = terms.reduce((sum, t) => sum + (hay.includes(t) ? 1 : 0), 0);
      const titleBoost = String(item.title || "").toLowerCase().includes(q.toLowerCase()) ? 2 : 0;
      const actionBoost = item.kind === "action" ? 1 : 0;
      return { item, score: score + titleBoost + actionBoost };
    })
    .filter((x) => x.score > 0 || x.item.kind === "action")
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item)
    .slice(0, 10);
}

function setupCommandPalette() {
  const overlay = document.getElementById("commandOverlay");
  const input = document.getElementById("commandInput");
  const results = document.getElementById("commandResults");
  const btn = document.getElementById("headerCommandBtn");
  const closeBtn = document.getElementById("commandClose");
  if (!overlay || !input || !results || !btn) return;

  let activeIndex = 0;
  let items = [];

  function execute(item) {
    const q = String(input.value || "").trim();
    close();
    if (!item) return;
    if (item.kind === "page" && item.page) {
      navigate(item.page);
      return;
    }
    if (item.action === "library-qa") {
      navigate("library", q ? { qaQuestion: q } : undefined);
    } else if (item.action === "library-search") {
      navigate("library", q ? { quickSearch: q } : undefined);
    } else if (item.action === "analysis") {
      navigate("analysis", q ? { quickPrompt: q, depth: "deep" } : undefined);
    } else if (item.action === "generator") {
      navigate("generator", q ? { quickPrompt: q, genType: "project_plan" } : undefined);
    } else if (item.action === "upload") {
      navigate("library", { autoUpload: true });
    } else if (item.action === "settings") {
      navigate("settings");
    }
  }

  function render() {
    items = makeCommandItems(input.value);
    if (activeIndex >= items.length) activeIndex = Math.max(0, items.length - 1);
    results.innerHTML = "";
    items.forEach((item, idx) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `command-item${idx === activeIndex ? " is-active" : ""}`;
      row.dataset.idx = String(idx);
      const icon = document.createElement("span");
      icon.className = "command-item-ico";
      icon.textContent = item.icon || "•";
      const body = document.createElement("span");
      body.className = "command-item-body";
      const title = document.createElement("strong");
      title.textContent = item.title || "";
      const sub = document.createElement("small");
      sub.textContent = item.subtitle || "";
      body.append(title, sub);
      row.append(icon, body);
      row.addEventListener("mouseenter", () => {
        activeIndex = idx;
        render();
      });
      row.addEventListener("click", () => execute(item));
      results.appendChild(row);
    });
  }

  function open(prefill = "") {
    input.value = prefill;
    activeIndex = 0;
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    render();
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  function close() {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    btn.focus();
  }

  btn.addEventListener("click", () => open());
  closeBtn?.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  input.addEventListener("input", () => {
    activeIndex = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(items.length - 1, activeIndex + 1);
      render();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      execute(items[activeIndex]);
    }
  });
  document.addEventListener("keydown", (e) => {
    const isCmdK = (e.metaKey || e.ctrlKey) && String(e.key || "").toLowerCase() === "k";
    if (isCmdK) {
      e.preventDefault();
      open();
    } else if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
      e.preventDefault();
      close();
    }
  });
}

async function refreshKeyBadge() {
  const badge = document.getElementById("headerKeyBadge");
  const m = window.__aiProManifest?.messages;
  if (!badge || !m) return;
  try {
    const st = await window.aiDesktop.openaiKeyStatus();
    const hasInput = Boolean(getApiKeyForIpc());
    const bits = [];
    if (st?.hasEnvKey) bits.push(m.envKeyActive || "ENV");
    if (st?.hasStoredKey) bits.push(m.storedKeyActive || "已存");
    if (hasInput) bits.push("会话");
    badge.textContent = bits.length ? bits.join(" · ") : m.noKeyHint || "—";
    badge.classList.toggle("muted", !bits.length);
  } catch {
    badge.textContent = "—";
  }
}

async function bootstrap() {
  globalApiKeyInput = document.createElement("input");
  globalApiKeyInput.type = "password";
  globalApiKeyInput.id = "globalApiKey";
  globalApiKeyInput.autocomplete = "off";
  globalApiKeyInput.style.cssText = "position:absolute;left:-9999px;opacity:0;width:1px;height:1px;";
  document.body.appendChild(globalApiKeyInput);

  try {
    const k = await window.aiDesktop.getApiKey();
    if (k?.value) globalApiKeyInput.value = k.value;
  } catch {
    // ignore
  }

  /** 先拉清单并画界面，避免 IndexedDB.open 卡住时整页永远不 mount */
  /** @type {any} */
  let manifest = null;
  try {
    manifest = await window.aiDesktop.getDesktopManifest();
  } catch (e) {
    console.warn("[bootstrap] manifest load", e);
  }
  const m = manifest || (await window.aiDesktop.getDesktopManifest());
  window.__aiProManifest = m;
  document.title = m.windowTitle || document.title;

  const brand = document.getElementById("sidebarBrandTitle");
  if (brand) brand.textContent = m.sidebarBrandTitle || "";
  const bm = document.getElementById("sidebarBuildMeta");
  if (bm) bm.textContent = m.buildLine || "";
  const tag = document.getElementById("sidebarTagline");
  if (tag) tag.textContent = m.sidebarTagline || "";
  // 把版本号同步到底部小药丸（侧边栏长篇副标题已 CSS 隐藏，仅保留语义）
  try {
    const versionMatch = String(m.buildLine || "").match(/(\d+\.\d+\.\d+)/);
    const ver = versionMatch ? versionMatch[1] : "";
    const verEl = document.getElementById("sidebarFootVer");
    if (verEl && ver) verEl.textContent = ver;
  } catch {
    /* ignore */
  }

  const n = m.chrome?.nav;
  if (n) {
    const navPairs = [
      ["dashboard", n.dashboard],
      ["library", n.library],
      ["analysis", n.analysis],
      ["generator", n.generate],
      ["phrasebook", n.phrasebook],
      ["history", n.history],
      ["settings", n.settings],
    ];
    navPairs.forEach(([page, label]) => {
      const el = document.querySelector(`#sidebarNav .nav-item[data-page="${page}"] [data-nav="${page}"]`);
      if (el) el.textContent = label;
      const ico = document.querySelector(`#sidebarNav .nav-item[data-page="${page}"] .nav-ico`);
      if (ico && PAGE_ICON_LABELS[page]) ico.textContent = PAGE_ICON_LABELS[page];
    });
  }

  const h = m.chrome?.header;
  const lbl = document.getElementById("lblHeaderModel");
  if (lbl && h) lbl.textContent = h.modelLabel;
  const st = loadSettings();
  const sel = document.getElementById("headerModel");
  if (sel) {
    sel.innerHTML = "";
    (m.modelSelectOptions || []).forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.value = st.defaultModel || sel.options[0]?.value || "gpt-4.1-mini";
    sel.addEventListener("change", () => {
      saveSettings({ defaultModel: sel.value });
    });
  }

  const pn = document.getElementById("headerProjectName");
  if (pn) {
    try {
      const saved = localStorage.getItem(PROJECT_KEY);
      if (saved) pn.value = saved;
    } catch {
      // ignore
    }
    if (h) pn.placeholder = h.projectPlaceholder || "";
    pn.addEventListener("input", () => localStorage.setItem(PROJECT_KEY, pn.value.trim()));
  }

  const themeSel = document.getElementById("headerThemeBtn");
  if (themeSel) {
    themeSel.innerHTML = "";
    THEME_OPTIONS.forEach((theme) => {
      const opt = document.createElement("option");
      opt.value = theme.value;
      opt.textContent = theme.label;
      themeSel.appendChild(opt);
    });
    themeSel.addEventListener("change", () => {
      const next = themeSel.value || "graphite";
      saveSettings({ theme: next });
      applyTheme(next);
    });
  }
  const savedTheme = THEME_OPTIONS.some((x) => x.value === st.theme) ? st.theme : st.theme === "light" ? "light" : "graphite";
  applyTheme(savedTheme);

  const viewSel = document.getElementById("headerViewMode");
  if (viewSel) {
    viewSel.innerHTML = "";
    VIEW_OPTIONS.forEach((view) => {
      const opt = document.createElement("option");
      opt.value = view.value;
      opt.textContent = view.label;
      viewSel.appendChild(opt);
    });
    viewSel.addEventListener("change", () => {
      const next = viewSel.value || "standard";
      saveSettings({ viewMode: next });
      applyViewMode(next);
    });
  }
  applyViewMode(VIEW_OPTIONS.some((x) => x.value === st.viewMode) ? st.viewMode : "standard");
  setupCommandPalette();

  const navRoot = document.getElementById("sidebarNav");
  if (navRoot) {
    navRoot.addEventListener("click", (e) => {
      const btn = e.target.closest(".nav-item");
      if (!btn) return;
      const page = btn.getAttribute("data-page");
      if (page) navigate(page);
    });
  }

  globalApiKeyInput.addEventListener("input", refreshKeyBadge);
  window.addEventListener("ai-pro-api-key-changed", refreshKeyBadge);
  navigate("dashboard");
  queueMicrotask(() => {
    refreshKeyBadge().catch(() => {});
  });

  void idb.initStoreWithLibrary(window.aiDesktop).catch((e) => {
    console.error(e);
    toast(getToastHost(), `数据层初始化失败：${e?.message || e}`, true);
  });
}

bootstrap().catch((err) => {
  console.error(err);
  toast(getToastHost(), String(err?.message || err), true);
});
