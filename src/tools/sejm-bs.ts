import { toToolErrorText } from "../tool-error-handling.js";
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

const OPAC_BASE = "https://bs.sejm.gov.pl/F";
const DEFAULT_UA = "Mozilla/5.0 (compatible; PolishAcademicMCP/1.0)";
const HTML_HEADERS: HeadersInit = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "User-Agent": DEFAULT_UA,
};
const SEARCH_TTL = 3_600;
const ITEM_TTL = 86_400;

export function registerSejmBsTools(server: McpServer, env: Env): void {
  server.tool(
    "bs_sejm_search",
    [
      "Wyszukiwanie w katalogu OPAC Aleph Biblioteki Sejmowej (bs.sejm.gov.pl) — książki, czasopisma, materiały parlamentarne itp.",
      "Brak publicznego API JSON; to narzędzie wywołuje ten sam formularz wyszukiwania co serwis (func=find-b).",
      "Zwraca surowy HTML: krótka lista trafień zawiera autora, tytuł, rok i odnośniki z doc_library + doc_number — użyj bs_sejm_get_item dla pełnej karty bibliograficznej.",
      "Przykłady local_base: bis01 (katalog główny), bis02, bis03, bis05 (artykuły), pos01 (nagrania Sejmu), tek01 (teksty konstytucyjne), sta01 (stare druki), ars01 — pełna lista baz w menu OPAC.",
      "find_code: WRD = wszystkie pola (domyślnie), WST = tytuł, WHF = autor, WNW = wydawca, WHP = hasło przedmiotowe, SYS = numer rekordu itd.",
      "Zwracana jest tylko pierwsza strona wyników; zawęź zapytanie lub użyj get_item po wybraniu doc_number z HTML.",
    ].join(" "),
    {
      request: z.string().min(1).describe("Wyrażenia wyszukiwania (ta sama składnia co pole wyszukiwarki OPAC)"),
      local_base: z
        .string()
        .min(1)
        .describe(
          "Identyfikator bazy lokalnej Aleph — np. bis01, bis05, pos01 (małymi literami jak w URL katalogu)",
        ),
      find_code: z
        .enum(["WRD", "WST", "WHF", "WNW", "WMW", "WSE", "WHP", "WTE", "TXT", "SYS", "WOB"])
        .default("WRD")
        .describe("Indeks do przeszukania (WRD = wszystkie pola)"),
      adjacent: z
        .enum(["N", "Y"])
        .default("N")
        .describe("Wymagać sąsiadujących słów: N = nie (domyślnie), Y = tak"),
    },
    async ({ request, local_base, find_code, adjacent }) => {
      return (async () => {
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
                text: `Error calling bs_sejm_search: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "bs_sejm_get_item",
    [
      "Pobiera jeden rekord bibliograficzny z OPAC Biblioteki Sejmowej jako HTML (func=item-global).",
      "Przekaż doc_library i doc_number dokładnie tak, jak w odnośnikach item-global w wynikach bs_sejm_search (np. doc_library=BIS01, doc_number=000179010).",
      "sub_library to zazwyczaj BS dla księgozbioru głównego — przepisz z odnośnika, jeśli inne.",
      "Stabilne dla rekordu (w odróżnieniu od sesyjnych odnośników full-set-set); nadaje się do cache.",
    ].join(" "),
    {
      doc_library: z
        .string()
        .min(1)
        .describe("Kod biblioteki dokumentu z odnośnika na liście trafień, np. BIS01, BIS05, POS01"),
      doc_number: z
        .string()
        .min(1)
        .describe("Dziewięciocyfrowy numer dokumentu z listy trafień (np. 000179010)"),
      sub_library: z.string().default("BS").describe("Kod podbiblioteki z odnośnika, zazwyczaj BS"),
      year: z
        .string()
        .optional()
        .describe("Zazwyczaj puste; podaj tylko gdy odnośnik zawiera parametr year"),
      volume: z
        .string()
        .optional()
        .describe("Zazwyczaj puste; podaj tylko gdy odnośnik zawiera volume"),
    },
    async ({ doc_library, doc_number, sub_library, year, volume }) => {
      return (async () => {
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
                text: `Error calling bs_sejm_get_item: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );
}
