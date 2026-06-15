import * as historyStore from "../services/historyStore.js";
import * as idb from "../services/idbStore.js";
import { appendDeliverySections } from "../services/deliveryAppendix.js";
import { runDeliveryQuality } from "../services/deliveryQuality.js";
import {
  currentProjectName,
  loadWorkbenchVersions,
  LS_GENERATOR_VERSIONS,
  pushWorkbenchVersion,
} from "../services/workbenchShared.js";
import { el, errorState } from "../core/ui.js";

/**
 * 打包版 `file://` + asar 下，顶层静态 import `marked` 会导致整页 app.js 加载失败（主区空白）。
 * 仅在进入本页时动态加载 markdown 引擎。
 */
export async function mountDocumentGenerator(root, ctx) {
  root.innerHTML = "";
  let markdownToSafeHtml;
  /** @type {(md: string) => string} */
  let markdownToSafeHtmlWithAnchors;
  /** @type {(html: string) => string} */
  let buildPreviewTocHtml;
  let buildPrintableHtmlDocument;
  let prependDeliverableYaml;
  let buildSlidesHtmlDocument;
  try {
    const mod = await import("../services/markdownPreview.js");
    markdownToSafeHtml = mod.markdownToSafeHtml;
    markdownToSafeHtmlWithAnchors = mod.markdownToSafeHtmlWithAnchors || mod.markdownToSafeHtml;
    buildPreviewTocHtml = mod.buildPreviewTocHtml || (() => "");
    buildPrintableHtmlDocument = mod.buildPrintableHtmlDocument;
    prependDeliverableYaml = mod.prependDeliverableYaml;
    buildSlidesHtmlDocument = mod.buildSlidesHtmlDocument;
  } catch (e) {
    errorState(root, `Markdown 引擎加载失败：${e?.message || e}`);
    return {
      destroy() {
        root.innerHTML = "";
      },
    };
  }

  const m = ctx.manifest();
  const st = ctx.settings();
  const p = m.pages?.generator || {};
  const toneOpts = (m.documentGenToneOptions || [])
    .map((o) => `<option value="${String(o.value).replace(/"/g, "&quot;")}">${o.label || ""}</option>`)
    .join("");

  root.appendChild(
    el(`
    <div class="dg-page dg-page--workbench">
    <div class="page-head dg-page-head">
      <div>
        <h1 class="page-title">${p.title || ""}</h1>
        <p class="page-sub page-sub--tight">${p.subtitle || ""}</p>
      </div>
    </div>
    <div class="wb-sticky wb-sticky--top dg-wb-sticky">
      <button type="button" class="btn btn-primary" id="dgGenTop">${p.wbStickyGen || p.genBtn || ""}</button>
      <button type="button" class="btn btn-secondary" id="dgSaveTop">${p.wbStickySave || p.saveHist || ""}</button>
      <button type="button" class="btn btn-secondary" id="dgCopyTop">${p.wbStickyCopy || p.copy || ""}</button>
      <button type="button" class="btn btn-secondary" id="dgDownTop">${p.wbStickyDown || p.download || ""}</button>
    </div>
    <div class="dg-toolbox" id="dgToolbox">
      <div class="dg-toolbox-row">
        <div class="dg-toolbox-group" title="保存当前所有配置（类型/语气/行业/受众/结构/长度/参考/req）为一个预设，下次一键还原">
          <label class="dg-toolbox-label">💾 预设</label>
          <select class="inp dg-toolbox-select" id="dgPresetSel"><option value="">— 选择已保存预设 —</option></select>
          <button type="button" class="btn btn-ghost btn-sm" id="dgPresetSave" title="存为新预设">＋</button>
          <button type="button" class="btn btn-ghost btn-sm" id="dgPresetDel" title="删除当前预设" disabled>🗑</button>
        </div>
        <div class="dg-toolbox-group" title="最近 10 次生成请求，可一键回填表单">
          <label class="dg-toolbox-label">🕘 最近</label>
          <select class="inp dg-toolbox-select" id="dgRecentSel"><option value="">— 最近生成 —</option></select>
        </div>
      </div>
      <div class="dg-toolbox-row">
        <div class="dg-toolbox-group">
          <label class="dg-toolbox-label" title="生成风格：先大纲、人工调整、再展开成全文（推荐用于长文档）">🧭 大纲优先</label>
          <label class="dg-toolbox-switch">
            <input type="checkbox" id="dgOutlineMode" />
            <span class="dg-toolbox-switch-track"><span class="dg-toolbox-switch-thumb"></span></span>
          </label>
          <button type="button" class="btn btn-secondary btn-sm" id="dgOutlineExpand" disabled style="display:none">展开全文</button>
        </div>
        <div class="dg-toolbox-group" title="按当前 req 长度估算 token 与近似费用（按 ¥0.014/1K input）">
          <label class="dg-toolbox-label">💰 预算</label>
          <span class="dg-budget-pill" id="dgBudgetPill">≈ 0 tok</span>
        </div>
        <div class="dg-toolbox-group dg-toolbox-group--push">
          <button type="button" class="btn btn-ghost btn-sm" id="dgKbdHelp" title="键盘快捷键说明">⌨ 快捷键</button>
        </div>
      </div>
      <div class="dg-toolbox-row">
        <div class="dg-toolbox-group" title="同时生成多个变体（不同温度），生成后并排展示供你选优">
          <label class="dg-toolbox-label">🎲 并行</label>
          <select class="inp dg-toolbox-select" id="dgVariantN" style="max-width:90px">
            <option value="1" selected>×1</option>
            <option value="2">×2</option>
            <option value="3">×3</option>
          </select>
        </div>
        <div class="dg-toolbox-group" title="队列：批量提交多个生成任务，依次执行；适合"周报五份一次性来"">
          <label class="dg-toolbox-label">🛒 队列</label>
          <button type="button" class="btn btn-ghost btn-sm" id="dgQueueAdd">＋ 加入队列</button>
          <button type="button" class="btn btn-secondary btn-sm" id="dgQueueRun" disabled>▶ 运行 (<span id="dgQueueN">0</span>)</button>
          <button type="button" class="btn btn-ghost btn-sm" id="dgQueueClear" disabled>🗑</button>
        </div>
        <div class="dg-toolbox-group" title="导出时自动在文档前面加标题页（标题/作者/日期/保密戳）">
          <label class="dg-toolbox-label">📄 封面页</label>
          <label class="dg-toolbox-switch">
            <input type="checkbox" id="dgCoverPage" />
            <span class="dg-toolbox-switch-track"><span class="dg-toolbox-switch-thumb"></span></span>
          </label>
        </div>
        <div class="dg-toolbox-group dg-toolbox-group--push">
          <button type="button" class="btn btn-ghost btn-sm" id="dgBrandPack" title="品牌包：Logo / 主色 / 公司名 / 页脚，作用于导出">🏢 品牌包</button>
          <button type="button" class="btn btn-ghost btn-sm" id="dgTplExport" title="导出全部预设 + 我的模板为 .tpl.json">📦 导出</button>
          <button type="button" class="btn btn-ghost btn-sm" id="dgTplImport" title="从 .tpl.json 导入预设 + 模板">📥 导入</button>
          <input type="file" id="dgTplImportInput" accept=".json,.tpl.json" style="display:none" />
        </div>
      </div>
    </div>
    <div class="workbench dg-workbench">
    <div class="wb-body dg-wb-body">
    <nav class="wb-tabs dg-wb-tabs" role="tablist">
      <button type="button" class="wb-tab is-active" data-dg-tab="input">${p.wbTabInput || ""}</button>
      <button type="button" class="wb-tab" data-dg-tab="output">${p.wbTabOutput || ""}</button>
      <button type="button" class="wb-tab" data-dg-tab="export">${p.wbTabExport || ""}</button>
      <button type="button" class="wb-tab" data-dg-tab="versions">${p.wbTabVersions || ""}</button>
    </nav>
    <div class="wb-panel is-active dg-input-panel" data-dg-panel="input">
    <div class="dg-hero-strip">
      <div class="dg-hero-strip-text">
        <span class="dg-eyebrow">Delivery Studio</span>
        <span class="dg-hero-strip-title">一句话生成正式文件</span>
      </div>
      <div class="dg-hero-strip-tags" aria-hidden="true">
        <span>报告 / 提案</span>
        <span>表格 / 清单</span>
        <span>Word · PDF · Excel</span>
      </div>
    </div>

    <section class="dg-practical-panel" aria-label="常用生成入口">
      <div class="dg-practical-head">
        <div>
          <h2>选择你要交付的东西</h2>
          <p>不用研究参数，点一个场景，写一句需求，直接生成。</p>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="dgAutoRoute">自动判断场景</button>
      </div>
      <div class="dg-practical-grid">
        <button type="button" class="dg-practical-card is-active" data-practical="boss">
          <b>老板汇报</b><span>结论、风险、下一步</span>
        </button>
        <button type="button" class="dg-practical-card" data-practical="client">
          <b>客户方案</b><span>背景、方案、报价、交付</span>
        </button>
        <button type="button" class="dg-practical-card" data-practical="table">
          <b>表格台账</b><span>Excel 可用，字段清楚</span>
        </button>
        <button type="button" class="dg-practical-card" data-practical="meeting">
          <b>会议纪要</b><span>决议、待办、负责人</span>
        </button>
        <button type="button" class="dg-practical-card" data-practical="contract">
          <b>合同风险</b><span>条款、等级、修改建议</span>
        </button>
        <button type="button" class="dg-practical-card" data-practical="finance">
          <b>财务摘要</b><span>数据解读、现金流、风险</span>
        </button>
      </div>
    </section>

    <!-- ════ 主流程：写文档（始终展开，最重要的 3 件事在这里完成）════ -->
    <section class="dg-flow dg-flow--primary" aria-label="文档生成主流程">
      <header class="dg-flow-head">
        <span class="dg-flow-icon">✍</span>
        <div>
          <h3>1 · 写文档</h3>
          <p>写一句需求即可；系统会按场景补全结构、篇幅、表格和导出建议。</p>
        </div>
      </header>

      <div class="dg-form-grid dg-form-grid--three">
        <label class="dg-field">
          <span>${p.genType || "文档类型"}</span>
          <select class="inp" id="dgType"></select>
        </label>
        <label class="dg-field">
          <span>${p.toneLabel || "语气"}</span>
          <select class="inp" id="dgTone">${toneOpts}</select>
        </label>
        <label class="dg-field">
          <span>${p.ctrlIndustry || "行业"}</span>
          <input class="inp" id="dgIndustry" placeholder="如：SaaS / 制造 / 教育" />
        </label>
      </div>

      <label class="dg-field dg-field--req">
        <span>${p.reqLabel || "写作要求 · 必填"}</span>
        <div class="dg-smartbar" aria-label="智能写作入口">
          <button type="button" class="dg-smart-chip" data-smart-pack="boss">老板汇报</button>
          <button type="button" class="dg-smart-chip" data-smart-pack="client">客户方案</button>
          <button type="button" class="dg-smart-chip" data-smart-pack="investor">投资人材料</button>
          <button type="button" class="dg-smart-chip" data-smart-pack="table">表格优先</button>
          <span class="dg-smartbar-hint">只写一句也可以，系统会补成可交付指令</span>
        </div>
        <textarea class="inp" id="dgReq" rows="6" placeholder="例如：基于最近上传的资料，给老板做一份项目进度汇报，突出风险、预算和下周动作。"></textarea>
      </label>

      <div class="dg-primary-actions">
        <button type="button" class="btn btn-primary btn-lg" id="dgGen">${p.genBtn || "🚀 生成文档"}</button>
        <button type="button" class="btn btn-secondary btn-sm" id="dgSmartBrief" title="把当前一句话需求扩成结构化专业指令">✨ 智能补全</button>
        <button type="button" class="btn btn-secondary btn-sm" id="dgOneClick" title="自动补全并立即生成交付版">⚡ 一键交付</button>
        <button type="button" class="btn btn-secondary btn-sm" id="dgGoRefs">引用资料</button>
        <button type="button" class="btn btn-secondary btn-sm" id="dgSaveHist">${p.saveHist || "💾 存历史"}</button>
        <label class="dg-cite-toggle">
          <input type="checkbox" id="dgCite" checked />
          <span>引用下方勾选的文件</span>
        </label>
        <span class="dg-primary-hint">生成后到「输出」润色、挑刺，到「导出」保存正式文件</span>
      </div>
    </section>

    <!-- ════ 调味料：所有可选项 collapsed，按需展开 ════ -->
    <section class="dg-flow dg-flow--tune" aria-label="可选调味项">
      <header class="dg-flow-head">
        <span class="dg-flow-icon">🎛️</span>
        <div>
          <h3>2 · 调味（可选）</h3>
          <p>不展开也能生成；想做得更贴合时再点开对应小块。</p>
        </div>
      </header>

      <details class="dg-tune-item">
        <summary>
          <span class="dg-tune-ico">🎯</span>
          <span class="dg-tune-title">受众 · 结构 · 篇幅</span>
          <span class="dg-tune-meta" id="dgTuneSpecMeta">默认</span>
        </summary>
        <div class="dg-tune-body">
          <div class="dg-form-grid dg-form-grid--four">
            <label class="dg-field"><span>${p.docPurposeLabel || "文档用途"}</span><select class="inp" id="dgDocPurpose"></select></label>
            <label class="dg-field"><span>${p.docAudienceLabel || "阅读对象"}</span><select class="inp" id="dgDocAudience"></select></label>
            <label class="dg-field"><span>${p.docStructureLabel || "输出结构"}</span><select class="inp" id="dgDocStructure"></select></label>
            <label class="dg-field"><span>篇幅</span><select class="inp" id="dgLenTier"></select></label>
          </div>
        </div>
      </details>

      <details class="dg-tune-item">
        <summary>
          <span class="dg-tune-ico">🪄</span>
          <span class="dg-tune-title">写作定位 · Prompt 组装</span>
          <span class="dg-tune-meta">一键插入到写作要求开头</span>
        </summary>
        <div class="dg-tune-body">
          <div class="dg-form-grid dg-form-grid--prompt">
            <label class="dg-field"><span>${p.pbIndustry || "行业"}</span><input class="inp" id="dgPbIndustry" placeholder="金融 / 科技 / 制造" /></label>
            <label class="dg-field"><span>${p.pbAudience || "受众"}</span><input class="inp" id="dgPbAudience" placeholder="老板 / 客户 / 投资人" /></label>
            <label class="dg-field"><span>${p.pbPurpose || "目的"}</span><input class="inp" id="dgPbPurpose" placeholder="汇报 / 签约 / 招商" /></label>
            <button type="button" class="btn btn-secondary btn-sm dg-field-action" id="dgPbApply">${p.pbApply || "写入前缀"}</button>
          </div>
          <p class="muted dg-tpl-hint">${p.selHint || "选中正文后可用浮动条做局部润色。"}</p>
        </div>
      </details>

      <details class="dg-tune-item">
        <summary>
          <span class="dg-tune-ico">📎</span>
          <span class="dg-tune-title">${p.refsTitle || "参考资料"}</span>
          <span class="dg-tune-meta" id="dgTuneRefsMeta">未选</span>
        </summary>
        <div class="dg-tune-body">
          <div class="dg-refs-toolbar">
            <input type="search" class="inp" id="dgRefsSearch" placeholder="过滤文件名 / 标签…" />
            <span class="muted dg-tpl-hint">勾选真实资料后再生成，AI 会按这些素材写作。</span>
          </div>
          <div id="dgRefs" class="muted dg-refs-list">${p.refsLoading || "正在载入文件库…"}</div>
        </div>
      </details>

      <details class="dg-tune-item">
        <summary>
          <span class="dg-tune-ico">📂</span>
          <span class="dg-tune-title">${p.tplSuiteTitle || "套用模板"}</span>
          <span class="dg-tune-meta">替换写作要求</span>
        </summary>
        <div class="dg-tune-body">
          <div class="dg-form-grid dg-form-grid--template">
            <label class="dg-field">
              <span>${p.tplLabel || "选择场景模板"}</span>
              <select class="inp" id="dgTplSelect"><option value="">${p.tplPlaceholder || "选择模板后可微调再生成"}</option></select>
            </label>
            <button type="button" class="btn btn-secondary btn-sm dg-field-action" id="dgTplApply">${p.tplApply || "应用"}</button>
          </div>
          <p class="muted dg-tpl-hint">${p.tplHint || "模板填充写作要求与可选文档类型。"}</p>
        </div>
      </details>

      <details class="dg-tune-item">
        <summary>
          <span class="dg-tune-ico">⚙️</span>
          <span class="dg-tune-title">导出偏好</span>
          <span class="dg-tune-meta" id="dgTuneExportMeta">主题 · 公开</span>
        </summary>
        <div class="dg-tune-body">
          <div class="dg-form-grid dg-form-grid--four">
            <label class="dg-field">
              <span>${p.themeLabel || "HTML 主题"}</span>
              <select class="inp" id="dgHtmlTheme"></select>
            </label>
            <label class="dg-field">
              <span>${p.confidentialLabel || "保密级别"}</span>
              <select class="inp" id="dgConfidential">
                <option value="public">${p.confidentialPublic || "公开"}</option>
                <option value="internal">${p.confidentialInternal || "内部"}</option>
                <option value="confidential">${p.confidentialSecret || "保密"}</option>
              </select>
            </label>
          </div>
        </div>
      </details>
    </section>

    <!-- ════ 替代路径：智能表格（与写文档并列，不是必经流程）════ -->
    <section class="dg-flow dg-flow--alt" aria-label="智能表格替代路径" id="dgSmartTableCard">
      <header class="dg-flow-head dg-flow-head--alt">
        <span class="dg-flow-icon">📊</span>
        <div>
          <h3>替代路径 · 智能表格</h3>
          <p>跳过写作流程，直接生成带 Excel 公式的表格；导出 XLSX 后公式可计算、表头会冻结、可筛选。</p>
        </div>
        <div class="dg-feature-badges" aria-label="智能表格能力">
          <span>Excel 公式</span>
          <span>XLSX 可算</span>
          <span>分析优化</span>
        </div>
      </header>

      <div class="dg-st-body">
        <div class="dg-st-scenarios" role="tablist" aria-label="表格场景">
          <button type="button" class="chip dg-st-chip" data-st-scenario="itinerary" title="日期/时段/行程/预算/实际/余额">🧳 行程</button>
          <button type="button" class="chip dg-st-chip" data-st-scenario="finance" title="日期/类目/收入/支出/累计余额">💰 财务记账</button>
          <button type="button" class="chip dg-st-chip" data-st-scenario="project" title="任务/负责人/计划/实际/状态/进度">📅 项目计划</button>
          <button type="button" class="chip dg-st-chip" data-st-scenario="inventory" title="名称/数量/单价/库存价值/补货状态">📦 库存清单</button>
          <button type="button" class="chip dg-st-chip" data-st-scenario="crm" title="客户/阶段/金额/概率/加权金额">🤝 客户跟进</button>
          <button type="button" class="chip dg-st-chip" data-st-scenario="expense" title="日期/类目/金额/发票/合计">💳 报销差旅</button>
          <button type="button" class="chip dg-st-chip" data-st-scenario="kpi" title="指标/目标/实际/达成率/状态">📈 KPI 指标</button>
          <button type="button" class="chip dg-st-chip" data-st-scenario="custom" title="完全按你的描述生成">🎨 自定义</button>
        </div>
        <textarea class="inp dg-st-brief" id="dgStBrief" rows="3" placeholder="描述你想要的表格：场景 / 需要哪些列 / 大概多少行 / 有没有要算的指标&#10;示例：5 月深圳出差 3 天，每天 3-4 个会议，需要交通费、住宿、餐饮预算与实际花费对比，最后给我合计"></textarea>
        <div class="dg-st-actions">
          <button type="button" class="btn btn-primary btn-sm" id="dgStGen" title="按上方描述生成全新表格（含公式）">🆕 生成新表格</button>
          <button type="button" class="btn btn-secondary btn-sm" id="dgStAnalyze" title="读取当前输出里的第一张表，给出优化版 + 改动清单">🔍 分析当前表</button>
          <button type="button" class="btn btn-secondary btn-sm" id="dgStCheck" title="扫描当前输出里所有 = 开头的公式，检查括号平衡">🧮 公式自检</button>
          <span id="dgStStat" class="muted dg-st-stat"></span>
        </div>
        <details class="dg-st-cheatsheet">
          <summary>📘 常用 Excel 公式速查</summary>
          <div class="dg-st-cheat-grid">
            <div><code>=SUM(B2:B10)</code> · 整列求和</div>
            <div><code>=AVERAGE(B2:B10)</code> · 求平均</div>
            <div><code>=IF(C2&gt;100,"达标","待提升")</code> · 条件判断</div>
            <div><code>=IFS(D2&lt;0,"亏",D2=0,"持平",TRUE,"盈")</code> · 多分支</div>
            <div><code>=COUNTIF(E:E,"已完成")</code> · 条件计数</div>
            <div><code>=SUMIF(F:F,"餐饮",G:G)</code> · 条件求和</div>
            <div><code>=ROUND(H2*0.13,2)</code> · 四舍五入两位</div>
            <div><code>=VLOOKUP(A2,Sheet2!A:C,3,FALSE)</code> · 查表</div>
          </div>
          <p class="muted dg-tpl-hint">把这些写进描述里，AI 会按你点的位置放公式。</p>
        </details>
      </div>
    </section>
    </div>
    <div class="wb-panel" data-dg-panel="output">
    <div id="dgResultAnchor" class="wb-anchor"></div>
    <div id="dgErr"></div>
    <div id="dgBusy" class="muted wb-dg-busy" style="display:none">${p.busy || ""}</div>
    <details class="wb-details dg-wb-details">
      <summary>${p.wbAdvTitle || ""}</summary>
    <div class="dg-polish-matrix">
      <span class="muted dg-polish-label">${p.polishBar || ""}</span>
      <div class="dg-polish-btns">
      <button type="button" class="btn btn-secondary btn-sm" data-polish="更专业、更克制，保留结构与数据。">${p.polishPro || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-polish="在不丢失关键信息的前提下压缩篇幅，使表达更简洁。">${p.polishShort || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-polish="提升措辞档次：更精炼、更有商务高级感。">${p.polishHi || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-polish="改为更美式商务英语口吻的中文夹叙（保留专业感），结构不变。">${p.polishUs || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-polish="采用投资人备忘录语气：先论点、后证据、附风险与缓解，Markdown。">${p.polishInv || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-polish="改写成给中国民营企业老板的汇报版：结论前置、段落短、可执行。">${p.polishBoss || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-polish="将全文翻译为流畅的英文 Markdown。">${p.polishEn2 || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-polish="将全文润色为流畅的简体中文 Markdown。">${p.polishZh2 || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-polish="在不改变事实的前提下扩写：增加子章节、表格与执行细节。">${p.polishExpand || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-polish="改成商务邮件格式：称呼、分段正文、列表行动项、结尾敬语。">${p.polishMail || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-polish="改成正式分析报告体例：摘要、发现、建议、附录线索。">${p.polishReport || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-polish="改成 PPT 大纲：每页标题+要点+备注。">${p.polishPpt || ""}</button>
      </div>
    </div>
    <div class="card dg-card dg-qc-panel">
      <div class="dg-card-head">
        <h3>${p.qcTitle || ""}</h3>
        <button type="button" class="btn btn-secondary btn-sm" id="dgQcRefresh">${p.qcRefresh || ""}</button>
      </div>
      <div id="dgQcOut" class="muted dg-qc-body"></div>
    </div>
    <div class="card dg-card dg-appendix-panel">
      <h3>${p.appendSuiteTitle || ""}</h3>
      <div class="dg-appendix-fields">
        <label class="dg-check">
          <input type="checkbox" id="dgChkRev" /> <span>${p.chkRevision || ""}</span>
        </label>
        <textarea class="inp" id="dgRevNotes" rows="2" placeholder="${(p.revisionPh || "").replace(/"/g, "&quot;")}"></textarea>
        <label class="dg-check">
          <input type="checkbox" id="dgChkRefs" /> <span>${p.chkRefs || ""}</span>
        </label>
        <textarea class="inp" id="dgRefsNotes" rows="2" placeholder="${(p.refsPh || "").replace(/"/g, "&quot;")}"></textarea>
        <label class="dg-check">
          <input type="checkbox" id="dgChkProv" /> <span>${p.chkProvidence || ""}</span>
        </label>
      </div>
    </div>
    </details>
    <h3 class="dg-out-heading">${p.outTitle || ""}</h3>
    <div class="doc-result-toolbar">
      <span class="muted doc-result-toolbar-label">${p.outViewLabel || ""}</span>
      <button type="button" class="chip doc-res-chip" data-dg-view="split" title="">${p.outLayoutSplit || ""}</button>
      <button type="button" class="chip doc-res-chip" data-dg-view="source">${p.outLayoutSource || ""}</button>
      <button type="button" class="chip doc-res-chip" data-dg-view="preview">${p.outLayoutPreview || ""}</button>
      <span class="muted doc-result-toolbar-label">${p.outPresetLabel || ""}</span>
      <button type="button" class="chip doc-res-chip" data-dg-preset="report">${p.outPresetReport || ""}</button>
      <button type="button" class="chip doc-res-chip" data-dg-preset="compact">${p.outPresetCompact || ""}</button>
      <button type="button" class="chip doc-res-chip" data-dg-preset="print">${p.outPresetPrint || ""}</button>
      <button type="button" class="chip doc-res-chip" data-dg-preset="data">${p.outPresetData || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" id="dgPreviewRefresh">${p.outRefreshPreview || ""}</button>
      <span class="dg-toolbox-divider" aria-hidden="true"></span>
      <button type="button" class="btn btn-secondary btn-sm" id="dgSendPhrase" title="把当前输出保存为金句库的一条（自动按段落拆分）">📝 存为金句</button>
      <button type="button" class="btn btn-secondary btn-sm" id="dgSendLib" title="把当前输出存进文件库（可在 AI 分析 / 文件库内继续使用）">📚 存进文件库</button>
      <button type="button" class="btn btn-secondary btn-sm" id="dgSelfRate" title="让 AI 给当前输出 1-10 分并给出改进建议">🎯 自评</button>
      <button type="button" class="btn btn-secondary btn-sm" id="dgVerDiff" title="对比版本：选两个版本看 diff" disabled>🔀 版本对比</button>
      <button type="button" class="btn btn-secondary btn-sm" id="dgSectionTools" title="开启后预览中每个 H2/H3 旁会出现「重写本节 / 删 / 插入」按钮" data-active="0">🔧 章节工具</button>
      <button type="button" class="btn btn-secondary btn-sm" id="dgTable2Chart" title="把当前 Markdown 中的所有表格自动转换为 Mermaid 柱/饼图">📊 表→图</button>
      <button type="button" class="btn btn-secondary btn-sm" id="dgAnnoToggle" title="批注列表：选中文字后用浮条「💬 批注」追加；这里显示所有批注" data-active="0">💬 批注</button>
    </div>
    <div id="dgVariantTabs" class="dg-variant-tabs" style="display:none"></div>
    <div id="dgAnnoPanel" class="dg-anno-panel" style="display:none">
      <div class="dg-anno-head">
        <strong>批注列表</strong>
        <span class="muted dg-toolbox-mini" id="dgAnnoCount">0 条</span>
        <button type="button" class="btn btn-ghost btn-sm" id="dgAnnoClear" style="margin-left:auto">清空</button>
      </div>
      <div id="dgAnnoList" class="dg-anno-list"></div>
    </div>
    <div class="dg-out-fmt-row">
      <label class="muted doc-result-toolbar-label" for="dgFmtMirror">${p.outFmtLabel || ""}</label>
      <select class="inp dg-fmt-select" style="max-width:300px" id="dgFmtMirror" aria-describedby="dgFmtMirrorHint"></select>
    </div>
    <p id="dgFmtMirrorHint" class="muted dg-out-fmt-hint">${p.outFmtHint || ""}</p>
    <div id="dgResultShell" class="doc-result-shell doc-result-shell--split">
      <div class="doc-result-pane doc-result-pane--src">
        <div class="muted doc-result-pane-label">${p.outSourceLabel || ""}</div>
        <textarea class="inp doc-result-textarea" id="dgOut" rows="14" spellcheck="false"></textarea>
      </div>
      <div class="doc-result-pane doc-result-pane--prev">
        <div class="muted doc-result-pane-label">${p.outPreviewLabel || ""}</div>
        <div class="dg-preview-with-toc">
          <div class="dg-toc-block">
            <div class="muted dg-toc-heading">${p.wbTocTitle || "目录"}</div>
            <div id="dgTocHost" class="dg-toc-host glass" aria-label="${p.wbTocTitle || ""}"></div>
          </div>
          <div id="dgPreviewScroller" class="doc-preview-scroller glass dg-preview-frame">
            <div id="dgPreview" class="doc-prose doc-prose--report"></div>
          </div>
        </div>
      </div>
    </div>
    </div>
    <div class="wb-panel" data-dg-panel="export">
    <div class="row dg-export-bar">
      <label class="muted" style="font-size:0.8rem;flex-shrink:0">${p.exportLabel || ""}</label>
      <select class="inp dg-fmt-select" style="max-width:280px" id="dgFmt"></select>
      <div id="dgPdfImgWrap" style="display:none;align-items:center">
        <label style="display:flex;align-items:center;gap:6px;font-size:0.78rem;cursor:pointer;margin:0">
          <input type="checkbox" id="dgPdfImg" />
          <span>${p.pdfEmbedImages || ""}</span>
        </label>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="dgCopy">${p.copy || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" id="dgDown">${p.download || ""}</button>
    </div>
    <div id="dgXlsxOptsRow" class="dg-xlsx-opts" style="display:none;flex-wrap:wrap;align-items:center;column-gap:18px;row-gap:8px;margin-top:6px">
      <label id="dgXlsxMetaRow" class="dg-check" style="display:flex;align-items:center;gap:6px;margin:0">
        <input type="checkbox" id="dgXlsxMeta" />
        <span class="muted" style="font-size:0.76rem">${p.xlsxMetaSheet || ""}</span>
      </label>
      <label id="dgXlsxSplitRow" class="dg-check" style="display:flex;align-items:center;gap:6px;margin:0">
        <input type="checkbox" id="dgXlsxSplit" />
        <span class="muted" style="font-size:0.76rem">${p.xlsxSplitDataSheets || ""}</span>
      </label>
    </div>
    <p class="muted dg-export-guide" style="font-size:0.72rem;margin:10px 0 0;line-height:1.5;max-width:920px">${p.exportFormatGuide || ""}</p>
    <div class="card dg-bundle-panel">
      <h3>${p.bundleTitle || ""}</h3>
      <p class="muted dg-bundle-lede">${p.bundleHint || ""}</p>
      <div class="dg-bundle-options">
        <label><input type="checkbox" id="dgBdDocx" checked /> ${p.bundleDocx || ""}</label>
        <label><input type="checkbox" id="dgBdPdf" checked /> ${p.bundlePdf || ""}</label>
        <label><input type="checkbox" id="dgBdHtml" /> ${p.bundleHtml || ""}</label>
        <label><input type="checkbox" id="dgBdSlides" /> ${p.bundleSlides || ""}</label>
        <label><input type="checkbox" id="dgBdMd" checked /> ${p.bundleMd || ""}</label>
        <label><input type="checkbox" id="dgBdCsv" /> ${p.bundleCsv || ""}</label>
        <label><input type="checkbox" id="dgBdXlsx" /> ${p.bundleXlsx || ""}</label>
        <label><input type="checkbox" id="dgBdTxt" /> ${p.bundleTxt || ""}</label>
        <label><input type="checkbox" id="dgBdPptx" /> ${p.bundlePptx || ""}</label>
      </div>
      <div class="dg-bundle-action">
        <button type="button" class="btn btn-primary btn-sm" id="dgBundle">${p.bundleBtn || ""}</button>
      </div>
    </div>
    <div class="row wb-pack-row">
      <button type="button" class="btn btn-secondary btn-sm" id="dgPackCustomer">${p.packCustomer || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" id="dgPackBoss">${p.packBoss || ""}</button>
      <button type="button" class="btn btn-secondary btn-sm" id="dgPackInvestor">${p.packInvestor || ""}</button>
    </div>
    <p id="dgPdfImgHint" class="muted" style="display:none;font-size:0.72rem;margin:4px 0 0">${p.pdfEmbedImagesHint || ""}</p>
    <p id="dgFmtHint" class="muted dg-fmt-hint" style="font-size:0.74rem;margin-top:8px;line-height:1.45;max-width:920px"></p>
    </div>
    <div class="wb-panel" data-dg-panel="versions">
      <div class="card wb-card">
        <div class="row wb-field-row" style="justify-content:space-between;align-items:center">
          <h3 style="margin:0">${p.wbTabVersions || "版本"}</h3>
          <button type="button" class="btn btn-secondary btn-sm" id="dgVerSave">${p.verSave || ""}</button>
        </div>
        <p class="muted dg-tpl-hint">${p.verEmpty || ""}</p>
        <div id="dgVerList" class="wb-version-list"></div>
      </div>
    </div>
    </div>
    </div>
    </div>
  `)
  );

  const typeSel = root.querySelector("#dgType");
  const toneSel = root.querySelector("#dgTone");
  (m.documentGenTypeOptions || []).forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    opt.dataset.instruction = o.instruction || "";
    typeSel.appendChild(opt);
  });
  typeSel.addEventListener("change", () => {
    const reqEl = root.querySelector("#dgReq");
    if (!reqEl.value.trim()) {
      const opt = typeSel.options[typeSel.selectedIndex];
      reqEl.placeholder = `写一句你要生成的内容。当前类型：${opt?.textContent || "正式文档"}。`;
    }
  });
  const defaultType = Array.from(typeSel.options).find((o) => o.value === "project_plan") || typeSel.options[0];
  if (defaultType) {
    typeSel.value = defaultType.value;
    root.querySelector("#dgReq").value = "";
  }

  const smartPacks = {
    boss: {
      label: "老板汇报",
      typeHint: "project_plan",
      prefix: "请生成老板可直接阅读的汇报稿：结论前置、少废话、重数据、重风险、重下一步。",
      sections: ["一页纸执行摘要", "关键事实与判断", "风险/卡点/资源需求表", "30/60/90 天行动计划", "需要老板拍板的事项"],
    },
    client: {
      label: "客户方案",
      typeHint: "proposal",
      prefix: "请生成客户可直接阅读的正式方案：语气专业克制，价值清晰，避免内部术语。",
      sections: ["客户背景与目标", "方案设计", "交付物与时间表", "报价/资源假设", "下一步合作动作"],
    },
    investor: {
      label: "投资人材料",
      typeHint: "im",
      prefix: "请生成投资人视角材料：论点清晰、证据优先、风险不回避，适合投委会预读。",
      sections: ["投资摘要", "市场与竞争", "商业模式与增长逻辑", "关键财务/运营假设", "风险与缓释", "尽调问题清单"],
    },
    table: {
      label: "表格优先",
      typeHint: "project_tracker",
      prefix: "请优先输出可复制到 Excel 的结构化表格，必要时附公式说明和填表规则。",
      sections: ["核心表格", "字段说明", "公式/统计口径", "使用建议", "后续维护规则"],
    },
  };

  const practicalModes = {
    boss: {
      label: "老板汇报",
      typeHint: "project_plan",
      smartPack: "boss",
      tone: "高级商务",
      format: "docx",
      prefix: "请生成老板可直接阅读的汇报稿：结论前置，说明当前状态、核心问题、风险、资源需求和下一步动作。",
    },
    client: {
      label: "客户方案",
      typeHint: "quote",
      smartPack: "client",
      tone: "专业",
      format: "pdf",
      prefix: "请生成客户可直接阅读的正式方案：背景、需求理解、方案设计、交付物、周期、报价假设和下一步合作安排。",
    },
    table: {
      label: "表格台账",
      typeHint: "project_tracker",
      smartPack: "table",
      tone: "简洁",
      format: "xlsx",
      prefix: "请优先生成可复制到 Excel 的结构化表格，字段清楚，包含统计口径、公式建议和维护规则。",
    },
    meeting: {
      label: "会议纪要",
      typeHint: "minutes",
      smartPack: "boss",
      tone: "专业",
      format: "docx",
      prefix: "请整理正式会议纪要：会议背景、讨论要点、明确决议、待办事项、负责人和截止时间。",
    },
    contract: {
      label: "合同风险",
      typeHint: "contract_risk",
      smartPack: "boss",
      tone: "专业",
      format: "docx",
      prefix: "请输出合同风险清单：条款位置、风险描述、风险等级、建议修订文本、谈判话术和需补充资料。",
    },
    finance: {
      label: "财务摘要",
      typeHint: "fin_analysis",
      smartPack: "boss",
      tone: "投资人风格",
      format: "xlsx",
      prefix: "请生成财务摘要与分析：收入、成本、毛利、费用、现金流、关键比率、异常点、风险和管理层建议。",
    },
  };

  function setSmartType(typeHint) {
    if (!typeHint) return;
    const opt = Array.from(typeSel.options).find((o) => o.value === typeHint);
    if (opt) typeSel.value = opt.value;
  }

  function selectedSmartPack() {
    const active = root.querySelector(".dg-smart-chip.is-active");
    return smartPacks[active?.getAttribute("data-smart-pack") || ""] || null;
  }

  function applySmartPack(key, { silent = false } = {}) {
    const packKey = String(key || "");
    const pack = smartPacks[packKey];
    if (!pack) return null;
    root.querySelectorAll(".dg-smart-chip").forEach((b) =>
      b.classList.toggle("is-active", b.getAttribute("data-smart-pack") === packKey)
    );
    setSmartType(pack.typeHint);
    if (!silent) ctx.toast(`已切换：${pack.label || "智能模式"}`);
    return pack;
  }

  function setTypeIfAvailable(typeHint) {
    if (!typeHint) return;
    const opt = Array.from(typeSel.options).find((o) => o.value === typeHint);
    if (opt) typeSel.value = opt.value;
  }

  function setFormatIfAvailable(format) {
    const fmtEl = root.querySelector("#dgFmt");
    const fmtMirrorEl = root.querySelector("#dgFmtMirror");
    if (!format || !fmtEl) return;
    if ([...fmtEl.options].some((o) => o.value === format)) {
      fmtEl.value = format;
      fmtEl.dispatchEvent(new Event("change"));
      if (fmtMirrorEl) fmtMirrorEl.value = format;
    }
  }

  function applyPracticalMode(key, { writePrefix = true, silent = false } = {}) {
    const mode = practicalModes[key] || practicalModes.boss;
    root.querySelectorAll(".dg-practical-card").forEach((btn) =>
      btn.classList.toggle("is-active", btn.getAttribute("data-practical") === key)
    );
    setTypeIfAvailable(mode.typeHint);
    applySmartPack(mode.smartPack, { silent: true });
    if (toneSel && [...toneSel.options].some((o) => o.value === mode.tone)) toneSel.value = mode.tone;
    setFormatIfAvailable(mode.format);
    if (writePrefix) {
      const reqEl = root.querySelector("#dgReq");
      const raw = reqEl.value.trim();
      const oldModeLine = raw.match(/^【场景】[^\n]+\n/);
      const cleaned = oldModeLine ? raw.slice(oldModeLine[0].length).trim() : raw;
      reqEl.value = cleaned ? `【场景】${mode.prefix}\n${cleaned}` : "";
      reqEl.placeholder = `${mode.label}：写一句具体需求，例如项目/客户/资料范围/想突出的问题。`;
      reqEl.focus();
    }
    if (!silent) ctx.toast(`已切换：${mode.label}`);
    return mode;
  }

  function inferPracticalKey(text) {
    const raw = String(text || "");
    if (/合同|协议|条款|违约|甲方|乙方|法务|风险条款/.test(raw)) return "contract";
    if (/财务|预算|收入|利润|毛利|现金流|费用|报销|成本/.test(raw)) return "finance";
    if (/表格|Excel|台账|清单|统计|进度表|排期|OKR|KPI|库存/.test(raw)) return "table";
    if (/会议|纪要|讨论|参会|决议|待办|行动项/.test(raw)) return "meeting";
    if (/客户|方案|报价|合作|提案|销售|商机/.test(raw)) return "client";
    return "boss";
  }

  function currentPracticalMode() {
    const active = root.querySelector(".dg-practical-card.is-active");
    const key = active?.getAttribute("data-practical") || "boss";
    return practicalModes[key] || practicalModes.boss;
  }

  function buildSmartInstruction({ runMode = "draft" } = {}) {
    const reqEl = root.querySelector("#dgReq");
    const raw = reqEl.value.trim();
    const opt = typeSel.options[typeSel.selectedIndex];
    const typeLabel = opt?.textContent || "正式文档";
    const base = raw || opt?.dataset?.instruction || `围绕「${typeLabel}」生成一份可交付文档。`;
    const pack = selectedSmartPack();
    const industry = root.querySelector("#dgIndustry")?.value?.trim();
    const purpose = root.querySelector("#dgDocPurpose")?.selectedOptions?.[0]?.textContent || "";
    const audience = root.querySelector("#dgDocAudience")?.selectedOptions?.[0]?.textContent || "";
    const structure = root.querySelector("#dgDocStructure")?.selectedOptions?.[0]?.textContent || "";
    const length = root.querySelector("#dgLenTier")?.selectedOptions?.[0]?.textContent || "";
    const sections = pack?.sections?.length
      ? pack.sections
      : ["执行摘要", "正文分析", "关键表格", "风险与建议", "下一步行动"];
    const modeLine = runMode === "deliver"
      ? "请直接生成可对外交付的最终稿，不要输出思考过程，不要反问。"
      : "请把粗略需求补全为专业可执行版本，并直接生成正文。";
    return [
      `【智能生成模式】${pack?.label || "专业交付"}`,
      modeLine,
      "",
      "【用户原始需求】",
      base,
      "",
      "【上下文】",
      `- 文档类型：${typeLabel}`,
      industry ? `- 行业/场景：${industry}` : "- 行业/场景：如用户未说明，请按最常见商业场景合理假设，并在文末列出假设。",
      purpose ? `- 用途：${purpose}` : "- 用途：业务决策 / 对外沟通 / 内部推进三者兼顾。",
      audience ? `- 阅读对象：${audience}` : "- 阅读对象：非技术业务负责人也能读懂。",
      structure ? `- 结构偏好：${structure}` : "- 结构偏好：结论前置，分层标题，表格承载数据。",
      length ? `- 篇幅：${length}` : "- 篇幅：内容充分但不堆砌。",
      "",
      "【输出结构】",
      ...sections.map((s, i) => `${i + 1}. ${s}`),
      "",
      "【质量要求】",
      "- 先给结论，再给依据；每个建议都要可执行。",
      "- 至少包含 1 张 Markdown 表格；涉及金额/进度/概率时使用数字列。",
      "- 明确假设、风险、下一步行动、负责人/时间建议。",
      "- 语言专业、简洁、有质感，避免空泛套话。",
      "- 如适合导出 Word/PPT/Excel，请在文末给出导出建议。",
    ].join("\n");
  }

  root.querySelectorAll(".dg-smart-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-smart-pack") || "";
      applySmartPack(key);
    });
  });

  root.querySelector("#dgSmartBrief")?.addEventListener("click", () => {
    root.querySelector("#dgReq").value = buildSmartInstruction();
    root.querySelector("#dgReq").focus();
    ctx.toast("已补全为专业交付指令");
  });

  root.querySelector("#dgOneClick")?.addEventListener("click", () => {
    applyPracticalMode(inferPracticalKey(root.querySelector("#dgReq")?.value || ""), { writePrefix: false, silent: true });
    root.querySelector("#dgReq").value = buildSmartInstruction({ runMode: "deliver" });
    root.querySelector("#dgGen")?.click();
  });

  const fmt = root.querySelector("#dgFmt");
  const fmtHint = root.querySelector("#dgFmtHint");
  const exportOpts = Array.isArray(m.generatorExportOptions) && m.generatorExportOptions.length ? m.generatorExportOptions : [];
  const fallbackFmt = [
    { value: "docx", label: "Word", hint: "" },
    { value: "pdf", label: "PDF", hint: "" },
    { value: "html", label: "HTML", hint: "" },
    { value: "xlsx", label: "Excel", hint: "" },
    { value: "csv", label: "CSV", hint: "" },
    { value: "md", label: "Markdown", hint: "" },
    { value: "txt", label: "TXT", hint: "" },
    { value: "pptx", label: "PPTX", hint: "" },
    { value: "slides_html", label: "HTML 幻灯片", hint: "" },
  ];
  const fmtOptsList = exportOpts.length ? exportOpts : fallbackFmt;
  fmtOptsList.forEach((o) => {
    const op = document.createElement("option");
    op.value = o.value;
    op.textContent = o.label || o.value;
    if (o.hint) op.dataset.hint = o.hint;
    fmt.appendChild(op);
  });
  const fmtMirror = root.querySelector("#dgFmtMirror");
  if (fmtMirror) {
    fmtOptsList.forEach((o) => {
      const op = document.createElement("option");
      op.value = o.value;
      op.textContent = o.label || o.value;
      if (o.hint) op.dataset.hint = o.hint;
      fmtMirror.appendChild(op);
    });
  }
  const allowedFmt = ["docx", "pdf", "txt", "md", "csv", "xlsx", "html", "pptx", "slides_html"];
  fmt.value =
    st.defaultExportFormat && allowedFmt.includes(st.defaultExportFormat)
      ? st.defaultExportFormat
      : "docx";
  if (fmtMirror) fmtMirror.value = fmt.value;
  function updateFmtHint() {
    const opt = fmt.options[fmt.selectedIndex];
    fmtHint.textContent = opt?.dataset?.hint || "";
  }
  updateFmtHint();
  const pdfWrap = root.querySelector("#dgPdfImgWrap");
  const pdfHint = root.querySelector("#dgPdfImgHint");
  const xlsxOptsRow = root.querySelector("#dgXlsxOptsRow");
  function xlsxExportOptionsRelevant() {
    const bdXlsx = root.querySelector("#dgBdXlsx");
    return fmt.value === "xlsx" || Boolean(bdXlsx && bdXlsx.checked);
  }
  function updateFmtDependentUi() {
    const showPdf = fmt.value === "pdf";
    if (pdfWrap) pdfWrap.style.display = showPdf ? "flex" : "none";
    if (pdfHint) pdfHint.style.display = showPdf ? "block" : "none";
    if (xlsxOptsRow) xlsxOptsRow.style.display = xlsxExportOptionsRelevant() ? "flex" : "none";
  }
  function syncFmtMirrors() {
    if (fmtMirror && fmtMirror.value !== fmt.value) fmtMirror.value = fmt.value;
  }
  fmt.addEventListener("change", () => {
    ctx.saveSettings({ defaultExportFormat: fmt.value });
    syncFmtMirrors();
    updateFmtDependentUi();
    updateFmtHint();
  });
  fmtMirror?.addEventListener("change", () => {
    fmt.value = fmtMirror.value;
    fmt.dispatchEvent(new Event("change"));
  });
  updateFmtDependentUi();
  root.querySelector("#dgBdXlsx")?.addEventListener("change", () => {
    updateFmtDependentUi();
  });

  root.querySelectorAll(".dg-practical-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyPracticalMode(btn.getAttribute("data-practical") || "boss");
    });
  });
  root.querySelector("#dgAutoRoute")?.addEventListener("click", () => {
    const key = inferPracticalKey(root.querySelector("#dgReq")?.value || "");
    applyPracticalMode(key);
  });
  root.querySelector("#dgGoRefs")?.addEventListener("click", () => {
    const refDetails = Array.from(root.querySelectorAll(".dg-tune-item")).find((node) =>
      node.textContent?.includes(p.refsTitle || "参考资料")
    );
    if (refDetails instanceof HTMLDetailsElement) refDetails.open = true;
    root.querySelector("#dgRefsSearch")?.focus();
    refDetails?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  applyPracticalMode("boss", { writePrefix: false, silent: true });

  const htmlThemeSel = root.querySelector("#dgHtmlTheme");
  (m.generatorHtmlThemes || []).forEach((o) => {
    const op = document.createElement("option");
    op.value = o.value;
    op.textContent = o.label || o.value;
    htmlThemeSel.appendChild(op);
  });
  try {
    const savedTh = localStorage.getItem("acsp-dg-html-theme");
    if (savedTh && [...htmlThemeSel.options].some((x) => x.value === savedTh)) {
      htmlThemeSel.value = savedTh;
    }
  } catch {
    /* ignore */
  }
  htmlThemeSel.addEventListener("change", () => {
    try {
      localStorage.setItem("acsp-dg-html-theme", htmlThemeSel.value);
    } catch {
      /* ignore */
    }
  });

  const tplSelect = root.querySelector("#dgTplSelect");
  (m.deliveryDocumentTemplates || []).forEach((tpl) => {
    const op = document.createElement("option");
    op.value = tpl.id;
    op.textContent = tpl.label || tpl.id;
    op.dataset.instruction = tpl.instruction || "";
    op.dataset.genkey = tpl.genTypeKey || "";
    tplSelect.appendChild(op);
  });
  root.querySelector("#dgTplApply")?.addEventListener("click", () => {
    const opt = tplSelect.options[tplSelect.selectedIndex];
    const ins = opt?.dataset?.instruction;
    if (!ins) {
      ctx.toast(p.tplPlaceholder || "请选择模板", true);
      return;
    }
    root.querySelector("#dgReq").value = ins;
    const gk = opt?.dataset?.genkey || "";
    if (gk) {
      const hit = [...typeSel.options].find((o) => o.value === gk);
      if (hit) typeSel.value = gk;
    }
    ctx.toast("已套用模板");
  });

  const shell = root.querySelector("#dgResultShell");
  const previewHost = root.querySelector("#dgPreview");
  const previewScroller = root.querySelector("#dgPreviewScroller");
  const tocHost = root.querySelector("#dgTocHost");
  const ta = root.querySelector("#dgOut");

  function fillSel(sel, items) {
    if (!sel) return;
    sel.innerHTML = "";
    items.forEach(([value, label]) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      sel.appendChild(o);
    });
  }
  fillSel(root.querySelector("#dgDocPurpose"), [
    ["internal", "内部汇报"],
    ["customer", "客户交付"],
    ["investor", "投资人沟通"],
    ["legal", "法律审查"],
    ["sales", "销售转化"],
  ]);
  fillSel(root.querySelector("#dgDocAudience"), [
    ["boss", "老板"],
    ["customer", "客户"],
    ["investor", "投资人"],
    ["lawyer", "律师"],
    ["team", "团队"],
    ["partner", "合作方"],
  ]);
  fillSel(root.querySelector("#dgDocStructure"), [
    ["report", "正式报告"],
    ["memo", "备忘录"],
    ["email", "邮件"],
    ["ppt_outline", "PPT 大纲"],
    ["sop", "SOP"],
    ["proposal", "Proposal"],
  ]);
  fillSel(root.querySelector("#dgLenTier"), [
    ["short", p.lenTierShort || "简短"],
    ["standard", p.lenTierStd || "标准"],
    ["deep", p.lenTierDeep || "深度"],
    ["full", p.lenTierFull || "完整交付"],
  ]);

  /** @param {string} selId */
  function labelOfSelect(selId) {
    const s = root.querySelector(selId);
    if (!s) return "";
    const opt = s.options[s.selectedIndex];
    return (opt?.textContent || "").trim() || String(opt?.value || "");
  }

  function collectGenControls() {
    const citeEl = root.querySelector("#dgCite");
    return {
      purpose: labelOfSelect("#dgDocPurpose"),
      audience: labelOfSelect("#dgDocAudience"),
      length: labelOfSelect("#dgLenTier"),
      industry: root.querySelector("#dgIndustry")?.value?.trim() || "",
      citeFiles: citeEl ? Boolean(citeEl.checked) : true,
      docPurpose: root.querySelector("#dgDocPurpose")?.value || "",
      docAudience: root.querySelector("#dgDocAudience")?.value || "",
      docStructure: root.querySelector("#dgDocStructure")?.value || "",
      lengthTier: root.querySelector("#dgLenTier")?.value || "",
    };
  }

  root.querySelector("#dgGenTop")?.addEventListener("click", () => root.querySelector("#dgGen")?.click());
  root.querySelector("#dgSaveTop")?.addEventListener("click", () => root.querySelector("#dgSaveHist")?.click());
  root.querySelector("#dgCopyTop")?.addEventListener("click", () => root.querySelector("#dgCopy")?.click());
  root.querySelector("#dgDownTop")?.addEventListener("click", () => root.querySelector("#dgDown")?.click());

  root.querySelectorAll("[data-dg-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.getAttribute("data-dg-tab") || "input";
      root.querySelectorAll("[data-dg-tab]").forEach((b) => b.classList.toggle("is-active", b === btn));
      root.querySelectorAll("[data-dg-panel]").forEach((pan) => {
        pan.classList.toggle("is-active", pan.getAttribute("data-dg-panel") === name);
      });
    });
  });

  root.querySelector("#dgPbApply")?.addEventListener("click", () => {
    const ind = root.querySelector("#dgPbIndustry")?.value?.trim() || "";
    const aud = root.querySelector("#dgPbAudience")?.value?.trim() || "";
    const pur = root.querySelector("#dgPbPurpose")?.value?.trim() || "";
    const prefix = `【写作组装】行业：${ind || "—"}；受众：${aud || "—"}；目的：${pur || "—"}；语气：${toneSel.value}。\n\n`;
    const cur = root.querySelector("#dgReq").value.trim();
    root.querySelector("#dgReq").value = `${prefix}${cur}`;
    ctx.toast("已写入前缀");
  });

  function renderGenVersions() {
    const host = root.querySelector("#dgVerList");
    if (!host) return;
    const list = loadWorkbenchVersions(LS_GENERATOR_VERSIONS);
    if (!list.length) {
      host.innerHTML = `<p class="muted">${p.verEmpty || ""}</p>`;
      return;
    }
    host.innerHTML = "";
    list.forEach((v) => {
      const row = el(`
        <div class="wb-version-row">
          <div class="wb-version-meta">${new Date(v.at).toLocaleString()}</div>
          <button type="button" class="btn btn-secondary btn-sm" data-gvid="${v.id}">${p.verSave ? "载入" : "载入"}</button>
        </div>
      `);
      const btn = row.querySelector("button");
      if (btn) btn.textContent = p.verRestore || "载入";
      btn?.addEventListener("click", () => {
        const hit = loadWorkbenchVersions(LS_GENERATOR_VERSIONS).find((x) => x.id === v.id);
        if (hit?.content) {
          ta.value = hit.content;
          syncPreview();
          refreshQc();
          root.querySelectorAll("[data-dg-tab]").forEach((b) =>
            b.classList.toggle("is-active", b.getAttribute("data-dg-tab") === "output")
          );
          root.querySelectorAll("[data-dg-panel]").forEach((pan) =>
            pan.classList.toggle("is-active", pan.getAttribute("data-dg-panel") === "output")
          );
        }
      });
      host.appendChild(row);
    });
  }
  root.querySelector("#dgVerSave")?.addEventListener("click", () => {
    const raw = ta.value.trim();
    if (!raw) {
      ctx.toast(m?.messages?.noResultToSave || "无内容", true);
      return;
    }
    pushWorkbenchVersion(LS_GENERATOR_VERSIONS, {
      label: genTypeLabel(),
      content: raw,
      meta: { project: currentProjectName() },
    });
    renderGenVersions();
    ctx.toast("已保存版本");
  });
  renderGenVersions();

  const packText = {
    customer: `【一键客户交付包指令】在正文中输出：①客户可读主报告 ②800字内客户邮件 ③执行摘要 bullet ④10页内PPT式大纲（Markdown）。`,
    boss: `【一键老板汇报包指令】先输出 1页 Executive Summary（bullet），再输出风险清单表，再输出 30/60/90 天行动计划表（Markdown）。`,
    investor: `【一键投资人材料包指令】输出：投资亮点、关键风险与缓释、财务假设表、12页 Pitch Deck 大纲（Markdown）。`,
  };
  root.querySelector("#dgPackCustomer")?.addEventListener("click", () => {
    root.querySelector("#dgReq").value = `${packText.customer}\n\n${root.querySelector("#dgReq").value.trim()}`;
    ctx.toast("已插入客户包指令");
  });
  root.querySelector("#dgPackBoss")?.addEventListener("click", () => {
    root.querySelector("#dgReq").value = `${packText.boss}\n\n${root.querySelector("#dgReq").value.trim()}`;
    ctx.toast("已插入老板包指令");
  });
  root.querySelector("#dgPackInvestor")?.addEventListener("click", () => {
    root.querySelector("#dgReq").value = `${packText.investor}\n\n${root.querySelector("#dgReq").value.trim()}`;
    ctx.toast("已插入投资人包指令");
  });

  /** @type {HTMLDivElement | null} */
  let floatBar = null;
  function ensureFloatBar() {
    if (floatBar) return floatBar;
    floatBar = /** @type {HTMLDivElement} */ (document.createElement("div"));
    floatBar.className = "wb-floatbar hidden";
    floatBar.innerHTML = `
      <button type="button" class="btn btn-secondary btn-sm" data-sel="expand">扩写</button>
      <button type="button" class="btn btn-secondary btn-sm" data-sel="shrink">压缩</button>
      <button type="button" class="btn btn-secondary btn-sm" data-sel="polish">润色</button>
      <button type="button" class="btn btn-secondary btn-sm" data-sel="en">译英</button>
      <button type="button" class="btn btn-secondary btn-sm" data-sel="tone">更正式</button>
    `;
    document.body.appendChild(floatBar);
    const ins = {
      expand: "将选中文本扩写为更详细的专业表述，保持事实不变；输出替换该片段后的**完整** Markdown。",
      shrink: "将选中文本压缩为更短要点，不丢关键信息；输出替换该片段后的**完整** Markdown。",
      polish: "润色选中文本的措辞与逻辑衔接；输出替换该片段后的**完整** Markdown。",
      en: "将选中文本翻译为英文；输出替换该片段后的**完整** Markdown。",
      tone: "将选中文本改为更正式商务语气；输出替换该片段后的**完整** Markdown。",
    };
    floatBar.querySelectorAll("[data-sel]").forEach((b) => {
      b.addEventListener("click", async () => {
        const k = b.getAttribute("data-sel") || "polish";
        const full = ta.value;
        const s = ta.selectionStart;
        const e = ta.selectionEnd;
        if (s == null || e == null || s >= e) return;
        const sel = full.slice(s, e);
        if (sel.length < 4) return;
        floatBar.classList.add("hidden");
        root.querySelector("#dgBusy").style.display = "block";
        try {
          const res = await ctx.runPolish({
            instruction: `${ins[k]}\n\n【选中片段】\n${sel}\n\n【全文】\n${full}`,
            sourceContent: full,
            model: ctx.getModel(),
          });
          ta.value = res.content || full;
          syncPreview();
          refreshQc();
          ctx.toast("已完成局部改写");
        } catch (err) {
          ctx.toast(err?.message || "失败", true);
        } finally {
          root.querySelector("#dgBusy").style.display = "none";
        }
      });
    });
    return floatBar;
  }
  ta.addEventListener("mouseup", () => {
    const bar = ensureFloatBar();
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    if (s == null || e == null || e - s < 6) {
      bar.classList.add("hidden");
      return;
    }
    const rect = ta.getBoundingClientRect();
    bar.classList.remove("hidden");
    bar.style.left = `${Math.min(window.innerWidth - 320, rect.left + 8)}px`;
    bar.style.top = `${rect.top + window.scrollY - 40}px`;
  });
  function hideFloatOnDocMouse(ev) {
    if (floatBar && !floatBar.contains(/** @type {Node} */ (ev.target)) && ev.target !== ta) {
      floatBar.classList.add("hidden");
    }
  }
  document.addEventListener("mousedown", hideFloatOnDocMouse);

  let debTimer;
  function syncPreview() {
    try {
      const html = markdownToSafeHtmlWithAnchors(ta.value);
      previewHost.innerHTML = html;
      if (tocHost && typeof buildPreviewTocHtml === "function") {
        tocHost.innerHTML = buildPreviewTocHtml(html);
        tocHost.querySelectorAll("a[href^='#']").forEach((a) => {
          a.addEventListener("click", (ev) => {
            const id = a.getAttribute("href")?.slice(1);
            if (!id) return;
            ev.preventDefault();
            const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
            const el = safe ? previewHost.querySelector(`#${safe}`) : null;
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        });
      }
    } catch (e) {
      previewHost.innerHTML = `<p class="muted">预览失败：${String(e?.message || e)}</p>`;
      if (tocHost) tocHost.innerHTML = "";
    }
  }
  function schedulePreview() {
    clearTimeout(debTimer);
    debTimer = setTimeout(syncPreview, 240);
  }
  let qcTimer;
  function refreshQc() {
    const host = root.querySelector("#dgQcOut");
    if (!host) return;
    const r = runDeliveryQuality(ta.value);
    if (!r.issues.length) {
      host.innerHTML = `<span class="muted">${p.qcPass || ""}</span>`;
      return;
    }
    host.innerHTML = r.issues
      .map((i) => {
        const c = i.level === "error" ? "#fca5a5" : i.level === "warn" ? "#fcd34d" : "#94a3b8";
        return `<div style="margin:4px 0;color:${c}">${p.qcFailPrefix || ""} ${i.detail}</div>`;
      })
      .join("");
  }
  function scheduleQc() {
    clearTimeout(qcTimer);
    qcTimer = setTimeout(refreshQc, 420);
  }
  root.querySelector("#dgQcRefresh")?.addEventListener("click", refreshQc);
  ta.addEventListener("input", () => {
    schedulePreview();
    scheduleQc();
  });

  function applyViewMode(mode) {
    const vm = mode === "source" || mode === "preview" ? mode : "split";
    shell.classList.remove("doc-result-shell--split", "doc-result-shell--source", "doc-result-shell--preview");
    shell.classList.add(`doc-result-shell--${vm}`);
    root.querySelectorAll("[data-dg-view]").forEach((b) => {
      b.classList.toggle("is-on", b.getAttribute("data-dg-view") === vm);
    });
    try {
      localStorage.setItem("acsp-dg-view", vm);
    } catch {
      /* ignore */
    }
  }
  root.querySelectorAll("[data-dg-view]").forEach((b) => {
    b.addEventListener("click", () => applyViewMode(b.getAttribute("data-dg-view") || "split"));
  });

  function applyPreset(preset) {
    const pr =
      preset === "compact" || preset === "print" || preset === "data" ? preset : "report";
    previewHost.classList.remove("doc-prose--report", "doc-prose--compact", "doc-prose--print", "doc-prose--data");
    previewHost.classList.add(`doc-prose--${pr}`);
    previewScroller.classList.toggle("doc-preview-scroller--print", pr === "print" || pr === "data");
    root.querySelectorAll("[data-dg-preset]").forEach((b) => {
      b.classList.toggle("is-on", b.getAttribute("data-dg-preset") === pr);
    });
    try {
      localStorage.setItem("acsp-dg-preset", pr);
    } catch {
      /* ignore */
    }
  }
  root.querySelectorAll("[data-dg-preset]").forEach((b) => {
    b.addEventListener("click", () => applyPreset(b.getAttribute("data-dg-preset") || "report"));
  });

  let initialView = "split";
  let initialPreset = "report";
  try {
    initialView = localStorage.getItem("acsp-dg-view") || "split";
    initialPreset = localStorage.getItem("acsp-dg-preset") || "report";
  } catch {
    /* ignore */
  }
  if (!["split", "source", "preview"].includes(initialView)) initialView = "split";
  if (!["report", "compact", "print", "data"].includes(initialPreset)) initialPreset = "report";
  applyViewMode(initialView);
  applyPreset(initialPreset);

  root.querySelector("#dgPreviewRefresh")?.addEventListener("click", syncPreview);

  /** @type {Set<string>} */
  const refs = new Set();
  /** @type {any[]} */
  let cachedRefLib = [];

  async function renderRefs() {
    const host = root.querySelector("#dgRefs");
    host.innerHTML = "";
    let lib = [];
    try {
      lib = await idb.listFiles();
    } catch (e) {
      console.warn("[documentGenerator] listFiles", e);
      host.textContent = p.refsEmpty || "";
      return;
    }
    if (!lib.length) {
      host.textContent = p.refsEmpty || "";
      return;
    }
    cachedRefLib = lib;
    renderFilteredRefs();
  }

  function renderFilteredRefs() {
    const lib = cachedRefLib;
    if (!lib?.length) return;
    const host = root.querySelector("#dgRefs");
    const q = String(root.querySelector("#dgRefsSearch")?.value || "").trim().toLowerCase();
    host.innerHTML = "";
    const w = document.createElement("div");
    w.style.cssText = "display:flex;flex-direction:column;gap:6px;max-height:240px;overflow:auto";
    let visible = 0;
    lib.forEach((rec) => {
      const haystack = [
        rec.fileName || "",
        Array.isArray(rec.tags) ? rec.tags.join(" ") : "",
        rec.category || "",
      ]
        .join(" ")
        .toLowerCase();
      if (q && !haystack.includes(q)) return;
      visible += 1;
      const tagBits = Array.isArray(rec.tags) && rec.tags.length
        ? `<span class="muted" style="font-size:11px;margin-left:6px">#${rec.tags.slice(0, 3).join(" #")}</span>`
        : "";
      const row = el(`
        <label style="display:flex;align-items:center;gap:8px;font-size:0.86rem;cursor:pointer">
          <input type="checkbox" data-id="${rec.id}" />
          <span>${rec.fileName}${tagBits}</span>
        </label>
      `);
      const cb = row.querySelector("input");
      if (refs.has(rec.id) || ctx.navPayload?.fileIds?.includes(rec.id)) {
        cb.checked = true;
        refs.add(rec.id);
      }
      cb.addEventListener("change", () => {
        if (cb.checked) refs.add(rec.id);
        else refs.delete(rec.id);
      });
      w.appendChild(row);
    });
    if (!visible) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.cssText = "font-size:0.82rem;padding:6px";
      empty.textContent = q ? `没有匹配「${q}」的文件` : (p.refsEmpty || "");
      host.appendChild(empty);
    } else {
      host.appendChild(w);
    }
  }

  root.querySelector("#dgRefsSearch")?.addEventListener("input", () => renderFilteredRefs());

  let lastTitle = "generated";

  function genTypeLabel() {
    return typeSel.options[typeSel.selectedIndex]?.text || typeSel.value || "文档";
  }

  async function buildSource() {
    let name = "merged-sources.txt";
    let content = "";
    if (!refs.size) {
      content = "";
      name = "no-source.txt";
    } else {
      const chunks = [];
      for (const id of refs) {
        let c = "";
        let fn = id;
        const row = await idb.getFile(id);
        if (row && typeof row.content === "string") {
          c = row.content;
          fn = row.fileName || id;
        } else {
          try {
            const r = await ctx.ipc.libraryGetContent({ id, apiKey: ctx.getApiKey() });
            c = r.content || "";
            fn = r.record?.fileName || id;
          } catch {
            c = "";
          }
        }
        chunks.push(`## ${fn}\n\n${c}`);
      }
      content = chunks.join("\n\n---\n\n");
    }
    return { name, content };
  }

  const genBtnEl = root.querySelector("#dgGen");
  const genBtnTopEl = root.querySelector("#dgGenTop");
  const genLabelIdle = String(p.genBtn || genBtnEl?.textContent || "生成文档").trim() || "生成文档";
  const genLabelBusy = String(p.genBtnBusy || p.busy || "生成中").replace(/…\s*$/, "").trim() || "生成中";

  function setGenerateButtonBusy(busy) {
    const label = busy ? genLabelBusy : genLabelIdle;
    for (const b of [genBtnEl, genBtnTopEl]) {
      if (!b) continue;
      b.textContent = label;
      b.disabled = Boolean(busy);
    }
  }

  async function runGenerate() {
    const errBox = root.querySelector("#dgErr");
    errBox.innerHTML = "";
    setGenerateButtonBusy(true);
    root.querySelector("#dgBusy").style.display = "block";
    try {
      const reqBox = root.querySelector("#dgReq");
      const rawReq = reqBox.value.trim();
      if (rawReq && !/^【场景】/.test(rawReq)) {
        applyPracticalMode(inferPracticalKey(rawReq), { writePrefix: false, silent: true });
      }
      const { name, content } = await buildSource();
      const lang = ctx.settings().defaultLang || "zh-CN";
      const genControls = collectGenControls();
      const mode = currentPracticalMode();
      const baseReq = reqBox.value.trim() || `请生成一份${genTypeLabel()}。`;
      const practicalLead = /^【场景】/.test(baseReq) ? "" : `【场景规则】${mode.prefix}\n\n`;
      const selectedRefs = cachedRefLib.filter((rec) => refs.has(rec.id));
      const refLine = selectedRefs.length
        ? `\n\n【已引用资料】\n${selectedRefs.map((rec, i) => `${i + 1}. ${rec.fileName || rec.id}`).join("\n")}`
        : "";
      const instruction = `${practicalLead}${baseReq}${refLine}\n\n（输出语言：${lang}；语气：${toneSel.value}）`;
      const res = await ctx.runDocumentGenerate({
        instruction,
        sourceContent: content,
        sourceFileName: name,
        model: ctx.getModel(),
        genType: genTypeLabel(),
        genTypeKey: typeSel.value,
        tone: toneSel.value,
        genControls,
      });
      root.querySelector("#dgOut").value = res.content || "";
      syncPreview();
      refreshQc();
      lastTitle = (res.fileName || "document").replace(/[\\/:*?"<>|]/g, "_");
      ctx.toast(m?.messages?.taskDone || "完成");
      root.querySelectorAll("[data-dg-tab]").forEach((b) =>
        b.classList.toggle("is-active", b.getAttribute("data-dg-tab") === "output")
      );
      root.querySelectorAll("[data-dg-panel]").forEach((pan) =>
        pan.classList.toggle("is-active", pan.getAttribute("data-dg-panel") === "output")
      );
      root.querySelector("#dgResultAnchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      errorState(errBox, e?.message || "失败");
      ctx.toast(e?.message || "失败", true);
    } finally {
      root.querySelector("#dgBusy").style.display = "none";
      setGenerateButtonBusy(false);
    }
  }

  root.querySelector("#dgGen").addEventListener("click", runGenerate);

  root.querySelector("#dgSaveHist").addEventListener("click", async () => {
    const t = root.querySelector("#dgOut").value.trim();
    if (!t) {
      ctx.toast(m?.messages?.noResultToSave || "无内容", true);
      return;
    }
    await historyStore.pushHistory({
      type: "generate",
      title: lastTitle || genTypeLabel(),
      summary: t.slice(0, 200),
      content: t,
      meta: {
        genType: typeSel.value,
        tone: toneSel.value,
        fileIds: [...refs],
        purpose: root.querySelector("#dgDocPurpose")?.value,
        audience: root.querySelector("#dgDocAudience")?.value,
        docStructure: root.querySelector("#dgDocStructure")?.value,
        lengthTier: root.querySelector("#dgLenTier")?.value,
        project: currentProjectName(),
      },
    });
    ctx.toast("已保存到历史记录");
  });

  root.querySelectorAll("[data-polish]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cur = root.querySelector("#dgOut").value;
      if (!cur.trim()) {
        ctx.toast("请先生成正文", true);
        return;
      }
      root.querySelector("#dgBusy").style.display = "block";
      try {
        const add = btn.getAttribute("data-polish") || "";
        const res = await ctx.runPolish({
          instruction: `在以下内容基础上修改：${add}`,
          sourceContent: cur,
          model: ctx.getModel(),
        });
        root.querySelector("#dgOut").value = res.content || "";
        syncPreview();
        refreshQc();
        ctx.toast("已优化");
      } catch (e) {
        ctx.toast(e?.message || "优化失败", true);
      } finally {
        root.querySelector("#dgBusy").style.display = "none";
      }
    });
  });

  root.querySelector("#dgCopy").addEventListener("click", async () => {
    const t = root.querySelector("#dgOut").value;
    if (!t) return;
    await ctx.ipc.copyText(t);
    ctx.toast(m?.messages?.copied || "已复制");
  });

  function buildExportMetaForSave() {
    const xlsxUi = xlsxExportOptionsRelevant();
    const xlsxMeta =
      xlsxUi && root.querySelector("#dgXlsxMeta") instanceof HTMLInputElement
        ? Boolean(root.querySelector("#dgXlsxMeta").checked)
        : false;
    const xlsxSplit =
      xlsxUi && root.querySelector("#dgXlsxSplit") instanceof HTMLInputElement
        ? Boolean(root.querySelector("#dgXlsxSplit").checked)
        : false;
    return {
      title: lastTitle,
      projectName: document.getElementById("headerProjectName")?.value?.trim?.() || "",
      audience: labelOfSelect("#dgDocAudience"),
      purpose: labelOfSelect("#dgDocPurpose"),
      generatedAt: new Date().toISOString(),
      confidentialLevel: root.querySelector("#dgConfidential")?.value || "public",
      htmlTheme: root.querySelector("#dgHtmlTheme")?.value || "default",
      includeXlsxMetaSheet: xlsxMeta,
      xlsxSplitDataTables: xlsxSplit,
    };
  }

  function preparedMarkdownSource(raw) {
    return appendDeliverySections(raw, {
      revisionNotes: root.querySelector("#dgChkRev")?.checked
        ? root.querySelector("#dgRevNotes")?.value?.trim?.() || ""
        : "",
      refsText: root.querySelector("#dgChkRefs")?.checked
        ? root.querySelector("#dgRefsNotes")?.value?.trim?.() || ""
        : "",
      includeProvenance: Boolean(root.querySelector("#dgChkProv")?.checked),
      confidentialLevel: root.querySelector("#dgConfidential")?.value || "public",
    });
  }

  root.querySelector("#dgDown").addEventListener("click", async () => {
    const raw = root.querySelector("#dgOut").value;
    if (!raw?.trim()) {
      ctx.toast(m?.messages?.noResultToSave || "无内容", true);
      return;
    }
    const format = fmt.value;
    try {
      const exportMeta = buildExportMetaForSave();
      const mdBody = preparedMarkdownSource(raw);
      let outBody = mdBody;
      if (format === "html") {
        outBody = buildPrintableHtmlDocument(mdBody, lastTitle, exportMeta, { themeId: exportMeta.htmlTheme });
      } else if (format === "slides_html") {
        outBody = buildSlidesHtmlDocument(mdBody, lastTitle, exportMeta, { themeId: exportMeta.htmlTheme });
      } else if (format === "md") {
        outBody = prependDeliverableYaml(mdBody, exportMeta);
      }
      const suggestedName =
        format === "slides_html" ? `${lastTitle}-slides.html` : `${lastTitle}.${format}`;
      const r = await ctx.ipc.saveGeneratedFile({
        suggestedName,
        content: outBody,
        format,
        embedPdfImages: format === "pdf" ? Boolean(root.querySelector("#dgPdfImg")?.checked) : false,
        exportMeta,
      });
      ctx.toast(r?.canceled ? "已取消" : `已保存：${r.filePath}`);
    } catch (e) {
      ctx.toast(e?.message || "导出失败", true);
    }
  });

  root.querySelector("#dgBundle")?.addEventListener("click", async () => {
    const raw = root.querySelector("#dgOut").value;
    if (!raw?.trim()) {
      ctx.toast(m?.messages?.noResultToSave || "无内容", true);
      return;
    }
    const mdBody = preparedMarkdownSource(raw);
    const exportMeta = buildExportMetaForSave();
    const base = lastTitle.replace(/[\\/:*?"<>|]/g, "_");
    const embedPdf = Boolean(root.querySelector("#dgPdfImg")?.checked);
    /** @type {{ fileName: string; format: string; content: string; exportMeta: Record<string, unknown>; embedPdfImages?: boolean }[]} */
    const items = [];
    if (root.querySelector("#dgBdDocx")?.checked) {
      items.push({ fileName: `${base}.docx`, format: "docx", content: mdBody, exportMeta });
    }
    if (root.querySelector("#dgBdPdf")?.checked) {
      items.push({
        fileName: `${base}.pdf`,
        format: "pdf",
        content: mdBody,
        exportMeta,
        embedPdfImages: embedPdf,
      });
    }
    if (root.querySelector("#dgBdHtml")?.checked) {
      items.push({
        fileName: `${base}.html`,
        format: "html",
        content: buildPrintableHtmlDocument(mdBody, lastTitle, exportMeta, { themeId: exportMeta.htmlTheme }),
        exportMeta,
      });
    }
    if (root.querySelector("#dgBdSlides")?.checked) {
      items.push({
        fileName: `${base}-slides.html`,
        format: "slides_html",
        content: buildSlidesHtmlDocument(mdBody, lastTitle, exportMeta, { themeId: exportMeta.htmlTheme }),
        exportMeta,
      });
    }
    if (root.querySelector("#dgBdMd")?.checked) {
      items.push({
        fileName: `${base}.md`,
        format: "md",
        content: prependDeliverableYaml(mdBody, exportMeta),
        exportMeta,
      });
    }
    if (root.querySelector("#dgBdCsv")?.checked) {
      items.push({ fileName: `${base}.csv`, format: "csv", content: mdBody, exportMeta });
    }
    if (root.querySelector("#dgBdXlsx")?.checked) {
      items.push({ fileName: `${base}.xlsx`, format: "xlsx", content: mdBody, exportMeta });
    }
    if (root.querySelector("#dgBdTxt")?.checked) {
      items.push({ fileName: `${base}.txt`, format: "txt", content: mdBody, exportMeta });
    }
    if (root.querySelector("#dgBdPptx")?.checked) {
      items.push({ fileName: `${base}.pptx`, format: "pptx", content: mdBody, exportMeta });
    }
    if (!items.length) {
      ctx.toast("请至少勾选一种打包格式。", true);
      return;
    }
    try {
      const r = await ctx.ipc.saveDeliverableBundle({ items, embedPdfImages: embedPdf, exportMeta });
      ctx.toast(r?.canceled ? "已取消" : `交付包已写入 ${r.count} 个文件：${r.outputDir}`);
    } catch (e) {
      ctx.toast(e?.message || "打包失败", true);
    }
  });

  // —— 智能助手扩展模块 ——————————————————————————————————————
  // 包含：预设、最近、我的模板、目标字数、token 预算、键盘快捷键、
  //       存为金句、存进文件库、AI 自评、版本对比、Bundle 场景、大纲优先、扩展 floatBar
  let cleanupAddons = () => {};
  try {
    cleanupAddons = await mountDocGenAddons();
  } catch (e) {
    console.warn("[documentGenerator] addons mount failed", e);
  }

  /* eslint-disable no-inner-declarations */
  function escAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  async function mountDocGenAddons() {
    const cleanups = [];

    // —— 1. 状态封装 ——
    const KV_PRESETS = "dgPresets";
    const KV_RECENT = "dgRecent";

    const presetSel = root.querySelector("#dgPresetSel");
    const presetSave = root.querySelector("#dgPresetSave");
    const presetDel = root.querySelector("#dgPresetDel");
    const recentSel = root.querySelector("#dgRecentSel");
    const outlineMode = root.querySelector("#dgOutlineMode");
    const outlineExpandBtn = root.querySelector("#dgOutlineExpand");
    const budgetPill = root.querySelector("#dgBudgetPill");
    const kbdHelpBtn = root.querySelector("#dgKbdHelp");

    // —— 2. 表单 → 配置对象 / 配置对象 → 表单（用于预设、最近）——
    function snapshotConfig() {
      return {
        type: typeSel.value,
        tone: toneSel.value,
        industry: root.querySelector("#dgIndustry")?.value || "",
        cite: !!root.querySelector("#dgCite")?.checked,
        purpose: root.querySelector("#dgDocPurpose")?.value || "",
        audience: root.querySelector("#dgDocAudience")?.value || "",
        structure: root.querySelector("#dgDocStructure")?.value || "",
        lengthTier: root.querySelector("#dgLenTier")?.value || "",
        pbInd: root.querySelector("#dgPbIndustry")?.value || "",
        pbAud: root.querySelector("#dgPbAudience")?.value || "",
        pbPur: root.querySelector("#dgPbPurpose")?.value || "",
        htmlTheme: root.querySelector("#dgHtmlTheme")?.value || "",
        confidential: root.querySelector("#dgConfidential")?.value || "",
        req: root.querySelector("#dgReq")?.value || "",
        outlineMode: !!outlineMode?.checked,
      };
    }

    function applyConfig(c) {
      if (!c) return;
      const set = (id, v) => {
        const el2 = root.querySelector("#" + id);
        if (el2 && v != null) el2.value = String(v);
      };
      set("dgType", c.type);
      typeSel.dispatchEvent(new Event("change"));
      set("dgTone", c.tone);
      set("dgIndustry", c.industry);
      const cite = root.querySelector("#dgCite");
      if (cite && typeof c.cite === "boolean") cite.checked = c.cite;
      set("dgDocPurpose", c.purpose);
      set("dgDocAudience", c.audience);
      set("dgDocStructure", c.structure);
      set("dgLenTier", c.lengthTier);
      set("dgPbIndustry", c.pbInd);
      set("dgPbAudience", c.pbAud);
      set("dgPbPurpose", c.pbPur);
      set("dgHtmlTheme", c.htmlTheme);
      set("dgConfidential", c.confidential);
      set("dgReq", c.req);
      if (outlineMode && typeof c.outlineMode === "boolean") outlineMode.checked = c.outlineMode;
      updateBudget();
    }

    // —— 3. token / 费用估算 ——
    function estimateTokens(s) {
      const str = String(s || "");
      const cn = (str.match(/[\u4e00-\u9fff]/g) || []).length;
      const en = str.length - cn;
      return Math.round(cn * 1.5 + en / 4);
    }
    const PRICE_PER_1K_INPUT = 0.014;
    const PRICE_PER_1K_OUTPUT = 0.04;

    function updateBudget() {
      try {
        const reqText = root.querySelector("#dgReq")?.value || "";
        const refsTextLen = refs.size * 800;
        const inTok = estimateTokens(reqText) + Math.round(refsTextLen / 4) + 200;
        const outTok = Math.max(1200, inTok);
        const cost = (inTok / 1000) * PRICE_PER_1K_INPUT + (outTok / 1000) * PRICE_PER_1K_OUTPUT;
        budgetPill.textContent = `≈ ${(inTok / 1000).toFixed(1)}K in · ${(outTok / 1000).toFixed(1)}K out · ¥${cost.toFixed(3)}`;
        if (inTok + outTok > 12000) {
          budgetPill.classList.add("dg-budget-warn");
        } else {
          budgetPill.classList.remove("dg-budget-warn");
        }
      } catch {
        /* ignore */
      }
    }
    root.querySelector("#dgReq")?.addEventListener("input", updateBudget);

    // —— 调味区 meta 摘要：把当前选择实时显示在折叠 summary 右侧，不展开也能一眼看到 ——
    function selLabel(id) {
      const el2 = root.querySelector(id);
      if (!el2) return "";
      const opt = el2.options?.[el2.selectedIndex];
      return (opt?.textContent || "").trim();
    }
    function refreshTuneMeta() {
      try {
        const specMeta = root.querySelector("#dgTuneSpecMeta");
        if (specMeta) {
          const parts = [
            selLabel("#dgDocAudience"),
            selLabel("#dgDocStructure"),
            selLabel("#dgLenTier"),
          ].filter(Boolean);
          specMeta.textContent = parts.length ? parts.join(" · ") : "默认";
        }
        const refsMeta = root.querySelector("#dgTuneRefsMeta");
        if (refsMeta) {
          const n = refs?.size || 0;
          refsMeta.textContent = n > 0 ? `已选 ${n} 份` : "未选";
        }
        const expMeta = root.querySelector("#dgTuneExportMeta");
        if (expMeta) {
          const theme = selLabel("#dgHtmlTheme") || "默认主题";
          const conf = selLabel("#dgConfidential") || "公开";
          expMeta.textContent = `${theme} · ${conf}`;
        }
      } catch {
        /* ignore */
      }
    }
    [
      "#dgDocPurpose",
      "#dgDocAudience",
      "#dgDocStructure",
      "#dgLenTier",
      "#dgHtmlTheme",
      "#dgConfidential",
    ].forEach((sel) => {
      root.querySelector(sel)?.addEventListener("change", refreshTuneMeta);
    });
    // 文件库勾选 / 主输入区 textarea 变化时也要刷新摘要
    root.querySelector("#dgRefs")?.addEventListener("change", refreshTuneMeta);
    // 首次刷新（等 select 填完默认 option 后再跑一次）
    setTimeout(refreshTuneMeta, 0);
    setTimeout(refreshTuneMeta, 600);

    // —— 4. 预设：保存 / 应用 / 删除 ——
    async function loadKVList(key) {
      const v = await idb.storeGet(key);
      return Array.isArray(v) ? v : [];
    }
    async function saveKVList(key, list) {
      await idb.storeSet(key, list);
    }
    function newId() {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
    async function refreshPresets(selectId) {
      const list = await loadKVList(KV_PRESETS);
      presetSel.innerHTML = `<option value="">— 选择已保存预设 —</option>` +
        list.map((p2) => `<option value="${p2.id}">${escAttr(p2.name)}</option>`).join("");
      if (selectId) presetSel.value = selectId;
      presetDel.disabled = !presetSel.value;
    }
    presetSave?.addEventListener("click", async () => {
      const name = (window.prompt("预设名称：", "我的预设 " + new Date().toLocaleString())) || "";
      if (!name.trim()) return;
      const list = await loadKVList(KV_PRESETS);
      const item = { id: newId(), name: name.trim(), config: snapshotConfig(), createdAt: Date.now() };
      list.unshift(item);
      await saveKVList(KV_PRESETS, list.slice(0, 60));
      await refreshPresets(item.id);
      ctx.toast(`已保存预设「${item.name}」`);
    });
    presetSel?.addEventListener("change", async () => {
      presetDel.disabled = !presetSel.value;
      if (!presetSel.value) return;
      const list = await loadKVList(KV_PRESETS);
      const item = list.find((x) => x.id === presetSel.value);
      if (!item) return;
      applyConfig(item.config);
      ctx.toast(`已应用预设「${item.name}」`);
    });
    presetDel?.addEventListener("click", async () => {
      if (!presetSel.value) return;
      if (!confirm("确认删除该预设？")) return;
      const list = (await loadKVList(KV_PRESETS)).filter((x) => x.id !== presetSel.value);
      await saveKVList(KV_PRESETS, list);
      await refreshPresets("");
      ctx.toast("预设已删除");
    });

    // —— 5. 最近：每次成功生成后写入 ——
    async function refreshRecent() {
      const list = await loadKVList(KV_RECENT);
      recentSel.innerHTML = `<option value="">— 最近生成 —</option>` +
        list.map((r2) => {
          const t = new Date(r2.ts).toLocaleString();
          const sum = String(r2.summary || r2.config?.req || "").replace(/\s+/g, " ").slice(0, 40);
          return `<option value="${r2.id}">${t}｜${escAttr(sum)}</option>`;
        }).join("");
    }
    recentSel?.addEventListener("change", async () => {
      if (!recentSel.value) return;
      const list = await loadKVList(KV_RECENT);
      const item = list.find((x) => x.id === recentSel.value);
      if (!item) return;
      applyConfig(item.config);
      ctx.toast("已回填最近生成的配置");
      recentSel.value = "";
    });
    async function pushRecent(summary) {
      const list = await loadKVList(KV_RECENT);
      list.unshift({ id: newId(), ts: Date.now(), summary, config: snapshotConfig() });
      await saveKVList(KV_RECENT, list.slice(0, 10));
      refreshRecent();
    }

    // —— 6. 大纲优先 ——
    outlineMode?.addEventListener("change", () => {
      if (outlineMode.checked) {
        ctx.toast("已开启大纲优先：下次点生成会先出大纲");
      }
    });
    outlineExpandBtn?.addEventListener("click", async () => {
      const outline = root.querySelector("#dgOut")?.value || "";
      if (!outline.trim()) {
        ctx.toast("当前没有大纲，先生成一次大纲", true);
        return;
      }
      root.querySelector("#dgBusy").style.display = "block";
      try {
        const inst = `请按下面这份大纲展开成完整正文。要求：\n- 严格遵循大纲的标题/小节结构与顺序\n- 每个小节内容详实、上下文连贯、含必要数据/案例\n- 输出为完整 Markdown，含原大纲的 H2/H3 标题\n\n【大纲】\n${outline}`;
        const res = await ctx.runPolish({
          instruction: inst,
          sourceContent: outline,
          model: ctx.getModel(),
        });
        await typewriterShow(root.querySelector("#dgOut"), res.content || outline);
        syncPreview();
        refreshQc();
        outlineExpandBtn.disabled = true;
        outlineExpandBtn.style.display = "none";
        ctx.toast("已按大纲展开为全文");
      } catch (err) {
        ctx.toast(err?.message || "展开失败", true);
      } finally {
        root.querySelector("#dgBusy").style.display = "none";
      }
    });

    // —— 9. 打字机式渐显：模拟流式 ——
    async function typewriterShow(taEl, fullText) {
      if (!taEl || !fullText) return;
      const text = String(fullText);
      const total = text.length;
      if (total < 600) {
        taEl.value = text;
        return;
      }
      const animMs = Math.min(1800, 600 + total * 0.6);
      const step = Math.max(1, Math.ceil(total / (animMs / 16)));
      let i = 0;
      taEl.value = "";
      return new Promise((resolve) => {
        let raf = 0;
        const tick = () => {
          i = Math.min(total, i + step);
          taEl.value = text.slice(0, i);
          taEl.scrollTop = taEl.scrollHeight;
          if (i >= total) {
            cancelAnimationFrame(raf);
            resolve();
            return;
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      });
    }

    // —— 10. 包装原 runGenerate：添加 outline / 目标字数 / typewriter / recent ——
    const origRun = runGenerate;
    async function runGenerateWrapped() {
      try {
        if (outlineMode?.checked) {
          // 大纲优先：第一次只出大纲
          const errBox = root.querySelector("#dgErr");
          errBox.innerHTML = "";
          setGenerateButtonBusy(true);
          root.querySelector("#dgBusy").style.display = "block";
          try {
            const { name, content } = await buildSource();
            const baseInst = root.querySelector("#dgReq").value.trim();
            const inst = `请只生成"大纲"（不生成正文），格式：使用 Markdown，主标题 # / 二级标题 ## / 三级标题 ###，每个小节后跟一行 "（要点：xxx，预估字数：n）"。生成完成后等待用户调整再展开。\n\n${baseInst}`;
            const res = await ctx.runDocumentGenerate({
              instruction: inst,
              sourceContent: content,
              sourceFileName: name,
              model: ctx.getModel(),
              genType: genTypeLabel(),
              genTypeKey: typeSel.value,
              tone: toneSel.value,
              genControls: collectGenControls(),
            });
            const outEl = root.querySelector("#dgOut");
            await typewriterShow(outEl, res.content || "");
            syncPreview();
            refreshQc();
            outlineExpandBtn.disabled = false;
            outlineExpandBtn.style.display = "";
            ctx.toast("已生成大纲，可手动调整后点「展开全文」");
            await pushRecent("[大纲] " + (baseInst || "").slice(0, 60));
          } finally {
            setGenerateButtonBusy(false);
            root.querySelector("#dgBusy").style.display = "none";
          }
          return;
        }
        // 普通流程：调用原 runGenerate 后做 typewriter
        const before = root.querySelector("#dgOut").value;
        await origRun();
        const after = root.querySelector("#dgOut").value;
        if (after && after !== before && after.length >= 600) {
          await typewriterShow(root.querySelector("#dgOut"), after);
          syncPreview();
        }
        await pushRecent((root.querySelector("#dgReq").value || "").slice(0, 60));
      } catch (e) {
        console.warn("[documentGenerator] runGenerateWrapped", e);
      }
    }
    // 替换按钮事件
    const dgGenBtn = root.querySelector("#dgGen");
    const dgGenTopBtn = root.querySelector("#dgGenTop");
    if (dgGenBtn) {
      const fresh = dgGenBtn.cloneNode(true);
      dgGenBtn.parentNode?.replaceChild(fresh, dgGenBtn);
      fresh.addEventListener("click", runGenerateWrapped);
    }
    if (dgGenTopBtn) {
      const fresh = dgGenTopBtn.cloneNode(true);
      dgGenTopBtn.parentNode?.replaceChild(fresh, dgGenTopBtn);
      fresh.addEventListener("click", runGenerateWrapped);
    }

    // —— 11. 存为金句 / 存进文件库 ——
    root.querySelector("#dgSendPhrase")?.addEventListener("click", async () => {
      const text = (root.querySelector("#dgOut")?.value || "").trim();
      if (!text) { ctx.toast("当前没有输出内容", true); return; }
      const cat = (window.prompt("存到哪个分类？（留空 = 默认 'AI 生成'）", "AI 生成")) || "AI 生成";
      const blocks = text.split(/\n\s*\n/).map((s) => s.trim()).filter((s) => s.length >= 8);
      let n = 0;
      for (const b of blocks) {
        try {
          await idb.putPhrase({ text: b, category: cat, tags: ["ai-生成", typeSel.value || ""].filter(Boolean), source: lastTitle || genTypeLabel() });
          n += 1;
        } catch { /* ignore */ }
      }
      ctx.toast(`已存入金句库 ${n} 条（分类：${cat}）`);
    });

    root.querySelector("#dgSendLib")?.addEventListener("click", async () => {
      const text = (root.querySelector("#dgOut")?.value || "").trim();
      if (!text) { ctx.toast("当前没有输出内容", true); return; }
      const fname = (lastTitle || `生成-${Date.now()}`).replace(/[\\/:*?"<>|]/g, "_") + ".md";
      try {
        const enc = new TextEncoder();
        const bytes = enc.encode(text);
        await ctx.ipc.libraryAddFromBuffer({
          fileName: fname,
          bytes: Array.from(bytes),
          mimeType: "text/markdown",
          tagsHint: ["ai-生成", typeSel.value || ""].filter(Boolean),
          apiKey: ctx.getApiKey(),
        });
        ctx.toast(`已存进文件库：${fname}`);
      } catch (e) {
        ctx.toast(`存入失败：${e?.message || e}`, true);
      }
    });

    // —— 12. AI 自评 ——
    root.querySelector("#dgSelfRate")?.addEventListener("click", async () => {
      const text = (root.querySelector("#dgOut")?.value || "").trim();
      if (!text) { ctx.toast("当前没有输出内容", true); return; }
      root.querySelector("#dgBusy").style.display = "block";
      try {
        const inst = `请对下面这篇生成稿做"自评"，输出 Markdown 包含：\n- 总分（1-10）+ 一句话总结\n- 优点（3 条）\n- 缺点 / 风险（3 条）\n- 改进建议（具体到段落级，3-5 条）\n\n保持客观、可执行。`;
        const res = await ctx.runPolish({ instruction: inst, sourceContent: text, model: ctx.getModel() });
        const qcOut = root.querySelector("#dgQcOut");
        if (qcOut) {
          qcOut.innerHTML = `<div class="dg-selfrate-block">${markdownToSafeHtml(res.content || "（自评失败）")}</div>`;
          qcOut.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        ctx.toast("已生成自评，已显示在 QC 面板");
      } catch (e) {
        ctx.toast(e?.message || "自评失败", true);
      } finally {
        root.querySelector("#dgBusy").style.display = "none";
      }
    });

    // —— 13. 版本对比 Diff ——
    function makeDiff(a, b) {
      const al = String(a || "").split(/\n/);
      const bl = String(b || "").split(/\n/);
      const m = al.length, n = bl.length;
      const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
      for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
          dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
      const out = [];
      let i = 0, j = 0;
      while (i < m && j < n) {
        if (al[i] === bl[j]) { out.push({ t: "eq", v: al[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "del", v: al[i] }); i++; }
        else { out.push({ t: "add", v: bl[j] }); j++; }
      }
      while (i < m) { out.push({ t: "del", v: al[i++] }); }
      while (j < n) { out.push({ t: "add", v: bl[j++] }); }
      return out;
    }
    function escapeHtmlLite(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function renderDiff(diff) {
      return `<pre class="dg-diff-pre">${diff.map((d) => {
        const cls = d.t === "add" ? "dg-diff-add" : d.t === "del" ? "dg-diff-del" : "dg-diff-eq";
        const sign = d.t === "add" ? "+ " : d.t === "del" ? "- " : "  ";
        return `<span class="${cls}">${sign}${escapeHtmlLite(d.v)}</span>`;
      }).join("\n")}</pre>`;
    }

    function refreshVerDiffBtn() {
      const versions = loadWorkbenchVersions(LS_GENERATOR_VERSIONS) || [];
      const btn = root.querySelector("#dgVerDiff");
      if (btn) btn.disabled = versions.length < 2;
    }
    refreshVerDiffBtn();
    const verObs = new MutationObserver(refreshVerDiffBtn);
    const verHost = root.querySelector("#dgVerList");
    if (verHost) verObs.observe(verHost, { childList: true, subtree: true });
    cleanups.push(() => verObs.disconnect());

    root.querySelector("#dgVerDiff")?.addEventListener("click", () => {
      const versions = loadWorkbenchVersions(LS_GENERATOR_VERSIONS) || [];
      if (versions.length < 2) { ctx.toast("至少需要 2 个版本才能对比", true); return; }
      const dlg = document.createElement("div");
      dlg.className = "dg-diff-overlay";
      dlg.innerHTML = `
        <div class="dg-diff-modal">
          <div class="dg-diff-modal-head">
            <strong>版本对比</strong>
            <span class="muted dg-toolbox-mini" style="margin-left:auto">绿色 = 新增，红色 = 删除</span>
            <button type="button" class="btn btn-ghost btn-sm" id="dgDiffClose">×</button>
          </div>
          <div class="dg-diff-modal-row">
            <select class="inp" id="dgDiffA">${versions.map((v, i) => `<option value="${i}">${i + 1}. ${escAttr(v.label || v.title || "v" + (i + 1))}</option>`).join("")}</select>
            <span class="muted dg-toolbox-mini">→</span>
            <select class="inp" id="dgDiffB">${versions.map((v, i) => `<option value="${i}" ${i === versions.length - 1 ? "selected" : ""}>${i + 1}. ${escAttr(v.label || v.title || "v" + (i + 1))}</option>`).join("")}</select>
            <button type="button" class="btn btn-secondary btn-sm" id="dgDiffRefresh">对比</button>
          </div>
          <div class="dg-diff-body" id="dgDiffBody"></div>
        </div>`;
      document.body.appendChild(dlg);
      function compute() {
        const a = versions[Number(dlg.querySelector("#dgDiffA").value)] || {};
        const b = versions[Number(dlg.querySelector("#dgDiffB").value)] || {};
        const diff = makeDiff(a.content || "", b.content || "");
        dlg.querySelector("#dgDiffBody").innerHTML = renderDiff(diff);
      }
      dlg.querySelector("#dgDiffRefresh").addEventListener("click", compute);
      dlg.querySelector("#dgDiffA").addEventListener("change", compute);
      dlg.querySelector("#dgDiffB").addEventListener("change", compute);
      dlg.querySelector("#dgDiffClose").addEventListener("click", () => dlg.remove());
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.remove(); });
      compute();
    });

    // —— 14. 扩展 floatBar：增加更多动作 ——
    // 各动作分为两类：
    //   replace  → AI 返回完整新 Markdown，整篇替换 dgOut
    //   appendCritique → AI 仅给评论建议，作为引用块追加到选中片段后，原文保留
    if (typeof ensureFloatBar === "function") {
      const fb = ensureFloatBar();
      const extra = [
        { k: "zh", label: "译中", mode: "replace", inst: "将选中文本翻译为简体中文；输出替换该片段后的**完整** Markdown。" },
        { k: "continue", label: "续写", mode: "replace", inst: "在选中文本之后继续写一段，自然衔接上下文；输出替换该片段后的**完整** Markdown。" },
        { k: "critique", label: "🔍 挑刺", mode: "appendCritique", inst: "请针对【选中片段】指出 3-5 个具体问题（用编号列出），并给出可执行的改进建议。只输出问题与建议本身，**不要**重复或改写原文。" },
        { k: "custom", label: "✎ 自定义", mode: "replace", inst: "" },
      ];
      const ta2 = root.querySelector("#dgOut");
      extra.forEach((x) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-secondary btn-sm";
        b.dataset.selExt = x.k;
        b.textContent = x.label;
        fb.appendChild(b);
        b.addEventListener("click", async () => {
          const s = ta2.selectionStart, e2 = ta2.selectionEnd;
          if (s == null || e2 == null || s >= e2) return;
          const sel = ta2.value.slice(s, e2);
          if (sel.length < 4) return;
          let inst = x.inst || "";
          if (x.k === "custom") {
            inst = window.prompt("自定义指令（描述你想对选中文本做什么）：", "") || "";
            if (!inst.trim()) return;
            inst = `${inst}；输出替换该片段后的**完整** Markdown。`;
          }
          fb.classList.add("hidden");
          root.querySelector("#dgBusy").style.display = "block";
          try {
            const res = await ctx.runPolish({
              instruction: `${inst}\n\n【选中片段】\n${sel}\n\n【全文】\n${ta2.value}`,
              sourceContent: ta2.value,
              model: ctx.getModel(),
            });
            const aiText = String(res.content || "").trim();
            if (!aiText) {
              ctx.toast("AI 没有返回内容", true);
              return;
            }
            if (x.mode === "appendCritique") {
              // 把批评作为引用块插在选中片段紧接位置后；原文保留
              const block = `\n\n> 🔍 **AI 挑刺**（针对前述片段）：\n>\n${aiText
                .split(/\r?\n/)
                .map((ln) => "> " + ln)
                .join("\n")}\n`;
              ta2.value = ta2.value.slice(0, e2) + block + ta2.value.slice(e2);
              // 让光标落在新增块末尾
              const newPos = e2 + block.length;
              ta2.setSelectionRange(newPos, newPos);
            } else {
              ta2.value = aiText;
            }
            syncPreview();
            refreshQc();
            ctx.toast(`已完成「${x.label}」`);
          } catch (err) {
            ctx.toast(err?.message || "失败", true);
          } finally {
            root.querySelector("#dgBusy").style.display = "none";
          }
        });
      });
    }

    // —— 16. 键盘快捷键 ——
    function isFormEl(t) {
      const tag = (t?.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable;
    }
    function onKey(e) {
      if (!root.isConnected || root.offsetParent === null) return;
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      if (ctrlOrCmd && e.key === "Enter") {
        e.preventDefault();
        runGenerateWrapped();
      } else if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "s" && root.querySelector(".wb-panel.is-active[data-dg-panel='output']")) {
        e.preventDefault();
        root.querySelector("#dgVerSave")?.click();
      } else if (ctrlOrCmd && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        root.querySelectorAll("[data-dg-tab]").forEach((b) =>
          b.classList.toggle("is-active", b.getAttribute("data-dg-tab") === "export"));
        root.querySelectorAll("[data-dg-panel]").forEach((pan) =>
          pan.classList.toggle("is-active", pan.getAttribute("data-dg-panel") === "export"));
      } else if (ctrlOrCmd && e.key.toLowerCase() === "k" && !isFormEl(e.target)) {
        e.preventDefault();
        root.querySelector("#dgReq")?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    cleanups.push(() => document.removeEventListener("keydown", onKey));

    kbdHelpBtn?.addEventListener("click", () => {
      // 防重复打开
      if (document.querySelector(".dg-kbd-overlay")) return;
      const rows = [
        ["Ctrl/⌘ + Enter", "🚀 生成（任何面板下都可用）"],
        ["Ctrl/⌘ + S", "💾 当前输出存为版本（在「输出」面板时）"],
        ["Ctrl/⌘ + Shift + E", "📤 切换到「导出」面板"],
        ["Ctrl/⌘ + K", "🎯 聚焦到生成指令输入框"],
        ["Esc", "✕ 关闭浮动工具条 / 模态"],
      ];
      const dlg = document.createElement("div");
      dlg.className = "dg-diff-overlay dg-kbd-overlay";
      dlg.innerHTML = `
        <div class="dg-diff-modal" style="height:auto;max-height:78vh;max-width:520px">
          <div class="dg-diff-modal-head">
            <strong>⌨ 键盘快捷键</strong>
            <span class="muted dg-toolbox-mini" style="margin-left:auto">这些快捷键仅在文件生成页面生效</span>
            <button type="button" class="btn btn-ghost btn-sm" id="dgKbdClose">×</button>
          </div>
          <table style="width:100%;border-collapse:separate;border-spacing:0 6px;padding:12px 16px">
            ${rows.map(([k, desc]) => `
              <tr>
                <td style="padding:6px 14px;text-align:right;width:42%">
                  <kbd style="display:inline-block;padding:3px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.42);background:rgba(15,23,42,0.45);font-family:Consolas,monospace;font-size:0.86rem">${escAttr(k)}</kbd>
                </td>
                <td style="padding:6px 12px;font-size:0.92rem">${escAttr(desc)}</td>
              </tr>`).join("")}
          </table>
          <p class="muted" style="font-size:0.74rem;padding:0 16px 14px;margin:0">提示：按 / 任意位置可快速聚焦"金句库 / 文件库"的搜索框；浮条上的按钮可对 Markdown 源里的选中文字做局部润色或追加批注。</p>
        </div>`;
      document.body.appendChild(dlg);
      const close = () => dlg.remove();
      dlg.querySelector("#dgKbdClose").addEventListener("click", close);
      dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
      const onEsc = (e) => {
        if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); }
      };
      document.addEventListener("keydown", onEsc);
    });

    // —— 18. 章节工具：在预览页给每个 H2/H3 加 [重写/删/插入] ——
    let sectionToolsOn = false;
    const sectionBtn = root.querySelector("#dgSectionTools");
    function refreshSectionTools() {
      const previewEl = root.querySelector("#dgPreview");
      if (!previewEl) return;
      previewEl.querySelectorAll(".dg-section-toolbar").forEach((n) => n.remove());
      if (!sectionToolsOn) return;
      const heads = previewEl.querySelectorAll("h2, h3");
      heads.forEach((h, i) => {
        const bar = document.createElement("span");
        bar.className = "dg-section-toolbar";
        bar.dataset.idx = String(i);
        bar.dataset.heading = h.textContent || "";
        bar.dataset.level = (h.tagName || "H2").toLowerCase();
        bar.innerHTML = `<button type="button" data-act="rewrite" title="按现有要求重写本节">🔄</button>
          <button type="button" data-act="del" title="删除本节">✂</button>
          <button type="button" data-act="insert" title="在本节后插入新章节">➕</button>
          <button type="button" data-act="up" title="上移本节">⬆</button>
          <button type="button" data-act="down" title="下移本节">⬇</button>`;
        h.appendChild(bar);
      });
    }
    sectionBtn?.addEventListener("click", () => {
      sectionToolsOn = !sectionToolsOn;
      sectionBtn.dataset.active = sectionToolsOn ? "1" : "0";
      sectionBtn.classList.toggle("dg-output-btn-active", sectionToolsOn);
      refreshSectionTools();
      ctx.toast(sectionToolsOn ? "章节工具：开启" : "章节工具：关闭");
    });
    // 重新渲染预览后重新挂工具按钮
    const origSyncPreview = syncPreview;
    syncPreview = function patchedSyncPreview() {
      origSyncPreview.apply(this, arguments);
      refreshSectionTools();
      refreshAnnotationsHighlight();
    };

    function splitBySections(md) {
      // 按 h2/h3 切片：返回 [{level, heading, body}]
      const lines = String(md || "").split(/\r?\n/);
      const sections = [];
      let cur = { level: 0, heading: "", body: [] };
      sections.push(cur);
      for (const ln of lines) {
        const m = /^(#{2,3})\s+(.+)$/.exec(ln);
        if (m) {
          cur = { level: m[1].length, heading: m[2].trim(), body: [ln] };
          sections.push(cur);
        } else {
          cur.body.push(ln);
        }
      }
      return sections;
    }
    function joinSections(sections) {
      return sections.map((s) => s.body.join("\n")).join("\n").replace(/\n{3,}/g, "\n\n");
    }
    function findSectionIdx(sections, heading, level) {
      // sections[0] 是头部空 section，匹配从 1 开始
      for (let i = 1; i < sections.length; i++) {
        if (sections[i].heading === heading && (!level || sections[i].level === level)) return i;
      }
      return -1;
    }

    root.querySelector("#dgPreview")?.addEventListener("click", async (ev) => {
      const btn = /** @type {HTMLElement} */ (ev.target).closest("[data-act]");
      if (!btn) return;
      const bar = btn.closest(".dg-section-toolbar");
      if (!bar) return;
      const heading = bar.dataset.heading || "";
      const level = bar.dataset.level === "h3" ? 3 : 2;
      const act = btn.getAttribute("data-act") || "";
      const ta2 = root.querySelector("#dgOut");
      const sections = splitBySections(ta2.value);
      const idx = findSectionIdx(sections, heading, level);
      if (idx < 0) { ctx.toast("无法定位本节（可能与源文不一致）", true); return; }

      if (act === "del") {
        if (!confirm(`确认删除本节「${heading}」？`)) return;
        sections.splice(idx, 1);
        ta2.value = joinSections(sections);
        syncPreview();
        ctx.toast("已删除本节");
      } else if (act === "insert") {
        const t = window.prompt("新章节标题：", "新章节") || "";
        if (!t.trim()) return;
        const ins = `\n\n${"#".repeat(level)} ${t.trim()}\n\n（待补充）\n`;
        sections.splice(idx + 1, 0, { level, heading: t.trim(), body: ins.split("\n") });
        ta2.value = joinSections(sections);
        syncPreview();
        ctx.toast("已插入新章节");
      } else if (act === "up" || act === "down") {
        const j = act === "up" ? idx - 1 : idx + 1;
        if (j < 1 || j >= sections.length) { ctx.toast("已是边界", true); return; }
        [sections[idx], sections[j]] = [sections[j], sections[idx]];
        ta2.value = joinSections(sections);
        syncPreview();
        ctx.toast(act === "up" ? "已上移" : "已下移");
      } else if (act === "rewrite") {
        ev.preventDefault();
        const sectionMd = sections[idx].body.join("\n");
        root.querySelector("#dgBusy").style.display = "block";
        try {
          const inst = `请只重写下面这一节（保持其 H${level} 标题与位置）。要求：与全文风格保持一致、内容更精炼或更详实（视长度而定）、不要触及其它章节。\n\n【全文上下文（仅供参考，请勿输出）】\n${ta2.value}\n\n【需重写章节】\n${sectionMd}`;
          const res = await ctx.runPolish({
            instruction: inst,
            sourceContent: sectionMd,
            model: ctx.getModel(),
          });
          let newSec = String(res.content || sectionMd);
          // 保险：若返回内容没有以原标题开头，强制加上
          const headingPat = new RegExp(`^#{2,3}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
          if (!headingPat.test(newSec)) {
            newSec = `${"#".repeat(level)} ${heading}\n\n${newSec}`;
          }
          sections[idx] = { level, heading, body: newSec.split("\n") };
          ta2.value = joinSections(sections);
          syncPreview();
          ctx.toast("已重写本节");
        } catch (e) {
          ctx.toast(e?.message || "重写失败", true);
        } finally {
          root.querySelector("#dgBusy").style.display = "none";
        }
      }
    });

    // —— 19. 预设导出/导入（只圆环 KV_PRESETS，与 UI 一致） ——
    root.querySelector("#dgTplExport")?.addEventListener("click", async () => {
      const presets = await loadKVList(KV_PRESETS);
      if (!presets.length) {
        ctx.toast("当前没有预设可导出", true);
        return;
      }
      const data = {
        kind: "ACSP-DocGenPresets",
        version: 2,
        exportedAt: Date.now(),
        presets,
      };
      try {
        const r = await ctx.ipc.saveGeneratedFile({
          suggestedName: `docgen-presets-${Date.now()}.tpl.json`,
          content: JSON.stringify(data, null, 2),
          format: "json",
        });
        ctx.toast(r?.canceled ? "已取消" : `已导出 ${presets.length} 个预设：${r?.path || ""}`);
      } catch (e) {
        ctx.toast(e?.message || "导出失败", true);
      }
    });
    root.querySelector("#dgTplImport")?.addEventListener("click", () => {
      root.querySelector("#dgTplImportInput")?.click();
    });
    root.querySelector("#dgTplImportInput")?.addEventListener("change", async (ev) => {
      const f = /** @type {HTMLInputElement} */ (ev.target).files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        const data = JSON.parse(text);
        // 兼容旧 v1 (含 myTemplates) 与新 v2 (仅 presets)
        if (data.kind !== "ACSP-DocGenPresets" && data.kind !== "ACSP-DocGenTemplates") {
          ctx.toast("文件格式不匹配（不是 DocGen 预设包）", true);
          return;
        }
        const presetCount = data.presets?.length || 0;
        if (!presetCount) {
          ctx.toast("文件中没有可导入的预设", true);
          return;
        }
        if (!confirm(`检测到 ${presetCount} 个预设，合并到现有？`)) return;
        const cur = await loadKVList(KV_PRESETS);
        const ids = new Set(cur.map((x) => x.id));
        const merged = [...cur, ...(data.presets || []).filter((x) => !ids.has(x.id))];
        await saveKVList(KV_PRESETS, merged.slice(0, 80));
        await refreshPresets("");
        ctx.toast(`已导入：${merged.length - cur.length} 个预设`);
      } catch (e) {
        ctx.toast(e?.message || "导入失败", true);
      } finally {
        /** @type {HTMLInputElement} */
        (ev.target).value = "";
      }
    });

    // —— 20. 队列：加入 / 运行 / 清空 ——
    /** @type {Array<{id:string, config:any, summary:string}>} */
    let queue = [];
    const queueNEl = root.querySelector("#dgQueueN");
    const queueRunBtn = root.querySelector("#dgQueueRun");
    const queueClearBtn = root.querySelector("#dgQueueClear");
    function refreshQueueUi() {
      queueNEl.textContent = String(queue.length);
      queueRunBtn.disabled = queue.length === 0;
      queueClearBtn.disabled = queue.length === 0;
    }
    root.querySelector("#dgQueueAdd")?.addEventListener("click", () => {
      const c = snapshotConfig();
      const sum = (c.req || "").slice(0, 60);
      queue.push({ id: newId(), config: c, summary: sum });
      refreshQueueUi();
      ctx.toast(`已加入队列（共 ${queue.length} 个）`);
    });
    queueClearBtn?.addEventListener("click", () => {
      queue = [];
      refreshQueueUi();
    });
    queueRunBtn?.addEventListener("click", async () => {
      if (!queue.length) return;
      queueRunBtn.disabled = true;
      const total = queue.length;
      let done = 0;
      const results = [];
      for (const task of queue) {
        applyConfig(task.config);
        try {
          const { name, content } = await buildSource();
          const res = await ctx.runDocumentGenerate({
            instruction: `${task.config.req || ""}\n\n（输出语言：${ctx.settings().defaultLang || "zh-CN"}；语气：${task.config.tone || ""}）`,
            sourceContent: content,
            sourceFileName: name,
            model: ctx.getModel(),
            genType: genTypeLabel(),
            genTypeKey: task.config.type || "",
            tone: task.config.tone || "",
            genControls: collectGenControls(),
          });
          results.push({ ok: true, summary: task.summary, content: res.content || "" });
          // 顺便存历史
          await historyStore.pushHistory({
            type: "generate",
            title: `[队列] ${task.summary}`.slice(0, 80),
            summary: (res.content || "").slice(0, 200),
            content: res.content || "",
            meta: { queueRun: true, ...task.config },
          });
        } catch (e) {
          results.push({ ok: false, summary: task.summary, error: e?.message || String(e) });
        }
        done += 1;
        ctx.toast(`队列：${done}/${total} 完成`);
      }
      queue = [];
      refreshQueueUi();
      const okN = results.filter((r) => r.ok).length;
      ctx.toast(`队列全部完成：成功 ${okN} / 失败 ${total - okN}（结果已保存到「历史」）`);
      if (results[results.length - 1]?.ok) {
        const last = results[results.length - 1];
        root.querySelector("#dgOut").value = last.content || "";
        syncPreview();
      }
    });

    // —— 21. 并行 A/B/C 变体 ——
    const variantNSel = root.querySelector("#dgVariantN");
    const variantTabs = root.querySelector("#dgVariantTabs");
    /** @type {Array<{label:string, content:string}>} */
    let variants = [];
    let variantActiveIdx = 0;
    function renderVariantTabs() {
      if (!variants.length || variants.length < 2) {
        variantTabs.style.display = "none";
        variantTabs.innerHTML = "";
        return;
      }
      variantTabs.style.display = "";
      variantTabs.innerHTML = `<span class="muted dg-toolbox-mini">并行变体（点切换 / 双击采用）：</span>` +
        variants.map((v, i) => `
          <button type="button" class="dg-variant-tab ${i === variantActiveIdx ? "is-active" : ""}" data-vidx="${i}" title="单击预览 / 双击采用为最终稿">
            <strong>${v.label}</strong>
            <span class="muted">${(v.content || "").length} 字</span>
          </button>`).join("") +
        `<button type="button" class="btn btn-ghost btn-sm" id="dgVariantClear" title="清空变体">×</button>`;
      variantTabs.querySelectorAll("[data-vidx]").forEach((b) => {
        b.addEventListener("click", () => {
          const i = Number(b.getAttribute("data-vidx") || 0);
          variantActiveIdx = i;
          root.querySelector("#dgOut").value = variants[i]?.content || "";
          syncPreview();
          renderVariantTabs();
        });
        b.addEventListener("dblclick", () => {
          const i = Number(b.getAttribute("data-vidx") || 0);
          variantActiveIdx = i;
          variants = [];
          variantTabs.style.display = "none";
          variantTabs.innerHTML = "";
          ctx.toast(`已采用变体 ${String.fromCharCode(65 + i)}`);
        });
      });
      variantTabs.querySelector("#dgVariantClear")?.addEventListener("click", () => {
        variants = [];
        renderVariantTabs();
      });
    }

    // —— 22. 封面页：生成 / 导出时拼接 ——
    const coverPageCb = root.querySelector("#dgCoverPage");
    async function buildCoverBlockAsync() {
      if (!coverPageCb?.checked) return "";
      const t = (lastTitle || genTypeLabel() || "未命名").trim();
      const proj = currentProjectName() || "";
      const conf = root.querySelector("#dgConfidential")?.value || "";
      const confLabel = conf === "confidential" ? "🔒 保密" : conf === "internal" ? "🏢 内部" : "🌐 公开";
      const today = new Date().toISOString().slice(0, 10);
      const bp = (await idb.storeGet("dgBrandPack")) || {};
      const company = bp.company || proj || "";
      return `# ${t}\n\n` +
        `> ${[company, confLabel, today].filter(Boolean).join(" · ")}\n\n` +
        `---\n\n`;
    }

    // —— 23. 品牌包：弹窗设置 + 注入 YAML 元数据 ——
    root.querySelector("#dgBrandPack")?.addEventListener("click", async () => {
      const bp = (await idb.storeGet("dgBrandPack")) || {};
      const dlg = document.createElement("div");
      dlg.className = "dg-diff-overlay";
      dlg.innerHTML = `
        <div class="dg-diff-modal" style="height:auto;max-height:80vh">
          <div class="dg-diff-modal-head">
            <strong>🏢 品牌包设置</strong>
            <span class="muted dg-toolbox-mini" style="margin-left:auto">作用于导出元数据 / HTML 主题</span>
            <button type="button" class="btn btn-ghost btn-sm" id="bpClose">×</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <label class="muted">公司名称
              <input class="inp" id="bpCompany" value="${escAttr(bp.company || "")}" placeholder="如：藏经阁文创工作室" />
            </label>
            <label class="muted">主色（HEX）
              <input type="color" class="inp" id="bpColor" value="${escAttr(bp.color || "#dc2626")}" style="width:80px;height:36px;padding:0" />
            </label>
            <label class="muted">页脚文字
              <input class="inp" id="bpFooter" value="${escAttr(bp.footer || "")}" placeholder="如：© 2026 公司名 · 保密文件" />
            </label>
            <label class="muted">Logo（可选，作用于 HTML 导出）
              <input type="file" id="bpLogo" accept="image/*" />
              ${bp.logo ? `<div style="margin-top:6px"><img src="${bp.logo}" style="max-width:120px;max-height:60px;border:1px solid var(--line)"/></div>` : ""}
            </label>
            <div class="row">
              <button type="button" class="btn btn-primary btn-sm" id="bpSave">保存</button>
              <button type="button" class="btn btn-ghost btn-sm" id="bpClear">清空</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(dlg);
      const close = () => dlg.remove();
      dlg.querySelector("#bpClose").addEventListener("click", close);
      dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
      dlg.querySelector("#bpClear").addEventListener("click", async () => {
        await idb.storeSet("dgBrandPack", {});
        ctx.toast("品牌包已清空");
        close();
      });
      dlg.querySelector("#bpSave").addEventListener("click", async () => {
        const company = dlg.querySelector("#bpCompany").value || "";
        const color = dlg.querySelector("#bpColor").value || "";
        const footer = dlg.querySelector("#bpFooter").value || "";
        const logoFile = dlg.querySelector("#bpLogo").files?.[0];
        let logo = bp.logo || "";
        if (logoFile) {
          logo = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result || ""));
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(logoFile);
          });
        }
        await idb.storeSet("dgBrandPack", { company, color, footer, logo });
        ctx.toast("品牌包已保存");
        close();
      });
    });

    // —— 24. 批注：用浮条加 + 列表展示 + 高亮 ——
    const ANNO_KEY = "dgAnnotations";
    /** @type {Array<{id:string, quote:string, note:string, ts:number}>} */
    let annotations = [];
    const annoBtn = root.querySelector("#dgAnnoToggle");
    const annoPanel = root.querySelector("#dgAnnoPanel");
    const annoList = root.querySelector("#dgAnnoList");
    const annoCount = root.querySelector("#dgAnnoCount");

    async function loadAnnotations() {
      annotations = await loadKVList(ANNO_KEY);
      renderAnnoList();
      refreshAnnotationsHighlight();
    }
    async function saveAnnotations() {
      await saveKVList(ANNO_KEY, annotations);
      renderAnnoList();
      refreshAnnotationsHighlight();
    }
    function renderAnnoList() {
      annoCount.textContent = `${annotations.length} 条`;
      if (!annotations.length) {
        annoList.innerHTML = `<div class="muted" style="padding:8px">还没有批注。在源文/预览中选中文字后用浮条「💬 批注」添加。</div>`;
        return;
      }
      annoList.innerHTML = annotations.map((a) => `
        <div class="dg-anno-item" data-aid="${a.id}">
          <div class="dg-anno-quote">「${escAttr(a.quote.slice(0, 80))}${a.quote.length > 80 ? "…" : ""}」</div>
          <div class="dg-anno-note">${escAttr(a.note)}</div>
          <div class="dg-anno-meta">
            <span class="muted dg-toolbox-mini">${new Date(a.ts).toLocaleString()}</span>
            <button type="button" class="btn btn-ghost btn-sm" data-anno-act="locate" data-aid="${a.id}">定位</button>
            <button type="button" class="btn btn-ghost btn-sm" data-anno-act="del" data-aid="${a.id}">删除</button>
          </div>
        </div>`).join("");
      annoList.querySelectorAll("[data-anno-act]").forEach((b) => {
        b.addEventListener("click", async () => {
          const id = b.getAttribute("data-aid") || "";
          const act = b.getAttribute("data-anno-act") || "";
          if (act === "del") {
            annotations = annotations.filter((x) => x.id !== id);
            await saveAnnotations();
            ctx.toast("批注已删除");
          } else if (act === "locate") {
            const a = annotations.find((x) => x.id === id);
            if (!a) return;
            const ta2 = root.querySelector("#dgOut");
            const idx = ta2.value.indexOf(a.quote);
            if (idx >= 0) {
              ta2.focus();
              ta2.setSelectionRange(idx, idx + a.quote.length);
              ta2.scrollTop = ta2.scrollHeight * (idx / Math.max(1, ta2.value.length));
            } else {
              ctx.toast("源文找不到对应片段（可能已编辑）", true);
            }
          }
        });
      });
    }
    function refreshAnnotationsHighlight() {
      const previewEl = root.querySelector("#dgPreview");
      if (!previewEl) return;
      // 移除旧的高亮
      previewEl.querySelectorAll(".dg-anno-mark").forEach((m) => {
        const txt = document.createTextNode(m.textContent || "");
        m.parentNode?.replaceChild(txt, m);
      });
      previewEl.normalize?.();
      if (!annotations.length) return;
      const walker = document.createTreeWalker(previewEl, NodeFilter.SHOW_TEXT, null);
      /** @type {Text[]} */
      const targets = [];
      let n;
      while ((n = walker.nextNode())) {
        const t = n.textContent || "";
        if (t.length < 2) continue;
        for (const a of annotations) {
          if (a.quote && t.includes(a.quote)) {
            targets.push(/** @type {Text} */ (n));
            break;
          }
        }
      }
      for (const tn of targets) {
        let html = tn.textContent || "";
        for (const a of annotations) {
          if (!a.quote) continue;
          const safe = a.quote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          html = html.replace(new RegExp(safe, "g"), `<mark class="dg-anno-mark" title="${escAttr(a.note)}" data-aid="${a.id}">$&</mark>`);
        }
        const span = document.createElement("span");
        span.innerHTML = html;
        tn.parentNode?.replaceChild(span, tn);
      }
    }
    annoBtn?.addEventListener("click", async () => {
      const on = annoBtn.dataset.active !== "1";
      annoBtn.dataset.active = on ? "1" : "0";
      annoBtn.classList.toggle("dg-output-btn-active", on);
      annoPanel.style.display = on ? "" : "none";
      if (on) await loadAnnotations();
    });
    root.querySelector("#dgAnnoClear")?.addEventListener("click", async () => {
      if (!annotations.length) return;
      if (!confirm("确认清空所有批注？")) return;
      annotations = [];
      await saveAnnotations();
    });
    // 给 floatBar 加批注按钮
    if (typeof ensureFloatBar === "function") {
      const fb = ensureFloatBar();
      const annoB = document.createElement("button");
      annoB.type = "button";
      annoB.className = "btn btn-secondary btn-sm";
      annoB.textContent = "💬 批注";
      fb.appendChild(annoB);
      const ta2 = root.querySelector("#dgOut");
      annoB.addEventListener("click", async () => {
        const s = ta2.selectionStart, e2 = ta2.selectionEnd;
        if (s == null || e2 == null || s >= e2) return;
        const sel = ta2.value.slice(s, e2);
        if (sel.length < 2) return;
        const note = window.prompt(`为以下片段添加批注：\n\n「${sel.slice(0, 80)}${sel.length > 80 ? "…" : ""}」\n\n你的备注：`, "") || "";
        if (!note.trim()) return;
        annotations.unshift({ id: newId(), quote: sel, note: note.trim(), ts: Date.now() });
        await saveAnnotations();
        if (annoBtn?.dataset.active !== "1") annoBtn?.click();
        ctx.toast("已加批注");
      });
    }
    await loadAnnotations();

    // —— 25. Markdown 表格 → Mermaid 图表 ——
    function detectMarkdownTables(md) {
      // 简单检测：以 |...| 形式的连续行块
      const lines = String(md || "").split(/\r?\n/);
      const tables = [];
      let i = 0;
      while (i < lines.length) {
        if (/^\s*\|.+\|\s*$/.test(lines[i]) && i + 1 < lines.length && /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1])) {
          const start = i;
          let end = i + 2;
          while (end < lines.length && /^\s*\|.+\|\s*$/.test(lines[end])) end += 1;
          tables.push({ start, end: end - 1, lines: lines.slice(start, end) });
          i = end;
        } else {
          i += 1;
        }
      }
      return tables;
    }
    function tableToData(tbl) {
      const rows = tbl.lines.filter((l) => !/^\s*\|[\s|:-]+\|\s*$/.test(l));
      const parsed = rows.map((r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()));
      if (parsed.length < 2) return null;
      const head = parsed[0];
      const body = parsed.slice(1);
      // 取首列 + 第一个数值列
      let valueCol = -1;
      for (let c = 1; c < head.length; c++) {
        if (body.every((row) => /^[\d.,%]+$/.test((row[c] || "").trim()))) { valueCol = c; break; }
      }
      if (valueCol < 0) return null;
      const data = body.map((row) => {
        const v = parseFloat((row[valueCol] || "0").replace(/[%,]/g, ""));
        return { label: row[0] || "—", value: Number.isFinite(v) ? v : 0 };
      });
      return { title: head[valueCol] || "数据", data };
    }
    function dataToMermaid(d, kind = "pie") {
      if (kind === "pie") {
        return `\`\`\`mermaid\npie title ${d.title}\n${d.data.map((x) => `  "${x.label}" : ${x.value}`).join("\n")}\n\`\`\``;
      }
      // bar via mermaid xychart-beta
      return `\`\`\`mermaid\nxychart-beta\n  title "${d.title}"\n  x-axis [${d.data.map((x) => `"${x.label}"`).join(", ")}]\n  bar [${d.data.map((x) => x.value).join(", ")}]\n\`\`\``;
    }
    root.querySelector("#dgTable2Chart")?.addEventListener("click", () => {
      const ta2 = root.querySelector("#dgOut");
      const md = ta2.value;
      const tables = detectMarkdownTables(md);
      if (!tables.length) { ctx.toast("当前没有 Markdown 表格", true); return; }
      const choice = window.prompt(`发现 ${tables.length} 个表格，选择图表类型：\n  pie  = 饼图\n  bar  = 柱图\n（直接回车 = pie）`, "pie") || "pie";
      const kind = /^bar/i.test(choice) ? "bar" : "pie";
      // 从后向前插入，避免行号偏移
      const lines = md.split(/\r?\n/);
      let inserted = 0;
      for (let i = tables.length - 1; i >= 0; i--) {
        const t = tables[i];
        const parsed = tableToData(t);
        if (!parsed) continue;
        const mermaid = dataToMermaid(parsed, kind);
        lines.splice(t.end + 1, 0, "", mermaid);
        inserted += 1;
      }
      ta2.value = lines.join("\n");
      syncPreview();
      ctx.toast(`已插入 ${inserted} 个 Mermaid 图表块`);
    });

    // —— 25b. 智能表格工坊：生成 / 分析 / 公式自检 ——
    const ST_STARTERS = {
      itinerary: "我要一份行程表。请包含：日期(YYYY-MM-DD)、星期、时段、行程内容、地点、交通方式、预算(数字)、实际(数字)、余额(公式 = 预算 - 实际)、备注。日期连续，至少 5 天示例。\n\n场景细节：",
      finance: "我要一份财务记账表。请包含：日期、类目(收入/餐饮/交通/购物/其他)、描述、收入(数字)、支出(数字)、累计余额(公式 = 上一行余额 + 本行收入 - 本行支出)、备注。至少 7 行示例，第一行余额可为期初。\n\n场景细节：",
      project: "我要一份项目计划表。请包含：阶段、任务、负责人、开始日期、计划完成、实际完成、状态(公式 IFS(实际=\"\",\"未开始\",实际<=计划,\"按期\",TRUE,\"延期\"))、进度百分比(数字 0-1)、备注。至少 6 行示例。\n\n场景细节：",
      inventory: "我要一份库存清单表。请包含：编号、名称、规格、单位、库存数量(数字)、单价(数字)、库存价值(公式 = 数量 * 单价)、安全库存(数字)、补货状态(公式 IF(数量<安全库存,\"需补货\",\"充足\"))、备注。至少 6 行示例，并在最后一行给出总价值 SUM。\n\n场景细节：",
      crm: "我要一份客户跟进表。请包含：客户名、行业、联系人、电话、最近联系、下次跟进、阶段(潜在/接触/方案/谈判/成交/失败)、预估金额(数字)、成交概率%(数字 0-100)、加权金额(公式 = 金额 * 概率 / 100)、负责人。至少 6 行示例。\n\n场景细节：",
      expense: "我要一份报销/差旅表。请包含：日期、项目、明细、类目(交通/住宿/餐饮/通讯/其它)、金额(数字)、发票编号、报销状态(待提交/已提交/已报销)。最后一行做合计：金额列用 SUM 公式。至少 6 行示例。\n\n场景细节：",
      kpi: "我要一份 KPI 跟踪表。请包含：指标、目标值(数字)、本期实际(数字)、达成率(公式 = 实际/目标，按百分比写)、同比%(数字)、环比%(数字)、负责人、状态(公式 IF(达成率>=1,\"达成\",\"待提升\"))、备注。至少 5 个指标。\n\n场景细节：",
      custom: "请按下面的描述生成一张合理的、带 Excel 公式的 Markdown 表格：\n\n",
    };
    const stBrief = root.querySelector("#dgStBrief");
    const stStat = root.querySelector("#dgStStat");
    let stCurrentScenario = "custom";

    // chip 行为：
    //   - 首次点击或当前内容是某个 starter（含未改） → 直接替换为新 starter
    //   - 用户在 brief 里自由打过字（标记 .dataset.edited="1"）→ 弹确认再决定要不要替换
    if (stBrief) {
      stBrief.addEventListener("input", () => {
        // 只要用户敲过键就标记为"已编辑"，下次 chip 切换会弹确认
        stBrief.dataset.edited = "1";
      });
    }
    root.querySelectorAll(".dg-st-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.getAttribute("data-st-scenario") || "custom";
        stCurrentScenario = k;
        root.querySelectorAll(".dg-st-chip").forEach((b) => b.classList.toggle("is-active", b === btn));
        if (!stBrief) return;
        const cur = stBrief.value.trim();
        const isStarter = !cur || Object.values(ST_STARTERS).some((s) => cur === s.trim() || cur.startsWith(s.split("\n")[0]));
        if (isStarter || stBrief.dataset.edited !== "1") {
          stBrief.value = ST_STARTERS[k] || ST_STARTERS.custom;
          stBrief.dataset.edited = "";
        } else if (confirm("已在文本框里写了内容，要用「" + (btn.textContent || "").trim() + "」的默认模板替换吗？\n确定 = 替换；取消 = 保留当前内容")) {
          stBrief.value = ST_STARTERS[k] || ST_STARTERS.custom;
          stBrief.dataset.edited = "";
        }
        stBrief.focus();
        stBrief.setSelectionRange(stBrief.value.length, stBrief.value.length);
      });
    });

    function buildSmartTablePrompt(scenarioKey, userBrief) {
      const starter = ST_STARTERS[scenarioKey] || ST_STARTERS.custom;
      const brief = (userBrief || "").trim();
      return `你是 Excel/Google Sheets 表格设计专家。请按需求设计一张可直接落地使用的 Markdown 表格，并严格满足以下要求：

【硬性要求】
- 列名清晰、必要时标单位；列顺序符合阅读/录入习惯
- 数据规范：金额用纯数字（不带 ¥/千分位），日期用 YYYY-MM-DD，百分比可用 85% 或 0.85 但全列保持一致
- 公式以 = 开头，列号严格对应表格列位（第 1 列=A、第 2 列=B…），行号从 2 开始
- 公式优先选 SUM / SUMIF / IF / IFS / IFERROR / COUNTIF / AVERAGE / ROUND / VLOOKUP；公式必须括号平衡、可在 Excel 中直接计算
- 至少 5 行示例数据；若有「合计/小计」请使用 SUM 公式而不是手算

【输出格式 · 严格遵守】（不要任何客套）
## 表格
（标准 Markdown 表格，含表头与对齐线）

## 公式说明
- 单元格地址 (列名): =公式 — 一句话用途
- …（逐条解释表中所有 = 开头的公式）

## 使用建议
- 2-4 条录入/维护建议

【需求】
${starter}${brief}`;
    }

    root.querySelector("#dgStGen")?.addEventListener("click", async () => {
      let brief = (stBrief?.value || "").trim();
      // 若 brief 为空，自动用当前场景 starter 作为默认指令（用户什么都没写也能生成示例表）
      if (!brief) {
        brief = (ST_STARTERS[stCurrentScenario] || ST_STARTERS.custom) +
          "（用户未给出场景细节，请按行业最佳实践生成可直接使用的样例数据）";
        if (stBrief) stBrief.value = brief;
        ctx.toast("没填描述，已按当前场景生成示例表格");
      }
      root.querySelector("#dgBusy").style.display = "block";
      setGenerateButtonBusy(true);
      try {
        const inst = buildSmartTablePrompt(stCurrentScenario, brief);
        const res = await ctx.runDocumentGenerate({
          instruction: inst,
          sourceContent: "",
          sourceFileName: "smart-table",
          model: ctx.getModel(),
          genType: "智能表格",
          genTypeKey: typeSel.value || "",
          tone: toneSel.value || "",
          genControls: collectGenControls(),
        });
        const md = String(res.content || "");
        const out = root.querySelector("#dgOut");
        out.value = md;
        syncPreview();
        refreshQc();
        root.querySelectorAll("[data-dg-tab]").forEach((b) =>
          b.classList.toggle("is-active", b.getAttribute("data-dg-tab") === "output"));
        root.querySelectorAll("[data-dg-panel]").forEach((pan) =>
          pan.classList.toggle("is-active", pan.getAttribute("data-dg-panel") === "output"));
        const stats = checkFormulas(md);
        if (stats.total > 0) {
          ctx.toast(`已生成 ${stats.total} 个公式${stats.bad ? `（⚠ ${stats.bad} 需检查）` : "（语法 OK）"}；导出 XLSX 可直接计算`);
          if (stStat) stStat.textContent = `${stats.total} 公式 · ${stats.bad ? `⚠ ${stats.bad} 需检查` : "OK"}`;
        } else {
          ctx.toast("已生成表格");
          if (stStat) stStat.textContent = `无公式`;
        }
      } catch (e) {
        ctx.toast(e?.message || "生成失败", true);
      } finally {
        root.querySelector("#dgBusy").style.display = "none";
        setGenerateButtonBusy(false);
      }
    });

    function extractFirstMarkdownTable(md) {
      const lines = String(md || "").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*\|.+\|\s*$/.test(lines[i]) && i + 1 < lines.length && /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1])) {
          const start = i;
          let end = i + 2;
          while (end < lines.length && /^\s*\|.+\|\s*$/.test(lines[end])) end++;
          return { start, end: end - 1, text: lines.slice(start, end).join("\n") };
        }
      }
      return null;
    }

    root.querySelector("#dgStAnalyze")?.addEventListener("click", async () => {
      const md = root.querySelector("#dgOut").value || "";
      const tbl = extractFirstMarkdownTable(md);
      if (!tbl) { ctx.toast("当前输出里没有 Markdown 表格可供分析", true); return; }
      const focus = (stBrief?.value || "").trim();
      root.querySelector("#dgBusy").style.display = "block";
      try {
        const inst = `你是 Excel 表格优化顾问。下面给你一张 Markdown 表格，请输出优化版本：

## 优化版本
（完整 Markdown 表格：必要时新增/重排/重命名列；金额=数字、日期=YYYY-MM-DD；为合计/比率/状态等新增 = 开头的 Excel 公式，公式严格匹配列位与行号）

## 改动清单
- [新增/删除/重命名/改公式] 列名/单元格：理由
- …

## 公式说明
- 单元格地址 (列名): =公式 — 一句话用途
- …

【用户重点关注】${focus || "（用户未额外说明，请按通用最佳实践优化）"}

【原表】
${tbl.text}`;
        const res = await ctx.runPolish({ instruction: inst, sourceContent: tbl.text, model: ctx.getModel() });
        const optimized = String(res.content || "");
        if (!optimized.trim()) { ctx.toast("AI 没有返回优化结果", true); return; }
        const out = root.querySelector("#dgOut");
        out.value = `${md}\n\n---\n\n# 🆕 优化版本（AI 建议）\n\n${optimized}`;
        syncPreview();
        const stats = checkFormulas(optimized);
        ctx.toast(`已追加优化版本：${stats.total} 公式${stats.bad ? `（⚠ ${stats.bad} 需检查）` : "（OK）"}`);
        if (stStat) stStat.textContent = `优化已追加 · ${stats.total} 公式`;
        out.scrollTop = out.scrollHeight;
        // 自动切到输出
        root.querySelectorAll("[data-dg-tab]").forEach((b) =>
          b.classList.toggle("is-active", b.getAttribute("data-dg-tab") === "output"));
        root.querySelectorAll("[data-dg-panel]").forEach((pan) =>
          pan.classList.toggle("is-active", pan.getAttribute("data-dg-panel") === "output"));
      } catch (e) {
        ctx.toast(e?.message || "分析失败", true);
      } finally {
        root.querySelector("#dgBusy").style.display = "none";
      }
    });

    function checkFormulas(md) {
      const lines = String(md || "").split(/\r?\n/);
      const stats = { total: 0, bad: 0, details: [] };
      for (let li = 0; li < lines.length; li++) {
        const ln = lines[li];
        if (!/^\s*\|.+\|\s*$/.test(ln)) continue;
        if (/^\s*\|[\s|:-]+\|\s*$/.test(ln)) continue;
        const cells = ln.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.trim());
        for (let ci = 0; ci < cells.length; ci++) {
          const raw = cells[ci].replace(/^`+|`+$/g, "").replace(/^\*+|\*+$/g, "").trim();
          if (!raw.startsWith("=") || raw.length < 2) continue;
          stats.total += 1;
          const body = raw.slice(1);
          let depth = 0;
          let ok = body.length > 0;
          for (const ch of body) {
            if (ch === "(") depth++;
            else if (ch === ")") depth--;
            if (depth < 0) { ok = false; break; }
          }
          if (depth !== 0) ok = false;
          if (!ok) {
            stats.bad += 1;
            stats.details.push(`行 ${li + 1} 列 ${ci + 1}: ${raw}`);
          }
        }
      }
      return stats;
    }

    root.querySelector("#dgStCheck")?.addEventListener("click", () => {
      const md = root.querySelector("#dgOut").value || "";
      const stats = checkFormulas(md);
      if (stats.total === 0) {
        ctx.toast("当前没有 Excel 公式（= 开头）", true);
        if (stStat) stStat.textContent = "无公式";
        return;
      }
      if (stats.bad === 0) {
        ctx.toast(`公式自检：${stats.total} 个公式语法 OK`);
        if (stStat) stStat.textContent = `${stats.total} 公式 · OK`;
      } else {
        const list = stats.details.slice(0, 5).join("\n");
        ctx.toast(`⚠ ${stats.bad} / ${stats.total} 个公式有问题（括号不匹配）`, true);
        alert(`公式自检发现问题：\n\n${list}${stats.details.length > 5 ? "\n…" : ""}`);
        if (stStat) stStat.textContent = `${stats.total} 公式 · ⚠ ${stats.bad}`;
      }
    });

    // —— 26. 包装并行变体 ——
    const variantWrappedRun = runGenerateWrapped;
    async function runWithVariants() {
      const n = Number(variantNSel?.value || 1);
      if (n <= 1) {
        await variantWrappedRun();
        return;
      }
      // 并行 N 次：通过指令尾缀让模型从不同角度落笔（务实 / 概念 / 默认），并非真改 temperature
      root.querySelector("#dgErr").innerHTML = "";
      setGenerateButtonBusy(true);
      root.querySelector("#dgBusy").style.display = "block";
      try {
        const { name, content } = await buildSource();
        const baseInst = root.querySelector("#dgReq").value.trim();
        const labelMap = ["A", "B", "C"];
        const tonePromptMap = ["", "（请采用更具体落地的写法）", "（请采用更概念化、洞察导向的写法）"];
        const promises = [];
        for (let i = 0; i < n; i++) {
          const inst = `${baseInst}\n${tonePromptMap[i] || ""}\n\n（输出语言：${ctx.settings().defaultLang || "zh-CN"}；语气：${toneSel.value}）`;
          promises.push(
            ctx.runDocumentGenerate({
              instruction: inst,
              sourceContent: content,
              sourceFileName: name,
              model: ctx.getModel(),
              genType: genTypeLabel(),
              genTypeKey: typeSel.value,
              tone: toneSel.value,
              genControls: collectGenControls(),
            }).then((r) => ({ ok: true, content: r.content || "" })).catch((e) => ({ ok: false, error: e?.message || String(e) }))
          );
        }
        const settled = await Promise.all(promises);
        variants = settled.map((r, i) => ({ label: labelMap[i] || `#${i + 1}`, content: r.ok ? r.content : `（失败：${r.error}）` }));
        variantActiveIdx = 0;
        root.querySelector("#dgOut").value = variants[0].content || "";
        syncPreview();
        refreshQc();
        renderVariantTabs();
        const okN = settled.filter((s) => s.ok).length;
        ctx.toast(`并行生成完成：成功 ${okN}/${n}（双击 tab 采用为最终稿）`);
        await pushRecent("[并行]" + baseInst.slice(0, 50));
        // 自动切到 output
        root.querySelectorAll("[data-dg-tab]").forEach((b) =>
          b.classList.toggle("is-active", b.getAttribute("data-dg-tab") === "output"));
        root.querySelectorAll("[data-dg-panel]").forEach((pan) =>
          pan.classList.toggle("is-active", pan.getAttribute("data-dg-panel") === "output"));
      } finally {
        setGenerateButtonBusy(false);
        root.querySelector("#dgBusy").style.display = "none";
      }
    }
    // 重新替换按钮事件，让 N>1 时走 variants
    {
      const dgGenBtnX = root.querySelector("#dgGen");
      const dgGenTopBtnX = root.querySelector("#dgGenTop");
      if (dgGenBtnX) {
        const fresh = dgGenBtnX.cloneNode(true);
        dgGenBtnX.parentNode?.replaceChild(fresh, dgGenBtnX);
        fresh.addEventListener("click", runWithVariants);
      }
      if (dgGenTopBtnX) {
        const fresh = dgGenTopBtnX.cloneNode(true);
        dgGenTopBtnX.parentNode?.replaceChild(fresh, dgGenTopBtnX);
        fresh.addEventListener("click", runWithVariants);
      }
    }

    // —— 27. 给导出/Bundle 注入封面 + 品牌包 YAML ——
    // 策略：给关键导出按钮加「捕获阶段」拦截，临时修改 dgOut 让原 handler 看到带封面/品牌的版本，导出后恢复
    function attachCoverBrandCapture(sel) {
      const btn = root.querySelector(sel);
      if (!btn) return;
      btn.addEventListener("click", async (ev) => {
        if (btn.__dgCBProcessed) { btn.__dgCBProcessed = false; return; }
        ev.stopImmediatePropagation();
        ev.preventDefault();
        const ta2 = root.querySelector("#dgOut");
        const original = ta2.value;
        try {
          const cover = await buildCoverBlockAsync();
          const bp = (await idb.storeGet("dgBrandPack")) || {};
          const yaml = (bp.company || bp.color || bp.footer)
            ? `---\nbrand-company: ${JSON.stringify(bp.company || "")}\nbrand-color: ${JSON.stringify(bp.color || "")}\nbrand-footer: ${JSON.stringify(bp.footer || "")}\n---\n\n`
            : "";
          if (cover || yaml) ta2.value = yaml + cover + original;
          btn.__dgCBProcessed = true;
          btn.click();
        } finally {
          // 延后恢复，确保导出闭包先读完
          setTimeout(() => { ta2.value = original; syncPreview(); }, 50);
        }
      }, true /* capture */);
    }
    attachCoverBrandCapture("#dgDown");
    attachCoverBrandCapture("#dgDownTop");
    attachCoverBrandCapture("#dgBundle");

    // —— 28. 初始化加载列表 + 绑定字段刷新 budget ——
    await Promise.all([refreshPresets(""), refreshRecent()]);
    updateBudget();

    // 字段改动 → budget 重算
    [typeSel, toneSel].forEach((el2) => el2?.addEventListener("change", updateBudget));

    return () => cleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  }
  /* eslint-enable no-inner-declarations */

  const onStore = () => renderRefs();
  window.addEventListener(idb.STORE_CHANGED_EVENT, onStore);
  renderRefs().then(() => {
    const np = ctx.navPayload;
    if (np?.smartPack) {
      applySmartPack(np.smartPack, { silent: true });
    }
    if (np?.genType) {
      typeSel.value = np.genType;
      const opt = typeSel.options[typeSel.selectedIndex];
      if (opt?.dataset?.instruction) root.querySelector("#dgReq").value = opt.dataset.instruction;
    }
    if (np?.quickPrompt) {
      const cur = root.querySelector("#dgReq").value.trim();
      root.querySelector("#dgReq").value = `${String(np.quickPrompt).trim()}${cur ? `\n\n【基础模板】\n${cur}` : ""}`;
    }
    if (np?.rerunContent) {
      root.querySelector("#dgOut").value = String(np.rerunContent);
    }
    requestAnimationFrame(() => {
      syncPreview();
      refreshQc();
    });
  });

  return {
    destroy() {
      clearTimeout(debTimer);
      clearTimeout(qcTimer);
      window.removeEventListener(idb.STORE_CHANGED_EVENT, onStore);
      try {
        document.removeEventListener("mousedown", hideFloatOnDocMouse);
      } catch {
        /* ignore */
      }
      try {
        floatBar?.remove();
      } catch {
        /* ignore */
      }
      try {
        cleanupAddons();
      } catch {
        /* ignore */
      }
      root.innerHTML = "";
    },
  };
}
