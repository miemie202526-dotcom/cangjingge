/**
 * 交付场景模板：仅填充「写作要求」与可选默认生成类型 key（与 documentGenTypeOptions.value 对齐）。
 * 文案集中在桌面清单旁维护，便于迭代。
 */

/** @typedef {{ id: string, label: string, genTypeKey?: string, instruction: string, tags?: string[] }} DeliveryTpl */

/** @type {DeliveryTpl[]} */
const deliveryDocumentTemplates = [
  {
    id: "formal_bp",
    label: "投融资 · 商业计划书（完整章节）",
    genTypeKey: "bp",
    tags: ["融资", "路演"],
    instruction:
      "输出可直接投递机构的商业计划书 Markdown：执行摘要单列开篇；市场须含 TAM/SAM/SOM 表；产品与护城河写清交付边界；商业模式含单价与回款假设；竞争矩阵；12–36 个月里程碑与财务三张表摘要（含关键假设脚注）；融资条款与资金用途列表；风险与合规专节。全文勿留空洞占位词。",
  },
  {
    id: "exec_decision",
    label: "管理层 · 一页决策备忘录",
    genTypeKey: "minutes",
    tags: ["决策", "高管"],
    instruction:
      "写一页纸决策备忘录 Markdown：背景（事实链条）、可选方案对比表、推荐方案与理由、资源与时间表、风险与缓解、需管理层拍板的 3 个问题。语气克制可汇报。",
  },
  {
    id: "customer_proposal",
    label: "对外 · 客户提案 / RFP 应答骨架",
    tags: ["销售", "投标"],
    instruction:
      "生成面向客户的正式提案 Markdown：客户痛点复述 → 我方方案概述 → 范围与交付物清单 → 方法与里程碑 → 团队与资历摘要 → SLA 与假设 → 报价结构说明（不写死数字则用区间并注明假设）→ 附录术语表。",
  },
  {
    id: "prd_light",
    label: "产品 · PRD 精简版",
    tags: ["产品", "研发"],
    instruction:
      "输出 Markdown PRD：目标与非目标、用户故事优先级表、核心流程、接口与数据字段假设、验收标准（Given/When/Then）、上线检查清单与回滚策略。避免空话套话。",
  },
  {
    id: "quarter_review",
    label: "运营 · 季度经营复盘",
    tags: ["运营", "复盘"],
    instruction:
      "季度复盘 Markdown：OKR 完成情况表、收入/漏斗/留存要点、成功经验 3 条、失误与根因、下季度三件事与 Owner、需要的管理层决策资源。数据缺口处写明采集口径而非留白。",
  },
  {
    id: "audit_pack",
    label: "合规 · 审计 / 盘点说明稿",
    tags: ["合规", "审计"],
    instruction:
      "Markdown 形式审计配合说明：范围与控制目标、抽样方法、发现的缺陷分级表、整改计划与时间表、联系人矩阵。措辞严谨，禁止夸大结论。",
  },
  {
    id: "research_memo",
    label: "研究 · 行业研究备忘录",
    genTypeKey: "market_deep",
    tags: ["研究", "行业"],
    instruction:
      "行业研究备忘录 Markdown：摘要论点、产业链图谱文字描述、规模与增速假设表、驱动因素与制约、典型玩家对标表、投资机会与风险提示、参考资料占位（标注须替换为真实来源）。",
  },
  {
    id: "kickoff",
    label: "项目 · 启动会纪要与 RACI",
    genTypeKey: "project_tracker",
    tags: ["项目", "协同"],
    instruction:
      "项目启动纪要 Markdown：目标与成功标准、范围冻结日期、里程碑表、RACI 矩阵（Markdown 表）、沟通节奏与文档仓库约定、即时行动项清单（责任人+截止日期）。",
  },
  {
    id: "invest_ic",
    label: "投资 · IC 投资备忘录骨架",
    genTypeKey: "invest_report",
    tags: ["投资", "尽调"],
    instruction:
      "投资备忘录 Markdown：交易概要、核心投资论点（不少于 5 条）、业务与财务要点、可比估值区间假设表、关键尽调问题清单、主要风险矩阵与缓解、建议决议草案（须法务复核免责声明）。",
  },
];

module.exports = { deliveryDocumentTemplates };
