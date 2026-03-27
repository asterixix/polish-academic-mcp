/**
 * PBN — Polska Bibliografia Naukowa (REST API v1).
 * Swagger: https://pbn.nauka.gov.pl/api/
 * Help: https://pbn.nauka.gov.pl/centrum-pomocy/kategoria/api/
 *
 * Search and metadata endpoints require institutional credentials (X-App-Id, X-App-Token).
 * Obtain access via PBN Helpdesk after integration on the test environment (see official docs).
 * Optional: PBN_USER_TOKEN for operations that require a user context.
 *
 * Tools use env: PBN_APP_ID, PBN_APP_TOKEN, optional PBN_USER_TOKEN.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const API_BASE = "https://pbn.nauka.gov.pl/api/v1";
const SEARCH_TTL = 3_600;
const GET_TTL = 86_400;

const API_FIELDS = ["title", "metadata", "id"];

function requirePbnHeaders(env: Env, withJsonBody: boolean): { headers: Record<string, string>; error?: string } {
  const id = env.PBN_APP_ID?.trim();
  const token = env.PBN_APP_TOKEN?.trim();
  if (!id || !token) {
    return {
      headers: {},
      error:
        "PBN API requires PBN_APP_ID and PBN_APP_TOKEN (Worker secrets / wrangler vars). " +
        "See https://pbn.nauka.gov.pl/centrum-pomocy/baza-wiedzy/sposob-uzyskania-dostepu-do-api-w-wersji-produkcyjnej/",
    };
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-App-Id": id,
    "X-App-Token": token,
  };
  if (withJsonBody) headers["Content-Type"] = "application/json";
  const user = env.PBN_USER_TOKEN?.trim();
  if (user) headers["X-User-Token"] = user;
  return { headers };
}

function prune<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

export function registerPbnTools(server: McpServer, env: Env): void {
  server.tool(
    "pbn_search_publications",
    [
      "Search publications in Polska Bibliografia Naukowa (PBN) via POST /v1/search/publications.",
      "Requires PBN_APP_ID and PBN_APP_TOKEN. Returns JSON (MetadataDTO).",
      "Filter by title, DOI, ISBN, ISSN, year range, type (BOOK, ARTICLE, …), authors, pagination (page/size).",
    ].join(" "),
    {
      title: z.string().optional().describe("Publication title fragment."),
      doi: z.string().optional().describe("DOI."),
      isbn: z.string().optional().describe("ISBN."),
      issn: z.string().optional().describe("ISSN."),
      year: z.number().int().optional().describe("Single publication year."),
      year_from: z.number().int().optional().describe("Year range lower bound."),
      year_to: z.number().int().optional().describe("Year range upper bound."),
      type: z
        .enum(["BOOK", "EDITED_BOOK", "CHAPTER", "ARTICLE", "PROCEEDINGS"])
        .optional()
        .describe("Publication type."),
      authors: z.array(z.string()).optional().describe("Author name strings (AND semantics per API)."),
      object_id: z.string().optional().describe("PBN object id if known."),
      page: z.number().int().min(0).default(0).describe("Result page index (0-based)."),
      size: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Page size (max 100)."),
    },
    async (params) => {
      return withToolExecutionSpan(
        {
          toolName: "pbn_search_publications",
          params: params as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(
            [params.title, params.doi, params.authors?.join(" ")].filter(Boolean).join(" "),
          ),
        },
        async (span) => {
          span.setAttribute("mcp.source", "pbn");
          const { headers, error } = requirePbnHeaders(env, true);
          if (error) {
            return { content: [{ type: "text", text: `Error calling pbn_search_publications: ${error}` }], isError: true };
          }
          try {
            const body = prune({
              title: params.title,
              doi: params.doi,
              isbn: params.isbn,
              issn: params.issn,
              year: params.year,
              yearFrom: params.year_from,
              yearTo: params.year_to,
              type: params.type,
              authors: params.authors,
              objectId: params.object_id,
              page: params.page,
              size: params.size,
            });
            const url = `${API_BASE}/search/publications`;
            const cacheKey = makeCacheKey("pbn_search_publications", body);
            const text = await cachedFetch(
              env.CACHE_KV,
              cacheKey,
              url,
              { method: "POST", headers, body: JSON.stringify(body) },
              SEARCH_TTL,
            );
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling pbn_search_publications: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "pbn_search_persons",
    [
      "Search persons in PBN via POST /v1/search/persons (researchers, ORCID).",
      "Requires PBN_APP_ID and PBN_APP_TOKEN. Returns JSON (MetadataDTO).",
    ].join(" "),
    {
      first_name: z.string().optional().describe("First name."),
      last_name: z.string().optional().describe("Last name."),
      orcid: z.string().optional().describe("ORCID id."),
      object_id: z.string().optional().describe("PBN person object id."),
      page: z.number().int().min(0).default(0).describe("Result page index (0-based)."),
      size: z.number().int().min(1).max(100).default(20).describe("Page size."),
    },
    async (params) => {
      return withToolExecutionSpan(
        {
          toolName: "pbn_search_persons",
          params: params as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens([params.first_name, params.last_name].filter(Boolean).join(" ")),
        },
        async (span) => {
          span.setAttribute("mcp.source", "pbn");
          const { headers, error } = requirePbnHeaders(env, true);
          if (error) {
            return { content: [{ type: "text", text: `Error calling pbn_search_persons: ${error}` }], isError: true };
          }
          try {
            const body = prune({
              firstName: params.first_name,
              lastName: params.last_name,
              orcid: params.orcid,
              objectId: params.object_id,
              page: params.page,
              size: params.size,
            });
            const url = `${API_BASE}/search/persons`;
            const cacheKey = makeCacheKey("pbn_search_persons", body);
            const text = await cachedFetch(
              env.CACHE_KV,
              cacheKey,
              url,
              { method: "POST", headers, body: JSON.stringify(body) },
              SEARCH_TTL,
            );
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling pbn_search_persons: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "pbn_get_publication",
    [
      "Fetch extended publication metadata by PBN Mongo object id (GET /v1/publications/id/{id}).",
      "Requires PBN_APP_ID and PBN_APP_TOKEN.",
    ].join(" "),
    {
      publication_id: z.string().min(1).describe("Publication object id from search results."),
    },
    async ({ publication_id }) => {
      return withToolExecutionSpan(
        {
          toolName: "pbn_get_publication",
          params: { publication_id } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "pbn");
          const { headers, error } = requirePbnHeaders(env, false);
          if (error) {
            return { content: [{ type: "text", text: `Error calling pbn_get_publication: ${error}` }], isError: true };
          }
          try {
            const path = encodeURIComponent(publication_id);
            const url = `${API_BASE}/publications/id/${path}`;
            const cacheKey = makeCacheKey("pbn_get_publication", { publication_id });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { method: "GET", headers }, GET_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling pbn_get_publication: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
