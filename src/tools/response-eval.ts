/**
 * Response evaluation tool — wires src/eval.ts into the live request pipeline.
 *
 * Call `eval_response` after generating a response about any catalog record
 * to emit hallucination markers, classification drift, and language quality
 * spans to Honeycomb (RQ2 data collection).
 *
 * The LLM agent submits:
 *   source_record  — original metadata as a flat JSON object
 *   generated_text — the response text to evaluate
 *
 * The tool runs evalResponse() and emits a withResponseGenerationSpan so
 * every evaluation is captured as a structured OTel span.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { evalResponse } from "../eval.js";
import {
  withResponseGenerationSpan,
  estimateTokens,
  detectLanguage,
} from "../tracing.js";
import { withToolExecutionSpan } from "../tracing.js";

export function registerEvalTools(server: McpServer, _env: Env): void {
  server.tool(
    "eval_response",
    [
      "Evaluate an LLM-generated response against the original bibliographic metadata record.",
      "Submit source_record as a flat JSON object (field → value) and generated_text as the full response.",
      "Returns hallucination markers, classification drift (UKD), language quality flags,",
      "and a fidelity score. Also emits a structured OTel span for research data collection (RQ2).",
      "Call this after generating a response about any catalog record retrieved via the other tools.",
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
    },
    async ({ source_record, generated_text }) => {
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
          // Parse and normalise source_record to Record<string, string>
          let record: Record<string, string>;
          try {
            const parsed = JSON.parse(source_record) as unknown;
            if (
              typeof parsed !== "object" ||
              parsed === null ||
              Array.isArray(parsed)
            ) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Error: source_record must be a JSON object",
                  },
                ],
                isError: true,
              };
            }
            record = Object.fromEntries(
              Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
            );
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error parsing source_record: ${e instanceof Error ? e.message : String(e)}`,
                },
              ],
              isError: true,
            };
          }

          const evalResult = evalResponse(record, generated_text);

          try {
            return await withResponseGenerationSpan(
              {
                ...evalResult,
                tokensGenerated: estimateTokens(generated_text),
                responseBytes: generated_text.length,
                languageDetectedResponse: detectLanguage(generated_text),
              },
              async () => ({
                content: [
                  { type: "text", text: JSON.stringify(evalResult, null, 2) },
                ],
              }),
            );
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error emitting eval span: ${e instanceof Error ? e.message : String(e)}`,
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
