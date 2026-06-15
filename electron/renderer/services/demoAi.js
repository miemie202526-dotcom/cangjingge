/**
 * 无 API Key 或 API 失败时的本地 Demo：长文、结构化、可交付形态（非一两句模板）。
 */

function clip(s, n) {
  const t = String(s || "").trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n)}…`;
}

/**
 * 商业计划书 Demo：咨询级章节骨架 + 与用户指令/摘录融合，保证篇幅。
 * @param {string} excerpt
 */
function demoBusinessPlanFullBody(genType, tone, instruction, excerpt, names, g) {
  /* 用途/受众/篇幅/引用开关已在界面选择，不在正文开头重复 */
  const industry = g.industry ? `**行业语境**：${g.industry}\n\n` : "";
  const ins = clip(instruction, 2500) || "（按类型默认指令生成）";
  const ev = excerpt
    ? `> **资料摘录（节选）**\n>\n> ${excerpt.slice(0, 3200)}${excerpt.length > 3200 ? "…" : ""}\n\n`
    : "> （未勾选资料：以下财务与市场数为**演示占位**，接入 API 后请替换为真实模型与数据源。）\n\n";

  return `# ${genType || "商业计划书"}（离线预览稿 · 咨询级结构）\n\n${industry}**语气**：${tone || "专业、可路演"}\n\n## 执行摘要\n\n### 一句话定位\n以 AI 能力切入选定区域市场（如迈阿密及拉美走廊），在医疗、金融、零售等垂直场景提供**可落地的软件+服务**组合，在 36 个月内形成可防御的交付壁垒与经常性收入。\n\n### 关键结论（Demo）\n- **市场**：结构性需求来自降本、合规与实时决策；需用第三方数据替换下表占位。\n- **产品**：MVP → 行业套件 → 平台化 API 的三段路径，避免一次性定制陷阱。\n- **商业**：订阅 + 实施 + 成功费（按成果）混合，改善现金流与 LTV。\n- **融资**：本轮资金主要用于研发、标杆客户与合规体系；附里程碑对赌建议（法律文本须单签）。\n\n### 核心指标占位（须替换）\n\n| 指标 | Y1 | Y2 | Y3 | 备注 |\n| --- | ---: | ---: | ---: | --- |\n| 收入（万美元） | 120 | 360 | 900 | 复合增长示例 |\n| 毛利率 | 62% | 65% | 68% | 随规模与自动化上升 |\n| 销售与管理费用率 | 55% | 42% | 33% |  |\n| 期末现金（万美元） | -80 | -40 | 120 | 融资后改善 |\n\n---\n\n## 背景与问题陈述\n\n### 宏观与区域机会\n迈阿密作为创新与贸易枢纽，对多语言、跨境合规、供应链可视化与实时风控存在持续投入；AI 可在**文档理解、流程自动化、预测与异常检测**上显著降低边际成本。\n\n### 客户痛点（归纳）\n1. **数据孤岛**：系统多、口径不一，难以形成统一决策视图。\n2. **人力密集环节**：审核、客服、报价、对账占用高技能人力。\n3. **合规与审计压力**：需要可追溯、可解释的模型输出与流程日志。\n\n### 与本项目的关联\n${ev}\n\n## 公司与愿景\n\n### 使命与愿景\n使命：用可验证的 AI 交付，让客户的关键流程**更快、更准、更合规**。愿景：成为区域市场首选的垂直行业 AI 方案商。\n\n### 里程碑愿景图（文字版）\n- 0–12 月：2 个行业标杆 + 可复用组件库。\n- 12–24 月：行业套件标准化 + 渠道体系。\n- 24–36 月：平台化与生态伙伴分成。\n\n## 市场分析\n\n### TAM / SAM / SOM（占位，须替换）\n\n| 层级 | 定义 | 金额（亿美元，示例） | 依据说明 |\n| --- | --- | ---: | --- |\n| TAM | 全球可服务市场 | 420 | 示例 |\n| SAM | 区域可切入市场 | 38 | 示例 |\n| SOM | 3 年可获份额 | 1.2 | 需自下而上校验 |\n\n### 细分与客户画像\n- **细分 A**：年 IT 预算 50–200 万美元、流程标准化程度中等的成长型企业。\n- **细分 B**：强合规行业（金融、医疗）中的**中台与运营**部门。\n\n### 竞争与进入策略\n采用「标杆案例 → 方法论沉淀 → 渠道复制」；对巨头竞争强调**响应速度、本地化、行业语料与交付 SLA**。\n\n## 产品与技术方案\n\n### 产品层级\n1. **基础能力层**：OCR/文档解析、RAG 知识库、工作流编排、监控告警。\n2. **行业应用层**：按场景打包的 UI 与规则引擎。\n3. **服务层**：实施、调优、驻场与培训。\n\n### 技术路线（简表）\n\n| 模块 | 当前 | 6 个月 | 12 个月 |\n| --- | --- | --- | --- |\n| 模型与评测 | 基线 | 行业微调 | 持续评测+红队 |\n| 数据与隐私 | 最小化采集 | 分级脱敏 | 区域部署选项 |\n| 集成 | API 优先 | 主流 ERP/CRM 连接器 | 客户定制适配层 |\n\n## 商业模式与定价\n\n### 收入结构\n订阅（ARR）+ 一次性实施 + 按结果计费（在合同允许范围内）。\n\n### 定价逻辑（示例）\n- 席位/租户阶梯定价；\n- 实施按人天；\n- 高价值场景采用**成功费+封顶**组合以分摊风险。\n\n## 营销与销售\n\n### 获客漏斗\n内容营销 → 行业研讨会 → POC → 框架协议 → 扩展销售。\n\n### 渠道与伙伴\n与云厂商、系统集成商、行业协会建立**联合方案**与线索分成。\n\n## 运营计划与里程碑\n\n| 季度 | 交付 | 组织 | 风险 |\n| --- | --- | --- | --- |\n| Q1 | MVP + 1 标杆 | 核心研发团队 | 需求蔓延 |\n| Q2 | 第二行业 POC | 售前与交付扩容 | 交付质量 |\n| Q3 | 套件 1.0 | 客户成功团队 | 续约率 |\n| Q4 | 渠道签约 ≥3 | 区域销售 | 回款周期 |\n\n## 管理团队与治理\n\n### 关键岗位（示例）\nCEO/产品、CTO/架构、行业 VP、财务与法务；建议设立**数据伦理与模型评审**小组。\n\n### 股权与激励（占位）\n期权池、创始人 vesting、关键员工 retention 计划——须由律师定稿。\n\n## 财务预测与假设\n\n### 关键假设\n客单价、续约率、获客成本、人天成本、云与算力成本占比；须做**三情景**（保守/基准/乐观）。\n\n### 利润表摘要（占位）\n\n| 科目 | Y1 | Y2 | Y3 |\n| --- | ---: | ---: | ---: |\n| 收入 | 120 | 360 | 900 |\n| 毛利 | 74 | 234 | 612 |\n| 研发费用 | 60 | 90 | 120 |\n| 销售费用 | 40 | 80 | 140 |\n| 管理费用 | 25 | 35 | 55 |\n| 营业利润 | -51 | 29 | 297 |\n\n## 融资需求与资金用途\n\n### 本轮融资（示例）\n规模、估值区间、交割条件、资金用途（研发 40%、销售 30%、运营与合规 20%、预备金 10%）——须替换为真实数字。\n\n## 风险与合规\n\n| 风险 | 等级 | 缓释措施 |\n| --- | --- | --- |\n| 模型幻觉与责任 | 高 | 人机协同、日志、保险与合同条款 |\n| 数据跨境 | 高 | 架构分区、法律评估 |\n| 竞争降价 | 中 | 价值锚定与捆绑服务 |\n| 关键人依赖 | 中 | 文档化与梯队建设 |\n\n## 附录\n\n### 用户写作要求（原文摘要）\n\n${ins}\n\n### TSV（三年收入/毛利/净利，制表符分隔，便于 Excel）\n\n\`\`\`\n年度\t收入\t毛利\t净利\nY1\t120\t74\t-51\nY2\t360\t234\t29\nY3\t900\t612\t297\n\`\`\`\n\n---\n\n> **Demo 说明**：本稿为内置长文模板 + 资料摘录融合，用于无 API Key 时的完整体验；配置 Key 后请用同一「商业计划书」类型重新生成以获得真实推理与数据。\n`;
}

