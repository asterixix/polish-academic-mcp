/**
 * Biblioteka Nauki — Poland's largest open-access publication database.
 * Public API: OAI-PMH (no authentication required).
 *
 * Tools:
 *   bn_search_publications — POST /api/search (JSON): full-text keyword search.
 *   bn_search_articles     — OAI-PMH ListRecords (harvest by date/set; no keywords).
 *   bn_get_article           — OAI-PMH GetRecord by numeric ID.
 *
 * OAI responses are raw XML. Search API returns raw JSON. Avoids heavy parsing on the Worker.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey, type CacheError } from "../cache.js";
import { createToolErrorReport, formatToolErrorResponse } from "../tool-error-handling.js";

const OAI_BASE = "https://bibliotekanauki.pl/api/oai/articles";
/** Public website search API (JSON). Supports full-text `generalSearchString`; not documented on OAI-PMH page. */
const SEARCH_API = "https://bibliotekanauki.pl/api/search";
const CACHE_TTL = 86_400; // 24 h — academic records rarely change
const SEARCH_CACHE_TTL = 3_600; // 1 h — search index may shift

const PUBLICATION_TYPES = ["ARTICLE", "SIMPLE_BOOK", "COLLECTIVE_WORK", "CHAPTER"] as const;
type BnPublicationType = (typeof PUBLICATION_TYPES)[number];

