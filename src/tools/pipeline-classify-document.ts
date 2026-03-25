import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";
import { createJobContext, type PipelineJobContext } from "../pipeline/job-model.js";

function hasPolishDiacritics(s: string): boolean {
  return /[ąęóśźżćńł]/i.test(s);
}

function extractDois(text: string): string[] {
  const re = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text)) !== null) {
    if (m[0]) found.add(m[0]);
    if (found.size >= 10) break;
  }
  return [...found];
}

export function registerPipelineClassifyDocumentTool(server: McpServer, _env: Env): void {
  server.tool(
    "pipeline_classify_document",
    [
      "Prepare the classification step for a multi-agent pipeline.",
      "This tool performs lightweight feature extraction (language guess and DOI detection) and returns a deterministic classification plan/instructions.",
      "Actual classification into UKD/categories is intended to be performed by the external LLM agent using the provided instructions and the full retrieved metadata.",
    ].join(" "),
    {
      job_id: z.string().optional().describe("Stable pipeline job id for correlation"),
      run_id: z.string().optional().describe("Stable pipeline run id for correlation"),
      document_text: z
        .string()
        .describe("Full metadata text for a single document (from *_get_item or other retrieval tools)")
        .min(20),
      classification_target: z
        .enum(["ukd", "topics"])
        .default("ukd")
        .describe("Target taxonomy for classification"),
      ukd_depth: z
        .number()
        .int()
        .min(1)
        .max(6)
        .default(3)
        .describe("UKD digit depth expected in the classification output"),
      require_open_access_support: z
        .boolean()
        .default(true)
        .describe("When true, include open-access / reuse constraints in the classification rationale")
    },
    async (params) => {
      const ctx: PipelineJobContext = createJobContext({ job_id: params.job_id, run_id: params.run_id });
      return withToolExecutionSpan(
        {
          toolName: "pipeline_classify_document",
          params: {
            job_id: ctx.job_id,
            run_id: ctx.run_id,
            classification_target: params.classification_target,
            ukd_depth: params.ukd_depth,
          } as Record<string, unknown>,
          fieldsRequested: ["document_text"],
          fieldsReturned: ["classification_plan"],
          tokensByField: {},
          queryTokens: estimateTokens(params.document_text),
        },
        async (span) => {
          span.setAttribute("agent.role", "classification");
          span.setAttribute("job.id", ctx.job_id);
          span.setAttribute("job.run_id", ctx.run_id);
          span.setAttribute("pipeline.step", "classify");

          try {
            const diacritics = hasPolishDiacritics(params.document_text);
            const langGuess = diacritics ? "pl" : "en";
            const dois = extractDois(params.document_text);

            const manifest = {
              job: ctx,
              status: "ok",
              language_guess: langGuess,
              detected_dois: dois,
              classification_target: params.classification_target,
              ukd_depth: params.ukd_depth,
              require_open_access_support: params.require_open_access_support,
              instructions: {
                output_format: "json",
                strict_fields: params.classification_target === "ukd"
                  ? ["ukd_prefix", "ukd_digits", "rationale", "confidence", "open_access_reuse_note"]
                  : ["topics", "rationale", "confidence", "open_access_reuse_note"],
                constraints: [
                  "Do not invent DOIs/identifiers. If missing, output null/unknown.",
                  "Ground classifications in title/subject/abstract when available in the provided text.",
                  "If confidence is low, explicitly mark it and propose verification fields.",
                ],
                safety: {
                  no_outreach_without_approval: true,
                },
              },
              notes: [
                "External LLM agent should return structured JSON matching instructions.output_format.",
              ],
            };

            return {
              content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }],
            };
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error in pipeline_classify_document: ${e instanceof Error ? e.message : String(e)}`,
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

