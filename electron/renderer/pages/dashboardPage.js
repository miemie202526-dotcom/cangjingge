import * as historyStore from "../services/historyStore.js";
import * as idb from "../services/idbStore.js";
import { emptyState, el } from "../core/ui.js";

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function mountDashboard(root, ctx) {
  root.innerHTML = "";
  const m = ctx.manifest();
  const p = m.pages?.dashboard || {};
  const commandModes = [
    {
      key: "deliver",
      label: "做交付稿",
      hint: "报告、方案、计划、纪要",
      page: "generator",
      genType: "project_plan",
      smartPack: "boss",
    },
    {
      key: "analyze",
      label: "分析资料",
      hint: "提炼结论、风险、机会",
      page: "analysis",
      mode: "business",
      depth: "deep",
    },
    {
      key: "table",
      label: "做表格",
      hint: "统计表、台账、进度表",
      page: "generator",
      genType: "project_tracker",
      smartPack: "table",
    },
    {
      key: "pitch",
      label: "汇报材料",
      hint: "老板、客户、投资人",
      page: "generator",
      genType: "pitch_deck",
      smartPack: "investor",
    },
  ];
  let activeCommandMode = commandModes[0].key;
  const selectedCommandFiles = new Set();

  const head = el(`
    <div class="page-head">
      <div>
        <h1 class="page-title">${p.title || ""}</h1>
        <p class="page-sub">${p.subtitle || ""}</p>
      </div>
      <div class="row">
        <button type="button" class="btn btn-primary" id="dashNewTask">${p.newTaskBtn || ""}</button>
      </div>
    </div>
  `);
  root.appendChild(head);

  const command = el(`
    <section class="dash-command" aria-label="智能任务台">
      <div class="dash-command-main">
        <div class="dash-command-kicker">智能任务台</div>
        <h2>一句话调动资料库、分析与生成</h2>
        <p>输入你要完成的工作，藏经阁会自动组织写作要求、引用资料，并把结果送到最合适的工具里。</p>
        <textarea class="inp dash-command-input" id="dashCommandInput" rows="4" placeholder="例如：用最近上传的资料，给老板做一份本月项目进度汇报，突出风险、预算和下周动作。"></textarea>
        <div class="dash-command-actions">
          <button type="button" class="btn btn-primary" id="dashCommandRun">开始工作</button>
          <button type="button" class="btn btn-secondary" id="dashCommandGen">直接生成</button>
          <button type="button" class="btn btn-secondary" id="dashCommandAna">直接分析</button>
        </div>
      </div>
      <aside class="dash-command-side">
        <div class="dash-command-mode-grid" id="dashCommandModes">
          ${commandModes
            .map(
              (mode, idx) => `
                <button type="button" class="dash-mode ${idx === 0 ? "is-active" : ""}" data-command-mode="${mode.key}">
                  <span>${mode.label}</span>
                  <small>${mode.hint}</small>
                </button>
              `
            )
            .join("")}
        </div>
        <div class="dash-source-panel">
          <div class="dash-source-head">
            <span>可引用资料</span>
            <button type="button" class="btn btn-ghost btn-sm" id="dashSelectRecent">选最近 3 份</button>
          </div>
          <div id="dashCommandFiles" class="dash-source-list muted">正在读取资料库…</div>
        </div>
      </aside>
    </section>
  `);
  root.appendChild(command);

  const grid = el(`<div class="grid-cards" id="dashStats"></div>`);
  root.appendChild(grid);

  const mid = el(`
    <div class="split-2" style="margin-top:16px">
      <div class="card">
        <h3>${p.recentTasks || ""}</h3>
        <div id="dashRecent"></div>
      </div>
      <div class="card">
        <h3>${p.templates || ""}</h3>
        <div class="chips" id="dashTemplates"></div>
        <h3 style="margin-top:16px">${p.quickEntry || ""}</h3>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn btn-secondary btn-sm" data-go="library">${p.navLibrary || ""}</button>
          <button type="button" class="btn btn-secondary btn-sm" data-go="analysis">${p.navAnalysis || ""}</button>
          <button type="button" class="btn btn-secondary btn-sm" data-go="generator">${p.navGenerator || ""}</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(mid);

  const phraseCard = el(`
    <div class="card" id="dashPhraseCard" style="margin-top:14px;background:linear-gradient(135deg,rgba(99,102,241,0.12),rgba(168,85,247,0.10));border:1px solid rgba(168,85,247,0.30)">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">今日金句</h3>
        <div class="row" style="gap:6px">
          <button type="button" class="btn btn-ghost btn-sm" id="dashPhraseRefresh" title="再随机一条">换一条</button>
          <button type="button" class="btn btn-secondary btn-sm" id="dashPhraseGo">打开金句库</button>
        </div>
      </div>
      <div id="dashPhraseBody" class="muted" style="font-size:0.95rem;line-height:1.6;margin-top:10px;white-space:pre-wrap"></div>
      <div id="dashPhraseMeta" class="muted" style="font-size:0.74rem;margin-top:8px"></div>
    </div>
  `);
  root.appendChild(phraseCard);

  const bottom = el(`
    <div class="split-2" style="margin-top:14px">
      <div class="card" id="dashAiCard">
        <h3>${p.aiStatusTitle || ""}</h3>
        <div id="dashAiStatus" class="muted" style="font-size:0.86rem;line-height:1.5"></div>
      </div>
      <div class="card">
        <h3>${p.typeDistTitle || ""}</h3>
        <div id="dashTypeBars"></div>
      </div>
    </div>
  `);
  root.appendChild(bottom);

  async function refreshPhraseOfTheDay() {
    const body = root.querySelector("#dashPhraseBody");
    const meta = root.querySelector("#dashPhraseMeta");
    if (!body || !meta) return;
    let phrases = [];
    try {
      phrases = await idb.listPhrases();
    } catch {
      phrases = [];
    }
    if (!phrases.length) {
      body.textContent = "金句库为空——攒一些佳句进去，每天都会有惊喜推送。";
      meta.textContent = "";
      return;
    }
    const pick = phrases[Math.floor(Math.random() * phrases.length)];
    body.textContent = String(pick.body || pick.title || "").slice(0, 280);
    const tags = Array.isArray(pick.tags) && pick.tags.length ? `· ${pick.tags.join(" / ")}` : "";
    meta.textContent = `分类：${pick.category || "未分类"} ${tags}`.trim();
  }

  phraseCard.querySelector("#dashPhraseRefresh").addEventListener("click", refreshPhraseOfTheDay);
  phraseCard.querySelector("#dashPhraseGo").addEventListener("click", () => ctx.navigate("phrasebook"));
  void refreshPhraseOfTheDay();

  const batchCard = el(`
    <div class="card" style="margin-top:14px;display:none" id="dashBatchCard">
      <h3>${p.batchTitle || ""}</h3>
      <p class="page-sub" style="margin-top:0">${m?.batchPanelBlurb || ""}</p>
      <div class="row">
        <button type="button" class="btn btn-secondary btn-sm" id="dashOpenBatch">${p.openBatchBtn || ""}</button>
      </div>
    </div>
  `);
  root.appendChild(batchCard);

  function activeModeConfig(fallbackKey) {
    return commandModes.find((x) => x.key === (fallbackKey || activeCommandMode)) || commandModes[0];
  }

  function commandFileIds() {
    return [...selectedCommandFiles].filter(Boolean);
  }

  function setCommandMode(key) {
    activeCommandMode = key;
    root.querySelectorAll("[data-command-mode]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-command-mode") === key);
    });
  }

  function inferCommandMode(text) {
    const raw = String(text || "");
    if (/表格|Excel|统计|台账|清单|进度|排期|预算|OKR/i.test(raw)) return "table";
    if (/分析|诊断|风险|机会|总结|提炼|洞察|审查/i.test(raw)) return "analyze";
    if (/投资|融资|路演|客户|汇报|老板|PPT|deck/i.test(raw)) return "pitch";
    return activeCommandMode;
  }

  function buildDashboardPrompt(raw, mode) {
    const text = String(raw || "").trim();
    const base = text || "请基于已选资料，生成一份结构完整、可以直接交付的专业文档。";
    const modeLine =
      mode.key === "analyze"
        ? "请先提炼结论，再给证据、风险、机会和下一步行动。"
        : mode.key === "table"
          ? "请优先输出结构化表格，并附字段说明、公式/统计口径和使用建议。"
          : mode.key === "pitch"
            ? "请按高层汇报/投资人预读材料标准组织，结论清楚、证据充分、风险不回避。"
            : "请输出可直接交付的正式稿，包含摘要、正文、表格、风险与行动计划。";
    return [
      "【来自工作台的一句话任务】",
      base,
      "",
      "【执行要求】",
      modeLine,
      "- 结合已选资料，不要只写通用模板。",
      "- 输出要专业、有层次、可落地。",
      "- 对缺失信息做合理假设，并在文末列出假设与待补资料。",
    ].join("\n");
  }

  function runCommand(forcedKey) {
    const input = root.querySelector("#dashCommandInput");
    const raw = input?.value?.trim() || "";
    const inferred = forcedKey || inferCommandMode(raw);
    setCommandMode(inferred);
    const mode = activeModeConfig(inferred);
    const fileIds = commandFileIds();
    if (mode.page === "analysis") {
      ctx.navigate("analysis", {
        fileIds,
        mode: mode.mode || "business",
        depth: mode.depth || "deep",
        quickPrompt: buildDashboardPrompt(raw, mode),
      });
      return;
    }
    ctx.navigate("generator", {
      fileIds,
      genType: mode.genType || "project_plan",
      smartPack: mode.smartPack || "boss",
      quickPrompt: buildDashboardPrompt(raw, mode),
    });
  }

  function renderCommandFiles(lib) {
    const host = root.querySelector("#dashCommandFiles");
    if (!host) return;
    selectedCommandFiles.clear();
    const ranked = [...(lib || [])]
      .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || (b.uploadedAt || 0) - (a.uploadedAt || 0))
      .slice(0, 8);
    if (!ranked.length) {
      host.innerHTML = `<div class="dash-source-empty">资料库暂无文件。可先点「一键开始新任务」上传资料。</div>`;
      return;
    }
    host.innerHTML = "";
    ranked.forEach((rec, idx) => {
      if (idx < 3) selectedCommandFiles.add(rec.id);
      const row = el(`
        <label class="dash-source-item ${idx < 3 ? "is-selected" : ""}">
          <input type="checkbox" data-dash-file="${escapeHtml(rec.id)}" ${idx < 3 ? "checked" : ""} />
          <span>
            <b>${escapeHtml(String(rec.fileName || "未命名文件").slice(0, 56))}</b>
            <small>${escapeHtml(String(rec.category || (rec.favorite ? "收藏资料" : "最近资料")))} · ${rec.uploadedAt ? new Date(rec.uploadedAt).toLocaleDateString() : "—"}</small>
          </span>
        </label>
      `);
      const cb = row.querySelector("input");
      cb?.addEventListener("change", () => {
        if (cb.checked) selectedCommandFiles.add(rec.id);
        else selectedCommandFiles.delete(rec.id);
        row.classList.toggle("is-selected", cb.checked);
      });
      host.appendChild(row);
    });
  }

  command.querySelector("#dashCommandModes")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-command-mode]");
    if (!btn) return;
    setCommandMode(btn.getAttribute("data-command-mode") || "deliver");
  });

  command.querySelector("#dashCommandRun")?.addEventListener("click", () => runCommand());
  command.querySelector("#dashCommandGen")?.addEventListener("click", () => runCommand("deliver"));
  command.querySelector("#dashCommandAna")?.addEventListener("click", () => runCommand("analyze"));
  command.querySelector("#dashCommandInput")?.addEventListener("input", (e) => {
    const key = inferCommandMode(e.target?.value || "");
    setCommandMode(key);
  });
  command.querySelector("#dashSelectRecent")?.addEventListener("click", () => {
    root.querySelectorAll("[data-dash-file]").forEach((cb, idx) => {
      cb.checked = idx < 3;
      cb.closest(".dash-source-item")?.classList.toggle("is-selected", idx < 3);
      const id = cb.getAttribute("data-dash-file");
      if (!id) return;
      if (idx < 3) selectedCommandFiles.add(id);
      else selectedCommandFiles.delete(id);
    });
  });

  let loadSeq = 0;
  let loadDebounceTimer = 0;

  async function load() {
    const seq = ++loadSeq;
    grid.innerHTML = `<div class="loader"></div>`;
    let lib = [];
    let hist = [];
    try {
      [lib, hist] = await Promise.all([idb.listFiles(), historyStore.listHistory()]);
    } catch (e) {
      ctx.toast(
        `${m?.messages?.libLoadFailed || "文件库加载失败"} ${m?.messages?.libLoadRetry || ""}`.trim(),
        true
      );
    }
    if (seq !== loadSeq) return;
    grid.innerHTML = "";
    renderCommandFiles(lib);

    const t0 = historyStore.todayStart();
    const todayN = hist.filter((x) => (x.at || x.createdAt || 0) >= t0).length;
    const genN = hist.filter((h) => ["generate", "analysis"].includes(h.type)).length;

    const stat = (title, num, hint) => {
      const c = el(`<div class="card"><h3>${title}</h3><div class="stat-num">${num}</div><div class="muted" style="font-size:0.78rem;margin-top:6px">${hint}</div></div>`);
      grid.appendChild(c);
    };
    stat(p.statToday || "", todayN, p.statTodayHint || "");
    stat(p.statLibrary || "", lib.length, p.statLibraryHint || "");
    stat(p.statCumulative || "", String(genN), p.statCumulativeHint || "");

    const recent = root.querySelector("#dashRecent");
    recent.innerHTML = "";
    const slice = hist.slice(0, 8);
    if (!slice.length) {
      emptyState(recent, p.emptyRecentTitle || "", p.emptyRecentHint || "");
    } else {
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;flex-direction:column;gap:6px";
      recent.appendChild(wrap);
      slice.forEach((h) => {
        const ts = h.at || h.createdAt || 0;
        const t = new Date(ts).toLocaleString();
        const row = document.createElement("button");
        row.type = "button";
        row.className = "btn btn-ghost btn-sm";
        row.style.cssText = "justify-content:flex-start;text-align:left;padding:8px 10px;background:rgba(15,23,42,0.35);border:1px solid rgba(148,163,184,0.18);border-radius:8px;font-size:0.84rem;line-height:1.4;color:#e2e8f0;width:100%";
        row.innerHTML = `<span class="muted" style="font-size:0.72rem;display:block;margin-bottom:2px">${t} · ${h.type}</span>${escapeHtml(String(h.title || "").slice(0, 64))}`;
        row.title = `点击跳转到「历史记录」并查看本条详情`;
        row.addEventListener("click", () => ctx.navigate("history", { selectId: h.id }));
        wrap.appendChild(row);
      });
    }

    const tpl = root.querySelector("#dashTemplates");
    tpl.innerHTML = "";
    const chips = Array.isArray(p.templateChips) ? p.templateChips : [];
    chips.forEach((chip) => {
      const label = String(chip.label || "");
      const page = String(chip.page || "");
      const payload = {};
      if (chip.genType) payload.genType = chip.genType;
      if (chip.mode) payload.mode = chip.mode;
      const b = el(`<button type="button" class="chip">${label}</button>`);
      b.addEventListener("click", () => ctx.navigate(page, payload));
      tpl.appendChild(b);
    });

    const extCount = {};
    lib.forEach((f) => {
      const ext = (f.ext || "").replace(".", "").toUpperCase() || "FILE";
      extCount[ext] = (extCount[ext] || 0) + 1;
    });
    const bars = root.querySelector("#dashTypeBars");
    bars.innerHTML = "";
    const keys = Object.keys(extCount).sort((a, b) => extCount[b] - extCount[a]);
    if (!keys.length) {
      bars.innerHTML = `<div class="muted">${p.noFiles || ""}</div>`;
    } else {
      const max = Math.max(...keys.map((k) => extCount[k]), 1);
      keys.forEach((k) => {
        const pct = Math.round((extCount[k] / max) * 100);
        const row = el(`
          <div class="bar-row">
            <span style="width:52px">${k}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
            <span style="width:24px;text-align:right">${extCount[k]}</span>
          </div>
        `);
        bars.appendChild(row);
      });
    }

    const ai = root.querySelector("#dashAiStatus");
    try {
      const st = await ctx.ipc.openaiKeyStatus();
      const parts = [];
      if (st?.hasEnvKey) parts.push(p.keyEnv || "");
      if (st?.hasStoredKey) parts.push(p.keyStored || "");
      if (ctx.getApiKey()) parts.push(p.keySession || "");
      parts.push(`${p.currentModel || ""}<b>${ctx.getModel()}</b>`);
      const be = idb.getStorageBackend();
      const beLabel =
        be === "indexedDB"
          ? p.storageIndexedDb || "IndexedDB"
          : be === "localStorage"
            ? p.storageLocalStorage || "localStorage"
            : p.storageUninit || "—";
      parts.push(`${p.storageLine || ""}<b>${beLabel}</b>`);
      if (be === "localStorage") parts.push(`<span class="muted">${p.storageHint || ""}</span>`);
      ai.innerHTML = parts.join("<br/>") || p.keyNoneHtml || "";
    } catch {
      ai.textContent = p.keyCheckFail || "";
    }

    const stg = ctx.settings();
    batchCard.style.display = stg.batchEnabled ? "block" : "none";
  }

  head.querySelector("#dashNewTask").addEventListener("click", () => ctx.navigate("library", { focusUpload: true }));

  mid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (!b) return;
    ctx.navigate(b.getAttribute("data-go"));
  });

  root.querySelector("#dashOpenBatch").addEventListener("click", () => ctx.navigate("settings"));

  function queueLoad() {
    clearTimeout(loadDebounceTimer);
    loadDebounceTimer = window.setTimeout(() => load(), 140);
  }

  const onLib = () => queueLoad();
  window.addEventListener("ai-pro-library-changed", onLib);
  window.addEventListener(idb.STORE_CHANGED_EVENT, onLib);
  load();

  return {
    destroy() {
      clearTimeout(loadDebounceTimer);
      window.removeEventListener("ai-pro-library-changed", onLib);
      window.removeEventListener(idb.STORE_CHANGED_EVENT, onLib);
      root.innerHTML = "";
    },
  };
}
