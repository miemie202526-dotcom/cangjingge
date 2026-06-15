/**
 * 修订说明 / 参考文献 / 溯源声明 / 保密标注 — 导出前拼接正文。
 */

/** @typedef {{ revisionNotes?: string, refsText?: string, includeProvenance?: boolean, confidentialLevel?: string }} AppendixOpts */

const CONFIDENTIAL_LABEL_ZH = {
  public: "",
  internal: "内部资料 · 请勿擅自对外转发",
  confidential: "保密文件 · 仅限授权人员查阅",
};

/**
 * @param {string} md
 * @param {AppendixOpts} opts
 */
export function appendDeliverySections(md, opts = {}) {
  let s = String(md ?? "");
  const revision = String(opts.revisionNotes || "").trim();
  const refs = String(opts.refsText || "").trim();
  const prov = Boolean(opts.includeProvenance);
  const level = opts.confidentialLevel || "public";

  if (revision) {
    s += `\n\n---\n\n## 修订说明（交付控制）\n\n${revision}\n`;
  }
  if (refs) {
    s += `\n\n## 参考文献与引用\n\n${refs}\n`;
  }
  if (prov) {
    s += `\n\n## 数据与来源声明\n\n文中表格与数值若未逐条标注来源，可能包含模型推演或示例假设。**对外使用前**须替换为经业务与财务确认的数据口径、原始凭证或第三方数据版权说明。\n`;
  }
  const confLabel = CONFIDENTIAL_LABEL_ZH[level];
  if (level !== "public" && confLabel) {
    s += `\n\n---\n\n**保密级别**：${confLabel}\n`;
  }
  return s;
}

/** @param {string} level */
export function confidentialLabelZh(level) {
  return CONFIDENTIAL_LABEL_ZH[level] || CONFIDENTIAL_LABEL_ZH.public;
}
