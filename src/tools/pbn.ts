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
import { cachedFetch, makeCacheKey, type CacheError } from "../cache.js";
import { createToolErrorReport, formatToolErrorResponse } from "../tool-error-handling.js";

const API_BASE = "https://pbn.nauka.gov.pl/api/v1";
const SEARCH_TTL = 3_600;
const GET_TTL = 86_400;

function requirePbnHeaders(
  env: Env,
  withJsonBody: boolean,
): { headers: Record<string, string>; error?: string } {
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
      "Wyszukiwanie publikacji w Polskiej Bibliografii Naukowej (PBN) przez POST /v1/search/publications.",
      "Wymaga PBN_APP_ID oraz PBN_APP_TOKEN. Zwraca JSON (MetadataDTO).",
      "Filtruj po tytule, DOI, ISBN, ISSN, zakresie lat, typie (BOOK, ARTICLE, …), autorach, paginacji (page/size).",
    ].join(" "),
    {
      title: z.string().optional().describe("Fragment tytułu publikacji."),
      doi: z.string().optional().describe("Identyfikator DOI publikacji (opcjonalnie)."),
      isbn: z.string().optional().describe("Numer ISBN publikacji (opcjonalnie)."),
      issn: z.string().optional().describe("Numer ISSN czasopisma (opcjonalnie)."),
      year: z.number().int().optional().describe("Pojedynczy rok publikacji."),
      year_from: z.number().int().optional().describe("Dolna granica zakresu lat."),
      year_to: z.number().int().optional().describe("Górna granica zakresu lat."),
      type: z
        .enum(["BOOK", "EDITED_BOOK", "CHAPTER", "ARTICLE", "PROCEEDINGS"])
        .optional()
        .describe("Typ publikacji."),
      authors: z
        .array(z.string())
        .optional()
        .describe("Lista autorów (AND wg API)."),
      object_id: z.string().optional().describe("Identyfikator obiektu PBN, jeśli znany."),
      page: z.number().int().min(0).default(0).describe("Indeks strony wyników (od zera)."),
      size: z.number().int().min(1).max(100).default(20).describe("Rozmiar strony (maks. 100)."),
    },
    async (params) => {
      return (async () => {
        const { headers, error: authError } = requirePbnHeaders(env, true);
        if (authError) {
          const report = createToolErrorReport(new Error(authError), {
            toolName: "pbn_search_publications",
            operation: "Authentication validation",
          });
          return formatToolErrorResponse(report, true);
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
          const report = createToolErrorReport(err, {
            toolName: "pbn_search_publications",
            operation: "POST /v1/search/publications",
            url: `${API_BASE}/search/publications`,
            params: {
              title: params.title,
              doi: params.doi,
              type: params.type,
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

  server.tool(
    "pbn_search_persons",
    [
      "Wyszukiwanie osób w PBN przez POST /v1/search/persons (naukowcy, ORCID).",
      "Wymaga PBN_APP_ID oraz PBN_APP_TOKEN. Zwraca JSON (MetadataDTO).",
    ].join(" "),
    {
      first_name: z.string().optional().describe("Imię."),
      last_name: z.string().optional().describe("Nazwisko osoby w wyszukiwaniu PBN (parametr opcjonalny)."),
      orcid: z.string().optional().describe("Identyfikator ORCID."),
      object_id: z.string().optional().describe("Identyfikator obiektu osoby w PBN."),
      page: z.number().int().min(0).default(0).describe("Indeks strony wyników (od zera)."),
      size: z.number().int().min(1).max(100).default(20).describe("Liczba wyników na stronę (rozmiar strony)."),
    },
    async (params) => {
      return (async () => {
        const { headers, error: authError } = requirePbnHeaders(env, true);
        if (authError) {
          const report = createToolErrorReport(new Error(authError), {
            toolName: "pbn_search_persons",
            operation: "Authentication validation",
          });
          return formatToolErrorResponse(report, true);
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
          const report = createToolErrorReport(err, {
            toolName: "pbn_search_persons",
            operation: "POST /v1/search/persons",
            url: `${API_BASE}/search/persons`,
            params: {
              first_name: params.first_name,
              last_name: params.last_name,
              orcid: params.orcid,
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

  server.tool(
    "pbn_get_publication",
    [
      "Pobiera rozszerzone metadane publikacji po identyfikatorze obiektu Mongo PBN (GET /v1/publications/id/{id}).",
      "Wymaga PBN_APP_ID oraz PBN_APP_TOKEN.",
    ].join(" "),
    {
      publication_id: z.string().min(1).describe("Identyfikator obiektu publikacji z wyników wyszukiwania."),
    },
    async ({ publication_id }) => {
      return (async () => {
        const { headers, error } = requirePbnHeaders(env, false);
        if (error) {
          const report = createToolErrorReport(new Error(error), {
            toolName: "pbn_get_publication",
            operation: "Authentication validation",
          });
          return formatToolErrorResponse(report, true);
        }
        try {
          const path = encodeURIComponent(publication_id);
          const url = `${API_BASE}/publications/id/${path}`;
          const cacheKey = makeCacheKey("pbn_get_publication", { publication_id });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { method: "GET", headers },
            GET_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const report = createToolErrorReport(err, {
            toolName: "pbn_get_publication",
            operation: "GET /v1/publications/id/{id}",
            url: `${API_BASE}/publications/id/${encodeURIComponent(publication_id)}`,
            params: { publication_id },
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
