/**
 * RePOD — ICM University of Warsaw open research data repository.
 * Runs a CeON fork of Dataverse (branched from v4.11).
 * ~3,737 datasets; all DOIs use the 10.18150/ prefix.
 * All search and read operations work anonymously.
 *
 * Tools:
 *   repod_search      — search datasets, dataverses, and files.
 *   repod_get_dataset — retrieve a dataset's metadata by DOI.
 *
 * Note: some Dataverse v5+/v6+ features (geo_point search, Croissant metadata)
 * may not be available due to the fork age.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const API_BASE = "https://repod.icm.edu.pl/api";
const CACHE_TTL = 86_400; // 24 h

const API_FIELDS = ["title", "author", "subject", "abstract", "date", "doi", "keywords", "publisher"];

export function registerRepodTools(server: McpServer, env: Env): void {
  // ── repod_search ──────────────────────────────────────────────────────────
  server.tool(
    "repod_search",
    [
      "Search open research datasets in RePOD (ICM University of Warsaw).",
      "Contains ~3,737 datasets with DOIs under the 10.18150/ prefix.",
      "Returns JSON with relevance scores, authors, descriptions, and publication dates.",
    ].join(" "),
    {
      query: z.string().describe("Search query"),
      type: z
        .enum(["dataset", "dataverse", "file"])
        .optional()
        .describe("Restrict results to one content type"),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .describe("Results per page"),
      start: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Zero-based offset for pagination"),
    },
    async ({ query, type, per_page, start }) => {
      return withToolExecutionSpan(
        {
          toolName: "repod_search",
          params: { query, type, per_page, start } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "repod");
          try {
            const searchParams = new URLSearchParams({
              q: query,
              per_page: String(per_page),
              start: String(start),
            });
            if (type) searchParams.set("type", type);

            const url = `${API_BASE}/search?${searchParams}`;
            const cacheKey = makeCacheKey("repod_search", {
              query,
              type,
              per_page,
              start,
            });
            const data = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
            return { content: [{ type: "text", text: data }] };
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error searching RePOD: ${e instanceof Error ? e.message : String(e)}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── repod_get_dataset ─────────────────────────────────────────────────────
  server.tool(
    "repod_get_dataset",
    [
      "Get metadata for a specific dataset in RePOD by its DOI.",
      "Choose datacite for standard metadata, schema.org for JSON-LD,",
      "dcterms for Dublin Core XML, or dataverse_json for the full native record.",
    ].join(" "),
    {
      doi: z
        .string()
        .describe("Dataset DOI without the doi: prefix, e.g. 10.18150/ABCDEF"),
      format: z
        .enum(["datacite", "dcterms", "schema.org", "ddi", "dataverse_json"])
        .default("datacite")
        .describe("Metadata export format"),
    },
    async ({ doi, format }) => {
      return withToolExecutionSpan(
        {
          toolName: "repod_get_dataset",
          params: { doi, format } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(doi),
        },
        async (span) => {
          span.setAttribute("mcp.source", "repod");
          try {
            const url = `${API_BASE}/datasets/export?exporter=${encodeURIComponent(format)}&persistentId=doi:${encodeURIComponent(doi)}`;
            const cacheKey = makeCacheKey("repod_dataset", { doi, format });
            const data = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
            return { content: [{ type: "text", text: data }] };
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error fetching RePOD dataset ${doi}: ${e instanceof Error ? e.message : String(e)}`,
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
