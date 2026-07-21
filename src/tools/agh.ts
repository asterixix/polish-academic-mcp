import { toToolErrorText } from "../tool-error-handling.js";
/**
 * AGH University of Krakow Repository (repo.agh.edu.pl).
 * 100 000+ records (theses, articles, technical reports, dissertations).
 * Runs DSpace 7, responds with HAL+JSON.  Anonymous read access for all public items.
 *
 * Tools:
 *   agh_search    — full-text + faceted discovery search.
 *   agh_get_item  — single item metadata by UUID.
 *
 * IMPORTANT: GET /server/api/core/items (list all) is admin-only → always use
 * the /discover/search/objects endpoint.
 *
 * Filter schema mirrors the standard DSpace 7 discovery configuration.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

/** JSON HAL API lives on api.* — repo.agh.edu.pl/server/api serves the SPA (HTML), not REST. */
const API_BASE = "https://api.repo.agh.edu.pl/server/api";
const HANDLE_BASE = "https://repo.agh.edu.pl/handle";
const JSON_HEADERS = { Accept: "application/json" };
const CACHE_TTL = 86_400; // 24 h

/**
 * Append a DSpace discovery filter parameter.
 * If the caller already embedded a valid operator suffix (e.g. "Smith,equals")
 * it is used as-is; otherwise the defaultOp is appended.
 */
const VALID_OPS = new Set([
  "equals",
  "notequals",
  "contains",
  "notcontains",
  "authority",
  "notauthority",
  "query",
]);
function addFilter(params: URLSearchParams, field: string, value: string, defaultOp: string): void {
  const lastComma = value.lastIndexOf(",");
  const trailingToken = lastComma !== -1 ? value.slice(lastComma + 1) : "";
  params.append(`f.${field}`, VALID_OPS.has(trailingToken) ? value : `${value},${defaultOp}`);
}

// ── Compact HAL+JSON parsers ─────────────────────────────────────────────
// JSON.parse returns `any`; we accept that explicitly here for brevity.
/* eslint-disable @typescript-eslint/no-explicit-any */
function dcFirst(meta: any, key: string): string {
  const arr = meta?.[key];
  return Array.isArray(arr) && arr.length > 0 ? String(arr[0]?.value ?? "") : "";
}
function dcAll(meta: any, key: string): string[] {
  const arr = meta?.[key];
  if (!Array.isArray(arr)) return [];
  return (arr as any[]).map((v) => String(v?.value ?? "")).filter(Boolean);
}
function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/**
 * Collapse agh_search HAL+JSON into a compact summary.
 * Returns the raw string unchanged if parsing fails.
 */
function summarizeSearch(raw: string): string {
  try {
    const json = JSON.parse(raw);
    const sr = json?._embedded?.searchResult;
    const objects: any[] = sr?._embedded?.objects ?? [];
    const p = sr?.page ?? {};
    const items = objects.map((obj: any) => {
      const it = obj?._embedded?.indexableObject ?? {};
      const m = it.metadata ?? {};
      const abs = dcFirst(m, "dc.description.abstract");
      const h: string = it.handle ?? "";
      return {
        uuid: it.uuid as string | undefined,
        handle: h || undefined,
        url: h ? `${HANDLE_BASE}/${h}` : undefined,
        title: dcFirst(m, "dc.title") || undefined,
        titleAlt: dcFirst(m, "dc.title.alternative") || undefined,
        authors: dcAll(m, "dc.contributor.author"),
        type: dcFirst(m, "dc.type") || undefined,
        language: dcFirst(m, "dc.language.iso") || dcFirst(m, "dc.language") || undefined,
        dateIssued: dcFirst(m, "dc.date.issued") || undefined,
        dateSubmitted: dcFirst(m, "dc.date.submitted") || undefined,
        publisher: dcFirst(m, "dc.publisher") || undefined,
        subject: dcFirst(m, "dc.subject") || undefined,
        abstract: abs ? trunc(abs, 500) : undefined,
      };
    });
    return JSON.stringify(
      {
        totalElements: p.totalElements,
        page: { number: p.number, size: p.size, totalPages: p.totalPages },
        items,
      },
      null,
      2,
    );
  } catch {
    return raw;
  }
}

