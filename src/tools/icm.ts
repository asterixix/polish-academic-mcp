import { toToolErrorText } from "../tool-error-handling.js";
/**
 * ICM — Interdisciplinary Centre for Mathematical and Computational Modelling,
 * University of Warsaw — Open Research Data Repository (open.icm.edu.pl).
 * Public UI: https://open.icm.edu.pl/home — REST API: /server/api (same host returns JSON).
 * Runs DSpace 7, responds with HAL+JSON.  Anonymous read access for all public items.
 *
 * Tools:
 *   icm_search    — full-text + faceted discovery search.
 *   icm_get_item  — single item metadata by UUID.
 *
 * Available discovery filters (from /server/api/discover/search):
 *   title, author, subject, publisher, affiliation, license, dateIssued,
 *   has_content_in_original_bundle
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const API_BASE = "https://open.icm.edu.pl/server/api";
const BASE_URL = "https://open.icm.edu.pl";
const JSON_HEADERS = { Accept: "application/json" };
const CACHE_TTL = 86_400; // 24 h

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
        url: h
          ? `${BASE_URL}/handle/${h}`
          : it.uuid
            ? `${BASE_URL}/items/${it.uuid as string}`
            : undefined,
        title: dcFirst(m, "dc.title") || undefined,
        authors: dcAll(m, "dc.contributor.author"),
        type: dcFirst(m, "dc.type") || undefined,
        language: dcFirst(m, "dc.language.iso") || undefined,
        dateIssued: dcFirst(m, "dc.date.issued") || undefined,
        publisher: dcFirst(m, "dc.publisher") || undefined,
        subject: dcFirst(m, "dc.subject") || undefined,
        license: dcFirst(m, "dc.rights") || undefined,
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

function summarizeItem(raw: string): string {
  try {
    const it = JSON.parse(raw);
    const m = it?.metadata ?? {};
    const h: string = it.handle ?? "";
    return JSON.stringify(
      {
        uuid: it.uuid as string | undefined,
        handle: h || undefined,
        url: h
          ? `${BASE_URL}/handle/${h}`
          : it.uuid
            ? `${BASE_URL}/items/${it.uuid as string}`
            : undefined,
        title: dcFirst(m, "dc.title") || undefined,
        authors: dcAll(m, "dc.contributor.author"),
        type: dcFirst(m, "dc.type") || undefined,
        language: dcFirst(m, "dc.language.iso") || undefined,
        dateIssued: dcFirst(m, "dc.date.issued") || undefined,
        publisher: dcFirst(m, "dc.publisher") || undefined,
        affiliation: dcFirst(m, "dc.contributor.affiliation") || undefined,
        subject: dcAll(m, "dc.subject"),
        doi: dcFirst(m, "dc.identifier.doi") || undefined,
        uri: dcFirst(m, "dc.identifier.uri") || undefined,
        license: dcFirst(m, "dc.rights") || undefined,
        entityType: (it.entityType as string | undefined) || undefined,
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

export function registerIcmTools(server: McpServer, env: Env): void {
  // ── icm_search ────────────────────────────────────────────────────────────
  server.tool(
    "icm_search",
    [
      "Wyszukiwanie danych badawczych i publikacji w repozytorium ICM Open (open.icm.edu.pl)",
      "Uniwersytetu Warszawskiego przez mechanizm discovery DSpace 7.",
      "Wspiera wyszukiwanie pełnotekstowe z filtrami dla autora, tytułu, tematu, wydawcy,",
      "afiliacji, licencji, daty oraz dostępności pełnego tekstu.",
      "Wyniki w formacie HAL+JSON z metadanymi Dublin Core.",
      "Każda wartość filtra może zawierać operator po przecinku (np. 'Kowalski,equals');",
      "jeśli operator nie jest podany, stosowany jest operator domyślny dla danego pola.",
      "Obsługiwane operatory: equals, notequals, contains, notcontains, authority, notauthority, query.",
    ].join(" "),
    {
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
      author: z.string().optional().describe("Filtr autora (domyślnie: contains)."),
      title: z.string().optional().describe("Filtr tytułu (domyślnie: contains)."),
      subject: z.string().optional().describe("Filtr tematu (domyślnie: equals)."),
      publisher: z.string().optional().describe("Filtr wydawcy (domyślnie: contains)."),
      affiliation: z
        .string()
        .optional()
        .describe("Filtr afiliacji instytucjonalnej autora (domyślnie: contains)."),
      license: z
        .string()
        .optional()
        .describe("Filtr licencji (domyślnie: contains). Np. 'CC BY'."),
      date_issued: z
        .string()
        .optional()
        .describe(
          "Filtr daty wydania (domyślnie: equals). Dla zakresów użyj notacji Solr, np. '[2020-01-01 TO 2023-12-31],query'.",
        ),
      has_full_text: z
        .boolean()
        .optional()
        .describe(
          "Gdy true, ogranicza wyniki do obiektów z plikami w oryginalnym pakiecie (dostępny pełny tekst).",
        ),
    },
    async ({
      query,
      page,
      size,
      sort,
      author,
      title,
      subject,
      publisher,
      affiliation,
      license,
      date_issued,
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
            if (title) addFilter(params, "title", title, "contains");
            if (subject) addFilter(params, "subject", subject, "equals");
            if (publisher) addFilter(params, "publisher", publisher, "contains");
            if (affiliation) addFilter(params, "affiliation", affiliation, "contains");
            if (license) addFilter(params, "license", license, "contains");
            if (date_issued) addFilter(params, "dateIssued", date_issued, "equals");
            if (has_full_text !== undefined) {
              params.append("f.has_content_in_original_bundle", `${has_full_text},equals`);
            }
            return params;
          };

          const searchParams = buildParams(true);
          const url = `${API_BASE}/discover/search/objects?${searchParams}`;
          const cacheKey = makeCacheKey("icm_search", {
            query,
            page,
            size,
            sort,
            author,
            title,
            subject,
            publisher,
            affiliation,
            license,
            date_issued,
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
            if (/HTTP 404/i.test(msg) || /HTTP 400/i.test(msg)) {
              const fallbackParams = buildParams(false);
              const fallbackUrl = `${API_BASE}/discover/search/objects?${fallbackParams}`;
              const fallbackKey = makeCacheKey("icm_search_fallback", {
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
                text: `Error searching ICM repository: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );

  // ── icm_get_item ──────────────────────────────────────────────────────────
  server.tool(
    "icm_get_item",
    [
      "Retrieve full metadata for a single item in the ICM Open Research Data Repository (open.icm.edu.pl) by its UUID.",
      "The UUID is found in the 'uuid' field of icm_search results.",
    ].join(" "),
    {
      uuid: z
        .string()
        .describe("UUID obiektu z wyników icm_search, np. 3fa85f64-5717-4562-b3fc-2c963f66afa6"),
    },
    async ({ uuid }) => {
      return (async () => {
        try {
          const url = `${API_BASE}/core/items/${uuid}`;
          const cacheKey = makeCacheKey("icm_item", { uuid });
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
                text: `Error fetching ICM item ${uuid}: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );
}
