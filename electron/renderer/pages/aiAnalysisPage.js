import * as historyStore from "../services/historyStore.js";
import * as idb from "../services/idbStore.js";
import {
  clientFileHealth,
  currentProjectName,
  loadWorkbenchVersions,
  LS_ANALYSIS_VERSIONS,
  pushWorkbenchVersion,
  recommendModesFromDoc,
} from "../services/workbenchShared.js";
import { el, errorState } from "../core/ui.js";

export function mountAiAnalysis(root, ctx) {
  root.innerHTML = "";
  const m = ctx.manifest();
  const p = m.pages?.analysis || {};
  const analysisPlaybooks = [
    {
      key: "summary",
      label: "资料总结",
      desc: "长文、聊天、会议记录快速变成摘要和重点",
      mode: "summary",
      depth: "standard",
      prompt:
        "请把资料整理成可直接阅读的总结：先给结论，再列关键事实、时间线、重要人物/对象、需要继续确认的信息。",
    },
    {
      key: "chat",
      label: "聊天洞察",
      desc: "从聊天记录里抓需求、承诺、风险和跟进动作",
      mode: "persona",
      depth: "deep",
      prompt:
        "请按聊天记录分析：客户/对方真实诉求、情绪变化、已承诺事项、潜在风险、下一步沟通话术和行动清单。",
    },
    {
      key: "risk",
      label: "风险审查",
      desc: "合同、项目、交易、方案里的风险先标出来",
      mode: "risk",
      depth: "deep",
      prompt:
        "请做风险审查：按高/中/低优先级列出风险、触发条件、可能损失、规避动作和需要补充的证据。",
    },
    {
      key: "finance",
      label: "财务表格",
      desc: "数字、流水、Excel、报价和成本结构化分析",
      mode: "finance",
      depth: "deep",
      prompt:
        "请分析财务与表格信息：提取关键指标、异常数据、收入/成本/现金流线索，并给出可落地的判断和表格化建议。",
    },
    {
      key: "boss",
      label: "老板汇报",
      desc: "把复杂资料压缩成决策摘要和下一步",
      mode: "strategy",
      depth: "standard",
      prompt:
        "请生成老板汇报版：一页内说明现状、核心结论、关键风险、可选方案、建议决策和下一步负责人/截止时间。",
    },
    {
      key: "actions",
      label: "行动清单",
      desc: "直接提取任务、负责人、优先级和截止点",
      mode: "ops",
      depth: "standard",
      prompt:
        "请提取行动清单：每项写清任务、目标、负责人角色、优先级、截止时间/触发条件、所需资料和验收标准。",
    },
  ];

  root.appendChild(
    el(`
    <div class="page-head wb-page-head">
      <div>
        <h1 class="page-title">${p.title || ""}</h1>
        <p class="page-sub page-sub--tight">${p.subtitle || ""}</p>
      </div>
      <div class="row">
        <button type="button" class="btn btn-secondary btn-sm" id="anUpload">${p.uploadIngest || ""}</button>
        <input type="file" id="anFileInput" multiple style="display:none" />
      </div>
    </div>

    <div class="wb-sticky wb-sticky--top">
      <button type="button" class="btn btn-primary" id="anRunSticky">${p.stickyGen || p.run || ""}</button>
      <button type="button" class="btn btn-secondary" id="anSaveSticky">${p.stickySave || p.saveHist || ""}</button>
      <button type="button" class="btn btn-secondary" id="anCopySticky">${p.stickyCopy || p.copy || ""}</button>
      <select class="inp wb-sticky-select" id="anExFmt" title="${String(p.exportFmtBarHint || p.exportFmtPlaceholder || "").replace(/"/g, "&quot;")}" aria-label="${String(p.stickyExport || "导出").replace(/"/g, "&quot;")}"></select>
      <button type="button" class="btn btn-secondary" id="anExSticky">${p.stickyExport || "导出"}</button>
      <button type="button" class="btn btn-ghost" id="anRerunSticky">${p.stickyRerun || p.btnRerun || ""}</button>
    </div>

    <div class="workbench">
      <div class="wb-body">
        <nav class="wb-tabs" role="tablist" aria-label="工作台分区">
          <button type="button" class="wb-tab is-active" data-wb-tab="input">${p.tabInput || "输入"}</button>
          <button type="button" class="wb-tab" data-wb-tab="output">${p.tabOutput || "输出"}</button>
          <button type="button" class="wb-tab" data-wb-tab="export">${p.tabExport || "导出"}</button>
          <button type="button" class="wb-tab" data-wb-tab="versions">${p.tabVersions || "版本"}</button>
        </nav>

        <div class="wb-panel is-active" data-wb-panel="input">
          <section class="an-command-panel">
            <div class="an-command-copy">
              <div class="an-kicker">智能分析任务台</div>
              <h2>选择一个目标，资料会按工作场景进入分析</h2>
              <p class="muted">适合后期放入大量聊天记录、合同、表格和项目资料；也可以不选文件，只写问题直接分析。</p>
            </div>
            <div class="an-command-grid">
              ${analysisPlaybooks
                .map(
                  (x) => `
                <button type="button" class="an-playbook" data-an-playbook="${x.key}">
                  <strong>${x.label}</strong>
                  <span>${x.desc}</span>
                </button>`
                )
                .join("")}
            </div>
          </section>
          <div class="card wb-card">
            <h3>${p.healthTitle || ""}</h3>
            <p id="anHealth" class="wb-prose-muted"></p>
          </div>
          <div class="card wb-card">
            <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <h3 style="margin:0">${p.pickFilesTitle || ""}</h3>
              <input type="search" class="inp" id="anFileSearch" placeholder="过滤文件名 / 标签…" style="max-width:220px" />
            </div>
            <div id="anFilePick" class="muted wb-prose-muted" style="margin-top:8px">${p.pickLoading || ""}</div>
          </div>
          <div class="card wb-card">
            <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <h3 style="margin:0">${p.recModeTitle || ""}</h3>
              <button type="button" class="btn btn-secondary btn-sm" id="anApplyRec" title="把推荐模式应用到下方分析模式">采用推荐</button>
            </div>
            <p id="anRecModes" class="wb-prose-muted muted" style="margin-top:6px"></p>
          </div>
          <div class="row wb-field-row">
            <label class="muted wb-label">${p.modeLabel || ""}</label>
            <select class="inp wb-inp-grow" id="anMode"></select>
            <label class="muted wb-label">${p.depthLabel || ""}</label>
            <select class="inp" id="anDepth"></select>
          </div>
          <label class="muted wb-label">${p.customQ || ""}</label>
          <textarea class="inp wb-textarea" id="anQ" rows="5" placeholder="${(m?.instructionPlaceholder || "").replace(/"/g, "&quot;")}"></textarea>
        </div>

        <div class="wb-panel" data-wb-panel="output">
          <div id="anResultAnchor" class="wb-anchor"></div>
          <div class="card wb-card">
            <h3>${p.reportTitle || ""}</h3>
            <textarea class="inp wb-textarea wb-textarea--tall" id="anOut" spellcheck="false" placeholder="${String(p.reportPlaceholder || "").replace(/"/g, "&quot;")}"></textarea>
          </div>
          <details class="wb-details">
            <summary>${p.toolkitTitle || "决策工具箱"}</summary>
            <div id="anToolkitHost" class="wb-toolkit-host"></div>
          </details>
          <details class="wb-details">
            <summary>${p.toolBar || "快速改写"}</summary>
            <div class="wb-quick-actions">
              <button type="button" class="btn btn-secondary btn-sm" id="anExpand">${p.btnExpand || ""}</button>
              <button type="button" class="btn btn-secondary btn-sm" id="anExtract">${p.btnExtract || ""}</button>
              <button type="button" class="btn btn-secondary btn-sm" id="anActList">${p.btnActions || ""}</button>
              <button type="button" class="btn btn-secondary btn-sm" id="anBoss">${p.btnBoss || ""}</button>
              <button type="button" class="btn btn-secondary btn-sm" id="anInv">${p.btnInvestor || ""}</button>
              <button type="button" class="btn btn-secondary btn-sm" id="anEn">${p.btnEn || ""}</button>
            </div>
          </details>
        </div>

        <div class="wb-panel" data-wb-panel="export">
          <div class="card wb-card">
            <p class="muted wb-prose-muted">${p.exportPrefix || ""}</p>
            <p class="muted wb-prose-muted" style="font-size:0.78rem;margin-top:6px;line-height:1.45">${p.exportTabBlurb || ""}</p>
            <div class="row wb-field-row">
              <select class="inp wb-inp-grow" id="anFmt" aria-label="${String(p.exportPrefix || "导出").replace(/"/g, "&quot;")}"></select>
              <button type="button" class="btn btn-primary" id="anExGo">${p.stickyExport || "导出"}</button>
            </div>
          </div>
        </div>

        <div class="wb-panel" data-wb-panel="versions">
          <div class="card wb-card">
            <div class="row wb-field-row" style="justify-content:space-between">
              <h3 style="margin:0">${p.verTitle || ""}</h3>
              <button type="button" class="btn btn-secondary btn-sm" id="anVerSave">${p.verSave || ""}</button>
            </div>
            <p class="muted wb-prose-muted">${p.verEmpty || ""}</p>
            <div id="anVerList" class="wb-version-list"></div>
          </div>
        </div>

        <div id="anErr"></div>
        <div id="anLoading" class="wb-loading hidden">
          <div class="loader"></div>
          <div class="wb-loading-text">
            <div class="muted">${p.loadingLine || ""}</div>
            <div class="muted wb-prose-muted" style="margin-top:6px">${p.progressSteps || ""}</div>
          </div>
        </div>
      </div>

      <aside class="wb-rail glass" aria-label="${p.railTitle || ""}">
        <div class="wb-rail-head">${p.railTitle || ""}</div>
        <p class="wb-rail-hint muted">${p.insightRailHint || ""}</p>
        <div class="wb-rail-block" data-rail="sum">
          <h4 class="wb-rail-h">${p.insightExec || ""}</h4>
          <p id="anRailExec" class="wb-rail-body muted"></p>
        </div>
        <div class="wb-rail-block" data-rail="core">
          <h4 class="wb-rail-h">${p.insightCore || ""}</h4>
          <ul class="wb-rail-ul" id="anRailCore"></ul>
        </div>
        <div class="wb-rail-block" data-rail="risk">
          <h4 class="wb-rail-h">${p.insightRisks || ""}</h4>
          <ul class="wb-rail-ul" id="anRailRisks"></ul>
        </div>
        <div class="wb-rail-block" data-rail="next">
          <h4 class="wb-rail-h">${p.insightNext || ""}</h4>
          <ul class="wb-rail-ul" id="anRailNext"></ul>
        </div>
        <p id="anRailEmpty" class="muted wb-rail-empty hidden">${p.railEmpty || ""}</p>
      </aside>
    </div>
  `)
  );

  const tabBtns = root.querySelectorAll("[data-wb-tab]");
  const panels = root.querySelectorAll("[data-wb-panel]");
  function setTab(name) {
    tabBtns.forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-wb-tab") === name));
    panels.forEach((pEl) => pEl.classList.toggle("is-active", pEl.getAttribute("data-wb-panel") === name));
  }
  tabBtns.forEach((b) =>
    b.addEventListener("click", () => setTab(b.getAttribute("data-wb-tab") || "input"))
  );

  const modeSel = root.querySelector("#anMode");
  (m.analysisModeOptions || []).forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    modeSel.appendChild(opt);
  });
  const depthSel = root.querySelector("#anDepth");
  (m.analysisDepthOptions || [
    { value: "quick", label: "快速" },
    { value: "standard", label: "标准" },
    { value: "deep", label: "深度" },
    { value: "investor", label: "投资人级" },
  ]).forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    depthSel.appendChild(opt);
  });
  depthSel.value = "standard";

  const hasPresetMode = Boolean(ctx.navPayload?.mode);
  if (ctx.navPayload?.mode) modeSel.value = ctx.navPayload.mode;
  if (ctx.navPayload?.depth && [...depthSel.options].some((o) => o.value === ctx.navPayload.depth)) {
    depthSel.value = ctx.navPayload.depth;
  }
  if (ctx.navPayload?.rerunContent) {
    root.querySelector("#anQ").value = `在以下历史输出基础上继续深化：\n\n${String(ctx.navPayload.rerunContent).slice(0, 12000)}`;
  }
  if (ctx.navPayload?.quickPrompt) {
    const q = root.querySelector("#anQ");
    const cur = q.value.trim();
    q.value = `${String(ctx.navPayload.quickPrompt).trim()}${cur ? `\n\n${cur}` : ""}`;
  }

  const playbookMap = new Map(analysisPlaybooks.map((x) => [x.key, x]));
  let activePlaybookKey = "";

  function optionExists(sel, value) {
    return [...(sel?.options || [])].some((o) => o.value === value);
  }

  function setActivePlaybook(key) {
    activePlaybookKey = key || "";
    root.querySelectorAll("[data-an-playbook]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-an-playbook") === activePlaybookKey);
    });
  }

  function replacePlaybookPrompt(current, prompt) {
    const text = String(current || "").trim();
    const block = `【分析场景】${prompt}`;
    if (!text) return block;
    if (/^【分析场景】[\s\S]*?(?:\n\n|$)/.test(text)) {
      return text.replace(/^【分析场景】[\s\S]*?(?:\n\n|$)/, `${block}\n\n`);
    }
    return `${block}\n\n${text}`;
  }

  function applyAnalysisPlaybook(key, opts = {}) {
    const pb = playbookMap.get(key);
    if (!pb) return;
    setActivePlaybook(key);
    if (optionExists(modeSel, pb.mode)) modeSel.value = pb.mode;
    if (optionExists(depthSel, pb.depth)) depthSel.value = pb.depth;
    if (opts.writePrompt !== false) {
      const q = root.querySelector("#anQ");
      q.value = replacePlaybookPrompt(q.value, pb.prompt);
      q.focus();
    }
    renderRailGuide(pb);
  }

  function inferPlaybookKey(text = "", fileNames = []) {
    const hay = `${text} ${fileNames.join(" ")}`.toLowerCase();
    if (/合同|协议|法务|条款|违约|签约|风险|审查|纠纷/.test(hay)) return "risk";
    if (/聊天|对话|客户|微信|whatsapp|telegram|tg|沟通|话术|跟进/.test(hay)) return "chat";
    if (/财务|收入|成本|利润|现金流|表格|excel|csv|报价|流水|预算/.test(hay)) return "finance";
    if (/老板|汇报|决策|管理层|董事|会议|结论/.test(hay)) return "boss";
    if (/行动|任务|负责人|截止|计划|todo|执行|落地/.test(hay)) return "actions";
    return "summary";
  }

  /** 与主进程 SAVE_GENERATED_FORMATS、设置页默认格式对齐（不含 json：分析正文为 Markdown 稿） */
  const ANALYSIS_EXPORT_FORMATS = ["txt", "md", "csv", "docx", "xlsx", "pdf", "html", "pptx", "slides_html"];

  function labelForAnalysisExportOpt(o) {
    const raw = String(o.label || o.value || "");
    return raw.replace(/^输出：\s*/i, "").trim() || o.value;
  }

  function fillAnalysisFormatSelect(sel) {
    if (!sel) return;
    sel.innerHTML = "";
    const src = Array.isArray(m.outputFormatOptions) ? m.outputFormatOptions : [];
    const allowed = new Set(ANALYSIS_EXPORT_FORMATS);
    src
      .filter((o) => allowed.has(o.value))
      .forEach((o) => {
        const op = document.createElement("option");
        op.value = o.value;
        op.textContent = labelForAnalysisExportOpt(o);
        const hint = String(o.label || "").trim();
        if (hint) op.title = hint;
        sel.appendChild(op);
      });
    if (!sel.options.length) {
      ["docx", "pdf", "md", "txt", "html", "xlsx", "csv", "pptx", "slides_html"].forEach((v) => {
        const op = document.createElement("option");
        op.value = v;
        op.textContent = v;
        sel.appendChild(op);
      });
    }
  }

  const anExFmt = root.querySelector("#anExFmt");
  const anFmt = root.querySelector("#anFmt");
  fillAnalysisFormatSelect(anExFmt);
  fillAnalysisFormatSelect(anFmt);
  const st0 = ctx.settings();
  const defFmt =
    st0.defaultExportFormat && ANALYSIS_EXPORT_FORMATS.includes(st0.defaultExportFormat)
      ? st0.defaultExportFormat
      : "docx";
  if (anExFmt) anExFmt.value = defFmt;
  if (anFmt) anFmt.value = defFmt;

  function syncAnalysisFmtSelectors(from) {
    const v = from?.value || "docx";
    if (anExFmt && anExFmt !== from) anExFmt.value = v;
    if (anFmt && anFmt !== from) anFmt.value = v;
    if (ANALYSIS_EXPORT_FORMATS.includes(v)) ctx.saveSettings({ defaultExportFormat: v });
  }
  anExFmt?.addEventListener("change", () => syncAnalysisFmtSelectors(anExFmt));
  anFmt?.addEventListener("change", () => syncAnalysisFmtSelectors(anFmt));

  const pickHost = root.querySelector("#anFilePick");
  /** @type {Set<string>} */
  const selected = new Set();
  /** @type {any[]} */
  let cachedLib = [];

  async function renderPickList() {
    pickHost.innerHTML = "";
    let lib = [];
    try {
      lib = await idb.listFiles();
    } catch (e) {
      console.warn("[aiAnalysis] listFiles", e);
      pickHost.textContent = p.pickError || "";
      return;
    }
    if (!lib.length) {
      pickHost.textContent = p.pickEmpty || "";
      return;
    }
    cachedLib = lib;
    renderFilteredPickList();
  }

  function renderFilteredPickList() {
    const lib = cachedLib;
    if (!lib?.length) return;
    const q = String(root.querySelector("#anFileSearch")?.value || "").trim().toLowerCase();
    pickHost.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "wb-file-pick";
    let visible = 0;
    lib.forEach((rec) => {
      const haystack = [
        rec.fileName || "",
        Array.isArray(rec.tags) ? rec.tags.join(" ") : "",
        rec.category || "",
        rec.priority || "",
      ]
        .join(" ")
        .toLowerCase();
      if (q && !haystack.includes(q)) return;
      visible += 1;
      const id = `anf-${rec.id}`;
      const tagBits = Array.isArray(rec.tags) && rec.tags.length
        ? `<span class="muted" style="font-size:11px;margin-left:6px">#${rec.tags.slice(0, 3).join(" #")}</span>`
        : "";
      const row = el(`
        <label class="wb-file-row">
          <input type="checkbox" id="${id}" data-id="${rec.id}" />
          <span>${rec.fileName}${tagBits}</span>
        </label>
      `);
      const cb = row.querySelector("input");
      if (selected.has(rec.id) || ctx.navPayload?.fileIds?.includes(rec.id)) {
        cb.checked = true;
        selected.add(rec.id);
      }
      cb.addEventListener("change", () => {
        if (cb.checked) selected.add(rec.id);
        else selected.delete(rec.id);
        void refreshHealthAndModes();
      });
      wrap.appendChild(row);
    });
    if (!visible) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.cssText = "font-size:0.82rem;padding:8px";
      empty.textContent = q ? `没有匹配「${q}」的文件` : (p.pickEmpty || "");
      pickHost.appendChild(empty);
    } else {
      pickHost.appendChild(wrap);
    }
  }

  // 文件搜索框
  root.querySelector("#anFileSearch")?.addEventListener("input", () => renderFilteredPickList());

  // 采用推荐模式
  root.querySelector("#anApplyRec")?.addEventListener("click", async () => {
    const g = await gatherDocTextAndNames();
    if (!g.text) {
      ctx.toast("请先勾选文件再采用推荐", true);
      return;
    }
    const rec = recommendModesFromDoc(g.text);
    const first = rec.find((k) => [...modeSel.options].some((o) => o.value === k));
    if (!first) {
      ctx.toast("没有可应用的推荐模式", true);
      return;
    }
    modeSel.value = first;
    modeSel.dispatchEvent(new Event("change", { bubbles: true }));
    const labelMap = new Map((m.analysisModeOptions || []).map((o) => [o.value, o.label]));
    ctx.toast(`已采用推荐模式：${labelMap.get(first) || first}`);
  });

  async function gatherDocTextAndNames() {
    const parts = [];
    const names = [];
    for (const id of selected) {
      let content = "";
      let fileName = id;
      try {
        const row = await idb.getFile(id);
        if (row && typeof row.content === "string" && row.content.length) {
          content = row.content;
          fileName = row.fileName || id;
        } else {
          try {
            const r = await ctx.ipc.libraryGetContent({ id, apiKey: ctx.getApiKey() });
            content = r.content || "";
            fileName = r.record?.fileName || id;
          } catch {
            content = "";
          }
        }
      } catch {
        content = "";
      }
      names.push(fileName);
      parts.push(`## 文件: ${fileName}\n\n${content}`);
    }
    return { text: parts.join("\n\n---\n\n"), names };
  }

  /** @type {any | null} */
  let lastResult = null;

  async function refreshHealthAndModes() {
    const g = await gatherDocTextAndNames();
    const health = clientFileHealth(g.text, g.names);
    const healthEl = root.querySelector("#anHealth");
    healthEl.textContent = `${health.qualityLine} · 体检分 ${health.score}/100。${health.issues.join(" ")}`;
    const rec = recommendModesFromDoc(g.text);
    const labelMap = new Map((m.analysisModeOptions || []).map((o) => [o.value, o.label]));
    root.querySelector("#anRecModes").textContent = rec.map((k) => labelMap.get(k) || k).join(" · ");
    const first = rec.find((k) => [...modeSel.options].some((o) => o.value === k));
    if (first && !root.querySelector("#anQ").value.trim()) {
      /* only suggest visually; do not override user mode silently */
    }
  }

  function fillList(el, items) {
    el.innerHTML = "";
    (items || []).forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      el.appendChild(li);
    });
  }

  function setRailVisible(hasContent) {
    root.querySelector("#anRailEmpty").classList.toggle("hidden", hasContent);
    root.querySelectorAll(".wb-rail-block").forEach((blk) => {
      const key = blk.getAttribute("data-rail");
      let show = false;
      if (key === "sum") show = Boolean(root.querySelector("#anRailExec")?.textContent?.trim());
      if (key === "core") show = (root.querySelector("#anRailCore")?.children?.length || 0) > 0;
      if (key === "risk") show = (root.querySelector("#anRailRisks")?.children?.length || 0) > 0;
      if (key === "next") show = (root.querySelector("#anRailNext")?.children?.length || 0) > 0;
      blk.classList.toggle("hidden", !show);
    });
  }

  function renderRailGuide(playbook = null) {
    root.querySelector("#anRailExec").textContent = "";
    fillList(root.querySelector("#anRailCore"), []);
    fillList(root.querySelector("#anRailRisks"), []);
    fillList(root.querySelector("#anRailNext"), []);
    setRailVisible(false);
    const empty = root.querySelector("#anRailEmpty");
    const pb = playbook || playbookMap.get(activePlaybookKey) || playbookMap.get("summary");
    empty.innerHTML = `
      <span class="an-rail-guide-title">${pb?.label || "资料分析"}准备就绪</span>
      <span>建议先选资料，再点「生成分析」。如果只输入问题，也会作为独立资料源处理。</span>
      <span>右侧生成后只保留执行摘要、风险和下一步，完整报告在「输出」页。</span>
    `;
  }

  function fillRail(res) {
    const exec = res.executiveSummary || res.summary || "";
    root.querySelector("#anRailExec").textContent = exec;
    fillList(root.querySelector("#anRailCore"), res.coreConclusions?.length ? res.coreConclusions : res.keyPoints);
    fillList(root.querySelector("#anRailRisks"), res.risks);
    fillList(root.querySelector("#anRailNext"), res.nextSteps);
    setRailVisible(Boolean(exec || res.risks?.length || res.nextSteps?.length));
  }

  function appendSection(host, title) {
    const sec = document.createElement("section");
    sec.className = "wb-toolkit-sec";
    const h = document.createElement("h4");
    h.className = "wb-toolkit-h";
    h.textContent = title;
    sec.appendChild(h);
    host.appendChild(sec);
    return sec;
  }

  function appendUl(sec, arr) {
    const ul = document.createElement("ul");
    ul.className = "wb-toolkit-ul";
    (arr || []).forEach((t) => {
      const li = document.createElement("li");
      li.textContent = String(t);
      ul.appendChild(li);
    });
    sec.appendChild(ul);
  }

  function renderToolkit(dt) {
    const host = root.querySelector("#anToolkitHost");
    host.innerHTML = "";
    if (!dt || typeof dt !== "object") {
      const p0 = document.createElement("p");
      p0.className = "muted";
      p0.textContent = "（无工具箱数据）";
      host.appendChild(p0);
      return;
    }
    let s = appendSection(host, "文件健康");
    const p1 = document.createElement("p");
    p1.className = "muted";
    p1.textContent = dt.fileHealthSummary || "";
    const p2 = document.createElement("p");
    p2.className = "muted";
    p2.textContent = `数据质量：${dt.dataQualityNotes || ""}`;
    s.appendChild(p1);
    s.appendChild(p2);
    s = appendSection(host, "缺失信息");
    appendUl(s, dt.missingInfo);
    s = appendSection(host, "类型推断");
    appendUl(s, dt.inferredDocTypes);
    s = appendSection(host, "关键摘录");
    appendUl(s, dt.extractedSignals);
    s = appendSection(host, "SWOT");
    appendUl(s, dt.swotStrengths);
    appendUl(s, dt.swotWeaknesses);
    appendUl(s, dt.swotOpportunities);
    appendUl(s, dt.swotThreats);
    s = appendSection(host, "PEST");
    appendUl(s, dt.pestPolitical);
    appendUl(s, dt.pestEconomic);
    appendUl(s, dt.pestSocial);
    appendUl(s, dt.pestTechnological);
    s = appendSection(host, "风险矩阵");
    appendUl(s, dt.riskMatrixLines);
    s = appendSection(host, "行动清单（负责人）");
    appendUl(s, dt.actionOwnersLines);
    ["管理层摘要", "投资人摘要", "法务风险", "财务重点"].forEach((label, i) => {
      const keys = ["mgmtBrief", "investorBrief", "legalRiskBrief", "financeBrief"];
      s = appendSection(host, label);
      const pp = document.createElement("p");
      pp.className = "muted";
      pp.textContent = String(dt[keys[i]] || "");
      s.appendChild(pp);
    });
    s = appendSection(host, "话术 · 老板");
    const b0 = document.createElement("p");
    b0.className = "muted";
    b0.textContent = dt.scriptBoss || "";
    s.appendChild(b0);
    s = appendSection(host, "话术 · 客户");
    const b1 = document.createElement("p");
    b1.className = "muted";
    b1.textContent = dt.scriptClient || "";
    s.appendChild(b1);
    s = appendSection(host, "话术 · 投资人");
    const b2 = document.createElement("p");
    b2.className = "muted";
    b2.textContent = dt.scriptInvestor || "";
    s.appendChild(b2);
  }

  function fillInsight(res) {
    lastResult = res;
    fillRail(res);
    renderToolkit(res.decisionToolkit);
  }

  function htmlThemeForExport() {
    try {
      const th = localStorage.getItem("acsp-dg-html-theme");
      if (th && String(th).trim()) return String(th).trim();
    } catch {
      /* ignore */
    }
    return "default";
  }

  function buildAnalysisExportMeta(modeKey) {
    const purpose = String(p.exportDeliverablePurpose || "AI 分析报告").trim() || "AI 分析报告";
    return {
      title: `${p.title || "AI 分析"} · ${modeKey}`,
      purpose,
      audience: "",
      generatedAt: new Date().toISOString(),
      projectName: currentProjectName(),
      htmlTheme: htmlThemeForExport(),
      confidentialLevel: "public",
    };
  }

  async function doExport(fmtRaw) {
    const t = root.querySelector("#anOut").value;
    if (!t.trim()) {
      ctx.toast(m?.messages?.noReportBody || "", true);
      return;
    }
    const fmt = String(fmtRaw || "md").toLowerCase();
    const modeKey = modeSel.value || "report";
    const base = `analysis-${modeKey}`;
    const exportMeta = buildAnalysisExportMeta(modeKey);

    let body = t;
    const outFormat = fmt;
    let suggestedName = `${base}.${fmt}`;
    if (fmt === "slides_html") {
      suggestedName = `${base}-slides.html`;
    }

    try {
      if (fmt === "md" || fmt === "html" || fmt === "slides_html") {
        const mod = await import("../services/markdownPreview.js");
        if (fmt === "md") {
          body = mod.prependDeliverableYaml(t, exportMeta);
        } else if (fmt === "slides_html") {
          body = mod.buildSlidesHtmlDocument(t, exportMeta.title || base, exportMeta, {
            themeId: exportMeta.htmlTheme || "default",
          });
        } else {
          body = mod.buildPrintableHtmlDocument(t, exportMeta.title || base, exportMeta, {
            themeId: exportMeta.htmlTheme || "default",
          });
        }
      }

      const r = await ctx.ipc.saveGeneratedFile({
        suggestedName,
        content: body,
        format: outFormat,
        embedPdfImages: false,
        exportMeta,
      });
      ctx.toast(r?.canceled ? "已取消" : `已保存：${r.filePath}`);
    } catch (e) {
      ctx.toast(e?.message || "导出失败", true);
    }
  }

  function wireExport(id, fmtId) {
    root.querySelector(id)?.addEventListener("click", () => {
      const fmt = fmtId ? root.querySelector(fmtId)?.value || "docx" : "docx";
      void doExport(String(fmt).toLowerCase());
    });
  }
  wireExport("#anExSticky", "#anExFmt");
  root.querySelector("#anExGo")?.addEventListener("click", () => {
    const fmt = root.querySelector("#anFmt")?.value || "docx";
    void doExport(fmt);
  });

  const fileInput = root.querySelector("#anFileInput");
  root.querySelector("#anUpload").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const files = fileInput.files;
    if (!files?.length) return;
    try {
      for (const f of Array.from(files)) {
        const reader = new FileReader();
        const b64 = await new Promise((resolve, reject) => {
          reader.onload = () => {
            const s = String(reader.result || "");
            const i = s.indexOf(",");
            resolve(i >= 0 ? s.slice(i + 1) : s);
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(f);
        });
        const add = await ctx.ipc.libraryAddFromBuffer({
          fileName: f.name,
          base64: b64,
          apiKey: ctx.getApiKey(),
        });
        await idb.putFile({
          ...add.record,
          content: String(add.content ?? ""),
          markdownPreview: String(add.markdownPreview ?? ""),
        });
      }
      ctx.emitLibraryChanged();
      await renderPickList();
      ctx.toast("已上传并入库");
    } catch (e) {
      ctx.toast(e?.message || "上传失败", true);
    }
    fileInput.value = "";
  });

  async function runAnalysisCore() {
    const errBox = root.querySelector("#anErr");
    errBox.innerHTML = "";
    const q = root.querySelector("#anQ").value.trim();
    if (!selected.size && q.length < 20) {
      errorState(errBox, m?.messages?.noFileForAnalysis || "请选择文件或补充背景");
      return false;
    }
    const loading = root.querySelector("#anLoading");
    loading.classList.remove("hidden");
    try {
      let doc = "";
      let names = [];
      if (selected.size) {
        const g = await gatherDocTextAndNames();
        doc = g.text;
        names = g.names;
      } else {
        doc = `## 用户提供的背景（无上传文件）\n\n${q}`;
        names = ["用户输入"];
      }
      if (!activePlaybookKey && !hasPresetMode) {
        applyAnalysisPlaybook(inferPlaybookKey(q, names), { writePrompt: false });
      }
      const activePlaybook = playbookMap.get(activePlaybookKey);
      const sceneInstruction =
        activePlaybook && !q.includes(activePlaybook.prompt)
          ? `【分析场景】${activePlaybook.prompt}${q ? `\n\n${q}` : ""}`
          : q;
      const res = await ctx.runAnalysis({
        mode: modeSel.value,
        depth: depthSel.value,
        userInstruction: sceneInstruction,
        documentText: doc,
        model: ctx.getModel(),
        fileNames: names,
      });
      root.querySelector("#anOut").value = res.mainReport || "";
      fillInsight(res);
      ctx.toast(m?.messages?.analysisDone || "完成");
      setTab("output");
      root.querySelector("#anResultAnchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    } catch (e) {
      errorState(errBox, e?.message || "分析失败");
      ctx.toast(e?.message || "失败", true);
      return false;
    } finally {
      loading.classList.add("hidden");
    }
  }

  root.querySelector("#anRunSticky").addEventListener("click", () => void runAnalysisCore());
  root.querySelector("#anRerunSticky").addEventListener("click", () => void runAnalysisCore());
  root.querySelectorAll("[data-an-playbook]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyAnalysisPlaybook(btn.getAttribute("data-an-playbook") || "summary");
      ctx.toast("已切换分析任务");
    });
  });

  async function polishReport(instruction) {
    const cur = root.querySelector("#anOut").value.trim();
    if (!cur) {
      ctx.toast("请先生成主报告", true);
      return;
    }
    root.querySelector("#anLoading").classList.remove("hidden");
    try {
      const res = await ctx.runPolish({
        instruction,
        sourceContent: cur,
        model: ctx.getModel(),
      });
      root.querySelector("#anOut").value = res.content || "";
      ctx.toast("已完成");
    } catch (e) {
      ctx.toast(e?.message || "处理失败", true);
    } finally {
      root.querySelector("#anLoading").classList.add("hidden");
    }
  }

  root.querySelector("#anExpand").addEventListener("click", () => {
    void polishReport(
      "在不删除事实与数据的前提下扩展主报告：增加子章节、对比表、情景分析；保持 Markdown；中文输出；篇幅显著长于原文。"
    );
  });
  root.querySelector("#anExtract").addEventListener("click", () => {
    void polishReport(
      "从以下报告中提取高管可读的重点：输出为分组的短 bullet（战略/财务/风险/行动），中文，保留可核验表述。"
    );
  });
  root.querySelector("#anActList").addEventListener("click", () => {
    void polishReport(
      "将下列内容整理为「可执行行动清单」Markdown 表格：列含行动项、负责人角色、截止时间建议、依赖、验收标准。"
    );
  });
  root.querySelector("#anBoss").addEventListener("click", () => {
    void polishReport(
      "改写成给中国民营企业董事长/总经理的汇报版：先结论后理由，语气果断克制，突出取舍与资源诉求，Markdown。"
    );
  });
  root.querySelector("#anInv").addEventListener("click", () => {
    void polishReport(
      "改写成面向美元基金合伙人的投资备忘录风格：thesis、市场规模、单位经济、风险与缓解、回报路径、关键 diligence 问题；英文标题可保留、正文专业中文为主。"
    );
  });
  root.querySelector("#anEn").addEventListener("click", () => {
    void polishReport("将全文翻译并改写为流畅的英文商务报告 Markdown，保留结构与表格。");
  });

  async function copyOut() {
    const t = root.querySelector("#anOut").value;
    if (!t) return;
    await ctx.ipc.copyText(t);
    ctx.toast(m?.messages?.copied || "已复制");
  }
  root.querySelector("#anCopySticky").addEventListener("click", copyOut);

  async function saveHist() {
    const t = root.querySelector("#anOut").value;
    if (!t.trim()) {
      ctx.toast(m?.messages?.noResultToSave || "无内容", true);
      return;
    }
    await historyStore.pushHistory({
      type: "analysis",
      title: `保存：${modeSel.options[modeSel.selectedIndex]?.text || "分析"}`,
      summary: lastResult?.summary || t.slice(0, 200),
      content: t,
      meta: {
        mode: modeSel.value,
        depth: depthSel.value,
        fileIds: [...selected],
        project: currentProjectName(),
      },
    });
    ctx.toast("已写入历史记录");
  }
  root.querySelector("#anSaveSticky").addEventListener("click", saveHist);

  root.querySelector("#anVerSave")?.addEventListener("click", () => {
    const t = root.querySelector("#anOut").value;
    if (!t.trim()) {
      ctx.toast(m?.messages?.noResultToSave || "无内容", true);
      return;
    }
    pushWorkbenchVersion(LS_ANALYSIS_VERSIONS, {
      label: `${modeSel.value} · ${new Date().toLocaleString()}`,
      content: t,
      meta: { depth: depthSel.value },
    });
    renderVersionList();
    ctx.toast("已保存版本");
  });

  function renderVersionList() {
    const host = root.querySelector("#anVerList");
    const list = loadWorkbenchVersions(LS_ANALYSIS_VERSIONS);
    if (!list.length) {
      host.innerHTML = `<p class="muted">${p.verEmpty || ""}</p>`;
      return;
    }
    host.innerHTML = "";
    list.forEach((v) => {
      const row = el(`
        <div class="wb-version-row">
          <div class="wb-version-meta">${new Date(v.at).toLocaleString()} · ${String(v.label || "").slice(0, 80)}</div>
          <button type="button" class="btn btn-secondary btn-sm" data-vid="${v.id}">${p.verRestore || "载入"}</button>
        </div>
      `);
      row.querySelector("button")?.addEventListener("click", () => {
        const hit = loadWorkbenchVersions(LS_ANALYSIS_VERSIONS).find((x) => x.id === v.id);
        if (hit?.content) {
          root.querySelector("#anOut").value = hit.content;
          setTab("output");
        }
      });
      host.appendChild(row);
    });
  }
  renderVersionList();

  const onStore = () => renderPickList();
  window.addEventListener(idb.STORE_CHANGED_EVENT, onStore);
  renderRailGuide();
  renderPickList().then(() => refreshHealthAndModes());

  return {
    destroy() {
      window.removeEventListener(idb.STORE_CHANGED_EVENT, onStore);
      root.innerHTML = "";
    },
  };
}
