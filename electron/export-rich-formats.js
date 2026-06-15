/**
 * 将 Markdown 正文转为更专业的 Word / Excel / CSV 导出（标题、列表、表格、引用等）。
 * 供主进程 save-generated-file / 批量导出调用。
 */

const ExcelJS = require("exceljs");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  TableLayoutType,
  ShadingType,
  convertInchesToTwip,
} = require("docx");

const DOCX_FONT = {
  ascii: "Microsoft YaHei",
  eastAsia: "Microsoft YaHei",
  hAnsi: "Microsoft YaHei",
};

const HEADING = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

function tr(line) {
  return String(line || "").trimEnd();
}

/** @param {Record<string, unknown>=} meta */
function normalizeExportMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  return {
    title: String(meta.title || "").trim(),
    projectName: String(meta.projectName || "").trim(),
    audience: String(meta.audience || "").trim(),
    purpose: String(meta.purpose || "").trim(),
    generatedAt: meta.generatedAt ? String(meta.generatedAt) : "",
    confidentialLevel: String(meta.confidentialLevel || "").trim(),
    htmlTheme: String(meta.htmlTheme || "").trim(),
  };
}

/** @param {{ confidentialLevel?: string }=} m */
function confidentialZhShort(m) {
  const c = m?.confidentialLevel || "";
  if (c === "internal") return "内部资料 · 请勿外发";
  if (c === "confidential") return "保密 · 限制传阅";
  return "";
}

/** @param {string=} isoOrEmpty */
function formatZhTimestamp(isoOrEmpty) {
  try {
    const d = isoOrEmpty ? new Date(isoOrEmpty) : new Date();
    if (Number.isNaN(d.getTime())) return new Date().toLocaleString("zh-CN", { hour12: false });
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    return new Date().toLocaleString("zh-CN", { hour12: false });
  }
}

/** @param {Record<string, unknown>=} meta */
function buildDocxDeliverableCover(meta) {
  const m = normalizeExportMeta(meta);
  if (!m.title && !m.projectName && !m.audience && !m.purpose && !m.generatedAt && !m.confidentialLevel) return [];

  /** @type {import("docx").Paragraph[]} */
  const paras = [];
  paras.push(
    new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: "F1F5F9" },
      spacing: { after: 160 },
      children: [
        new TextRun({
          text: "交付封面（对外发送前可删除本页）",
          font: DOCX_FONT,
          bold: true,
          size: 22,
          color: "334155",
        }),
      ],
    })
  );
  const rows = [
    ["文档标题", m.title || "（请填写）"],
    ["项目 / 用途", m.purpose || m.projectName || "—"],
    ["受众", m.audience || "—"],
    ["保密级别", confidentialZhShort(m) || "公开"],
    ["导出时间", formatZhTimestamp(m.generatedAt)],
    ["版本占位", "V1.0（请按需修订）"],
  ];
  for (const [lab, val] of rows) {
    paras.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: `${lab}：`, font: DOCX_FONT, bold: true }),
          new TextRun({ text: val, font: DOCX_FONT }),
        ],
      })
    );
  }
  paras.push(
    new Paragraph({
      spacing: { before: 120, after: 240 },
      children: [new TextRun({ text: "以下为正文。", font: DOCX_FONT, italics: true, color: "64748B" })],
    })
  );
  return paras;
}

/** @param {string} line */
function splitPipeRow(line) {
  const t = line.trim();
  if (!t.includes("|")) return null;
  const raw = t.split("|").map((s) => s.trim());
  const cells = raw[0] === "" ? raw.slice(1) : raw.slice();
  while (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells.length >= 2 ? cells : null;
}

/** @param {string} line */
function isTableSeparatorRow(line) {
  const cells = splitPipeRow(line);
  if (!cells) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));
}

/**
 * @param {string} md
 * @returns {string[][][]}
 */
