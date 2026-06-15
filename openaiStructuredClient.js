/**
 * OpenAI structured output client.
 *
 * Security note:
 * - The API key is accepted per request and used only in-memory.
 * - The key is never written to disk, logs, environment variables, or module state.
 */

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

/**
 * @typedef {Object} TableRow
 * @property {string} label
 * @property {string|number|boolean|null} value
 * @property {string|null} note
 */

/**
 * @typedef {Object} StructuredResult
 * @property {string} text
 * @property {{
 *  executiveSummary: string,
 *  keyInsights: string,
 *  riskAnalysis: string,
 *  growthOpportunities: string
 * }} sections
 * @property {TableRow[]} table
 * @property {string} summary
 */

/**
 * @param {unknown} payload
 * @returns {StructuredResult}
 */
function validateStructuredPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Model output is not an object.");
  }

  const maybe = /** @type {Record<string, unknown>} */ (payload);

  if (typeof maybe.text !== "string") {
    throw new Error("Model output missing string field: text");
  }
  if (typeof maybe.summary !== "string") {
    throw new Error("Model output missing string field: summary");
  }
  if (!maybe.sections || typeof maybe.sections !== "object") {
    throw new Error("Model output missing object field: sections");
  }
  if (!Array.isArray(maybe.table)) {
    throw new Error("Model output missing array field: table");
  }

  const sections = /** @type {Record<string, unknown>} */ (maybe.sections);
  const sectionKeys = [
    "executiveSummary",
    "keyInsights",
    "riskAnalysis",
    "growthOpportunities",
  ];
  for (const key of sectionKeys) {
    if (typeof sections[key] !== "string") {
      throw new Error(`sections.${key} must be a string`);
    }
  }

  const table = maybe.table.map((row, idx) => {
    if (!row || typeof row !== "object") {
      throw new Error(`table[${idx}] is not an object`);
    }
    const r = /** @type {Record<string, unknown>} */ (row);
    if (typeof r.label !== "string") {
      throw new Error(`table[${idx}].label must be a string`);
    }
    const valueType = typeof r.value;
    const validValue =
      r.value === null ||
      valueType === "string" ||
      valueType === "number" ||
      valueType === "boolean";
    if (!validValue) {
      throw new Error(`table[${idx}].value must be string|number|boolean|null`);
    }
    const noteValid = r.note === null || typeof r.note === "string";
    if (!noteValid) {
      throw new Error(`table[${idx}].note must be string|null`);
    }
    return /** @type {TableRow} */ ({
      label: r.label,
      value: /** @type {string|number|boolean|null} */ (r.value),
      note: /** @type {string|null} */ (r.note),
    });
  });

  return {
    text: maybe.text,
    sections: {
      executiveSummary: /** @type {string} */ (sections.executiveSummary),
      keyInsights: /** @type {string} */ (sections.keyInsights),
      riskAnalysis: /** @type {string} */ (sections.riskAnalysis),
      growthOpportunities: /** @type {string} */ (sections.growthOpportunities),
    },
    table,
    summary: maybe.summary,
  };
}

/**
 * Sends input data + prompt to OpenAI and returns structured output:
 * { text, table, summary }.
 *
 * @param {Object} args
 * @param {string} args.apiKey - User-provided OpenAI API key (required).
 * @param {string} args.prompt - Instruction prompt for the model.
 * @param {unknown} args.data - Input payload to analyze.
 * @param {string=} args.model - Optional model name. Defaults to gpt-4.1-mini.
 * @returns {Promise<StructuredResult>}
 */