function roughKeywords(doc) {
  const t = String(doc || "").slice(0, 8000);
  const kws = [
    "收入",
    "成本",
    "利润",
    "合同",
    "甲方",
    "乙方",
    "项目",
    "风险",
    "市场",
    "客户",
    "产品",
    "融资",
    "审计",
    "条款",
    "数据",
    "增长",
    "目标",
    "交付",
    "预算",
    "采购",
  ];
  const hits = [];
  for (const k of kws) if (t.includes(k)) hits.push(k);
  return hits.length ? hits.slice(0, 10).join("、") : "综合业务与运营";
}

function demoAnalysisTableAppendix(mode) {
  const m = mode || "";
  if (!["data", "team_ops", "metrics_schema", "table_data", "finance"].includes(m)) return "";
  return `\n\n### 附录：指标与表格草稿（Demo）\n\n| 维度 | 指标 | 口径 | 频率 |\n| --- | --- | --- | --- |\n| 交付 | 按期完成率 | 按期关闭/计划 | 周 |\n| 质量 | 缺陷密度 | 缺陷数/交付规模 | 迭代 |\n| 资源 | 负荷率 | 登记工时/标准工时 | 周 |\n\n> 可将上表复制到 Excel 进一步建模。\n`;
}

function buildDemoReport({ documentText, mode, userInstruction, fileNames, depth }) {
  const doc = String(documentText || "");
  const snippet = doc.replace(/\s+/g, " ").trim().slice(0, 3200);
  const names = (fileNames && fileNames.length ? fileNames.join("、") : "（所选资料）") || "（所选资料）";
  const q = String(userInstruction || "").trim() || "（未填写额外问题）";
  const modeLabel = mode || "business";
  const depthLabel = depth || "standard";
  const kw = roughKeywords(doc);

  const execSum = `基于「${names}」共 ${doc.length} 字的材料与提问「${clip(q, 200)}」，在「${modeLabel}」分析视角、**${depthLabel}** 深度档位下生成本地 Demo 报告。材料中可抽取的主题线索包括：${kw}。说明：本稿通过章节化与表格模拟咨询公司交付结构；接入 OpenAI 后可替换为事实核验型推理。`;

  let bodyMain = `## 执行摘要\n\n${execSum}\n\n## 证据与原文脉络\n\n`;
  if (snippet) {
    bodyMain += `以下为支撑后文判断的原文压缩摘录（保留顺序，便于核对）：\n\n> ${snippet.slice(0, 2400)}${snippet.length > 2400 ? "…" : ""}\n\n`;
  } else {
    bodyMain +=
      "（当前未检测到正文：请在文件库勾选资料，或在「自定义问题」中写清业务背景、约束与期望输出，以便 Demo 引擎生成更贴近语境的长文。）\n\n";
  }

  bodyMain += `## 结构化诊断\n\n1. **叙事主线**：从材料梳理「目标—资源—风险—结果」链条，标出隐含假设与未写明的依赖。\n2. **数据与口径**：检查同一指标在全文是否命名一致；若出现矛盾，列出待澄清清单交由业务owner确认。\n3. **组织与执行**：把涉及的角色、交付物、时间节点映射为可跟踪事项，避免口头约定漂移。\n\n## 机会点\n\n- 以周节奏滚动复盘关键 KPI，缩短决策回路。\n- 沉淀模板库与评审清单，降低跨团队摩擦成本。\n- 对高影响低概率风险建立情景演练与触发器。\n- 将客户/供应商侧约束写入单一「约束寄存器」避免遗漏。\n\n## 风险与合规边界\n\nDemo 模式不构成法律、财务或投资建议；外发前须由对应职能复核。未联网校验行业基准时，避免绝对化结论。\n\n## 90 日执行路线（示例）\n\n| 阶段 | 时间 | 里程碑 | 建议责任 |\n| --- | --- | --- | --- |\n| 对齐 | 第1–2周 | 冻结问题陈述与成功标准 | 业务负责人 |\n| 深挖 | 第3–6周 | 补齐数据缺口与访谈纪要 | PMO / 分析 |\n| 产出 | 第7–10周 | 管理层汇报材料与决策包 | 项目经理 |\n| 闭环 | 第11–13周 | 行动项跟踪与复盘 | 运营与财务 |\n`;

  while (bodyMain.length < 2600) {
    bodyMain += `\n\n## 延伸推演（Demo 增补）\n\n围绕「${kw}」继续展开：把关键假设写成可证伪命题，在周会回收证据强度与反例；对跨部门依赖绘制一页输入/输出 SLA，减少灰色地带。\n`;
  }

  const mainReport =
    `# ${modeLabel} · 专业报告（Demo 本地引擎）\n\n` +
    `> 深度：**${depthLabel}** · 引用：**${names}**\n\n` +
    bodyMain +
    demoAnalysisTableAppendix(mode) +
    `\n## 结论与下一步\n\n建议配置 API Key 后使用相同模式与深度重新生成，以获得针对原文的事实核验与行业对标；在此之前可将本稿作为内部研讨的结构化草案。\n`;

  const coreConclusions = [
    `主题线索「${kw}」应与管理层关注清单逐条映射，避免议题漂移。`,
    "在缺乏外部数据时，先用内部一致性与可执行性筛选高价值议题。",
    "定量结论须写清口径与来源，主文保持决策密度、细节进附录。",
    "对关键假设安排反方压力测试后再分配资源。",
  ];
  const opportunities = [
    "建立周度经营例会机制，压缩从信号到行动的延迟。",
    "把高频文档改为可配置模板，减少重复劳动与格式风险。",
    "为战略议题绑定单一 Owner 与度量，减少多头解释。",
    "将分散在表格中的约束合并为台账，支持审计追踪。",
  ];
  const risks = [
    "材料可能不完整或滞后，存在选择性偏差。",
    "未联网校验外部事实，勿直接用于对外承诺。",
    "法律/税务敏感表述须经专业人士复核。",
    "Demo 文本不能替代签字版合同或投资备忘录。",
  ];
  const issueList = [
    "若缺少财务三张表，投融资类结论仅作讨论稿。",
    "跨文档指标命名不一致时需先统一数据词典。",
    "关键责任人与截止时间未写清时应安排二次确认。",
    "对表格合计与明细不一致处应列为 P0 核对项。",
  ];
  const recommendations = [
    "先产出 1 页「问题陈述 + 决策点 + 所需数据」供管理层对齐。",
    "为每条建议绑定度量、负责人与复盘日期。",
    "高影响事项迁入项目管理看板并周更状态。",
    "非核心段落移入附录，主文只保留可决策信息。",
  ];
  const actionPlan = [
    "T+3 日：主办人收齐材料版本与变更记录。",
    "T+1 周：跨职能工作坊冻结问题边界与口径。",
    "T+2 周：完成差距分析与备选方案集。",
    "T+4 周：管理层决策会 + 行动项闭环表。",
  ];
  const priorities = ["P0：口径与数据完整性", "P1：关键假设验证", "P2：对外话术与风险披露", "P3：版式与附录整理"];
  const nextSteps = [
    "在设置中配置 API Key 后重跑本分析。",
    "导出 DOCX/PDF 提交法务/财务预审。",
    "将结论同步到「文件生成」页输出正式公文或方案。",
    "安排下周复盘执行偏差与新增风险。",
  ];
  const talkingPoints = `今天我们基于「${names}」对「${clip(q, 100)}」做了结构化解读。短期建议先锁定口径与责任边界，再讨论增长与效率的权衡；完整事实核验请在接入云端模型后进行。`;
  const dataInsights = `从当前窗口可见：摘录覆盖约 ${Math.min(100, Math.round((Math.min(snippet.length, doc.length) / Math.max(doc.length, 1)) * 100))}% 的正文用于推演；关键词聚类指向「${kw}」。建议在真实模型下对时间序列与因果链补充计量或访谈证据。`;
  const executiveSummary = execSum;

  const four = (prefix) => [1, 2, 3, 4].map((i) => `${prefix}（Demo ${i}）：结合「${kw}」与材料长度 ${doc.length} 字做的占位结论，接入 API 后替换。`);
  const decisionToolkit = {
    fileHealthSummary: `本地体检：${doc.length ? `已载入约 ${doc.length} 字；关键词线索「${kw}」。` : "未检测到正文，无法做完整性评估。"} Demo 不含真实解析状态。`,
    missingInfo: four("待补充材料"),
    dataQualityNotes: "Demo 未校验表内合计、币种与日期格式；外发前请财务/业务二次核对。",
    inferredDocTypes: ["综合业务材料", "内部讨论稿", "可能含表格摘录", "未分类"],
    recommendedModes: ["business", "risk", "finance"],
    extractedSignals: four("关键信号"),
    swotStrengths: four("优势"),
    swotWeaknesses: four("劣势"),
    swotOpportunities: four("机会"),
    swotThreats: four("威胁"),
    pestPolitical: four("政策与监管"),
    pestEconomic: four("经济"),
    pestSocial: four("社会"),
    pestTechnological: four("技术"),
    riskMatrixLines: four("合规风险 | 中 | 中 | 中 | 建立复核"),
    actionOwnersLines: four("对齐口径 | 业务负责人 | P0 | 1 周内 | 工作坊"),
    mgmtBrief: `一页管理层摘要（Demo）：先结论——围绕「${clip(q, 80)}」需优先锁定数据口径与责任边界；再行动——两周内完成差距清单与资源申请。`,
    investorBrief: "投资人视角（Demo）：关注可验证的增长驱动与下行风险；本稿数字为占位，勿用于路演终稿。",
    legalRiskBrief: "法务视角（Demo）：关注责任上限、知识产权归属、争议解决地；须由律师审阅原件条款。",
    financeBrief: "财务视角（Demo）：关注收入确认、现金流与关键假设敏感性；需替换为审计口径数据。",
    scriptBoss: `老板您好：基于「${names}」材料，我们建议本周先冻结问题边界，下周给出带数据的决策包；当前为 Demo 预览。`,
    scriptClient: "客户沟通话术（Demo）：我们已完成首轮结构化解读，下一步需要您确认两处关键假设后给出执行方案。",
    scriptInvestor: "投资人沟通话术（Demo）：我们正在验证单位经济与下行情景，完整材料在尽调数据室更新中。",
  };

  return {
    executiveSummary,
    coreConclusions,
    dataInsights,
    opportunities,
    risks,
    issueList,
    recommendations,
    actionPlan,
    priorities,
    nextSteps,
    talkingPoints,
    mainReport,
    summary: `已对「${names}」完成 ${modeLabel} / ${depthLabel} 的本地 Demo 结构化解读；主报告约 ${mainReport.length} 字。`,
    keyPoints: coreConclusions,
    actions: actionPlan,
    suggestedExports: ["md", "docx", "pdf", "txt"],
    citedFiles: names,
    decisionToolkit,
    demo: true,
  };
}