function extractAllTables(md) {
  const lines = String(md ?? "").split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length - 1) {
    const r0 = splitPipeRow(tr(lines[i]));
    const sep = tr(lines[i + 1]);
    if (!r0 || !isTableSeparatorRow(sep)) {
      i += 1;
      continue;
    }
    const table = [r0];
    let k = i + 2;
    while (k < lines.length) {
      const r = splitPipeRow(tr(lines[k]));
      if (!r) break;
      table.push(r);
      k += 1;
    }
    const ncol = Math.max(...table.map((row) => row.length), 1);
    out.push(
      table.map((row) => {
        const x = [...row];
        while (x.length < ncol) x.push("");
        return x.slice(0, ncol);
      })
    );
    i = k;
  }
  return out;
}

/** 导出到单元格时弱化行内 Markdown 标记（Excel 富文本分段成本高，先保证可读纯文本） */
function stripInlineMdForCell(s) {
  return String(s ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

/** 判断 markdown 单元格内容是否是合法的 Excel 公式（= 开头 + 括号平衡 + 长度 >= 2） */
function looksLikeFormula(text) {
  if (typeof text !== "string") return false;
  const s = text.trim();
  if (!s.startsWith("=") || s.length < 2) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** 把单元格文本拆成 { value, numFmt } 数值 + 数字格式；返回 null 表示不是可放心转数字的内容 */
function parseNumericCell(raw) {
  const orig = String(raw ?? "").trim();
  if (!orig) return null;
  // 排除像 "001" 这种编号、日期 "2024-01-15" 等
  if (/^0\d/.test(orig)) return null;
  if (orig.length > 1 && /\d.*-.*\d/.test(orig)) return null;
  // 形如 -¥1,234.56 / 85% / 1234 / 12.5
  const m = orig.match(/^(-?)([¥￥$])?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(%?)$/);
  if (!m) return null;
  const sign = m[1] || "";
  const currency = m[2] || "";
  const numStr = m[3].replace(/,/g, "");
  const pct = m[4] === "%";
  const n = Number(sign + numStr);
  if (!Number.isFinite(n)) return null;
  if (pct) return { value: n / 100, numFmt: "0.00%" };
  if (currency) return { value: n, numFmt: '"¥"#,##0.00' };
  if (/\./.test(numStr)) return { value: n, numFmt: "#,##0.00" };
  if (/,/.test(m[3])) return { value: n, numFmt: "#,##0" };
  return { value: n, numFmt: null };
}

/**
 * 将 Markdown 渲染为单工作表排版：标题层级、列表、引用、代码块、表格（多列），避免「整篇塞一列原文」。
 * @param {import("exceljs").Worksheet} ws
 * @param {string} md
 * @param {Record<string, unknown>} meta
 * @returns {number} 下一可用行号
 */
function fillXlsxMarkdownStyledBody(ws, md, meta) {
  const lines = String(md ?? "").split(/\r?\n/);
  let r = 1;
  const zhFont = "Microsoft YaHei";
  const padFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
  const headFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  const thinBottom = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
  const thinGrid = {
    top: { style: "thin", color: { argb: "FFE2E8F0" } },
    left: { style: "thin", color: { argb: "FFE2E8F0" } },
    bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
    right: { style: "thin", color: { argb: "FFE2E8F0" } },
  };

  if (meta && String(meta.title || "").trim()) {
    ws.mergeCells(r, 1, r, 8);
    const tcell = ws.getCell(r, 1);
    tcell.value = String(meta.title).trim();
    tcell.font = { bold: true, size: 16, name: zhFont, color: { argb: "FF0F172A" } };
    tcell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    tcell.fill = headFill;
    r += 1;
    const sub = [];
    if (meta.purpose) sub.push(`用途：${meta.purpose}`);
    if (meta.audience) sub.push(`受众：${meta.audience}`);
    if (sub.length) {
      ws.mergeCells(r, 1, r, 8);
      const sc = ws.getCell(r, 1);
      sc.value = sub.join("  ·  ");
      sc.font = { size: 10, name: zhFont, color: { argb: "FF64748B" } };
      sc.alignment = { vertical: "top", wrapText: true };
      r += 1;
    }
    r += 1;
  }

  let i = 0;
  let inCode = false;
  while (i < lines.length) {
    const t = tr(lines[i]);

    if (t.startsWith("```")) {
      inCode = !inCode;
      i += 1;
      continue;
    }
    if (inCode) {
      const row = ws.getRow(r);
      const c = row.getCell(1);
      c.value = t || " ";
      c.font = { name: "Consolas", size: 10, color: { argb: "FF334155" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      c.alignment = { vertical: "top", wrapText: true };
      r += 1;
      i += 1;
      continue;
    }

    const r0 = splitPipeRow(t);
    const next = i + 1 < lines.length ? tr(lines[i + 1]) : "";
    if (r0 && isTableSeparatorRow(next)) {
      const table = [r0];
      let k = i + 2;
      while (k < lines.length) {
        const rowCells = splitPipeRow(tr(lines[k]));
        if (!rowCells) break;
        table.push(rowCells);
        k += 1;
      }
      const ncol = Math.max(...table.map((row) => row.length), 1);
      // 估算列宽：取表头与所有数据行单元格字符宽度的最大值，再按经验系数收敛到 [6, 36]
      const colWidth = new Array(ncol).fill(8);
      table.forEach((cells) => {
        for (let ci = 0; ci < ncol; ci += 1) {
          const raw = String(cells[ci] ?? "");
          let w = 0;
          for (const ch of raw) w += /[\u4e00-\u9fff\uff01-\uff5e]/.test(ch) ? 2 : 1;
          colWidth[ci] = Math.max(colWidth[ci], Math.min(36, Math.max(6, w + 2)));
        }
      });
      // 记住表头行号，便于稍后做冻结窗格
      const headerRow = r;
      table.forEach((cells, ri) => {
        const row = ws.getRow(r);
        for (let ci = 0; ci < ncol; ci += 1) {
          const cell = row.getCell(ci + 1);
          const stripped = stripInlineMdForCell(cells[ci] ?? "");
          cell.alignment = { vertical: "top", wrapText: true };
          cell.border = thinGrid;
          if (ri === 0) {
            // 表头始终写字符串
            cell.value = stripped;
            cell.font = { bold: true, size: 10, name: zhFont, color: { argb: "FF0F172A" } };
            cell.fill = headFill;
          } else if (looksLikeFormula(stripped)) {
            // 识别 = 开头公式：写成 ExcelJS formula 对象，让 Excel 真正计算
            cell.value = { formula: stripped.slice(1) };
            cell.font = { size: 10, name: zhFont, color: { argb: "FF0B3A75" } };
          } else {
            // 尝试转数字（金额 / 百分比 / 千分位），不行就保留字符串
            const numeric = parseNumericCell(stripped);
            if (numeric) {
              cell.value = numeric.value;
              if (numeric.numFmt) cell.numFmt = numeric.numFmt;
              cell.font = { size: 10, name: zhFont, color: { argb: "FF1E293B" } };
              cell.alignment = { vertical: "top", wrapText: true, horizontal: "right" };
            } else {
              cell.value = stripped;
              cell.font = { size: 10, name: zhFont, color: { argb: "FF1E293B" } };
            }
          }
        }
        r += 1;
      });
      // 应用估算列宽（取该表估算列宽与已存在列宽的较大值）
      for (let ci = 0; ci < ncol; ci += 1) {
        const col = ws.getColumn(ci + 1);
        if (!col.width || col.width < colWidth[ci]) col.width = colWidth[ci];
      }
      // 表头筛选 + 冻结：让用户打开 XLSX 直接能筛选 + 滚动时表头固定
      try {
        ws.autoFilter = {
          from: { row: headerRow, column: 1 },
          to: { row: headerRow + table.length - 1, column: ncol },
        };
        ws.views = [{ state: "frozen", ySplit: headerRow }];
      } catch {
        /* 多表场景下后表会覆盖前表的 autoFilter/views，可接受 */
      }
      r += 1;
      i = k;
      continue;
    }

    const hm = t.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      const lv = Math.min(hm[1].length, 6);
      const row = ws.getRow(r);
      const c = row.getCell(1);
      c.value = stripInlineMdForCell(hm[2]);
      const sizes = { 1: 15, 2: 13, 3: 12, 4: 11, 5: 11, 6: 11 };
      c.font = {
        bold: true,
        size: sizes[lv] || 11,
        name: zhFont,
        color: { argb: lv <= 2 ? "FF0F172A" : "FF334155" },
      };
      c.alignment = { vertical: "top", wrapText: true };
      if (lv <= 2) c.border = thinBottom;
      r += 1;
      i += 1;
      continue;
    }

    const bl = t.match(/^[\-\*]\s+(.+)$/);
    if (bl) {
      const row = ws.getRow(r);
      const c = row.getCell(1);
      c.value = `• ${stripInlineMdForCell(bl[1])}`;
      c.font = { size: 10, name: zhFont, color: { argb: "FF1E293B" } };
      c.alignment = { vertical: "top", wrapText: true, indent: 1 };
      r += 1;
      i += 1;
      continue;
    }

    const num = t.match(/^(\d+)\.\s+(.+)$/);
    if (num) {
      const row = ws.getRow(r);
      const c = row.getCell(1);
      c.value = `${num[1]}. ${stripInlineMdForCell(num[2])}`;
      c.font = { size: 10, name: zhFont, color: { argb: "FF1E293B" } };
      c.alignment = { vertical: "top", wrapText: true, indent: 1 };
      r += 1;
      i += 1;
      continue;
    }

    const qu = t.match(/^>\s?(.*)$/);
    if (qu) {
      const row = ws.getRow(r);
      const c = row.getCell(1);
      c.value = stripInlineMdForCell(qu[1] || " ");
      c.font = { italic: true, size: 10, name: zhFont, color: { argb: "FF475569" } };
      c.fill = padFill;
      c.alignment = { vertical: "top", wrapText: true, indent: 1 };
      r += 1;
      i += 1;
      continue;
    }

    if (/^[\s\-*_]{3,}$/.test(t)) {
      i += 1;
      continue;
    }

    if (!t) {
      r += 1;
      i += 1;
      continue;
    }

    const row = ws.getRow(r);
    const c = row.getCell(1);
    c.value = stripInlineMdForCell(t);
    c.font = { size: 10, name: zhFont, color: { argb: "FF1E293B" } };
    c.alignment = { vertical: "top", wrapText: true };
    r += 1;
    i += 1;
  }

  // 默认列宽（仅当表格自适应没设过时生效）：第一列偏宽（多为标签/段落），其他列略窄。
  if (!ws.getColumn(1).width) ws.getColumn(1).width = 72;
  for (let c = 2; c <= 16; c += 1) {
    if (!ws.getColumn(c).width) ws.getColumn(c).width = 13;
  }
  // 仅当表格逻辑没有设置 views 时给一个默认 frozen
  if (!ws.views || !ws.views.length) ws.views = [{ state: "frozen", ySplit: 0 }];
  if (r === 1 && !String(meta?.title || "").trim()) {
    ws.getCell(1, 1).value = "（正文为空）";
    ws.getCell(1, 1).font = { italic: true, name: zhFont, color: { argb: "FF94A3B8" } };
  }
  return r;
}

/**
 * @param {string} text
 * @returns {Promise<Buffer>}
 */
async function markdownToDocxBuffer(text, metaIn) {
  const cover = buildDocxDeliverableCover(metaIn);
  const lines = String(text ?? "").split(/\r?\n/);
  /** @type {(Paragraph|Table)[]} */
  const children = [];
  let i = 0;
  let inCode = false;

  while (i < lines.length) {
    const line = lines[i];
    const t = tr(line);

    if (t.startsWith("```")) {
      inCode = !inCode;
      i += 1;
      continue;
    }
    if (inCode) {
      children.push(
        new Paragraph({
          shading: { type: ShadingType.CLEAR, fill: "F1F5F9" },
          spacing: { after: 40 },
          children: [new TextRun({ text: t || " ", font: DOCX_FONT })],
        })
      );
      i += 1;
      continue;
    }

    const r0 = splitPipeRow(t);
    const next = i + 1 < lines.length ? tr(lines[i + 1]) : "";
    if (r0 && isTableSeparatorRow(next)) {
      const table = [r0];
      let k = i + 2;
      while (k < lines.length) {
        const r = splitPipeRow(tr(lines[k]));
        if (!r) break;
        table.push(r);
        k += 1;
      }
      const ncol = Math.max(...table.map((row) => row.length), 1);
      const norm = table.map((row) => {
        const x = [...row];
        while (x.length < ncol) x.push("");
        return x.slice(0, ncol);
      });
      const twip = Math.max(1200, Math.floor(8800 / ncol));
      const tableRows = norm.map(
        (cells, ri) =>
          new TableRow({
            children: cells.map(
              (cell) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: cell || " ",
                          font: DOCX_FONT,
                          bold: ri === 0,
                        }),
                      ],
                    }),
                  ],
                  width: { size: twip, type: WidthType.DXA },
                })
            ),
          })
      );
      children.push(
        new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
          layout: TableLayoutType.AUTOFIT,
        })
      );
      children.push(new Paragraph({ children: [new TextRun({ text: " ", font: DOCX_FONT })], spacing: { after: 160 } }));
      i = k;
      continue;
    }

    const hm = t.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      const lv = Math.min(hm[1].length, 6);
      children.push(
        new Paragraph({
          heading: HEADING[lv],
          spacing: { before: lv <= 2 ? 280 : 160, after: 120 },
          children: [new TextRun({ text: hm[2], font: DOCX_FONT })],
        })
      );
      i += 1;
      continue;
    }

    const bl = t.match(/^[\-\*]\s+(.+)$/);
    if (bl) {
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          indent: { left: convertInchesToTwip(0.28), hanging: convertInchesToTwip(0.18) },
          children: [new TextRun({ text: `\u2022 ${bl[1]}`, font: DOCX_FONT })],
        })
      );
      i += 1;
      continue;
    }

    const num = t.match(/^(\d+)\.\s+(.+)$/);
    if (num) {
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          indent: { left: convertInchesToTwip(0.28), hanging: convertInchesToTwip(0.22) },
          children: [new TextRun({ text: `${num[1]}. ${num[2]}`, font: DOCX_FONT })],
        })
      );
      i += 1;
      continue;
    }

    const qu = t.match(/^>\s?(.*)$/);
    if (qu) {
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          indent: { left: convertInchesToTwip(0.22) },
          shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
          children: [new TextRun({ text: qu[1] || " ", font: DOCX_FONT, italics: true })],
        })
      );
      i += 1;
      continue;
    }

    if (/^[\s\-*_]{3,}$/.test(t)) {
      i += 1;
      continue;
    }

    if (!t) {
      children.push(
        new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "\u00a0", font: DOCX_FONT })] })
      );
      i += 1;
      continue;
    }

    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: t, font: DOCX_FONT })],
      })
    );
    i += 1;
  }

  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: " ", font: DOCX_FONT })] }));
  }

  const doc = new Document({
    sections: [{ properties: {}, children: [...cover, ...children] }],
  });
  const buf = await Packer.toBuffer(doc);
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

