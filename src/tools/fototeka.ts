/**
 * Fototeka (Filmoteka Narodowa — INA) — https://fototeka.fn.org.pl/
 * Portal fotosów i zdjęć z historii kina polskiego (~300k+ rekordów).
 *
 * Brak udokumentowanego publicznego API REST; wyszukiwarka serwuje wyniki jako HTML
 * (`/pl/strona/wyszukiwarka.html`). Wewnętrzny endpoint `ajax.html` zwraca JSON z fragmentami
 * HTML, ale wymaga pełnego serializowanego formularza (m.in. hash sesji) — nie nadaje się
 * do prostego, bezstanowego wywołania z Workera.
 *
 * Tools:
 *   fototeka_search   — GET strony wyników (surowy HTML).
 *   fototeka_get_photo — strona pojedynczego zdjęcia (`/pl/foto/view/{id}.html`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const SITE = "https://fototeka.fn.org.pl";
const SEARCH = `${SITE}/pl/strona/wyszukiwarka.html`;

const HTML_HEADERS: HeadersInit = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pl,en;q=0.8",
};

/** 24 h — treści archiwalne, rzadko się zmieniają */
const CACHE_TTL = 86_400;

const API_FIELDS = ["title", "url", "thumbnail"];

export function registerFototekaTools(server: McpServer, env: Env): void {
  server.tool(
    "fototeka_search",
    [
      "Search the Fototeka photo database (Polish cinema stills and production photos, Filmoteka Narodowa).",
      "There is no public JSON API; this tool returns the raw HTML search results page.",
      "search_type: tytul (film title), osoba (person), rezyseria (director), slowo_kluczowe (keywords).",
      "Use fototeka_get_photo with a numeric id from links pl/foto/view/{id}.html for one record.",
    ].join(" "),
    {
      query: z.string().min(1).describe("Search phrase (Polish film title, name, or keywords)"),
      search_type: z
        .enum(["tytul", "osoba", "rezyseria", "slowo_kluczowe"])
        .default("slowo_kluczowe")
        .describe("Field to search: film title, person, director credit, or keywords"),
      page: z.number().int().min(1).default(1).describe("Results page (1-based)"),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(25)
        .describe("Photos per page (howmany)"),
    },
    async ({ query, search_type, page, per_page }) => {
      return withToolExecutionSpan(
        {
          toolName: "fototeka_search",
          params: { query, search_type, page, per_page } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "fototeka-fn");
          try {
            const qs = new URLSearchParams({
              key: query,
              search_type,
              pageNumber: String(page),
              howmany: String(per_page),
            });
            const url = `${SEARCH}?${qs}`;
            const cacheKey = makeCacheKey("fototeka_search", { query, search_type, page, per_page });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: HTML_HEADERS }, CACHE_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling fototeka_search: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "fototeka_get_photo",
    [
      "Fetch the Fototeka HTML page for a single photo by numeric id (path /pl/foto/view/{id}.html).",
      "Ids appear in search results and collection links on fototeka.fn.org.pl.",
      "Returns raw HTML (metadata, description, related links) — not the full-resolution image file.",
    ].join(" "),
    {
      photo_id: z
        .number()
        .int()
        .min(1)
        .describe("Numeric photo id from a fototeka.pl/foto/view/{id} URL"),
    },
    async ({ photo_id }) => {
      return withToolExecutionSpan(
        {
          toolName: "fototeka_get_photo",
          params: { photo_id } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "fototeka-fn");
          try {
            const url = `${SITE}/pl/foto/view/${photo_id}.html`;
            const cacheKey = makeCacheKey("fototeka_get_photo", { photo_id });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: HTML_HEADERS }, CACHE_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling fototeka_get_photo: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
