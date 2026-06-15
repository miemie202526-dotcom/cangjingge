/**
 * 导出前交付质检（启发式，不替代人工复核）。
 */

/** @typedef {{ level: "ok"|"info"|"warn"|"error", code: string, detail: string }} QCIssue */

/** @param {string} md */
export function runDeliveryQuality(md) {
  const text = String(md ?? "");
  /** @type {QCIssue[]} */
  const issues = [];

  const han = text.match(/[\u4e00-\u9fff]/g) || [];
  const hanCount = han.length;
  if (!text.trim()) {
    issues.push({ level: "error", code: "empty", detail: "正文为空。" });
    return { ok: false, hanCount, tableBlocks: 0, h1Count: 0, issues };
  }

  const placeholders = ["TBD", "TODO", "待补充", "此处填写", "xxx", "XXX", "示例文案", "【请填写】"];
  for (const ph of placeholders) {
    if (text.includes(ph)) {
      issues.push({ level: "error", code: "placeholder", detail: `检测到占位片段「${ph}」，对外交付前请替换或删除。` });
    }
  }

  const vague = ["稍后补充", "有待完善", "暂略"];
  for (const v of vague) {
    if (text.includes(v)) {
      issues.push({ level: "warn", code: "vague", detail: `含有弱化表述「${v}」，正式稿建议改写为具体结论或数据采集计划。` });
    }
  }

  if (hanCount < 800) {
    issues.push({
      level: "warn",
      code: "short_zh",
      detail: `简体中文主体约 ${hanCount} 字，正式对外提案通常需要更长篇幅（可按类型调整）。`,
    });
  }

  const h1Count = (text.match(/^\s*#\s+/gm) || []).length;
  if (h1Count === 0) {
    issues.push({ level: "info", code: "no_h1", detail: "未检测到一级标题 `#`，建议在篇首增加总标题便于归档。" });
  }
  if (h1Count > 1) {
    issues.push({ level: "info", code: "multi_h1", detail: `检测到 ${h1Count} 个一级标题，Word/HTML 封面以外可考虑合并层级以免重复。` });
  }

  let tableBlocks = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (/^\|.+\|$/.test(lines[i].trim()) && /^\|[\s\-:|]+\|$/.test(lines[i + 1].trim())) {
      tableBlocks += 1;
      i += 2;
    }
  }
  if (tableBlocks === 0 && hanCount > 1500) {
    issues.push({
      level: "info",
      code: "no_table",
      detail: "较长正文未检测到 Markdown 表格；商务类交付可考虑加入对标表、里程碑表或摘要表。",
    });
  }

  const linkParen = text.match(/\[[^\]]+\]\([^)]+\)/g) || [];
  if (linkParen.length > 5) {
    issues.push({
      level: "info",
      code: "many_links",
      detail: `含 ${linkParen.length} 处 Markdown 链接；导出 PDF 时请确认外链可达性或改为脚注说明。`,
    });
  }

  const errCount = issues.filter((x) => x.level === "error").length;
  const ok = errCount === 0;
  return { ok, hanCount, tableBlocks, h1Count, issues };
}
