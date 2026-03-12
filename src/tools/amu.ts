/**
 * AMU — Adam Mickiewicz University Repository (repozytorium.amu.edu.pl).
 * Runs DSpace 7, responds with HAL+JSON.  Anonymous read access for all public items.
 *
 * Tools:
 *   amu_search    — full-text + faceted discovery search.
 *   amu_get_item  — single item metadata by UUID.
 *
 * Available discovery filters (from /server/api/discover/search):
 *   title, author, subject, dateIssued, has_content_in_original_bundle, entityType, access_status
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const API_BASE = "https://repozytorium.amu.edu.pl/server/api";
const BASE_URL  = "https://repozytorium.amu.edu.pl";
const JSON_HEADERS = { Accept: "application/json" };
const CACHE_TTL = 86_400; // 24 h

const API_FIELDS = ["title", "author", "subject", "abstract", "date", "language", "doi", "keywords"];

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

function summarizeSearch(raw: string): string {
  try {
    const json = JSON.parse(raw);
    const sr = json?._embedded?.searchResult;
    const objects: any[] = sr?._embedded?.objects ?? [];
    const p = sr?.page ?? {};
    const items = objects.map((obj: any) => {
      const it = obj?._embedded?.indexableObject ?? {};
      const m  = it.metadata ?? {};
      const abs = dcFirst(m, "dc.description.abstract");
      const h: string = it.handle ?? "";
      return {
        uuid:       it.uuid as string | undefined,
        handle:     h || undefined,
        url:        h ? `${BASE_URL}/handle/${h}` : (it.uuid ? `${BASE_URL}/items/${it.uuid as string}` : undefined),
        title:      dcFirst(m, "dc.title") || undefined,
        authors:    dcAll(m, "dc.contributor.author"),
        type:       dcFirst(m, "dc.type") || undefined,
        language:   dcFirst(m, "dc.language.iso") || undefined,
        dateIssued: dcFirst(m, "dc.date.issued") || undefined,
        subject:    dcFirst(m, "dc.subject") || undefined,
        abstract:   abs ? trunc(abs, 500) : undefined,
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

function summarizeItem(raw: string): string {
  try {
    const it = JSON.parse(raw);
    const m  = it?.metadata ?? {};
    const h: string = it.handle ?? "";
    return JSON.stringify(
      {
        uuid:        it.uuid as string | undefined,
        handle:      h || undefined,
        url:         h ? `${BASE_URL}/handle/${h}` : (it.uuid ? `${BASE_URL}/items/${it.uuid as string}` : undefined),
        title:       dcFirst(m, "dc.title") || undefined,
        authors:     dcAll(m, "dc.contributor.author"),
        type:        dcFirst(m, "dc.type") || undefined,
        language:    dcFirst(m, "dc.language.iso") || undefined,
        dateIssued:  dcFirst(m, "dc.date.issued") || undefined,
        subject:     dcAll(m, "dc.subject"),
        doi:         dcFirst(m, "dc.identifier.doi") || undefined,
        uri:         dcFirst(m, "dc.identifier.uri") || undefined,
        publisher:   dcFirst(m, "dc.publisher") || undefined,
        entityType:  (it.entityType as string | undefined) || undefined,
        lastModified: (it.lastModified as string | undefined) || undefined,
        abstract:    dcFirst(m, "dc.description.abstract") || undefined,
      },
      null, 2,
    );
  } catch {
    return raw;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function registerAmuTools(server: McpServer, env: Env): void {
  // ── amu_search ────────────────────────────────────────────────────────────
  server.tool(
    "amu_search",
    [
      "Search publications in the Adam Mickiewicz University Repository (repozytorium.amu.edu.pl) via DSpace 7 discovery.",
      "Supports full-text search with filters for author, subject, date, entity type, and full-text availability.",
      "Results are HAL+JSON with Dublin Core metadata.",
      "Each filter value may include an explicit operator suffix (e.g. 'Smith,equals');",
      "if omitted the documented default operator is applied.",
      "Supported operators: equals, notequals, contains, notcontains, authority, notauthority, query.",
    ].join(" "),
    {
      query: z.string().describe("Full-text search terms"),
      page: z.number().int().min(0).default(0).describe("Page number — 0-based"),
      size: z.number().int().min(1).max(50).default(10).describe("Results per page (1–50)"),
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
      author: z.string().optional().describe("Author name filter (default op: contains)."),
      subject: z.string().optional().describe("Subject / keyword filter (default op: equals)."),
      title: z.string().optional().describe("Title filter (default op: contains)."),
      date_issued: z
        .string()
        .optional()
        .describe(
          "Issue date filter (default op: equals). For ranges use Solr syntax, e.g. '[2020-01-01 TO 2023-12-31],query'.",
        ),
      entity_type: z
        .string()
        .optional()
        .describe("DSpace entity type filter (default op: equals). E.g. 'Item', 'Publication'."),
      has_full_text: z
        .boolean()
        .optional()
        .describe("When true, restrict to items with files in the original bundle (full-text available)."),
    },
    async ({ query, page, size, sort, author, subject, title, date_issued, entity_type, has_full_text }) => {
      return withToolExecutionSpan(
        {
          toolName: "amu_search",
          params: { query, page, size, sort, author, subject, title, date_issued, entity_type, has_full_text } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "amu");
          try {
            const searchParams = new URLSearchParams({
              query,
              page: String(page),
              size: String(size),
              sort,
            });
            if (author)       addFilter(searchParams, "author",      author,      "contains");
            if (subject)      addFilter(searchParams, "subject",     subject,     "equals");
            if (title)        addFilter(searchParams, "title",       title,       "contains");
            if (date_issued)  addFilter(searchParams, "dateIssued",  date_issued, "equals");
            if (entity_type)  addFilter(searchParams, "entityType",  entity_type, "equals");
            if (has_full_text !== undefined) {
              searchParams.append("f.has_content_in_original_bundle", `${has_full_text},equals`);
            }

            const url = `${API_BASE}/discover/search/objects?${searchParams}`;
            const cacheKey = makeCacheKey("amu_search", { query, page, size, sort, author, subject, title, date_issued, entity_type, has_full_text });
            const data = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: JSON_HEADERS }, CACHE_TTL);
            return { content: [{ type: "text", text: summarizeSearch(data) }] };
          } catch (e) {
            return {
              content: [{ type: "text", text: `Error searching AMU repository: ${e instanceof Error ? e.message : String(e)}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── amu_get_item ──────────────────────────────────────────────────────────
  server.tool(
    "amu_get_item",
    [
      "Retrieve full metadata for a single item in the Adam Mickiewicz University Repository by its UUID.",
      "The UUID is found in the 'uuid' field of amu_search results.",
    ].join(" "),
    {
      uuid: z
        .string()
        .describe("Item UUID from amu_search results, e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"),
    },
    async ({ uuid }) => {
      return withToolExecutionSpan(
        {
          toolName: "amu_get_item",
          params: { uuid } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(uuid),
        },
        async (span) => {
          span.setAttribute("mcp.source", "amu");
          try {
            const url = `${API_BASE}/core/items/${uuid}`;
            const cacheKey = makeCacheKey("amu_item", { uuid });
            const data = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: JSON_HEADERS }, CACHE_TTL);
            return { content: [{ type: "text", text: summarizeItem(data) }] };
          } catch (e) {
            return {
              content: [{ type: "text", text: `Error fetching AMU item ${uuid}: ${e instanceof Error ? e.message : String(e)}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
