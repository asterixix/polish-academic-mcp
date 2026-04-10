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
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const API_ORIGIN = "https://baztol.library.put.poznan.pl";
const READER_PATH = "/baztol_czytelnik/baztol";
const READER_URL = `${API_ORIGIN}${READER_PATH}`;
const HTML_ACCEPT = "text/html; charset=utf-8";
const CACHE_TTL = 86_400; // 24 h — catalog frozen since 2022

const PAGE_SIZE = 20;

const API_FIELDS = ["title", "url", "id"];

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
      "Search BazTOL (Polish technical-science gateway, PUT library). Returns HTML result list",
      "(titles, links, short descriptions, “Więcej” ids). Pagination: 20 hits per page; use",
      "`page` (1-based). No official JSON API — this tool POSTs the same form as the website.",
    ].join(" "),
    {
      query: z.string().min(1).describe("Search phrase (matches cataloged fields on the server)"),
      page: z.number().int().min(1).default(1).describe("Page number — 1-based (20 results per page)"),
    },
    async ({ query, page }) => {
      return withToolExecutionSpan(
        {
          toolName: "baztol_search",
          params: { query, page } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "baztol");
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
        },
      );
    },
  );

  // ── baztol_browse_domain ─────────────────────────────────────────────────
  server.tool(
    "baztol_browse_domain",
    [
      "Browse BazTOL by subject domain (same categories as the portal sidebar).",
      "Domain ids: 24 Architektura, 25 Automatyka, 26 Biotechnologia, 27 Budownictwo,",
      "28 Chemia, 29 Elektronika i Telekomunikacja, 30 Elektrotechnika i Energetyka,",
      "31 Fizyka i Astronomia, 32 Geodezja i Kartografia, 33 Górnictwo i Geologia,",
      "34 Informatyka, 35 Inżynieria i Ochrona Środowiska, 36 Inżynieria Materiałowa,",
      "37 Matematyka, 38 Mechanika, 39 Oceanologia i Oceanotechnika, 40 Transport,",
      "41 Zarządzanie, 42 Źródła ogólne. Returns HTML.",
    ].join(" "),
    {
      domain_id: z
        .number()
        .int()
        .refine((n) => (BAZTOL_DOMAIN_IDS as readonly number[]).includes(n), {
          message: "domain_id must be one of the BazTOL sidebar ids (24–42)",
        })
        .describe("Subject domain id (24–42)"),
      page: z.number().int().min(1).default(1).describe("Page number — 1-based (20 results per page)"),
    },
    async ({ domain_id, page }) => {
      return withToolExecutionSpan(
        {
          toolName: "baztol_browse_domain",
          params: { domain_id, page } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "baztol");
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
        },
      );
    },
  );

  // ── baztol_get_resource ───────────────────────────────────────────────────
  server.tool(
    "baztol_get_resource",
    [
      "Fetch one BazTOL resource description page (HTML) by numeric id.",
      "Ids appear in result lists as links `/baztol_czytelnik/baztol?id=…`.",
    ].join(" "),
    {
      resource_id: z.number().int().positive().describe("Resource id from search/browse results"),
    },
    async ({ resource_id }) => {
      return withToolExecutionSpan(
        {
          toolName: "baztol_get_resource",
          params: { resource_id } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "baztol");
          try {
            const url = `${READER_URL}?id=${resource_id}`;
            const cacheKey = makeCacheKey("baztol_get_resource", { resource_id });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: { Accept: HTML_ACCEPT } }, CACHE_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = toToolErrorText(err);
            return {
              content: [{ type: "text", text: `Error calling baztol_get_resource: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
