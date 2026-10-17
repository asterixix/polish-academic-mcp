import { toToolErrorText } from "../tool-error-handling.js";
/**
 * BazTOL — subject gateway of Polish technical-science web resources (Biblioteka PUT).
 * Web UI: https://baztol.library.put.poznan.pl/ — no public JSON API; the MCP tools replay
 * the same HTML form POST and detail GET the browser uses (Apache + Perl CGI) and parse
 * the result tables into clean structured JSON with resource IDs (`resource_id`).
 *
 * Tools:
 *   baztol_search        — full-text search (`wyr_wysz`), 20 results per page.
 *   baztol_browse_domain — browse by subject domain id (`dziedzina_id`, 24–42, or subdomain id).
 *   baztol_get_resource  — resource detail card by numeric `resource_id`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { decodeHtmlEntities } from "../extract.js";

const API_ORIGIN = "http://baztol.library.put.poznan.pl";
const READER_PATH = "/baztol_czytelnik/baztol";
const READER_URL = `${API_ORIGIN}${READER_PATH}`;
const HTML_ACCEPT = "text/html; charset=utf-8";
const CACHE_TTL = 86_400; // 24 h — catalog frozen since 2022

const PAGE_SIZE = 20;

/** Subject domain ids (sidebar) — same as BazTOL “przeglądanie” links. */
export const BAZTOL_DOMAIN_IDS = [
  24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42,
] as const;

function buildPostBody(params: Record<string, string>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    u.set(k, v);
  }
  return u.toString();
}

function fixDoubleEncodedUtf8(str: string): string {
  if (!/Ã|Å|Ä/.test(str)) return str;
  try {
    const bytes = Buffer.from(str, "latin1");
    const decoded = bytes.toString("utf8");
    if (!decoded.includes("\ufffd")) return decoded;
  } catch {
    // Keep original string
  }
  return str;
}

function cleanHtmlFragment(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return fixDoubleEncodedUtf8(decodeHtmlEntities(stripped))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export interface BaztolItem {
  resource_id: number;
  title: string;
  external_url: string;
  description: string;
  detail_url: string;
}

export interface BaztolSubdomain {
  domain_id: number;
  name: string;
  count: number;
}

export function parseBaztolListHtml(html: string): {
  total: number;
  range: string | null;
  subdomains: BaztolSubdomain[];
  items: BaztolItem[];
} {
  // Strip HTML comments first so commented-out legacy template blocks are ignored
  const uncommented = html.replace(/<!--[\s\S]*?-->/g, "");

  const totalMatch = uncommented.match(/znalezionych\s+zasob[^:]*:\s*<b>(\d+)<\/b>/i);
  const rangeMatch = uncommented.match(/Wyniki:\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/i);

  const subdomains: BaztolSubdomain[] = [];
  const seenSub = new Set<number>();
  const subRegex =
    /dziedzina_id'\)\.value='(\d+)';[^"]*">\s*([^<]+?)<\/a>\s*\[(\d+)\]/gi;
  let subMatch: RegExpExecArray | null;
  while ((subMatch = subRegex.exec(uncommented)) !== null) {
    const id = Number.parseInt(subMatch[1], 10);
    if (!Number.isFinite(id) || seenSub.has(id)) continue;
    seenSub.add(id);
    subdomains.push({
      domain_id: id,
      name: cleanHtmlFragment(subMatch[2]),
      count: Number.parseInt(subMatch[3], 10) || 0,
    });
  }

  const items: BaztolItem[] = [];
  const seenIds = new Set<number>();
  const itemRegex =
    /<a\s+href="([^"]+)"[^>]*>\s*<span\s+id="poz_(\d+)">([\s\S]*?)<\/span>\s*<\/a>\s*<br>\s*([\s\S]*?)<\/td>\s*<\/tr>\s*<tr[^>]*>\s*<td>\s*<a\s+href="\/baztol_czytelnik\/baztol\?id=\2"/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(uncommented)) !== null) {
    const resourceId = Number.parseInt(m[2], 10);
    if (!Number.isFinite(resourceId) || seenIds.has(resourceId)) continue;
    seenIds.add(resourceId);
    items.push({
      resource_id: resourceId,
      title: cleanHtmlFragment(m[3]),
      external_url: m[1].trim(),
      description: cleanHtmlFragment(m[4]),
      detail_url: `${READER_URL}?id=${resourceId}`,
    });
  }

  const total = totalMatch ? Number.parseInt(totalMatch[1], 10) : items.length;
  return {
    total,
    range: rangeMatch ? rangeMatch[1].trim() : null,
    subdomains,
    items,
  };
}

export function parseBaztolDetailHtml(html: string, resourceId: number): Record<string, unknown> {
  const beginIdx = html.indexOf("<!-- begin -->");
  const bodySlice = beginIdx !== -1 ? html.slice(beginIdx) : html;
  const uncommented = bodySlice.replace(/<!--[\s\S]*?-->/g, "");

  const dateMatch = uncommented.match(
    /Data\s+wprowadzenia\s+rekordu:\s*<span[^>]*>([^<]+)<\/span>/i,
  );

  const fields: Record<string, string> = {};
  const rowRegex =
    /<tr\s+valign="top">\s*<td\s+class="bold"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRegex.exec(uncommented)) !== null) {
    const label = cleanHtmlFragment(row[1]).replace(/:$/, "").trim();
    const val = cleanHtmlFragment(row[2]);
    if (label && val) {
      fields[label] = val;
    }
  }

  return {
    resource_id: resourceId,
    detail_url: `${READER_URL}?id=${resourceId}`,
    created_at: dateMatch ? dateMatch[1].trim() : null,
    title: fields["Tytuł"] ?? null,
    external_url: fields["URL"] ?? null,
    variant_title: fields["Wariant"] ?? null,
    domains: fields["Dziedzina"] ? fields["Dziedzina"].split(/\n+/).map((s) => s.trim()).filter(Boolean) : [],
    fields,
  };
}