/**
 * 多表多工作表 +「正文流」工作表；无表格时退化为双列流水。
 * @param {string} raw
 */
async function markdownToRichXlsxBuffer(raw, metaIn) {
  const md = String(raw ?? "");
  const tables = extractAllTables(md);
  const workbook = new ExcelJS.Workbook();
  const meta = normalizeExportMeta(metaIn);
  const hasDeliverableMeta = Boolean(
    meta.title ||
      meta.projectName ||
      meta.audience ||
      meta.purpose ||
      meta.generatedAt ||
      meta.confidentialLevel
  );
  /** 默认不生成「文档信息」Sheet，避免用户误以为 Excel 只有元数据；需要时在 exportMeta 传 includeXlsxMetaSheet: true */
  const wantMetaSheet =
    Boolean(metaIn && typeof metaIn === "object" && metaIn.includeXlsxMetaSheet === true) &&
    hasDeliverableMeta;

  // 主工作表：结构化排版（标题/列表/引用/代码/表格），不再逐行 dump 原始 Markdown
  const body = workbook.addWorksheet("正文");
  fillXlsxMarkdownStyledBody(body, md, meta);

  /** 需要单独「数据表」工作表时，在 exportMeta 传 xlsxSplitDataTables: true（默认不拆，避免与正文表格重复） */
  if (
    Boolean(metaIn && typeof metaIn === "object" && metaIn.xlsxSplitDataTables === true) &&
    tables.length
  ) {
    tables.forEach((tb, idx) => {
      const name = `表${idx + 1}`.slice(0, 31);
      const ws = workbook.addWorksheet(name);
      tb.forEach((row, ri) => {
        const rowRef = ws.getRow(ri + 1);
        row.forEach((cell, ci) => {
          rowRef.getCell(ci + 1).value = stripInlineMdForCell(cell);
        });
        if (ri === 0) {
          rowRef.font = { bold: true, name: "Microsoft YaHei", size: 10 };
          rowRef.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFE2E8F0" },
          };
        } else {
          rowRef.font = { name: "Microsoft YaHei", size: 10 };
        }
      });
      ws.views = [{ state: "frozen", ySplit: 1 }];
    });
  }

  if (wantMetaSheet) {
    const infoWs = workbook.addWorksheet("文档信息");
    infoWs.mergeCells("A1:D1");
    const head = infoWs.getCell("A1");
    head.value = "导出元数据（交付前核对；不需要时可删除本工作表）";
    head.font = { bold: true, size: 12 };
    head.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE2E8F0" },
    };
    let ri = 3;
    const putKv = (k, v) => {
      infoWs.getCell(`A${ri}`).value = k;
      infoWs.getCell(`B${ri}`).value = v;
      infoWs.getCell(`A${ri}`).font = { bold: true };
      ri += 1;
    };
    putKv("文档标题", meta.title || "—");
    putKv("受众", meta.audience || "—");
    putKv("保密级别", confidentialZhShort(meta) || "公开");
    putKv("导出时间", formatZhTimestamp(meta.generatedAt));
    putKv("文中解析表格数", String(tables.length));
    putKv("正文总行数", String(md.split(/\r?\n/).length));
    putKv("版本占位", "V1.0（请按需修订）");
    infoWs.getColumn(1).width = 20;
    infoWs.getColumn(2).width = 72;
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