/**
 * @param {string} genTypeKey documentGenTypeOptions value
 */
function demoTableBlocks(genTypeKey) {
  const k = genTypeKey || "";
  const blocks = {
    team_stats: `### 预设：团队周/月统计（Markdown）\n\n| 成员 | 角色 | 本周工时(h) | 完成任务 | 缺陷/工单 | 负荷率 | 备注 |\n| --- | --- | --- | --- | --- | --- | --- |\n| 张三 | 后端 | 38 | 6 | 1 | 95% | — |\n| 李四 | 前端 | 40 | 5 | 0 | 100% | 需求评审占用 4h |\n\n**TSV**\n\n\`\`\`\n成员\t角色\t本周工时(h)\t完成任务\n张三\t后端\t38\t6\n\`\`\`\n`,
    project_tracker: `### 预设：项目进度跟踪（Markdown）\n\n| 项目 | 阶段 | 完成度% | 负责人 | 风险 | 下一里程碑 | 截止日期 |\n| --- | --- | --- | --- | --- | --- | --- |\n| 数据中台 | 开发 | 72 | 王五 | 接口延期 | UAT | 2026-05-15 |\n\n`,
    okr_sheet: `### 预设：OKR 进展（Markdown）\n\n| O | KR | 权重% | 负责人 | 进度% | 证据 | 下月计划 |\n| --- | --- | --- | --- | --- | --- | --- |\n| 提效 | 周期≤10天 | 40 | 李雷 | 60 | 看板上线 | 推广二组 |\n\n`,
    budget_sheet: `### 预设：预算执行（Markdown）\n\n| 科目 | 预算(万) | 已用(万) | 剩余(万) | 备注 |\n| --- | --- | --- | --- | --- |\n| 云资源 | 120 | 78 | 42 | 压测预留 |\n\n`,
    client_pipeline: `### 预设：商机管道（Markdown）\n\n| 客户 | 阶段 | 预计金额(万) | 预计成交日 | 下一步 | 负责人 |\n| --- | --- | --- | --- | --- | --- |\n| A科技 | 方案 | 80 | 2026-06-01 | POC | 销售甲 |\n\n`,
    survey_summary: `### 预设：调研汇总（Markdown）\n\n| 题目 | 类型 | 样本量 | 主要比例 |\n| --- | --- | --- | --- |\n| 满意度 | 1-5分 | 240 | 4-5分占78% |\n\n`,
    sprint_velocity: `### 预设：迭代速率（Markdown）\n\n| 迭代 | 计划SP | 完成SP | 未完成 |\n| --- | --- | --- | --- |\n| Sprint24 | 34 | 31 | 2项滑入下期 |\n\n`,
  };
  return blocks[k] || "";
}

