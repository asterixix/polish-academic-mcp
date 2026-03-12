/**
 * RUJ — Jagiellonian University Repository.
 * 300 000+ records (articles, monographs, dissertations, chapters).
 * Runs DSpace 7, responds with HAL+JSON.  Anonymous read access for all public items.
 *
 * Tools:
 *   ruj_search    — full-text + faceted discovery search.
 *   ruj_get_item  — single item metadata by UUID.
 *
 * IMPORTANT: GET /server/api/core/items (list all) is admin-only → always use
 * the /discover/search/objects endpoint.
 *
 * Filter schema derived from:
 *   GET https://ruj.uj.edu.pl/server/api/discover/search
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const API_BASE = "https://ruj.uj.edu.pl/server/api";
const JSON_HEADERS = { Accept: "application/json" };
const CACHE_TTL = 86_400; // 24 h

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

export function registerRujTools(server: McpServer, env: Env): void {
  // ── ruj_search ────────────────────────────────────────────────────────────
  server.tool(
    "ruj_search",
    [
      "Search publications in the Jagiellonian University Repository (RUJ) via DSpace 7 discovery.",
      "Supports full-text search with 14 filter fields, 7 sort options, and 0-based pagination.",
      "Results are HAL+JSON with hit highlights and full Dublin Core metadata.",
      "Each filter value may include an explicit operator suffix separated by a comma",
      "(e.g. 'Smith,equals'); if omitted the documented default operator is applied.",
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
      // Default operator shown in parentheses; append ',operator' to override.
      itemtype: z
        .string()
        .optional()
        .describe(
          "Item type filter (default op: equals). " +
          "Known values: JournalArticle, Book, BookSection, JournalEditorship.",
        ),
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
      affiliation: z
        .string()
        .optional()
        .describe(
          "Author institutional affiliation filter (default op: contains).",
        ),
      affiliation_em: z
        .string()
        .optional()
        .describe(
          "Corresponding-author affiliation filter (default op: contains). " +
          "Maps to DSpace field affiliationEm.",
        ),
      journal_title: z
        .string()
        .optional()
        .describe(
          "Journal title filter (default op: contains). " +
          "Maps to DSpace field journalTitle.",
        ),
      subtype: z
        .string()
        .optional()
        .describe("Publication subtype filter (default op: equals)."),
      entity_type: z
        .string()
        .optional()
        .describe(
          "DSpace entity type filter (default op: equals). " +
          "Maps to DSpace field entityType.",
        ),
      pbn_discipline: z
        .string()
        .optional()
        .describe(
          "PBN scientific discipline filter (default op: equals). " +
          "Maps to DSpace field pbndiscipline.",
        ),
      has_full_text: z
        .boolean()
        .optional()
        .describe(
          "When true, restrict to items that have files in the original bundle " +
          "(i.e. full-text available in the repository). " +
          "Maps to DSpace field has_content_in_original_bundle.",
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
      date_submitted: z
        .string()
        .optional()
        .describe(
          "Submission date filter (default op: equals). " +
          "Maps to DSpace field dateSubmitted.",
        ),
    },
    async ({
      query, page, size, sort,
      itemtype, author, subject, language,
      affiliation, affiliation_em, journal_title,
      subtype, entity_type, pbn_discipline, has_full_text,
      date_issued, date_accessioned, date_submitted,
    }) => {
      try {
        const params = new URLSearchParams({
          query,
          page: String(page),
          size: String(size),
          sort,
        });

        if (itemtype)        addFilter(params, "itemtype",                         itemtype,        "equals");
        if (author)          addFilter(params, "author",                           author,          "contains");
        if (subject)         addFilter(params, "subject",                          subject,         "equals");
        if (language)        addFilter(params, "language",                         language,        "equals");
        if (affiliation)     addFilter(params, "affiliation",                      affiliation,     "contains");
        if (affiliation_em)  addFilter(params, "affiliationEm",                    affiliation_em,  "contains");
        if (journal_title)   addFilter(params, "journalTitle",                     journal_title,   "contains");
        if (subtype)         addFilter(params, "subtype",                          subtype,         "equals");
        if (entity_type)     addFilter(params, "entityType",                       entity_type,     "equals");
        if (pbn_discipline)  addFilter(params, "pbndiscipline",                    pbn_discipline,  "equals");
        if (date_issued)     addFilter(params, "dateIssued",                       date_issued,     "equals");
        if (date_accessioned) addFilter(params, "dateAccessioned",                 date_accessioned, "equals");
        if (date_submitted)  addFilter(params, "dateSubmitted",                    date_submitted,  "equals");
        if (has_full_text !== undefined) {
          params.append("f.has_content_in_original_bundle", `${has_full_text},equals`);
        }

        const url = `${API_BASE}/discover/search/objects?${params}`;
        const cacheKey = makeCacheKey("ruj_search", {
          query, page, size, sort,
          itemtype, author, subject, language,
          affiliation, affiliation_em, journal_title,
          subtype, entity_type, pbn_discipline, has_full_text,
          date_issued, date_accessioned, date_submitted,
        });
        const data = await cachedFetch(
          env.CACHE_KV,
          cacheKey,
          url,
          { headers: JSON_HEADERS },
          CACHE_TTL,
        );
        return { content: [{ type: "text", text: data }] };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Error searching RUJ: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── ruj_get_item ──────────────────────────────────────────────────────────
  server.tool(
    "ruj_get_item",
    [
      "Retrieve full metadata for a single item in the Jagiellonian University Repository by its UUID.",
      "The UUID is found in the 'uuid' field of ruj_search results.",
    ].join(" "),
    {
      uuid: z
        .string()
        .describe("Item UUID from ruj_search results, e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"),
    },
    async ({ uuid }) => {
      try {
        const url = `${API_BASE}/core/items/${uuid}`;
        const cacheKey = makeCacheKey("ruj_item", { uuid });
        const data = await cachedFetch(
          env.CACHE_KV,
          cacheKey,
          url,
          { headers: JSON_HEADERS },
          CACHE_TTL,
        );
        return { content: [{ type: "text", text: data }] };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Error fetching RUJ item ${uuid}: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
