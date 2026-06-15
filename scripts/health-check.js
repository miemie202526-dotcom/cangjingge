/**
 * 本地健康检查：校验主进程依赖模块可加载、清单字段完整。
 * 用法：npm run check
 */
/* eslint-disable no-console */
const path = require("path");
const root = path.join(__dirname, "..");

function fail(msg) {
  console.error("[health-check]", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("[health-check]", msg);
}

let openaiExports;
try {
  openaiExports = require(path.join(root, "openaiStructuredClient.js"));
  ok("openaiStructuredClient.js");
} catch (e) {
  fail(`openaiStructuredClient: ${e.message}`);
}
let getDesktopManifest;
try {
  ({ getDesktopManifest } = require(path.join(root, "electron", "desktop-manifest.js")));
} catch (e) {
  fail(`desktop-manifest: ${e.message}`);
}

const man = getDesktopManifest();
if (!Array.isArray(man.analysisModeOptions) || man.analysisModeOptions.length < 5) {
  fail("manifest.analysisModeOptions missing or too short");
}
if (!Array.isArray(man.analysisDepthOptions) || !man.analysisDepthOptions.length) {
  fail("manifest.analysisDepthOptions missing");
}
if (!Array.isArray(man.documentGenTypeOptions) || man.documentGenTypeOptions.length < 5) {
  fail("manifest.documentGenTypeOptions missing or too short");
}
if (!man.pages?.dashboard?.storageLine) {
  fail("manifest.pages.dashboard.storageLine missing");
}
if (!Array.isArray(man.generatorExportOptions) || man.generatorExportOptions.length < 5) {
  fail("manifest.generatorExportOptions missing or too short");
}
if (!String(man.pages?.generator?.exportFormatGuide || "").trim()) {
  fail("manifest.pages.generator.exportFormatGuide missing");
}
if (!String(man.pages?.analysis?.exportTabBlurb || "").trim()) {
  fail("manifest.pages.analysis.exportTabBlurb missing");
}
if (!String(man.pages?.phrasebook?.title || "").trim()) {
  fail("manifest.pages.phrasebook.title missing");
}
if (!String(man.chrome?.nav?.phrasebook || "").trim()) {
  fail("manifest.chrome.nav.phrasebook missing");
}
ok("desktop-manifest fields");

try {
  const erf = require(path.join(root, "electron", "export-rich-formats.js"));
  if (typeof erf.markdownToDocxBuffer !== "function") {
    fail("export-rich-formats.markdownToDocxBuffer not a function");
  }
  if (typeof erf.markdownToRichXlsxBuffer !== "function") {
    fail("export-rich-formats.markdownToRichXlsxBuffer not a function");
  }
  ok("export-rich-formats.js");
} catch (e) {
  fail(`export-rich-formats: ${e.message}`);
}

try {
  require(path.join(root, "electron", "file-capabilities.js"));
  ok("file-capabilities.js");
} catch (e) {
  fail(`file-capabilities: ${e.message}`);
}

ok("all checks passed");
