import { toToolErrorText } from "../tool-error-handling.js";
/**
 * BazTOL — subject gateway of Polish technical-science web resources (Biblioteka PUT).
 * Web UI: https://baztol.library.put.poznan.pl/ — no public JSON API; the MCP tools replay
 * the same HTML form POST and detail GET the browser uses (Apache + Perl CGI).
 *
 * Note: As of 2022-01-01 the portal is no longer actively updated (site notice).
 *
 * Tools:
 *   baztol_search       — full-text search (`wyr_wysz`), 20 results per page (server-side).
 *   baztol_browse_domain — browse by subject domain id (`dziedzina_id`, same as sidebar).
 *   baztol_get_resource — resource detail page (HTML) by numeric id.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const API_ORIGIN = "http://baztol.library.put.poznan.pl";
const READER_PATH = "/baztol_czytelnik/baztol";
const READER_URL = `${API_ORIGIN}${READER_PATH}`;
const HTML_ACCEPT = "text/html; charset=utf-8";
const CACHE_TTL = 86_400; // 24 h — catalog frozen since 2022

const PAGE_SIZE = 20;

/** Subject domain ids (sidebar) — same as BazTOL “przeglądanie” links. */
export const BAZTOL_DOMAIN_IDS = [
  24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42,
] as const;

function buildPostBody(params: Record<string, string>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    u.set(k, v);
  }
  return u.toString();
}

export function registerBaztolTools(server: McpServer, env: Env): void {
  // ── baztol_search ─────────────────────────────────────────────────────────
  server.tool(
    "baztol_search",
    [
      "Wyszukiwanie w BazTOL (krajowa brama zasobów nauki technicznej, Biblioteka Politechniki Poznańskiej). Zwraca listę wyników w HTML",
      "(tytuły, odnośniki, krótkie opisy, identyfikatory 'Więcej'). Paginacja: 20 trafień na stronę;",
      "użyj parametru page liczonego od 1. Brak oficjalnego JSON API — to narzędzie wysyła identyczne żądanie POST jak formularz na stronie.",
    ].join(" "),
    {
      query: z.string().min(1).describe("Fraza wyszukiwania (dopasowywana do pól katalogu po stronie serwera)"),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony liczony od 1 (20 wyników na stronę)"),
    },
    async ({ query, page }) => {
      return (async () => {
        try {
          const bodyParams: Record<string, string> = {
            akcja: "szukanie_proste",
            dziedzina_id: "",
            wyr_wysz: query,
            button_proste: "Szukaj",
          };
          if (page > 1) {
            bodyParams.offset = String((page - 1) * PAGE_SIZE);
            bodyParams.kierunek = "przod";
          }
          const body = buildPostBody(bodyParams);
          const cacheKey = makeCacheKey("baztol_search", { query, page });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            READER_URL,
            {
              method: "POST",
              headers: {
                Accept: HTML_ACCEPT,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              },
              body,
            },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling baztol_search: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  // ── baztol_browse_domain ─────────────────────────────────────────────────
  server.tool(
    "baztol_browse_domain",
    [
      "Przeglądanie BazTOL według dziedziny (te same kategorie co w panelu bocznym portalu).",
      "Identyfikatory dziedzin: 24 Architektura, 25 Automatyka, 26 Biotechnologia, 27 Budownictwo,",
      "28 Chemia, 29 Elektronika i Telekomunikacja, 30 Elektrotechnika i Energetyka,",
      "31 Fizyka i Astronomia, 32 Geodezja i Kartografia, 33 Górnictwo i Geologia,",
      "34 Informatyka, 35 Inżynieria i Ochrona Środowiska, 36 Inżynieria Materiałowa,",
      "37 Matematyka, 38 Mechanika, 39 Oceanologia i Oceanotechnika, 40 Transport,",
      "41 Zarządzanie, 42 Źródła ogólne. Zwraca HTML.",
    ].join(" "),
    {
      domain_id: z
        .number()
        .int()
        .refine((n) => (BAZTOL_DOMAIN_IDS as readonly number[]).includes(n), {
          message: "domain_id musi być jednym z identyfikatorów panelu bocznego BazTOL (24–42)",
        })
        .describe("Identyfikator dziedziny przedmiotowej z panelu bocznego (wartość 24–42)"),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony liczony od 1 (20 wyników na stronę)"),
    },
    async ({ domain_id, page }) => {
      return (async () => {
        try {
          const bodyParams: Record<string, string> = {
            akcja: "przegladanie",
            dziedzina_id: String(domain_id),
          };
          if (page > 1) {
            bodyParams.offset = String((page - 1) * PAGE_SIZE);
            bodyParams.kierunek = "przod";
          }
          const body = buildPostBody(bodyParams);
          const cacheKey = makeCacheKey("baztol_browse_domain", { domain_id, page });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            READER_URL,
            {
              method: "POST",
              headers: {
                Accept: HTML_ACCEPT,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              },
              body,
            },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling baztol_browse_domain: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  // ── baztol_get_resource ───────────────────────────────────────────────────
  server.tool(
    "baztol_get_resource",
    [
      "Pobiera stronę opisu pojedynczego zasobu BazTOL (HTML) na podstawie numerycznego identyfikatora.",
      "Identyfikatory pojawiają się w listach wyników jako odnośniki /baztol_czytelnik/baztol?id=….",
    ].join(" "),
    {
      resource_id: z.number().int().positive().describe("Identyfikator zasobu z wyników wyszukiwania lub przeglądania"),
    },
    async ({ resource_id }) => {
      return (async () => {
        try {
          const url = `${READER_URL}?id=${resource_id}`;
          const cacheKey = makeCacheKey("baztol_get_resource", { resource_id });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: { Accept: HTML_ACCEPT } },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling baztol_get_resource: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );
}
