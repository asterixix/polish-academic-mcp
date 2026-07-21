import { toToolErrorText } from "../tool-error-handling.js";
/**
 * RODBuK — Krakow inter-university open research data repository.
 * Powered by Harvard Dataverse.  Six member universities.
 * All read endpoints are open — no authentication required.
 *
 * Tools:
 *   rodbuk_search — search datasets, dataverses, and files.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const API_BASE = "https://rodbuk.pl/api";
const CACHE_TTL = 86_400; // 24 h

type DataverseSearchItem = {
  name?: string;
  authors?: string[];
  description?: string;
  published_at?: string;
  global_id?: string;
  url?: string;
  type?: string;
};

function normalizeRodbukSearch(raw: string): string {
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

export function registerRodbukTools(server: McpServer, env: Env): void {
  server.tool(
    "rodbuk_search",
    [
      "Wyszukiwanie zbiorów badawczych w RODBuK — krakowskim międzyuczelnianym otwartym repozytorium danych badawczych",
      "(AGH, UEK, UP, UR, UJ, PK). Zasilane przez Harvard Dataverse.",
      "Zwraca JSON z total_count oraz listą elementów zawierającą DOI, opis, autorów i cytowanie.",
      "Użyj query='*', by przeglądać wszystkie dostępne zbiory.",
    ].join(" "),
    {
      query: z.string().describe("Zapytanie wyszukiwania. Użyj *, by wylistować wszystkie zbiory"),
      type: z
        .enum(["dataset", "dataverse", "file"])
        .optional()
        .describe("Ogranicz wyniki do jednego typu treści"),
      per_page: z.number().int().min(1).max(100).default(10).describe("Liczba wyników na stronę"),
      start: z.number().int().min(0).default(0).describe("Przesunięcie liczone od zera dla paginacji"),
    },
    async ({ query, type, per_page, start }) => {
      return (async () => {
        try {
          const searchParams = new URLSearchParams({
            q: query,
            per_page: String(per_page),
            start: String(start),
          });
          if (type) searchParams.set("type", type);

          const url = `${API_BASE}/search?${searchParams}`;
          const cacheKey = makeCacheKey("rodbuk_search", {
            query,
            type,
            per_page,
            start,
          });
          const data = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
          return { content: [{ type: "text", text: normalizeRodbukSearch(data) }] };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error searching RODBuK: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );
}
