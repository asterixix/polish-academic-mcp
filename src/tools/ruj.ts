/**
 * RUJ — Jagiellonian University Repository.
 * 300 000+ records (articles, monographs, dissertations, chapters).
 * Runs DSpace 7, responds with HAL+JSON.  Anonymous read access for all public items.
 *
 * Tools:
 *   ruj_search    — full-text + faceted discovery search.
 *   ruj_get_item  — single item metadata by UUID.
 *
 * IMPORTANT: GET /server/api/core/items (list all) is admin-only → always use
 * the /discover/search/objects endpoint.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const API_BASE = "https://ruj.uj.edu.pl/server/api";
const JSON_HEADERS = { Accept: "application/json" };
const CACHE_TTL = 86_400; // 24 h

export function registerRujTools(server: McpServer, env: Env): void {
  // ── ruj_search ────────────────────────────────────────────────────────────
  server.tool(
    "ruj_search",
    [
      "Search publications in the Jagiellonian University Repository (RUJ).",
      "Supports full-text queries and optional filters by item type, author, or title.",
      "Pagination is 0-based.  Results include hit highlights and full Dublin Core metadata.",
    ].join(" "),
    {
      query: z.string().describe("Full-text search terms"),
      item_type: z
        .enum(["JournalArticle", "Book", "BookSection", "JournalEditorship"])
        .optional()
        .describe("Restrict results to one item type"),
      author: z
        .string()
        .optional()
        .describe("Author name filter (contains match)"),
      title: z
        .string()
        .optional()
        .describe("Title filter (contains match)"),
      page: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Page number — 0-based"),
      size: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Results per page (max 50)"),
    },
    async ({ query, item_type, author, title, page, size }) => {
      try {
        const params = new URLSearchParams({
          query,
          page: String(page),
          size: String(size),
          sort: "score,desc",
        });
        if (item_type) params.append("f.itemtype", `${item_type},equals`);
        if (author) params.append("f.author", `${author},contains`);
        if (title) params.append("f.title", `${title},contains`);

        const url = `${API_BASE}/discover/search/objects?${params}`;
        const cacheKey = makeCacheKey("ruj_search", {
          query,
          item_type,
          author,
          title,
          page,
          size,
        });
        const data = await cachedFetch(
          env.CACHE_KV,
          cacheKey,
          url,
          { headers: JSON_HEADERS },
          CACHE_TTL,
        );
        return { content: [{ type: "text", text: data }] };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Error searching RUJ: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── ruj_get_item ──────────────────────────────────────────────────────────
  server.tool(
    "ruj_get_item",
    [
      "Retrieve full metadata for a single item in the Jagiellonian University Repository by its UUID.",
      "The UUID is found in the 'uuid' field of ruj_search results.",
    ].join(" "),
    {
      uuid: z
        .string()
        .describe("Item UUID from ruj_search results, e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"),
    },
    async ({ uuid }) => {
      try {
        const url = `${API_BASE}/core/items/${uuid}`;
        const cacheKey = makeCacheKey("ruj_item", { uuid });
        const data = await cachedFetch(
          env.CACHE_KV,
          cacheKey,
          url,
          { headers: JSON_HEADERS },
          CACHE_TTL,
        );
        return { content: [{ type: "text", text: data }] };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Error fetching RUJ item ${uuid}: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
