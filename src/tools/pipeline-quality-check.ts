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
import { createJobContext, type PipelineJobContext } from "../pipeline/job-model.js";

export function registerPipelineQualityCheckTool(server: McpServer, _env: Env): void {
  server.tool(
    "pipeline_quality_check",
    [
      "Run a quality-control check for an LLM-generated classification/catalog response against an original metadata record.",
      "This is a pipeline wrapper around evalResponse()/eval_response tool logic, emitting a structured evaluation and a response-generation span.",
      "Use it as the QA agent step before any outreach/communication.",
    ].join(" "),
    {
      job_id: z.string().optional().describe("Stable pipeline job id for correlation"),
      run_id: z.string().optional().describe("Stable pipeline run id for correlation"),
      source_record: z
        .string()
        .describe('Flat JSON object of original metadata fields, e.g. {"title":"...","author":"...","ukd":"347.97"}'),
      generated_text: z
        .string()
        .describe("Full LLM-generated response text to evaluate against the source record"),
    },
    async (params) => {
      const ctx: PipelineJobContext = createJobContext({ job_id: params.job_id, run_id: params.run_id });

      return withToolExecutionSpan(
        {
          toolName: "pipeline_quality_check",
          params: {
            job_id: ctx.job_id,
            run_id: ctx.run_id,
          } as Record<string, unknown>,
          fieldsRequested: ["source_record", "generated_text"],
          fieldsReturned: ["quality_report"],
          tokensByField: {},
          queryTokens: estimateTokens(params.generated_text),
        },
        async (span) => {
          span.setAttribute("agent.role", "quality_check");
          span.setAttribute("job.id", ctx.job_id);
          span.setAttribute("job.run_id", ctx.run_id);
          span.setAttribute("pipeline.step", "quality_check");

          // Parse and normalise source_record to Record<string, string>
          let record: Record<string, string>;
          try {
            const parsed = JSON.parse(params.source_record) as unknown;
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      { job: ctx, status: "error", error: "source_record_must_be_object" },
                      null,
                      2,
                    ),
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
                  text: JSON.stringify(
                    {
                      job: ctx,
                      status: "error",
                      error: `source_record_parse_error: ${e instanceof Error ? e.message : String(e)}`,
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          const evalResult = evalResponse(record, params.generated_text);
          const requiresRevision =
            evalResult.hallucinationDetected ||
            evalResult.driftDirection === "shifted" ||
            evalResult.abstractExpanded === true ||
            evalResult.abstractTruncated === true ||
            evalResult.subjectGeneralized === true;

          // Policy/audit visibility at the tool-execution span level.
          span.setAttribute("quality.requires_revision", requiresRevision);
          span.setAttribute("quality.fidelity_score", evalResult.fidelityScore);
          span.setAttribute("quality.hallucination_detected", evalResult.hallucinationDetected);
          span.setAttribute("quality.hallucination_type", evalResult.hallucinationType);
          span.setAttribute("quality.drift_direction", evalResult.driftDirection ?? "none");

          try {
            return await withResponseGenerationSpan(
              {
                ...evalResult,
                tokensGenerated: estimateTokens(params.generated_text),
                responseBytes: params.generated_text.length,
                languageDetectedResponse: detectLanguage(params.generated_text),
              },
              async () => ({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        job: ctx,
                        status: "ok",
                        quality_report: evalResult,
                        requires_revision: requiresRevision,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              }),
            );
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error emitting quality-check eval span: ${e instanceof Error ? e.message : String(e)}`,
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