/**
 * 优先导出首个 Markdown 表格为 RFC4180 CSV；否则每行一列。
 * @param {string} raw
 */
function markdownToRichCsvBuffer(raw, metaIn) {
  const meta = normalizeExportMeta(metaIn);
  const tables = extractAllTables(String(raw ?? ""));
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const metaLines = [];
  const hasMeta = Boolean(
    meta.title ||
      meta.projectName ||
      meta.audience ||
      meta.purpose ||
      meta.generatedAt ||
      meta.confidentialLevel
  );
  if (hasMeta) {
    metaLines.push(["META_FIELD", "META_VALUE"].map(esc).join(","));
    if (meta.title) metaLines.push([esc("文档标题"), esc(meta.title)].join(","));
    const pu = meta.purpose || meta.projectName;
    if (pu) metaLines.push([esc("项目或用途"), esc(pu)].join(","));
    if (meta.audience) metaLines.push([esc("受众"), esc(meta.audience)].join(","));
    const cz = confidentialZhShort(meta);
    if (cz) metaLines.push([esc("保密级别"), esc(cz)].join(","));
    metaLines.push([esc("导出时间"), esc(formatZhTimestamp(meta.generatedAt))].join(","));
    metaLines.push([esc(""), esc("")].join(","));
  }
  const prefix = metaLines.length ? `${metaLines.join("\r\n")}\r\n` : "";
  let body;
  if (tables[0]) {
    body = tables[0].map((row) => row.map(esc).join(",")).join("\r\n");
  } else {
    body = String(raw ?? "")
      .split(/\r?\n/)
      .map((line) => esc(line))
      .join("\r\n");
  }
  return Buffer.from(`\ufeff${prefix}${body}`, "utf8");
}