function longDemoDocSections(genType, genTypeKey, tone, instruction, src, names, genControls) {
  const g = genControls && typeof genControls === "object" ? genControls : {};
  const excerpt = src.replace(/\s+/g, " ").trim().slice(0, 4500);

  if (genTypeKey === "bp") {
    let core = demoBusinessPlanFullBody(genType, tone, instruction, excerpt, names, g);
    while (core.length < 9800) {
      core += `\n\n## 续章（Demo 自动增厚）\n\n### 增长飞轮补充\n围绕获客、激活、留存、变现、推荐五环，各写两段：给出**可度量**的北极星指标与季度复盘节奏；说明与迈阿密/拉美走廊相关的渠道实验假设（须用真实调研替换）。\n\n### 资本效率\n解释 CAC payback、Magic Number、Rule of 40 在本模型下的**目标区间**与达成路径（占位数字须替换）。\n`;
    }
    return core;
  }

  const industry = g.industry ? `**行业**：${g.industry}\n\n` : "";

  let core = `# ${genType || "商务文档"}（Demo 本地文档工厂）\n\n${industry}`;
  core += `**语气**：${tone || "专业"}\n\n## 写作要求（用户）\n\n${clip(instruction, 2000) || "（未填写）"}\n\n## 引用资料\n\n${names}\n\n`;
  if (excerpt) {
    core += `## 背景（基于资料摘录）\n\n> ${excerpt}${src.length > 4500 ? "…" : ""}\n\n`;
  } else {
    core += `## 背景\n\n未勾选文件库资料：以下方案以通用最佳实践撰写；勾选资料后 Demo 将把摘录嵌入背景并调整措辞。\n\n`;
  }
  core += `## 目标\n\n1. 对齐决策者与执行者对问题边界、成功标准与交付物的共识。\n2. 给出可落地的路径、节奏与风险缓释措施。\n3. 为后续正式稿（接入 API 后）预留数据与访谈插槽。\n\n## 核心内容\n\n围绕「${roughKeywords(src)}」展开：建议把价值主张、约束条件与关键里程碑写进同一页「执行摘要」，并在附录提供支撑表与假设清单。\n\n## 详细方案\n\n- **阶段一（对齐）**：澄清范围、干系人、口径与模板；冻结变更规则。\n- **阶段二（设计）**：产出备选方案与评估矩阵（成本/收益/风险）。\n- **阶段三（试点）**：小流量验证关键假设，收集数据修正模型。\n- **阶段四（推广）**：规模化复制与运营监控看板上线。\n\n## 风险与应对\n\n| 风险 | 影响 | 应对 | Owner（建议） |\n| --- | --- | --- | --- |\n| 口径不一 | 高 | 统一数据词典与单一数据源 | 数据负责人 |\n| 资源挤占 | 中 | 滚动优先级与砍需求门禁 | PMO |\n| 外部依赖延期 | 高 | 缓冲期+替代供应商策略 | 采购/项目经理 |\n\n## 执行步骤\n\n1. 召开启动会，确认 RACI 与沟通节奏。\n2. 建立周度检查点与风险登记册。\n3. 对关键交付物走评审签字流程。\n4. 复盘沉淀模板，进入下一轮迭代。\n\n## 时间线（示例）\n\n| 周次 | 里程碑 |\n| --- | --- |\n| W1–W2 | 对齐与数据收集 |\n| W3–W6 | 方案设计与评审 |\n| W7–W10 | 试点与调参 |\n| W11–W12 | 总结与推广决策 |\n\n## 结论\n\n本文为 **Demo 长文**：在结构上对齐正式商务交付物，便于复制、修改与导出；配置 API Key 后可用同一写作控制项生成终稿。\n`;

  const minGeneric =
    genTypeKey === "im" || genTypeKey === "dd_report" || genTypeKey === "fin_analysis" ? 7200 : 4200;
  while (core.length < minGeneric) {
    core += `\n\n## 续篇（Demo 自动增补）\n\n围绕「${roughKeywords(src)}」补充执行细则：将会议决议转为行动项（含验收标准）；对跨部门接口定义 SLA；对预算与人力冲击做敏感性说明。\n`;
  }
  return core;
}

