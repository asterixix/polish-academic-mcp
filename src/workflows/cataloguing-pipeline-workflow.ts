import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import { createMcpHandler } from "agents/mcp";
import type { Env } from "../types.js";
import { createServer } from "../server.js";
import { withToolExecutionSpan } from "../tracing.js";
import { PipelineAgent } from "../agents/pipeline-agent.js";

type PublicationClassification = {
  ukd_prefix: string | null;
  ukd_digits: string[] | null;
  rationale: string;
  confidence: number;
  open_access: boolean;
};

export type CataloguingPipelineEvent = {
  user_id: string;
  institution_query: string;
  topics: string[];
  language: "pl" | "en" | "mixed";
  bn_set?: string;
  max_items_per_job: number;
  require_open_access: boolean;
};

function extractMcpText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const maybeText = (item as Record<string, unknown>)["text"];
      if (typeof maybeText === "string") parts.push(maybeText);
    }
  }
  return parts.join("\n");
}

async function callMcpTool(env: Env, toolName: string, toolArgs: Record<string, unknown>) {
  const server = createServer(env);
  const handler = createMcpHandler(server);

  const rpc = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/call",
    params: {
      name: toolName,
      arguments: toolArgs,
    },
  };

  const request = new Request("https://local/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(rpc),
  });

  const ctx = { props: {}, waitUntil: () => {} } as unknown as ExecutionContext;
  const res = await handler(request, env, ctx);
  const json = (await res.json()) as any;
  if (json?.error) {
    throw new Error(`MCP error calling ${toolName}: ${json.error.message ?? "unknown"}`);
  }
  return json?.result as {
    content?: unknown;
    isError?: boolean;
    raw?: unknown;
  };
}

