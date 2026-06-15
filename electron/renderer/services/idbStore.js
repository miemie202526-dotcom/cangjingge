/**
 * IndexedDB 统一数据层：files / tasks / outputs / settings
 * IndexedDB 打开失败时自动降级到 localStorage（避免 transaction on null）。
 */

const DB_NAME = "ACSPProDB";
const DB_VERSION = 2;
const MIGRATION_FLAG = "acsp_migrated_idb_v1";
const LS_MIRROR_KEY = "acsp_ls_mirror_v1";

/** @type {IDBDatabase | null} */
let db = null;

/** @type {boolean} */
let useLocalFallback = false;

/**
 * @typedef {{
 *   files: Record<string, Record<string, unknown>>,
 *   tasks: Record<string, Record<string, unknown>>,
 *   outputs: Record<string, Record<string, unknown>>,
 *   phrases: Record<string, Record<string, unknown>>,
 *   kv: Record<string, unknown>,
 * }} LsMirror
 */

/** @type {LsMirror | null} */
let lsMirror = null;

export const STORE_CHANGED_EVENT = "acsp-store-changed";

/** @returns {"indexedDB"|"localStorage"|"uninitialized"} */
export function getStorageBackend() {
  if (db) return "indexedDB";
  if (useLocalFallback) return "localStorage";
  return "uninitialized";
}

function notifyStoreChanged() {
  try {
    window.dispatchEvent(new CustomEvent(STORE_CHANGED_EVENT));
  } catch {
    // ignore
  }
}

/** @type {Record<string, unknown>} */
let settingsCache = {
  apiKeySession: "",
  defaultModel: "gpt-4.1-mini",
  defaultLang: "zh-CN",
  defaultExportFormat: "docx",
  theme: "dark",
  batchEnabled: true,
  updateFeedUrl: "",
};

function loadMirror() {
  try {
    const raw = localStorage.getItem(LS_MIRROR_KEY);
    lsMirror = raw ? JSON.parse(raw) : null;
  } catch {
    lsMirror = null;
  }
  if (!lsMirror || typeof lsMirror !== "object") {
    lsMirror = { files: {}, tasks: {}, outputs: {}, phrases: {}, kv: {} };
  }
  if (!lsMirror.files) lsMirror.files = {};
  if (!lsMirror.tasks) lsMirror.tasks = {};
  if (!lsMirror.outputs) lsMirror.outputs = {};
  if (!lsMirror.phrases) lsMirror.phrases = {};
  if (!lsMirror.kv) lsMirror.kv = {};
}

function persistMirror() {
  try {
    localStorage.setItem(LS_MIRROR_KEY, JSON.stringify(lsMirror));
  } catch (e) {
    console.warn("[idbStore] localStorage persist failed", e);
  }
}

/** Windows 上偶发 upgrade 阻塞或磁盘锁会导致 open 长期不回调，拖死整页；超时后降级 localStorage */
const IDB_OPEN_TIMEOUT_MS = 12_000;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => {
        try {
          req.onerror = null;
          req.onsuccess = null;
          req.onupgradeneeded = null;
          req.onblocked = null;
        } catch {
          // ignore
        }
        reject(new Error(`IndexedDB 打开超时（${IDB_OPEN_TIMEOUT_MS}ms），已降级存储`));
      });
    }, IDB_OPEN_TIMEOUT_MS);
    req.onerror = () => finish(() => reject(req.error));
    req.onsuccess = () => finish(() => resolve(req.result));
    req.onblocked = () => {
      console.warn("[idbStore] IndexedDB upgrade blocked (close other tabs using this app)");
    };
    req.onupgradeneeded = (e) => {
      const d = /** @type {IDBDatabase} */ (e.target.result);
      if (!d.objectStoreNames.contains("files")) d.createObjectStore("files", { keyPath: "id" });
      if (!d.objectStoreNames.contains("tasks")) d.createObjectStore("tasks", { keyPath: "id" });
      if (!d.objectStoreNames.contains("outputs")) d.createObjectStore("outputs", { keyPath: "id" });
      if (!d.objectStoreNames.contains("phrases")) d.createObjectStore("phrases", { keyPath: "id" });
      if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
    };
  });
}

async function migrateFromLocalStorageOnce() {
  if (!db || localStorage.getItem(MIGRATION_FLAG)) return;
  try {
    const rawHist = localStorage.getItem("aiPro.history.v2");
    if (rawHist) {
      const arr = JSON.parse(rawHist);
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && item.id) await putTask(item);
        }
      }
    }
    const rawSet = localStorage.getItem("aiPro.settings.v1");
    if (rawSet) {
      const o = JSON.parse(rawSet);
      if (o && typeof o === "object") {
        settingsCache = { ...settingsCache, ...o };
        await setKv("settings", settingsCache);
      }
    }
  } catch {
    // ignore
  }
  localStorage.setItem(MIGRATION_FLAG, "1");
}

