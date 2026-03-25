import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";
import { createJobContext, type PipelineJobContext } from "../pipeline/job-model.js";

type SourceKey =
  | "ruj"
  | "agh"
  | "amu"
  | "uafm"
  | "icm"
  | "biblioteka_nauki"
  | "repod"
  | "rodbuk"
  | "dane";

const SOURCE_KEYS: readonly SourceKey[] = [
  "ruj",
  "agh",
  "amu",
  "uafm",
  "icm",
  "biblioteka_nauki",
  "repod",
  "rodbuk",
  "dane",
];

function joinTopics(topics: string[]): string {
  return topics
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
}

function buildQuery(institution: string, topics: string[]): string {
  const inst = institution.trim();
  const t = joinTopics(topics);
  // Keep query compact: base repositories treat this as full-text search terms.
  return t ? `${inst} ${t}` : inst;
}

export function registerPipelineDiscoverPublicationsTool(server: McpServer, _env: Env): void {
  server.tool(
    "pipeline_discover_publications",
    [
      "Plan the discovery step for a multi-agent publication pipeline.",
      "This tool does not fetch catalogs itself; instead it generates a deterministic list of MCP tool calls (arguments) to execute next.",
      "It is intended to be used by an external orchestrator (multi-agent system) which then calls the returned base search tools.",
      "Output is a JSON manifest with planned tool calls for each chosen repository.",
    ].join(" "),
    {
      job_id: z.string().optional().describe("Stable pipeline job id for correlation"),
      run_id: z.string().optional().describe("Stable pipeline run id for correlation"),
      institution_query: z
        .string()
        .describe("Institution affiliation or repository scope string, e.g. 'University of Warsaw'")
        .min(2),
      topics: z.array(z.string().min(1)).optional().describe("Optional topic keywords to refine discovery"),
      language: z
        .enum(["pl", "en", "mixed"])
        .optional()
        .describe("Preferred language for repository search (when supported)"),
      from_date: z
        .string()
        .optional()
        .describe("Optional earliest date (YYYY-MM-DD) for date-constrained discovery (only some sources)"),
      until_date: z
        .string()
        .optional()
        .describe("Optional latest date (YYYY-MM-DD) for date-constrained discovery (only some sources)"),
      bn_set: z
        .string()
        .optional()
        .describe("Required for Biblioteka Nauki discovery: OAI set identifier to scope results"),
      sources: z
        .array(z.enum(SOURCE_KEYS as [SourceKey, ...SourceKey[]]))
        .optional()
        .describe("Which repositories to plan discovery for"),
      max_results_per_source: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max results size/page parameter for each repository search tool (when supported)"),
      page: z.number().int().min(0).default(0).describe("0-based page for DSpace-based repositories"),
    },
    async (params) => {
      const ctx: PipelineJobContext = createJobContext({ job_id: params.job_id, run_id: params.run_id });
      const sources = params.sources && params.sources.length > 0 ? params.sources : SOURCE_KEYS.slice(0, 5);
      const topics = params.topics ?? [];
      const query = buildQuery(params.institution_query, topics);

      return withToolExecutionSpan(
        {
          toolName: "pipeline_discover_publications",
          params: {
            job_id: ctx.job_id,
            run_id: ctx.run_id,
            institution_query: params.institution_query,
            sources,
            language: params.language,
            max_results_per_source: params.max_results_per_source,
            page: params.page,
          } as Record<string, unknown>,
          fieldsRequested: ["institution_query", "topics", "sources"],
          fieldsReturned: ["planned_tool_calls"],
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          // Telemetry/audit correlation (no raw query persistence beyond spans already emitted by worker code).
          span.setAttribute("agent.role", "search");
          span.setAttribute("job.id", ctx.job_id);
          span.setAttribute("job.run_id", ctx.run_id);
          span.setAttribute("pipeline.step", "discover");

          try {
            const plannedToolCalls: Array<{
              toolName: string;
              arguments: Record<string, unknown>;
            }> = [];

            const lang = params.language === "mixed" ? undefined : params.language;

            for (const source of sources) {
              if (source === "ruj") {
                plannedToolCalls.push({
                  toolName: "ruj_search",
                  arguments: {
                    query,
                    page: params.page,
                    size: params.max_results_per_source,
                    sort: "score,desc",
                    ...(lang ? { language: lang } : {}),
                  },
                });
              } else if (source === "agh") {
                plannedToolCalls.push({
                  toolName: "agh_search",
                  arguments: {
                    query,
                    page: params.page,
                    size: params.max_results_per_source,
                    sort: "score,desc",
                    ...(lang ? { language: lang } : {}),
                  },
                });
              } else if (source === "uafm") {
                plannedToolCalls.push({
                  toolName: "uafm_search",
                  arguments: {
                    query,
                    page: params.page,
                    size: params.max_results_per_source,
                    sort: "score,desc",
                    ...(lang ? { language: lang } : {}),
                  },
                });
              } else if (source === "amu") {
                plannedToolCalls.push({
                  toolName: "amu_search",
                  arguments: {
                    query,
                    page: params.page,
                    size: params.max_results_per_source,
                    sort: "score,desc",
                    ...(lang ? { language: lang } : {}),
                  },
                });
              } else if (source === "icm") {
                plannedToolCalls.push({
                  toolName: "icm_search",
                  arguments: {
                    query,
                    page: params.page,
                    size: params.max_results_per_source,
                    sort: "score,desc",
                    ...(lang ? { language: lang } : {}),
                  },
                });
              } else if (source === "biblioteka_nauki") {
                if (!params.bn_set) {
                  return {
                    content: [
                      {
                        type: "text",
                        text: JSON.stringify(
                          {
                            job: ctx,
                            status: "error",
                            error: "bn_set_required",
                            message:
                              "Biblioteka Nauki discovery requires bn_set (OAI set identifier) to avoid unbounded ListRecords queries.",
                          },
                          null,
                          2,
                        ),
                      },
                    ],
                    isError: true,
                  };
                }

                plannedToolCalls.push({
                  toolName: "bn_search_articles",
                  arguments: {
                    metadata_format: "oai_dc",
                    set: params.bn_set,
                    ...(params.from_date ? { from_date: params.from_date } : {}),
                    ...(params.until_date ? { until_date: params.until_date } : {}),
                  },
                });
              } else if (source === "repod") {
                plannedToolCalls.push({
                  toolName: "repod_search",
                  arguments: {
                    query,
                    type: "dataset",
                    per_page: params.max_results_per_source,
                    start: params.page * params.max_results_per_source,
                  },
                });
              } else if (source === "rodbuk") {
                plannedToolCalls.push({
                  toolName: "rodbuk_search",
                  arguments: {
                    query,
                    per_page: params.max_results_per_source,
                    page: params.page + 1, // rodbuk uses 1-based in some endpoints; keep explicit
                  },
                });
              } else if (source === "dane") {
                plannedToolCalls.push({
                  toolName: "dane_search",
                  arguments: {
                    query,
                    per_page: params.max_results_per_source,
                    page: params.page + 1,
                    ...(params.language === "pl" ? { sort: "-date" } : { sort: "relevance" }),
                  },
                });
              }
            }

            const manifest = {
              job: ctx,
              status: "ok",
              institution_query: params.institution_query,
              topics,
              language: params.language ?? null,
              discoveryQuery: query,
              planned_tool_calls: plannedToolCalls,
              notes: [
                "This manifest is deterministic; an external orchestrator should execute planned_tool_calls in order.",
                "For RUJ/AGH/AMU/UAFM/ICM, results are compact summaries; downstream extraction should call pipeline_extract_metadata and then get_item tools.",
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
                  text: `Error in pipeline_discover_publications: ${e instanceof Error ? e.message : String(e)}`,
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

