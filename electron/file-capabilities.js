/**
 * 主进程「可读文件类型」的唯一数据源。
 * 新增扩展名时：在此更新集合；桌面「支持输入」文案由 buildSupportedInputsBulletZh() 自动生成。
 */

const SUPPORTED_TEXT_EXTENSIONS = new Set([
  ".txt",
  ".log",
  ".rtf",
  ".eml",
  ".md",
  ".json",
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".csv",
  ".html",
  ".css",
  ".xml",
  ".yml",
  ".yaml",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
]);

/** Electron openDialog「支持的文档」过滤器顺序（须对应 SUPPORTED_TEXT_EXTENSIONS） */
const PICK_FILE_DIALOG_EXTENSIONS = [
  "txt",
  "log",
  "rtf",
  "eml",
  "md",
  "json",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "csv",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "html",
  "css",
  "xml",
  "yml",
  "yaml",
].filter((x) => SUPPORTED_TEXT_EXTENSIONS.has(`.${x}`));

function buildSupportedInputsBulletZh() {
  const has = (ext) => SUPPORTED_TEXT_EXTENSIONS.has(`.${ext}`);
  const docOrder = ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "log", "rtf", "eml", "md", "json"];
  const codeOrder = ["js", "ts", "tsx", "jsx", "py", "html", "css", "xml", "yml", "yaml"];
  const docLike = docOrder.filter(has);
  const codeLike = codeOrder.filter(has);
  const imgs = ["png", "jpg", "jpeg", "webp", "gif", "bmp"].filter(has);
  let s = `支持输入：${docLike.join("、")}`;
  if (imgs.length) {
    s += `；图片 OCR：${imgs.join("、")}`;
  }
  if (codeLike.length) {
    s += `；常见代码与标记文本：${codeLike.join("、")}`;
  }
  if (has("xlsx")) {
    s += "。xlsx 多工作表转为带「### 工作表」标记的制表符分隔文本";
  }
  return `${s}。`;
}

module.exports = {
  SUPPORTED_TEXT_EXTENSIONS,
  PICK_FILE_DIALOG_EXTENSIONS,
  buildSupportedInputsBulletZh,
};
