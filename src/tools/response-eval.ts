import { toToolErrorText } from "../tool-error-handling.js";
/**
 * Response evaluation tool — wires src/eval.ts into the live request pipeline.
 *
 * Call `eval_response` after generating a response about any catalog record
 * to emit hallucination markers, classification drift, and language quality
 * spans to Honeycomb (RQ2 data collection).
 *
 * Returns a single JSON document ({@link ChatEvalResearchExport}) compatible with
 * `scripts/eval/metrics.ts` / `scripts/eval/chat-eval-export.ts` for offline replay.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { runChatEvalPipeline, parseSourceRecordInput } from "../chat-eval-pipeline.js";
import { withResponseGenerationSpan, estimateTokens } from "../tracing.js";
import { withToolExecutionSpan } from "../tracing.js";
export function registerEvalTools(server: McpServer, _env: Env): void {
  server.tool(
    "eval_response",
    [
      "Evaluate an LLM-generated chat response against the original bibliographic metadata record.",
      "Pass source_record as a JSON object string (field → value) and generated_text as the model answer.",
      "eval_test_case_id: optional but recommended — any id from scripts/eval/test-cases.ts (e.g. RQ1-001, RQ2-003, RQ4-012). " +
        "For catalog tools (bn_search_articles, ruj_search, …) metrics use that benchmark's RQ tags and expected tool for RQ1-M3. " +
        "RQ4-012 is the native eval_response benchmark row.",
      "Optional: mcp_client_label, chat_session_id, upstream_model_label for research provenance.",
      "Returns one JSON object (schema chat eval export) with heuristic_eval, otel_span_attributes, and rq_metrics.",
    ].join(" "),
    {
      source_record: z
        .string()
        .describe(
          'Flat JSON object of original metadata fields, e.g. {"title":"...","author":"...","ukd":"347.97"}',
        ),
      generated_text: z
        .string()
        .describe("Full LLM-generated response text to evaluate against the source record"),
      eval_test_case_id: z
        .string()
        .optional()
        .describe(
          "Benchmark id from scripts/eval/test-cases.ts — any ALL_TEST_CASES id (RQ1-001 … RQ4-012). " +
            "Aligns RQ1–RQ4 composite metrics to that scenario; use the catalog tool id implicitly for RQ1-M3.",
        ),
      mcp_client_label: z
        .string()
        .optional()
        .describe("Optional host label (e.g. Cursor, Claude Desktop) for research exports"),
      chat_session_id: z
        .string()
        .optional()
        .describe("Optional session or turn id correlating this evaluation with chat logs"),
      upstream_model_label: z
        .string()
        .optional()
        .describe(
          "Optional id of the LLM that produced generated_text (distinct from this MCP server)",
        ),
    },
    async ({
      source_record,
      generated_text,
      eval_test_case_id,
      mcp_client_label,
      chat_session_id,
      upstream_model_label,
    }) => {
      return withToolExecutionSpan(
        {
          toolName: "eval_response",
          params: {},
          fieldsRequested: [],
          fieldsReturned: [],
          tokensByField: {},
          queryTokens: estimateTokens(generated_text),
        },
        async () => {
          const parsed = parseSourceRecordInput(source_record);
          if (!parsed.ok) {
            return {
              content: [{ type: "text", text: `Error: ${parsed.error}` }],
              isError: true,
            };
          }

          const { exportDoc, responseMeta } = runChatEvalPipeline({
            sourceRecordJson: parsed.sourceRecordJson,
            record: parsed.record,
            generated_text,
            eval_test_case_id,
            mcp_client_label,
            chat_session_id,
            upstream_model_label,
          });

          try {
            return await withResponseGenerationSpan(responseMeta, async () => ({
              content: [{ type: "text", text: JSON.stringify(exportDoc, null, 2) }],
            }));
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error emitting eval span: ${toToolErrorText(e)}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
  );
}
