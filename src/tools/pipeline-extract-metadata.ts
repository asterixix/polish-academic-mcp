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

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractItemsFromRujLikeSearchSummary(raw: string): Array<{
  uuid?: string;
  handle?: string;
  doi?: string;
  title?: string;
  authors?: string[];
}> {
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  const items = obj["items"];
  if (!Array.isArray(items)) return [];

  return items
    .map((it) => (typeof it === "object" && it !== null ? (it as Record<string, unknown>) : null))
    .filter((it): it is Record<string, unknown> => it !== null)
    .map((it) => ({
      uuid: typeof it["uuid"] === "string" ? it["uuid"] : undefined,
      handle: typeof it["handle"] === "string" ? it["handle"] : undefined,
      doi: typeof it["doi"] === "string" ? it["doi"] : undefined,
      title: typeof it["title"] === "string" ? it["title"] : undefined,
      authors: Array.isArray(it["authors"]) ? (it["authors"].filter((a) => typeof a === "string") as string[]) : undefined,
    }))
    .filter((it) => Boolean(it.uuid || it.handle || it.doi || it.title));
}

function extractBnArticleIdsFromXml(xml: string): string[] {
  // BN OAI identifiers often look like: oai:bibliotekanauki.pl:1968869
  const ids = new Set<string>();
  const re = /oai:bibliotekanauki\.pl:(\d{3,})/g;
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(xml)) !== null) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

export function registerPipelineExtractMetadataTool(server: McpServer, _env: Env): void {
  server.tool(
    "pipeline_extract_metadata",
    [
      "Prepare the extraction step for a multi-agent pipeline by deriving item identifiers from search outputs.",
      "This tool performs lightweight parsing only (compact JSON summaries and simple XML regex), and returns next MCP tool calls (e.g. *_get_item) to fetch full item metadata.",
      "It does NOT parse full documents like JATS/XML into structured MARC; that is intended for the external LLM agents after full item retrieval.",
    ].join(" "),
    {
      job_id: z.string().optional().describe("Stable pipeline job id for correlation"),
      run_id: z.string().optional().describe("Stable pipeline run id for correlation"),
      search_results: z
        .array(
          z.object({
            source: z.enum(SOURCE_KEYS as [SourceKey, ...SourceKey[]]).describe("Repository/tool source key"),
            search_output_text: z
              .string()
              .describe("Raw tool output text from the corresponding *_search step"),
          }),
        )
        .min(1)
        .describe("Collection of search outputs to turn into extraction fetch plans"),
      max_items: z.number().int().min(1).max(50).default(20).describe("Max number of items to extract per step"),
    },
    async (params) => {
      const ctx: PipelineJobContext = createJobContext({ job_id: params.job_id, run_id: params.run_id });
      return withToolExecutionSpan(
        {
          toolName: "pipeline_extract_metadata",
          params: {
            job_id: ctx.job_id,
            run_id: ctx.run_id,
            sourceCount: params.search_results.length,
            max_items: params.max_items,
          } as Record<string, unknown>,
          fieldsRequested: ["search_results"],
          fieldsReturned: ["items", "planned_tool_calls"],
          tokensByField: {},
          queryTokens: estimateTokens(JSON.stringify(params.search_results.map((s) => s.source))),
        },
        async (span) => {
          span.setAttribute("agent.role", "extraction");
          span.setAttribute("job.id", ctx.job_id);
          span.setAttribute("job.run_id", ctx.run_id);
          span.setAttribute("pipeline.step", "extract");

          try {
            const plannedToolCalls: Array<{
              toolName: string;
              arguments: Record<string, unknown>;
            }> = [];
            const items: Array<{
              source: SourceKey;
              uuid?: string;
              handle?: string;
              doi?: string;
              title?: string;
              authors?: string[];
              bn_article_id?: string;
            }> = [];

            const parseReport: Record<
              string,
              {
                extracted: number;
                method: "json_summary" | "bn_xml_regex" | "none";
                warning?: string;
              }
            > = {};

            for (const sr of params.search_results) {
              const source = sr.source;
              if (source === "ruj" || source === "agh" || source === "uafm" || source === "amu" || source === "icm") {
                const extracted = extractItemsFromRujLikeSearchSummary(sr.search_output_text);
                parseReport[source] = {
                  extracted: extracted.length,
                  method: "json_summary",
                };
                for (const it of extracted) {
                  if (items.length >= params.max_items) break;
                  items.push({
                    source,
                    uuid: it.uuid,
                    handle: it.handle,
                    doi: it.doi,
                    title: it.title,
                    authors: it.authors,
                  });
                }
              } else if (source === "biblioteka_nauki") {
                const ids = extractBnArticleIdsFromXml(sr.search_output_text);
                parseReport[source] = {
                  extracted: ids.length,
                  method: "bn_xml_regex",
                };
                for (const id of ids) {
                  if (items.length >= params.max_items) break;
                  items.push({
                    source,
                    bn_article_id: id,
                  });
                }
              } else {
                parseReport[source] = {
                  extracted: 0,
                  method: "none",
                  warning:
                    "This pipeline extractor currently derives identifiers only from RUJ/AGH/UAFM/AMU/ICM compact summaries and BN OAI XML identifiers. For other sources, add dedicated parsers in a follow-up step.",
                };
              }
              if (items.length >= params.max_items) break;
            }

            // Create fetch plans for full metadata.
            for (const it of items.slice(0, params.max_items)) {
              if (it.source === "ruj" && it.uuid) {
                plannedToolCalls.push({ toolName: "ruj_get_item", arguments: { uuid: it.uuid } });
              } else if (it.source === "agh" && it.uuid) {
                plannedToolCalls.push({ toolName: "agh_get_item", arguments: { uuid: it.uuid } });
              } else if (it.source === "uafm" && it.uuid) {
                plannedToolCalls.push({ toolName: "uafm_get_item", arguments: { uuid: it.uuid } });
              } else if (it.source === "amu" && it.uuid) {
                plannedToolCalls.push({ toolName: "amu_get_item", arguments: { uuid: it.uuid } });
              } else if (it.source === "icm" && it.uuid) {
                plannedToolCalls.push({ toolName: "icm_get_item", arguments: { uuid: it.uuid } });
              } else if (it.source === "biblioteka_nauki" && it.bn_article_id) {
                plannedToolCalls.push({
                  toolName: "bn_get_article",
                  arguments: { article_id: it.bn_article_id, metadata_format: "jats" },
                });
              }
            }

            const manifest = {
              job: ctx,
              status: "ok",
              items,
              planned_tool_calls: plannedToolCalls,
              parse_report: parseReport,
              notes: [
                "Planned tool calls fetch full item metadata. External LLM agents should perform rich metadata extraction/classification after item retrieval.",
              ],
            };

            return { content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }] };
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      job: ctx,
                      status: "error",
                      error: e instanceof Error ? e.message : String(e),
                    },
                    null,
                    2,
                  ),
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

