/** Workbench helpers: client-side heuristics, version snapshots, project name. */

export const LS_ANALYSIS_VERSIONS = "acsp-wb-versions-analysis";
export const LS_GENERATOR_VERSIONS = "acsp-wb-versions-generator";

const VERSION_CAP = 15;

export function currentProjectName() {
  try {
    return String(document.getElementById("headerProjectName")?.value || "").trim();
  } catch {
    return "";
  }
}

/**
 * @param {string} docText
 * @param {string[]} fileNames
 */
export function clientFileHealth(docText, fileNames) {
  const text = String(docText || "");
  const len = text.length;
  const issues = [];
  if (!len) issues.push("正文为空或未解析，分析将主要依赖自定义问题。");
  if (len > 0 && len < 400) issues.push("正文较短，结论可能缺乏统计意义。");
  if (/\b(20\d{2}-\d{2}-\d{2})\b/.test(text) === false && /日期|截止|交付/.test(text) && len > 800) {
    issues.push("提到时间语境但未抽取到明确日期，建议核对原文。");
  }
  if (/财务|收入|利润|现金流|万元|亿元|¥|￥/.test(text) && !/\d/.test(text.slice(0, 2000))) {
    issues.push("出现财务语境但前段缺少数字，可能解析不完整。");
  }
  if (/甲方|乙方|合同|协议/.test(text) === false && /违约|赔偿|管辖|保密/.test(text)) {
    issues.push("存在法律关键词但未识别到甲乙方称谓，可能为摘录片段。");
  }
  const score = Math.max(
    12,
    Math.min(100, 48 + Math.min(40, Math.floor(len / 3500) * 8) - issues.length * 10)
  );
  const names = (fileNames && fileNames.length ? fileNames.join("、") : "无") || "无";
  const qualityLine = len ? `约 ${len.toLocaleString()} 字符；文件：${names}` : "未合并文件正文";
  return { score, issues, qualityLine };
}

/**
 * @param {string} docText
 * @returns {string[]}
 */
export function recommendModesFromDoc(docText) {
  const t = String(docText || "");
  const modes = [];
  if (/合同|协议|条款|赔偿|保密|管辖/.test(t)) modes.push("contract", "legal_risk");
  if (/收入|利润|现金流|资产负债|审计|毛利率/.test(t)) modes.push("finance");
  if (/市场|TAM|竞品|份额|定价/.test(t)) modes.push("market", "competitor");
  if (/数据|报表|表格|指标|SQL| cohort/.test(t)) modes.push("data", "table_data");
  if (/投资|融资|估值|尽调|IC/.test(t)) modes.push("investment", "diligence");
  if (!modes.length) modes.push("business", "strategy");
  return [...new Set(modes)].slice(0, 5);
}

/**
 * @param {string} key
 * @param {{ at?: number, label?: string, content: string, meta?: Record<string, unknown> }} entry
 */
export function pushWorkbenchVersion(key, entry) {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    const arr = Array.isArray(list) ? list : [];
    arr.unshift({
      id: crypto.randomUUID(),
      at: entry.at ?? Date.now(),
      label: String(entry.label || "").slice(0, 120),
      content: String(entry.content || ""),
      meta: entry.meta && typeof entry.meta === "object" ? entry.meta : {},
    });
    while (arr.length > VERSION_CAP) arr.pop();
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    console.warn("[workbenchShared] pushWorkbenchVersion", e);
  }
}

/** @param {string} key */
export function loadWorkbenchVersions(key) {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
