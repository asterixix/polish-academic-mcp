import { toToolErrorText } from "../tool-error-handling.js";
/**
 * Repozytorium Cyfrowe Filmoteki Narodowej — https://repozytorium.fn.org.pl/
 *
 * Uwaga sieciowa: host `repozytorium.fn.org.pl` (148.81.43.240) bywa okresowo niedostępny
 * na poziomie TCP (odrzuca pakiety SYN), podczas gdy bliźniacze serwery Filmoteki Narodowej –
 * Instytutu Audiowizualnego (`ninateka.pl/api`, `fototeka.fn.org.pl` na 148.81.43.176) oraz
 * baza filmograficzna `www.filmpolski.pl` odpowiadają w < 300 ms.
 *
 * Aby zapobiec 30-sekundowym timeoutom, narzędzia `fn_repo_*` stosują szybki 2,5-sekundowy
 * sondaż (`FAST_REPO_TIMEOUT_MS`) z automatycznym bezpiecznikiem (circuit-breaker) i w razie
 * niedostępności `148.81.43.240` natychmiast pobierają dane filmograficzne i archiwalne
 * z aktywnych kolekcji Filmoteki Narodowej (`ninateka.pl`, `fototeka.fn.org.pl`) oraz `filmpolski.pl`.
 *
 * Narzędzia:
 *   fn_repo_search       — wyszukiwanie pełnotekstowe (`?q=pl/search/node/...`).
 *   fn_repo_get_node     — strona węzła Drupal (`?q=pl/node/{id}`).
 *   fn_repo_film_index   — skorowidz filmów według litery (`?q=pl/skorowidz-filmow`).
 *   fn_repo_browse_kind  — lista według gatunku/rodzaju materiału.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { decodeHtmlEntities, extractCompactHtml } from "../extract.js";

const ORIGIN = "https://repozytorium.fn.org.pl";
const NINATEKA_API = "https://ninateka.pl/api";
const FOTOTEKA_ORIGIN = "https://fototeka.fn.org.pl";
const FILMPOLSKI_ORIGIN = "https://www.filmpolski.pl";
const HTML_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
const CACHE_TTL = 86_400; // 24 h
const FAST_REPO_TIMEOUT_MS = 2_500;

export const FN_REPO_KINDS = [
  "fabularny",
  "dokumentalny",
  "animowany",
  "kronika-filmowa",
  "inny",
] as const;

const KIND_QUERY_MAP: Record<(typeof FN_REPO_KINDS)[number], string> = {
  fabularny: "film fabularny",
  dokumentalny: "dokumentalny",
  animowany: "animacja",
  "kronika-filmowa": "Polska Kronika Filmowa",
  inny: "etiuda",
};

// Circuit-breaker so repeated calls within a window don't even wait 2.5s when 148.81.43.240 is offline
let repoDownUntil = 0;

async function tryFetchPrimaryRepo(url: string): Promise<string | null> {
  if (Date.now() < repoDownUntil) {
    return null;
  }
  try {
    const res = await fetch(url, {
      headers: { Accept: HTML_ACCEPT },
      signal: AbortSignal.timeout(FAST_REPO_TIMEOUT_MS),
    });
    if (!res.ok) {
      repoDownUntil = Date.now() + 60_000;
      return null;
    }
    return await res.text();
  } catch {
    repoDownUntil = Date.now() + 120_000;
    return null;
  }
}

export interface FnRepoEntry {
  node_id: number;
  title: string;
  subtitle?: string;
  source: string;
  url: string;
}

function parseNinatekaVodEntries(rawJson: string): FnRepoEntry[] {
  try {
    const parsed = JSON.parse(rawJson) as {
      items?: Array<{ id?: number; title?: string; lead?: string; subtitle?: string }>;
    };
    const items = parsed?.items ?? [];
    const out: FnRepoEntry[] = [];
    for (const item of items) {
      if (typeof item.id === "number" && item.title) {
        out.push({
          node_id: item.id,
          title: item.title,
          subtitle: item.lead || item.subtitle || undefined,
          source: "Filmoteka Narodowa – Ninateka",
          url: `https://ninateka.pl/vod/${item.id}`,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function parseFototekaSearchEntries(html: string): FnRepoEntry[] {
  const entries: FnRepoEntry[] = [];
  const seen = new Set<number>();
  const re = /<a\s+[^>]*href="(\/pl\/foto\/view\/(\d+)\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = Number.parseInt(m[2], 10);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    const text = decodeHtmlEntities(m[3].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    seen.add(id);
    entries.push({
      node_id: id,
      title: text && text.length >= 2 ? text : `Fotogram archiwalny FN #${id}`,
      source: "Filmoteka Narodowa – Fototeka",
      url: `${FOTOTEKA_ORIGIN}${m[1]}`,
    });
  }
  return entries;
}

function parseFilmPolskiSearchEntries(html: string): FnRepoEntry[] {
  const entries: FnRepoEntry[] = [];
  const seen = new Set<number>();
  const re = /<a\s+[^>]*href="(?:https?:\/\/www\.filmpolski\.pl)?(?:\/fp\/)?index\.php\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = Number.parseInt(m[1], 10);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    const title = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (!title || title.length < 2) continue;
    seen.add(id);
    entries.push({
      node_id: id,
      title,
      source: "FilmPolski.pl / Filmoteka Narodowa",
      url: `${FILMPOLSKI_ORIGIN}/fp/index.php/${id}`,
    });
  }
  return entries;
}

async function fetchFallbackFilmSearch(
  env: Env,
  query: string,
  page: number,
): Promise<{ items: FnRepoEntry[] }> {
  const ninatekaParams = new URLSearchParams({
    keyword: query,
    platform: "BROWSER",
    limit: "15",
    firstResult: String(Math.max(0, (page - 1) * 15)),
  });
  const ninatekaUrl = `${NINATEKA_API}/products/vods/search?${ninatekaParams}`;

  const fototekaParams = new URLSearchParams({
    key: query,
    search_type: "slowo_kluczowe",
    pageNumber: String(page),
    howmany: "15",
  });
  const fototekaUrl = `${FOTOTEKA_ORIGIN}/pl/strona/wyszukiwarka.html?${fototekaParams}`;

  const fpUrl = `${FILMPOLSKI_ORIGIN}/fp/index.php?szukaj=${encodeURIComponent(query)}`;

  const [ninatekaJson, fpHtml, fototekaHtml] = await Promise.all([
    cachedFetch(
      env.CACHE_KV,
      makeCacheKey("fn_repo_fallback_ninateka_v2", { query, page }),
      ninatekaUrl,
      { headers: { Accept: "application/json" } },
      CACHE_TTL,
    ).catch(() => ""),
    cachedFetch(
      env.CACHE_KV,
      makeCacheKey("fn_repo_fallback_fp_v2", { query }),
      fpUrl,
      { headers: { Accept: HTML_ACCEPT } },
      CACHE_TTL,
    ).catch(() => ""),
    cachedFetch(
      env.CACHE_KV,
      makeCacheKey("fn_repo_fallback_fototeka_v2", { query, page }),
      fototekaUrl,
      { headers: { Accept: HTML_ACCEPT } },
      CACHE_TTL,
    ).catch(() => ""),
  ]);

  const items = [
    ...parseNinatekaVodEntries(ninatekaJson),
    ...parseFilmPolskiSearchEntries(fpHtml),
    ...parseFototekaSearchEntries(fototekaHtml),
  ].slice(0, 25);

  return { items };
}

export function registerFilmotekaRepoTools(server: McpServer, env: Env): void {
  // ── fn_repo_search ────────────────────────────────────────────────────────
  server.tool(
    "fn_repo_search",
    [
      "Wyszukiwanie pełnotekstowe w Repozytorium Cyfrowym Filmoteki Narodowej (repozytorium.fn.org.pl).",
      "Zwraca ustrukturyzowaną listę pozycji filmowych i archiwalnych wraz z identyfikatorem `node_id` do użycia w fn_repo_get_node.",
      "W przypadku przejściowej niedostępności serwera repozytorium.fn.org.pl automatycznie pobiera dane z aktywnych kolekcji Filmoteki Narodowej (Ninateka FINA, Fototeka FN, FilmPolski).",
    ].join(" "),
    {
      query: z.string().min(1).describe("Słowo kluczowe: tytuł filmu, nazwisko reżysera/aktora lub temat"),
      page: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Numer strony liczony od 0 (konwencja paginacji Drupal)"),
    },
    async ({ query, page }) => {
      try {
        const segment = encodeURIComponent(query.trim());
        const pageParam = page > 0 ? `&page=${page}` : "";
        const url = `${ORIGIN}/?q=pl/search/node/${segment}${pageParam}`;

        const primaryHtml = await tryFetchPrimaryRepo(url);
        if (primaryHtml) {
          return { content: [{ type: "text", text: extractCompactHtml(primaryHtml) }] };
        }

        const fallback = await fetchFallbackFilmSearch(env, query.trim(), page + 1);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query: query.trim(),
                  page,
                  mirror_used: "ninateka.pl + filmpolski.pl + fototeka.fn.org.pl (repozytorium.fn.org.pl offline)",
                  count: fallback.items.length,
                  items: fallback.items,
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
          content: [{ type: "text", text: `Error calling fn_repo_search: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // ── fn_repo_get_node ──────────────────────────────────────────────────────
  server.tool(
    "fn_repo_get_node",
    [
      "Pobiera kartę pojedynczego węzła z Repozytorium Cyfrowego Filmoteki Narodowej na podstawie numerycznego identyfikatora `node_id`.",
      "Obsługuje zarówno węzły repozytorium.fn.org.pl, jak i identyfikatory pozycji z powiązanych baz Filmoteki Narodowej zwracane przez fn_repo_search / fn_repo_film_index.",
    ].join(" "),
    {
      node_id: z.number().int().positive().describe("Numeryczny identyfikator węzła (node_id)"),
    },
    async ({ node_id }) => {
      try {
        const url = `${ORIGIN}/?q=pl/node/${node_id}`;
        const primaryHtml = await tryFetchPrimaryRepo(url);
        if (primaryHtml) {
          return { content: [{ type: "text", text: extractCompactHtml(primaryHtml) }] };
        }

        // 1) Try Ninateka VOD API first
        const ninatekaUrl = `${NINATEKA_API}/products/vods/${node_id}?platform=BROWSER`;
        const ninatekaJson = await cachedFetch(
          env.CACHE_KV,
          makeCacheKey("fn_repo_get_node_ninateka_v2", { node_id }),
          ninatekaUrl,
          { headers: { Accept: "application/json" } },
          CACHE_TTL,
        ).catch(() => "");

        if (ninatekaJson && ninatekaJson.includes('"title"')) {
          return {
            content: [
              {
                type: "text",
                text: ninatekaJson,
              },
            ],
          };
        }

        // 2) Fallback to FilmPolski record by ID
        const fpUrl = `${FILMPOLSKI_ORIGIN}/fp/index.php/${node_id}`;
        const fpHtml = await cachedFetch(
          env.CACHE_KV,
          makeCacheKey("fn_repo_get_node_fallback_fp_v2", { node_id }),
          fpUrl,
          { headers: { Accept: HTML_ACCEPT } },
          CACHE_TTL,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  node_id,
                  url: fpUrl,
                  details: extractCompactHtml(fpHtml),
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
          content: [{ type: "text", text: `Error calling fn_repo_get_node: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // ── fn_repo_film_index ────────────────────────────────────────────────────
  server.tool(
    "fn_repo_film_index",
    [
      "Przegląda alfabetyczny skorowidz filmów w Repozytorium Cyfrowym Filmoteki Narodowej.",
      "Przekaż pojedynczą wielką literę (A–Z) oraz opcjonalny filtr tytułu i numer strony.",
    ].join(" "),
    {
      letter: z
        .string()
        .regex(/^[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]$/, "Podaj pojedynczą literę")
        .describe("Litera początkowa tytułu filmu (np. A, K, P, W)"),
      title: z
        .string()
        .optional()
        .describe("Opcjonalny podciąg tytułu zawężający listę"),
      page: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Numer strony liczony od 0"),
    },
    async ({ letter, title, page }) => {
      try {
        const L = letter.toUpperCase();
        const params = new URLSearchParams();
        params.set("q", "pl/skorowidz-filmow");
        params.set("letter", L);
        params.set("title", title ?? "");
        if (page > 0) params.set("page", String(page));
        const url = `${ORIGIN}/?${params.toString()}`;

        const primaryHtml = await tryFetchPrimaryRepo(url);
        if (primaryHtml) {
          return { content: [{ type: "text", text: extractCompactHtml(primaryHtml) }] };
        }

        const effectiveQuery = title && title.trim().length > 0 ? title.trim() : `film ${L}`;
        const fallback = await fetchFallbackFilmSearch(env, effectiveQuery, page + 1);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  letter: L,
                  title: title ?? null,
                  page,
                  count: fallback.items.length,
                  items: fallback.items,
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
          content: [{ type: "text", text: `Error calling fn_repo_film_index: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // ── fn_repo_browse_kind ───────────────────────────────────────────────────
  server.tool(
    "fn_repo_browse_kind",
    [
      "Przegląda Repozytorium Cyfrowe Filmoteki Narodowej według rodzaju materiału:",
      "fabularny, dokumentalny, animowany, kronika-filmowa (Polska Kronika Filmowa), inny.",
    ].join(" "),
    {
      kind: z
        .enum(FN_REPO_KINDS)
        .describe("Kategoria materiału w Repozytorium Cyfrowym Filmoteki Narodowej"),
      page: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Numer strony liczony od 0"),
    },
    async ({ kind, page }) => {
      try {
        const pageParam = page > 0 ? `&page=${page}` : "";
        const url = `${ORIGIN}/?q=pl/${kind}${pageParam}`;

        const primaryHtml = await tryFetchPrimaryRepo(url);
        if (primaryHtml) {
          return { content: [{ type: "text", text: extractCompactHtml(primaryHtml) }] };
        }

        const fallbackQuery = KIND_QUERY_MAP[kind] ?? kind;
        const fallback = await fetchFallbackFilmSearch(env, fallbackQuery, page + 1);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  kind,
                  page,
                  count: fallback.items.length,
                  items: fallback.items,
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
          content: [{ type: "text", text: `Error calling fn_repo_browse_kind: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
