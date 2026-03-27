/**
 * FilmPolski.pl — Internetowa Baza Filmu Polskiego (PWSFTviT Łódź).
 *
 * Brak publicznego API JSON; wyszukiwarka to GET HTML (`index.php?szukaj=&rodzaj=`).
 * Narzędzia zwracają znormalizowany JSON (wyniki) lub obcięty tekst rekordu (`<article id="film|osoba">`).
 *
 * Regulamin serwisu ogranicza kopiowanie treści — używaj krótkich fragmentów i podawaj źródło (filmpolski.pl).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const SITE = "https://www.filmpolski.pl/fp";
const INDEX = `${SITE}/index.php`;

const HTML_HEADERS: HeadersInit = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pl,en;q=0.8",
};

/** 24 h — baza zmienia się rzadko względem pojedynczych rekordów */
const CACHE_TTL = 86_400;

const MAX_RECORD_CHARS = 25_000;

const API_FIELDS = ["id", "title", "label", "details"];

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number.parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)));
}

function stripToPlain(html: string): string {
  let s = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s.replace(/[ \t\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function extractArticleHtml(page: string): string | undefined {
  const m = /<article id="(?:film|osoba)">([\s\S]*?)<\/article>/i.exec(page);
  return m?.[1];
}

function parsePeopleList(inner: string): Array<{ id: string; label: string; hint?: string }> {
  const out: Array<{ id: string; label: string; hint?: string }> = [];
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = liRe.exec(inner)) !== null) {
    const li = lm[1];
    const hint = /<div class="rodzajfilmu">([^<]*)<\/div>/i.exec(li)?.[1]?.trim();
    const linkRe = /<a href="index\.php\/(\d+)"[^>]*>([^<]*)<\/a>/gi;
    let last: { id: string; label: string } | undefined;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(li)) !== null) {
      const label = decodeEntities(m[2]).trim();
      if (label.length > 0) last = { id: m[1], label };
    }
    if (last) {
      const row: { id: string; label: string; hint?: string } = { id: last.id, label: last.label };
      if (hint) row.hint = decodeEntities(hint).replace(/\s+/g, " ").trim();
      out.push(row);
    }
  }
  return out;
}

function parseFilmsList(inner: string): Array<{ id: string; title: string; details?: string }> {
  const out: Array<{ id: string; title: string; details?: string }> = [];
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = liRe.exec(inner)) !== null) {
    const li = lm[1];
    const details = /<div class="rodzajfilmu">([^<]*)<\/div>/i.exec(li)?.[1]?.trim();
    const linkRe = /<a href="index\.php\/(\d+)"[^>]*>([^<]*)<\/a>/gi;
    let last: { id: string; title: string } | undefined;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(li)) !== null) {
      const title = decodeEntities(m[2]).trim();
      if (title.length > 0) last = { id: m[1], title };
    }
    if (last) {
      const row: { id: string; title: string; details?: string } = { id: last.id, title: last.title };
      if (details) row.details = decodeEntities(details).replace(/\s+/g, " ").trim();
      out.push(row);
    }
  }
  return out;
}

function parseSearchPage(html: string): {
  people: Array<{ id: string; label: string; hint?: string }>;
  films: Array<{ id: string; title: string; details?: string }>;
  emptyMessage?: string;
} {
  if (/<b>\s*Nic nie znalazłem\s*<\/b>/i.test(html)) {
    return { people: [], films: [], emptyMessage: "Nic nie znalazłem" };
  }
  const peopleBlock = /<ul class="wynikiszukania wynikiszukaniaosoba">([\s\S]*?)<\/ul>/i.exec(html);
  const filmsBlock = /<ul class="wynikiszukania">([\s\S]*?)<\/ul>/i.exec(html);
  const people = peopleBlock ? parsePeopleList(peopleBlock[1]) : [];
  const films = filmsBlock ? parseFilmsList(filmsBlock[1]) : [];
  return { people, films };
}

export function registerFilmpolskiTools(server: McpServer, env: Env): void {
  server.tool(
    "filmpolski_search",
    [
      "Search FilmPolski.pl (Polish Film Database): films, TV, theatre, and people/institutions.",
      "No official JSON API — HTML is parsed into compact JSON (ids for filmpolski_get_item).",
      "match_mode: fragment (substring), start (title/name prefix), exact (exact title; for persons use 'Surname, Firstname' with comma).",
      "Respect site terms: short excerpts; cite filmpolski.pl as source.",
    ].join(" "),
    {
      query: z.string().min(1).describe("Search phrase (film title fragment or person name)"),
      match_mode: z
        .enum(["fragment", "start", "exact"])
        .default("fragment")
        .describe(
          "fragment = any match; start = titles/names starting with query; exact = exact title or 'Kowalski, Jan' for persons",
        ),
    },
    async ({ query, match_mode }) => {
      const rodzaj = match_mode === "start" ? 2 : match_mode === "exact" ? 3 : 1;
      return withToolExecutionSpan(
        {
          toolName: "filmpolski_search",
          params: { query, match_mode } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "filmpolski");
          try {
            const qs = new URLSearchParams({
              szukaj: query,
              rodzaj: String(rodzaj),
            });
            const url = `${INDEX}?${qs.toString()}`;
            const cacheKey = makeCacheKey("filmpolski_search", { query, rodzaj });
            const html = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: HTML_HEADERS }, CACHE_TTL);
            const parsed = parseSearchPage(html);
            const payload = {
              source: "filmpolski.pl",
              query,
              match_mode,
              rodzaj,
              ...parsed,
              ui_search: url,
              ui_record: `${INDEX}/{id}`,
            };
            return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling filmpolski_search: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "filmpolski_get_item",
    [
      "Fetch one FilmPolski.pl record by numeric id (from filmpolski_search links index.php/{id}).",
      "Returns plain text extracted from the main <article> (film or person), truncated for LLM context.",
      "Full page is HTML; this tool strips markup. Obey copyright/database notices on the site.",
    ].join(" "),
    {
      item_id: z
        .number()
        .int()
        .min(1)
        .describe("Numeric record id from a filmpolski index.php/{id} URL"),
    },
    async ({ item_id }) => {
      return withToolExecutionSpan(
        {
          toolName: "filmpolski_get_item",
          params: { item_id } as Record<string, unknown>,
          fieldsRequested: ["text"],
          fieldsReturned: ["text"],
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "filmpolski");
          try {
            const url = `${INDEX}/${item_id}`;
            const cacheKey = makeCacheKey("filmpolski_get_item", { item_id });
            const html = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: HTML_HEADERS }, CACHE_TTL);
            const inner = extractArticleHtml(html);
            if (!inner) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        item_id,
                        url,
                        error: "Could not find article body (wrong id or page layout changed).",
                      },
                      null,
                      2,
                    ),
                  },
                ],
                isError: true,
              };
            }
            let text = stripToPlain(inner);
            let truncated = false;
            if (text.length > MAX_RECORD_CHARS) {
              text = text.slice(0, MAX_RECORD_CHARS);
              truncated = true;
            }
            const kind = /<article id="film"/i.test(html) ? "film" : "osoba";
            const payload = {
              item_id,
              kind,
              url,
              text,
              truncated,
              source: "filmpolski.pl",
            };
            return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling filmpolski_get_item: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