/** UTF-8 BOM 文本，便于 Windows 记事本 / Excel 正确识别中文 */
function utf8TextWithBom(text, metaIn) {
  const meta = normalizeExportMeta(metaIn);
  const core = String(text ?? "");
  const hasDeliverableMeta = Boolean(
    meta.title ||
      meta.projectName ||
      meta.audience ||
      meta.purpose ||
      meta.generatedAt ||
      meta.confidentialLevel
  );
  if (!hasDeliverableMeta) {
    return Buffer.from(`\ufeff${core}`, "utf8");
  }
  const banner = [
    "═══════════════════════════════════════════════════════════════════",
    "  交付正文 · UTF-8（BOM）— Windows 记事本 / Excel「从文本导入」友好",
    `  文档标题：${meta.title || "（请填写）"}`,
  ];
  const pu = meta.purpose || meta.projectName;
  if (pu) banner.push(`  项目与用途：${pu}`);
  if (meta.audience) banner.push(`  受众：${meta.audience}`);
  const cz = confidentialZhShort(meta);
  if (cz) banner.push(`  保密：${cz}`);
  banner.push(`  导出时间：${formatZhTimestamp(meta.generatedAt)}`);
  banner.push(`  版本占位：V1.0（请按需修订）`);
  banner.push("═══════════════════════════════════════════════════════════════════", "");
  return Buffer.from(`\ufeff${banner.join("\r\n")}${core}`, "utf8");
}