/** 将旧版 localStorage 迁入 LS 镜像（仅 fallback 路径调用） */
function migrateLegacyIntoMirrorOnce() {
  if (localStorage.getItem(MIGRATION_FLAG)) return;
  try {
    loadMirror();
    const rawHist = localStorage.getItem("aiPro.history.v2");
    if (rawHist) {
      const arr = JSON.parse(rawHist);
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && item.id) {
            const at = item.at ?? item.createdAt ?? Date.now();
            lsMirror.tasks[item.id] = { ...item, at, createdAt: item.createdAt ?? at };
          }
        }
      }
    }
    const rawSet = localStorage.getItem("aiPro.settings.v1");
    if (rawSet) {
      const o = JSON.parse(rawSet);
      if (o && typeof o === "object") {
        settingsCache = { ...settingsCache, ...o };
        lsMirror.kv.settings = settingsCache;
      }
    }
    persistMirror();
  } catch {
    // ignore
  }
  localStorage.setItem(MIGRATION_FLAG, "1");
}

export async function initStore() {
  useLocalFallback = false;
  try {
    db = await openDb();
  } catch (e) {
    console.warn("[idbStore] IndexedDB unavailable, using localStorage mirror", e);
    db = null;
    useLocalFallback = true;
    loadMirror();
    migrateLegacyIntoMirrorOnce();
    const s = lsMirror.kv.settings;
    if (s && typeof s === "object") settingsCache = { ...settingsCache, ...s };
    return null;
  }
  try {
    const kv = await getKv("settings");
    if (kv && typeof kv === "object") settingsCache = { ...settingsCache, ...kv };
    await migrateFromLocalStorageOnce();
  } catch (e) {
    console.warn("[idbStore] post-open init failed, falling back to localStorage", e);
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
    useLocalFallback = true;
    loadMirror();
    migrateLegacyIntoMirrorOnce();
    const s = lsMirror.kv.settings;
    if (s && typeof s === "object") settingsCache = { ...settingsCache, ...s };
    return null;
  }
  return db;
}

/**
 * @param {{ libraryList: () => Promise<any[]>; libraryGetContent: (p: any) => Promise<any> }} ipc
 */
