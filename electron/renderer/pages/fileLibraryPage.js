import * as idb from "../services/idbStore.js";
import * as historyStore from "../services/historyStore.js";
import { el, loadingState, emptyState, errorState } from "../core/ui.js";
import { createUndoController, buildUndoBarHtml } from "../core/undoController.js";

const LIBRARY_READ_TIMEOUT_MS = 6_000;
const LIBRARY_SYNC_TIMEOUT_MS = 10_000;

/** @param {File} f */
function fileToBase64(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

function textToBase64(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  return btoa(binary);
}

function safeFilePart(text) {
  return String(text || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 72);
}

function withTimeout(promise, ms, label) {
  let timer = 0;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label}超时，请稍后点刷新重试`)), ms);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

function escAttr(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escHtmlOuter(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 转义并按多个关键词高亮（不区分大小写）。返回安全 HTML。 */
function highlightHtmlOuter(text, keywords) {
  const raw = String(text ?? "");
  if (!raw) return "";
  const kws = (Array.isArray(keywords) ? keywords : [keywords])
    .map((k) => String(k || "").trim())
    .filter(Boolean);
  if (!kws.length) return escHtmlOuter(raw);
  const re = new RegExp(`(${kws.map(escRe).join("|")})`, "gi");
  let out = "";
  let last = 0;
  raw.replace(re, (m, _g, idx) => {
    out += escHtmlOuter(raw.slice(last, idx));
    out += `<mark>${escHtmlOuter(m)}</mark>`;
    last = idx + m.length;
    return m;
  });
  out += escHtmlOuter(raw.slice(last));
  return out;
}

export function mountFileLibrary(root, ctx) {
  root.innerHTML = "";
  const m = ctx.manifest();
  const p = m.pages?.library || {};
  const filOpts = (m.libraryFileFilterOptions || [])
    .map((o) => `<option value="${escAttr(o.value)}">${o.label || ""}</option>`)
    .join("");

  root.appendChild(
    el(`
    <div class="page-head library-page-head">
      <div class="library-title-block">
        <h1 class="page-title">${p.title || ""}</h1>
        <p class="page-sub">集中保存、搜索、阅读所有文件和聊天记录。</p>
      </div>
      <div class="library-vault-stats library-vault-stats--inline" id="libVaultStats">
        <span><b>0</b> 全部文件</span>
        <span><b>0</b> 当前结果</span>
        <span><b>0</b> 已选择</span>
        <span><b>0</b> 收藏</span>
      </div>
      <div class="row">
        <button type="button" class="btn btn-primary btn-sm" id="libUpload">${p.uploadBtn || ""}</button>
        <button type="button" class="btn btn-secondary btn-sm" id="libPasteChat">粘贴聊天记录</button>
        <button type="button" class="btn btn-secondary btn-sm" id="libToggleTools">智能工具箱</button>
        <input type="file" id="libFileInput" multiple style="display:none" />
      </div>
    </div>
    <details class="library-tools-drawer library-tools-drawer--compact" id="libToolsDrawer">
      <summary>
        <span>
          <strong>智能工具箱</strong>
          <small>导入聊天、资料地图、问整个文件库、一键整理</small>
        </span>
        <b>展开</b>
      </summary>
      <div class="library-tools-body">
    <section class="library-hub">
      <div id="libDrop" class="library-drop" style="cursor:pointer">
        <b>拖入任何资料</b>
        <span>${m?.messages?.dragDropHint || "拖拽文件到此处上传"}</span>
        <small>PDF / Word / Excel / PPT / CSV / TXT / MD / JSON / HTML / 图片 OCR / 聊天导出 / 邮件记录 / 日志</small>
      </div>
      <div class="library-hub-actions">
        <button type="button" class="btn btn-primary btn-sm" id="libHubUpload">上传文件</button>
        <button type="button" class="btn btn-secondary btn-sm" id="libHubChat">导入聊天记录</button>
        <button type="button" class="btn btn-secondary btn-sm" id="libHubFocusSearch">搜索资料库</button>
      </div>
    </section>
    <section class="library-map-panel">
      <div class="library-map-head">
        <div>
          <div class="library-map-kicker">资料地图</div>
          <h2>自动看清资料库结构</h2>
          <p class="muted">按类型、人物/对象、时间、金额资产和风险信号建立本地索引，点击任一线索即可筛选跳转。</p>
        </div>
        <div class="library-map-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="libMapRefresh">刷新地图</button>
          <button type="button" class="btn btn-primary btn-sm" id="libMapOrganize">一键整理当前范围</button>
        </div>
      </div>
      <div class="library-map-grid">
        <div class="library-map-block">
          <h3>资料类型</h3>
          <div id="libMapTypes" class="library-map-chip-list"></div>
        </div>
        <div class="library-map-block">
          <h3>人物 / 对象</h3>
          <div id="libMapEntities" class="library-map-chip-list"></div>
        </div>
        <div class="library-map-block">
          <h3>时间线</h3>
          <div id="libMapDates" class="library-map-chip-list"></div>
        </div>
        <div class="library-map-block">
          <h3>金额 / 资产</h3>
          <div id="libMapMoney" class="library-map-chip-list"></div>
        </div>
        <div class="library-map-block">
          <h3>风险 / 问题</h3>
          <div id="libMapRisks" class="library-map-chip-list"></div>
        </div>
      </div>
      <div class="library-map-status muted" id="libMapStatus">等待扫描</div>
    </section>
    <div id="libChatPanel" class="library-chat-panel hidden" style="display:none">
      <div class="library-chat-head">
        <div>
          <h3>导入聊天记录</h3>
          <p class="muted">微信、飞书、邮件、客服对话、会议文字稿都可以直接粘贴，自动作为资料入库。</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="libChatClose">关闭</button>
      </div>
      <div class="library-chat-grid">
        <input class="inp" id="libChatTitle" placeholder="标题，例如：6月客户沟通记录" />
        <select class="inp" id="libChatCategory">
          <option value="聊天记录">聊天记录</option>
          <option value="客户沟通">客户沟通</option>
          <option value="会议纪要">会议纪要</option>
          <option value="项目">项目</option>
          <option value="其他">其他</option>
        </select>
      </div>
      <textarea class="inp" id="libChatText" rows="9" placeholder="把聊天记录粘贴到这里。支持按人名、日期、关键词搜索；入库后可一键分析、生成行动清单或提取表格。"></textarea>
      <div class="library-chat-actions">
        <button type="button" class="btn btn-primary" id="libChatSave">保存到文件库</button>
        <button type="button" class="btn btn-secondary" id="libChatAnalyze">保存并分析</button>
        <span class="muted" id="libChatStat">0 字</span>
      </div>
    </div>
    <section class="library-qa-panel">
      <div class="library-qa-head">
        <div>
          <div class="library-qa-kicker">资料库问答</div>
          <h2>问整个文件库</h2>
          <p class="muted">跨文件读取资料、聊天记录、表格和备注，直接输出答案、证据文件和下一步动作。</p>
        </div>
        <select class="inp" id="libQaScope" aria-label="问答范围">
          <option value="smart">智能范围</option>
          <option value="checked">勾选文件</option>
          <option value="current">当前打开文件</option>
          <option value="search">当前搜索结果</option>
          <option value="all">全部文件</option>
        </select>
      </div>
      <div class="library-qa-input-row">
        <textarea class="inp" id="libQaQuestion" rows="3" placeholder="直接问：这些聊天记录里客户最关心什么？有哪些承诺和风险？下一步该怎么推进？"></textarea>
        <div class="library-qa-actions">
          <button type="button" class="btn btn-primary" id="libQaAsk">开始问库</button>
          <button type="button" class="btn btn-secondary" id="libQaSendAnalysis">转 AI 分析</button>
          <button type="button" class="btn btn-ghost" id="libQaCopy">复制答案</button>
        </div>
      </div>
      <div class="library-qa-chips">
        <button type="button" data-lib-qa-preset="总结所有资料的核心结论、风险点和下一步行动。">总结资料库</button>
        <button type="button" data-lib-qa-preset="从聊天记录中提取客户诉求、情绪变化、承诺事项和跟进话术。">分析聊天记录</button>
        <button type="button" data-lib-qa-preset="找出所有文件里的风险、证据来源、优先级和处理建议。">风险审查</button>
        <button type="button" data-lib-qa-preset="把相关资料整理成老板汇报：结论、证据、风险、建议决策。">老板汇报</button>
      </div>
      <div class="library-qa-meta muted" id="libQaMeta">范围会自动优先使用勾选文件；没有勾选时使用当前搜索结果或最近资料。</div>
      <textarea class="inp library-qa-answer" id="libQaAnswer" rows="9" readonly placeholder="答案会显示在这里。"></textarea>
      <div class="library-qa-evidence hidden" id="libQaEvidence" style="display:none"></div>
      <div class="library-qa-footer">
        <button type="button" class="btn btn-secondary btn-sm" id="libQaSave">保存到历史</button>
        <span class="muted" id="libQaStatus">等待提问</span>
      </div>
    </section>
      </div>
    </details>
    ${buildUndoBarHtml("lib")}
    <div class="toolbar library-toolbar">
      <div id="libSearchWrap" style="display:flex;align-items:center;gap:10px;flex:0 1 460px;min-width:240px;max-width:520px">
        <input type="search" class="inp" style="flex:1;min-width:0" id="libSearch" placeholder="${escAttr(p.searchPlaceholder)}（按 / 聚焦，回车跳转下一个）" />
        <div id="libHitNav" class="hidden kwHitNav">
          <span id="libHitCount" class="kwHitCount">0/0</span>
          <button type="button" class="kwHitBtn" id="libHitPrev" title="上一个 (Shift+Enter)" aria-label="上一个">↑</button>
          <button type="button" class="kwHitBtn" id="libHitNext" title="下一个 (Enter)" aria-label="下一个">↓</button>
          <button type="button" class="kwHitBtn kwHitBtnClose" id="libHitClose" title="清除搜索" aria-label="清除">×</button>
        </div>
      </div>
      <span id="libSearchStatus" class="library-search-status muted">输入关键词搜索</span>
      <select class="inp" style="max-width:160px" id="libFilter">${filOpts}</select>
      <select class="inp" style="max-width:160px" id="libSort">
        <option value="newest">排序：最新上传</option>
        <option value="oldest">排序：最早上传</option>
        <option value="nameAsc">排序：名称 A-Z</option>
        <option value="sizeDesc">排序：文件最大</option>
        <option value="relevance">排序：关键词相关度</option>
      </select>
      <label class="muted" style="display:flex;align-items:center;gap:6px;font-size:0.78rem">
        <input type="checkbox" id="libOnlyFav" />
        仅收藏
      </label>
      <select class="inp" style="max-width:120px" id="libView">
        <option value="table">${p.viewTable || ""}</option>
        <option value="cards">${p.viewCards || ""}</option>
      </select>
      <select class="inp" style="max-width:120px" id="libPageSize" title="列表分页，资料很多时可减少卡顿">
        <option value="50">每页 50</option>
        <option value="100">每页 100</option>
        <option value="200">每页 200</option>
        <option value="0">全部</option>
      </select>
      <div class="list-pager" id="libPager">
        <button type="button" class="btn btn-ghost btn-sm" id="libPagePrev">上一页</button>
        <span class="muted" id="libPageInfo">1/1</span>
        <button type="button" class="btn btn-ghost btn-sm" id="libPageNext">下一页</button>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="libBulkDel">${p.bulkDelete || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" id="libToAnalysis">${p.sendAnalysis || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" id="libToGen">${p.sendGenerator || ""}</button>
      <button type="button" class="btn btn-ghost btn-sm" id="libRefresh">${p.refresh || ""}</button>
    </div>
    <div id="libMainReader" class="card hidden" style="display:none;min-height:calc(100vh - 120px);padding:14px 16px">
      <div class="library-reader-commandbar">
        <div class="library-reader-titleline">
          <input class="inp library-reader-title-input" id="libMainTitle" maxlength="180" placeholder="文件标题" />
          <span id="libMainMeta" class="muted library-reader-meta"></span>
        </div>
        <div class="library-reader-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="libMainFocusToggle">收起栏</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libMainBack">返回列表</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libMainToAnalysis">AI 分析</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libMainToGen">生成文档</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libMainCopy">复制</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libMainOpenOs">系统打开</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libMainEditText">编辑内容</button>
          <button type="button" class="btn btn-primary btn-sm hidden" id="libMainSaveText" style="display:none">保存内容</button>
          <button type="button" class="btn btn-ghost btn-sm hidden" id="libMainCancelEdit" style="display:none">取消</button>
          <button type="button" class="btn btn-primary btn-sm" id="libMainSavePhrase" title="保存当前选中文本或命中句到金句库">存金句</button>
          <button type="button" class="btn btn-primary btn-sm" id="libMainSaveMeta">保存标注</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libMainArchiveSave" title="保存当前阅读位置">存档</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libMainArchiveGo" title="跳回上次手动存档的位置">回档</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libReaderTextView">文本</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libReaderNativeView">原貌</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libReaderZoomOut">A-</button>
          <span id="libReaderFontStat" class="muted library-reader-font-stat">15px</span>
          <button type="button" class="btn btn-secondary btn-sm" id="libReaderZoomIn">A+</button>
          <select class="inp" id="libReaderWidth">
            <option value="comfortable">舒适</option>
            <option value="wide">宽屏</option>
            <option value="full">铺满</option>
          </select>
          <button type="button" class="btn btn-secondary btn-sm" id="libReaderTop">顶部</button>
          <div id="libMainKwWrap" class="library-reader-searchwrap">
            <input class="inp" id="libMainKw" style="flex:1;min-width:0" placeholder="关键词搜索" />
          <div id="libMainHitNav" class="hidden kwHitNav">
            <span id="libMainHitCount" class="kwHitCount">0/0</span>
            <button type="button" class="kwHitBtn" id="libMainHitPrev" title="上一个 (Shift+Enter)" aria-label="上一个">↑</button>
            <button type="button" class="kwHitBtn" id="libMainHitNext" title="下一个 (Enter)" aria-label="下一个">↓</button>
            <button type="button" class="kwHitBtn kwHitBtnClose" id="libMainHitClose" title="清除搜索" aria-label="清除">×</button>
          </div>
        </div>
          <button type="button" class="btn btn-primary btn-sm" id="libMainSearch">搜索</button>
          <span id="libMainStat" class="muted library-reader-stat"></span>
          <span class="muted" id="libMainEditStatus"></span>
        </div>
      </div>
      <div id="libMainDebug" class="muted" style="font-size:0.72rem;margin-top:4px;opacity:0.85"></div>
      <div id="libMainHitList" class="preview-box hidden" style="margin-top:8px;padding:8px;max-height:120px;overflow:auto"></div>
      <div id="libMainNativeWrap" class="preview-box hidden" style="display:none;margin-top:10px;min-height:calc(100vh - 355px);max-height:calc(100vh - 355px);overflow:auto;padding:10px"></div>
      <div id="libMainArticle" class="preview-box" style="margin-top:10px;min-height:calc(100vh - 355px);max-height:calc(100vh - 355px);overflow:auto;padding:18px 20px;line-height:1.9;font-size:15px"></div>
      <textarea id="libMainTextEditor" class="inp hidden" spellcheck="false" style="display:none;margin-top:10px;min-height:calc(100vh - 355px);max-height:calc(100vh - 355px);resize:none;font-family:Consolas,Menlo,monospace;line-height:1.75"></textarea>
      <div style="position:sticky;bottom:12px;display:flex;justify-content:flex-end;gap:8px;z-index:8">
        <button type="button" class="btn btn-secondary btn-sm" id="libMainPrevFloat" style="box-shadow:0 10px 24px rgba(2,6,23,0.35)">上一个</button>
        <button type="button" class="btn btn-primary btn-sm" id="libMainNextFloat" style="box-shadow:0 10px 24px rgba(2,6,23,0.35)">下一个</button>
      </div>
      <details style="margin-top:12px">
        <summary class="muted" style="cursor:pointer">标注与记忆（分类、优先级、备注）</summary>
        <div style="margin-top:8px">
          <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
            <label class="muted" style="font-size:0.75rem">标签</label>
            <input class="inp" id="libMainTags" style="max-width:280px" placeholder="多个标签用逗号分隔" />
            <label class="muted" style="font-size:0.75rem">分类</label>
            <select class="inp" id="libMainCategory" style="max-width:160px">
            <option value="">未分类</option><option value="项目">项目</option><option value="财务">财务</option><option value="合同">合同</option>
              <option value="研究">研究</option><option value="法务">法务</option><option value="运营">运营</option><option value="聊天记录">聊天记录</option><option value="客户沟通">客户沟通</option><option value="会议纪要">会议纪要</option><option value="其他">其他</option>
            </select>
            <label class="muted" style="font-size:0.75rem">优先级</label>
            <select class="inp" id="libMainPriority" style="max-width:120px">
              <option value="">未设置</option><option value="高">高</option><option value="中">中</option><option value="低">低</option>
            </select>
          </div>
          <textarea class="inp" id="libMainNote" rows="3" style="margin-top:8px" placeholder="标注/备注：你的分析、风险、结论、待办等"></textarea>
          <textarea class="inp" id="libMainMemory" rows="2" style="margin-top:8px" placeholder="记忆：这个文件的长期关键信息（检索时可命中）"></textarea>
        </div>
      </details>
    </div>
    <div class="split-2" id="libSplit">
      <div>
        <div class="table-wrap" id="libTableWrap">
          <table class="data-table" id="libTable">
            <thead><tr><th style="width:40px"><input type="checkbox" id="libCheckAll" /></th><th style="width:64px">${p.favToggle || ""}</th><th>${p.thFile || ""}</th><th style="width:120px">${p.thSize || ""}</th><th style="width:190px">${p.thUploaded || ""}</th><th style="width:120px">${p.thAction || "操作"}</th></tr></thead>
            <tbody id="libTbody"></tbody>
          </table>
        </div>
        <div id="libCards" class="hidden" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px"></div>
        <div id="libEmpty"></div>
      </div>
      <div class="card" id="libDetail" style="display:none">
        <h3>${p.detailTitle || ""}</h3>
        <div id="libDetailMeta" class="muted" style="font-size:0.82rem;line-height:1.5;margin-bottom:10px"></div>
        <p id="libSummary" class="muted" style="font-size:0.86rem;line-height:1.55"></p>
        <div id="libFileBrain" class="lib-brain-panel"></div>
        <div class="row" style="margin-bottom:10px;flex-wrap:wrap">
          <button type="button" class="btn btn-secondary btn-sm" id="libOpenOs">${p.openOs || ""}</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libOpenInApp">${p.openInApp || "项目内打开"}</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libCopyContent">${p.copyContent || "复制全文"}</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libReparse">${p.reparse || ""}</button>
          <button type="button" class="btn btn-danger btn-sm" id="libDelOne">${p.deleteOne || ""}</button>
        </div>
        <label class="muted" style="font-size:0.75rem">${p.tagsLabel || ""}</label>
        <input class="inp" id="libTags" placeholder="${escAttr(p.tagsPlaceholder)}" />
        <div class="row" style="margin-top:8px;gap:8px;align-items:center;flex-wrap:wrap">
          <label class="muted" style="font-size:0.75rem;min-width:56px">分类</label>
          <select class="inp" id="libCategory" style="max-width:220px">
            <option value="">未分类</option>
            <option value="项目">项目</option>
            <option value="财务">财务</option>
            <option value="合同">合同</option>
            <option value="研究">研究</option>
            <option value="法务">法务</option>
            <option value="运营">运营</option>
            <option value="聊天记录">聊天记录</option>
            <option value="客户沟通">客户沟通</option>
            <option value="会议纪要">会议纪要</option>
            <option value="其他">其他</option>
          </select>
          <label class="muted" style="font-size:0.75rem;min-width:56px">优先级</label>
          <select class="inp" id="libPriority" style="max-width:160px">
            <option value="">未设置</option>
            <option value="高">高</option>
            <option value="中">中</option>
            <option value="低">低</option>
          </select>
        </div>
        <label class="muted" style="font-size:0.75rem;margin-top:8px;display:block">标注 / 备注</label>
        <textarea class="inp" id="libNote" rows="3" placeholder="记录你的判断、风险、结论、待办等"></textarea>
        <label class="muted" style="font-size:0.75rem;margin-top:8px;display:block">记忆笔记（持久学习要点）</label>
        <textarea class="inp" id="libMemory" rows="2" placeholder="读完这份文件后想长期记住的要点（可在阅读器内同步）"></textarea>
        <button type="button" class="btn btn-primary btn-sm" style="margin-top:8px" id="libSaveMeta">保存标签与标注</button>
        <div id="libKeywordInsight" class="preview-box muted" style="font-size:0.78rem;line-height:1.5;margin-top:10px"></div>
        <h3 style="margin-top:14px;font-size:0.95rem">${p.readerTitle || "项目内阅读器"}</h3>
        <p class="muted" style="font-size:0.75rem;margin:4px 0 8px">${p.readerHint || ""}</p>
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
          <input class="inp" id="libReaderKw" style="max-width:220px" placeholder="阅读器关键词…" />
          <button type="button" class="btn btn-secondary btn-sm" id="libReaderPrev">上一个</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libReaderNext">下一个</button>
          <span id="libReaderStat" class="muted" style="font-size:0.74rem"></span>
        </div>
        <textarea class="inp" id="libReaderBody" rows="10" readonly style="margin-top:8px;font-family:Consolas,monospace"></textarea>
        <h3 style="margin-top:16px">${p.contentPreview || ""}</h3>
        <div id="libPreviewArea"></div>
        <h3 style="margin-top:12px;font-size:0.95rem">${p.mdPreview || ""}</h3>
        <div id="libMdPreview" class="preview-box muted" style="font-size:0.82rem;max-height:220px;overflow:auto"></div>
      </div>
      <div class="card lib-detail-placeholder" id="libDetailEmpty">
        <div class="lib-detail-empty-kicker">文件详情</div>
        <h3>选择左侧文件</h3>
        <p class="muted">单击文件查看详情、标签和智能判断；双击直接进入阅读器。</p>
        <div class="lib-detail-empty-actions">
          <button type="button" class="btn btn-primary btn-sm" id="libEmptyUpload">上传文件</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libEmptyChat">粘贴聊天记录</button>
        </div>
      </div>
    </div>
  `)
  );

  const tbody = root.querySelector("#libTbody");
  const cardsHost = root.querySelector("#libCards");
  const tableWrap = root.querySelector("#libTableWrap");
  const splitWrap = root.querySelector("#libSplit");
  const mainReader = root.querySelector("#libMainReader");
  const topToolbar = root.querySelector(".toolbar");
  const toolsDrawer = root.querySelector("#libToolsDrawer");
  const vaultStats = root.querySelector("#libVaultStats");
  const emptyHost = root.querySelector("#libEmpty");
  const detail = root.querySelector("#libDetail");
  const detailEmpty = root.querySelector("#libDetailEmpty");
  const previewArea = root.querySelector("#libPreviewArea");
  const mdPreview = root.querySelector("#libMdPreview");
  const keywordInsight = root.querySelector("#libKeywordInsight");
  const readerBody = root.querySelector("#libReaderBody");
  const readerKw = root.querySelector("#libReaderKw");
  const readerStat = root.querySelector("#libReaderStat");
  const search = root.querySelector("#libSearch");
  const searchStatus = root.querySelector("#libSearchStatus");
  const filter = root.querySelector("#libFilter");
  const sortSel = root.querySelector("#libSort");
  const onlyFav = root.querySelector("#libOnlyFav");
  const viewSel = root.querySelector("#libView");
  const pageSizeSel = root.querySelector("#libPageSize");
  const pageInfo = root.querySelector("#libPageInfo");
  const pagePrev = root.querySelector("#libPagePrev");
  const pageNext = root.querySelector("#libPageNext");
  const fileInput = root.querySelector("#libFileInput");
  const dropZone = root.querySelector("#libDrop");
  const mainNativeWrap = root.querySelector("#libMainNativeWrap");
  const mainArticle = root.querySelector("#libMainArticle");
  const mainKw = root.querySelector("#libMainKw");
  const mainStat = root.querySelector("#libMainStat");
  const mainDebug = root.querySelector("#libMainDebug");
  const mainHitList = root.querySelector("#libMainHitList");
  const mainTextEditor = root.querySelector("#libMainTextEditor");
  const mainEditStatus = root.querySelector("#libMainEditStatus");
  const readerFontStat = root.querySelector("#libReaderFontStat");
  const readerWidth = root.querySelector("#libReaderWidth");
  const qaScope = root.querySelector("#libQaScope");
  const qaQuestion = root.querySelector("#libQaQuestion");
  const qaAnswer = root.querySelector("#libQaAnswer");
  const qaMeta = root.querySelector("#libQaMeta");
  const qaStatus = root.querySelector("#libQaStatus");
  const qaEvidence = root.querySelector("#libQaEvidence");
  const mapTypes = root.querySelector("#libMapTypes");
  const mapEntities = root.querySelector("#libMapEntities");
  const mapDates = root.querySelector("#libMapDates");
  const mapMoney = root.querySelector("#libMapMoney");
  const mapRisks = root.querySelector("#libMapRisks");
  const mapStatus = root.querySelector("#libMapStatus");

  /** @type {any[]} */
  let items = [];
  /** @type {string | null} */
  let selectedId = null;
  /** @type {boolean} */
  let loadFailed = false;
  /** @type {any | null} */
  let mainCurrentRecord = null;
  let readerFontSize = 16;
  let readerWidthMode = "wide";
  try {
    readerFontSize = Number(localStorage.getItem("cangjingge.library.readerFont") || "16") || 16;
    readerWidthMode = localStorage.getItem("cangjingge.library.readerWidth") || "wide";
  } catch {
    // ignore
  }
  readerFontSize = Math.max(13, Math.min(28, readerFontSize));
  if (!["comfortable", "wide", "full"].includes(readerWidthMode)) readerWidthMode = "wide";
  if (readerWidth) readerWidth.value = readerWidthMode;

  // 删除撤销控制器：先从 IDB 移除（视觉上消失），15s 后再真正调用 IPC 落盘删除；用户可一键撤销。
  const undoMgr = createUndoController({
    bar: root.querySelector("#libUndoBar"),
    msg: root.querySelector("#libUndoMsg"),
    timer: root.querySelector("#libUndoTimer"),
    undoBtn: root.querySelector("#libUndoBtn"),
    closeBtn: root.querySelector("#libUndoClose"),
    defaultSeconds: 15,
    onSuccess: (n) => {
      ctx.toast(`已撤销，恢复 ${n} 个文件`);
      ctx.emitLibraryChanged();
      void reload();
    },
    onError: (e) => ctx.toast(e?.message || "操作失败", true),
  });

  /**
   * 从 IDB 删除一组记录，并注册撤销条；倒计时结束才真正调用 IPC 落盘删除。
   * @param {any[]} records
   * @param {string} label
   */
  async function softDeleteFiles(records, label) {
    if (!records?.length) return;
    const snapshots = records.map((r) => ({ ...r }));
    for (const r of snapshots) {
      try {
        await idb.deleteFile(r.id);
      } catch {
        // ignore
      }
    }
    undoMgr.register({
      records: snapshots,
      label,
      restore: async (recs) => {
        for (const r of recs) {
          await idb.putFile(r);
        }
      },
      onExpire: async (recs) => {
        for (const r of recs) {
          try {
            await ctx.ipc.libraryDelete({ id: r.id });
          } catch {
            // ignore
          }
        }
      },
    });
    ctx.emitLibraryChanged();
  }
  let inMainReader = false;
  let readerMatches = [];
  let readerMatchIdx = -1;
  let mainMatches = [];
  let mainMatchIdx = -1;
  let mainBaseText = "";
  let mainPreviewKind = "text";
  let readerChromeCollapsed = false;
  let mainEditMode = false;
  let mainEditOriginalText = "";
  let lastReadSaveAt = 0;
  let activeSearchQuery = "";
  let searchDebounceTimer = 0;
  let mainSearchDebounceTimer = 0;
  let reloadTimer = 0;
  let reloadInFlight = null;
  let reloadAgainAfterCurrent = false;
  let visibleLoading = false;
  let lastRenderSerial = 0;
  let reloadSerial = 0;
  let listPageIndex = 0;
  /** @type {Map<string, { hay: string, title: string, preview: string }>} */
  let searchIndex = new Map();
  /** @type {HTMLElement[]} */
  let libHitTargets = [];
  /** @type {{ question: string, answer: string, records: any[], scope: string } | null} */
  let lastQa = null;

  function extOf(rec) {
    return String(rec.ext || "").toLowerCase();
  }

  const EDITABLE_TEXT_EXTS = new Set([".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".log"]);

  function canEditTextFile(rec) {
    return EDITABLE_TEXT_EXTS.has(extOf(rec));
  }

  function normalizeQuery(s) {
    return String(s || "").trim().toLowerCase();
  }

  function splitQueryTerms(s) {
    return normalizeQuery(s).split(/\s+/).filter(Boolean).slice(0, 8);
  }

  function searchableText(rec) {
    return [
      rec.fileName || "",
      rec.preview || "",
      rec.content || "",
      Array.isArray(rec.tags) ? rec.tags.join(" ") : "",
      rec.category || "",
      rec.priority || "",
      rec.annotationNote || "",
      rec.memoryNote || "",
    ]
      .join("\n")
      .toLowerCase();
  }

  function buildSearchIndex() {
    searchIndex = new Map();
    for (const rec of items) {
      const content = String(rec.content || "");
      const clipped = content.length > 500_000 ? content.slice(0, 500_000) : content;
      const hay = [
        rec.fileName || "",
        rec.preview || "",
        clipped,
        Array.isArray(rec.tags) ? rec.tags.join(" ") : "",
        rec.category || "",
        rec.priority || "",
        rec.annotationNote || "",
        rec.memoryNote || "",
      ]
        .join("\n")
        .toLowerCase();
      searchIndex.set(rec.id, {
        hay,
        title: String(rec.fileName || "").toLowerCase(),
        preview: String(rec.preview || clipped.slice(0, 1000)).toLowerCase(),
      });
    }
  }

  function searchEntry(rec) {
    return searchIndex.get(rec.id) || { hay: searchableText(rec), title: String(rec.fileName || "").toLowerCase(), preview: "" };
  }

  function recordMatchesSearch(rec, terms = splitQueryTerms(activeSearchQuery)) {
    if (!terms.length) return true;
    const entry = searchEntry(rec);
    return terms.every((t) => entry.hay.includes(t));
  }

  function recordSearchScore(rec, terms = splitQueryTerms(activeSearchQuery)) {
    if (!terms.length) return 0;
    const entry = searchEntry(rec);
    let score = 0;
    for (const t of terms) {
      score += keywordHits(entry.title, t) * 80;
      score += keywordHits(entry.preview, t) * 12;
      score += Math.min(80, keywordHits(entry.hay, t));
    }
    return score;
  }

  function updateSearchStatus(text) {
    if (!searchStatus) return;
    searchStatus.textContent = text || "输入关键词搜索";
  }

  function setLibraryLoading(active, message = "") {
    if (!splitWrap) return;
    const next = Boolean(active);
    if (visibleLoading === next && (!next || splitWrap.getAttribute("data-loading-message") === message)) return;
    visibleLoading = next;
    splitWrap.classList.toggle("library-loading", next);
    if (active) {
      splitWrap.setAttribute("data-loading-message", message || p.loadingLabel || "加载文件库…");
      updateSearchStatus(message || "正在加载文件库…");
    } else {
      splitWrap.removeAttribute("data-loading-message");
    }
  }

  function keywordHits(text, q) {
    if (!q) return 0;
    let n = 0;
    let idx = 0;
    while (idx >= 0) {
      idx = text.indexOf(q, idx);
      if (idx < 0) break;
      n += 1;
      idx += q.length || 1;
    }
    return n;
  }

  function keywordSnippets(text, q, max = 3) {
    if (!q) return [];
    const out = [];
    let idx = text.indexOf(q);
    while (idx >= 0 && out.length < max) {
      const s = Math.max(0, idx - 26);
      const e = Math.min(text.length, idx + q.length + 26);
      out.push(text.slice(s, e).replace(/\s+/g, " "));
      idx = text.indexOf(q, idx + q.length);
    }
    return out;
  }

  function qaEvidenceTerms(question) {
    const raw = String(question || "").toLowerCase();
    const terms = new Set(splitQueryTerms(raw));
    [
      "客户",
      "风险",
      "承诺",
      "价格",
      "报价",
      "合同",
      "利润",
      "收入",
      "成本",
      "黄金",
      "btc",
      "比特币",
      "项目",
      "进度",
      "负责人",
      "时间",
      "行动",
      "问题",
      "需求",
      "情绪",
      "财务",
      "预算",
      "交付",
      "下一步",
    ].forEach((k) => {
      if (raw.includes(k.toLowerCase())) terms.add(k.toLowerCase());
    });
    (raw.match(/[\u4e00-\u9fa5]{2,}/g) || []).forEach((chunk) => {
      if (chunk.length <= 8) terms.add(chunk);
      else {
        for (let i = 0; i < chunk.length - 1 && terms.size < 14; i += 2) {
          terms.add(chunk.slice(i, Math.min(chunk.length, i + 4)));
        }
      }
    });
    return [...terms].filter((t) => t.length >= 2).slice(0, 14);
  }

  function evidenceSnippetsForRecord(rec, question, max = 2) {
    const text = String(rec.content || rec.preview || "");
    if (!text) return [];
    const lower = text.toLowerCase();
    const hits = [];
    for (const term of qaEvidenceTerms(question)) {
      const idx = lower.indexOf(term.toLowerCase());
      if (idx < 0) continue;
      const start = Math.max(0, idx - 72);
      const end = Math.min(text.length, idx + term.length + 110);
      const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
      if (snippet && !hits.some((h) => h.snippet === snippet)) hits.push({ term, snippet, pos: idx });
      if (hits.length >= max) break;
    }
    if (!hits.length) {
      const fallback = summaryLine(rec);
      if (fallback && fallback !== "—") hits.push({ term: "", snippet: fallback.slice(0, 220), pos: 0 });
    }
    return hits;
  }

  function renderQaEvidence(records, question) {
    if (!qaEvidence) return;
    const rows = [];
    records.slice(0, 18).forEach((rec) => {
      evidenceSnippetsForRecord(rec, question, 2).forEach((hit) => rows.push({ rec, ...hit }));
    });
    if (!rows.length) {
      qaEvidence.classList.add("hidden");
      qaEvidence.style.display = "none";
      qaEvidence.innerHTML = "";
      return;
    }
    qaEvidence.classList.remove("hidden");
    qaEvidence.style.display = "block";
    qaEvidence.innerHTML = `
      <div class="library-qa-evidence-head">
        <strong>证据来源</strong>
        <span class="muted">${rows.length} 条可跳转片段 · 点击打开原文定位</span>
      </div>
      <div class="library-qa-evidence-list">
        ${rows
          .map((row, idx) => {
            const kws = row.term ? [row.term] : qaEvidenceTerms(question).slice(0, 3);
            return `
              <button type="button" class="library-qa-evidence-item" data-idx="${idx}">
                <span class="library-qa-evidence-file">${escHtmlOuter(row.rec.fileName || row.rec.id)}</span>
                <span class="library-qa-evidence-snippet">${highlightHtmlOuter(row.snippet, kws)}</span>
              </button>`;
          })
          .join("")}
      </div>
    `;
    qaEvidence.querySelectorAll("[data-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = rows[Number(btn.getAttribute("data-idx")) || 0];
        if (!row?.rec) return;
        openInAppByRecord(row.rec);
        const kw = row.term || qaEvidenceTerms(question)[0] || "";
        if (kw && mainKw) {
          mainKw.value = kw;
          window.setTimeout(() => {
            searchAndJumpMain();
            updateMainHitNavUi();
          }, 80);
        }
      });
    });
  }

  function matchesFilter(rec) {
    const terms = splitQueryTerms(activeSearchQuery);
    if (terms.length && !recordMatchesSearch(rec, terms)) return false;
    if (onlyFav.checked && !rec.favorite) return false;
    const f = filter.value;
    if (!f) return true;
    if (f === "image") return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(extOf(rec));
    return extOf(rec) === f;
  }

  function checkedFileIds() {
    return Array.from(root.querySelectorAll(".lib-cb:checked"))
      .map((c) => c.getAttribute("data-id"))
      .filter(Boolean);
  }

  function updateVaultStats(currentCount = null) {
    if (!vaultStats) return;
    const total = items.length;
    const filteredCount = Number.isFinite(currentCount) ? Number(currentCount) : items.filter(matchesFilter).length;
    const checked = root.querySelectorAll(".lib-cb:checked").length;
    const favs = items.filter((x) => x.favorite).length;
    const categories = new Set(items.map((x) => x.category || inferLibraryCategory(x)).filter(Boolean));
    vaultStats.innerHTML = `
      <span><b>${total.toLocaleString()}</b> 全部文件</span>
      <span><b>${filteredCount.toLocaleString()}</b> 当前结果</span>
      <span><b>${checked.toLocaleString()}</b> 已选择</span>
      <span><b>${favs.toLocaleString()}</b> 收藏</span>
      <span><b>${categories.size.toLocaleString()}</b> 分类</span>
    `;
  }

  function recordsByIds(ids) {
    const set = new Set(ids);
    return items.filter((x) => set.has(x.id));
  }

  function filteredRecordsForQuestion() {
    const list = items.filter(matchesFilter);
    const q = normalizeQuery(activeSearchQuery);
    if (q) {
      const terms = splitQueryTerms(q);
      return [...list].sort((a, b) => recordSearchScore(b, terms) - recordSearchScore(a, terms));
    }
    return list;
  }

  function recordsForQaScope(scopeRaw) {
    const scope = String(scopeRaw || "smart");
    const checked = recordsByIds(checkedFileIds());
    if (scope === "checked") return checked;
    if (scope === "current") return selectedRec() ? [selectedRec()] : [];
    if (scope === "search") return filteredRecordsForQuestion();
    if (scope === "all") return [...items].sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    if (checked.length) return checked;
    if (selectedRec()) return [selectedRec()];
    const q = normalizeQuery(activeSearchQuery);
    if (q) return filteredRecordsForQuestion();
    return [...items].sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0)).slice(0, 8);
  }

  function buildQaContext(records, question) {
    const maxFiles = 18;
    const maxTotal = 180_000;
    const selected = records.slice(0, maxFiles);
    let used = 0;
    const parts = selected.map((rec, idx) => {
      const meta = [
        `文件名：${rec.fileName || rec.id}`,
        `扩展名：${extOf(rec) || "未知"}`,
        rec.category ? `分类：${rec.category}` : "",
        Array.isArray(rec.tags) && rec.tags.length ? `标签：${rec.tags.join("、")}` : "",
        rec.priority ? `优先级：${rec.priority}` : "",
        rec.annotationNote ? `标注：${rec.annotationNote}` : "",
        rec.memoryNote ? `记忆：${rec.memoryNote}` : "",
      ].filter(Boolean);
      const source = String(rec.content || rec.preview || "").trim() || "（无正文，仅有文件元数据）";
      const budget = Math.max(2400, Math.floor((maxTotal - used) / Math.max(1, selected.length - idx)));
      const clipped = source.slice(0, budget);
      used += clipped.length;
      return [`## 资料 ${idx + 1}`, meta.join("\n"), "", clipped].join("\n");
    });
    return [
      `# 文件库问答上下文`,
      `问题：${question}`,
      `范围：${selected.length} 个文件${records.length > selected.length ? `（已从 ${records.length} 个候选中截取前 ${selected.length} 个）` : ""}`,
      "",
      parts.join("\n\n---\n\n"),
    ].join("\n");
  }

  function qaScopeLabel(scope, count) {
    const map = {
      smart: "智能范围",
      checked: "勾选文件",
      current: "当前文件",
      search: "搜索结果",
      all: "全部文件",
    };
    return `${map[scope] || "智能范围"} · ${count} 个文件`;
  }

  function updateQaMeta() {
    const scope = qaScope?.value || "smart";
    const records = recordsForQaScope(scope);
    if (qaMeta) qaMeta.textContent = qaScopeLabel(scope, records.length);
  }

  async function runLibraryQa() {
    const question = String(qaQuestion?.value || "").trim();
    if (!question) {
      ctx.toast("请先输入要问资料库的问题", true);
      qaQuestion?.focus();
      return;
    }
    const scope = qaScope?.value || "smart";
    const records = recordsForQaScope(scope);
    if (!records.length) {
      ctx.toast("当前范围没有可问的文件", true);
      return;
    }
    if (qaStatus) qaStatus.textContent = "正在读取资料并生成答案…";
    if (qaAnswer) qaAnswer.value = "";
    if (qaEvidence) {
      qaEvidence.classList.add("hidden");
      qaEvidence.style.display = "none";
      qaEvidence.innerHTML = "";
    }
    try {
      const documentText = buildQaContext(records, question);
      const fileNames = records.slice(0, 18).map((r) => r.fileName || r.id);
      const prompt = [
        "请作为本地文件库知识助手回答用户问题。",
        "要求：",
        "1. 先给直接答案，不要绕弯。",
        "2. 必须列出证据文件名；如果证据不足，要明确说缺什么。",
        "3. 对聊天记录要提炼人物/诉求/承诺/风险/下一步话术。",
        "4. 对表格或数字要优先结构化。",
        "5. 最后给行动清单。",
        "",
        `用户问题：${question}`,
      ].join("\n");
      const res = await ctx.runAnalysis({
        mode: "summary",
        depth: "deep",
        userInstruction: prompt,
        documentText,
        model: ctx.getModel(),
        fileNames,
      });
      const answer = String(res.mainReport || res.summary || "").trim();
      if (qaAnswer) qaAnswer.value = answer;
      lastQa = { question, answer, records: records.slice(0, 18), scope };
      renderQaEvidence(records.slice(0, 18), question);
      if (qaStatus) qaStatus.textContent = `已回答 · ${qaScopeLabel(scope, records.length)}`;
      ctx.toast("资料库问答完成");
    } catch (e) {
      if (qaStatus) qaStatus.textContent = "问答失败";
      ctx.toast(e?.message || "问答失败", true);
    }
  }

  function inferAutoTags(rec) {
    const tags = new Set();
    const ex = extOf(rec);
    if ([".pdf", ".doc", ".docx"].includes(ex)) tags.add("文档");
    if ([".xlsx", ".xls", ".csv"].includes(ex)) tags.add("表格");
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ex)) tags.add("图像");
    const snip = String(rec.content || "").slice(0, 6000);
    if (/合同|协议|甲方|乙方|条款/.test(snip)) tags.add("合同");
    if (/收入|利润|现金流|万元|亿元|¥|￥/.test(snip)) tags.add("财务");
    if (/项目|里程碑|交付|验收/.test(snip)) tags.add("项目");
    if (/风险|合规|审计/.test(snip)) tags.add("风险合规");
    if (/微信|飞书|钉钉|聊天记录|客户|客服|群聊|私聊|AM|PM|\d{1,2}:\d{2}/i.test(snip)) tags.add("聊天记录");
    return [...tags].slice(0, 8);
  }

  function summaryLine(rec) {
    return String(rec.preview || (rec.content || "").slice(0, 160) || "—").replace(/\s+/g, " ");
  }

  function splitSentences(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .split(/(?<=[。！？!?；;])\s*|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 12)
      .slice(0, 80);
  }

  function buildFileIntelligence(rec) {
    const text = String(rec?.content || rec?.preview || "");
    const sentences = splitSentences(text);
    const autoTags = inferAutoTags(rec);
    const hay = `${rec?.fileName || ""} ${text.slice(0, 12000)}`;
    const isContract = /合同|协议|甲方|乙方|违约|争议解决|条款/.test(hay);
    const isFinance = /收入|利润|现金流|预算|成本|毛利|EBITDA|万元|亿元|¥|￥/.test(hay);
    const isProject = /项目|里程碑|进度|交付|验收|负责人|截止|风险/.test(hay);
    const isMarket = /市场|客户|竞品|渠道|增长|规模|份额|用户/.test(hay);
    const isChat = /微信|飞书|钉钉|聊天记录|群聊|私聊|客服|客户|AM|PM|\d{1,2}:\d{2}/i.test(hay);
    const genType = isContract
      ? "contract_risk"
      : isFinance
        ? "fin_analysis"
        : isMarket
          ? "market_deep"
          : isChat
            ? "minutes"
            : isProject
            ? "project_tracker"
            : "project_plan";
    const analysisMode = isContract
      ? "contract"
      : isFinance
        ? "finance"
        : isMarket
        ? "market"
        : isChat
          ? "summary"
          : isProject
            ? "ops"
            : "summary";
    const profile = isContract
      ? "合同/协议类资料"
      : isFinance
        ? "财务/预算类资料"
        : isMarket
        ? "市场/客户类资料"
        : isChat
          ? "聊天/沟通记录"
          : isProject
            ? "项目/运营类资料"
            : "通用业务资料";
    const signals = [
      rec?.charCount ? `约 ${Number(rec.charCount).toLocaleString()} 字` : "",
      autoTags.length ? `自动识别：${autoTags.slice(0, 4).join("、")}` : "",
      rec?.category ? `分类：${rec.category}` : "",
      rec?.priority ? `优先级：${rec.priority}` : "",
    ].filter(Boolean);
    const picks = sentences
      .filter((s) => /风险|目标|结论|收入|利润|交付|客户|合同|计划|预算|增长|问题|建议/.test(s))
      .concat(sentences)
      .slice(0, 3);
    return {
      profile,
      genType,
      analysisMode,
      signals,
      picks,
      prompt: [
        `请基于文件「${rec?.fileName || "当前资料"}」生成一份专业交付稿。`,
        `资料类型判断：${profile}。`,
        "请先提炼核心结论，再输出关键表格、风险清单、下一步动作；必要时补充待确认问题。",
      ].join("\n"),
    };
  }

  function countSignal(map, key, weight = 1) {
    const safe = String(key || "").trim().replace(/\s+/g, " ");
    if (!safe || safe.length < 2 || safe.length > 32) return;
    map.set(safe, (map.get(safe) || 0) + weight);
  }

  function topSignals(map, limit = 10) {
    return [...map.entries()]
      .filter(([label]) => label && !/^(undefined|null|false|true)$/i.test(label))
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "zh-CN"))
      .slice(0, limit);
  }

  function inferLibraryCategory(rec) {
    const hay = `${rec?.fileName || ""}\n${rec?.category || ""}\n${rec?.preview || ""}\n${String(rec?.content || "").slice(0, 14000)}`;
    const ex = extOf(rec);
    if (/聊天记录|客户沟通|微信|飞书|钉钉|客服|群聊|私聊|\d{1,2}:\d{2}/i.test(hay)) return "聊天记录";
    if (/合同|协议|甲方|乙方|违约|条款|法务|争议解决/.test(hay)) return "合同";
    if (/收入|利润|现金流|预算|成本|报价|发票|财务|万元|亿元|¥|￥|\$/.test(hay)) return "财务";
    if (/会议|纪要|待办|行动项|复盘/.test(hay)) return "会议纪要";
    if (/市场|客户|竞品|增长|渠道|用户|转化|品牌/.test(hay)) return "研究";
    if (/项目|里程碑|交付|验收|负责人|进度|排期/.test(hay)) return "项目";
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ex)) return "研究";
    return "其他";
  }

  function mapTextForRecord(rec, limit = 36000) {
    return [
      rec?.fileName || "",
      rec?.category || "",
      Array.isArray(rec?.tags) ? rec.tags.join(" ") : "",
      rec?.preview || "",
      String(rec?.content || "").slice(0, limit),
      rec?.annotationNote || "",
      rec?.memoryNote || "",
    ].join("\n");
  }

  function buildLibraryMap(records) {
    const types = new Map();
    const entities = new Map();
    const dates = new Map();
    const money = new Map();
    const risks = new Map();
    const riskWords = [
      "风险",
      "合规",
      "违约",
      "投诉",
      "逾期",
      "亏损",
      "异常",
      "争议",
      "审计",
      "担保",
      "冻结",
      "失败",
      "问题",
      "缺口",
      "不确定",
      "待确认",
    ];
    const commonStop = new Set([
      "这个",
      "我们",
      "你们",
      "他们",
      "因为",
      "所以",
      "如果",
      "但是",
      "可以",
      "没有",
      "文件",
      "资料",
      "项目",
      "客户",
      "聊天记录",
    ]);
    for (const rec of records) {
      const category = rec?.category || inferLibraryCategory(rec);
      countSignal(types, category, 1);
      inferAutoTags(rec).forEach((tag) => countSignal(types, tag, 0.55));
      const text = mapTextForRecord(rec);
      const shortText = text.slice(0, 42000);
      const dateHits = shortText.match(/\b20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2}\b|\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b|\d{1,2}月\d{1,2}日/g) || [];
      dateHits.slice(0, 18).forEach((d) => countSignal(dates, d));
      const moneyHits = shortText.match(/[¥￥$]?\s?\d+(?:\.\d+)?\s?(?:万|万元|亿|亿元|元|美元|美金|BTC|btc|比特币|%)/g) || [];
      moneyHits.slice(0, 18).forEach((v) => countSignal(money, v.replace(/\s+/g, "")));
      riskWords.forEach((word) => {
        const hits = keywordHits(shortText, word);
        if (hits) countSignal(risks, word, Math.min(5, hits));
      });
      const roleHits = shortText.match(/(?:客户|用户|甲方|乙方|联系人|负责人|老板|老师|总监|经理|顾问|客服)[：:\s]*([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9·._-]{1,18})/g) || [];
      roleHits.slice(0, 12).forEach((hit) => {
        const clean = hit.replace(/^(客户|用户|甲方|乙方|联系人|负责人|老板|老师|总监|经理|顾问|客服)[：:\s]*/, "");
        if (!commonStop.has(clean)) countSignal(entities, clean);
      });
      const orgHits = shortText.match(/[\u4e00-\u9fa5]{2,12}(?:公司|集团|团队|平台|系统|产品|方案|合同|业务|案例)/g) || [];
      orgHits.slice(0, 12).forEach((hit) => {
        if (!commonStop.has(hit)) countSignal(entities, hit);
      });
      const assetHits = shortText.match(/\b(?:BTC|ETH|USDT|API|KPI|ROI|SOP|Excel|Word|PDF)\b|黄金|比特币|美元|日元|人民币/gi) || [];
      assetHits.slice(0, 16).forEach((hit) => countSignal(entities, String(hit).toUpperCase()));
    }
    return {
      types: topSignals(types, 12),
      entities: topSignals(entities, 12),
      dates: topSignals(dates, 10),
      money: topSignals(money, 10),
      risks: topSignals(risks, 10),
    };
  }

  function searchByMapChip(term) {
    const q = String(term || "").trim();
    if (!q) return;
    search.value = q;
    activeSearchQuery = activeSearchQuery === normalizeQuery(q) ? "" : activeSearchQuery;
    applySearchInput({ immediate: true });
    root.querySelector(".library-toolbar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderMapChipList(host, entries, emptyLabel) {
    if (!host) return;
    if (!entries.length) {
      host.innerHTML = `<span class="library-map-empty">${escHtml(emptyLabel || "暂无信号")}</span>`;
      return;
    }
    host.innerHTML = entries
      .map(
        ([label, count]) => `
          <button type="button" class="library-map-chip" data-map-term="${escAttr(label)}">
            <span>${escHtml(label)}</span>
            <b>${Number(count).toLocaleString(undefined, { maximumFractionDigits: 1 })}</b>
          </button>`
      )
      .join("");
    host.querySelectorAll("[data-map-term]").forEach((btn) => {
      btn.addEventListener("click", () => searchByMapChip(btn.getAttribute("data-map-term") || ""));
    });
  }

  function renderLibraryMap(sourceRecords = null) {
    const records = Array.isArray(sourceRecords) ? sourceRecords : items.filter(matchesFilter);
    const map = buildLibraryMap(records);
    renderMapChipList(mapTypes, map.types, "暂无分类");
    renderMapChipList(mapEntities, map.entities, "暂无对象");
    renderMapChipList(mapDates, map.dates, "暂无日期");
    renderMapChipList(mapMoney, map.money, "暂无金额");
    renderMapChipList(mapRisks, map.risks, "暂无风险");
    if (mapStatus) {
      const scope = normalizeQuery(activeSearchQuery) || filter.value || onlyFav.checked ? "当前筛选范围" : "全部资料";
      const totalSignals = map.types.length + map.entities.length + map.dates.length + map.money.length + map.risks.length;
      mapStatus.textContent = `${scope} · ${records.length} 个文件 · ${totalSignals} 类关键信号`;
    }
  }

  async function autoOrganizeCurrentScope() {
    const records = filteredRecordsForQuestion();
    if (!records.length) {
      ctx.toast("当前范围没有可整理的文件", true);
      return;
    }
    const cap = 800;
    const work = records.slice(0, cap);
    let changed = 0;
    for (const rec of work) {
      const autoTags = inferAutoTags(rec);
      const category = rec.category || inferLibraryCategory(rec);
      const text = mapTextForRecord(rec, 18000);
      const smartTags = new Set(Array.isArray(rec.tags) ? rec.tags : []);
      autoTags.forEach((tag) => smartTags.add(tag));
      if (category && category !== "其他") smartTags.add(category);
      if (/\b20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2}\b|\d{1,2}月\d{1,2}日/.test(text)) smartTags.add("含时间线");
      if (/[¥￥$]?\s?\d+(?:\.\d+)?\s?(?:万|万元|亿|亿元|元|美元|美金|BTC|btc|比特币|%)/.test(text)) smartTags.add("含金额资产");
      if (/风险|合规|违约|投诉|逾期|亏损|异常|争议|审计|担保|冻结|失败/.test(text)) smartTags.add("风险线索");
      const tags = [...smartTags].filter(Boolean).slice(0, 12);
      const priority = rec.priority || (/违约|投诉|逾期|亏损|冻结|失败|重大风险/.test(text) ? "高" : /风险|问题|待确认|异常|争议/.test(text) ? "中" : "");
      const patch = {};
      if (!rec.category && category) patch.category = category;
      if (JSON.stringify(tags) !== JSON.stringify(Array.isArray(rec.tags) ? rec.tags : [])) patch.tags = tags;
      if (!rec.priority && priority) patch.priority = priority;
      if (!Object.keys(patch).length) continue;
      await idb.patchFile(rec.id, patch);
      if (patch.tags) {
        try {
          await ctx.ipc.libraryUpdateTags({ id: rec.id, tags });
        } catch {
          // 本地索引已更新，磁盘标签同步失败不阻断整理。
        }
      }
      changed += 1;
    }
    ctx.emitLibraryChanged();
    await reload();
    ctx.toast(`已整理 ${changed} 个文件${records.length > cap ? `（本次处理前 ${cap} 个）` : ""}`);
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function selectedRec() {
    return selectedId ? items.find((x) => x.id === selectedId) || null : null;
  }

  function visibleFileTitle(rec) {
    return String(rec?.fileName || rec?.title || "未命名文件").trim() || "未命名文件";
  }

  function askFileTitleDialog(rec) {
    return new Promise((resolve) => {
      const current = visibleFileTitle(rec);
      const dlg = el(`
        <div class="phDialogBackdrop" role="dialog" aria-modal="true">
          <div class="phDialog">
            <h3>修改文件名称</h3>
            <input class="inp" id="libRenameInput" maxlength="180" value="${escAttr(current)}" placeholder="输入新的文件名称" />
            <div class="phDialogActions">
              <button type="button" class="btn btn-ghost btn-sm" id="libRenameCancel">取消</button>
              <button type="button" class="btn btn-primary btn-sm" id="libRenameOk">保存</button>
            </div>
          </div>
        </div>
      `);
      root.appendChild(dlg);
      const input = dlg.querySelector("#libRenameInput");
      const close = (value) => {
        dlg.remove();
        resolve(value);
      };
      dlg.querySelector("#libRenameCancel")?.addEventListener("click", () => close(null));
      dlg.querySelector("#libRenameOk")?.addEventListener("click", () => close(String(input.value || "")));
      dlg.addEventListener("click", (ev) => {
        if (ev.target === dlg) close(null);
      });
      input?.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") close(null);
        if (ev.key === "Enter") close(String(input.value || ""));
      });
      window.setTimeout(() => {
        input?.focus();
        input?.select();
      }, 0);
    });
  }

  async function applyFileTitle(rec, rawName, { refreshReader = false } = {}) {
    if (!rec) return null;
    const nextName = String(rawName || "").trim().replace(/[\\/]/g, "_").slice(0, 180);
    const oldName = visibleFileTitle(rec);
    if (!nextName || nextName === oldName) return { ...rec, fileName: oldName, title: oldName };
    const patch = { fileName: nextName, title: nextName, editedAt: Date.now() };
    await idb.patchFile(rec.id, patch);
    try {
      await ctx.ipc?.libraryUpdateMeta?.({ id: rec.id, patch });
    } catch {
      // 种子文件或旧记录可能没有主进程原文件，IDB 标题已保存。
    }
    const next = { ...rec, ...patch };
    if (selectedId === rec.id) mainCurrentRecord = next;
    await reload();
    if (refreshReader && selectedId === rec.id) {
      const fresh = items.find((x) => x.id === rec.id) || next;
      fillMainReader({ ...fresh, ...patch });
    }
    return next;
  }

  async function renameFileFromList(rec) {
    const next = await askFileTitleDialog(rec);
    if (next == null) return;
    try {
      const changed = await applyFileTitle(rec, next, { refreshReader: rec.id === selectedId });
      if (changed) ctx.toast("文件名已更新");
    } catch (e) {
      ctx.toast(e?.message || "改名失败", true);
    }
  }

  function canEditReadableContent(rec) {
    return Boolean(rec && typeof rec.content === "string");
  }

  function textStats(text) {
    const raw = String(text || "");
    return {
      charCount: raw.length,
      lineCount: raw ? raw.split(/\r?\n/).length : 0,
      preview: raw.replace(/\s+/g, " ").trim().slice(0, 600),
    };
  }

  async function saveMainTitle() {
    if (!selectedId) return;
    const input = root.querySelector("#libMainTitle");
    const rec = mainCurrentRecord || selectedRec();
    if (!input || !rec) return;
    const nextName = String(input.value || "").trim().replace(/[\\/]/g, "_").slice(0, 180);
    const oldName = visibleFileTitle(rec);
    if (!nextName || nextName === oldName) {
      input.value = oldName;
      return;
    }
    try {
      await applyFileTitle(rec, nextName, { refreshReader: true });
      ctx.toast("标题已更新");
    } catch (e) {
      input.value = oldName;
      ctx.toast(e?.message || "标题保存失败", true);
    }
  }

  function refreshReaderMatches() {
    const content = String(readerBody.value || "");
    const kw = String(readerKw.value || "").trim().toLowerCase();
    readerMatches = [];
    readerMatchIdx = -1;
    if (!kw || !content) {
      readerStat.textContent = "";
      return;
    }
    const low = content.toLowerCase();
    let i = low.indexOf(kw);
    while (i >= 0) {
      readerMatches.push(i);
      i = low.indexOf(kw, i + kw.length);
      if (readerMatches.length >= 3000) break;
    }
    readerStat.textContent = `命中 ${readerMatches.length} 处`;
  }

  function jumpReader(step = 1) {
    const kw = String(readerKw.value || "").trim();
    if (!kw) {
      readerStat.textContent = "请先输入关键词";
      return;
    }
    if (!readerMatches.length) {
      refreshReaderMatches();
      if (!readerMatches.length) {
        readerStat.textContent = "未命中";
        return;
      }
    }
    readerMatchIdx = (readerMatchIdx + step + readerMatches.length) % readerMatches.length;
    const pos = readerMatches[readerMatchIdx];
    readerBody.focus();
    readerBody.setSelectionRange(pos, pos + kw.length);
    const ratio = pos / Math.max(1, readerBody.value.length);
    readerBody.scrollTop = Math.max(0, (readerBody.scrollHeight - readerBody.clientHeight) * ratio - 40);
    readerStat.textContent = `命中 ${readerMatches.length} 处 · 第 ${readerMatchIdx + 1} 处`;
  }

  function showDetailLocal(rec) {
    if (!rec) return;
    detail.style.display = "block";
    if (detailEmpty) detailEmpty.style.display = "none";
    const auto = inferAutoTags(rec).join("、") || "—";
    root.querySelector("#libDetailMeta").textContent = `${rec.fileName}\n扩展名 ${extOf(rec) || "—"} · 字符 ${rec.charCount ?? "—"} · 行 ${rec.lineCount ?? "—"}\n分类 ${rec.category || "未分类"} · 优先级 ${rec.priority || "未设置"}\n${p.tagsAuto || ""}：${auto}`;
    root.querySelector("#libSummary").textContent = `${p.summaryPrefix || ""}${summaryLine(rec)}`;
    const brain = buildFileIntelligence(rec);
    const brainHost = root.querySelector("#libFileBrain");
    if (brainHost) {
      brainHost.innerHTML = `
        <div class="lib-brain-head">
          <span>文件智能判断</span>
          <b>${escHtml(brain.profile)}</b>
        </div>
        <div class="lib-brain-signals">
          ${(brain.signals.length ? brain.signals : ["暂无足够结构化信号"]).map((s) => `<span>${escHtml(s)}</span>`).join("")}
        </div>
        <div class="lib-brain-picks">
          ${brain.picks.length ? brain.picks.map((s, i) => `<p>${i + 1}. ${escHtml(s).slice(0, 180)}</p>`).join("") : "<p>内容较短或尚未解析，建议先重新解析后再生成。</p>"}
        </div>
        <div class="lib-brain-actions">
          <button type="button" class="btn btn-primary btn-sm" id="libBrainGen">用此文件生成交付稿</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libBrainAnalyze">深度分析此文件</button>
          <button type="button" class="btn btn-secondary btn-sm" id="libBrainTable">提取表格/行动清单</button>
        </div>
      `;
      brainHost.querySelector("#libBrainGen")?.addEventListener("click", () => {
        ctx.navigate("generator", {
          fileIds: [rec.id],
          genType: brain.genType,
          quickPrompt: brain.prompt,
          smartPack: brain.genType === "project_tracker" ? "table" : "boss",
        });
      });
      brainHost.querySelector("#libBrainAnalyze")?.addEventListener("click", () => {
        ctx.navigate("analysis", {
          fileIds: [rec.id],
          mode: brain.analysisMode,
          depth: "deep",
          quickPrompt: `请深度分析文件「${rec.fileName || "当前资料"}」，输出结论、证据、风险、机会和行动建议。`,
        });
      });
      brainHost.querySelector("#libBrainTable")?.addEventListener("click", () => {
        ctx.navigate("generator", {
          fileIds: [rec.id],
          genType: "project_tracker",
          smartPack: "table",
          quickPrompt: `请从文件「${rec.fileName || "当前资料"}」提取可执行表格：关键事项、负责人、时间、风险、下一步动作，并给出 Excel 可用 TSV。`,
        });
      });
    }
    root.querySelector("#libTags").value = Array.isArray(rec.tags) ? rec.tags.join(", ") : "";
    root.querySelector("#libCategory").value = rec.category || "";
    root.querySelector("#libPriority").value = rec.priority || "";
    root.querySelector("#libNote").value = rec.annotationNote || "";
    const memEl = root.querySelector("#libMemory");
    if (memEl) memEl.value = rec.memoryNote || "";
    readerBody.value = String(rec.content || "");
    refreshReaderMatches();
    previewArea.innerHTML = "";
    const pre = document.createElement("pre");
    pre.style.cssText = "white-space:pre-wrap;word-break:break-word;font-size:0.8rem;max-height:42vh;overflow:auto;margin:0";
    pre.textContent = String(rec.content || p.noTextBody || "").slice(0, 120_000);
    const box = el(`<div class="preview-box"></div>`);
    box.appendChild(pre);
    previewArea.appendChild(box);
    const md = rec.markdownPreview || "";
    mdPreview.textContent = md || p.mdPreviewEmpty || "";
    const q = search.value.trim().toLowerCase();
    if (q) {
      const text = searchableText(rec).slice(0, 150_000);
      const hits = keywordHits(text, q);
      const snippets = keywordSnippets(text, q, 4);
      keywordInsight.innerHTML = `<div>关键词「${q}」命中 <b>${hits}</b> 次</div>${
        snippets.length
          ? snippets.map((s, i) => `<div style="margin-top:4px">${i + 1}. …${s}…</div>`).join("")
          : `<div style="margin-top:4px">未命中上下文片段</div>`
      }`;
    } else {
      keywordInsight.textContent = "提示：在上方搜索框输入关键词后，这里会显示命中次数与上下文片段。";
    }
  }

  function showDetailEmpty(kind = "idle") {
    if (detail) detail.style.display = "none";
    if (!detailEmpty) return;
    detailEmpty.style.display = "block";
    const title = detailEmpty.querySelector("h3");
    const desc = detailEmpty.querySelector("p");
    if (title) title.textContent = kind === "empty" ? "还没有文件" : "选择左侧文件";
    if (desc) {
      desc.textContent = kind === "empty"
        ? "上传资料或粘贴聊天记录后，这里会显示文件详情、标签、阅读入口和智能判断。"
        : "单击文件查看详情、标签和智能判断；双击直接进入阅读器。";
    }
  }

  function toggleMainReader(on) {
    inMainReader = Boolean(on);
    if (inMainReader) {
      if (topToolbar) topToolbar.style.display = "none";
      if (toolsDrawer) toolsDrawer.style.display = "none";
      if (dropZone) dropZone.style.display = "none";
      mainReader.classList.remove("hidden");
      mainReader.style.display = "block";
      splitWrap.classList.add("hidden");
      splitWrap.style.display = "none";
    } else {
      if (topToolbar) topToolbar.style.display = "";
      if (toolsDrawer) toolsDrawer.style.display = "";
      if (dropZone) dropZone.style.display = "";
      mainReader.classList.add("hidden");
      mainReader.style.display = "none";
      splitWrap.classList.remove("hidden");
      splitWrap.style.display = "";
    }
  }

  function setReaderChromeCollapsed(on) {
    readerChromeCollapsed = Boolean(on);
    mainReader?.classList.toggle("reader-chrome-collapsed", readerChromeCollapsed);
    document.body.classList.toggle("library-reader-focus", readerChromeCollapsed);
    const btn = root.querySelector("#libMainFocusToggle");
    if (btn) btn.textContent = readerChromeCollapsed ? "恢复栏" : "收起栏";
    if (ctx.applyChromeFocusMode) ctx.applyChromeFocusMode(readerChromeCollapsed);
  }

  function setMainEditMode(on) {
    mainEditMode = Boolean(on);
    const saveBtn = root.querySelector("#libMainSaveText");
    const cancelBtn = root.querySelector("#libMainCancelEdit");
    const editBtn = root.querySelector("#libMainEditText");
    if (mainEditMode) {
      mainEditOriginalText = String(mainBaseText || "");
      mainTextEditor.value = mainEditOriginalText;
      mainTextEditor.classList.remove("hidden");
      mainTextEditor.style.display = "block";
      mainArticle.classList.add("hidden");
      mainArticle.style.display = "none";
      mainNativeWrap.classList.add("hidden");
      mainNativeWrap.style.display = "none";
      if (saveBtn) {
        saveBtn.classList.remove("hidden");
        saveBtn.style.display = "";
      }
      if (cancelBtn) {
        cancelBtn.classList.remove("hidden");
        cancelBtn.style.display = "";
      }
      if (editBtn) editBtn.textContent = "编辑中";
      if (mainEditStatus) mainEditStatus.textContent = canEditTextFile(mainCurrentRecord) ? "将写回原文件" : "将保存为本地阅读副本";
      requestAnimationFrame(() => mainTextEditor.focus());
    } else {
      mainTextEditor.classList.add("hidden");
      mainTextEditor.style.display = "none";
      if (saveBtn) {
        saveBtn.classList.add("hidden");
        saveBtn.style.display = "none";
      }
      if (cancelBtn) {
        cancelBtn.classList.add("hidden");
        cancelBtn.style.display = "none";
      }
      if (editBtn) editBtn.textContent = "编辑内容";
      if (mainEditStatus) mainEditStatus.textContent = "";
      ensureMainTextMode();
    }
  }

  function applyReaderViewPrefs() {
    if (readerFontStat) readerFontStat.textContent = `${readerFontSize}px`;
    if (readerWidth) readerWidth.value = readerWidthMode;
    mainReader?.classList.remove("reader-width-comfortable", "reader-width-wide", "reader-width-full");
    mainReader?.classList.add(`reader-width-${readerWidthMode}`);
    mainArticle.style.fontSize = `${readerFontSize}px`;
    mainArticle.style.lineHeight = readerFontSize >= 20 ? "1.78" : "1.9";
    mainNativeWrap.style.fontSize = `${readerFontSize}px`;
    mainTextEditor.style.fontSize = `${readerFontSize}px`;
    try {
      localStorage.setItem("cangjingge.library.readerFont", String(readerFontSize));
      localStorage.setItem("cangjingge.library.readerWidth", readerWidthMode);
    } catch {
      // ignore
    }
  }

  function setReaderFont(delta) {
    readerFontSize = Math.max(13, Math.min(28, readerFontSize + delta));
    applyReaderViewPrefs();
  }

  function highlightPlainText(raw, kw, ctxLike = {}) {
    if (!kw) return escHtml(raw);
    const baseOffset = Number.isFinite(ctxLike.baseOffset) ? Number(ctxLike.baseOffset) : 0;
    const rangeEnd = baseOffset + raw.length;
    const matches = (mainMatches || []).filter((m) => m.start >= baseOffset && m.start < rangeEnd);
    let out = "";
    let idx = 0;
    for (const hit of matches) {
      const p0 = Math.max(0, hit.start - baseOffset);
      const p1 = Math.min(raw.length, hit.end - baseOffset);
      if (p1 <= idx) continue;
      out += escHtml(raw.slice(idx, p0));
      const myIdx = hit.idx;
      const isActive = myIdx === mainMatchIdx;
      const cls = isActive ? "lib-main-hit-active" : "lib-main-hit";
      const markStyle = isActive
        ? "background:#f97316;color:#0b1220;padding:1px 3px;border-radius:4px;font-weight:800;outline:2px solid #fde047;box-shadow:0 0 0 2px rgba(0,0,0,0.35)"
        : "background:#fde047;color:#111827;padding:1px 3px;border-radius:4px;font-weight:700;outline:1px solid rgba(15,23,42,0.35)";
      out += `<mark class="${cls}" data-hit-index="${myIdx}" data-hit-start="${hit.start}" style="${markStyle}">${escHtml(raw.slice(p0, p1))}</mark>`;
      idx = p1;
    }
    out += escHtml(raw.slice(idx));
    return out;
  }

  function renderMainArticle() {
    if (mainPreviewKind !== "text") return;
    const text = String(mainBaseText || "");
    const kw = String(mainKw.value || "").trim();
    const lines = text.split(/\r?\n/);
    let html = "";
    let lineOffset = 0;
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const readMin = Math.max(1, Math.round(words / 220));
    const tagExplainMap = new Map();
    html += `<div style="margin-bottom:14px;padding:10px 12px;border:1px solid rgba(148,163,184,0.22);border-radius:10px;background:rgba(15,23,42,0.32)"><div style="font-size:13px;color:#94a3b8">阅读信息：约 ${words.toLocaleString()} 词 / 预计 ${readMin} 分钟</div></div>`;
    for (const line of lines) {
      const newlineAfter = text.slice(lineOffset + line.length, lineOffset + line.length + 2) === "\r\n" ? 2 : 1;
      const trimmed = line.trim();
      const leading = line.match(/^\s*/)?.[0]?.length || 0;
      const headingMatch = line.slice(leading).match(/^(#{1,6}\s+)/);
      const level = headingMatch ? headingMatch[1].trim().length : 0;
      let coreOffset = headingMatch ? lineOffset + leading + headingMatch[1].length : lineOffset;
      const core = headingMatch ? line.slice(leading + headingMatch[1].length) : line;
      let linePrefixHtml = "";
      let coreTextForRender = core;
      let lineToneStyle = "";
      let toneColor = null;
      let prefixRawText = "";
      const tagHit = core.match(/^\s*[\[\【]\s*([^:\]】]{1,12})\s*[:：]\s*([^\]】]+)\s*[\]\】]\s*(.*)$/);
      if (tagHit) {
        const tagName = String(tagHit[1] || "").trim();
        const tagDesc = String(tagHit[2] || "").trim();
        if (tagName && tagDesc && !tagExplainMap.has(tagName)) tagExplainMap.set(tagName, tagDesc);
        coreTextForRender = String(tagHit[3] || "");
        const restIndex = core.indexOf(coreTextForRender);
        if (restIndex >= 0) coreOffset += restIndex;
        const colorMap = {
          黄色: { bg: "rgba(250,204,21,0.25)", fg: "#78350f", bd: "rgba(245,158,11,0.8)" },
          黄: { bg: "rgba(250,204,21,0.25)", fg: "#78350f", bd: "rgba(245,158,11,0.8)" },
          蓝色: { bg: "rgba(96,165,250,0.24)", fg: "#0b3a75", bd: "rgba(59,130,246,0.8)" },
          蓝: { bg: "rgba(96,165,250,0.24)", fg: "#0b3a75", bd: "rgba(59,130,246,0.8)" },
          红色: { bg: "rgba(248,113,113,0.22)", fg: "#7f1d1d", bd: "rgba(239,68,68,0.82)" },
          绿色: { bg: "rgba(74,222,128,0.24)", fg: "#14532d", bd: "rgba(34,197,94,0.82)" },
        };
        const c = colorMap[tagName] || { bg: "rgba(148,163,184,0.2)", fg: "#e2e8f0", bd: "rgba(148,163,184,0.5)" };
        toneColor = c;
        prefixRawText = `【${tagName}: ${tagDesc}】`;
        lineToneStyle = `background:${c.bg};border-left:4px solid ${c.bd};padding:4px 8px;border-radius:6px;color:${c.fg}`;
      }
      const activeHit = mainMatches[mainMatchIdx];
      const lineHitStart = coreOffset;
      const lineHitEnd = coreOffset + coreTextForRender.length;
      let prefixInner = prefixRawText ? escHtml(prefixRawText) : "";
      let rendered;
      if (!kw) {
        rendered = escHtml(coreTextForRender || " ");
      } else {
        rendered = highlightPlainText(coreTextForRender, kw, { baseOffset: coreOffset });
      }
      const lineHasActiveHit = Boolean(activeHit && activeHit.start >= lineHitStart && activeHit.start < lineHitEnd);
      if (prefixRawText && toneColor) {
        const c = toneColor;
        const glow = lineHasActiveHit ? "box-shadow:0 0 0 2px rgba(245,158,11,0.65) inset;" : "";
        linePrefixHtml = `<span style="display:inline-block;margin-right:8px;padding:2px 8px;border-radius:999px;background:${c.bg};color:${c.fg};border:1px solid ${c.bd};font-size:12px;${glow}">${prefixInner}</span>`;
      }
      const lineJumpStyle = lineHasActiveHit ? "box-shadow:0 0 0 3px rgba(249,115,22,0.9) inset" : "";
      if (level > 0) {
        const style =
          level === 1
            ? "margin:20px 0 10px;font-size:20px;line-height:1.35;border-bottom:1px solid rgba(148,163,184,0.25);padding-bottom:6px"
            : level === 2
              ? "margin:16px 0 8px;font-size:17px;line-height:1.4;border-left:4px solid rgba(96,165,250,0.65);padding-left:8px"
              : "margin:12px 0 6px;font-size:15px;line-height:1.45;color:#cbd5e1";
        html += `<div class="${lineHasActiveHit ? "lib-main-line-active" : ""}" style="${style};${lineToneStyle};${lineJumpStyle}">${linePrefixHtml}${rendered}</div>`;
      } else if (/^\s*[-*]\s+/.test(line)) {
        html += `<div class="${lineHasActiveHit ? "lib-main-line-active" : ""}" style="margin:4px 0 4px 16px;${lineToneStyle};${lineJumpStyle}">• ${linePrefixHtml}${rendered.replace(/^\s*[-*]\s+/, "")}</div>`;
      } else if (trimmed) {
        html += `<p class="${lineHasActiveHit ? "lib-main-line-active" : ""}" style="margin:0 0 11px;text-align:justify;${lineToneStyle};${lineJumpStyle}">${linePrefixHtml}${rendered}</p>`;
      } else {
        html += `<div style="height:8px"></div>`;
      }
      lineOffset += line.length + (lineOffset + line.length < text.length ? newlineAfter : 0);
    }
    if (tagExplainMap.size) {
      const chips = [...tagExplainMap.entries()]
        .map(([k, v]) => `<span style="display:inline-block;margin:0 8px 8px 0;padding:4px 10px;border-radius:999px;border:1px solid rgba(148,163,184,0.35);background:rgba(30,41,59,0.45);font-size:12px">【${escHtml(k)}】${escHtml(v)}</span>`)
        .join("");
      html = `<div style="margin-bottom:12px;padding:10px 12px;border:1px dashed rgba(148,163,184,0.35);border-radius:10px"><div style="font-size:12px;color:#94a3b8;margin-bottom:8px">颜色语义说明（来自原文标签）</div>${chips}</div>` + html;
    }
    mainArticle.innerHTML = html || "<p class='muted'>（无内容）</p>";
  }

  function buildReadCursor() {
    const host = mainEditMode ? mainTextEditor : mainPreviewKind === "native" ? mainNativeWrap : mainArticle;
    if (!host) return null;
    const mode = mainEditMode ? "edit" : mainPreviewKind === "native" ? "native" : "text";
    const total = Math.max(1, host.scrollHeight - host.clientHeight);
    const ratio = Math.max(0, Math.min(1, host.scrollTop / total));
    return {
      mode,
      ratio,
      scrollTop: host.scrollTop,
      updatedAt: Date.now(),
    };
  }

  async function persistReadCursor() {
    if (!selectedId) return;
    const cursor = buildReadCursor();
    if (!cursor) return;
    const now = Date.now();
    if (now - lastReadSaveAt < 600) return;
    lastReadSaveAt = now;
    try {
      await idb.patchFile(selectedId, { readCursor: cursor });
    } catch {
      // ignore cursor persistence errors
    }
  }

  function restoreReadCursor(rec, { archiveOnly = false } = {}) {
    const c = rec?.readArchive || (!archiveOnly ? rec?.readCursor : null);
    if (!c) return false;
    const ratio = Number(c.ratio);
    if (!Number.isFinite(ratio)) return false;
    requestAnimationFrame(() => {
      const host = c.mode === "native" ? mainNativeWrap : c.mode === "edit" ? mainTextEditor : mainArticle;
      const total = Math.max(1, host.scrollHeight - host.clientHeight);
      host.scrollTop = Math.max(0, Math.min(total, total * ratio));
    });
    return true;
  }

  function fillMainReader(rec) {
    if (!rec) return;
    if (mainEditMode) setMainEditMode(false);
    mainCurrentRecord = rec;
    const titleInput = root.querySelector("#libMainTitle");
    if (titleInput) titleInput.value = visibleFileTitle(rec);
    root.querySelector("#libMainMeta").textContent = `${extOf(rec) || "文件"} · ${Number(rec.charCount ?? 0).toLocaleString()} 字 · ${Number(rec.lineCount ?? 0).toLocaleString()} 行 · ${rec.category || "未分类"}`;
    root.querySelector("#libMainTags").value = Array.isArray(rec.tags) ? rec.tags.join(", ") : "";
    root.querySelector("#libMainCategory").value = rec.category || "";
    root.querySelector("#libMainPriority").value = rec.priority || "";
    root.querySelector("#libMainNote").value = rec.annotationNote || "";
    root.querySelector("#libMainMemory").value = rec.memoryNote || "";
    const archiveBtn = root.querySelector("#libMainArchiveGo");
    if (archiveBtn) {
      archiveBtn.disabled = !rec.readArchive;
      archiveBtn.title = rec.readArchive
        ? `跳回存档：${new Date(rec.readArchive.updatedAt || Date.now()).toLocaleString()}`
        : "还没有手动存档位置";
    }
    mainBaseText = String(rec.content || "");
    const editable = canEditReadableContent(rec);
    const editBtn = root.querySelector("#libMainEditText");
    if (editBtn) {
      editBtn.disabled = !editable;
      editBtn.title = editable
        ? "编辑当前阅读内容；文本类写回原文件，其他格式保存为本地阅读副本"
        : "当前记录没有可编辑正文；可保存标注与记忆";
    }
    if (mainEditStatus) mainEditStatus.textContent = editable ? "" : "没有可编辑正文";
    mainPreviewKind = "text";
    mainNativeWrap.innerHTML = "";
    mainNativeWrap.classList.add("hidden");
    mainNativeWrap.style.display = "none";
    mainArticle.classList.remove("hidden");
    mainArticle.style.display = "block";
    applyReaderViewPrefs();
    renderMainArticle();
    refreshMainMatches();
    updateMainHitNavUi();
    restoreReadCursor(rec);
  }

  async function loadNativePreview(rec) {
    if (!rec?.id) return;
    if (mainEditMode) setMainEditMode(false);
    try {
      const pv = await ctx.ipc.libraryGetPreview({ id: rec.id, apiKey: ctx.getApiKey() });
      if (!pv || !pv.kind) return;
      if (pv.kind === "image" && pv.dataUrl) {
        mainPreviewKind = "native";
        mainNativeWrap.classList.remove("hidden");
        mainNativeWrap.style.display = "block";
        mainArticle.classList.add("hidden");
        mainArticle.style.display = "none";
        mainNativeWrap.innerHTML = `<div style="text-align:center"><img src="${pv.dataUrl}" style="max-width:100%;height:auto;border-radius:10px" /></div>`;
        applyReaderViewPrefs();
        restoreReadCursor(rec);
      } else if ((pv.kind === "pdf" || pv.kind === "html_url") && pv.url) {
        mainPreviewKind = "native";
        mainNativeWrap.classList.remove("hidden");
        mainNativeWrap.style.display = "block";
        mainArticle.classList.add("hidden");
        mainArticle.style.display = "none";
        mainNativeWrap.innerHTML = `<iframe src="${pv.url}" style="width:100%;height:calc(100vh - 380px);border:1px solid rgba(148,163,184,0.25);border-radius:10px;background:#fff"></iframe>`;
        applyReaderViewPrefs();
        restoreReadCursor(rec);
      } else if (pv.kind === "spreadsheet_html" && typeof pv.sheets === "string") {
        mainPreviewKind = "native";
        mainNativeWrap.classList.remove("hidden");
        mainNativeWrap.style.display = "block";
        mainArticle.classList.add("hidden");
        mainArticle.style.display = "none";
        const iframe = document.createElement("iframe");
        iframe.className = "lib-native-frame";
        iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>
          body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif;background:#f8fafc;color:#0f172a}
          .tabs{position:sticky;top:0;display:flex;gap:8px;padding:10px;border-bottom:1px solid #dbe4ee;background:#fff;z-index:5}
          .sheet-tab{border:1px solid #cbd5e1;border-radius:999px;background:#fff;padding:6px 12px;font-weight:800;cursor:pointer}
          .sheet-tab.active{background:#0f766e;color:#fff;border-color:#0f766e}
          .sheet-page{display:none;padding:12px;overflow:auto}.sheet-page.active{display:block}
          table{border-collapse:collapse;background:#fff;min-width:100%;box-shadow:0 1px 0 #e2e8f0}
          th{position:sticky;top:48px;background:#eef2f7;color:#475569;font-size:12px;z-index:2}
          th:first-child{left:0;z-index:3}
          td,th{border:1px solid #dbe4ee;padding:7px 9px;min-width:92px;max-width:460px;white-space:pre-wrap;vertical-align:top}
          td{font-size:13px;line-height:1.45;background:#fff}
          tbody tr:hover td{background:#f8fbff}
        </style></head><body><div class="tabs">${pv.tabs || ""}</div>${pv.sheets || ""}<script>
          document.querySelectorAll('.sheet-tab').forEach(btn=>btn.addEventListener('click',()=>{
            document.querySelectorAll('.sheet-tab').forEach(x=>x.classList.remove('active'));
            document.querySelectorAll('.sheet-page').forEach(x=>x.classList.remove('active'));
            btn.classList.add('active');
            document.querySelector('[data-sheet-page="'+btn.dataset.sheet+'"]')?.classList.add('active');
          }));
        </script></body></html>`;
        mainNativeWrap.innerHTML = "";
        mainNativeWrap.appendChild(iframe);
        applyReaderViewPrefs();
        restoreReadCursor(rec);
      } else if (pv.kind === "docx_html" && typeof pv.html === "string") {
        mainPreviewKind = "native";
        mainNativeWrap.classList.remove("hidden");
        mainNativeWrap.style.display = "block";
        mainArticle.classList.add("hidden");
        mainArticle.style.display = "none";
        const toneRegex = /[\[\【]\s*(黄色|黄|蓝色|蓝|红色|绿色)\s*[:：]\s*([^\]】]{1,40})\s*[\]\】]/;
        const colorMap = {
          黄色: { bg: "rgba(250,204,21,0.18)", fg: "#7c5a00", bd: "rgba(250,204,21,0.72)" },
          黄: { bg: "rgba(250,204,21,0.18)", fg: "#7c5a00", bd: "rgba(250,204,21,0.72)" },
          蓝色: { bg: "rgba(96,165,250,0.18)", fg: "#0b3a75", bd: "rgba(96,165,250,0.72)" },
          蓝: { bg: "rgba(96,165,250,0.18)", fg: "#0b3a75", bd: "rgba(96,165,250,0.72)" },
          红色: { bg: "rgba(248,113,113,0.18)", fg: "#7f1d1d", bd: "rgba(248,113,113,0.72)" },
          绿色: { bg: "rgba(74,222,128,0.18)", fg: "#14532d", bd: "rgba(74,222,128,0.72)" },
        };
        const html = String(pv.html || "")
          .replace(/<(p|li|div|h[1-6])([^>]*)>([\s\S]*?)<\/\1>/gi, (full, tag, attrs, inner) => {
            const hit = String(inner || "").match(toneRegex);
            if (!hit) return full;
            const tagName = hit[1];
            const tagDesc = hit[2];
            const c = colorMap[tagName] || { bg: "rgba(148,163,184,0.18)", fg: "#334155", bd: "rgba(148,163,184,0.62)" };
            const capsule = `<span style="display:inline-block;padding:1px 8px;border-radius:999px;background:${c.bg};color:${c.fg};border:1px solid ${c.bd};font-size:12px">【${tagName}: ${tagDesc}】</span>`;
            const nextInner = String(inner).replace(toneRegex, capsule);
            return `<${tag}${attrs}><span style="display:inline;background:${c.bg};color:${c.fg};border-left:3px solid ${c.bd};padding:1px 6px;border-radius:4px">${nextInner}</span></${tag}>`;
          })
          .replace(toneRegex, (_m, tagName, tagDesc) => {
            const c = colorMap[tagName] || { bg: "rgba(148,163,184,0.22)", fg: "#334155", bd: "rgba(148,163,184,0.62)" };
            return `<span style="display:inline-block;padding:1px 8px;border-radius:999px;background:${c.bg};color:${c.fg};border:1px solid ${c.bd};font-size:12px">【${tagName}: ${tagDesc}】</span>`;
          });
        const iframe = document.createElement("iframe");
        iframe.style.cssText =
          "width:100%;height:calc(100vh - 380px);border:1px solid rgba(148,163,184,0.25);border-radius:10px;background:#fff";
        iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:'Microsoft YaHei',Arial,sans-serif;line-height:1.75;padding:18px;background:#fff;color:#111} h1,h2,h3{color:#0f172a} table{border-collapse:collapse;width:100%} td,th{border:1px solid #ddd;padding:6px}</style></head><body>${html}</body></html>`;
        mainNativeWrap.innerHTML = "";
        mainNativeWrap.appendChild(iframe);
        applyReaderViewPrefs();
        restoreReadCursor(rec);
      } else {
        mainPreviewKind = "text";
      }
    } catch {
      mainPreviewKind = "text";
    }
  }

  function refreshMainMatches() {
    const content = String(mainBaseText || "");
    const kw = String(mainKw.value || "").trim().toLowerCase();
    mainMatches = [];
    mainMatchIdx = -1;
    if (!kw || !content) {
      mainStat.textContent = "";
      if (mainDebug) mainDebug.textContent = "";
      return;
    }
    const lower = content.toLowerCase();
    let pos = 0;
    while (pos < lower.length && mainMatches.length < 5000) {
      const found = lower.indexOf(kw, pos);
      if (found < 0) break;
      const ctxStart = Math.max(0, found - 30);
      const ctxEnd = Math.min(content.length, found + kw.length + 48);
      const snippet = content.slice(ctxStart, ctxEnd).replace(/\s+/g, " ").trim();
      mainMatches.push({
        idx: mainMatches.length,
        start: found,
        end: found + kw.length,
        snippet,
      });
      pos = found + Math.max(1, kw.length);
    }
    mainStat.textContent = `命中 ${mainMatches.length} 处`;
    if (mainDebug) mainDebug.textContent = mainMatches.length ? "按 Enter 跳到下一处，Shift+Enter 跳到上一处" : "";
    renderMainHitList();
  }

  function ensureMainTextMode() {
    if (mainEditMode) setMainEditMode(false);
    if (mainPreviewKind === "text") return;
    mainPreviewKind = "text";
    mainNativeWrap.classList.add("hidden");
    mainNativeWrap.style.display = "none";
    mainTextEditor.classList.add("hidden");
    mainTextEditor.style.display = "none";
    mainArticle.classList.remove("hidden");
    mainArticle.style.display = "block";
  }

  function scrollToMainHit(index, smooth = true) {
    if (!Number.isFinite(index) || index < 0) {
      if (mainDebug) mainDebug.textContent = "没有可跳转的命中位置";
      return;
    }
    const before = mainArticle.scrollTop;
    const target =
      mainArticle.querySelector(`mark[data-hit-index="${index}"]`) ||
      mainArticle.querySelector(`[data-hit-index="${index}"]`) ||
      mainArticle.querySelector(".lib-main-hit-active") ||
      mainArticle.querySelector(".lib-main-line-active");
    if (!target) {
      const hit = mainMatches[index];
      if (hit && mainBaseText.length > 0) {
        const ratio = Math.max(0, Math.min(1, hit.start / mainBaseText.length));
        const maxTop = Math.max(0, mainArticle.scrollHeight - mainArticle.clientHeight);
        mainArticle.scrollTo({ top: Math.round(maxTop * ratio), behavior: smooth ? "smooth" : "auto" });
        if (mainDebug) mainDebug.textContent = `已按原文顺序定位：第 ${index + 1}/${mainMatches.length} 处`;
        return;
      }
      if (mainDebug) mainDebug.textContent = "正在刷新高亮，请再试一次";
      return;
    }
    const hostRect = mainArticle.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const desiredTop =
      mainArticle.scrollTop + (targetRect.top - hostRect.top) - Math.round(mainArticle.clientHeight * 0.28);
    const top = Math.max(0, desiredTop);
    mainArticle.scrollTo({
      top,
      behavior: smooth ? "smooth" : "auto",
    });
    requestAnimationFrame(() => {
      mainArticle.scrollTo({ top, behavior: "auto" });
      if (mainDebug) {
        const snip = String(mainMatches[index]?.snippet || "").slice(0, 40);
        mainDebug.textContent = `已定位：第 ${index + 1}/${mainMatches.length} 处 · ${snip}`;
      }
    });
  }

  function renderMainHitList() {
    if (!mainHitList) return;
    if (!mainMatches.length) {
      mainHitList.classList.add("hidden");
      mainHitList.innerHTML = "";
      return;
    }
    const rows = mainMatches.slice(0, 30);
    mainHitList.classList.remove("hidden");
    mainHitList.innerHTML = rows
      .map((m, i) => {
        const active = i === mainMatchIdx;
        const snip = String(m.snippet || "").slice(0, 120) || "（命中句）";
        return `<button type="button" class="btn btn-sm ${active ? "btn-primary" : "btn-ghost"} lib-hit-row" data-hit-idx="${i}" style="display:block;width:100%;text-align:left;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i + 1}. ${escHtml(snip)}</button>`;
      })
      .join("");
    mainHitList.querySelectorAll(".lib-hit-row").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-hit-idx"));
        if (!Number.isFinite(idx) || idx < 0 || idx >= mainMatches.length) return;
        ensureMainTextMode();
        mainMatchIdx = idx;
        renderMainArticle();
        renderMainHitList();
        scrollToMainHit(mainMatchIdx, true);
        mainStat.textContent = `命中 ${mainMatches.length} 处 · 第 ${mainMatchIdx + 1} 处`;
      });
    });
  }

  function jumpMain(step = 1) {
    const kw = String(mainKw.value || "").trim();
    if (!kw) {
      mainStat.textContent = "请先输入关键词";
      if (mainDebug) mainDebug.textContent = "输入关键词后，可按 Enter 逐处跳转";
      try { ctx.toast("请先输入关键词后再点上一个/下一个", true); } catch {}
      return;
    }
    if (!mainMatches.length) {
      refreshMainMatches();
      if (!mainMatches.length) {
        mainStat.textContent = "未命中";
        if (mainDebug) mainDebug.textContent = "没有找到匹配内容";
        try { ctx.toast(`没有找到包含「${kw}」的句子`, true); } catch {}
        return;
      }
    }
    ensureMainTextMode();
    if (mainMatchIdx < 0) {
      mainMatchIdx = step >= 0 ? 0 : mainMatches.length - 1;
    } else {
      const next = mainMatchIdx + step;
      if (next >= mainMatches.length) {
        try { ctx.toast(`已经是最后一处了（共 ${mainMatches.length} 处），已回到第 1 处`); } catch {}
        mainMatchIdx = 0;
      } else if (next < 0) {
        try { ctx.toast(`已经是第 1 处了（共 ${mainMatches.length} 处），已跳到最后一处`); } catch {}
        mainMatchIdx = mainMatches.length - 1;
      } else {
        mainMatchIdx = next;
      }
    }
    renderMainArticle();
    renderMainHitList();
    scrollToMainHit(mainMatchIdx, true);
    mainStat.textContent = `命中 ${mainMatches.length} 处 · 第 ${mainMatchIdx + 1} 处`;
  }

  function searchAndJumpMain() {
    refreshMainMatches();
    if (!mainMatches.length) {
      mainMatchIdx = -1;
      renderMainArticle();
      mainStat.textContent = "未命中";
      if (mainDebug) mainDebug.textContent = "没有找到匹配内容";
      return;
    }
    ensureMainTextMode();
    mainMatchIdx = 0;
    renderMainArticle();
    renderMainHitList();
    scrollToMainHit(mainMatchIdx, true);
    mainStat.textContent = `命中 ${mainMatches.length} 处 · 第 1 处`;
  }

  function openInAppByRecord(rec) {
    if (!rec) return;
    try {
      selectedId = rec.id;
      toggleMainReader(true);
      fillMainReader(rec);
      void loadNativePreview(rec);
      renderAll();
      mainArticle.scrollTop = 0;
      ctx.toast("已在项目内阅读器打开");
    } catch (e) {
      ctx.toast(`打开失败：${e?.message || e}`, true);
    }
  }

  function renderCards(filtered) {
    cardsHost.innerHTML = "";
    const kws = currentSearchKeywords();
    const hasSearch = kws.length > 0;
    filtered.forEach((rec) => {
      const fullSum = summaryLine(rec);
      const sumShort = fullSum.slice(0, 120) + (fullSum.length > 120 ? "…" : "");
      const card = el(`
        <div class="card lib-card" data-id="${rec.id}" data-search-hit="${hasSearch ? "1" : "0"}" style="cursor:pointer;padding:12px;position:relative">
          <label style="position:absolute;top:8px;right:8px;display:flex;align-items:center;gap:4px;font-size:11px;color:#94a3b8;cursor:pointer" title="勾选用于批量操作">
            <input type="checkbox" class="lib-cb lib-card-cb" data-id="${escAttr(rec.id)}" />
          </label>
          <div class="lib-file-title-row" style="padding-right:28px">
            <div class="lib-file-title-line">${highlightHtmlOuter(rec.fileName || "", kws)}</div>
            <button type="button" class="btn btn-ghost btn-xs libRenameFile" title="修改文件名称">改名</button>
          </div>
          <div class="muted" style="font-size:0.75rem;margin-top:6px">${highlightHtmlOuter(sumShort, kws)}</div>
          <div class="muted" style="font-size:0.72rem;margin-top:8px">${rec.uploadedAt ? new Date(rec.uploadedAt).toLocaleString() : ""}</div>
        </div>
      `);
      card.querySelector(".libRenameFile")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void renameFileFromList(rec);
      });
      card.addEventListener("click", (ev) => {
        const t = /** @type {HTMLElement} */ (ev.target);
        if (t.closest("input") || t.closest("label") || t.closest("button")) return;
        selectedId = rec.id;
        renderAll();
        showDetailLocal(rec);
      });
      card.addEventListener("dblclick", (ev) => {
        const t = /** @type {HTMLElement} */ (ev.target);
        if (t.closest("input") || t.closest("label") || t.closest("button")) return;
        openInAppByRecord(rec);
      });
      if (rec.id === selectedId) card.classList.add("selected");
      cardsHost.appendChild(card);
    });
  }

  function currentSearchKeywords() {
    const q = String(activeSearchQuery || "").trim();
    if (!q) return [];
    return q.split(/\s+/).filter(Boolean);
  }

  function renderTable(filtered) {
    tbody.innerHTML = "";
    const kws = currentSearchKeywords();
    const hasSearch = kws.length > 0;
    filtered.forEach((rec) => {
      const tr = document.createElement("tr");
      tr.dataset.id = rec.id;
      tr.dataset.searchHit = hasSearch ? "1" : "0";
      if (rec.id === selectedId) tr.classList.add("selected");
      const sz = rec.bytes != null ? `${Number(rec.bytes).toLocaleString()} B` : "—";
      const time = rec.uploadedAt ? new Date(rec.uploadedAt).toLocaleString() : "—";
      const td0 = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "lib-cb";
      cb.dataset.id = rec.id;
      td0.appendChild(cb);
      const tdFav = document.createElement("td");
      const favBtn = document.createElement("button");
      favBtn.type = "button";
      favBtn.className = "btn btn-ghost btn-sm lib-fav-btn";
      favBtn.textContent = rec.favorite ? "★" : "☆";
      favBtn.title = p.favToggle || "";
      favBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        try {
          await idb.patchFile(rec.id, { favorite: !rec.favorite });
          rec.favorite = !rec.favorite;
          renderAll();
        } catch (e) {
          ctx.toast(e?.message || "失败", true);
        }
      });
      tdFav.appendChild(favBtn);
      const td1 = document.createElement("td");
      td1.className = "lib-file-name-cell";
      const type = extOf(rec).replace(/^\./, "").toUpperCase() || "FILE";
      const metaBits = [
        rec.category || inferLibraryCategory(rec) || "未分类",
        Array.isArray(rec.tags) && rec.tags.length ? rec.tags.slice(0, 3).join(" / ") : "",
        rec.priority ? `优先级 ${rec.priority}` : "",
      ].filter(Boolean);
      td1.innerHTML = `
        <div class="lib-file-title-row">
          <div class="lib-file-title-line">${highlightHtmlOuter(rec.fileName || "", kws)}</div>
          <button type="button" class="btn btn-ghost btn-xs libRenameFile" title="修改文件名称">改名</button>
        </div>
        <div class="lib-file-meta-line">
          <span>${escHtmlOuter(type)}</span>
          ${metaBits.map((bit) => `<span>${highlightHtmlOuter(bit, kws)}</span>`).join("")}
        </div>
      `;
      td1.querySelector(".libRenameFile")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void renameFileFromList(rec);
      });
      const td2 = document.createElement("td");
      td2.className = "lib-file-size-cell";
      td2.textContent = sz;
      const td3 = document.createElement("td");
      td3.className = "lib-file-time-cell";
      td3.textContent = time;
      const td5 = document.createElement("td");
      td5.className = "lib-file-action-cell";
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "btn btn-secondary btn-sm";
      openBtn.textContent = p.openInAppShort || "打开";
      openBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openInAppByRecord(rec);
      });
      td5.appendChild(openBtn);
      tr.append(td0, tdFav, td1, td2, td3, td5);
      tr.addEventListener("click", (ev) => {
        if (ev.target instanceof HTMLInputElement && ev.target.type === "checkbox") return;
        if ((/** @type {HTMLElement} */ (ev.target)).closest(".lib-fav-btn,.libRenameFile")) return;
        selectedId = rec.id;
        renderAll();
        showDetailLocal(rec);
      });
      tr.addEventListener("dblclick", (ev) => {
        if (ev.target instanceof HTMLInputElement && ev.target.type === "checkbox") return;
        const t = /** @type {HTMLElement} */ (ev.target);
        if (t.closest(".lib-fav-btn")) return;
        if (t.closest("button")) return;
        openInAppByRecord(rec);
      });
      tbody.appendChild(tr);
    });
  }

  function pageSizeValue() {
    const n = Number(pageSizeSel?.value || "50");
    return Number.isFinite(n) ? n : 50;
  }

  function pageSlice(list) {
    const size = pageSizeValue();
    if (!size || size <= 0) {
      if (pageInfo) pageInfo.textContent = `全部 ${list.length}`;
      if (pagePrev) pagePrev.disabled = true;
      if (pageNext) pageNext.disabled = true;
      return list;
    }
    const totalPages = Math.max(1, Math.ceil(list.length / size));
    listPageIndex = Math.max(0, Math.min(listPageIndex, totalPages - 1));
    const start = listPageIndex * size;
    const end = Math.min(list.length, start + size);
    if (pageInfo) pageInfo.textContent = `${listPageIndex + 1}/${totalPages} · ${start + 1}-${end}/${list.length}`;
    if (pagePrev) pagePrev.disabled = listPageIndex <= 0;
    if (pageNext) pageNext.disabled = listPageIndex >= totalPages - 1;
    return list.slice(start, end);
  }

  function renderAll() {
    const serial = ++lastRenderSerial;
    if (loadFailed) {
      emptyHost.innerHTML = "";
      emptyState(emptyHost, p.loadErrorTitle || "", p.loadErrorHint || "");
      showDetailEmpty("empty");
      tbody.innerHTML = "";
      cardsHost.innerHTML = "";
      renderLibraryMap([]);
      updateVaultStats(0);
      return;
    }
    const filtered = items.filter(matchesFilter);
    const q = normalizeQuery(activeSearchQuery);
    const terms = splitQueryTerms(q);
    if (sortSel.value === "oldest") {
      filtered.sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0));
    } else if (sortSel.value === "nameAsc") {
      filtered.sort((a, b) => String(a.fileName || "").localeCompare(String(b.fileName || ""), "zh-CN"));
    } else if (sortSel.value === "sizeDesc") {
      filtered.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
    } else if (sortSel.value === "relevance" && q) {
      filtered.sort((a, b) => {
        const ah = recordSearchScore(a, terms);
        const bh = recordSearchScore(b, terms);
        return bh - ah || (b.uploadedAt || 0) - (a.uploadedAt || 0);
      });
    } else {
      filtered.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    }
    if (!filtered.length) {
      emptyHost.innerHTML = "";
      emptyState(
        emptyHost,
        items.length ? p.emptyFilteredTitle || "" : p.emptyAllTitle || "",
        items.length ? p.emptyFilteredHint || "" : p.emptyAllHint || ""
      );
      showDetailEmpty(items.length ? "idle" : "empty");
      tbody.innerHTML = "";
      cardsHost.innerHTML = "";
      if (inMainReader) toggleMainReader(false);
      updateSearchStatus(q ? "未找到匹配文件" : "输入关键词搜索");
      renderLibraryMap([]);
      updateVaultStats(0);
      updateQaMeta();
      return;
    }
    emptyHost.innerHTML = "";
    renderLibraryMap(filtered);
    updateVaultStats(filtered.length);
    const paged = pageSlice(filtered);
    const v = viewSel.value;
    if (v === "cards") {
      tableWrap.classList.add("hidden");
      cardsHost.classList.remove("hidden");
      cardsHost.style.display = "grid";
      renderCards(paged);
    } else {
      cardsHost.classList.add("hidden");
      cardsHost.style.display = "none";
      tableWrap.classList.remove("hidden");
      renderTable(paged);
    }
    if (selectedId) {
      const rec = items.find((x) => x.id === selectedId);
      if (rec) {
        showDetailLocal(rec);
        if (inMainReader) fillMainReader(rec);
      }
      else {
        selectedId = null;
        showDetailEmpty("idle");
        if (inMainReader) toggleMainReader(false);
      }
    } else {
      showDetailEmpty("idle");
    }
    refreshLibHitNav();
    if (serial === lastRenderSerial) {
      const size = pageSizeValue();
      const pageTxt = size > 0 && filtered.length > paged.length ? ` · 当前渲染 ${paged.length} 个` : "";
      updateSearchStatus(q ? `命中 ${filtered.length} 个文件${pageTxt}` : `共 ${filtered.length} 个文件${pageTxt}`);
    }
    updateQaMeta();
  }

  // —— 列表关键词跳转：把当前过滤后列表里命中的 <mark> 收集起来，可上一处/下一处依次定位 ——
  /** @type {HTMLElement[]} */
  let libHitMarks = [];
  let libHitIndex = 0;
  let libLastHitQuery = "";

  function refreshLibHitNav() {
    const hitNav = root.querySelector("#libHitNav");
    if (!hitNav) return;
    const q = String(activeSearchQuery || "").trim();
    const scope = viewSel.value === "cards" ? cardsHost : tbody;
    const marks = scope ? Array.from(scope.querySelectorAll("mark")) : [];
    const targets = scope ? Array.from(scope.querySelectorAll("[data-search-hit='1']")) : [];
    libHitMarks = marks;
    libHitTargets = targets;
    marks.forEach((m, i) => m.setAttribute("data-hit-index", String(i)));
    if (!q || !targets.length) {
      hitNav.classList.add("hidden");
      libHitIndex = 0;
      libLastHitQuery = q;
      clearLibActiveDeco();
      return;
    }
    hitNav.classList.remove("hidden");
    if (q !== libLastHitQuery) {
      libHitIndex = 0;
      libLastHitQuery = q;
      requestAnimationFrame(() => scrollToLibHit(0, false));
    } else if (libHitIndex >= targets.length) {
      libHitIndex = 0;
    }
    updateLibHitLabel();
    markCurrentLibHit();
  }

  function updateLibHitLabel() {
    const hitCount = root.querySelector("#libHitCount");
    if (!hitCount) return;
    if (!libHitTargets.length) {
      hitCount.textContent = "0/0";
      return;
    }
    hitCount.textContent = `${libHitIndex + 1}/${libHitTargets.length}`;
    updateSearchStatus(activeSearchQuery ? `命中 ${libHitTargets.length} 个文件 · 当前 ${libHitIndex + 1}` : "");
  }

  function clearLibActiveDeco() {
    if (!tbody) return;
    tbody.querySelectorAll(".lib-row-active").forEach((n) => n.classList.remove("lib-row-active"));
    if (cardsHost) cardsHost.querySelectorAll(".lib-card-active").forEach((n) => n.classList.remove("lib-card-active"));
  }

  function markCurrentLibHit() {
    libHitMarks.forEach((m, i) => {
      if (i === libHitIndex) m.classList.add("kwHitCurrent");
      else m.classList.remove("kwHitCurrent");
    });
    clearLibActiveDeco();
    const curTarget = libHitTargets[libHitIndex];
    const cur = curTarget?.querySelector("mark") || libHitMarks[libHitIndex];
    if (!cur) return;
    const tr = curTarget?.closest("tr") || cur.closest("tr");
    if (tr) tr.classList.add("lib-row-active");
    const card = curTarget?.closest(".lib-card") || cur.closest(".lib-card");
    if (card) card.classList.add("lib-card-active");
    if (cur) cur.classList.add("kwHitCurrent");
  }

  function scrollToLibHit(idx, smooth) {
    if (!libHitTargets.length) return;
    const safe = ((idx % libHitTargets.length) + libHitTargets.length) % libHitTargets.length;
    libHitIndex = safe;
    const target = libHitTargets[safe];
    if (!target) return;
    markCurrentLibHit();
    updateLibHitLabel();
    target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center", inline: "nearest" });
    target.classList.add("kwHitFlash");
    setTimeout(() => target.classList.remove("kwHitFlash"), 900);
    const id = target.getAttribute("data-id");
    if (id) {
      const rec = items.find((x) => x.id === id);
      if (rec) {
        selectedId = id;
        showDetailLocal(rec);
      }
    }
  }

  function gotoNextLibHit(delta) {
    if (!libHitTargets.length) return;
    scrollToLibHit(libHitIndex + delta, true);
  }

  async function persistFromLibraryResult(r, silent = false) {
    const { record, content, markdownPreview } = r;
    await idb.putFile(
      {
        ...record,
        content: String(content ?? ""),
        markdownPreview: String(markdownPreview ?? ""),
      },
      { silent }
    );
    return { ...record, content: String(content ?? ""), markdownPreview: String(markdownPreview ?? "") };
  }

  async function ingestAndSaveOne({ fileName, base64, silent = false }) {
    const add = await ctx.ipc.libraryAddFromBuffer({
      fileName,
      base64,
      apiKey: ctx.getApiKey(),
    });
    return persistFromLibraryResult(add, silent);
  }

  function chatTitleFromText(text) {
    const firstLine = String(text || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    const today = new Date().toISOString().slice(0, 10);
    return safeFilePart(firstLine || `聊天记录 ${today}`) || `聊天记录 ${today}`;
  }

  async function saveChatRecord({ analyze = false } = {}) {
    const text = String(root.querySelector("#libChatText")?.value || "").trim();
    if (!text) {
      ctx.toast("请先粘贴聊天记录", true);
      return;
    }
    const titleInput = root.querySelector("#libChatTitle");
    const category = String(root.querySelector("#libChatCategory")?.value || "聊天记录").trim();
    const title = safeFilePart(titleInput?.value || chatTitleFromText(text));
    const fileName = `${title || "聊天记录"}.txt`;
    const content = [
      `# ${title}`,
      "",
      `来源类型：${category}`,
      `导入时间：${new Date().toLocaleString()}`,
      "",
      "## 原始聊天记录",
      "",
      text,
    ].join("\n");
    const saved = await ingestAndSaveOne({
      fileName,
      base64: textToBase64(content),
      silent: true,
    });
    const tags = ["聊天记录", category].filter(Boolean);
    await idb.patchFile(saved.id, {
      category,
      tags,
      favorite: category === "客户沟通",
      memoryNote: "由粘贴聊天记录导入，可按人名、时间、关键词搜索，并用于分析与生成行动清单。",
    });
    try {
      await ctx.ipc.libraryUpdateTags({ id: saved.id, tags });
    } catch {
      // IDB 本地标签已写入，磁盘标签同步失败不阻断导入。
    }
    root.querySelector("#libChatText").value = "";
    if (titleInput) titleInput.value = "";
    root.querySelector("#libChatPanel").style.display = "none";
    root.querySelector("#libChatPanel").classList.add("hidden");
    ctx.emitLibraryChanged();
    await reload();
    selectedId = saved.id;
    renderAll();
    const rec = items.find((x) => x.id === saved.id);
    if (rec) showDetailLocal(rec);
    ctx.toast("聊天记录已保存到文件库");
    if (analyze) {
      ctx.navigate("analysis", {
        fileIds: [saved.id],
        mode: "summary",
        depth: "deep",
        quickPrompt: `请分析聊天记录「${title}」：提炼关键结论、人物/角色、待办事项、风险、承诺时间点，并输出行动清单表。`,
      });
    }
  }

  async function hydrateDiskLibrary(parentSerial) {
    if (!ctx.ipc?.libraryList || !ctx.ipc?.libraryGetContent) return;
    updateSearchStatus("本地库为空，正在后台检查磁盘资料…");
    try {
      const changed = await withTimeout(
        idb.syncLibraryIntoIdb(ctx.ipc, { force: true }),
        LIBRARY_SYNC_TIMEOUT_MS,
        "同步磁盘资料"
      );
      if (parentSerial !== reloadSerial) return;
      const fresh = await withTimeout(idb.listFiles(), LIBRARY_READ_TIMEOUT_MS, "读取同步结果");
      if (parentSerial !== reloadSerial) return;
      if (Array.isArray(fresh) && fresh.length) {
        items = fresh;
        buildSearchIndex();
        renderAll();
        if (changed) ctx.toast(`已同步 ${fresh.length} 个文件`);
      } else {
        updateSearchStatus("文件库为空，可上传或粘贴聊天记录");
      }
    } catch (e) {
      if (parentSerial !== reloadSerial) return;
      updateSearchStatus("本地库已可用；磁盘同步超时，可稍后点刷新");
      console.warn("[library] background sync timeout", e);
    }
  }

  function scheduleReload() {
    if (reloadTimer) return;
    reloadTimer = window.setTimeout(() => {
      reloadTimer = 0;
      void reload();
    }, 120);
  }

  async function reload() {
    if (reloadInFlight) {
      reloadAgainAfterCurrent = true;
      return reloadInFlight;
    }
    const serial = ++reloadSerial;
    reloadInFlight = (async () => {
      setLibraryLoading(true, "读取本地文件库…");
      loadFailed = false;
      try {
        items = await withTimeout(idb.listFiles(), LIBRARY_READ_TIMEOUT_MS, "读取本地文件库");
        if (serial !== reloadSerial) return;
        buildSearchIndex();
        renderAll();
        if (!items.length) void hydrateDiskLibrary(serial);
      } catch (e) {
        if (serial !== reloadSerial) return;
        loadFailed = true;
        items = [];
        ctx.toast(
          `${m?.messages?.libLoadFailed || ""} ${m?.messages?.libLoadRetry || ""}`.trim() || e?.message || "",
          true
        );
        renderAll();
      } finally {
        if (serial === reloadSerial) setLibraryLoading(false);
      }
    })().finally(() => {
      reloadInFlight = null;
      if (reloadAgainAfterCurrent) {
        reloadAgainAfterCurrent = false;
        scheduleReload();
      }
    });
    return reloadInFlight;
  }

  async function handleFiles(fileList) {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    const end = loadingState(root.querySelector("#libDrop"), p.uploadBusy || "");
    try {
      for (const f of arr) {
        /** @type {any} */
        const fe = f;
        if (fe.path && typeof fe.path === "string") {
          const add = await ctx.ipc.libraryAddFromPath({ filePath: fe.path, apiKey: ctx.getApiKey() });
          await persistFromLibraryResult(add, true);
        } else {
          const b64 = await fileToBase64(f);
          await ingestAndSaveOne({ fileName: f.name, base64: b64, silent: true });
        }
      }
      ctx.toast(m?.messages?.pickFileLoaded?.replace?.("{file}", `${arr.length} 个文件`) || "已上传");
      ctx.emitLibraryChanged();
      await reload();
    } catch (e) {
      ctx.toast(e?.message || "上传失败", true);
    } finally {
      end();
    }
  }

  root.querySelector("#libUpload").addEventListener("click", () => fileInput.click());
  root.querySelector("#libEmptyUpload")?.addEventListener("click", () => fileInput.click());
  root.querySelector("#libEmptyChat")?.addEventListener("click", () => toggleChatPanel(true));
  root.querySelector("#libToggleTools")?.addEventListener("click", () => {
    if (!toolsDrawer) return;
    toolsDrawer.open = !toolsDrawer.open;
    if (toolsDrawer.open) toolsDrawer.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  root.querySelector("#libHubUpload")?.addEventListener("click", () => fileInput.click());
  root.querySelector("#libHubFocusSearch")?.addEventListener("click", () => {
    search.focus();
    search.select();
  });
  function toggleChatPanel(on) {
    const panel = root.querySelector("#libChatPanel");
    if (!panel) return;
    if (toolsDrawer) toolsDrawer.open = true;
    const next = Boolean(on ?? panel.classList.contains("hidden"));
    panel.classList.toggle("hidden", !next);
    panel.style.display = next ? "block" : "none";
    if (next) root.querySelector("#libChatText")?.focus();
  }
  root.querySelector("#libPasteChat")?.addEventListener("click", () => toggleChatPanel(true));
  root.querySelector("#libHubChat")?.addEventListener("click", () => toggleChatPanel(true));
  root.querySelector("#libChatClose")?.addEventListener("click", () => toggleChatPanel(false));
  root.querySelector("#libChatText")?.addEventListener("input", () => {
    const text = String(root.querySelector("#libChatText")?.value || "");
    const stat = root.querySelector("#libChatStat");
    if (stat) stat.textContent = `${text.length.toLocaleString()} 字`;
    const title = root.querySelector("#libChatTitle");
    if (title && !title.value.trim() && text.trim().length > 10) {
      title.value = chatTitleFromText(text);
    }
  });
  root.querySelector("#libChatSave")?.addEventListener("click", () => {
    void saveChatRecord().catch((e) => ctx.toast(e?.message || "保存失败", true));
  });
  root.querySelector("#libChatAnalyze")?.addEventListener("click", () => {
    void saveChatRecord({ analyze: true }).catch((e) => ctx.toast(e?.message || "保存失败", true));
  });
  root.querySelectorAll("[data-lib-qa-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (qaQuestion) {
        qaQuestion.value = btn.getAttribute("data-lib-qa-preset") || "";
        qaQuestion.focus();
      }
    });
  });
  qaScope?.addEventListener("change", updateQaMeta);
  root.addEventListener("change", (e) => {
    if ((/** @type {HTMLElement} */ (e.target)).classList?.contains("lib-cb")) {
      updateQaMeta();
      updateVaultStats();
    }
  });
  root.querySelector("#libQaAsk")?.addEventListener("click", () => {
    void runLibraryQa();
  });
  qaQuestion?.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void runLibraryQa();
    }
  });
  root.querySelector("#libQaCopy")?.addEventListener("click", async () => {
    const text = String(qaAnswer?.value || "").trim();
    if (!text) {
      ctx.toast("还没有答案可复制", true);
      return;
    }
    try {
      await ctx.ipc.copyText(text);
      ctx.toast("问答答案已复制");
    } catch (e) {
      ctx.toast(e?.message || "复制失败", true);
    }
  });
  root.querySelector("#libQaSave")?.addEventListener("click", async () => {
    if (!lastQa?.answer) {
      ctx.toast("请先完成一次资料库问答", true);
      return;
    }
    await historyStore.pushHistory({
      type: "library-qa",
      title: `资料库问答：${lastQa.question.slice(0, 36) || "未命名"}`,
      summary: `${lastQa.records.length} 个文件 · ${lastQa.scope}`,
      content: lastQa.answer,
      meta: {
        question: lastQa.question,
        scope: lastQa.scope,
        fileNames: lastQa.records.map((r) => r.fileName || r.id),
      },
    });
    ctx.emitStoreChanged();
    ctx.toast("已保存到历史记录");
  });
  root.querySelector("#libQaSendAnalysis")?.addEventListener("click", () => {
    const question = String(qaQuestion?.value || "").trim();
    const records = recordsForQaScope(qaScope?.value || "smart");
    if (!records.length) {
      ctx.toast("当前范围没有可分析的文件", true);
      return;
    }
    ctx.navigate("analysis", {
      fileIds: records.slice(0, 18).map((r) => r.id),
      mode: "summary",
      depth: "deep",
      quickPrompt: question || "请跨文件分析这些资料，输出结论、证据文件、风险和下一步行动。",
    });
  });
  fileInput.addEventListener("change", async () => {
    await handleFiles(fileInput.files);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.borderColor = "rgba(96,165,250,0.8)";
    });
  });
  dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "rgba(148,163,184,0.35)";
  });
  dropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "rgba(148,163,184,0.35)";
    const dt = e.dataTransfer;
    if (dt?.files?.length) await handleFiles(dt.files);
  });
  dropZone.addEventListener("click", () => fileInput.click());

  root.querySelector("#libBulkDel").addEventListener("click", async () => {
    const cbs = Array.from(root.querySelectorAll(".lib-cb:checked"));
    if (!cbs.length) {
      ctx.toast(p.toastSelectDelete || "", true);
      return;
    }
    const ids = cbs.map((c) => c.getAttribute("data-id")).filter(Boolean);
    const records = ids
      .map((id) => items.find((x) => x.id === id))
      .filter(Boolean);
    await softDeleteFiles(records, `已删除 ${records.length} 个文件 · 15s 内可撤销`);
    selectedId = null;
    await reload();
  });

  root.querySelector("#libToAnalysis").addEventListener("click", () => {
    const ids = Array.from(root.querySelectorAll(".lib-cb:checked"))
      .map((c) => c.getAttribute("data-id"))
      .filter(Boolean);
    const use = ids.length ? ids : selectedId ? [selectedId] : [];
    if (!use.length) {
      ctx.toast(p.toastSelectSend || "", true);
      return;
    }
    ctx.navigate("analysis", { fileIds: use });
  });

  root.querySelector("#libToGen").addEventListener("click", () => {
    const ids = Array.from(root.querySelectorAll(".lib-cb:checked"))
      .map((c) => c.getAttribute("data-id"))
      .filter(Boolean);
    const use = ids.length ? ids : selectedId ? [selectedId] : [];
    if (!use.length) {
      ctx.toast(p.toastSelectSend || "", true);
      return;
    }
    ctx.navigate("generator", { fileIds: use });
  });

  root.querySelector("#libMainBack").addEventListener("click", () => {
    void persistReadCursor();
    if (readerChromeCollapsed) setReaderChromeCollapsed(false);
    toggleMainReader(false);
  });
  root.querySelector("#libMainFocusToggle")?.addEventListener("click", () => {
    setReaderChromeCollapsed(!readerChromeCollapsed);
    requestAnimationFrame(() => {
      if (mainPreviewKind === "native") mainNativeWrap.scrollTop = mainNativeWrap.scrollTop;
      else mainArticle.scrollTop = mainArticle.scrollTop;
    });
  });
  root.querySelector("#libMainArchiveSave")?.addEventListener("click", async () => {
    if (!selectedId) return;
    const cursor = buildReadCursor();
    if (!cursor) {
      ctx.toast("当前阅读位置无法存档", true);
      return;
    }
    try {
      await idb.patchFile(selectedId, { readArchive: cursor, readCursor: cursor });
      const rec = items.find((x) => x.id === selectedId);
      if (rec) {
        rec.readArchive = cursor;
        rec.readCursor = cursor;
        mainCurrentRecord = rec;
      }
      const btn = root.querySelector("#libMainArchiveGo");
      if (btn) {
        btn.disabled = false;
        btn.title = `跳回存档：${new Date(cursor.updatedAt).toLocaleString()}`;
      }
      ctx.toast("阅读位置已存档");
    } catch (e) {
      ctx.toast(e?.message || "存档失败", true);
    }
  });
  root.querySelector("#libMainArchiveGo")?.addEventListener("click", () => {
    const rec = selectedRec();
    if (!rec?.readArchive) {
      ctx.toast("还没有存档位置", true);
      return;
    }
    const mode = rec.readArchive.mode;
    if (mode === "native") {
      void loadNativePreview(rec).then(() => {
        restoreReadCursor(rec, { archiveOnly: true });
        ctx.toast("已回到上次存档位置");
      });
    } else if (mode === "edit" && canEditTextFile(rec)) {
      setMainEditMode(true);
      restoreReadCursor(rec, { archiveOnly: true });
      ctx.toast("已回到上次存档位置");
    } else {
      ensureMainTextMode();
      restoreReadCursor(rec, { archiveOnly: true });
      ctx.toast("已回到上次存档位置");
    }
  });
  root.querySelector("#libReaderTextView")?.addEventListener("click", () => {
    ensureMainTextMode();
    applyReaderViewPrefs();
  });
  root.querySelector("#libReaderNativeView")?.addEventListener("click", () => {
    const rec = mainCurrentRecord || selectedRec();
    if (!rec) return;
    void loadNativePreview(rec);
  });
  root.querySelector("#libReaderZoomOut")?.addEventListener("click", () => setReaderFont(-1));
  root.querySelector("#libReaderZoomIn")?.addEventListener("click", () => setReaderFont(1));
  root.querySelector("#libReaderWidth")?.addEventListener("change", (e) => {
    readerWidthMode = e.target?.value || "wide";
    if (!["comfortable", "wide", "full"].includes(readerWidthMode)) readerWidthMode = "wide";
    applyReaderViewPrefs();
  });
  root.querySelector("#libReaderTop")?.addEventListener("click", () => {
    mainArticle.scrollTo({ top: 0, behavior: "smooth" });
    mainNativeWrap.scrollTo({ top: 0, behavior: "smooth" });
  });
  root.querySelector("#libMainToAnalysis").addEventListener("click", () => {
    if (!selectedId) return;
    ctx.navigate("analysis", { fileIds: [selectedId] });
  });
  root.querySelector("#libMainToGen").addEventListener("click", () => {
    if (!selectedId) return;
    ctx.navigate("generator", { fileIds: [selectedId] });
  });
  root.querySelector("#libMainOpenOs").addEventListener("click", async () => {
    if (!selectedId) return;
    try {
      await ctx.ipc.libraryOpenOriginal({ id: selectedId });
    } catch (e) {
      ctx.toast(e?.message || "无法打开", true);
    }
  });
  root.querySelector("#libMainCopy").addEventListener("click", async () => {
    const rec = selectedRec();
    if (!rec) return;
    try {
      await ctx.ipc.copyText(String(rec.content || ""));
      ctx.toast("全文已复制");
    } catch (e) {
      ctx.toast(e?.message || "复制失败", true);
    }
  });
  root.querySelector("#libMainEditText")?.addEventListener("click", () => {
    const rec = selectedRec();
    if (!rec) return;
    if (!canEditReadableContent(rec)) {
      ctx.toast("这个文件暂时没有可编辑正文，可先重新解析或保存标注。", true);
      return;
    }
    setMainEditMode(true);
  });
  root.querySelector("#libMainCancelEdit")?.addEventListener("click", () => {
    mainBaseText = mainEditOriginalText;
    setMainEditMode(false);
    renderMainArticle();
    ctx.toast("已取消编辑");
  });
  root.querySelector("#libMainSaveText")?.addEventListener("click", async () => {
    if (!selectedId) return;
    const rec = selectedRec();
    if (!rec || !canEditReadableContent(rec)) {
      ctx.toast("没有可保存的正文内容", true);
      return;
    }
    const text = String(mainTextEditor.value || "");
    try {
      if (canEditTextFile(rec)) {
        const r = await ctx.ipc.librarySaveTextContent({ id: selectedId, text, apiKey: ctx.getApiKey() });
        await persistFromLibraryResult(r);
      } else {
        const stats = textStats(text);
        await idb.patchFile(selectedId, {
          content: text,
          preview: stats.preview,
          charCount: stats.charCount,
          lineCount: stats.lineCount,
          editedAt: Date.now(),
          contentEditedInApp: true,
        });
        try {
          await ctx.ipc?.libraryUpdateMeta?.({
            id: selectedId,
            patch: { preview: stats.preview, charCount: stats.charCount, lineCount: stats.lineCount, editedAt: Date.now() },
          });
        } catch {
          // 没有原始文件记录时只保存到 IndexedDB。
        }
      }
      mainBaseText = text;
      setMainEditMode(false);
      ctx.toast(canEditTextFile(rec) ? "正文修改已保存到原文件" : "阅读内容已保存为本地副本");
      ctx.emitLibraryChanged();
      await reload();
      const fresh = items.find((x) => x.id === selectedId) || { ...rec, content: text };
      fillMainReader({ ...fresh, content: text });
    } catch (e) {
      ctx.toast(e?.message || "保存正文失败", true);
    }
  });
  root.querySelector("#libMainTitle")?.addEventListener("blur", () => {
    void saveMainTitle();
  });
  root.querySelector("#libMainTitle")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.currentTarget.blur();
    }
  });
  root.querySelector("#libMainSavePhrase").addEventListener("click", () => {
    const rec = selectedRec();
    if (!rec) {
      ctx.toast("请先打开一个文件", true);
      return;
    }
    let pickedText = "";
    try {
      const sel = window.getSelection?.();
      if (sel && sel.toString().trim()) pickedText = sel.toString().trim();
    } catch {
      // ignore
    }
    if (!pickedText) {
      const activeEl =
        mainArticle.querySelector(".lib-main-line-active") ||
        (mainMatchIdx >= 0 ? mainArticle.querySelector(`mark[data-hit-index="${mainMatchIdx}"]`) : null);
      if (activeEl) {
        const containingLine = activeEl.closest("p, div");
        pickedText = String(containingLine?.textContent || activeEl.textContent || "").trim();
      }
    }
    if (!pickedText) {
      const lines = String(mainBaseText || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      pickedText = (lines[0] || "").slice(0, 200);
    }
    if (!pickedText) {
      ctx.toast("没有可保存的内容，请先选中或搜索定位到一句", true);
      return;
    }
    ctx.navigate("phrasebook", {
      phrasePrefill: {
        text: pickedText,
        category: rec.category || "",
        tags: Array.isArray(rec.tags) ? rec.tags.slice(0, 6) : [],
        source: rec.fileName || "",
        note: "",
      },
    });
  });
  root.querySelector("#libMainSaveMeta").addEventListener("click", async () => {
    if (!selectedId) return;
    const tags = String(root.querySelector("#libMainTags").value || "")
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const category = String(root.querySelector("#libMainCategory").value || "").trim();
    const priority = String(root.querySelector("#libMainPriority").value || "").trim();
    const annotationNote = String(root.querySelector("#libMainNote").value || "").trim();
    const memoryNote = String(root.querySelector("#libMainMemory").value || "").trim();
    try {
      try {
        await ctx.ipc.libraryUpdateTags({ id: selectedId, tags });
      } catch {
        // 种子资料可能只有 IndexedDB 副本，没有主进程原文件。
      }
      await idb.patchFile(selectedId, {
        tags,
        category,
        priority,
        annotationNote,
        memoryNote,
        readCursor: buildReadCursor(),
      });
      ctx.toast("标注与记忆已保存");
      await reload();
      const rec = items.find((x) => x.id === selectedId);
      if (rec) fillMainReader({ ...rec, tags, category, priority, annotationNote, memoryNote });
    } catch (e) {
      ctx.toast(e?.message || "保存失败", true);
    }
  });
  function updateMainHitNavUi() {
    const nav = root.querySelector("#libMainHitNav");
    const cnt = root.querySelector("#libMainHitCount");
    if (!nav || !cnt) return;
    if (!mainMatches.length) {
      nav.classList.add("hidden");
      cnt.textContent = "0/0";
      return;
    }
    nav.classList.remove("hidden");
    const cur = Math.max(0, mainMatchIdx);
    cnt.textContent = `${cur + 1}/${mainMatches.length}`;
  }
  function applyMainSearch({ immediate = false } = {}) {
    const run = () => {
      refreshMainMatches();
      if (!String(mainKw.value || "").trim()) {
        mainMatchIdx = -1;
        renderMainArticle();
        mainStat.textContent = "";
        if (mainDebug) mainDebug.textContent = "";
        updateMainHitNavUi();
        return;
      }
      if (!mainMatches.length) {
        mainMatchIdx = -1;
        renderMainArticle();
        mainStat.textContent = "未命中";
        if (mainDebug) mainDebug.textContent = "没有找到匹配内容";
        updateMainHitNavUi();
        return;
      }
      mainMatchIdx = 0;
      renderMainArticle();
      mainStat.textContent = `命中 ${mainMatches.length} 处 · 第 1 处`;
      if (mainDebug) mainDebug.textContent = "按 Enter 跳到下一处，Shift+Enter 跳到上一处";
      updateMainHitNavUi();
    };
    clearTimeout(mainSearchDebounceTimer);
    if (immediate) run();
    else mainSearchDebounceTimer = window.setTimeout(run, 120);
  }
  mainKw.addEventListener("input", () => applyMainSearch());
  mainKw.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      applyMainSearch({ immediate: true });
      if (mainMatches.length) jumpMain(ev.shiftKey ? -1 : 1);
      else searchAndJumpMain();
    } else if (ev.key === "Escape" && mainKw.value) {
      ev.preventDefault();
      mainKw.value = "";
      applyMainSearch({ immediate: true });
    }
  });
  root.querySelector("#libMainSearch").addEventListener("click", () => {
    searchAndJumpMain();
    updateMainHitNavUi();
  });
  root.querySelector("#libMainHitPrev")?.addEventListener("click", () => {
    jumpMain(-1);
    updateMainHitNavUi();
  });
  root.querySelector("#libMainHitNext")?.addEventListener("click", () => {
    jumpMain(1);
    updateMainHitNavUi();
  });
  root.querySelector("#libMainHitClose")?.addEventListener("click", () => {
    mainKw.value = "";
    refreshMainMatches();
    mainMatchIdx = -1;
    renderMainArticle();
    mainStat.textContent = "";
    updateMainHitNavUi();
    mainKw.focus();
  });
  root.querySelector("#libMainPrevFloat").addEventListener("click", () => {
    jumpMain(-1);
    updateMainHitNavUi();
  });
  root.querySelector("#libMainNextFloat").addEventListener("click", () => {
    jumpMain(1);
    updateMainHitNavUi();
  });
  mainArticle.addEventListener("scroll", () => {
    void persistReadCursor();
  });
  mainNativeWrap.addEventListener("scroll", () => {
    void persistReadCursor();
  });
  mainTextEditor.addEventListener("scroll", () => {
    void persistReadCursor();
  });

  root.querySelector("#libRefresh").addEventListener("click", reload);
  root.querySelector("#libMapRefresh")?.addEventListener("click", () => {
    renderLibraryMap();
    ctx.toast("资料地图已刷新");
  });
  root.querySelector("#libMapOrganize")?.addEventListener("click", () => {
    void autoOrganizeCurrentScope().catch((e) => ctx.toast(e?.message || "整理失败", true));
  });
  function resetListPage() {
    listPageIndex = 0;
  }

  function applySearchInput({ immediate = false } = {}) {
    const next = normalizeQuery(search.value);
    if (next === activeSearchQuery) return;
    updateSearchStatus(next ? "正在搜索…" : "输入关键词搜索");
    const run = () => {
      activeSearchQuery = next;
      resetListPage();
      if (activeSearchQuery && sortSel.value !== "relevance") {
        sortSel.value = "relevance";
      }
      libHitIndex = 0;
      renderAll();
    };
    clearTimeout(searchDebounceTimer);
    if (immediate) run();
    else searchDebounceTimer = window.setTimeout(run, 140);
  }
  search.addEventListener("input", () => applySearchInput());
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applySearchInput({ immediate: true });
      if (!libHitTargets.length) return;
      gotoNextLibHit(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape" && search.value) {
      e.preventDefault();
      search.value = "";
      applySearchInput({ immediate: true });
    }
  });
  root.querySelector("#libHitNext")?.addEventListener("click", () => gotoNextLibHit(1));
  root.querySelector("#libHitPrev")?.addEventListener("click", () => gotoNextLibHit(-1));
  root.querySelector("#libHitClose")?.addEventListener("click", () => {
    search.value = "";
    applySearchInput({ immediate: true });
    search.focus();
  });
  // 全局 "/" 聚焦：阅读器内时聚焦阅读器关键词；列表态聚焦顶部搜索
  const onLibKey = (ev) => {
    if (ev.key === "/" && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
      const tgt = ev.target;
      const tag = tgt && /** @type {HTMLElement} */ (tgt).tagName;
      const editable = tgt && /** @type {HTMLElement} */ (tgt).isContentEditable;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || editable) return;
      ev.preventDefault();
      if (inMainReader) {
        mainKw.focus();
        mainKw.select();
      } else {
        search.focus();
        search.select();
      }
    }
  };
  document.addEventListener("keydown", onLibKey);
  filter.addEventListener("change", () => {
    resetListPage();
    renderAll();
  });
  sortSel.addEventListener("change", () => {
    resetListPage();
    renderAll();
  });
  onlyFav.addEventListener("change", () => {
    resetListPage();
    renderAll();
  });
  viewSel.addEventListener("change", () => {
    resetListPage();
    renderAll();
  });
  pageSizeSel?.addEventListener("change", () => {
    resetListPage();
    renderAll();
  });
  pagePrev?.addEventListener("click", () => {
    listPageIndex = Math.max(0, listPageIndex - 1);
    renderAll();
  });
  pageNext?.addEventListener("click", () => {
    listPageIndex += 1;
    renderAll();
  });

  root.querySelector("#libCheckAll").addEventListener("change", (e) => {
    const on = /** @type {HTMLInputElement} */ (e.target).checked;
    root.querySelectorAll(".lib-cb").forEach((c) => {
      /** @type {HTMLInputElement} */ (c).checked = on;
    });
  });

  root.querySelector("#libOpenOs").addEventListener("click", async () => {
    if (!selectedId) return;
    try {
      await ctx.ipc.libraryOpenOriginal({ id: selectedId });
    } catch (e) {
      ctx.toast(e?.message || "无法打开", true);
    }
  });

  root.querySelector("#libOpenInApp").addEventListener("click", () => {
    const rec = selectedRec();
    if (!rec) {
      ctx.toast("请先选中文件", true);
      return;
    }
    openInAppByRecord(rec);
  });

  root.querySelector("#libCopyContent").addEventListener("click", async () => {
    const rec = selectedRec();
    if (!rec) return;
    try {
      await ctx.ipc.copyText(String(rec.content || ""));
      ctx.toast("全文已复制");
    } catch (e) {
      ctx.toast(e?.message || "复制失败", true);
    }
  });

  root.querySelector("#libReparse").addEventListener("click", async () => {
    if (!selectedId) return;
    try {
      const r = await ctx.ipc.libraryReparse({ id: selectedId, apiKey: ctx.getApiKey() });
      await persistFromLibraryResult(r);
      ctx.toast("已重新解析");
      ctx.emitLibraryChanged();
      await reload();
      const rec = items.find((x) => x.id === selectedId);
      if (rec) showDetailLocal(rec);
    } catch (e) {
      ctx.toast(e?.message || "重新解析失败", true);
    }
  });

  root.querySelector("#libDelOne").addEventListener("click", async () => {
    if (!selectedId) return;
    const rec = items.find((x) => x.id === selectedId);
    if (!rec) return;
    await softDeleteFiles([rec], `已删除「${rec.fileName || rec.title || "文件"}」 · 15s 内可撤销`);
    selectedId = null;
    await reload();
  });

  root.querySelector("#libSaveMeta").addEventListener("click", async () => {
    if (!selectedId) return;
    const raw = root.querySelector("#libTags").value;
    const tags = raw
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const category = root.querySelector("#libCategory").value.trim();
    const priority = root.querySelector("#libPriority").value.trim();
    const annotationNote = root.querySelector("#libNote").value.trim();
    const memoryEl = root.querySelector("#libMemory");
    const memoryNote = memoryEl ? String(memoryEl.value || "").trim() : undefined;
    try {
      try {
        await ctx.ipc.libraryUpdateTags({ id: selectedId, tags });
      } catch {
        // 种子资料可能只有 IndexedDB 副本，没有主进程原文件。
      }
      const patch = { tags, category, priority, annotationNote };
      if (memoryNote !== undefined) patch.memoryNote = memoryNote;
      await idb.patchFile(selectedId, patch);
      ctx.toast("标签与标注已保存");
      await reload();
      const rec = items.find((x) => x.id === selectedId);
      if (rec) showDetailLocal({ ...rec, ...patch });
    } catch (e) {
      ctx.toast(e?.message || "保存失败", true);
    }
  });

  readerKw.addEventListener("input", refreshReaderMatches);
  root.querySelector("#libReaderPrev").addEventListener("click", () => jumpReader(-1));
  root.querySelector("#libReaderNext").addEventListener("click", () => jumpReader(1));

  const onStore = () => scheduleReload();
  window.addEventListener(idb.STORE_CHANGED_EVENT, onStore);
  window.addEventListener("ai-pro-library-changed", onStore);
  reload().then(() => {
    if (ctx.navPayload?.fileIds?.length) {
      selectedId = ctx.navPayload.fileIds[0];
      const rec = items.find((x) => x.id === selectedId);
      if (rec) showDetailLocal(rec);
      renderAll();
    }
    if (ctx.navPayload?.quickSearch) {
      search.value = String(ctx.navPayload.quickSearch || "").trim();
      applySearchInput();
      window.setTimeout(() => {
        search.focus();
        search.select();
      }, 0);
    }
    if (ctx.navPayload?.qaQuestion) {
      if (qaQuestion) qaQuestion.value = String(ctx.navPayload.qaQuestion || "").trim();
      updateQaMeta();
      window.setTimeout(() => {
        qaQuestion?.focus();
        qaQuestion?.select();
        root.querySelector(".library-qa-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    }
    if (ctx.navPayload?.autoUpload) {
      window.setTimeout(() => fileInput.click(), 180);
    }
  });

  return {
    destroy() {
      clearTimeout(searchDebounceTimer);
      clearTimeout(mainSearchDebounceTimer);
      clearTimeout(reloadTimer);
      void persistReadCursor();
      // 离开页面时立即提交还在倒计时的删除（落盘删除）
      try { undoMgr.clear(); } catch { /* ignore */ }
      window.removeEventListener(idb.STORE_CHANGED_EVENT, onStore);
      window.removeEventListener("ai-pro-library-changed", onStore);
      document.removeEventListener("keydown", onLibKey);
      root.innerHTML = "";
    },
  };
}
