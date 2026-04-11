/**
 * Shared schema for `eval_response` research exports and offline replay.
 * The MCP tool returns JSON matching {@link ChatEvalResearchExport}.
 */
import { type CompositeScore, type ToolResponse } from "./metrics.js";
import { type EvalTestCase } from "./test-cases.js";
export declare const CHAT_EVAL_SCHEMA_VERSION: 1;
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
export declare function buildToolResponseForChatEval(params: {
    generatedText: string;
    otelSpanAttributes: Record<string, unknown>;
    latencyMs?: number;
}): ToolResponse;
/** Recompute {@link CompositeScore} from a saved export file (verification / notebooks). */
export declare function recompositeFromChatEvalExport(parsed: unknown): CompositeScore | null;
export declare function replayChatEvalExportFile(parsed: unknown): {
    ok: boolean;
    errors: string[];
    recomputed: CompositeScore | null;
    testCase: EvalTestCase | undefined;
};
