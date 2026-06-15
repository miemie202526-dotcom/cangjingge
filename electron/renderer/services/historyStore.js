/**
 * 历史记录 = IndexedDB tasks（与 AI 分析 / 文件生成 / 图标共用）
 */
import * as idb from "./idbStore.js";

export async function listHistory() {
  return idb.listTasks();
}

export async function pushHistory(entry) {
  const id = entry.id || crypto.randomUUID();
  const at = entry.at ?? entry.createdAt ?? Date.now();
  await idb.putTask({
    id,
    at,
    createdAt: entry.createdAt ?? at,
    type: String(entry.type || "task"),
    title: String(entry.title || "未命名"),
    summary: String(entry.summary || ""),
    content: String(entry.content || ""),
    meta: entry.meta && typeof entry.meta === "object" ? entry.meta : {},
  });
}

export async function deleteHistory(id) {
  await idb.deleteTask(id);
}

export async function clearHistory() {
  await idb.clearTasks();
}

export function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export async function countTodayTasks() {
  const list = await listHistory();
  const t0 = todayStart();
  return list.filter((x) => (x.at || x.createdAt || 0) >= t0).length;
}