/**
 * @param {string} raw
 * @returns {{ title: string, bullets: string[] }[]}
 */
function splitMarkdownForPptx(raw) {
  const lines = String(raw ?? "").split(/\r?\n/);
  /** @type {{ title: string, bullets: string[] }[]} */
  const slides = [];
  let title = "概要";
  /** @type {string[]} */
  const bullets = [];
  /** @type {string[]} */
  const paras = [];
  let leadH1 = true;

  function flush() {
    const src = bullets.length ? bullets.slice() : paras.slice(0, 8);
    bullets.length = 0;
    paras.length = 0;
    slides.push({
      title,
      bullets: src.length ? src.map((x) => x.slice(0, 480)) : ["（可继续用正文中的 # / ## 扩展页面）"],
    });
  }

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)\s*$/);
    const h2 = line.match(/^##\s+(.+)\s*$/);
    if (h1) {
      const t = h1[1].trim();
      if (leadH1 && slides.length === 0 && !bullets.length && !paras.length) {
        title = t;
        leadH1 = false;
        continue;
      }
      flush();
      title = t;
      continue;
    }
    if (h2) {
      flush();
      title = h2[1].trim();
      continue;
    }
    const b = line.match(/^[\-\*]\s+(.+)$/);
    if (b) {
      bullets.push(b[1].trim());
      continue;
    }
    const t = line.trim();
    if (t && !t.startsWith("|") && !t.startsWith("```") && !/^={3,}$/.test(t)) {
      paras.push(t);
    }
  }
  flush();
  return slides.length ? slides : [{ title: "演示", bullets: ["（请从 Markdown 标题与列表生成结构）"] }];
}

