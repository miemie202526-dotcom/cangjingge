export function toast(host, message, isError) {
  if (!host || !message) return;
  const el = document.createElement("div");
  el.className = `toast${isError ? " err" : ""}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.3s";
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

/**
 * 将 HTML 字符串转为可挂载的 DOM。
 * 注意：多个并列根节点时，浏览器 template 只能取 firstElementChild，会丢节点；
 * 此处统一包进带 display:contents 的容器，保证整段 UI 全部挂载。
 */
export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = String(html ?? "").trim();
  const wrap = document.createElement("div");
  wrap.className = "el-html-mount";
  while (t.content.firstChild) {
    wrap.appendChild(t.content.firstChild);
  }
  return /** @type {HTMLElement} */ (wrap);
}

export function loadingState(container, message) {
  const wrap = document.createElement("div");
  wrap.className = "state-block";
  wrap.innerHTML = `<div class="loader"></div><div>${message || "加载中…"}</div>`;
  container.appendChild(wrap);
  return () => wrap.remove();
}

export function emptyState(container, title, hint) {
  const wrap = document.createElement("div");
  wrap.className = "state-block";
  wrap.innerHTML = `<div class="ico">◇</div><div style="font-weight:700;margin-bottom:6px">${title}</div><div class="muted">${hint || ""}</div>`;
  container.appendChild(wrap);
  return () => wrap.remove();
}

export function errorState(container, text) {
  const d = document.createElement("div");
  d.className = "err-box";
  d.textContent = text;
  container.appendChild(d);
  return () => d.remove();
}
