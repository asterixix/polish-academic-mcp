/**
 * Biblioteka Sejmowa — katalog OPAC (Aleph) pod https://bs.sejm.gov.pl/F
 *
 * Brak publicznego API JSON ani udokumentowanego SRU dla tego katalogu; dostęp
 * maszynowy to ten sam interfejs WWW co przeglądarka (GET do skryptu /F).
 * Inne usługi Sejmu (np. ELI, akty prawne) są na https://api.sejm.gov.pl/ —
 * patrz narzędzia isap_*.
 *
 * Narzędzia:
 *   bs_sejm_search   — wyszukiwanie słowne (func=find-b), surowe HTML z listą wyników
 *   bs_sejm_get_item — karta rekordu po doc_library + doc_number (func=item-global)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const OPAC_BASE = "https://bs.sejm.gov.pl/F";
const DEFAULT_UA = "Mozilla/5.0 (compatible; PolishAcademicMCP/1.0)";
const HTML_HEADERS: HeadersInit = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "User-Agent": DEFAULT_UA,
};
const SEARCH_TTL = 3_600;
const ITEM_TTL = 86_400;

const SPAN_FIELDS = ["request", "local_base"];

export function registerSejmBsTools(server: McpServer, env: Env): void {
  server.tool(
    "bs_sejm_search",
    [
      "Search the Sejm Library (Biblioteka Sejmowa) Aleph OPAC at bs.sejm.gov.pl — books, serials, parliamentary materials, etc.",
      "There is no public JSON API; this calls the same word-search form as the website (func=find-b).",
      "Returns raw HTML: the short hit list includes author, title, year, and links with doc_library + doc_number — use bs_sejm_get_item for the full bibliographic card.",
      "local_base examples: bis01 (main catalog), bis02, bis03, bis05 (articles), pos01 (Sejm recordings), tek01 (constitutional texts), sta01 (old prints), ars01 — see the library's base list on the OPAC home page.",
      "find_code: WRD = all fields (default), WST = title, WHF = author, WNW = publisher, WHP = subject, SYS = record number, etc.",
      "Only the first page of hits is returned; narrow the query or use get_item after picking doc_number from the HTML.",
    ].join(" "),
    {
      request: z.string().min(1).describe("Search terms (same syntax as the OPAC search box)"),
      local_base: z
        .string()
        .min(1)
        .describe(
          "Aleph local database id — e.g. bis01, bis05, pos01 (lowercase as in the catalog URLs)",
        ),
      find_code: z
        .enum([
          "WRD",
          "WST",
          "WHF",
          "WNW",
          "WMW",
          "WSE",
          "WHP",
          "WTE",
          "TXT",
          "SYS",
          "WOB",
        ])
        .default("WRD")
        .describe("Which index to search (WRD = all fields)"),
      adjacent: z
        .enum(["N", "Y"])
        .default("N")
        .describe("Require adjacent words: N = no (default), Y = yes"),
    },
    async ({ request, local_base, find_code, adjacent }) => {
      return withToolExecutionSpan(
        {
          toolName: "bs_sejm_search",
          params: { request, local_base, find_code, adjacent } as Record<string, unknown>,
          fieldsRequested: SPAN_FIELDS,
          fieldsReturned: SPAN_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(request),
        },
        async (span) => {
          span.setAttribute("mcp.source", "sejm-bs-opac");
          try {
            const params = new URLSearchParams({
              func: "find-b",
              local_base,
              request,
              find_code,
              adjacent,
            });
            const url = `${OPAC_BASE}?${params}`;
            const text = await cachedFetch(
              env.CACHE_KV,
              makeCacheKey("bs_sejm_search", { request, local_base, find_code, adjacent }),
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
                  text: `Error calling bs_sejm_search: ${e instanceof Error ? e.message : String(e)}`,
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
    "bs_sejm_get_item",
    [
      "Fetch one Sejm Library OPAC bibliographic record as HTML (func=item-global).",
      "Pass doc_library and doc_number exactly as in item-global links from bs_sejm_search results (e.g. doc_library=BIS01, doc_number=000179010).",
      "sub_library is usually BS for main stacks — copy from the link if different.",
      "Stable per record (unlike session-bound full-set-set links); suitable for caching.",
    ].join(" "),
    {
      doc_library: z
        .string()
        .min(1)
        .describe("Document library code from the hit list link, e.g. BIS01, BIS05, POS01"),
      doc_number: z
        .string()
        .min(1)
        .describe("Nine-digit document number from the hit list (e.g. 000179010)"),
      sub_library: z
        .string()
        .default("BS")
        .describe("Sub-library code from the link, often BS"),
      year: z.string().optional().describe("Usually leave empty; pass if the link includes a year parameter"),
      volume: z.string().optional().describe("Usually leave empty; pass if the link includes volume"),
    },
    async ({ doc_library, doc_number, sub_library, year, volume }) => {
      return withToolExecutionSpan(
        {
          toolName: "bs_sejm_get_item",
          params: { doc_library, doc_number, sub_library, year, volume } as Record<string, unknown>,
          fieldsRequested: SPAN_FIELDS,
          fieldsReturned: SPAN_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(doc_number),
        },
        async (span) => {
          span.setAttribute("mcp.source", "sejm-bs-opac");
          try {
            const params = new URLSearchParams({
              func: "item-global",
              doc_library,
              doc_number,
              year: year ?? "",
              volume: volume ?? "",
              sub_library,
            });
            const url = `${OPAC_BASE}?${params}`;
            const text = await cachedFetch(
              env.CACHE_KV,
              makeCacheKey("bs_sejm_get_item", {
                doc_library,
                doc_number,
                sub_library,
                year: year ?? "",
                volume: volume ?? "",
              }),
              url,
              { headers: HTML_HEADERS },
              ITEM_TTL,
            );
            return { content: [{ type: "text", text }] };
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error calling bs_sejm_get_item: ${e instanceof Error ? e.message : String(e)}`,
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
