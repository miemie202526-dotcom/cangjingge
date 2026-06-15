import * as demo from "./demoAi.js";

export async function hasCloudCapability(ipc, sessionApiKey) {
  const k = (sessionApiKey || "").trim();
  if (k) return true;
  try {
    const st = await ipc.openaiKeyStatus();
    return Boolean(st?.hasEnvKey || st?.hasStoredKey);
  } catch {
    return false;
  }
}

/**
 * 把云端调用抛出的英文 error 摘要成中文 + 给出下一步操作建议。
 * 这样用户看到的不再是一坨 OpenAI 原始 JSON。
 */
function summarizeCloudError(err) {
  const raw = String(err?.message ?? err ?? "");
  if (/401/.test(raw) || /invalid[_\s-]?api[_\s-]?key/i.test(raw) || /Incorrect API key/i.test(raw)) {
    return "API Key 被 OpenAI 拒绝（401）。多半是 key 已被 revoke、复制时漏字符或带了掩码。请到「设置」点 🔌 测试连通 一键定位，或去 OpenAI Dashboard 重新生成 key。";
  }
  if (/429/.test(raw) || /quota/i.test(raw) || /rate[_\s-]?limit/i.test(raw)) {
    return "OpenAI 限流或额度用尽（429）。短时请求过多或账户余额为 0，需要充值/绑卡或稍后重试。";
  }
  if (/403/.test(raw) || /permission/i.test(raw)) {
    return "Key 没有调用该模型/接口的权限（403）。检查 project 是否启用了所选模型。";
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(raw)) {
    return "网络无法连接 OpenAI（DNS/超时/被拦截）。请检查代理或重试。";
  }
  if (/timeout/i.test(raw)) {
    return "请求超时。模型生成较慢或网络抖动，稍后重试。";
  }
  return raw.length > 220 ? raw.slice(0, 220) + "…" : raw;
}

export async function runAnalysis(
  ctx,
  { mode, userInstruction, documentText, model, fileNames, depth = "standard" }
) {
  const cloud = await hasCloudCapability(ctx.ipc, ctx.getApiKey());
  if (cloud) {
    try {
      return await ctx.ipc.workspaceRunAnalysis({
        apiKey: ctx.getApiKey(),
        mode,
        userInstruction,
        documentText,
        model,
        depth,
      });
    } catch (e) {
      ctx.toast(`云端分析失败，已切换 Demo：${summarizeCloudError(e)}`, true);
      return demo.demoWorkspaceAnalysis({
        documentText,
        mode,
        userInstruction,
        fileNames,
        depth,
      });
    }
  }
  ctx.toast("未配置 API Key，已使用本地 Demo 分析报告", false);
  return demo.demoWorkspaceAnalysis({ documentText, mode, userInstruction, fileNames, depth });
}

export async function runDocumentGenerate(
  ctx,
  {
    instruction,
    sourceContent,
    sourceFileName,
    model,
    genType = "文档",
    genTypeKey = "",
    tone = "专业",
    genControls = null,
  }
) {
  const cloud = await hasCloudCapability(ctx.ipc, ctx.getApiKey());
  if (cloud) {
    try {
      return await ctx.ipc.generateFile({
        apiKey: ctx.getApiKey(),
        instruction,
        sourceFileName: sourceFileName || "sources.txt",
        sourceContent: sourceContent || "",
        model,
        genTypeKey: genTypeKey || "",
        genControls,
      });
    } catch (e) {
      ctx.toast(`云端生成失败，已切换 Demo：${summarizeCloudError(e)}`, true);
      return demo.demoDocumentGeneration({
        genType,
        genTypeKey: genTypeKey || "",
        tone,
        instruction,
        sourceText: sourceContent,
        fileNames: [sourceFileName].filter(Boolean),
        genControls,
      });
    }
  }
  ctx.toast("未配置 API Key，已使用本地 Demo 文档", false);
  return demo.demoDocumentGeneration({
    genType,
    genTypeKey: genTypeKey || "",
    tone,
    instruction,
    sourceText: sourceContent,
    fileNames: [sourceFileName].filter(Boolean),
    genControls,
  });
}

export async function runPolish(ctx, { instruction, sourceContent, model }) {
  const cloud = await hasCloudCapability(ctx.ipc, ctx.getApiKey());
  if (cloud) {
    try {
      return await ctx.ipc.runCreativeTask({
        apiKey: ctx.getApiKey(),
        instruction,
        sourceContent,
        model,
      });
    } catch (e) {
      ctx.toast(`优化失败，使用本地规则：${summarizeCloudError(e)}`, true);
      return {
        title: "Polished (demo)",
        content: demo.demoPolish(sourceContent, instruction),
        summary: "本地 Demo 优化",
      };
    }
  }
  return {
    title: "Polished (demo)",
    content: demo.demoPolish(sourceContent, instruction),
    summary: "本地 Demo 优化",
  };
}