async function runStructuredAnalysis({ apiKey, prompt, data, model = "gpt-4.1-mini" }) {
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("A valid apiKey string is required.");
  }
  if (!prompt || typeof prompt !== "string") {
    throw new Error("A valid prompt string is required.");
  }

  const body = {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "Return only valid JSON matching the schema exactly.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Prompt:\n${prompt}\n\nData:\n${JSON.stringify(data, null, 2)}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "analysis_result",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["text", "sections", "table", "summary"],
          properties: {
            text: {
              type: "string",
              description: "Full readable analysis paragraph(s).",
            },
            sections: {
              type: "object",
              additionalProperties: false,
              required: [
                "executiveSummary",
                "keyInsights",
                "riskAnalysis",
                "growthOpportunities",
              ],
              properties: {
                executiveSummary: { type: "string" },
                keyInsights: { type: "string" },
                riskAnalysis: { type: "string" },
                growthOpportunities: { type: "string" },
              },
            },
            table: {
              type: "array",
              description: "Key-value rows for important facts.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "value", "note"],
                properties: {
                  label: { type: "string" },
                  value: { type: ["string", "number", "boolean", "null"] },
                  note: { type: ["string", "null"] },
                },
              },
            },
            summary: {
              type: "string",
              description: "Short summary of the result.",
            },
          },
        },
      },
    },
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errText}`);
  }

  const json = await response.json();
  const textPayload =
    json?.output?.[0]?.content?.[0]?.text ||
    json?.output_text ||
    json?.output?.find?.((item) => item?.type === "message")?.content?.[0]?.text;
  if (typeof textPayload !== "string") {
    throw new Error("Unexpected OpenAI response shape: missing output text.");
  }

  let parsed;
  try {
    parsed = JSON.parse(textPayload);
  } catch {
    throw new Error("Model returned invalid JSON.");
  }

  return validateStructuredPayload(parsed);
}

/**
 * @param {Object} args
 * @param {string} args.apiKey
 * @param {string} args.instruction
 * @param {string} args.sourceFileName
 * @param {string} args.sourceContent
 * @param {string=} args.model
 * @returns {Promise<{fileName: string, content: string, summary: string}>}
 */
async function generateFileFromInstruction({
  apiKey,
  instruction,
  sourceFileName,
  sourceContent,
  model = "gpt-4.1-mini",
}) {
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("A valid apiKey string is required.");
  }
  if (!instruction || typeof instruction !== "string") {
    throw new Error("A valid instruction string is required.");
  }
  if (!sourceFileName || typeof sourceFileName !== "string") {
    throw new Error("A valid sourceFileName string is required.");
  }
  if (typeof sourceContent !== "string") {
    throw new Error("A valid sourceContent string is required.");
  }

  const body = {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are a partner-level consultant and business writer. Return ONLY strict JSON. " +
              "The `content` field MUST be professional, client-ready Markdown. Default language: Simplified Chinese unless the user explicitly requests English. " +
              "ABSOLUTE MINIMUM length: **at least 4000 Chinese characters** for generic documents; **at least 5200 Chinese characters** if the instruction mentions 商业计划书 or business plan or gen type bp. " +
              "If below minimum, you failed: expand every section with paragraphs, numbered lists, and multiple ### subsections (each subsection at least 2 paragraphs). " +
              "Mandatory top-level sections (adapt titles if user asks otherwise): # 标题, ## 背景, ## 目标, ## 核心内容, ## 详细方案, ## 风险与应对, ## 执行步骤, ## 时间线, ## 结论; for business plans also include: 执行摘要, 市场与规模, 产品与研发, 商业模式, 竞争分析, 营销与销售, 运营与里程碑, 团队, 财务预测, 融资与用途, 附录. " +
              "Include **at least 3 Markdown tables** in business plans (market sizing, financial summary, milestones, etc.). No one-line chapter stubs; no empty bullets. " +
              "Ban hollow placeholders such as 「示例」「样板」「待补充」「TBD」「XXX」「此处填写」without substantive prose in the same paragraph/table cell; numbers and dates must read as coherent sentences if fictional.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Instruction:\n${instruction}\n\nSource file name:\n${sourceFileName}\n\nSource content:\n${sourceContent}\n\n【再次强调】返回 JSON 的 content 字段必须是**长文**完整 Markdown；禁止输出不足字数限制的简版或提纲。商业计划书类须 **≥5200 汉字**；其他类型须 **≥4000 汉字**（除非用户明确要求更短）。`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "generated_file_result",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["fileName", "content", "summary"],
          properties: {
            fileName: { type: "string" },
            content: {
              type: "string",
              description:
                "Full Markdown body; Simplified Chinese; minimum ~4000 Han characters for normal docs and ~5200 for business plans (bp); multiple tables and ### subsections required.",
            },
            summary: { type: "string" },
          },
        },
      },
    },
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errText}`);
  }

  const json = await response.json();
  const textPayload =
    json?.output?.[0]?.content?.[0]?.text ||
    json?.output_text ||
    json?.output?.find?.((item) => item?.type === "message")?.content?.[0]?.text;
  if (typeof textPayload !== "string") {
    throw new Error("Unexpected OpenAI response shape: missing output text.");
  }

  let parsed;
  try {
    parsed = JSON.parse(textPayload);
  } catch {
    throw new Error("Model returned invalid JSON.");
  }

  const maybe = /** @type {Record<string, unknown>} */ (parsed);
  if (
    typeof maybe.fileName !== "string" ||
    typeof maybe.content !== "string" ||
    typeof maybe.summary !== "string"
  ) {
    throw new Error("Generated file output missing required string fields.");
  }

  return {
    fileName: maybe.fileName,
    content: maybe.content,
    summary: maybe.summary,
  };
}

/**
 * @param {Object} args
 * @param {string} args.apiKey
 * @param {string} args.instruction
 * @param {string} args.sourceContent
 * @param {string=} args.model
 * @returns {Promise<{title: string, content: string, summary: string}>}
 */
async function runCreativeTask({
  apiKey,
  instruction,
  sourceContent,
  model = "gpt-4.1-mini",
}) {
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("A valid apiKey string is required.");
  }
  if (!instruction || typeof instruction !== "string") {
    throw new Error("A valid instruction string is required.");
  }

  const body = {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are a content creator assistant. Return only strict JSON matching the schema.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `User instruction:\n${instruction}\n\nSource content:\n${sourceContent || "(none)"}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "creative_task_result",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["title", "content", "summary"],
          properties: {
            title: { type: "string" },
            content: { type: "string" },
            summary: { type: "string" },
          },
        },
      },
    },
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errText}`);
  }
  const json = await response.json();
  const textPayload =
    json?.output?.[0]?.content?.[0]?.text ||
    json?.output_text ||
    json?.output?.find?.((item) => item?.type === "message")?.content?.[0]?.text;
  if (typeof textPayload !== "string") {
    throw new Error("Unexpected OpenAI response shape: missing output text.");
  }
  let parsed;
  try {
    parsed = JSON.parse(textPayload);
  } catch {
    throw new Error("Model returned invalid JSON.");
  }
  const maybe = /** @type {Record<string, unknown>} */ (parsed);
  if (
    typeof maybe.title !== "string" ||
    typeof maybe.content !== "string" ||
    typeof maybe.summary !== "string"
  ) {
    throw new Error("Creative output missing required fields.");
  }
  return {
    title: maybe.title,
    content: maybe.content,
    summary: maybe.summary,
  };
}

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

/**
 * OCR / extract visible text from an image using a vision-capable model.
 */
async function ocrImageWithVision({
  apiKey,
  imageBase64,
  mimeType = "image/png",
  model = "gpt-4o-mini",
}) {
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("A valid apiKey string is required for image OCR.");
  }
  const body = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe all visible text in this image. Output plain text only, preserve reading order. If no text, reply exactly: (no text detected)" },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
        ],
      },
    ],
    max_tokens: 4096,
  };
  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI Vision error (${response.status}): ${errText}`);
  }
  const json = await response.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error("Unexpected vision response shape.");
  }
  return { text: text.trim() };
}

