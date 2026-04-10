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
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";
import {
  createToolErrorReport,
  recordErrorToSpan,
  formatToolErrorResponse,
} from "../tool-error-handling.js";

const OAI_BASE = "https://bibliotekanauki.pl/api/oai/articles";
/** Public website search API (JSON). Supports full-text `generalSearchString`; not documented on OAI-PMH page. */
const SEARCH_API = "https://bibliotekanauki.pl/api/search";
const CACHE_TTL = 86_400; // 24 h — academic records rarely change
const SEARCH_CACHE_TTL = 3_600; // 1 h — search index may shift

const API_FIELDS = [
  "title",
  "author",
  "subject",
  "abstract",
  "date",
  "language",
  "doi",
  "publisher",
];

const PUBLICATION_TYPES = [
  "ARTICLE",
  "SIMPLE_BOOK",
  "COLLECTIVE_WORK",
  "CHAPTER",
] as const;
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
      "Full-text search in Biblioteka Nauki (Polish open-access articles, books, chapters).",
      "Uses the public JSON search API (same as the website). Prefer this tool when the user gives keywords,",
      "topics, author names, or titles. For harvesting by date range or OAI journal set without keywords,",
      "use bn_search_articles (OAI-PMH XML) instead.",
      "Returns JSON with hits, snippets (mainTitleSnippets, fullTextSnippets), and totalResults.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe(
          "Search phrase (Polish or English). Maps to the portal field generalSearchString — titles, abstracts, full text where indexed.",
        ),
      page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Results per page (max 50)."),
      sort_field: z
        .enum(["score", "publishedDate"])
        .default("score")
        .describe("score — relevance; publishedDate — publication date."),
      sort_direction: z
        .enum(["ASC", "DESC"])
        .default("DESC")
        .describe("Sort direction."),
      publication_types: z
        .array(z.enum(PUBLICATION_TYPES))
        .optional()
        .describe(
          "Restrict to publication kinds: ARTICLE (journals), SIMPLE_BOOK / COLLECTIVE_WORK / CHAPTER (books). Omit to search all.",
        ),
      published_date_from: z
        .string()
        .optional()
        .describe("Optional lower bound YYYY-MM-DD (inclusive)."),
      published_date_to: z
        .string()
        .optional()
        .describe("Optional upper bound YYYY-MM-DD (inclusive)."),
      open_resources: z
        .boolean()
        .optional()
        .describe("When true, prefer diamond-open / openly licensed resources (portal flag)."),
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
      return withToolExecutionSpan(
        {
          toolName: "bn_search_publications",
          params: {
            query,
            page,
            page_size,
            sort_field,
            sort_direction,
            publication_types,
            published_date_from,
            published_date_to,
            open_resources,
          } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "biblioteka-nauki");
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
              responseBody: err instanceof Error && "responseBody" in err ? (err as CacheError).responseBody : undefined,
              httpStatus: err instanceof Error && "status" in err ? (err as CacheError).status : undefined,
              headers: err instanceof Error && "headers" in err ? (err as CacheError).headers : undefined,
            });
            recordErrorToSpan(span, report);
            return formatToolErrorResponse(report, true);
          }
        },
      );
    },
  );

  // ── bn_search_articles ────────────────────────────────────────────────────
  server.tool(
    "bn_search_articles",
    [
      "OAI-PMH ListRecords harvest for Biblioteka Nauki — NOT full-text keyword search.",
      "Use this to list records by optional date range (from_date/until_date) and/or OAI set (journal id from ListSets),",
      "or to page with resumption_token. There is no query string in OAI-PMH; for keyword/topic search use bn_search_publications.",
      "Returns raw XML. metadata_format=oai_dc (Dublin Core) or jats (abstracts, keywords, references).",
    ].join(" "),
    {
      from_date: z.string().optional().describe("Earliest publication date, format YYYY-MM-DD"),
      until_date: z.string().optional().describe("Latest publication date, format YYYY-MM-DD"),
      set: z
        .string()
        .optional()
        .describe("OAI set identifier to scope results to a journal or discipline."),
      metadata_format: z
        .enum(["oai_dc", "jats"])
        .default("oai_dc")
        .describe("oai_dc — Dublin Core (smaller, faster); jats — full structured metadata."),
      resumption_token: z
        .string()
        .optional()
        .describe("Token returned in a previous response for fetching the next page."),
      minimize_pii: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "When true, redacts ORCID/email/phone/PESEL-like patterns for privacy-sensitive use cases.",
        ),
    },
    async ({ from_date, until_date, set, metadata_format, resumption_token, minimize_pii }) => {
      return withToolExecutionSpan(
        {
          toolName: "bn_search_articles",
          params: { from_date, until_date, set, metadata_format, resumption_token, minimize_pii } as Record<
            string,
            unknown
          >,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(String(set ?? from_date ?? "")),
        },
        async (span) => {
          span.setAttribute("mcp.source", "biblioteka-nauki");
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
              responseBody: err instanceof Error && "responseBody" in err ? (err as CacheError).responseBody : undefined,
              httpStatus: err instanceof Error && "status" in err ? (err as CacheError).status : undefined,
              headers: err instanceof Error && "headers" in err ? (err as CacheError).headers : undefined,
            });
            recordErrorToSpan(span, report);
            return formatToolErrorResponse(report, true);
          }
        },
      );
    },
  );

  // ── bn_get_article ────────────────────────────────────────────────────────
  server.tool(
    "bn_get_article",
    [
      "Fetch the full metadata record for a single article from Biblioteka Nauki by its numeric ID.",
      "Defaults to jats format which includes abstract, keywords, affiliations, and references.",
    ].join(" "),
    {
      article_id: z
        .string()
        .describe("Numeric article ID as shown in search results, e.g. 1968869"),
      metadata_format: z
        .enum(["jats", "oai_dc"])
        .default("jats")
        .describe("jats — full structured metadata (recommended); oai_dc — Dublin Core."),
    },
    async ({ article_id, metadata_format }) => {
      return withToolExecutionSpan(
        {
          toolName: "bn_get_article",
          params: { article_id, metadata_format } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(article_id),
        },
        async (span) => {
          span.setAttribute("mcp.source", "biblioteka-nauki");
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
              responseBody: err instanceof Error && "responseBody" in err ? (err as CacheError).responseBody : undefined,
              httpStatus: err instanceof Error && "status" in err ? (err as CacheError).status : undefined,
              headers: err instanceof Error && "headers" in err ? (err as CacheError).headers : undefined,
            });
            recordErrorToSpan(span, report);
            return formatToolErrorResponse(report, true);
          }
        },
      );
    },
  );
}
