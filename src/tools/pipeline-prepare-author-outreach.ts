import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { withToolExecutionSpan } from "../tracing.js";
import { createJobContext, type PipelineJobContext } from "../pipeline/job-model.js";
import { estimateTokens } from "../tracing.js";

type OutreachDecision = "pending" | "approved" | "denied";

function redactSensitive(record: Record<string, unknown>): Record<string, unknown> {
  // Minimal redaction: keep only fields likely required for a draft outreach message.
  // In this Worker we avoid propagating personal identifiers unless they are explicitly present.
  const allowed = [
    "title",
    "authors",
    "doi",
    "open_access",
    "corresponding_author",
    "contact_email",
    "repository",
    "year",
    "ukd",
    "subjects",
    "language",
  ];
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (record[k] !== undefined) out[k] = record[k];
  }
  return out;
}

export function registerPipelinePrepareAuthorOutreachTool(server: McpServer, _env: Env): void {
  server.tool(
    "pipeline_prepare_author_outreach",
    [
      "Prepare an outreach plan for contacting authors to enrich publication metadata.",
      "This tool is intentionally policy-gated: it never produces an outbound message unless an explicit approval decision is provided.",
      "Output includes either a draft message payload (when approved) or a blocked-by-policy status (when pending/denied).",
    ].join(" "),
    {
      job_id: z.string().optional().describe("Stable pipeline job id for correlation"),
      run_id: z.string().optional().describe("Stable pipeline run id for correlation"),
      approval_decision: z
        .enum(["pending", "approved", "denied"])
        .default("pending")
        .describe("Human-in-the-loop approval gate. Only 'approved' allows draft generation."),
      classified_record: z
        .string()
        .describe("JSON string of classified publication metadata (must include open-access signal if possible)"),
      require_open_access: z
        .boolean()
        .default(true)
        .describe("If true, block outreach unless classified_record.open_access is true"),
      outreach_language: z
        .enum(["pl", "en"])
        .default("pl")
        .describe("Language for the outreach draft template"),
    },
    async (params) => {
      const ctx: PipelineJobContext = createJobContext({ job_id: params.job_id, run_id: params.run_id });

      return withToolExecutionSpan(
        {
          toolName: "pipeline_prepare_author_outreach",
          params: {
            job_id: ctx.job_id,
            run_id: ctx.run_id,
            approval_decision: params.approval_decision,
            require_open_access: params.require_open_access,
            outreach_language: params.outreach_language,
          } as Record<string, unknown>,
          fieldsRequested: ["classified_record"],
          fieldsReturned: ["outreach_plan"],
          tokensByField: {},
          queryTokens: estimateTokens(params.classified_record),
        },
        async (span) => {
          span.setAttribute("agent.role", "communication");
          span.setAttribute("job.id", ctx.job_id);
          span.setAttribute("job.run_id", ctx.run_id);
          span.setAttribute("pipeline.step", "prepare_outreach");

          try {
            const parsed = JSON.parse(params.classified_record) as unknown;
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      { job: ctx, status: "error", error: "classified_record_must_be_object_json" },
                      null,
                      2,
                    ),
                  },
                ],
                isError: true,
              };
            }

            const record = redactSensitive(parsed as Record<string, unknown>);
            const openAccess = Boolean((record as Record<string, unknown>)["open_access"]);

            const policyViolations: string[] = [];
            if (params.approval_decision !== "approved") {
              policyViolations.push("approval_required");
            }
            if (params.require_open_access && !openAccess) {
              policyViolations.push("open_access_required");
            }

            // Policy/audit visibility at the tool-execution span level.
            span.setAttribute("policy.approval_decision", params.approval_decision);
            span.setAttribute("policy.require_open_access", params.require_open_access);
            span.setAttribute("policy.open_access_signal", openAccess);
            span.setAttribute("policy.violations_count", policyViolations.length);
            span.setAttribute("policy.blocked", policyViolations.length > 0);
            span.setAttribute("policy.violations", policyViolations.join(","));

            const manifest = {
              job: ctx,
              status: policyViolations.length === 0 ? "ok" : "blocked_by_policy",
              approval_decision: params.approval_decision as OutreachDecision,
              require_open_access: params.require_open_access,
              open_access_signal: openAccess,
              policy_decisions: policyViolations,
              outreach_language: params.outreach_language,
              outreach_draft:
                policyViolations.length === 0
                  ? {
                      subject: params.outreach_language === "pl" ? "Uzupełnienie metadanych publikacji" : "Publication metadata enrichment",
                      recipient_hint: (record["corresponding_author"] ?? record["authors"] ?? null) as unknown,
                      contact_email_present: typeof record["contact_email"] === "string" && record["contact_email"].includes("@"),
                      message_template:
                        params.outreach_language === "pl"
                          ? [
                              "Dzień dobry,",
                              "",
                              "zespół buduje repozytorium publikacji i chcemy wzbogacić metadane dla poniższej pracy.",
                              "",
                              "Tytuł: {{title}}",
                              "DOI: {{doi}}",
                              "",
                              "Czy mogliby Państwo potwierdzić/uzupełnić kluczowe informacje (np. afiliację, temat/UKD, wersję open-access) ?",
                              "",
                              "Z góry dziękujemy za pomoc.",
                            ].join("\n")
                          : [
                              "Hello,",
                              "",
                              "we are enhancing a publication repository and would like to enrich metadata for the work below.",
                              "",
                              "Title: {{title}}",
                              "DOI: {{doi}}",
                              "",
                              "Could you please confirm/update key details (e.g., affiliation, topics/UKD, open-access version)?",
                              "",
                              "Thank you in advance.",
                            ].join("\n"),
                      message_variables: {
                        title: typeof record["title"] === "string" ? record["title"] : null,
                        doi: typeof record["doi"] === "string" ? record["doi"] : null,
                      },
                    }
                  : null,
            };

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(manifest, null, 2),
                },
              ],
            };
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error in pipeline_prepare_author_outreach: ${e instanceof Error ? e.message : String(e)}`,
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

