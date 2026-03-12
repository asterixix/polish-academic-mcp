/**
 * RODBuK — Krakow inter-university open research data repository.
 * Powered by Harvard Dataverse.  Six member universities.
 * All read endpoints are open — no authentication required.
 *
 * Tools:
 *   rodbuk_search — search datasets, dataverses, and files.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const API_BASE = "https://rodbuk.pl/api";
const CACHE_TTL = 86_400; // 24 h

const API_FIELDS = ["title", "author", "subject", "abstract", "date", "doi", "keywords", "publisher"];

export function registerRodbukTools(server: McpServer, env: Env): void {
  server.tool(
    "rodbuk_search",
    [
      "Search research datasets in RODBuK — the Krakow inter-university open research data repository",
      "(AGH, UEK, UP, UR, UJ, PK).  Powered by Harvard Dataverse.",
      "Returns JSON with total_count and a list of items including DOI, description, authors, and citation.",
      "Use query='*' to browse all available datasets.",
    ].join(" "),
    {
      query: z
        .string()
        .describe("Search query.  Use * to list all datasets"),
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
          toolName: "rodbuk_search",
          params: { query, type, per_page, start } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "rodbuk");
          try {
            const searchParams = new URLSearchParams({
              q: query,
              per_page: String(per_page),
              start: String(start),
            });
            if (type) searchParams.set("type", type);

            const url = `${API_BASE}/search?${searchParams}`;
            const cacheKey = makeCacheKey("rodbuk_search", {
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
                  text: `Error searching RODBuK: ${e instanceof Error ? e.message : String(e)}`,
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
