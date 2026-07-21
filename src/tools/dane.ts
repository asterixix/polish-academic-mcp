import { toToolErrorText } from "../tool-error-handling.js";
/**
 * dane.gov.pl — Poland's national open data portal.
 * 43 000+ datasets from 500+ public institutions.
 * Scored 100 % on the EU Open Data Maturity portal dimension in 2024.
 * No API key required.  API version: 1.4.
 *
 * Pagination: 1-based (unlike RUJ's 0-based or RODBuK/RePOD's start-offset).
 *
 * Tools:
 *   dane_search      — full-text search across all datasets.
 *   dane_get_dataset — dataset detail and its downloadable resources.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const API_BASE = "https://api.dane.gov.pl/1.4";
const JSON_HEADERS = { Accept: "application/json" };
const SEARCH_TTL = 3_600; // 1 h — portal updates more frequently than academic repos
const DETAIL_TTL = 3_600;

export function registerDaneTools(server: McpServer, env: Env): void {
  // ── dane_search ───────────────────────────────────────────────────────────
  server.tool(
    "dane_search",
    [
      "Wyszukiwanie w polskim portalu danych otwartych (dane.gov.pl).",
      "Zawiera ponad 43 000 zbiorów danych z ministerstw, samorządów i instytucji publicznych.",
      "Zbiory z flagą has_research_data=true są konkretnie akademickie.",
      "Zwraca JSON z tytułem, kategorią, licencją (przeważnie CC0), instytucją i statystykami pobrań.",
    ].join(" "),
    {
      query: z.string().describe("Wyrażenia wyszukiwania"),
      category: z
        .string()
        .optional()
        .describe(
          "Nazwa kategorii DCAT, np. \"Nauka i technika\", \"Edukacja\", \"Zdrowie\", \"Transport\"",
        ),
      per_page: z.number().int().min(1).max(100).default(20).describe("Liczba wyników na stronę"),
      page: z.number().int().min(1).default(1).describe("Numer strony wyników, liczony od 1."),
      sort: z
        .enum(["relevance", "date", "-date", "title", "views_count"])
        .default("relevance")
        .describe("Kolejność sortowania (-date = najnowsze najpierw)"),
    },
    async ({ query, category, per_page, page, sort }) => {
      return (async () => {
        try {
          const buildParams = (withCategory: boolean): URLSearchParams => {
            const params = new URLSearchParams({
              q: query,
              per_page: String(per_page),
              page: String(page),
              sort,
            });
            if (withCategory && category) params.set("category[id]", category);
            return params;
          };

          const searchParams = buildParams(true);
          const url = `${API_BASE}/datasets?${searchParams}`;
          const cacheKey = makeCacheKey("dane_search", {
            q: query,
            category,
            per_page,
            page,
            sort,
          });
          try {
            const data = await cachedFetch(
              env.CACHE_KV,
              cacheKey,
              url,
              { headers: JSON_HEADERS },
              SEARCH_TTL,
            );
            return { content: [{ type: "text", text: data }] };
          } catch (err) {
            const msg = toToolErrorText(err);
            // Robustness fallback: some category values (labels vs IDs) cause 400.
            // Retry once without the category filter to keep search usable.
            if (category && /HTTP 400/i.test(msg)) {
              const fallbackParams = buildParams(false);
              const fallbackUrl = `${API_BASE}/datasets?${fallbackParams}`;
              const fallbackKey = makeCacheKey("dane_search_fallback", {
                query,
                per_page,
                page,
                sort,
              });
              const data = await cachedFetch(
                env.CACHE_KV,
                fallbackKey,
                fallbackUrl,
                { headers: JSON_HEADERS },
                SEARCH_TTL,
              );
              return { content: [{ type: "text", text: data }] };
            }
            throw err;
          }
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error searching dane.gov.pl: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );

  // ── dane_get_dataset ──────────────────────────────────────────────────────
  server.tool(
    "dane_get_dataset",
    [
      "Pobiera pełne szczegóły konkretnego zbioru danych z dane.gov.pl po numerycznym identyfikatorze,",
      "włącznie ze wszystkimi zasobami do pobrania (CSV, XLSX, JSON, odnośniki API itp.).",
      "dataset_id to liczba całkowita z pola id zwróconego przez dane_search.",
    ].join(" "),
    {
      dataset_id: z.number().int().describe("Numeryczny identyfikator zbioru z wyników dane_search"),
    },
    async ({ dataset_id }) => {
      return (async () => {
        try {
          const datasetUrl = `${API_BASE}/datasets/${dataset_id}`;
          const datasetKey = makeCacheKey("dane_dataset", { dataset_id });
          const datasetRaw = await cachedFetch(
            env.CACHE_KV,
            datasetKey,
            datasetUrl,
            { headers: JSON_HEADERS },
            DETAIL_TTL,
          );

          const resourcesUrl = `${API_BASE}/datasets/${dataset_id}/resources`;
          const resourcesKey = makeCacheKey("dane_resources", { dataset_id });
          const resourcesRaw = await cachedFetch(
            env.CACHE_KV,
            resourcesKey,
            resourcesUrl,
            { headers: JSON_HEADERS },
            DETAIL_TTL,
          );

          // Merge dataset + resources into a single JSON object for the LLM.
          let combined: string;
          try {
            combined = JSON.stringify(
              {
                dataset: JSON.parse(datasetRaw) as unknown,
                resources: JSON.parse(resourcesRaw) as unknown,
              },
              null,
              2,
            );
          } catch {
            // If either body is not valid JSON, return both as plain text.
            combined = `=== Dataset ===\n${datasetRaw}\n\n=== Resources ===\n${resourcesRaw}`;
          }

          return { content: [{ type: "text", text: combined }] };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error fetching dane.gov.pl dataset ${dataset_id}: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );
}
