import { toToolErrorText } from "../tool-error-handling.js";
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

const API_BASE = "https://bazalegalnychzrodel.pl/wp-json/wp/v2";
const JSON_HEADERS = { Accept: "application/json" };
const CACHE_TTL = 86_400;

export function registerBlzTools(server: McpServer, env: Env): void {
  server.tool(
    "blz_search",
    [
      "Wyszukiwanie legalnych źródeł kultury cyfrowej w Bazie Legalnych Źródeł (Fundacja Legalna Kultura).",
      "WordPress REST: niestandardowy typ wpisu listings. Opcjonalne wyszukiwanie pełnotekstowe i/lub identyfikator kategorii listing_cat (użyj blz_listing_categories by poznać identyfikatory).",
      "Zwraca surową tablicę JSON z obiektami wpisów.",
    ].join(" "),
    {
      query: z
        .string()
        .optional()
        .describe(
          "Wyszukiwanie pełnotekstowe (parametr search WordPressa). Pomiń, by przeglądać tylko wg kategorii.",
        ),
      listing_cat: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Identyfikator terminu taksonomii listing_cat (np. 78 Biblioteki, 82 Muzea — sprawdź blz_listing_categories).",
        ),
      page: z.number().int().min(1).default(1).describe("Numer strony (od 1, REST WordPressa)."),
      per_page: z.number().int().min(1).max(100).default(20).describe("Elementów na stronę (maks. 100)."),
      orderby: z
        .enum(["date", "modified", "relevance", "title", "slug", "id"])
        .default("relevance")
        .describe(
          "Pole sortowania. relevance wymaga zapytania; gdy zapytanie jest puste, relevance mapowane jest na date (ograniczenie WP API).",
        ),
      order: z.enum(["asc", "desc"]).default("desc").describe("Kierunek sortowania listy wyników (rosnąco lub malejąco)."),
    },
    async ({ query, listing_cat, page, per_page, orderby, order }) => {
      return (async () => {
        try {
          const q = query?.trim() ?? "";
          // WP returns 400 for orderby=relevance without a search string.
          const effectiveOrderby = orderby === "relevance" && q.length === 0 ? "date" : orderby;

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
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling blz_search: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "blz_get_listing",
    "Pobiera jedno źródło (wpis) po numerycznym identyfikatorze wpisu WordPress z Bazy Legalnych Źródeł. Zwraca surowy JSON.",
    {
      listing_id: z
        .number()
        .int()
        .positive()
        .describe("Identyfikator wpisu z wyników wyszukiwania (pole id)."),
    },
    async ({ listing_id }) => {
      return (async () => {
        try {
          const url = `${API_BASE}/listings/${listing_id}`;
          const cacheKey = makeCacheKey("blz_listing", { listing_id });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling blz_get_listing: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "blz_listing_categories",
    [
      "Lista terminów taksonomii listing_cat (kategorie takie jak Filmy, Muzyka, Biblioteki, Muzea).",
      "Użyj pola id terminu jako listing_cat w blz_search. Surowy JSON z REST WordPressa.",
    ].join(" "),
    {
      page: z.number().int().min(1).default(1).describe("Strona terminów (od 1)."),
      per_page: z.number().int().min(1).max(100).default(100).describe("Terminów na stronę."),
      parent: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Tylko terminy z tym identyfikatorem rodzica (0 = tylko najwyższy poziom, jeśli obsługiwane). Pomiń dla wszystkich.",
        ),
    },
    async ({ page, per_page, parent }) => {
      return (async () => {
        try {
          const params = new URLSearchParams({
            page: String(page),
            per_page: String(per_page),
          });
          if (parent !== undefined) params.set("parent", String(parent));
          const url = `${API_BASE}/listing_cat?${params}`;
          const cacheKey = makeCacheKey("blz_listing_cat", Object.fromEntries(params));
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling blz_listing_categories: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );
}