function buildDemoDocument({
  genType,
  genTypeKey = "",
  tone,
  instruction,
  sourceText,
  fileNames,
  genControls = null,
}) {
  const src = String(sourceText || "");
  const names = (fileNames && fileNames.length ? fileNames.join("、") : "未引用外部文件") || "未引用外部文件";
  const tables = demoTableBlocks(genTypeKey);
  const body =
    longDemoDocSections(genType, genTypeKey, tone, instruction, src, names, genControls) +
    (tables ? `\n${tables}\n` : "");
  const safe = String(genTypeKey || "generated").replace(/[^a-zA-Z0-9_-]/g, "_") || "generated";
  return {
    fileName: `${safe}-demo.md`,
    content: body,
    summary: `Demo 长文文档（${genTypeKey || "通用"}），引用：${names}；语气 ${tone || "专业"}；约 ${body.length} 字`,
    demo: true,
  };
}

function expandDemoPolish(baseText, hint) {
  const base = String(baseText || "").trim();
  const h = clip(hint, 400) || "优化";
  if (!base) return base;
  const paras = base.split(/\n\n+/).filter((p) => p.trim());
  const blocks = paras.slice(0, 14).map((p, i) => {
    return `### 深化块 ${i + 1}\n\n${p}\n\n**按指令「${h}」的推演补充**：从利益相关方、证据链与可验证指标三方面展开；指出若对外沟通需删减的敏感表述；给出下一步应收集的数据或访谈对象。\n`;
  });
  let out = `## Demo 优化稿（本地引擎）\n\n> 指令：${h}\n\n${blocks.join("\n")}`;
  out += `\n\n## 行动摘要\n\n- 将上文标星结论同步到责任人与时间表。\n- 对仍缺证据的句子标注「待核实」后再外发。\n- 配置 API Key 后可获得模型级重写而非规则扩写。\n\n---\n（Demo：以上为基于段落的结构性扩写，非云端模型。）\n`;
  while (out.length < 1200) {
    out += `\n\n### 续写（Demo）\n\n围绕同一指令继续补充可执行检查项与沟通话术，避免空洞形容词堆砌。\n`;
  }
  return out;
}

function buildIconPrompts({ brand, industry, keywords, style, color }) {
  const b = brand || "BrandX";
  const ind = industry || "technology";
  const kw = keywords || "minimal, premium";
  const st = style || "tech";
  const col = color || "blue gradient";

  const mj = `${b} logo icon, ${ind} industry, ${kw}, ${st} style, ${col}, vector, centered, high detail --v 6 --q 2`;
  const dalle = `A flat app icon for "${b}" in ${ind} sector. Keywords: ${kw}. Style: ${st}. Colors: ${col}. White background, crisp edges, no text, professional product icon.`;
  const sd = `masterpiece, best quality, app icon, single emblem, (${b}:1.2), ${ind}, ${kw}, ${st}, ${col}, svg-like clean shapes, soft shadows, 1024x1024`;

  return { midjourney: mj, dalle, stableDiffusion: sd, demo: true };
}

export function demoWorkspaceAnalysis(args) {
  return buildDemoReport(args);
}

export function demoDocumentGeneration(args) {
  return buildDemoDocument(args);
}

export function demoPolish(text, hint) {
  return expandDemoPolish(text, hint);
}

export function demoIconPrompts(args) {
  return buildIconPrompts(args);
}
