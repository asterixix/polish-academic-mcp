import { toToolErrorText } from "../tool-error-handling.js";
/**
 * Ninateka — VOD Filmoteki Narodowej (FINA), https://ninateka.pl/
 *
 * Brak publicznej dokumentacji OpenAPI; front SPA woła JSON pod `/api/products/…`.
 * Wymagany parametr `platform` (dla przeglądarki: `BROWSER`) — bez niego API zwraca
 * `PLATFORM_UNDEFINED`. Wyszukiwanie: `keyword` (nie `query`).
 *
 * Tools:
 *   ninateka_search — lista materiałów (VOD / odcinki / seriale itd.)
 *   ninateka_get_vod — szczegóły pojedynczego materiału po id liczbowym
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const API_BASE = "https://ninateka.pl/api";
const JSON_HEADERS: HeadersInit = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; PolishAcademicMCP/1.0)",
};
const SEARCH_TTL = 3_600;
const DETAIL_TTL = 86_400;

export function registerNinatekaTools(server: McpServer, env: Env): void {
  server.tool(
    "ninateka_search",
    [
      "Search Ninateka (Filmoteka Narodowa — free VOD: films, docs, theatre, audio, etc.).",
      "Uses the site's JSON API — pass keyword (required). Results are paginated with first_result and limit.",
      "Returns raw JSON with meta.totalCount and items[] (id, title, lead, type, categories, images, …).",
      "platform must stay BROWSER for web-style access (default).",
    ].join(" "),
    {
      keyword: z.string().min(1).describe("Fraza wyszukiwania (mapowana na parametr API keyword)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Rozmiar strony wyników; API zwykle akceptuje do 100"),
      first_result: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Przesunięcie liczone od zera dla paginacji (parametr API firstResult)"),
      platform: z
        .literal("BROWSER")
        .default("BROWSER")
        .describe("Wymagany token platformy dla publicznego API — użyj stałej wartości BROWSER"),
    },
    async ({ keyword, limit, first_result, platform }) => {
      return (async () => {
        try {
          const params = new URLSearchParams({
            keyword,
            platform,
            limit: String(limit),
            firstResult: String(first_result),
          });
          const url = `${API_BASE}/products/vods/search?${params}`;
          const text = await cachedFetch(
            env.CACHE_KV,
            makeCacheKey("ninateka_search", { keyword, limit, first_result, platform }),
            url,
            { headers: JSON_HEADERS },
            SEARCH_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error calling ninateka_search: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "ninateka_get_vod",
    [
      "Get full JSON metadata for one Ninateka item by numeric id (from ninateka_search items[].id).",
      "Includes description, categories, images, type (VOD, EPISODE, SERIAL, …) when present.",
      "Does not return streaming URLs or DRM — metadata only.",
    ].join(" "),
    {
      vod_id: z.number().int().positive().describe("Numeryczny identyfikator zasobu z wyników wyszukiwania"),
      platform: z.literal("BROWSER").default("BROWSER").describe("Wartość stała: BROWSER dla publicznego API Ninateki"),
    },
    async ({ vod_id, platform }) => {
      return (async () => {
        try {
          const params = new URLSearchParams({ platform });
          const url = `${API_BASE}/products/vods/${vod_id}?${params}`;
          const text = await cachedFetch(
            env.CACHE_KV,
            makeCacheKey("ninateka_get_vod", { vod_id, platform }),
            url,
            { headers: JSON_HEADERS },
            DETAIL_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error calling ninateka_get_vod: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );
}
