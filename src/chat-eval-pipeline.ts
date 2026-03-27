/**
 * Shared chat-vs-metadata evaluation used by `eval_response` (MCP) and HTTP ingest.
 */

import { evalResponse } from "./eval.js";
import {
  buildResponseGenerationSpanAttributes,
  detectLanguage,
  estimateTokens,
  type ResponseMeta,
} from "./tracing.js";
import { computeRqEvalForToolCall } from "./eval-rq-scorer.js";
import type { ChatEvalResearchExport } from "../scripts/eval/chat-eval-export.js";
import { CHAT_EVAL_SCHEMA_VERSION } from "../scripts/eval/chat-eval-export.js";
import {
  getTestCaseById,
  toolForEvalResponseCompositeScore,
} from "../scripts/eval/test-cases.js";

export type ParseSourceRecordResult =
  | { ok: true; record: Record<string, string>; sourceRecordJson: string }
  | { ok: false; error: string };

/**
 * Accepts either a JSON object or a string of JSON object (MCP-style).
 * `sourceRecordJson` is what we pass to RQ subset matchers (preserves string input verbatim).
 */
export function parseSourceRecordInput(source: unknown): ParseSourceRecordResult {
  if (typeof source === "string") {
    try {
      const trimmed = source.trim();
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { ok: false, error: "source_record string must parse to a JSON object" };
      }
      const record = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
      );
      return { ok: true, record, sourceRecordJson: trimmed };
    } catch (e) {
      return {
        ok: false,
        error: `source_record JSON: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  if (source && typeof source === "object" && !Array.isArray(source)) {
    const record = Object.fromEntries(
      Object.entries(source as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    );
    return { ok: true, record, sourceRecordJson: JSON.stringify(source) };
  }

  return { ok: false, error: "source_record must be a JSON object or a JSON object string" };
}

export interface ChatEvalPipelineInput {
  sourceRecordJson: string;
  record: Record<string, string>;
  generated_text: string;
  eval_test_case_id?: string;
  mcp_client_label?: string;
  chat_session_id?: string;
  upstream_model_label?: string;
}

export interface ChatEvalPipelineRun {
  exportDoc: ChatEvalResearchExport;
  responseMeta: ResponseMeta;
}

export function runChatEvalPipeline(input: ChatEvalPipelineInput): ChatEvalPipelineRun {
  const {
    sourceRecordJson,
    record,
    generated_text,
    eval_test_case_id,
    mcp_client_label,
    chat_session_id,
    upstream_model_label,
  } = input;

  const evalResult = evalResponse(record, generated_text);
  const responseMeta = {
    ...evalResult,
    tokensGenerated: estimateTokens(generated_text),
    responseBytes: generated_text.length,
    languageDetectedResponse: detectLanguage(generated_text),
    agentSessionId: chat_session_id,
  };

  const otelSpanAttributes: Record<string, unknown> = {
    ...buildResponseGenerationSpanAttributes(responseMeta),
    "mcp.tool.name": "eval_response",
    "mcp.tool.latency_ms": 0,
    "mcp.tool.success": true,
  };

  const toolArgsForScorer: Record<string, unknown> = {
    source_record: sourceRecordJson,
    generated_text,
  };
  if (eval_test_case_id !== undefined) toolArgsForScorer.eval_test_case_id = eval_test_case_id;

  const rqPreview = computeRqEvalForToolCall({
    toolName: "eval_response",
    toolArgs: toolArgsForScorer,
    toolResult: {
      content: [{ type: "text", text: "" }],
      _span: otelSpanAttributes,
    },
    spanAttributes: otelSpanAttributes,
    latencyMs: 0,
  });

  let rqExplanation: string | null = null;
  if (!rqPreview) {
    rqExplanation =
      "No rq_metrics: pass eval_test_case_id with any id from scripts/eval/test-cases.ts " +
      "(e.g. RQ1-001–RQ1-008 for RQ1, RQ2-* for RQ2, …) to run the full composite for that benchmark, " +
      "or rely on the single canned eval_response row (RQ4-012) via exact toolArgs match.";
  } else if (!eval_test_case_id && rqPreview.match.matchStrategy !== "exact") {
    rqExplanation = `Composite scores use best-effort eval_response row match (${rqPreview.match.testCaseId}, ratio=${rqPreview.match.matchRatio.toFixed(2)}). Set eval_test_case_id explicitly for a chosen benchmark.`;
  }

  const scoringContext: ChatEvalResearchExport["scoring_context"] =
    rqPreview?.match.testCaseId
      ? (() => {
          const bc = getTestCaseById(rqPreview.match.testCaseId);
          if (!bc) return null;
          return {
            benchmark_test_case_id: bc.id,
            research_questions: [...bc.rq],
            tool_for_rq1_m3: toolForEvalResponseCompositeScore(bc),
          };
        })()
      : null;

  const exportDoc: ChatEvalResearchExport = {
    schema_version: CHAT_EVAL_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    tool: "eval_response",
    inputs: {
      source_record: record,
      generated_text,
      ...(eval_test_case_id !== undefined ? { eval_test_case_id } : {}),
      ...(mcp_client_label !== undefined ? { mcp_client_label } : {}),
      ...(chat_session_id !== undefined ? { chat_session_id } : {}),
      ...(upstream_model_label !== undefined ? { upstream_model_label } : {}),
    },
    heuristic_eval: { ...evalResult },
    otel_span_attributes: otelSpanAttributes,
    rq_metrics: rqPreview?.composite ?? null,
    rq_metrics_explanation: rqExplanation,
    scoring_context: scoringContext,
  };

  return { exportDoc, responseMeta };
}

export function buildChatEvalExport(input: ChatEvalPipelineInput): ChatEvalResearchExport {
  return runChatEvalPipeline(input).exportDoc;
}