/**
 * Collapse agh_get_item HAL+JSON into a compact summary.
 * Returns the raw string unchanged if parsing fails.
 */
function summarizeItem(raw: string): string {
  try {
    const it = JSON.parse(raw);
    const m = it?.metadata ?? {};
    const h: string = it.handle ?? "";
    return JSON.stringify(
      {
        uuid: it.uuid as string | undefined,
        handle: h || undefined,
        url: h ? `${HANDLE_BASE}/${h}` : undefined,
        title: dcFirst(m, "dc.title") || undefined,
        titleAlt: dcFirst(m, "dc.title.alternative") || undefined,
        authors: dcAll(m, "dc.contributor.author"),
        advisors: dcAll(m, "dc.contributor.advisor"),
        type: dcFirst(m, "dc.type") || undefined,
        language: dcFirst(m, "dc.language.iso") || dcFirst(m, "dc.language") || undefined,
        dateIssued: dcFirst(m, "dc.date.issued") || undefined,
        dateSubmitted: dcFirst(m, "dc.date.submitted") || undefined,
        dateAccessioned: dcFirst(m, "dc.date.accessioned") || undefined,
        publisher: dcFirst(m, "dc.publisher") || undefined,
        doi: dcFirst(m, "dc.identifier.doi") || undefined,
        identifierURI: dcFirst(m, "dc.identifier.uri") || undefined,
        subjects: dcAll(m, "dc.subject"),
        description: dcFirst(m, "dc.description") || undefined,
        entityType: (it.entityType as string | undefined) || undefined,
        inArchive: it.inArchive as boolean | undefined,
        lastModified: (it.lastModified as string | undefined) || undefined,
        abstract: dcFirst(m, "dc.description.abstract") || undefined,
      },
      null,
      2,
    );
  } catch {
    return raw;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function registerAghTools(server: McpServer, env: Env): void {
  // ── agh_search ────────────────────────────────────────────────────────────
  server.tool(
    "agh_search",
    [
      "Wyszukiwanie publikacji w repozytorium Akademii Górniczo-Hutniczej (repo.agh.edu.pl) przez mechanizm discovery DSpace 7.",
      "Obejmuje prace dyplomowe, rozprawy doktorskie, artykuły, raporty techniczne i monografie AGH.",
      "Wspiera wyszukiwanie pełnotekstowe z filtrami, sortowaniem i paginacją liczoną od zera.",
      "Wyniki zwracane w formacie HAL+JSON z metadanymi Dublin Core, skondensowane do czytelnego podsumowania.",
      "Każda wartość filtra może zawierać operator po przecinku, na przykład 'Kowalski,equals'.",
      "Jeśli operator nie jest podany, stosowany jest operator domyślny dla danego pola.",
      "Obsługiwane operatory: equals, notequals, contains, notcontains, authority, notauthority, query.",
    ].join(" "),
    {
      // ── Core ───────────────────────────────────────────────────────────────
      query: z.string().describe("Wyrażenie do wyszukiwania pełnotekstowego"),
      page: z.number().int().min(0).default(0).describe("Numer strony liczony od zera"),
      size: z.number().int().min(1).max(50).default(10).describe("Liczba wyników na stronę (1–50)"),
      sort: z
        .enum([
          "score,desc",
          "dc.title,asc",
          "dc.title,desc",
          "dc.date.issued,asc",
          "dc.date.issued,desc",
          "dc.date.accessioned,asc",
          "dc.date.accessioned,desc",
        ])
        .default("score,desc")
        .describe("Pole i kierunek sortowania"),

      // ── Filtry (wszystkie opcjonalne) ─────────────────────────────────────────
      author: z.string().optional().describe("Filtr autora (domyślnie: contains)."),
      subject: z.string().optional().describe("Filtr tematu lub słowa kluczowego (domyślnie: equals)."),
      language: z
        .string()
        .optional()
        .describe("Kod języka, na przykład 'pl', 'en' (domyślnie: equals)."),
      itemtype: z
        .string()
        .optional()
        .describe(
          "Typ dokumentu (domyślnie: equals). " +
            "Najczęstsze wartości: Thesis, Article, Book, Technical Report.",
        ),
      date_issued: z
        .string()
        .optional()
        .describe(
          "Filtr daty wydania (domyślnie: equals). " +
            "Dla zakresów użyj operatora query z notacją Solr, " +
            "na przykład '[2020-01-01 TO 2023-12-31],query'. " +
            "Mapowane na pole DSpace dateIssued.",
        ),
      date_accessioned: z
        .string()
        .optional()
        .describe(
          "Filtr daty zdeponowania w repozytorium (domyślnie: equals). " +
            "Mapowane na pole DSpace dateAccessioned.",
        ),
      has_full_text: z
        .boolean()
        .optional()
        .describe(
          "Gdy true, ogranicza wyniki do obiektów z plikami w oryginalnym pakiecie " +
            "(dostępny tekst w repozytorium). " +
            "Mapowane na pole DSpace has_content_in_original_bundle.",
        ),
    },
    async ({
      query,
      page,
      size,
      sort,
      author,
      subject,
      language,
      itemtype,
      date_issued,
      date_accessioned,
      has_full_text,
    }) => {
      return (async () => {
        try {
          const buildParams = (useAllFilters: boolean): URLSearchParams => {
            const params = new URLSearchParams({
              query,
              page: String(page),
              size: String(size),
              sort,
            });
            if (!useAllFilters) return params;

            if (author) addFilter(params, "author", author, "contains");
            if (subject) addFilter(params, "subject", subject, "equals");
            if (language) addFilter(params, "language", language, "equals");
            if (itemtype) addFilter(params, "itemtype", itemtype, "equals");
            if (date_issued) addFilter(params, "dateIssued", date_issued, "equals");
            if (date_accessioned) addFilter(params, "dateAccessioned", date_accessioned, "equals");
            if (has_full_text !== undefined) {
              params.append("f.has_content_in_original_bundle", `${has_full_text},equals`);
            }
            return params;
          };

          const searchParams = buildParams(true);
          const url = `${API_BASE}/discover/search/objects?${searchParams}`;
          const cacheKey = makeCacheKey("agh_search", {
            query,
            page,
            size,
            sort,
            author,
            subject,
            language,
            itemtype,
            date_issued,
            date_accessioned,
            has_full_text,
          });
          try {
            const data = await cachedFetch(
              env.CACHE_KV,
              cacheKey,
              url,
              { headers: JSON_HEADERS },
              CACHE_TTL,
            );
            return { content: [{ type: "text", text: summarizeSearch(data) }] };
          } catch (err) {
            const msg = toToolErrorText(err);
            // Robustness fallback: some AGH discovery filter combos can return 404.
            // Retry with only core query/page/size/sort to keep the tool usable.
            if (/HTTP 404/i.test(msg) || /HTTP 400/i.test(msg)) {
              const fallbackParams = buildParams(false);
              const fallbackUrl = `${API_BASE}/discover/search/objects?${fallbackParams}`;
              const fallbackKey = makeCacheKey("agh_search_fallback", {
                query,
                page,
                size,
                sort,
              });
              const data = await cachedFetch(
                env.CACHE_KV,
                fallbackKey,
                fallbackUrl,
                { headers: JSON_HEADERS },
                CACHE_TTL,
              );
              return { content: [{ type: "text", text: summarizeSearch(data) }] };
            }
            throw err;
          }
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error searching AGH repository: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );

  // ── agh_get_item ──────────────────────────────────────────────────────────
  server.tool(
    "agh_get_item",
    [
      "Pobiera pełne metadane pojedynczego obiektu w repozytorium Akademii Górniczo-Hutniczej na podstawie UUID.",
      "UUID znajduje się w polu 'uuid' wyników agh_search.",
      "Zwraca metadane Dublin Core, w tym tytuł, autorów, abstrakt, typ, datę, DOI i trwały adres handle.",
    ].join(" "),
    {
      uuid: z
        .string()
        .describe("UUID obiektu z wyników agh_search, na przykład 3fa85f64-5717-4562-b3fc-2c963f66afa6"),
    },
    async ({ uuid }) => {
      return (async () => {
        try {
          const url = `${API_BASE}/core/items/${uuid}`;
          const cacheKey = makeCacheKey("agh_item", { uuid });
          const data = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text: summarizeItem(data) }] };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error fetching AGH item ${uuid}: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );
}