/**
 * Markdown → 简洁 PPTX（标题 + 要点；宜由已分章的长文生成）。
 * @param {string} raw
 * @param {Record<string, unknown>=} metaIn
 */
async function markdownToPptxBuffer(raw, metaIn) {
  const PptxGenJS = require("pptxgenjs");
  const meta = normalizeExportMeta(metaIn);
  const parts = splitMarkdownForPptx(raw);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "AI Content Studio Pro";
  const docTitle = meta.title || parts[0]?.title || "演示文稿";
  pptx.title = docTitle;

  const ts = pptx.addSlide();
  ts.addText(docTitle, {
    x: 0.45,
    y: 1.55,
    w: 9.1,
    h: 1.1,
    fontSize: 30,
    bold: true,
    color: "0f172a",
  });
  ts.addText(formatZhTimestamp(meta.generatedAt), { x: 0.45, y: 2.95, fontSize: 11, color: "64748b" });
  const cz = confidentialZhShort(meta);
  if (cz) ts.addText(cz, { x: 0.45, y: 3.35, fontSize: 11, color: "b45309", bold: true });

  const cap = 44;
  for (let i = 0; i < Math.min(parts.length, cap); i += 1) {
    const s = parts[i];
    const slide = pptx.addSlide();
    slide.addText(s.title, {
      x: 0.45,
      y: 0.35,
      w: 9.1,
      h: 0.75,
      fontSize: 22,
      bold: true,
      color: "1e293b",
    });
    const items = s.bullets.slice(0, 11).map((b) => ({ text: b, options: { bullet: true, fontSize: 15 } }));
    slide.addText(items, { x: 0.52, y: 1.1, w: 8.95, h: 4.9, valign: "top" });
  }

  const buf = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

module.exports = {
  markdownToDocxBuffer,
  markdownToRichXlsxBuffer,
  markdownToRichCsvBuffer,
  utf8TextWithBom,
  markdownToPptxBuffer,
  extractAllTables,
};
