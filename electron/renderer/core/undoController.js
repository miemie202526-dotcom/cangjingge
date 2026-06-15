/**
 * 通用「撤销最近一次操作」控制器。
 *
 * 用法（页面里先有一段固定 DOM，例如）：
 *
 *   <div id="myUndoBar" class="hidden" style="...">
 *     <span id="myUndoMsg"></span>
 *     <span id="myUndoTimer"></span>
 *     <button id="myUndoBtn">撤销</button>
 *     <button id="myUndoClose">×</button>
 *   </div>
 *
 *   const undo = createUndoController({
 *     bar: root.querySelector("#myUndoBar"),
 *     msg: root.querySelector("#myUndoMsg"),
 *     timer: root.querySelector("#myUndoTimer"),
 *     undoBtn: root.querySelector("#myUndoBtn"),
 *     closeBtn: root.querySelector("#myUndoClose"),
 *     defaultSeconds: 15,
 *     onError: (e) => ctx.toast(e?.message || "撤销失败", true),
 *     onSuccess: (n) => ctx.toast(`已撤销，恢复 ${n} 项`),
 *   });
 *
 *   // 删除时调用：
 *   await idb.deleteX(rec.id);
 *   undo.register({
 *     records: [{ ...rec }],
 *     label: `已删除「${rec.title}」`,
 *     restore: async (records) => {
 *       for (const r of records) await idb.putX(r);
 *     },
 *   });
 */

/**
 * @typedef UndoControllerOpts
 * @property {HTMLElement} bar
 * @property {HTMLElement} msg
 * @property {HTMLElement} [timer]
 * @property {HTMLElement} undoBtn
 * @property {HTMLElement} [closeBtn]
 * @property {number} [defaultSeconds]
 * @property {(e: any) => void} [onError]
 * @property {(n: number) => void} [onSuccess]
 */

/**
 * @typedef UndoEntry
 * @property {any[]} records
 * @property {string} label
 * @property {(records:any[]) => Promise<void>|void} restore
 * @property {(records:any[]) => Promise<void>|void} [onExpire]
 *   倒计时归零或被新的 register 顶替时触发；常用于「真正落盘删除」。
 * @property {number} [seconds]
 */

/**
 * @param {UndoControllerOpts} opts
 */
export function createUndoController(opts) {
  const { bar, msg, timer, undoBtn, closeBtn, defaultSeconds = 15, onError, onSuccess } = opts;
  if (!bar || !msg || !undoBtn) {
    throw new Error("createUndoController: 缺少必需 DOM");
  }
  /** @type {UndoEntry|null} */
  let cur = null;
  let intervalId = 0;
  let countdown = 0;

  function clear() {
    if (cur && typeof cur.onExpire === "function") {
      try {
        Promise.resolve(cur.onExpire(cur.records)).catch((e) => onError && onError(e));
      } catch (e) {
        if (onError) onError(e);
      }
    }
    cur = null;
    bar.classList.add("hidden");
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = 0;
    }
    if (timer) timer.textContent = "";
  }

  function clearWithoutExpire() {
    cur = null;
    bar.classList.add("hidden");
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = 0;
    }
    if (timer) timer.textContent = "";
  }

  /**
   * @param {UndoEntry} entry
   */
  function register(entry) {
    if (!entry || !Array.isArray(entry.records) || !entry.records.length) return;
    if (cur && typeof cur.onExpire === "function") {
      try {
        Promise.resolve(cur.onExpire(cur.records)).catch((e) => onError && onError(e));
      } catch (e) {
        if (onError) onError(e);
      }
    }
    cur = entry;
    msg.textContent = entry.label || `已删除 ${entry.records.length} 项`;
    bar.classList.remove("hidden");
    countdown = Math.max(2, Math.floor(entry.seconds || defaultSeconds));
    if (timer) timer.textContent = `${countdown}s`;
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => {
      countdown -= 1;
      if (countdown <= 0) {
        clear();
        return;
      }
      if (timer) timer.textContent = `${countdown}s`;
    }, 1000);
  }

  async function performUndo() {
    if (!cur) return;
    const entry = cur;
    try {
      await entry.restore(entry.records);
      const n = entry.records.length;
      // 撤销成功：跳过 onExpire（不应再删除）
      clearWithoutExpire();
      if (onSuccess) onSuccess(n);
    } catch (e) {
      if (onError) onError(e);
    }
  }

  undoBtn.addEventListener("click", performUndo);
  // 关闭按钮等同于「确认提交」：让倒计时立即结束，触发 onExpire
  if (closeBtn) closeBtn.addEventListener("click", clear);

  return {
    register,
    clear,
    /** 当前是否有可撤销项 */
    hasPending: () => Boolean(cur),
    /** 直接触发撤销（如绑定快捷键 Ctrl+Z） */
    undo: performUndo,
  };
}

/**
 * 标准化的撤销条 HTML（可直接插入页面顶部）。颜色与金句库一致。
 * 提供选项前缀以避免多页面 ID 冲突。
 *
 * @param {string} prefix 例如 "lib"、"phb"
 */
export function buildUndoBarHtml(prefix) {
  const id = String(prefix || "x");
  return `
    <div id="${id}UndoBar" class="hidden" style="margin:8px 0;padding:10px 14px;border-radius:10px;background:linear-gradient(135deg,rgba(250,204,21,0.16),rgba(251,146,60,0.14));border:1px solid rgba(250,204,21,0.45);display:flex;align-items:center;gap:10px">
      <span id="${id}UndoMsg" style="flex:1;color:#fde68a;font-size:0.88rem"></span>
      <span id="${id}UndoTimer" class="muted" style="font-size:0.72rem"></span>
      <button type="button" class="btn btn-secondary btn-sm" id="${id}UndoBtn">撤销</button>
      <button type="button" class="btn btn-ghost btn-sm" id="${id}UndoClose" style="font-size:0.9rem;padding:2px 8px">×</button>
    </div>`;
}
