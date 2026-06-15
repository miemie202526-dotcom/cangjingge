import { loadSettings, saveSettings } from "../services/settingsStore.js";
import * as historyStore from "../services/historyStore.js";
import * as idb from "../services/idbStore.js";
import { el } from "../core/ui.js";

export function mountSettings(root, ctx) {
  root.innerHTML = "";
  const m = ctx.manifest();
  const st = loadSettings();
  const sp = m.pages?.settings || {};
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const themeOptions = [
    { value: "graphite", label: "石墨" },
    { value: "forest", label: "护眼" },
    { value: "ocean", label: "海盐" },
    { value: "paper", label: "暖纸" },
    { value: "dusk", label: "暮蓝" },
    { value: "dark", label: "深色" },
    { value: "light", label: "浅色" },
  ];
  const viewOptions = [
    { value: "standard", label: "标准" },
    { value: "focus", label: "宽屏" },
    { value: "large", label: "大字" },
    { value: "compact", label: "紧凑" },
  ];
  const fmtOpts = (m.outputFormatOptions || [])
    .filter((o) =>
      ["docx", "pdf", "txt", "md", "csv", "xlsx", "html", "pptx", "slides_html"].includes(o.value)
    )
    .map((o) => `<option value="${o.value}">${o.label || o.value}</option>`)
    .join("");
  const themeOpts = themeOptions.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
  const viewOpts = viewOptions.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");

  root.appendChild(
    el(`
    <div class="page-head">
      <div>
        <h1 class="page-title">${sp.title || ""}</h1>
        <p class="page-sub">${m?.settingsSecurityBlurb || ""}</p>
      </div>
    </div>
    <section class="settings-health-panel">
      <div>
        <div class="settings-kicker">System Control</div>
        <h2>全局控制中心</h2>
        <p class="muted">统一管理密钥、模型、主题、视图、备份与本机数据状态。</p>
      </div>
      <div class="settings-health-grid" id="stHealthGrid">
        <div class="settings-health-card"><b>—</b><span>正在体检</span></div>
      </div>
    </section>
    <div class="settings-grid">
      <div class="card settings-card">
        <h3>${sp.h3ApiKey || ""}</h3>
        <input type="password" class="inp" id="stKey" placeholder="${esc(m?.chrome?.sidebar?.apiKeyPlaceholder || "sk-...")}" />
        <div class="row" style="margin-top:10px;flex-wrap:wrap;gap:8px">
          <button type="button" class="btn btn-primary btn-sm" id="stSaveKey">${m?.chrome?.sidebar?.saveKeyBtn || "保存"}</button>
          <button type="button" class="btn btn-secondary btn-sm" id="stTestKey" title="向 OpenAI 发一个最轻请求，立即知道 Key 是否真实可用">测试连通</button>
          <button type="button" class="btn btn-ghost btn-sm" id="stClearKey">${m?.chrome?.sidebar?.clearKeyBtn || "清除"}</button>
        </div>
        <p id="stKeyStatus" class="muted settings-note"></p>
        <pre id="stKeyTestOut" class="muted settings-test-out"></pre>

        <h3>${sp.h3DefaultModel || ""}</h3>
        <p class="muted settings-note">${sp.defaultModelHint || ""}</p>
        <select class="inp" id="stModel"></select>
      </div>

      <div class="card settings-card">
        <h3>${sp.h3Appearance || "外观与阅读"}</h3>
        <div class="settings-field-grid">
          <label>
            <span class="muted">视觉主题</span>
            <select class="inp" id="stTheme">${themeOpts}</select>
          </label>
          <label>
            <span class="muted">视图模式</span>
            <select class="inp" id="stViewMode">${viewOpts}</select>
          </label>
          <label>
            <span class="muted">${sp.h3DefaultLang || "默认语言"}</span>
            <select class="inp" id="stLang">
              <option value="zh-CN">${sp.langZh || ""}</option>
              <option value="en-US">${sp.langEn || ""}</option>
            </select>
          </label>
          <label>
            <span class="muted">${sp.h3DefaultFmt || "默认导出格式"}</span>
            <select class="inp" id="stFmt">${fmtOpts}</select>
          </label>
        </div>

        <h3>${sp.h3Batch || ""}</h3>
        <label class="settings-check">
          <input type="checkbox" id="stBatch" /> ${sp.batchLabel || ""}
        </label>
      </div>

      <div class="card settings-card">
        <h3>${sp.h3Updates || "软件更新"}</h3>
        <p class="muted settings-note">${sp.updateHint || "手动检查发布者提供的新版本；有新版时可打开下载地址，自主选择是否更新。"}</p>
        <input type="url" class="inp" id="stUpdateUrl" placeholder="https://example.com/Cangjingge-latest.json" />
        <div class="row" style="margin-top:10px;flex-wrap:wrap;gap:8px">
          <button type="button" class="btn btn-primary btn-sm" id="stCheckUpdate">${sp.checkUpdate || "检查更新"}</button>
          <button type="button" class="btn btn-secondary btn-sm" id="stSaveUpdateUrl">${sp.saveUpdateSource || "保存更新源"}</button>
          <button type="button" class="btn btn-secondary btn-sm" id="stOpenUpdate" disabled>${sp.openUpdateDownload || "打开下载"}</button>
        </div>
        <pre id="stUpdateOut" class="muted settings-test-out"></pre>
      </div>

      <div class="card settings-card">
        <h3>${sp.localStorageTitle || ""}</h3>
        <p class="muted settings-note">建议每次大量导入资料、聊天记录或重要输出后导出一次备份。</p>
        <div class="row" style="margin-top:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-secondary btn-sm" id="stExport">${sp.exportBackup || ""}</button>
          <button type="button" class="btn btn-secondary btn-sm" id="stImport">${sp.importBackup || ""}</button>
          <input type="file" id="stImportFile" accept="application/json,.json" style="display:none" />
        </div>
        <div class="settings-danger-zone">
          <button type="button" class="btn btn-danger btn-sm" id="stClear">${sp.clearHistory || ""}</button>
          <button type="button" class="btn btn-danger btn-sm" id="stClearAll">${sp.clearAll || ""}</button>
        </div>
        <p class="muted settings-note">${sp.clearAllWarn || ""}</p>
      </div>

      <div class="card settings-card">
        <h3>${sp.capsTitle || ""}</h3>
        <ul id="stCap" class="settings-cap-list"></ul>
      </div>
    </div>
  `)
  );

  const keyInput = root.querySelector("#stKey");
  const globalKey = document.getElementById("globalApiKey");
  keyInput.value = globalKey?.value || "";

  function syncGlobalKeyFromField() {
    if (globalKey) globalKey.value = keyInput.value;
    window.dispatchEvent(new CustomEvent("ai-pro-api-key-changed"));
  }
  keyInput.addEventListener("input", syncGlobalKeyFromField);

  const modelSel = root.querySelector("#stModel");
  (m.modelSelectOptions || []).forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    modelSel.appendChild(opt);
  });
  const headerModel = document.getElementById("headerModel");
  modelSel.value = headerModel?.value || st.defaultModel;
  modelSel.addEventListener("change", () => {
    if (headerModel) headerModel.value = modelSel.value;
    saveSettings({ defaultModel: modelSel.value });
  });

  root.querySelector("#stLang").value = st.defaultLang || "zh-CN";
  root.querySelector("#stFmt").value = st.defaultExportFormat || "docx";
  root.querySelector("#stTheme").value = themeOptions.some((x) => x.value === st.theme) ? st.theme : "graphite";
  root.querySelector("#stViewMode").value = viewOptions.some((x) => x.value === st.viewMode) ? st.viewMode : "standard";
  root.querySelector("#stBatch").checked = st.batchEnabled !== false;
  root.querySelector("#stUpdateUrl").value = st.updateFeedUrl || "";

  async function refreshSystemHealth() {
    const grid = root.querySelector("#stHealthGrid");
    if (!grid) return;
    let files = [];
    let tasks = [];
    let phrases = [];
    let keyStatus = null;
    try { files = await idb.listFiles(); } catch { files = []; }
    try { tasks = await historyStore.listHistory(); } catch { tasks = []; }
    try { phrases = await idb.listPhrases(); } catch { phrases = []; }
    try { keyStatus = await ctx.ipc.openaiKeyStatus(); } catch { keyStatus = null; }
    const backend = idb.getStorageBackend();
    const keyReady = Boolean(keyStatus?.hasEnvKey || keyStatus?.hasStoredKey || keyInput.value.trim());
    const freshSettings = loadSettings();
    const lastBackup = freshSettings.lastBackupAt ? new Date(freshSettings.lastBackupAt).toLocaleString() : "未记录";
    const cards = [
      { value: files.length.toLocaleString(), label: "文件库资料" },
      { value: tasks.length.toLocaleString(), label: "历史任务" },
      { value: phrases.length.toLocaleString(), label: "金句/话术" },
      { value: backend === "indexedDB" ? "IndexedDB" : backend === "localStorage" ? "降级存储" : "未初始化", label: "本地存储" },
      { value: keyReady ? "已配置" : "未配置", label: "AI 密钥" },
      { value: lastBackup, label: "最近备份" },
    ];
    grid.innerHTML = cards
      .map((c) => `<div class="settings-health-card"><b>${esc(c.value)}</b><span>${esc(c.label)}</span></div>`)
      .join("");
  }

  async function refreshKeyStatus() {
    const p = root.querySelector("#stKeyStatus");
    try {
      const s = await ctx.ipc.openaiKeyStatus();
      const bits = [];
      if (s?.hasEnvKey) bits.push("环境变量 OPENAI_API_KEY 已配置");
      if (s?.hasStoredKey) bits.push("本机安全存储中已有密钥");
      p.textContent = bits.join("；") || "未检测到已保存的环境密钥（仍可在上方填写会话密钥）。";
    } catch {
      p.textContent = "无法检测";
    }
  }
  refreshKeyStatus();
  refreshSystemHealth();

  root.querySelector("#stSaveKey").addEventListener("click", async () => {
    const v = keyInput.value.trim();
    if (!v) {
      ctx.toast(m?.messages?.needApiKeyShort || "请输入", true);
      return;
    }
    try {
      await ctx.ipc.setApiKey({ value: v });
      if (globalKey) globalKey.value = v;
      window.dispatchEvent(new CustomEvent("ai-pro-api-key-changed"));
      ctx.toast(m?.messages?.apiKeySaved || "已保存");
      await refreshKeyStatus();
      await refreshSystemHealth();
    } catch (e) {
      ctx.toast(e?.message || "失败", true);
    }
  });

  root.querySelector("#stTestKey").addEventListener("click", async () => {
    const out = root.querySelector("#stKeyTestOut");
    const btn = root.querySelector("#stTestKey");
    const candidate = keyInput.value.trim();
    out.style.display = "block";
    out.style.borderColor = "rgba(148,163,184,0.32)";
    out.style.color = "var(--muted)";
    out.textContent = "⏳ 正在向 OpenAI 发轻量校验请求…（不会消耗对话额度）";
    btn.disabled = true;
    try {
      const r = await ctx.ipc.testApiKey({ apiKey: candidate });
      if (r?.ok) {
        out.style.borderColor = "rgba(34,197,94,0.55)";
        out.style.color = "#bbf7d0";
        out.textContent = r.message || "✓ 可用";
      } else {
        out.style.borderColor = "rgba(248,113,113,0.55)";
        out.style.color = "#fecaca";
        out.textContent = `✗ Key 不可用\n\n${r?.message || "未知错误"}`;
      }
    } catch (e) {
      out.style.borderColor = "rgba(248,113,113,0.55)";
      out.style.color = "#fecaca";
      out.textContent = `✗ 检测失败：${e?.message || e}`;
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelector("#stClearKey").addEventListener("click", async () => {
    await ctx.ipc.clearApiKey();
    keyInput.value = "";
    if (globalKey) globalKey.value = "";
    window.dispatchEvent(new CustomEvent("ai-pro-api-key-changed"));
    ctx.toast(m?.messages?.apiKeyCleared || "已清除");
    await refreshKeyStatus();
    await refreshSystemHealth();
  });

  root.querySelector("#stLang").addEventListener("change", () => saveSettings({ defaultLang: root.querySelector("#stLang").value }));
  root.querySelector("#stFmt").addEventListener("change", () => saveSettings({ defaultExportFormat: root.querySelector("#stFmt").value }));
  root.querySelector("#stTheme").addEventListener("change", () => {
    const theme = root.querySelector("#stTheme").value || "graphite";
    saveSettings({ theme });
    ctx.applyTheme(theme);
  });
  root.querySelector("#stViewMode").addEventListener("change", () => {
    const viewMode = root.querySelector("#stViewMode").value || "standard";
    saveSettings({ viewMode });
    ctx.applyViewMode?.(viewMode);
  });
  root.querySelector("#stBatch").addEventListener("change", () => saveSettings({ batchEnabled: root.querySelector("#stBatch").checked }));

  let lastUpdateDownloadUrl = "";
  const updateUrlInput = root.querySelector("#stUpdateUrl");
  const updateOut = root.querySelector("#stUpdateOut");
  const openUpdateBtn = root.querySelector("#stOpenUpdate");

  root.querySelector("#stSaveUpdateUrl").addEventListener("click", () => {
    const updateFeedUrl = updateUrlInput.value.trim();
    saveSettings({ updateFeedUrl });
    ctx.toast(updateFeedUrl ? "更新源已保存" : "已清空更新源");
  });

  root.querySelector("#stCheckUpdate").addEventListener("click", async () => {
    const btn = root.querySelector("#stCheckUpdate");
    const updateFeedUrl = updateUrlInput.value.trim();
    if (!updateFeedUrl) {
      ctx.toast("请先填写更新源 JSON 地址", true);
      return;
    }
    saveSettings({ updateFeedUrl });
    lastUpdateDownloadUrl = "";
    openUpdateBtn.disabled = true;
    updateOut.style.display = "block";
    updateOut.style.borderColor = "rgba(148,163,184,0.32)";
    updateOut.style.color = "var(--muted)";
    updateOut.textContent = "正在检查更新…";
    btn.disabled = true;
    try {
      const r = await ctx.ipc.checkAppUpdate({ feedUrl: updateFeedUrl });
      if (r?.disabled) {
        updateOut.textContent = `更新通道已关闭\n${r.message || ""}`.trim();
        return;
      }
      const notes = Array.isArray(r?.notes) ? r.notes.map((x) => `- ${x}`).join("\n") : String(r?.notes || "");
      if (r?.hasUpdate) {
        lastUpdateDownloadUrl = r.downloadUrl || "";
        openUpdateBtn.disabled = !lastUpdateDownloadUrl;
        updateOut.style.borderColor = "rgba(34,197,94,0.55)";
        updateOut.style.color = "#bbf7d0";
        updateOut.textContent = [
          `发现新版本：${r.currentVersion || "当前"} → ${r.latestVersion}`,
          r.releaseDate ? `发布日期：${r.releaseDate}` : "",
          r.fileName ? `安装包：${r.fileName}` : "",
          r.sha256 ? `SHA256：${r.sha256}` : "",
          notes ? `更新说明：\n${notes}` : "",
          lastUpdateDownloadUrl ? "点击「打开下载」获取新版。" : "更新源没有提供当前平台下载链接。",
        ].filter(Boolean).join("\n");
      } else {
        updateOut.style.borderColor = "rgba(148,163,184,0.32)";
        updateOut.style.color = "var(--muted)";
        updateOut.textContent = `已是最新版本：${r?.currentVersion || "当前版本"}\n更新源版本：${r?.latestVersion || "未知"}`;
      }
    } catch (e) {
      updateOut.style.borderColor = "rgba(248,113,113,0.55)";
      updateOut.style.color = "#fecaca";
      updateOut.textContent = `检查失败：${e?.message || e}`;
    } finally {
      btn.disabled = false;
    }
  });

  openUpdateBtn.addEventListener("click", async () => {
    if (!lastUpdateDownloadUrl) {
      ctx.toast("暂无可打开的下载链接", true);
      return;
    }
    try {
      await ctx.ipc.openExternalUrl({ url: lastUpdateDownloadUrl });
    } catch (e) {
      ctx.toast(e?.message || "打开下载链接失败", true);
    }
  });

  root.querySelector("#stExport").addEventListener("click", async () => {
    try {
      const json = await idb.exportAllData();
      saveSettings({ lastBackupAt: Date.now() });
      const r = await ctx.ipc.saveGeneratedFile({
        suggestedName: `acsp-backup-${Date.now()}.json`,
        content: json,
        format: "json",
      });
      ctx.toast(r?.canceled ? "已取消" : `已导出：${r.filePath}`);
      await refreshSystemHealth();
    } catch (e) {
      ctx.toast(e?.message || "导出失败", true);
    }
  });

  const importInput = root.querySelector("#stImportFile");
  root.querySelector("#stImport").addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const f = importInput.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      await idb.importAllData(text);
      saveSettings({ lastBackupAt: Date.now() });
      ctx.emitLibraryChanged();
      ctx.toast("备份已导入");
      await refreshSystemHealth();
    } catch (e) {
      ctx.toast(e?.message || "导入失败", true);
    }
    importInput.value = "";
  });

  root.querySelector("#stClear").addEventListener("click", async () => {
    await historyStore.clearHistory();
    ctx.emitLibraryChanged();
    ctx.toast("历史记录已清除");
    await refreshSystemHealth();
  });

  root.querySelector("#stClearAll").addEventListener("click", async () => {
    if (!confirm("确定清除全部本地数据？文件库中的文件将被删除。")) return;
    try {
      const lib = await ctx.ipc.libraryList();
      for (const it of lib) {
        await ctx.ipc.libraryDelete({ id: it.id });
      }
    } catch {
      // ignore
    }
    await idb.wipeAll();
    localStorage.removeItem("aiPro.settings.v1");
    localStorage.removeItem("aiPro.history.v2");
    localStorage.removeItem("aiPro.iconHistory.v1");
    ctx.emitLibraryChanged();
    ctx.toast("已清除全部数据");
    await refreshSystemHealth();
  });

  const ul = root.querySelector("#stCap");
  (m.capabilityBullets || []).forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    ul.appendChild(li);
  });
  try {
    const be = idb.getStorageBackend();
    const sp = m.pages?.settings || {};
    const label =
      be === "indexedDB"
        ? m.pages?.dashboard?.storageIndexedDb || "IndexedDB"
        : be === "localStorage"
          ? m.pages?.dashboard?.storageLocalStorage || "localStorage"
          : m.pages?.dashboard?.storageUninit || "—";
    const li = document.createElement("li");
    li.textContent = `${sp.storageCapsPrefix || ""}${label}`;
    ul.appendChild(li);
  } catch {
    // ignore
  }

  return {
    destroy() {
      root.innerHTML = "";
    },
  };
}
