/**
 * Gapla — Galeria plakatu filmowego (Filmoteka Narodowa — Instytut Audiowizualny)
 * https://gapla.fn.org.pl/
 *
 * Brak publicznego API JSON; serwis to klasyczny HTML (formularz GET). Wyszukiwanie:
 * `szukaj.html?q=…&typ=…&page=…&sort=…`. Karta plakatu: `plakat/{id}.html`.
 *
 * Tools:
 *   gapla_search      — lista wyników wyszukiwania (surowe HTML)
 *   gapla_get_poster  — strona pojedynczego plakatu po id liczbowym (surowe HTML)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const SITE_BASE = "https://gapla.fn.org.pl";
const DEFAULT_UA = "Mozilla/5.0 (compatible; PolishAcademicMCP/1.0)";
const HTML_HEADERS: HeadersInit = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "User-Agent": DEFAULT_UA,
};
const SEARCH_TTL = 3_600;
const POSTER_TTL = 86_400;

const SPAN_FIELDS = ["q", "typ"];

export function registerGaplaTools(server: McpServer, env: Env): void {
  server.tool(
    "gapla_search",
    [
      "Search the Gapla film poster gallery (Filmoteka Narodowa) — Polish and international film posters and festival materials.",
      "No JSON API; uses the same GET form as the website (szukaj.html). Returns raw HTML with poster thumbnails and links to plakat/{id}/….html.",
      "typ: tytul (title), autor (artist), rezyseria (director).",
      "sort: alfabetycznie (default), chronologicznie_asc, chronologicznie_desc.",
      "Use gapla_get_poster with numeric id parsed from result links.",
    ].join(" "),
    {
      q: z.string().min(1).describe("Search phrase (maps to query parameter q)"),
      typ: z
        .enum(["tytul", "autor", "rezyseria"])
        .default("tytul")
        .describe("Search field: title, artist/author, or director credit"),
      page: z.number().int().min(1).default(1).describe("Result page number (1-based)"),
      sort: z
        .enum(["alfabetycznie", "chronologicznie_asc", "chronologicznie_desc"])
        .default("alfabetycznie")
        .describe("Sort order for the hit list"),
    },
    async ({ q, typ, page, sort }) => {
      return withToolExecutionSpan(
        {
          toolName: "gapla_search",
          params: { q, typ, page, sort } as Record<string, unknown>,
          fieldsRequested: SPAN_FIELDS,
          fieldsReturned: SPAN_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(q),
        },
        async (span) => {
          span.setAttribute("mcp.source", "gapla");
          try {
            const params = new URLSearchParams({ q, typ, page: String(page), sort });
            const url = `${SITE_BASE}/szukaj.html?${params}`;
            const text = await cachedFetch(
              env.CACHE_KV,
              makeCacheKey("gapla_search", { q, typ, page, sort }),
              url,
              { headers: HTML_HEADERS },
              SEARCH_TTL,
            );
            return { content: [{ type: "text", text }] };
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error calling gapla_search: ${e instanceof Error ? e.message : String(e)}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "gapla_get_poster",
    [
      "Fetch one Gapla poster detail page as HTML by numeric id (from gapla_search links plakat/ID/…).",
      "URL pattern: /plakat/{id}.html — slug in the public URL is optional for retrieval.",
      "Returns raw HTML (metadata, credits, image links); no separate JSON API.",
    ].join(" "),
    {
      poster_id: z.number().int().positive().describe("Numeric poster id from search results"),
    },
    async ({ poster_id }) => {
      return withToolExecutionSpan(
        {
          toolName: "gapla_get_poster",
          params: { poster_id } as Record<string, unknown>,
          fieldsRequested: SPAN_FIELDS,
          fieldsReturned: SPAN_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(String(poster_id)),
        },
        async (span) => {
          span.setAttribute("mcp.source", "gapla");
          try {
            const url = `${SITE_BASE}/plakat/${poster_id}.html`;
            const text = await cachedFetch(
              env.CACHE_KV,
              makeCacheKey("gapla_get_poster", { poster_id }),
              url,
              { headers: HTML_HEADERS },
              POSTER_TTL,
            );
            return { content: [{ type: "text", text }] };
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error calling gapla_get_poster: ${e instanceof Error ? e.message : String(e)}`,
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
