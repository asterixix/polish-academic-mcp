/**
 * GUS Bank Danych Lokalnych (BDL) — regional and national statistics (BDL web UI: bdl.stat.gov.pl).
 * REST API v1: https://bdl.stat.gov.pl/api/v1/ — JSON/XML, OpenAPI at .../swagger/doc/swagger.json
 *
 * Anonymous access works; optional env BDL_CLIENT_ID sets header X-ClientId for higher rate limits
 * (register at api.stat.gov.pl). Responses are cached to reduce duplicate calls.
 *
 * Tools:
 *   bdl_search_subjects      — thematic tree search by name fragment.
 *   bdl_search_variables     — search statistical variables (N1…N5 text, subject, level, years).
 *   bdl_search_units         — search territorial units (name, level, year).
 *   bdl_get_variable         — metadata for one variable by numeric id.
 *   bdl_get_data_by_variable — values for one variable across units (unit-level, years, paging).
 *   bdl_get_data_by_unit     — values for one unit for one or more variable ids.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const API_BASE = "https://bdl.stat.gov.pl/api/v1";
const JSON_HEADERS = { Accept: "application/json" } as const;
/** Search / metadata: 1 h — same order of magnitude as dane.gov.pl */
const SEARCH_TTL = 3_600; // seconds — search / metadata
const DATA_TTL = 3_600; // tabular responses

const API_FIELDS = ["id", "name", "year", "val"];

function bdlHeaders(env: Env): Record<string, string> {
  const h: Record<string, string> = { ...JSON_HEADERS };
  if (env.BDL_CLIENT_ID?.trim()) {
    h["X-ClientId"] = env.BDL_CLIENT_ID.trim();
  }
  return h;
}

function appendYearParams(params: URLSearchParams, years: number[] | undefined): void {
  if (!years?.length) return;
  for (const y of years) params.append("year", String(y));
}

const subjectSort = z
  .enum([
    "Id",
    "-Id",
    "Id,Name",
    "Id,-Name",
    "-Id,Name",
    "-Id,-Name",
    "Name",
    "-Name",
    "Name,Id",
    "Name,-Id",
    "-Name,Id",
    "-Name,-Id",
  ])
  .optional();

const variableSort = z
  .enum([
    "Id",
    "-Id",
    "Id,SubjectId",
    "Id,-SubjectId",
    "-Id,SubjectId",
    "-Id,-SubjectId",
    "SubjectId",
    "-SubjectId",
    "SubjectId,Id",
    "SubjectId,-Id",
    "-SubjectId,Id",
    "-SubjectId,-Id",
  ])
  .optional();

