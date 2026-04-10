import { toToolErrorText } from "../tool-error-handling.js";
/**
 * Polski Komitet Normalizacyjny (PKN) — main site www.pkn.pl (Drupal + Search API / Solr).
 *
 * There is no published JSON/REST API; /jsonapi returns 404. The public site search view
 * accepts GET query parameters and returns HTML results.
 *
 * Tool:
 *   pkn_search — full-text search across pkn.pl pages (news, sections, etc.).
 *
 * Does NOT search the WIEDZA norms catalog or Sklep — for PN metadata use tools wiedza_search_norms
 * and wiedza_get_standard (wiedza.pkn.pl).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const SITE_ORIGIN = "https://www.pkn.pl";
const CACHE_TTL = 3_600; // site content changes more often than thesis repos

const SEARCH_PATH: Record<"pl" | "en" | "ru", string> = {
  pl: "/wyszukiwarka",
  en: "/en/search",
  ru: "/ru/poisk",
};

const API_FIELDS = ["title", "url", "excerpt", "updated"];

export function registerPknTools(server: McpServer, env: Env): void {
  server.tool(
    "pkn_search",
    [
      "Full-text search on Polski Komitet Normalizacyjny main website (pkn.pl) via the public Solr-backed view.",
      "Returns raw HTML (result list with titles, excerpts, update dates). Pagination is 0-based.",
      "Not the WIEDZA norms DB: for PN search/details use wiedza_search_norms / wiedza_get_standard; for purchases see sklep.pkn.pl.",
    ].join(" "),
    {
      query: z.string().min(1).describe("Search phrase (plain text)."),
      language: z
        .enum(["pl", "en", "ru"])
        .default("pl")
        .describe("Site language / search path: pl — /wyszukiwarka; en — /en/search; ru — /ru/poisk."),
      sort_by: z
        .enum(["search_api_relevance", "changed"])
        .default("search_api_relevance")
        .describe("search_api_relevance — by relevance; changed — by last modification date."),
      page: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Zero-based results page (Drupal pager)."),
    },
    async ({ query, language, sort_by, page }) => {
      return withToolExecutionSpan(
        {
          toolName: "pkn_search",
          params: { query, language, sort_by, page } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "pkn");
          try {
            const path = SEARCH_PATH[language];
            const params = new URLSearchParams({
              szukaj: query,
              sort_by,
              page: String(page),
            });
            const url = `${SITE_ORIGIN}${path}?${params}`;
            const cacheKey = makeCacheKey("pkn_search", { url });
            const html = await cachedFetch(
              env.CACHE_KV,
              cacheKey,
              url,
              { headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" } },
              CACHE_TTL,
            );
            return { content: [{ type: "text", text: html }] };
          } catch (err) {
            const msg = toToolErrorText(err);
            return {
              content: [{ type: "text", text: `Error calling pkn_search: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
