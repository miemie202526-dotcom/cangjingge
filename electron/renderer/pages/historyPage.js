import * as historyStore from "../services/historyStore.js";
import * as idb from "../services/idbStore.js";
import * as exportHelper from "../services/exportHelper.js";
import { el } from "../core/ui.js";
import { markdownToSafeHtml } from "../services/markdownPreview.js";

export function mountHistory(root, ctx) {
  root.innerHTML = "";
  const m = ctx.manifest();
  const p = m.pages?.history || {};
  const typeOpts = (m.historyTypeFilterOptions || [])
    .map((o) => `<option value="${String(o.value).replace(/"/g, "&quot;")}">${o.label || ""}</option>`)
    .join("");

  root.appendChild(
    el(`
    <div class="page-head">
      <div>
        <h1 class="page-title">${p.title || ""}</h1>
        <p class="page-sub">${p.subtitle || ""}</p>
      </div>
    </div>
    <div class="toolbar">
      <input type="search" class="inp" style="max-width:200px" id="hiSearch" placeholder="${String(p.searchPh || "").replace(/"/g, "&quot;")}" />
      <input type="search" class="inp" style="max-width:160px" id="hiProj" placeholder="${String(p.projPh || "").replace(/"/g, "&quot;")}" />
      <select class="inp" style="max-width:120px" id="hiDate">
        <option value="">${p.dateAll || ""}</option>
        <option value="7">${p.date7 || ""}</option>
        <option value="30">${p.date30 || ""}</option>
      </select>
      <select class="inp" style="max-width:160px" id="hiType">${typeOpts}</select>
      <select class="inp" style="max-width:140px" id="hiSort">
        <option value="desc">${p.sortDesc || ""}</option>
        <option value="asc">${p.sortAsc || ""}</option>
      </select>
      <select class="inp" style="max-width:120px" id="hiPageSize" title="历史很多时分页渲染">
        <option value="50">每页 50</option>
        <option value="100">每页 100</option>
        <option value="200">每页 200</option>
        <option value="0">全部</option>
      </select>
      <div class="list-pager" id="hiPager">
        <button type="button" class="btn btn-ghost btn-sm" id="hiPagePrev">上一页</button>
        <span class="muted" id="hiPageInfo">1/1</span>
        <button type="button" class="btn btn-ghost btn-sm" id="hiPageNext">下一页</button>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="hiCopy">${p.copy || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" id="hiExportOne">${p.exportOne || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" id="hiRerun">${p.rerun || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" id="hiExportSel">${p.exportSel || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" id="hiDel">${p.del || ""}</button>
      <button type="button" class="btn btn-danger btn-sm" id="hiClear">${p.clear || ""}</button>
    </div>
    <div class="split-2">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th style="width:36px"><input type="checkbox" id="hiAll" /></th><th>${p.thTime || ""}</th><th>${p.thType || ""}</th><th>${p.thTitle || ""}</th></tr></thead>
          <tbody id="hiTbody"></tbody>
        </table>
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <h3 style="margin:0">${p.detailTitle || ""}</h3>
          <div class="row" style="gap:6px">
            <label class="muted" style="font-size:0.74rem;display:flex;align-items:center;gap:4px">
              <input type="checkbox" id="hiRender" checked /> Markdown 渲染
            </label>
          </div>
        </div>
        <div id="hiDetailRich" class="preview-box hidden" style="max-height:62vh;margin-top:8px;overflow:auto;font-size:0.92rem;line-height:1.7"></div>
        <pre id="hiDetail" class="preview-box" style="max-height:62vh;margin:8px 0 0;white-space:pre-wrap;word-break:break-word"></pre>
      </div>
    </div>
  `)
  );

  /** @type {string | null} */
  let selectedId = null;
  /** @type {any[]} */
  let allList = [];
  let pageIndex = 0;

  function timeOf(h) {
    return h.at || h.createdAt || 0;
  }

  function matches(h) {
    const q = root.querySelector("#hiSearch").value.trim().toLowerCase();
    const projQ = root.querySelector("#hiProj").value.trim().toLowerCase();
    const dateWin = root.querySelector("#hiDate").value;
    const t = root.querySelector("#hiType").value;
    if (t && h.type !== t) return false;
    if (projQ) {
      const mp = String(h.meta?.project || "").toLowerCase();
      if (!mp.includes(projQ)) return false;
    }
    if (dateWin) {
      const days = Number(dateWin) || 0;
      const t0 = Date.now() - days * 86400000;
      if (timeOf(h) < t0) return false;
    }
    if (!q) return true;
    return (
      String(h.title || "")
        .toLowerCase()
        .includes(q) ||
      String(h.content || "")
        .toLowerCase()
        .includes(q) ||
      String(h.summary || "")
        .toLowerCase()
        .includes(q) ||
      String(h.meta?.project || "")
        .toLowerCase()
        .includes(q)
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function loadList() {
    allList = await historyStore.listHistory();
    render();
  }

  function pageSizeValue() {
    const n = Number(root.querySelector("#hiPageSize")?.value || "50");
    return Number.isFinite(n) ? n : 50;
  }

  function resetPage() {
    pageIndex = 0;
  }

  function applyPage(list) {
    const size = pageSizeValue();
    const info = root.querySelector("#hiPageInfo");
    const prev = root.querySelector("#hiPagePrev");
    const next = root.querySelector("#hiPageNext");
    if (!size || size <= 0) {
      if (info) info.textContent = `全部 ${list.length}`;
      if (prev) prev.disabled = true;
      if (next) next.disabled = true;
      return list;
    }
    const totalPages = Math.max(1, Math.ceil(list.length / size));
    pageIndex = Math.max(0, Math.min(pageIndex, totalPages - 1));
    const start = pageIndex * size;
    const end = Math.min(list.length, start + size);
    if (info) info.textContent = `${pageIndex + 1}/${totalPages} · ${start + 1}-${end}/${list.length}`;
    if (prev) prev.disabled = pageIndex <= 0;
    if (next) next.disabled = pageIndex >= totalPages - 1;
    return list.slice(start, end);
  }

  function render() {
    const tbody = root.querySelector("#hiTbody");
    tbody.innerHTML = "";
    let list = allList.filter(matches);
    const ord = root.querySelector("#hiSort").value;
    list = [...list].sort((a, b) => (ord === "asc" ? 1 : -1) * (timeOf(a) - timeOf(b)));
    const pageList = applyPage(list);
    pageList.forEach((h) => {
      const tr = document.createElement("tr");
      if (h.id === selectedId) tr.classList.add("selected");
      tr.innerHTML = `<td><input type="checkbox" class="hi-cb" data-id="${h.id}" /></td><td>${new Date(
        timeOf(h)
      ).toLocaleString()}</td><td>${escapeHtml(h.type)}</td><td>${escapeHtml(h.title)}</td>`;
      tr.addEventListener("click", (ev) => {
        if (ev.target instanceof HTMLInputElement && ev.target.type === "checkbox") return;
        selectedId = h.id;
        render();
        showDetail(h);
      });
      tbody.appendChild(tr);
    });
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted" style="padding:20px">${p.empty || ""}</td></tr>`;
    }
  }

  let lastShown = null;

  function showDetail(h) {
    lastShown = h;
    const pre = root.querySelector("#hiDetail");
    const rich = root.querySelector("#hiDetailRich");
    const useRender = root.querySelector("#hiRender")?.checked;
    let meta = "";
    try {
      meta =
        h.meta && typeof h.meta === "object"
          ? `\n${p.metaLabel || "meta"}:\n${JSON.stringify(h.meta, null, 2)}\n`
          : "";
    } catch {
      meta = "";
    }
    const plain = `${h.title}\n${h.type}\n${meta}\n${h.summary}\n\n---\n\n${h.content || ""}`;
    pre.textContent = plain;
    if (useRender && (h.content || "").trim()) {
      try {
        const headerMd = `# ${h.title}\n\n_${h.type} · ${new Date(timeOf(h)).toLocaleString()}_\n\n${h.summary || ""}\n\n---\n\n`;
        rich.innerHTML = markdownToSafeHtml(headerMd + (h.content || ""));
        rich.classList.remove("hidden");
        pre.classList.add("hidden");
      } catch {
        rich.classList.add("hidden");
        pre.classList.remove("hidden");
      }
    } else {
      rich.classList.add("hidden");
      pre.classList.remove("hidden");
    }
  }

  function selectedItem() {
    return allList.find((x) => x.id === selectedId) || null;
  }

  function renderFromFirstPage() {
    resetPage();
    render();
  }

  root.querySelector("#hiSearch").addEventListener("input", renderFromFirstPage);
  root.querySelector("#hiProj").addEventListener("input", renderFromFirstPage);
  root.querySelector("#hiDate").addEventListener("change", renderFromFirstPage);
  root.querySelector("#hiType").addEventListener("change", renderFromFirstPage);
  root.querySelector("#hiSort").addEventListener("change", renderFromFirstPage);
  root.querySelector("#hiPageSize").addEventListener("change", renderFromFirstPage);
  root.querySelector("#hiPagePrev").addEventListener("click", () => {
    pageIndex = Math.max(0, pageIndex - 1);
    render();
  });
  root.querySelector("#hiPageNext").addEventListener("click", () => {
    pageIndex += 1;
    render();
  });
  root.querySelector("#hiRender").addEventListener("change", () => {
    if (lastShown) showDetail(lastShown);
  });

  root.querySelector("#hiAll").addEventListener("change", (e) => {
    const on = /** @type {HTMLInputElement} */ (e.target).checked;
    root.querySelectorAll(".hi-cb").forEach((c) => {
      /** @type {HTMLInputElement} */ (c).checked = on;
    });
  });

  /**
   * 让用户选择导出格式
   * @returns {{format: "txt"|"md"|"json"}|null}
   */
  function pickExportFormat() {
    const ans = window.prompt("导出为哪种格式？\n输入：txt / md / json（默认 md）", "md");
    if (ans == null) return null;
    const f = String(ans).trim().toLowerCase();
    if (f === "txt" || f === "md" || f === "json") return { format: f };
    return { format: "md" };
  }

  root.querySelector("#hiExportSel").addEventListener("click", async () => {
    const checked = Array.from(root.querySelectorAll(".hi-cb:checked"));
    if (!checked.length) {
      ctx.toast(p.toastPickChecks || m?.messages?.selectCheckboxesFirst || "", true);
      return;
    }
    const fmt = pickExportFormat();
    if (!fmt) return;
    const items = checked
      .map((c) => allList.find((x) => x.id === c.getAttribute("data-id")))
      .filter(Boolean);
    let content = "";
    if (fmt.format === "json") {
      content = JSON.stringify({ exportedAt: Date.now(), items }, null, 2);
    } else {
      const sep = fmt.format === "md" ? "\n\n---\n\n" : "\n\n=========\n\n";
      content = items
        .map((h) => {
          if (fmt.format === "md") {
            return `# ${h.title}\n\n_${h.type} · ${new Date(timeOf(h)).toLocaleString()}_\n\n${h.summary || ""}\n\n${h.content || ""}`;
          }
          return `${h.title}\n类型: ${h.type}\n时间: ${new Date(timeOf(h)).toLocaleString()}\n\n${h.summary || ""}\n\n${h.content || h.summary || ""}`;
        })
        .join(sep);
    }
    const r = await exportHelper.exportTextFile(ctx.ipc, {
      format: fmt.format,
      content,
      suggestedName: `history-multi-${Date.now()}.${fmt.format}`,
    });
    ctx.toast(r?.canceled ? "已取消" : `已导出：${r.filePath}`);
  });

  root.querySelector("#hiDel").addEventListener("click", async () => {
    const checked = Array.from(root.querySelectorAll(".hi-cb:checked"));
    if (!checked.length) {
      ctx.toast(p.toastPickChecks || m?.messages?.selectCheckboxesFirst || "", true);
      return;
    }
    for (const c of checked) {
      const id = c.getAttribute("data-id");
      if (id) await historyStore.deleteHistory(id);
    }
    selectedId = null;
    ctx.toast("已删除");
    await loadList();
    root.querySelector("#hiDetail").textContent = "";
  });

  root.querySelector("#hiClear").addEventListener("click", async () => {
    if (!confirm("确定清空全部历史记录？")) return;
    await historyStore.clearHistory();
    selectedId = null;
    ctx.toast("已清空");
    await loadList();
    root.querySelector("#hiDetail").textContent = "";
  });

  root.querySelector("#hiCopy").addEventListener("click", async () => {
    const h = selectedItem();
    if (!h) {
      ctx.toast(p.toastPickRow || m?.messages?.selectHistoryRow || "", true);
      return;
    }
    const t = h.content || h.summary || "";
    if (!t) {
      ctx.toast(m?.messages?.nothingToCopy || "", true);
      return;
    }
    await ctx.ipc.copyText(t);
    ctx.toast(m?.messages?.copied || "已复制");
  });

  root.querySelector("#hiExportOne").addEventListener("click", async () => {
    const h = selectedItem();
    if (!h) {
      ctx.toast(p.toastPickRow || m?.messages?.selectHistoryRow || "", true);
      return;
    }
    const fmt = pickExportFormat();
    if (!fmt) return;
    let content = "";
    if (fmt.format === "json") {
      content = JSON.stringify(h, null, 2);
    } else if (fmt.format === "md") {
      content = `# ${h.title}\n\n_${h.type} · ${new Date(timeOf(h)).toLocaleString()}_\n\n${h.summary || ""}\n\n---\n\n${h.content || ""}`;
    } else {
      content = `${h.title}\n\n${h.content || h.summary || ""}`;
    }
    const r = await exportHelper.exportTextFile(ctx.ipc, {
      format: fmt.format,
      content,
      suggestedName: `history-${h.type}-${h.id?.slice(0, 8) || "export"}.${fmt.format}`,
    });
    ctx.toast(r?.canceled ? "已取消" : `已导出：${r.filePath}`);
  });

  root.querySelector("#hiRerun").addEventListener("click", () => {
    const h = selectedItem();
    if (!h) {
      ctx.toast(p.toastPickRow || m?.messages?.selectHistoryRow || "", true);
      return;
    }
    if (h.type === "analysis" || h.type === "batch-analysis") {
      ctx.navigate("analysis", {
        rerunContent: h.content || h.summary,
        mode: h.meta?.mode,
        depth: h.meta?.depth,
        fileIds: Array.isArray(h.meta?.fileIds) ? h.meta.fileIds : undefined,
      });
      return;
    }
    if (h.type === "generate") {
      ctx.navigate("generator", { genType: h.meta?.genType, rerunContent: h.content });
      return;
    }
    if (h.type === "icon-prompt" || h.type === "icon") {
      ctx.toast("图标生成模块已下线，旧记录仍可查看与导出。", true);
      return;
    }
    if (h.type === "image-edit") {
      ctx.toast("AI 修图模块已下线，旧记录仍可查看与导出。", true);
      return;
    }
    ctx.navigate("analysis", { rerunContent: h.content || h.summary });
  });

  const onStore = () => loadList();
  window.addEventListener(idb.STORE_CHANGED_EVENT, onStore);
  void (async () => {
    await loadList();
    const target = ctx.navPayload?.selectId;
    if (target) {
      const h = allList.find((x) => x.id === target);
      if (h) {
        selectedId = h.id;
        render();
        showDetail(h);
        const tr = root.querySelector(".data-table tbody tr.selected");
        if (tr && typeof tr.scrollIntoView === "function") {
          tr.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
    }
  })();

  return {
    destroy() {
      window.removeEventListener(idb.STORE_CHANGED_EVENT, onStore);
      root.innerHTML = "";
    },
  };
}
