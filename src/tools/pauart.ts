/**
 * PAUart — Polska Akademia Umiejętności, katalog dzieł (Navigart / Collectio).
 * Interfejs: http://www.pauart.pl/app — API HTTP: POST /api/search (JSON, bez klucza).
 *
 * Tools:
 *   pauart_search      — wyszukiwanie pełnotekstowe (Elasticsearch multi_match).
 *   pauart_get_artwork — rekord po identyfikatorze (zapytanie ids).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey, type CacheError } from "../cache.js";
import { createToolErrorReport, formatToolErrorResponse } from "../tool-error-handling.js";

const API_BASE = "http://www.pauart.pl/api";
const SEARCH_URL = `${API_BASE}/search`;
const SITE_APP = "http://www.pauart.pl/app";
const JSON_HEADERS = { Accept: "application/json", "Content-Type": "application/json" };
const CACHE_TTL = 86_400;

/* eslint-disable @typescript-eslint/no-explicit-any */
function tagLabels(art: any): string[] {
  const tags = art?.description?.tags;
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    const pl = t?.labels?.pl ?? t?.labels?.en;
    if (typeof pl === "string" && pl) out.push(pl);
  }
  return out;
}

function previewPath(art: any): string | undefined {
  const p = art?.previews?.[0]?.ref;
  const path = p?.thumbnails?.medium?.path ?? p?.thumbnails?.small?.path ?? p?.path;
  return typeof path === "string" ? path : undefined;
}

function compactArtwork(art: any): Record<string, unknown> {
  const id = art?._id as string | undefined;
  const ot = art?.objectTypes?.[0]?.labels?.pl;
  return {
    id,
    title: art?.description?.title ?? undefined,
    inventoryNumber: art?.inventoryNumber ?? undefined,
    copyright: art?.copyright ?? undefined,
    objectType: typeof ot === "string" ? ot : undefined,
    tags: tagLabels(art),
    dimensions: typeof art?.dimensions === "string" ? art.dimensions : undefined,
    previewPath: previewPath(art),
    ui: SITE_APP,
  };
}

function summarizeSearch(raw: string, artworksOnly: boolean): string {
  try {
    const j = JSON.parse(raw) as any;
    const content: any[] = j?.content ?? [];
    let rows = content;
    if (artworksOnly) {
      rows = content.filter((x) => x?._type === "artwork");
    }
    const items = rows.map((x) =>
      x?._type === "artwork"
        ? compactArtwork(x)
        : {
            _type: x?._type,
            id: x?._id,
            label: x?.labels?.pl ?? x?.labels?.en ?? undefined,
          },
    );
    return JSON.stringify(
      {
        totalElements: j.totalElements,
        totalPages: j.totalPages,
        page: j.number,
        pageSize: j.size,
        artworksOnly,
        items,
      },
      null,
      2,
    );
  } catch {
    return raw;
  }
}

function summarizeArtwork(raw: string): string {
  try {
    const j = JSON.parse(raw) as any;
    const art = (j?.content ?? []).find((x: any) => x?._type === "artwork");
    if (!art) {
      return JSON.stringify({ error: "not_found", raw: j }, null, 2);
    }
    return JSON.stringify(compactArtwork(art), null, 2);
  } catch {
    return raw;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function buildSearchBody(
  query: { multi_match: { query: string; fields: string[] } } | { ids: { values: string[] } },
  page: number,
  size: number,
): string {
  return JSON.stringify({
    query,
    options: { trash: "NOT_REMOVED" },
    pageRequest: { pageSize: size, pageNumber: page },
  });
}

export function registerPauartTools(server: McpServer, env: Env): void {
  server.tool(
    "pauart_search",
    [
      "Search the PAU (Polish Academy of Arts and Sciences) art collection catalogue (PAUart, pauart.pl).",
      "Uses the public Collectio/Elasticsearch search API (POST /api/search).",
      "Returns titles, inventory numbers, tags, and object types.",
      "When artworks_only is true, only rows with _type artwork are kept (the index also returns dictionary matches).",
      "The UI is at http://www.pauart.pl/app — API is served over HTTP on the same host.",
    ].join(" "),
    {
      query: z.string().min(1).describe("Wyrażenia wyszukiwania (polskie lub angielskie)."),
      page: z.number().int().min(0).default(0).describe("Numer strony liczony od zera"),
      size: z.number().int().min(1).max(50).default(15).describe("Liczba wyników na stronę (wartość 1–50)."),
      artworks_only: z
        .boolean()
        .default(true)
        .describe(
          "If true, drop non-artwork hits (dictionary entries, etc.) from the returned list for this page.",
        ),
    },
    async ({ query, page, size, artworks_only }) => {
      return (async () => {
        try {
          const body = buildSearchBody({ multi_match: { query, fields: ["_all"] } }, page, size);
          const cacheKey = makeCacheKey("pauart_search", { query, page, size, artworks_only });
          const data = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            SEARCH_URL,
            { method: "POST", headers: JSON_HEADERS, body },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text: summarizeSearch(data, artworks_only) }] };
        } catch (err) {
          const report = createToolErrorReport(err, {
            toolName: "pauart_search",
            operation: "POST /api/search",
            url: SEARCH_URL,
            params: { query, page, size, artworks_only },
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
    "pauart_get_artwork",
    [
      "Pobiera jeden rekord dzieła z PAUart po identyfikatorze katalogowym (np. AN_KIII_150_16476).",
      "Zwraca skrócone metadane (tytuł, inwentarz, tagi, ścieżka podglądu).",
      "Użyj identyfikatorów zwróconych przez pauart_search.",
    ].join(" "),
    {
      artwork_id: z
        .string()
        .min(1)
        .describe("Identyfikator _id dzieła z wyników pauart_search, np. AN_KIII_150_16476"),
    },
    async ({ artwork_id }) => {
      return (async () => {
        try {
          const body = buildSearchBody({ ids: { values: [artwork_id] } }, 0, 1);
          const cacheKey = makeCacheKey("pauart_artwork", { artwork_id });
          const data = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            SEARCH_URL,
            { method: "POST", headers: JSON_HEADERS, body },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text: summarizeArtwork(data) }] };
        } catch (err) {
          const report = createToolErrorReport(err, {
            toolName: "pauart_get_artwork",
            operation: "POST /api/search",
            url: SEARCH_URL,
            params: { artwork_id },
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