export function registerBaztolTools(server: McpServer, env: Env): void {
  // ── baztol_search ─────────────────────────────────────────────────────────
  server.tool(
    "baztol_search",
    [
      "Wyszukiwanie w BazTOL (krajowa brama zasobów nauki technicznej, Biblioteka Politechniki Poznańskiej).",
      "Zwraca ustrukturyzowaną listę wyników (identyfikator resource_id do użycia w baztol_get_resource, tytuł, zewnętrzny URL, opis oraz odnośnik do karty zasobu).",
      "Paginacja: 20 trafień na stronę; użyj parametru page liczonego od 1.",
    ].join(" "),
    {
      query: z.string().min(1).describe("Fraza wyszukiwania (dopasowywana do pól katalogu po stronie serwera)"),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony liczony od 1 (20 wyników na stronę)"),
    },
    async ({ query, page }) => {
      return (async () => {
        try {
          const bodyParams: Record<string, string> = {
            akcja: "szukanie_proste",
            dziedzina_id: "",
            wyr_wysz: query,
            button_proste: "Szukaj",
          };
          if (page > 1) {
            bodyParams.offset = String((page - 1) * PAGE_SIZE);
            bodyParams.kierunek = "przod";
          }
          const body = buildPostBody(bodyParams);
          const cacheKey = makeCacheKey("baztol_search_v2", { query, page });
          const html = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            READER_URL,
            {
              method: "POST",
              headers: {
                Accept: HTML_ACCEPT,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              },
              body,
            },
            CACHE_TTL,
          );
          const parsed = parseBaztolListHtml(html);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    query,
                    page,
                    total: parsed.total,
                    range: parsed.range,
                    items: parsed.items,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling baztol_search: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  // ── baztol_browse_domain ─────────────────────────────────────────────────
  server.tool(
    "baztol_browse_domain",
    [
      "Przeglądanie BazTOL według dziedziny (te same kategorie co w panelu bocznym portalu).",
      "Identyfikatory dziedzin: 24 Architektura, 25 Automatyka, 26 Biotechnologia, 27 Budownictwo,",
      "28 Chemia, 29 Elektronika i Telekomunikacja, 30 Elektrotechnika i Energetyka,",
      "31 Fizyka i Astronomia, 32 Geodezja i Kartografia, 33 Górnictwo i Geologia,",
      "34 Informatyka, 35 Inżynieria i Ochrona Środowiska, 36 Inżynieria Materiałowa,",
      "37 Matematyka, 38 Mechanika, 39 Oceanologia i Oceanotechnika, 40 Transport,",
      "41 Zarządzanie, 42 Źródła ogólne. Zwraca ustrukturyzowany JSON z podkategoriami i zasobami (wraz z resource_id).",
    ].join(" "),
    {
      domain_id: z
        .number()
        .int()
        .refine((n) => (BAZTOL_DOMAIN_IDS as readonly number[]).includes(n) || (n >= 100 && n <= 300), {
          message: "domain_id musi być jednym z identyfikatorów panelu bocznego BazTOL (24–42) lub poddziedziny",
        })
        .describe("Identyfikator dziedziny przedmiotowej z panelu bocznego (wartość 24–42)"),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony liczony od 1 (20 wyników na stronę)"),
    },
    async ({ domain_id, page }) => {
      return (async () => {
        try {
          const bodyParams: Record<string, string> = {
            akcja: "przegladanie",
            dziedzina_id: String(domain_id),
          };
          if (page > 1) {
            bodyParams.offset = String((page - 1) * PAGE_SIZE);
            bodyParams.kierunek = "przod";
          }
          const body = buildPostBody(bodyParams);
          const cacheKey = makeCacheKey("baztol_browse_domain_v2", { domain_id, page });
          const html = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            READER_URL,
            {
              method: "POST",
              headers: {
                Accept: HTML_ACCEPT,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              },
              body,
            },
            CACHE_TTL,
          );
          const parsed = parseBaztolListHtml(html);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    domain_id,
                    page,
                    total: parsed.total,
                    range: parsed.range,
                    subdomains: parsed.subdomains,
                    items: parsed.items,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling baztol_browse_domain: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  // ── baztol_get_resource ───────────────────────────────────────────────────
  server.tool(
    "baztol_get_resource",
    [
      "Pobiera pełną kartę opisu pojedynczego zasobu BazTOL na podstawie numerycznego identyfikatora resource_id.",
      "Identyfikatory resource_id zwracane są przez baztol_search oraz baztol_browse_domain.",
    ].join(" "),
    {
      resource_id: z.number().int().positive().describe("Identyfikator zasobu z wyników wyszukiwania lub przeglądania"),
    },
    async ({ resource_id }) => {
      return (async () => {
        try {
          const url = `${READER_URL}?id=${resource_id}`;
          const cacheKey = makeCacheKey("baztol_get_resource_v2", { resource_id });
          const html = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: { Accept: HTML_ACCEPT } },
            CACHE_TTL,
          );
          const detail = parseBaztolDetailHtml(html, resource_id);
          return {
            content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
          };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling baztol_get_resource: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );
}