function toolNameToSourceKey(toolName: string): string | null {
  const prefix = toolName.split("_")[0];
  switch (toolName) {
    case "ruj_search":
    case "ruj_get_item":
      return "ruj";
    case "agh_search":
    case "agh_get_item":
      return "agh";
    case "amu_search":
    case "amu_get_item":
      return "amu";
    case "uafm_search":
    case "uafm_get_item":
      return "uafm";
    case "icm_search":
    case "icm_get_item":
      return "icm";
    case "bn_search_articles":
    case "bn_get_article":
      return "biblioteka_nauki";
    case "repod_search":
    case "repod_get_dataset":
      return "repod";
    case "rodbuk_search":
    case "rodbuk_get_item":
      return "rodbuk";
    case "dane_search":
    case "dane_get_dataset":
      return "dane";
    default:
      return prefix ? prefix : null;
  }
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    // Try to extract the first JSON object.
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildClassificationPrompt(input: { documentText: string; requireOpenAccess: boolean }) {
  const schema = {
    ukd_prefix: "string|null (e.g. '004' or '61')",
    ukd_digits: "string[]|null (digits after dot, if any)",
    rationale: "string (short, grounded in title/subject/abstract)",
    confidence: "number 0..1",
    open_access: "boolean (true if source indicates OA license/flag; else false)",
  };

  return [
    "You are an AI agent for academic repository curation in Poland.",
    "Task: classify the provided publication metadata into UKD categories.",
    "Rules:",
    "- Do not invent DOIs/identifiers.",
    "- If UKD is unclear, set ukd_prefix=null and confidence<0.4.",
    "- open_access must be derived from the metadata (license/open access indicators).",
    "- Output JSON ONLY. No markdown, no extra text.",
    `Expected schema: ${JSON.stringify(schema)}`,
    "",
    `require_open_access=${input.requireOpenAccess}`,
    "DOCUMENT_METADATA:",
    input.documentText,
  ].join("\n");
}

export class CataloguingPipelineWorkflow extends AgentWorkflow<PipelineAgent, CataloguingPipelineEvent> {
  // Note: Generic first param is used for the originating agent; we only need it for approval plumbing.

  async run(event: AgentWorkflowEvent<CataloguingPipelineEvent>, step: AgentWorkflowStep) {
    const payload = event.payload;
    const maxItems = payload.max_items_per_job;
    const env = this.env as unknown as Env;

    // 1) Discover base search plans.
    const discoverManifestText = await withToolExecutionSpan(
      {
        toolName: "workflow.discover_publications",
        params: {
          institution_query: payload.institution_query,
        } as Record<string, unknown>,
        fieldsRequested: [],
        fieldsReturned: [],
        tokensByField: {},
        queryTokens: 0,
      },
      async () => {
        const res = await callMcpTool(env, "pipeline_discover_publications", {
          institution_query: payload.institution_query,
          topics: payload.topics,
          language: payload.language,
          max_results_per_source: 5,
          page: 0,
        });

        const text = extractMcpText(res.content);
        return text;
      },
    );

    const discoverManifest = safeJsonParse<any>(discoverManifestText) ?? {};
    const plannedSearchCalls: Array<{ toolName: string; arguments: Record<string, unknown> }> =
      discoverManifest.planned_tool_calls ?? [];

    // 2) Execute search tool calls and collect outputs.
    const searchResults: Array<{ source: any; search_output_text: string }> = [];
    for (const c of plannedSearchCalls) {
      const toolName = c.toolName;
      const args = c.arguments;
      const result = await callMcpTool(env, toolName, args);
      const text = extractMcpText(result.content);
      const sourceKey = toolNameToSourceKey(toolName);
      if (sourceKey) {
        searchResults.push({ source: sourceKey, search_output_text: text });
      }
    }

    // 3) Plan and execute extraction tool calls.
    const extractManifestRes = await callMcpTool(env, "pipeline_extract_metadata", {
      search_results: searchResults,
      max_items: maxItems,
    });
    const extractManifestText = extractMcpText(extractManifestRes.content);
    const extractManifest = safeJsonParse<any>(extractManifestText) ?? {};
    const plannedExtractCalls: Array<{ toolName: string; arguments: Record<string, unknown> }> =
      extractManifest.planned_tool_calls ?? [];

    const documents: Array<{ source_record_json: string; document_text: string }> = [];
    for (const c of plannedExtractCalls) {
      const toolName = c.toolName;
      const args = c.arguments;
      const result = await callMcpTool(env, toolName, args);
      const text = extractMcpText(result.content);
      documents.push({
        source_record_json: text,
        document_text: text,
      });
      if (documents.length >= maxItems) break;
    }

    // 4) Classification + QC.
    const classifications: Array<{
      source_record_json: string;
      classification: PublicationClassification;
      qc_report: unknown;
      outreach_ready: boolean;
    }> = [];

    for (const d of documents.slice(0, maxItems)) {
      const classification = await classifyWithLlm(env, d.document_text, payload.require_open_access);
      const qc = await callMcpTool(env, "pipeline_quality_check", {
        source_record: d.source_record_json,
        generated_text: JSON.stringify(classification),
      });
      const qcText = extractMcpText(qc.content);
      const qcReport = safeJsonParse<unknown>(qcText) ?? qcText;

      const requiresRevision = Boolean((qcReport as any)?.requires_revision);
      const minConfidence = requiresRevision ? 0.8 : 0.6;
      const outreach_ready = classification.confidence >= minConfidence && classification.ukd_prefix !== null;
      classifications.push({ source_record_json: d.source_record_json, classification, qc_report: qcReport, outreach_ready });
    }

    // 5) Wait for human approval before generating outreach drafts.
    await this.reportProgress({
      step: "approval",
      status: "pending",
      message: `Awaiting approval for outreach (items passing QA: ${classifications.filter((c) => c.outreach_ready).length})`,
    });

    let approvedBy = "unknown";
    try {
      const approval = await this.waitForApproval<{ approvedBy: string }>(step, { timeout: "14 days" });
      approvedBy = approval?.approvedBy ?? "unknown";
    } catch {
      await this.reportProgress({ step: "approval", status: "error" });
      return {
        jobStatus: "rejected",
        approvedBy: null,
      };
    }

    // 6) Generate outreach drafts (policy-gated inside tool).
    const outreachDrafts: unknown[] = [];
    for (const item of classifications) {
      if (!item.outreach_ready) continue;

      const sourceObj = safeJsonParse<Record<string, unknown>>(item.source_record_json) ?? {};
      const classifiedRecord = {
        ...sourceObj,
        open_access: item.classification.open_access,
        ukd: item.classification.ukd_prefix,
        ukd_prefix: item.classification.ukd_prefix,
      };

      const outreach = await callMcpTool(env, "pipeline_prepare_author_outreach", {
        approval_decision: "approved",
        require_open_access: payload.require_open_access,
        outreach_language: "pl",
        classified_record: JSON.stringify({ ...classifiedRecord, approvedBy }),
      });
      const outreachText = extractMcpText(outreach.content);
      outreachDrafts.push(safeJsonParse<unknown>(outreachText) ?? outreachText);
    }

    await step.reportComplete({
      jobStatus: "completed",
      outreachDraftsCount: outreachDrafts.length,
      outreachDrafts,
    });

    return { outreachDraftsCount: outreachDrafts.length, outreachDrafts };
  }
}

async function classifyWithLlm(env: Env, documentText: string, requireOpenAccess: boolean): Promise<PublicationClassification> {
  const prompt = buildClassificationPrompt({ documentText, requireOpenAccess });

  // We use Workers AI binding directly. Exact response shape can vary; parse robustly.
  const model = "@cf/meta/llama-3.1-8b-instruct";
  const response = await (env.AI as any).run(model, { prompt });
  const rawText: string =
    (response?.response as string) ??
    (response?.text as string) ??
    (typeof response === "string" ? response : JSON.stringify(response));

  const parsed = safeJsonParse<PublicationClassification>(rawText);
  if (parsed && typeof parsed.confidence === "number") return parsed;

  // Fallback: return a conservative default.
  return {
    ukd_prefix: null,
    ukd_digits: null,
    rationale: "Unable to parse UKD classification output reliably.",
    confidence: 0.2,
    open_access: false,
  };
}

