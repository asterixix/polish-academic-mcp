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
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const API_BASE = "https://repo.agh.edu.pl/server/api";
const HANDLE_BASE = "https://repo.agh.edu.pl/handle";
const JSON_HEADERS = { Accept: "application/json" };
const CACHE_TTL = 86_400; // 24 h

const API_FIELDS = ["title", "author", "subject", "abstract", "date", "language", "doi", "keywords"];

/**
 * Append a DSpace discovery filter parameter.
 * If the caller already embedded a valid operator suffix (e.g. "Smith,equals")
 * it is used as-is; otherwise the defaultOp is appended.
 */
const VALID_OPS = new Set([
  "equals", "notequals", "contains", "notcontains",
  "authority", "notauthority", "query",
]);
function addFilter(
  params: URLSearchParams,
  field: string,
  value: string,
  defaultOp: string,
): void {
  const lastComma = value.lastIndexOf(",");
  const trailingToken = lastComma !== -1 ? value.slice(lastComma + 1) : "";
  params.append(
    `f.${field}`,
    VALID_OPS.has(trailingToken) ? value : `${value},${defaultOp}`,
  );
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
  return (arr as any[]).map(v => String(v?.value ?? "")).filter(Boolean);
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
      const it  = obj?._embedded?.indexableObject ?? {};
      const m   = it.metadata ?? {};
      const abs = dcFirst(m, "dc.description.abstract");
      const h: string = it.handle ?? "";
      return {
        uuid:          it.uuid as string | undefined,
        handle:        h || undefined,
        url:           h ? `${HANDLE_BASE}/${h}` : undefined,
        title:         dcFirst(m, "dc.title") || undefined,
        titleAlt:      dcFirst(m, "dc.title.alternative") || undefined,
        authors:       dcAll(m, "dc.contributor.author"),
        type:          dcFirst(m, "dc.type") || undefined,
        language:      dcFirst(m, "dc.language.iso") || dcFirst(m, "dc.language") || undefined,
        dateIssued:    dcFirst(m, "dc.date.issued") || undefined,
        dateSubmitted: dcFirst(m, "dc.date.submitted") || undefined,
        publisher:     dcFirst(m, "dc.publisher") || undefined,
        subject:       dcFirst(m, "dc.subject") || undefined,
        abstract:      abs ? trunc(abs, 500) : undefined,
      };
    });
    return JSON.stringify(
      { totalElements: p.totalElements, page: { number: p.number, size: p.size, totalPages: p.totalPages }, items },
      null, 2,
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
    const m  = it?.metadata ?? {};
    const h: string = it.handle ?? "";
    return JSON.stringify(
      {
        uuid:            it.uuid as string | undefined,
        handle:          h || undefined,
        url:             h ? `${HANDLE_BASE}/${h}` : undefined,
        title:           dcFirst(m, "dc.title") || undefined,
        titleAlt:        dcFirst(m, "dc.title.alternative") || undefined,
        authors:         dcAll(m, "dc.contributor.author"),
        advisors:        dcAll(m, "dc.contributor.advisor"),
        type:            dcFirst(m, "dc.type") || undefined,
        language:        dcFirst(m, "dc.language.iso") || dcFirst(m, "dc.language") || undefined,
        dateIssued:      dcFirst(m, "dc.date.issued") || undefined,
        dateSubmitted:   dcFirst(m, "dc.date.submitted") || undefined,
        dateAccessioned: dcFirst(m, "dc.date.accessioned") || undefined,
        publisher:       dcFirst(m, "dc.publisher") || undefined,
        doi:             dcFirst(m, "dc.identifier.doi") || undefined,
        identifierURI:   dcFirst(m, "dc.identifier.uri") || undefined,
        subjects:        dcAll(m, "dc.subject"),
        description:     dcFirst(m, "dc.description") || undefined,
        entityType:      (it.entityType as string | undefined) || undefined,
        inArchive:       it.inArchive as boolean | undefined,
        lastModified:    (it.lastModified as string | undefined) || undefined,
        abstract:        dcFirst(m, "dc.description.abstract") || undefined,
      },
      null, 2,
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
      "Search publications in the AGH University of Krakow Repository (repo.agh.edu.pl) via DSpace 7 discovery.",
      "Covers theses, dissertations, articles, technical reports, and monographs from AGH.",
      "Supports full-text search with filter fields, sort options, and 0-based pagination.",
      "Results are HAL+JSON with full Dublin Core metadata, compacted into a readable summary.",
      "Each filter value may include an explicit operator suffix separated by a comma",
      "(e.g. 'Kowalski,equals'); if omitted the documented default operator is applied.",
      "Supported operators: equals, notequals, contains, notcontains, authority, notauthority, query.",
    ].join(" "),
    {
      // ── Core ───────────────────────────────────────────────────────────────
      query: z.string().describe("Full-text search terms"),
      page: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Page number — 0-based"),
      size: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Results per page (1–50)"),
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
        .describe("Sort field and direction"),

      // ── Filters (all optional) ─────────────────────────────────────────────
      author: z
        .string()
        .optional()
        .describe("Author name filter (default op: contains)."),
      subject: z
        .string()
        .optional()
        .describe("Subject / keyword filter (default op: equals)."),
      language: z
        .string()
        .optional()
        .describe(
          "Language code filter (default op: equals). E.g. 'pl', 'en'.",
        ),
      itemtype: z
        .string()
        .optional()
        .describe(
          "Item type filter (default op: equals). " +
          "Common values: Thesis, Article, Book, Technical Report.",
        ),
      date_issued: z
        .string()
        .optional()
        .describe(
          "Issue date filter (default op: equals). " +
          "For ranges use the query operator with Solr syntax, " +
          "e.g. '[2020-01-01 TO 2023-12-31],query'. " +
          "Maps to DSpace field dateIssued.",
        ),
      date_accessioned: z
        .string()
        .optional()
        .describe(
          "Accession date filter (default op: equals). " +
          "Maps to DSpace field dateAccessioned.",
        ),
      has_full_text: z
        .boolean()
        .optional()
        .describe(
          "When true, restrict to items that have files in the original bundle " +
          "(i.e. full-text available in the repository). " +
          "Maps to DSpace field has_content_in_original_bundle.",
        ),
    },
    async ({
      query, page, size, sort,
      author, subject, language, itemtype,
      date_issued, date_accessioned, has_full_text,
    }) => {
      return withToolExecutionSpan(
        {
          toolName: "agh_search",
          params: { query, page, size, sort, author, subject, language, itemtype, date_issued, date_accessioned, has_full_text } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "agh");
          try {
            const searchParams = new URLSearchParams({
              query,
              page: String(page),
              size: String(size),
              sort,
            });

            if (author)           addFilter(searchParams, "author",       author,           "contains");
            if (subject)          addFilter(searchParams, "subject",      subject,          "equals");
            if (language)         addFilter(searchParams, "language",     language,         "equals");
            if (itemtype)         addFilter(searchParams, "itemtype",     itemtype,         "equals");
            if (date_issued)      addFilter(searchParams, "dateIssued",   date_issued,      "equals");
            if (date_accessioned) addFilter(searchParams, "dateAccessioned", date_accessioned, "equals");
            if (has_full_text !== undefined) {
              searchParams.append("f.has_content_in_original_bundle", `${has_full_text},equals`);
            }

            const url = `${API_BASE}/discover/search/objects?${searchParams}`;
            const cacheKey = makeCacheKey("agh_search", {
              query, page, size, sort,
              author, subject, language, itemtype,
              date_issued, date_accessioned, has_full_text,
            });
            const data = await cachedFetch(
              env.CACHE_KV,
              cacheKey,
              url,
              { headers: JSON_HEADERS },
              CACHE_TTL,
            );
            return { content: [{ type: "text", text: summarizeSearch(data) }] };
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error searching AGH repository: ${e instanceof Error ? e.message : String(e)}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── agh_get_item ──────────────────────────────────────────────────────────
  server.tool(
    "agh_get_item",
    [
      "Retrieve full metadata for a single item in the AGH University of Krakow Repository by its UUID.",
      "The UUID is found in the 'uuid' field of agh_search results.",
      "Returns Dublin Core metadata including title, authors, abstract, type, date, DOI, and handle URL.",
    ].join(" "),
    {
      uuid: z
        .string()
        .describe("Item UUID from agh_search results, e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"),
    },
    async ({ uuid }) => {
      return withToolExecutionSpan(
        {
          toolName: "agh_get_item",
          params: { uuid } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(uuid),
        },
        async (span) => {
          span.setAttribute("mcp.source", "agh");
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
                  text: `Error fetching AGH item ${uuid}: ${e instanceof Error ? e.message : String(e)}`,
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