export function registerBdlTools(server: McpServer, env: Env): void {
  // ── bdl_search_subjects ───────────────────────────────────────────────────
  server.tool(
    "bdl_search_subjects",
    [
      "Search BDL (GUS) thematic subjects by name fragment. Use to discover subject IDs before listing",
      "variables or drilling into the tree. API: GET /subjects/search. Pagination is 0-based.",
      "Returns JSON (subject id, name, children ids, levels).",
    ].join(" "),
    {
      name: z.string().describe("Fragment of subject name (Polish or English labels depending on lang)"),
      page: z.number().int().min(0).default(0).describe("Page index — 0-based"),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Results per page (max 100)"),
      sort: subjectSort.describe("Sort order (optional)"),
      lang: z.enum(["pl", "en"]).default("pl").describe("Response language"),
    },
    async ({ name, page, page_size, sort, lang }) => {
      return withToolExecutionSpan(
        {
          toolName: "bdl_search_subjects",
          params: { name, page, page_size, sort, lang } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(name),
        },
        async (span) => {
          span.setAttribute("mcp.source", "bdl-gus");
          try {
            const params = new URLSearchParams({
              name,
              page: String(page),
              "page-size": String(page_size),
              lang,
            });
            if (sort) params.set("sort", sort);
            const url = `${API_BASE}/subjects/search?${params}`;
            const key = makeCacheKey("bdl_search_subjects", { name, page, page_size, sort, lang });
            const text = await cachedFetch(env.CACHE_KV, key, url, { headers: bdlHeaders(env) }, SEARCH_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling bdl_search_subjects: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── bdl_search_variables ──────────────────────────────────────────────────
  server.tool(
    "bdl_search_variables",
    [
      "Search BDL statistical variables (characteristics). Filter by name text (N1…N5), subject-id,",
      "level, and years. Use results' numeric id with bdl_get_data_by_variable or bdl_get_data_by_unit.",
      "API: GET /variables/search. Pagination is 0-based.",
    ].join(" "),
    {
      name: z
        .string()
        .optional()
        .describe("Text matched in N1…N5 fields (e.g. Polish variable label fragment)"),
      subject_id: z
        .string()
        .optional()
        .describe("Parent subject id from bdl_search_subjects or BDL tree (e.g. P1312)"),
      level: z.number().int().optional().describe("Territorial / variable level filter when applicable"),
      years: z
        .array(z.number().int())
        .optional()
        .describe("Limit to variables available for these calendar years"),
      page: z.number().int().min(0).default(0).describe("Page index — 0-based"),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Results per page (max 100)"),
      sort: variableSort.describe("Sort order (optional)"),
      lang: z.enum(["pl", "en"]).default("pl").describe("Response language"),
    },
    async ({ name, subject_id, level, years, page, page_size, sort, lang }) => {
      return withToolExecutionSpan(
        {
          toolName: "bdl_search_variables",
          params: {
            name,
            subject_id,
            level,
            years,
            page,
            page_size,
            sort,
            lang,
          } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(name ?? ""),
        },
        async (span) => {
          span.setAttribute("mcp.source", "bdl-gus");
          try {
            const params = new URLSearchParams({
              page: String(page),
              "page-size": String(page_size),
              lang,
            });
            if (name) params.set("name", name);
            if (subject_id) params.set("subject-id", subject_id);
            if (level !== undefined) params.set("level", String(level));
            appendYearParams(params, years);
            if (sort) params.set("sort", sort);
            const url = `${API_BASE}/variables/search?${params}`;
            const key = makeCacheKey("bdl_search_variables", {
              name,
              subject_id,
              level,
              years,
              page,
              page_size,
              sort,
              lang,
            });
            const text = await cachedFetch(env.CACHE_KV, key, url, { headers: bdlHeaders(env) }, SEARCH_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling bdl_search_variables: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── bdl_search_units ──────────────────────────────────────────────────────
  server.tool(
    "bdl_search_units",
    [
      "Search BDL territorial units (voivodeships, counties, powiat, gmina, etc.) by name fragment.",
      "Optional level and year filters. Use returned unit id with bdl_get_data_by_unit.",
      "API: GET /units/search. Pagination is 0-based.",
    ].join(" "),
    {
      name: z
        .string()
        .optional()
        .describe("Fragment of unit name (e.g. city or voivodeship name)"),
      levels: z
        .array(z.number().int())
        .optional()
        .describe(
          "TERYT-level filters (e.g. 2 for voivodeship — confirm with BDL /levels metadata if needed)",
        ),
      years: z
        .array(z.number().int())
        .optional()
        .describe("Years for which the unit definition should exist"),
      page: z.number().int().min(0).default(0).describe("Page index — 0-based"),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Results per page (max 100)"),
      sort: subjectSort.describe("Sort order (optional)"),
      lang: z.enum(["pl", "en"]).default("pl").describe("Response language"),
    },
    async ({ name, levels, years, page, page_size, sort, lang }) => {
      return withToolExecutionSpan(
        {
          toolName: "bdl_search_units",
          params: { name, levels, years, page, page_size, sort, lang } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(name ?? ""),
        },
        async (span) => {
          span.setAttribute("mcp.source", "bdl-gus");
          try {
            const params = new URLSearchParams({
              page: String(page),
              "page-size": String(page_size),
              lang,
            });
            if (name) params.set("name", name);
            if (levels?.length) levels.forEach((l) => params.append("level", String(l)));
            appendYearParams(params, years);
            if (sort) params.set("sort", sort);
            const url = `${API_BASE}/units/search?${params}`;
            const key = makeCacheKey("bdl_search_units", {
              name,
              levels,
              years,
              page,
              page_size,
              sort,
              lang,
            });
            const text = await cachedFetch(env.CACHE_KV, key, url, { headers: bdlHeaders(env) }, SEARCH_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling bdl_search_units: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── bdl_get_variable ─────────────────────────────────────────────────────
  server.tool(
    "bdl_get_variable",
    [
      "Fetch metadata for one BDL variable by numeric id (from bdl_search_variables results).",
      "API: GET /variables/{id}.",
    ].join(" "),
    {
      variable_id: z.number().int().positive().describe("Variable id (integer)"),
      lang: z.enum(["pl", "en"]).default("pl").describe("Response language"),
    },
    async ({ variable_id, lang }) => {
      return withToolExecutionSpan(
        {
          toolName: "bdl_get_variable",
          params: { variable_id, lang } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "bdl-gus");
          try {
            const params = new URLSearchParams({ lang });
            const url = `${API_BASE}/variables/${variable_id}?${params}`;
            const key = makeCacheKey("bdl_get_variable", { variable_id, lang });
            const text = await cachedFetch(env.CACHE_KV, key, url, { headers: bdlHeaders(env) }, SEARCH_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling bdl_get_variable: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── bdl_get_data_by_variable ──────────────────────────────────────────────
  server.tool(
    "bdl_get_data_by_variable",
    [
      "Fetch statistical values for one variable across territorial units (e.g. all voivodeships).",
      "Set unit_level (BDL level id) and optionally unit_parent_id to scope results; year filters",
      "which periods are returned. Pagination is 0-based.",
      "API: GET /data/by-variable/{var-id}.",
    ].join(" "),
    {
      variable_id: z.number().int().positive().describe("Variable id"),
      years: z
        .array(z.number().int())
        .optional()
        .describe("Calendar years to include (repeat year= in API); omit for all available"),
      unit_level: z
        .number()
        .int()
        .optional()
        .describe(
          "BDL territorial level (e.g. 2 = voivodeship) — use BDL /levels or metadata if unsure",
        ),
      unit_parent_id: z
        .string()
        .optional()
        .describe("Parent territorial unit id to restrict children (e.g. a voivodeship code)"),
      aggregate_id: z
        .number()
        .int()
        .default(1)
        .describe("Aggregation level id (default 1)"),
      page: z.number().int().min(0).default(0).describe("Page index — 0-based"),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Rows per page"),
      lang: z.enum(["pl", "en"]).default("pl").describe("Response language"),
    },
    async ({
      variable_id,
      years,
      unit_level,
      unit_parent_id,
      aggregate_id,
      page,
      page_size,
      lang,
    }) => {
      return withToolExecutionSpan(
        {
          toolName: "bdl_get_data_by_variable",
          params: {
            variable_id,
            years,
            unit_level,
            unit_parent_id,
            aggregate_id,
            page,
            page_size,
            lang,
          } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "bdl-gus");
          try {
            const params = new URLSearchParams({
              page: String(page),
              "page-size": String(page_size),
              lang,
              aggregate_id: String(aggregate_id),
            });
            appendYearParams(params, years);
            if (unit_level !== undefined) params.set("unit-level", String(unit_level));
            if (unit_parent_id) params.set("unit-parent-id", unit_parent_id);
            const url = `${API_BASE}/data/by-variable/${variable_id}?${params}`;
            const key = makeCacheKey("bdl_get_data_by_variable", {
              variable_id,
              years,
              unit_level,
              unit_parent_id,
              aggregate_id,
              page,
              page_size,
              lang,
            });
            const text = await cachedFetch(env.CACHE_KV, key, url, { headers: bdlHeaders(env) }, DATA_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling bdl_get_data_by_variable: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── bdl_get_data_by_unit ───────────────────────────────────────────────────
  server.tool(
    "bdl_get_data_by_unit",
    [
      "Fetch values for one territorial unit for one or more variables (numeric variable ids).",
      "Requires at least one variable id. Optional year list and paging.",
      "API: GET /data/by-unit/{unit-id} with repeated var-id query params.",
    ].join(" "),
    {
      unit_id: z.string().describe("Territorial unit id from bdl_search_units (e.g. TERYT-style code)"),
      variable_ids: z
        .array(z.number().int().positive())
        .min(1)
        .describe("One or more variable ids"),
      years: z.array(z.number().int()).optional().describe("Calendar years to include"),
      aggregate_id: z
        .number()
        .int()
        .default(1)
        .describe("Aggregation level id (default 1)"),
      page: z.number().int().min(0).default(0).describe("Page index — 0-based"),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Rows per page"),
      lang: z.enum(["pl", "en"]).default("pl").describe("Response language"),
    },
    async ({ unit_id, variable_ids, years, aggregate_id, page, page_size, lang }) => {
      return withToolExecutionSpan(
        {
          toolName: "bdl_get_data_by_unit",
          params: {
            unit_id,
            variable_ids,
            years,
            aggregate_id,
            page,
            page_size,
            lang,
          } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "bdl-gus");
          try {
            const params = new URLSearchParams({
              page: String(page),
              "page-size": String(page_size),
              lang,
              aggregate_id: String(aggregate_id),
            });
            for (const vid of variable_ids) params.append("var-id", String(vid));
            appendYearParams(params, years);
            const url = `${API_BASE}/data/by-unit/${encodeURIComponent(unit_id)}?${params}`;
            const key = makeCacheKey("bdl_get_data_by_unit", {
              unit_id,
              variable_ids,
              years,
              aggregate_id,
              page,
              page_size,
              lang,
            });
            const text = await cachedFetch(env.CACHE_KV, key, url, { headers: bdlHeaders(env) }, DATA_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling bdl_get_data_by_unit: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