export async function syncLibraryIntoIdb(ipc) {
  if (!ipc?.libraryList || !ipc?.libraryGetContent) return;
  let lib = [];
  try {
    lib = await ipc.libraryList();
  } catch {
    return;
  }
  for (let i = 0; i < lib.length; i++) {
    const rec = lib[i];
    if (!rec?.id) continue;
    try {
      const existing = await getFile(rec.id);
      const hasBody = existing && typeof existing.content === "string" && existing.content.length > 0;
      if (hasBody) continue;
      const { content, record } = await ipc.libraryGetContent({ id: rec.id, apiKey: "" });
      const merged = {
        ...rec,
        ...(record && typeof record === "object" ? record : {}),
        id: rec.id,
        content: String(content ?? ""),
        markdownPreview: String(rec.markdownPreview || record?.markdownPreview || ""),
      };
      await putFile(merged, { silent: true });
    } catch (e) {
      console.warn("[idbStore] sync skip", rec.id, e);
    }
    if (i % 2 === 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  notifyStoreChanged();
}

/** 不阻塞首屏：在浏览器空闲或短延迟后从主进程库拉取正文补全 IndexedDB */
function scheduleBackgroundLibrarySync(ipc) {
  const run = () => {
    syncLibraryIntoIdb(ipc).catch((e) => console.warn("[idbStore] background library sync", e));
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 32);
  }
}

export async function initStoreWithLibrary(ipc) {
  try {
    await initStore();
  } catch (e) {
    console.warn("[idbStore] initStore failed, continuing with localStorage", e);
    if (!useLocalFallback) {
      db = null;
      useLocalFallback = true;
      loadMirror();
      migrateLegacyIntoMirrorOnce();
    }
  }
  scheduleBackgroundLibrarySync(ipc);
}

async function getKv(key) {
  if (!db) {
    loadMirror();
    return lsMirror.kv[key] ?? null;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readonly");
    const req = tx.objectStore("kv").get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function setKv(key, value) {
  if (!db) {
    loadMirror();
    lsMirror.kv[key] = value;
    persistMirror();
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function txDone(tx) {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/**
 * @param {Record<string, unknown>} rec
 * @param {{ silent?: boolean }} [opts]
 */
export async function putFile(rec, opts = {}) {
  if (!db) {
    loadMirror();
    const id = String(rec?.id ?? "");
    if (!id) throw new Error("putFile: missing id");
    lsMirror.files[id] = { ...rec, id };
    persistMirror();
    if (!opts.silent) notifyStoreChanged();
    return;
  }
  const tx = db.transaction("files", "readwrite");
  tx.objectStore("files").put(rec);
  await txDone(tx);
  if (!opts.silent) notifyStoreChanged();
}

export async function getFile(id) {
  if (!db) {
    loadMirror();
    return lsMirror.files[id] ?? null;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const req = tx.objectStore("files").get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function listFiles() {
  if (!db) {
    loadMirror();
    const all = Object.values(lsMirror.files);
    all.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    return all;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const req = tx.objectStore("files").getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      all.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteFile(id) {
  if (!db) {
    loadMirror();
    delete lsMirror.files[id];
    persistMirror();
    notifyStoreChanged();
    return;
  }
  const tx = db.transaction("files", "readwrite");
  tx.objectStore("files").delete(id);
  await txDone(tx);
  notifyStoreChanged();
}

export async function patchFile(id, partial) {
  const cur = await getFile(id);
  if (!cur) return null;
  const next = { ...cur, ...partial };
  if (!db) {
    loadMirror();
    lsMirror.files[id] = next;
    persistMirror();
    notifyStoreChanged();
    return next;
  }
  const tx = db.transaction("files", "readwrite");
  tx.objectStore("files").put(next);
  await txDone(tx);
  notifyStoreChanged();
  return next;
}

/** @param {Record<string, unknown>} t */
export async function putTask(t) {
  const at = t.at ?? t.createdAt ?? Date.now();
  const normalized = { ...t, at, createdAt: t.createdAt ?? at };
  if (!db) {
    loadMirror();
    if (!normalized.id) throw new Error("putTask: missing id");
    lsMirror.tasks[String(normalized.id)] = normalized;
    persistMirror();
    notifyStoreChanged();
    return;
  }
  const tx = db.transaction("tasks", "readwrite");
  tx.objectStore("tasks").put(normalized);
  await txDone(tx);
  notifyStoreChanged();
}

export async function listTasks() {
  if (!db) {
    loadMirror();
    const all = Object.values(lsMirror.tasks);
    all.sort((a, b) => (b.createdAt || b.at || 0) - (a.createdAt || a.at || 0));
    return all;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tasks", "readonly");
    const req = tx.objectStore("tasks").getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      all.sort((a, b) => (b.createdAt || b.at || 0) - (a.createdAt || a.at || 0));
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTask(id) {
  if (!db) {
    loadMirror();
    delete lsMirror.tasks[id];
    persistMirror();
    notifyStoreChanged();
    return;
  }
  const tx = db.transaction("tasks", "readwrite");
  tx.objectStore("tasks").delete(id);
  await txDone(tx);
  notifyStoreChanged();
}

export async function clearTasks() {
  if (!db) {
    loadMirror();
    lsMirror.tasks = {};
    persistMirror();
    notifyStoreChanged();
    return;
  }
  const tx = db.transaction("tasks", "readwrite");
  const s = tx.objectStore("tasks");
  const req = s.clear();
  await new Promise((res, rej) => {
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
  notifyStoreChanged();
}

/** @param {Record<string, unknown>} o */
export async function putOutput(o) {
  if (!db) {
    loadMirror();
    if (!o?.id) throw new Error("putOutput: missing id");
    lsMirror.outputs[String(o.id)] = o;
    persistMirror();
    notifyStoreChanged();
    return;
  }
  const tx = db.transaction("outputs", "readwrite");
  tx.objectStore("outputs").put(o);
  await txDone(tx);
  notifyStoreChanged();
}

export async function listOutputs() {
  if (!db) {
    loadMirror();
    return Object.values(lsMirror.outputs);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction("outputs", "readonly");
    const req = tx.objectStore("outputs").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteOutput(id) {
  if (!db) {
    loadMirror();
    delete lsMirror.outputs[id];
    persistMirror();
    notifyStoreChanged();
    return;
  }
  const tx = db.transaction("outputs", "readwrite");
  tx.objectStore("outputs").delete(id);
  await txDone(tx);
  notifyStoreChanged();
}

/**
 * 金句库（学习卡片）：保存/列出/更新/删除
 * @param {Record<string, unknown>} p
 */
export async function putPhrase(p) {
  const at = p.createdAt ?? Date.now();
  const normalized = {
    ...p,
    id: String(p.id ?? `phrase-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
    createdAt: p.createdAt ?? at,
    updatedAt: Date.now(),
  };
  if (!db) {
    loadMirror();
    lsMirror.phrases[normalized.id] = normalized;
    persistMirror();
    notifyStoreChanged();
    return normalized;
  }
  const tx = db.transaction("phrases", "readwrite");
  tx.objectStore("phrases").put(normalized);
  await txDone(tx);
  notifyStoreChanged();
  return normalized;
}

export async function listPhrases() {
  if (!db) {
    loadMirror();
    const all = Object.values(lsMirror.phrases);
    all.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return all;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction("phrases", "readonly");
    const req = tx.objectStore("phrases").getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      all.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getPhrase(id) {
  if (!db) {
    loadMirror();
    return lsMirror.phrases[id] ?? null;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction("phrases", "readonly");
    const req = tx.objectStore("phrases").get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function patchPhrase(id, partial) {
  const cur = await getPhrase(id);
  if (!cur) return null;
  const next = { ...cur, ...partial, id, updatedAt: Date.now() };
  if (!db) {
    loadMirror();
    lsMirror.phrases[id] = next;
    persistMirror();
    notifyStoreChanged();
    return next;
  }
  const tx = db.transaction("phrases", "readwrite");
  tx.objectStore("phrases").put(next);
  await txDone(tx);
  notifyStoreChanged();
  return next;
}

export async function deletePhrase(id) {
  if (!db) {
    loadMirror();
    delete lsMirror.phrases[id];
    persistMirror();
    notifyStoreChanged();
    return;
  }
  const tx = db.transaction("phrases", "readwrite");
  tx.objectStore("phrases").delete(id);
  await txDone(tx);
  notifyStoreChanged();
}

export async function clearPhrases() {
  if (!db) {
    loadMirror();
    lsMirror.phrases = {};
    persistMirror();
    notifyStoreChanged();
    return;
  }
  const tx = db.transaction("phrases", "readwrite");
  const s = tx.objectStore("phrases");
  const req = s.clear();
  await new Promise((res, rej) => {
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
  notifyStoreChanged();
}

export function getSettings() {
  return { ...settingsCache };
}

export async function saveSettings(patch) {
  settingsCache = { ...settingsCache, ...patch };
  await setKv("settings", settingsCache);
  notifyStoreChanged();
}

/** @param {string} key */
export async function storeGet(key) {
  return getKv(key);
}

/** @param {string} key @param {unknown} value */
export async function storeSet(key, value) {
  return setKv(key, value);
}

export async function exportAllData() {
  const files = await listFiles();
  const tasks = await listTasks();
  const outputs = await listOutputs();
  const phrases = await listPhrases();
  return JSON.stringify(
    { version: 2, exportedAt: Date.now(), settings: settingsCache, files, tasks, outputs, phrases },
    null,
    2,
  );
}

export async function importAllData(jsonText) {
  const data = JSON.parse(jsonText);
  if (!data || typeof data !== "object") throw new Error("无效备份");
  if (data.settings && typeof data.settings === "object") {
    settingsCache = { ...settingsCache, ...data.settings };
    await setKv("settings", settingsCache);
  }
  if (Array.isArray(data.files) && data.files.length) {
    for (const f of data.files) {
      if (f && f.id) await putFile(f, { silent: true });
    }
  }
  if (Array.isArray(data.tasks) && data.tasks.length) {
    for (const t of data.tasks) {
      if (!t || !t.id) continue;
      await putTask(t);
    }
  }
  if (Array.isArray(data.outputs) && data.outputs.length) {
    for (const o of data.outputs) {
      if (o && o.id) await putOutput(o);
    }
  }
  if (Array.isArray(data.phrases) && data.phrases.length) {
    for (const p of data.phrases) {
      if (p && p.id) await putPhrase(p);
    }
  }
  notifyStoreChanged();
}

export async function wipeAll() {
  if (!db) {
    loadMirror();
    lsMirror.files = {};
    lsMirror.tasks = {};
    lsMirror.outputs = {};
    lsMirror.phrases = {};
    lsMirror.kv = {};
    settingsCache = {
      apiKeySession: "",
      defaultModel: "gpt-4.1-mini",
      defaultLang: "zh-CN",
      defaultExportFormat: "docx",
      theme: "dark",
      batchEnabled: true,
    };
    lsMirror.kv.settings = settingsCache;
    persistMirror();
    notifyStoreChanged();
    return;
  }
  const tx = db.transaction(["files", "tasks", "outputs", "phrases", "kv"], "readwrite");
  tx.objectStore("files").clear();
  tx.objectStore("tasks").clear();
  tx.objectStore("outputs").clear();
  tx.objectStore("phrases").clear();
  tx.objectStore("kv").clear();
  await txDone(tx);
  settingsCache = {
    apiKeySession: "",
    defaultModel: "gpt-4.1-mini",
    defaultLang: "zh-CN",
    defaultExportFormat: "docx",
    theme: "dark",
    batchEnabled: true,
  };
  await setKv("settings", settingsCache);
  notifyStoreChanged();
}