const ANALYSIS_MODE_HINTS = {
  business: "Strategy consulting: market position, economics of the business, growth levers, org implications.",
  finance: "CFO-style: P&L, cash flow, working capital, unit economics, ratios, bridge analyses.",
  investment: "Investment committee memo: thesis, scenarios, returns, risks, catalysts, diligence questions.",
  contract: "Contract review: parties, obligations, liability caps, termination, IP, confidentiality, dispute clauses.",
  market: "Market sizing TAM/SAM/SOM, segments, trends, pricing, channels, regulatory context.",
  competitor: "Competitive landscape: positioning map, feature comparison, moats, switching costs, win/loss patterns.",
  risk: "Enterprise risk: operational, financial, legal, reputational, cyber; likelihood/impact framing.",
  data: "Quantitative data insight: distributions, cohorts, anomalies, seasonality, KPI trees, data quality caveats.",
  ops: "Operations diagnosis: process bottlenecks, SLA adherence, capacity, cost structure, automation opportunities.",
  diligence: "Due diligence checklist style: red flags, verification steps, missing data, expert calls to schedule.",
  feasibility: "Project feasibility: NPV-style reasoning, dependencies, go/no-go criteria, pilot design.",
  strategy: "Corporate strategy: where-to-play, how-to-win, capability gaps, portfolio moves, sequencing.",
  persona: "B2B/B2C customer persona: jobs-to-be-done, pains, gains, buying committee, objections, triggers.",
  marketing: "Go-to-market: positioning, messaging house, channels, funnel metrics, campaign hooks.",
  legal_risk: "Legal risk memo: exposure areas, statutes/regulations referenced generically, escalation paths.",
  table_data: "Table-heavy document analysis: reconcile totals, spot outliers, suggest pivot views and controls.",
  team_ops:
    "Team operations: workload, capacity, utilization, bottlenecks; spreadsheet-ready KPI recommendations.",
  metrics_schema:
    "Metrics & schema design: dimensions, grain, owners, refresh cadence, sample rows for BI/Excel.",
  summary: "Executive summary mode: compress to decision-ready bullets with trade-offs.",
  custom: "Follow the user's custom instruction strictly.",
};

