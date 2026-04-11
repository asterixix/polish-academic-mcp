import { toToolErrorText } from "../tool-error-handling.js";
/**
 * RePOD — ICM University of Warsaw open research data repository.
 * Runs a CeON fork of Dataverse (branched from v4.11).
 * ~3,737 datasets; all DOIs use the 10.18150/ prefix.
 * All search and read operations work anonymously.
 *
 * Tools:
 *   repod_search      — search datasets, dataverses, and files.
 *   repod_get_dataset — retrieve a dataset's metadata by DOI.
 *
 * Note: some Dataverse v5+/v6+ features (geo_point search, Croissant metadata)
 * may not be available due to the fork age.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey, type CacheError } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const API_BASE = "https://repod.icm.edu.pl/api";
const CACHE_TTL = 86_400; // 24 h

const API_FIELDS = [
  "title",
  "author",
  "subject",
  "abstract",
  "date",
  "doi",
  "keywords",
  "publisher",
];

type DataverseSearchItem = {
  name?: string;
  authors?: string[];
  description?: string;
  published_at?: string;
  global_id?: string;
  url?: string;
  type?: string;
};

function normalizeRepodSearch(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      status?: string;
      data?: {
        q?: string;
        total_count?: number;
        start?: number;
        items?: DataverseSearchItem[];
      };
    };
    const items = (parsed.data?.items ?? []).map((it) => ({
      title: it.name,
      author: it.authors?.join(", "),
      date: it.published_at,
      doi: it.global_id?.startsWith("doi:") ? it.global_id.slice(4) : it.global_id,
      url: it.url,
      type: it.type,
      abstract: it.description,
      source_raw: it,
    }));
    return JSON.stringify(
      {
        query: parsed.data?.q,
        total_count: parsed.data?.total_count,
        start: parsed.data?.start,
        items,
      },
      null,
      2,
    );
  } catch {
    return raw;
  }
}

export function registerRepodTools(server: McpServer, env: Env): void {
  // ── repod_search ──────────────────────────────────────────────────────────
  server.tool(
    "repod_search",
    [
      "Search open research datasets in RePOD (ICM University of Warsaw).",
      "Contains ~3,737 datasets with DOIs under the 10.18150/ prefix.",
      "Returns JSON with relevance scores, authors, descriptions, and publication dates.",
    ].join(" "),
    {
      query: z.string().describe("Search query"),
      type: z
        .enum(["dataset", "dataverse", "file"])
        .optional()
        .describe("Restrict results to one content type"),
      per_page: z.number().int().min(1).max(100).default(10).describe("Results per page"),
      start: z.number().int().min(0).default(0).describe("Zero-based offset for pagination"),
    },
    async ({ query, type, per_page, start }) => {
      return withToolExecutionSpan(
        {
          toolName: "repod_search",
          params: { query, type, per_page, start } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "repod");
          try {
            const searchParams = new URLSearchParams({
              q: query,
              per_page: String(per_page),
              start: String(start),
            });
            if (type) searchParams.set("type", type);

            const url = `${API_BASE}/search?${searchParams}`;
            const cacheKey = makeCacheKey("repod_search", {
              query,
              type,
              per_page,
              start,
            });
            const data = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
            return { content: [{ type: "text", text: normalizeRepodSearch(data) }] };
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error searching RePOD: ${toToolErrorText(e)}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── repod_get_dataset ─────────────────────────────────────────────────────
  server.tool(
    "repod_get_dataset",
    [
      "Get metadata for a specific dataset in RePOD by its DOI.",
      "Choose datacite for standard metadata, schema.org for JSON-LD,",
      "dcterms for Dublin Core XML, or dataverse_json for the full native record.",
    ].join(" "),
    {
      doi: z.string().describe("Dataset DOI without the doi: prefix, e.g. 10.18150/ABCDEF"),
      format: z
        .enum(["datacite", "dcterms", "schema.org", "ddi", "dataverse_json"])
        .default("datacite")
        .describe("Metadata export format"),
    },
    async ({ doi, format }) => {
      return withToolExecutionSpan(
        {
          toolName: "repod_get_dataset",
          params: { doi, format } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(doi),
        },
        async (span) => {
          span.setAttribute("mcp.source", "repod");
          try {
            const persistentId = `doi:${doi}`;
            const exportUrl = `${API_BASE}/datasets/export?exporter=${encodeURIComponent(format)}&persistentId=${encodeURIComponent(persistentId)}`;
            const exportCacheKey = makeCacheKey("repod_dataset_export", { doi, format });

            try {
              const exported = await cachedFetch(
                env.CACHE_KV,
                exportCacheKey,
                exportUrl,
                {},
                CACHE_TTL,
              );
              return { content: [{ type: "text", text: exported }] };
            } catch (innerErr) {
              const cacheErr = innerErr as CacheError;
              const status = cacheErr?.status;
              if (status !== 400 && status !== 404) {
                throw innerErr;
              }

              // RePOD export endpoint is intermittently broken for valid datasets; use Dataverse JSON fallback.
              const fallbackUrl = `${API_BASE}/datasets/:persistentId/versions/:latest?persistentId=${encodeURIComponent(persistentId)}`;
              const fallbackCacheKey = makeCacheKey("repod_dataset_latest", { doi });
              const fallback = await cachedFetch(
                env.CACHE_KV,
                fallbackCacheKey,
                fallbackUrl,
                {},
                CACHE_TTL,
              );

              const wrapped = JSON.stringify(
                {
                  requested_format: format,
                  fallback_format: "dataverse_json",
                  note: "RePOD export endpoint returned 400/404; served latest Dataverse JSON dataset version instead.",
                  dataset: JSON.parse(fallback),
                },
                null,
                2,
              );
              return { content: [{ type: "text", text: wrapped }] };
            }
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error fetching RePOD dataset ${doi}: ${toToolErrorText(e)}`,
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
