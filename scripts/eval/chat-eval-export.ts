/**
 * Shared schema for `eval_response` research exports and offline replay.
 * The MCP tool returns JSON matching {@link ChatEvalResearchExport}.
 */

import {
  computeCompositeScore,
  type CompositeScore,
  type ToolResponse,
} from "./metrics.js";
import {
  getTestCaseById,
  toolForEvalResponseCompositeScore,
  type EvalTestCase,
} from "./test-cases.js";

export const CHAT_EVAL_SCHEMA_VERSION = 1 as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface ChatEvalResearchExport {
  schema_version: typeof CHAT_EVAL_SCHEMA_VERSION;
  exported_at: string;
  tool: "eval_response";
  inputs: {
    source_record: Record<string, string>;
    generated_text: string;
    /**
     * Any `id` from `ALL_TEST_CASES` (e.g. `RQ1-001`, `RQ2-004`, `RQ4-012`).
     * For catalog benchmarks, RQ1-M3 uses that row's catalog tool, not `eval_response`.
     */
    eval_test_case_id?: string;
    /** MCP host client (e.g. Cursor, Claude Desktop). */
    mcp_client_label?: string;
    /** Correlation id for a chat session / turn. */
    chat_session_id?: string;
    /** Optional: LLM that produced `generated_text` (not the MCP server). */
    upstream_model_label?: string;
  };
  /** Output of `src/eval.ts` `evalResponse()` (heuristic RQ2 signals). */
  heuristic_eval: Record<string, unknown>;
  /**
   * Same keys as OTel `llm.response` span; consumed by `scripts/eval/metrics.ts`
   * for RQ1–RQ4 scoring when paired with `inputs.eval_test_case_id`.
   */
  otel_span_attributes: Record<string, unknown>;
  /** RQ-aligned composite scores when a matching eval test case is selected. */
  rq_metrics: CompositeScore | null;
  /** Human-readable reason when `rq_metrics` is null. */
  rq_metrics_explanation: string | null;
  /** How the benchmark row maps into `computeCompositeScore` (when `rq_metrics` is present). */
  scoring_context: {
    benchmark_test_case_id: string;
    research_questions: string[];
    tool_for_rq1_m3: string;
  } | null;
}

export function buildToolResponseForChatEval(params: {
  generatedText: string;
  otelSpanAttributes: Record<string, unknown>;
  latencyMs?: number;
}): ToolResponse {
  const { generatedText, otelSpanAttributes, latencyMs = 0 } = params;
  return {
    raw: { kind: "chat_eval_synthetic" },
    text: generatedText,
    latencyMs,
    statusCode: 200,
    spanAttributes: otelSpanAttributes,
  };
}

/** Recompute {@link CompositeScore} from a saved export file (verification / notebooks). */
export function recompositeFromChatEvalExport(
  parsed: unknown,
): CompositeScore | null {
  if (!isPlainObject(parsed)) return null;
  const inputs = parsed["inputs"];
  if (!isPlainObject(inputs)) return null;
  const caseId = inputs["eval_test_case_id"];
  if (typeof caseId !== "string") return null;
  const tc = getTestCaseById(caseId);
  if (!tc) return null;

  const gen = inputs["generated_text"];
  if (typeof gen !== "string") return null;

  const attrs = parsed["otel_span_attributes"];
  if (!isPlainObject(attrs)) return null;

  const toolResponse = buildToolResponseForChatEval({
    generatedText: gen,
    otelSpanAttributes: attrs,
  });
  const selectedTool = toolForEvalResponseCompositeScore(tc);
  return computeCompositeScore(toolResponse, tc, selectedTool);
}

export function replayChatEvalExportFile(parsed: unknown): {
  ok: boolean;
  errors: string[];
  recomputed: CompositeScore | null;
  testCase: EvalTestCase | undefined;
} {
  const errors: string[] = [];
  if (!isPlainObject(parsed)) {
    return { ok: false, errors: ["root must be an object"], recomputed: null, testCase: undefined };
  }
  if (parsed.schema_version !== CHAT_EVAL_SCHEMA_VERSION) {
    errors.push(`expected schema_version ${CHAT_EVAL_SCHEMA_VERSION}`);
  }
  const inputsObj = isPlainObject(parsed.inputs) ? parsed.inputs : null;
  if (!inputsObj) {
    errors.push("inputs must be an object");
  }
  if (!isPlainObject(parsed.otel_span_attributes)) {
    errors.push("otel_span_attributes must be an object");
  }

  const caseIdRaw = inputsObj ? inputsObj["eval_test_case_id"] : undefined;
  const caseId = typeof caseIdRaw === "string" ? caseIdRaw : undefined;
  const testCase = caseId ? getTestCaseById(caseId) : undefined;
  if (caseId && !testCase) {
    errors.push(`unknown eval_test_case_id: ${caseId}`);
  }

  const recomputed = recompositeFromChatEvalExport(parsed);
  const ok = errors.length === 0;
  return { ok, errors, recomputed, testCase };
}