const ANALYSIS_DEPTH_HINTS = {
  quick:
    "DEPTH=QUICK: shorter subsections, fewer tables, still fill every JSON field with concrete bullets (no placeholders like TBD).",
  standard:
    "DEPTH=STANDARD: consulting-grade structure, 2–3 levels of headings in mainReport, quantitative placeholders where data absent.",
  deep: "DEPTH=DEEP: exhaustive sub-analysis, sensitivity views, cross-checks against document evidence, long-form mainReport.",
  investor:
    "DEPTH=INVESTOR_MEMO: IC-ready tone, explicit thesis/antithesis, scenarios (base/downside), returns logic, diligence asks.",
};

/** 控制输入长度与 max_output_tokens：快速模式优先降低首包延迟 */
const WORKSPACE_DEPTH_RESOURCES = {
  quick: { docChars: 42_000, maxOutputTokens: 3200 },
  standard: { docChars: 88_000, maxOutputTokens: 5600 },
  deep: { docChars: 120_000, maxOutputTokens: 9000 },
  investor: { docChars: 120_000, maxOutputTokens: 9000 },
};

/** Decision toolkit nested schema (strict: all fields required). */
const DECISION_TOOLKIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "fileHealthSummary",
    "missingInfo",
    "dataQualityNotes",
    "inferredDocTypes",
    "recommendedModes",
    "extractedSignals",
    "swotStrengths",
    "swotWeaknesses",
    "swotOpportunities",
    "swotThreats",
    "pestPolitical",
    "pestEconomic",
    "pestSocial",
    "pestTechnological",
    "riskMatrixLines",
    "actionOwnersLines",
    "mgmtBrief",
    "investorBrief",
    "legalRiskBrief",
    "financeBrief",
    "scriptBoss",
    "scriptClient",
    "scriptInvestor",
  ],
  properties: {
    fileHealthSummary: { type: "string", description: "Completeness and parsing quality in Chinese prose." },
    missingInfo: { type: "array", items: { type: "string" }, description: "Critical missing inputs or data gaps." },
    dataQualityNotes: { type: "string", description: "Data quality, consistency, caveats." },
    inferredDocTypes: { type: "array", items: { type: "string" }, description: "Inferred document categories." },
    recommendedModes: { type: "array", items: { type: "string" }, description: "Suggested analysis mode keys/labels." },
    extractedSignals: {
      type: "array",
      items: { type: "string" },
      description: "Key numbers, dates, parties, amounts, risky clauses (Chinese lines).",
    },
    swotStrengths: { type: "array", items: { type: "string" } },
    swotWeaknesses: { type: "array", items: { type: "string" } },
    swotOpportunities: { type: "array", items: { type: "string" } },
    swotThreats: { type: "array", items: { type: "string" } },
    pestPolitical: { type: "array", items: { type: "string" } },
    pestEconomic: { type: "array", items: { type: "string" } },
    pestSocial: { type: "array", items: { type: "string" } },
    pestTechnological: { type: "array", items: { type: "string" } },
    riskMatrixLines: {
      type: "array",
      items: { type: "string" },
      description: "Each line: 风险 | 等级 | 影响 | 概率 | 应对",
    },
    actionOwnersLines: {
      type: "array",
      items: { type: "string" },
      description: "Each line: 行动 | 负责人角色 | 优先级 | 预计时间 | 步骤",
    },
    mgmtBrief: { type: "string", description: "1-page management digest." },
    investorBrief: { type: "string", description: "Investor-facing digest." },
    legalRiskBrief: { type: "string", description: "Legal risk highlights." },
    financeBrief: { type: "string", description: "Finance highlights." },
    scriptBoss: { type: "string", description: "Copy-ready script for leadership." },
    scriptClient: { type: "string", description: "Copy-ready script for client." },
    scriptInvestor: { type: "string", description: "Copy-ready script for investors." },
  },
};

