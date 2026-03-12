/**
 * dane.gov.pl — Poland's national open data portal.
 * 43 000+ datasets from 500+ public institutions.
 * Scored 100 % on the EU Open Data Maturity portal dimension in 2024.
 * No API key required.  API version: 1.4.
 *
 * Pagination: 1-based (unlike RUJ's 0-based or RODBuK/RePOD's start-offset).
 *
 * Tools:
 *   dane_search      — full-text search across all datasets.
 *   dane_get_dataset — dataset detail and its downloadable resources.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const API_BASE = "https://api.dane.gov.pl/1.4";
const JSON_HEADERS = { Accept: "application/json" };
const SEARCH_TTL = 3_600;  // 1 h — portal updates more frequently than academic repos
const DETAIL_TTL = 3_600;

const API_FIELDS = ["title", "subject", "date", "publisher"];

export function registerDaneTools(server: McpServer, env: Env): void {
  // ── dane_search ───────────────────────────────────────────────────────────
  server.tool(
    "dane_search",
    [
      "Search the Polish government open data portal (dane.gov.pl).",
      "Contains 43,000+ datasets from ministries, municipalities, and public institutions.",
      "Datasets flagged has_research_data=true are specifically academic.",
      "Returns JSON with title, category, license (mostly CC0), institution, and download stats.",
    ].join(" "),
    {
      query: z.string().describe("Search terms"),
      category: z
        .string()
        .optional()
        .describe(
          'DCAT category name, e.g. "Science and technology", "Education", "Health", "Transport"',
        ),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Results per page"),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Page number — 1-based"),
      sort: z
        .enum(["relevance", "date", "-date", "title", "views_count"])
        .default("relevance")
        .describe("Sort order (-date = newest first)"),
    },
    async ({ query, category, per_page, page, sort }) => {
      return withToolExecutionSpan(
        {
          toolName: "dane_search",
          params: { query, category, per_page, page, sort } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "dane-gov");
          try {
            const searchParams = new URLSearchParams({
              q: query,
              per_page: String(per_page),
              page: String(page),
              sort,
            });
            if (category) searchParams.set("category[id]", category);

            const url = `${API_BASE}/datasets?${searchParams}`;
            const cacheKey = makeCacheKey("dane_search", {
              query,
              category,
              per_page,
              page,
              sort,
            });
            const data = await cachedFetch(
              env.CACHE_KV,
              cacheKey,
              url,
              { headers: JSON_HEADERS },
              SEARCH_TTL,
            );
            return { content: [{ type: "text", text: data }] };
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error searching dane.gov.pl: ${e instanceof Error ? e.message : String(e)}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── dane_get_dataset ──────────────────────────────────────────────────────
  server.tool(
    "dane_get_dataset",
    [
      "Get full details for a specific dataset on dane.gov.pl by its numeric ID,",
      "including all downloadable resources (CSV, XLSX, JSON, API links, etc.).",
      "The dataset_id is the integer id field returned by dane_search.",
    ].join(" "),
    {
      dataset_id: z
        .number()
        .int()
        .describe("Numeric dataset ID from dane_search results"),
    },
    async ({ dataset_id }) => {
      return withToolExecutionSpan(
        {
          toolName: "dane_get_dataset",
          params: { dataset_id } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(String(dataset_id)),
        },
        async (span) => {
          span.setAttribute("mcp.source", "dane-gov");
          try {
            const datasetUrl = `${API_BASE}/datasets/${dataset_id}`;
            const datasetKey = makeCacheKey("dane_dataset", { dataset_id });
            const datasetRaw = await cachedFetch(
              env.CACHE_KV,
              datasetKey,
              datasetUrl,
              { headers: JSON_HEADERS },
              DETAIL_TTL,
            );

            const resourcesUrl = `${API_BASE}/datasets/${dataset_id}/resources`;
            const resourcesKey = makeCacheKey("dane_resources", { dataset_id });
            const resourcesRaw = await cachedFetch(
              env.CACHE_KV,
              resourcesKey,
              resourcesUrl,
              { headers: JSON_HEADERS },
              DETAIL_TTL,
            );

            // Merge dataset + resources into a single JSON object for the LLM.
            let combined: string;
            try {
              combined = JSON.stringify(
                {
                  dataset: JSON.parse(datasetRaw) as unknown,
                  resources: JSON.parse(resourcesRaw) as unknown,
                },
                null,
                2,
              );
            } catch {
              // If either body is not valid JSON, return both as plain text.
              combined = `=== Dataset ===\n${datasetRaw}\n\n=== Resources ===\n${resourcesRaw}`;
            }

            return { content: [{ type: "text", text: combined }] };
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error fetching dane.gov.pl dataset ${dataset_id}: ${e instanceof Error ? e.message : String(e)}`,
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
