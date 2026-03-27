/**
 * Baza Legalnych Źródeł — Legalna Kultura (bazalegalnychzrodel.pl).
 * WordPress + CPT `listing` („Źródła”); publiczny REST bez klucza API.
 *
 * Discovery: nagłówek `Link: <https://bazalegalnychzrodel.pl/wp-json/>; rel="https://api.w.org/"`.
 *
 * Tools:
 *   blz_search           — GET /wp/v2/listings (search + opcjonalnie listing_cat).
 *   blz_get_listing      — pojedyncze źródło po ID.
 *   blz_listing_categories — taksonomia listing_cat (ID do filtrów).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const API_BASE = "https://bazalegalnychzrodel.pl/wp-json/wp/v2";
const JSON_HEADERS = { Accept: "application/json" };
const CACHE_TTL = 86_400;

const API_FIELDS = ["title", "excerpt", "link", "listing_cat", "date"];

export function registerBlzTools(server: McpServer, env: Env): void {
  server.tool(
    "blz_search",
    [
      "Search legal digital culture sources in Baza Legalnych Źródeł (Fundacja Legalna Kultura).",
      "WordPress REST: listings CPT. Optional full-text search and/or listing_cat term ID (use blz_listing_categories for IDs).",
      "Returns raw JSON array of listing objects.",
    ].join(" "),
    {
      query: z
        .string()
        .optional()
        .describe("Full-text search (WordPress `search` parameter). Omit to browse by category only."),
      listing_cat: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Taxonomy listing_cat term ID (e.g. 78 Biblioteki, 82 Muzea — see blz_listing_categories)."),
      page: z.number().int().min(1).default(1).describe("Page number (1-based, WordPress REST)."),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Items per page (max 100)."),
      orderby: z
        .enum(["date", "modified", "relevance", "title", "slug", "id"])
        .default("relevance")
        .describe(
          "Sort field. relevance requires query; if query is omitted, relevance is mapped to date (WP API limitation).",
        ),
      order: z.enum(["asc", "desc"]).default("desc").describe("Sort direction."),
    },
    async ({ query, listing_cat, page, per_page, orderby, order }) => {
      return withToolExecutionSpan(
        {
          toolName: "blz_search",
          params: { query, listing_cat, page, per_page, orderby, order } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query ?? String(listing_cat ?? "")),
        },
        async (span) => {
          span.setAttribute("mcp.source", "blz-legalna-kultura");
          try {
            const q = query?.trim() ?? "";
            // WP returns 400 for orderby=relevance without a search string.
            const effectiveOrderby =
              orderby === "relevance" && q.length === 0 ? "date" : orderby;

            const params = new URLSearchParams({
              page: String(page),
              per_page: String(per_page),
              orderby: effectiveOrderby,
              order,
            });
            if (q.length > 0) params.set("search", q);
            if (listing_cat !== undefined) params.set("listing_cat", String(listing_cat));

            const url = `${API_BASE}/listings?${params}`;
            const cacheKey = makeCacheKey("blz_search", Object.fromEntries(params));
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: JSON_HEADERS }, CACHE_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling blz_search: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "blz_get_listing",
    "Fetch one source (listing) by numeric WordPress post ID from Baza Legalnych Źródeł. Returns raw JSON.",
    {
      listing_id: z.number().int().positive().describe("Listing ID from search results (field id)."),
    },
    async ({ listing_id }) => {
      return withToolExecutionSpan(
        {
          toolName: "blz_get_listing",
          params: { listing_id } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(String(listing_id)),
        },
        async (span) => {
          span.setAttribute("mcp.source", "blz-legalna-kultura");
          try {
            const url = `${API_BASE}/listings/${listing_id}`;
            const cacheKey = makeCacheKey("blz_listing", { listing_id });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: JSON_HEADERS }, CACHE_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling blz_get_listing: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "blz_listing_categories",
    [
      "List taxonomy terms for listing_cat (categories like Filmy, Muzyka, Biblioteki, Muzea).",
      "Use term `id` as listing_cat in blz_search. Raw JSON from WordPress REST.",
    ].join(" "),
    {
      page: z.number().int().min(1).default(1).describe("Page of terms (1-based)."),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(100)
        .describe("Terms per page."),
      parent: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Only terms with this parent ID (0 = top-level only if supported). Omit for all."),
    },
    async ({ page, per_page, parent }) => {
      return withToolExecutionSpan(
        {
          toolName: "blz_listing_categories",
          params: { page, per_page, parent } as Record<string, unknown>,
          fieldsRequested: ["id", "name", "slug", "count", "parent"],
          fieldsReturned: ["id", "name", "slug", "count", "parent"],
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "blz-legalna-kultura");
          try {
            const params = new URLSearchParams({
              page: String(page),
              per_page: String(per_page),
            });
            if (parent !== undefined) params.set("parent", String(parent));
            const url = `${API_BASE}/listing_cat?${params}`;
            const cacheKey = makeCacheKey("blz_listing_cat", Object.fromEntries(params));
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: JSON_HEADERS }, CACHE_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling blz_listing_categories: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