/** JSON schema for consulting-grade workspace insight (strict mode: every property required). */
const WORKSPACE_INSIGHT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "executiveSummary",
    "coreConclusions",
    "dataInsights",
    "opportunities",
    "risks",
    "issueList",
    "recommendations",
    "actionPlan",
    "priorities",
    "nextSteps",
    "talkingPoints",
    "mainReport",
    "summary",
    "keyPoints",
    "actions",
    "suggestedExports",
    "decisionToolkit",
  ],
  properties: {
    executiveSummary: { type: "string", description: "Executive summary, decision-ready." },
    coreConclusions: { type: "array", items: { type: "string" } },
    dataInsights: { type: "string", description: "Evidence-based quantitative or qualitative insights." },
    opportunities: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    issueList: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
    actionPlan: { type: "array", items: { type: "string" } },
    priorities: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } },
    talkingPoints: { type: "string", description: "Ready-to-use talking points for email or verbal update." },
    mainReport: { type: "string", description: "Full Markdown report with ## sections, lists, optional tables." },
    summary: { type: "string" },
    keyPoints: { type: "array", items: { type: "string" } },
    actions: { type: "array", items: { type: "string" } },
    suggestedExports: {
      type: "array",
      items: { type: "string", enum: ["txt", "md", "docx", "pdf", "csv", "xlsx"] },
    },
    decisionToolkit: DECISION_TOOLKIT_SCHEMA,
  },
};

/**
 * @param {Record<string, unknown>} m
 */
function normalizeDecisionToolkit(raw) {
  const arr = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const str = (v) => (typeof v === "string" ? v : "");
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  return {
    fileHealthSummary: str(o.fileHealthSummary),
    missingInfo: arr(o.missingInfo),
    dataQualityNotes: str(o.dataQualityNotes),
    inferredDocTypes: arr(o.inferredDocTypes),
    recommendedModes: arr(o.recommendedModes),
    extractedSignals: arr(o.extractedSignals),
    swotStrengths: arr(o.swotStrengths),
    swotWeaknesses: arr(o.swotWeaknesses),
    swotOpportunities: arr(o.swotOpportunities),
    swotThreats: arr(o.swotThreats),
    pestPolitical: arr(o.pestPolitical),
    pestEconomic: arr(o.pestEconomic),
    pestSocial: arr(o.pestSocial),
    pestTechnological: arr(o.pestTechnological),
    riskMatrixLines: arr(o.riskMatrixLines),
    actionOwnersLines: arr(o.actionOwnersLines),
    mgmtBrief: str(o.mgmtBrief),
    investorBrief: str(o.investorBrief),
    legalRiskBrief: str(o.legalRiskBrief),
    financeBrief: str(o.financeBrief),
    scriptBoss: str(o.scriptBoss),
    scriptClient: str(o.scriptClient),
    scriptInvestor: str(o.scriptInvestor),
  };
}

