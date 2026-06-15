/**
 * 轻量导出封装（主进程 save-generated-file）。
 * 复杂格式（含交付元数据、HTML 预渲染等）由各页直接调用 ipc.saveGeneratedFile。
 */

export async function exportTextFile(ipc, { format, content, suggestedName }) {
  const fmt = format === "md" ? "md" : "txt";
  const name = suggestedName || `export.${fmt}`;
  return ipc.saveGeneratedFile({ suggestedName: name, content: String(content ?? ""), format: fmt });
}

export async function exportDocx(ipc, { content, suggestedName }) {
  return ipc.saveGeneratedFile({
    suggestedName: suggestedName || "export.docx",
    content: String(content ?? ""),
    format: "docx",
  });
}

export async function exportPdf(ipc, { content, suggestedName }) {
  return ipc.saveGeneratedFile({
    suggestedName: suggestedName || "export.pdf",
    content: String(content ?? ""),
    format: "pdf",
  });
}