function hasNoRecordsMatch(xml: string): boolean {
  return /<error[^>]*code=["']noRecordsMatch["'][^>]*>/i.test(xml);
}

function scrubPiiXml(xml: string): string {
  return xml
    .replace(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/g, "[REDACTED_ORCID]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/\b\d{11}\b/g, "[REDACTED_PESEL]")
    .replace(/\+?[\d\s\-()]{9,}/g, "[REDACTED_PHONE]");
}

/** POST body for `/api/search` (same shape as the public Biblioteka Nauki web UI). */
function buildPublicationSearchBody(params: {
  query: string;
  page: number;
  page_size: number;
  sort_field: "score" | "publishedDate";
  sort_direction: "ASC" | "DESC";
  publication_types?: BnPublicationType[];
  published_date_from?: string;
  published_date_to?: string;
  open_resources?: boolean;
}): Record<string, unknown> {
  const {
    query,
    page,
    page_size,
    sort_field,
    sort_direction,
    publication_types,
    published_date_from,
    published_date_to,
    open_resources,
  } = params;
  return {
    searchCriteria: {
      generalSearchString: query,
      ...(publication_types && publication_types.length > 0
        ? { publicationTypes: publication_types }
        : {}),
      ...(published_date_from ? { publishedDateFrom: published_date_from } : {}),
      ...(published_date_to ? { publishedDateTo: published_date_to } : {}),
      ...(open_resources === true ? { openResources: true } : {}),
    },
    paginationCriteria: {
      pageNumber: page,
      pageSize: page_size,
      sortingCriteria: {
        fieldName: sort_field,
        direction: sort_direction,
      },
    },
  };
}

export function registerBibliotekaTools(server: McpServer, env: Env): void {
  // ── bn_search_publications ────────────────────────────────────────────────
  server.tool(
    "bn_search_publications",
    [
      "Wyszukiwanie pełnotekstowe w Bibliotece Nauki (polskie otwarte artykuły, książki, rozdziały).",
      "Korzysta z publicznego API wyszukiwania JSON (tego samego co strona internetowa). Preferuj to narzędzie, gdy użytkownik podaje słowa kluczowe,",
      "tematy, nazwiska autorów lub tytuły. Do pozyskiwania po zakresie dat lub zbiorze OAI bez słów kluczowych",
      "użyj bn_search_articles (OAI-PMH XML).",
      "Zwraca JSON z trafieniami, fragmentami (mainTitleSnippets, fullTextSnippets) i totalResults.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe(
          "Fraza wyszukiwania (polska lub angielska). Mapowana na pole generalSearchString portalu — tytuły, abstrakty, pełny tekst tam, gdzie jest zaindeksowany.",
        ),
      page: z.number().int().min(1).default(1).describe("Numer strony wyników, liczony od 1."),
      page_size: z.number().int().min(1).max(50).default(10).describe("Liczba wyników na stronę (maks. 50)."),
      sort_field: z
        .enum(["score", "publishedDate"])
        .default("score")
        .describe("score — trafność; publishedDate — data publikacji."),
      sort_direction: z.enum(["ASC", "DESC"]).default("DESC").describe("Kierunek sortowania listy wyników (rosnąco lub malejąco)."),
      publication_types: z
        .array(z.enum(PUBLICATION_TYPES))
        .optional()
        .describe(
          "Ogranicz do typów publikacji: ARTICLE (czasopisma), SIMPLE_BOOK / COLLECTIVE_WORK / CHAPTER (książki). Pomiń, by szukać we wszystkich.",
        ),
      published_date_from: z
        .string()
        .optional()
        .describe("Opcjonalna dolna granica daty publikacji YYYY-MM-DD (włącznie)."),
      published_date_to: z
        .string()
        .optional()
        .describe("Opcjonalna górna granica daty publikacji YYYY-MM-DD (włącznie)."),
      open_resources: z
        .boolean()
        .optional()
        .describe("Gdy true, preferuj zasoby w modelu otwartym lub diamond open (znacznik portalu wyszukiwarki)."),
    },
    async ({
      query,
      page,
      page_size,
      sort_field,
      sort_direction,
      publication_types,
      published_date_from,
      published_date_to,
      open_resources,
    }) => {
      return (async () => {
        try {
          const body = buildPublicationSearchBody({
            query,
            page,
            page_size,
            sort_field,
            sort_direction,
            publication_types,
            published_date_from,
            published_date_to,
            open_resources,
          });
          const cacheKey = makeCacheKey("bn_search_publications", body as Record<string, unknown>);
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            SEARCH_API,
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
            },
            SEARCH_CACHE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const report = createToolErrorReport(err, {
            toolName: "bn_search_publications",
            operation: "POST /api/search",
            url: SEARCH_API,
            params: {
              query,
              page,
              page_size,
              sort_field,
              sort_direction,
              publication_types,
            },
            responseBody:
              err instanceof Error && "responseBody" in err
                ? (err as CacheError).responseBody
                : undefined,
            httpStatus:
              err instanceof Error && "status" in err ? (err as CacheError).status : undefined,
            headers:
              err instanceof Error && "headers" in err ? (err as CacheError).headers : undefined,
          });
          return formatToolErrorResponse(report, true);
        }
      })();
    },
  );

  // ── bn_search_articles ────────────────────────────────────────────────────
  server.tool(
    "bn_search_articles",
    [
      "Zbieranie OAI-PMH ListRecords dla Biblioteki Nauki — to NIE jest wyszukiwanie pełnotekstowe po słowach kluczowych.",
      "Użyj tego narzędzia, by wylistować rekordy po opcjonalnym zakresie dat (from_date/until_date) i/lub zbiorze OAI (identyfikator czasopisma z ListSets)",
      "lub stronicować za pomocą resumption_token. OAI-PMH nie przyjmuje zapytania tekstowego; do wyszukiwania po słowach kluczowych użyj bn_search_publications.",
      "Zwraca surowy XML. metadata_format=oai_dc (Dublin Core) lub jats (abstrakty, słowa kluczowe, odnośniki).",
    ].join(" "),
    {
      from_date: z.string().optional().describe("Najwcześniejsza data publikacji w formacie YYYY-MM-DD"),
      until_date: z.string().optional().describe("Najpóźniejsza data publikacji w formacie YYYY-MM-DD"),
      set: z
        .string()
        .optional()
        .describe("Identyfikator zbioru OAI, by ograniczyć wyniki do czasopisma lub dyscypliny."),
      metadata_format: z
        .enum(["oai_dc", "jats"])
        .default("oai_dc")
        .describe("oai_dc — Dublin Core (mniejszy, szybszy); jats — pełne metadane strukturalne."),
      resumption_token: z
        .string()
        .optional()
        .describe("Token zwrócony w poprzedniej odpowiedzi do pobrania następnej strony."),
      minimize_pii: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Gdy true, redaguje wzorce ORCID, e-mail, telefon i PESEL dla zastosowań wrażliwych na prywatność.",
        ),
    },
    async ({ from_date, until_date, set, metadata_format, resumption_token, minimize_pii }) => {
      return (async () => {
        try {
          let url: string;

          if (resumption_token) {
            // When a resumption token is present, no other params are allowed.
            url = `${OAI_BASE}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumption_token)}`;
          } else {
            const params = new URLSearchParams({
              verb: "ListRecords",
              metadataPrefix: metadata_format,
            });
            if (from_date) params.set("from", from_date);
            if (until_date) params.set("until", until_date);
            if (set) params.set("set", set);
            url = `${OAI_BASE}?${params}`;
          }

          const cacheKey = makeCacheKey("bn_search", { url });
          let xml = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);

          // Robustness fallback: if a restrictive set yields no records, retry once without set.
          if (!resumption_token && set && hasNoRecordsMatch(xml)) {
            const fallbackParams = new URLSearchParams({
              verb: "ListRecords",
              metadataPrefix: metadata_format,
            });
            if (from_date) fallbackParams.set("from", from_date);
            if (until_date) fallbackParams.set("until", until_date);
            const fallbackUrl = `${OAI_BASE}?${fallbackParams}`;
            const fallbackKey = makeCacheKey("bn_search_fallback", {
              from_date,
              until_date,
              metadata_format,
            });
            xml = await cachedFetch(env.CACHE_KV, fallbackKey, fallbackUrl, {}, CACHE_TTL);
          }

          return {
            content: [{ type: "text", text: minimize_pii ? scrubPiiXml(xml) : xml }],
          };
        } catch (err) {
          const report = createToolErrorReport(err, {
            toolName: "bn_search_articles",
            operation: "OAI-PMH ListRecords",
            url: OAI_BASE,
            params: { from_date, until_date, set, metadata_format },
            responseBody:
              err instanceof Error && "responseBody" in err
                ? (err as CacheError).responseBody
                : undefined,
            httpStatus:
              err instanceof Error && "status" in err ? (err as CacheError).status : undefined,
            headers:
              err instanceof Error && "headers" in err ? (err as CacheError).headers : undefined,
          });
          return formatToolErrorResponse(report, true);
        }
      })();
    },
  );

  // ── bn_get_article ────────────────────────────────────────────────────────
  server.tool(
    "bn_get_article",
    [
      "Pobiera pełny rekord metadanych jednego artykułu z Biblioteki Nauki po numerycznym identyfikatorze.",
      "Domyślnie format jats, który zawiera abstrakt, słowa kluczowe, afilacje i odnośniki.",
    ].join(" "),
    {
      article_id: z
        .string()
        .describe("Numeryczny identyfikator artykułu, jak w wynikach wyszukiwania, np. 1968869"),
      metadata_format: z
        .enum(["jats", "oai_dc"])
        .default("jats")
        .describe("jats — pełne metadane strukturalne (zalecane); oai_dc — Dublin Core."),
    },
    async ({ article_id, metadata_format }) => {
      return (async () => {
        try {
          const identifier = `oai:bibliotekanauki.pl:${article_id}`;
          const params = new URLSearchParams({
            verb: "GetRecord",
            metadataPrefix: metadata_format,
            identifier,
          });
          const url = `${OAI_BASE}?${params}`;
          const cacheKey = makeCacheKey("bn_article", { article_id, metadata_format });
          const xml = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
          return { content: [{ type: "text", text: xml }] };
        } catch (err) {
          const report = createToolErrorReport(err, {
            toolName: "bn_get_article",
            operation: "OAI-PMH GetRecord",
            url: OAI_BASE,
            params: { article_id, metadata_format },
            responseBody:
              err instanceof Error && "responseBody" in err
                ? (err as CacheError).responseBody
                : undefined,
            httpStatus:
              err instanceof Error && "status" in err ? (err as CacheError).status : undefined,
            headers:
              err instanceof Error && "headers" in err ? (err as CacheError).headers : undefined,
          });
          return formatToolErrorResponse(report, true);
        }
      })();
    },
  );
}