function normalizeWorkspaceInsight(m) {
  const arr = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const str = (v) => (typeof v === "string" ? v : "");
  const ex = arr(m.suggestedExports);
  const exportsOk = ex.length ? ex : ["md", "docx", "pdf"];
  const decisionToolkit = normalizeDecisionToolkit(m.decisionToolkit);
  return {
    executiveSummary: str(m.executiveSummary),
    coreConclusions: arr(m.coreConclusions),
    dataInsights: str(m.dataInsights),
    opportunities: arr(m.opportunities),
    risks: arr(m.risks),
    issueList: arr(m.issueList),
    recommendations: arr(m.recommendations),
    actionPlan: arr(m.actionPlan),
    priorities: arr(m.priorities),
    nextSteps: arr(m.nextSteps),
    talkingPoints: str(m.talkingPoints),
    mainReport: str(m.mainReport),
    summary: str(m.summary),
    keyPoints: arr(m.keyPoints),
    actions: arr(m.actions),
    suggestedExports: exportsOk,
    decisionToolkit,
  };
}

/**
 * Full workspace analysis with structured insight panel fields.
 */
async function runWorkspaceInsightAnalysis({
  apiKey,
  mode = "business",
  userInstruction = "",
  documentText,
  model = "gpt-4.1-mini",
  depth = "standard",
}) {
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("A valid apiKey string is required.");
  }
  const modeHint = ANALYSIS_MODE_HINTS[mode] || ANALYSIS_MODE_HINTS.business;
  const depthKey = typeof depth === "string" && depth in ANALYSIS_DEPTH_HINTS ? depth : "standard";
  const depthHint = ANALYSIS_DEPTH_HINTS[depthKey];
  const resCfg = WORKSPACE_DEPTH_RESOURCES[depthKey] || WORKSPACE_DEPTH_RESOURCES.standard;
  const doc = typeof documentText === "string" ? documentText : "";
  const userInst = typeof userInstruction === "string" ? userInstruction : "";
  const docSlice = doc.slice(0, resCfg.docChars);
  const docTail = doc.length > resCfg.docChars ? "\n\n[...truncated]" : "";

  const body = {
    model,
    max_output_tokens: resCfg.maxOutputTokens,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `You are a partner-level management consultant. Write in professional Chinese unless the user explicitly requests another language.
Analysis style: ${modeHint}
Output discipline: Return ONLY valid JSON matching the schema. No markdown fences outside JSON.
Every top-level array field (coreConclusions, opportunities, risks, issueList, recommendations, actionPlan, priorities, nextSteps, keyPoints, actions) must contain at least 4 substantive items (no "TBD", no empty strings).
decisionToolkit: fill every nested array with at least 3 substantive Chinese lines each; string fields must be substantive prose (not placeholders).
decisionToolkit must reflect the actual document: fileHealthSummary assesses completeness/parsing; missingInfo lists critical gaps; extractedSignals lists key numbers, dates, company/person names, amounts, risky clauses found or honestly noted as absent.
mainReport must be long-form Markdown with multiple ## sections including dedicated ## SWOT分析 ## PEST分析 ## 风险矩阵 ## 行动清单（负责人） mirroring decisionToolkit content, plus ### subsections, bullet lists, and tables where helpful.
Also populate executiveSummary, dataInsights, and talkingPoints as polished prose.
Mirror key themes into keyPoints, risks, and actions for dashboard widgets.`,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Depth profile:\n${depthHint}\n\nUser instruction:\n${userInst || "(none)"}\n\nDocument:\n${docSlice}${docTail}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "workspace_insight",
        strict: true,
        schema: WORKSPACE_INSIGHT_SCHEMA,
      },
    },
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errText}`);
  }
  const json = await response.json();
  const textPayload =
    json?.output?.[0]?.content?.[0]?.text ||
    json?.output_text ||
    json?.output?.find?.((item) => item?.type === "message")?.content?.[0]?.text;
  if (typeof textPayload !== "string") {
    throw new Error("Unexpected OpenAI response shape: missing output text.");
  }
  let parsed;
  try {
    parsed = JSON.parse(textPayload);
  } catch {
    throw new Error("Model returned invalid JSON.");
  }
  const m = /** @type {Record<string, unknown>} */ (parsed);
  if (typeof m.mainReport !== "string" || typeof m.summary !== "string") {
    throw new Error("Insight output missing mainReport or summary.");
  }
  return normalizeWorkspaceInsight(m);
}

module.exports = {
  runStructuredAnalysis,
  generateFileFromInstruction,
  runCreativeTask,
  ocrImageWithVision,
  runWorkspaceInsightAnalysis,
};
