/**
 * 设置读写（内存缓存 + IndexedDB，由 idbStore.initStore 预热）
 */
import * as idb from "./idbStore.js";

export function loadSettings() {
  return idb.getSettings();
}

export function saveSettings(partial) {
  void idb.saveSettings(partial);
}
