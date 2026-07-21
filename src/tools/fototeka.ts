import { toToolErrorText } from "../tool-error-handling.js";
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

const SITE = "https://fototeka.fn.org.pl";
const SEARCH = `${SITE}/pl/strona/wyszukiwarka.html`;

const HTML_HEADERS: HeadersInit = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pl,en;q=0.8",
};

/** 24 h — treści archiwalne, rzadko się zmieniają */
const CACHE_TTL = 86_400;

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
      query: z.string().min(1).describe("Fraza wyszukiwania (tytuł polskiego filmu, nazwisko lub słowa kluczowe)"),
      search_type: z
        .enum(["tytul", "osoba", "rezyseria", "slowo_kluczowe"])
        .default("slowo_kluczowe")
        .describe("Pole wyszukiwania: tytuł filmu, osoba, reżyser lub słowa kluczowe"),
      page: z.number().int().min(1).default(1).describe("Numer strony wyników, liczony od 1"),
      per_page: z.number().int().min(1).max(100).default(25).describe("Liczba zdjęć na stronę (parametr howmany)"),
    },
    async ({ query, search_type, page, per_page }) => {
      return (async () => {
        try {
          const qs = new URLSearchParams({
            key: query,
            search_type,
            pageNumber: String(page),
            howmany: String(per_page),
          });
          const url = `${SEARCH}?${qs}`;
          const cacheKey = makeCacheKey("fototeka_search", { query, search_type, page, per_page });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: HTML_HEADERS },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling fototeka_search: ${msg}` }],
            isError: true,
          };
        }
      })();
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
        .describe("Numeryczny identyfikator zdjęcia z URL fototeka.pl/foto/view/{id}"),
    },
    async ({ photo_id }) => {
      return (async () => {
        try {
          const url = `${SITE}/pl/foto/view/${photo_id}.html`;
          const cacheKey = makeCacheKey("fototeka_get_photo", { photo_id });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: HTML_HEADERS },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling fototeka_get_photo: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );
}
