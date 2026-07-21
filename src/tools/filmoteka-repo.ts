import { toToolErrorText } from "../tool-error-handling.js";
/**
 * Repozytorium Cyfrowe Filmoteki Narodowej — https://repozytorium.fn.org.pl/
 *
 * There is no public JSON REST API; the site is Drupal 7 + Apache Solr. Search and
 * browse replay the same GET URLs the browser uses; responses are HTML (result tiles,
 * facets, record pages).
 *
 * Docs / overview: https://repozytorium.fn.org.pl/?q=pl/node/10 (terms of use) — no machine API doc.
 *
 * Tools:
 *   fn_repo_search       — Solr site search (HTML tiles).
 *   fn_repo_get_node     — one catalog node by numeric id (film/article/person…).
 *   fn_repo_film_index   — alphabetical film title index (HTML list).
 *   fn_repo_browse_kind  — preset browse: fabularne / dokumentalne / animacje / magazyn.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const ORIGIN = "https://repozytorium.fn.org.pl";
const HTML_ACCEPT = "text/html; charset=utf-8";
const SEARCH_TTL = 3_600;
const PAGE_TTL = 86_400;

function drupalQ(pathAfterLang: string, lang: "pl" | "en"): string {
  return `${lang}/${pathAfterLang}`;
}

function buildSiteSearchUrl(args: {
  query: string;
  lang: "pl" | "en";
  facets: string[] | undefined;
  page: number | undefined;
}): string {
  const path = `search/site/${encodeURIComponent(args.query)}`;
  const u = new URL(ORIGIN);
  u.searchParams.set("q", drupalQ(path, args.lang));
  if (args.page !== undefined && args.page > 0) {
    u.searchParams.set("page", String(args.page));
  }
  if (args.facets?.length) {
    args.facets.forEach((f, i) => {
      u.searchParams.set(`f[${i}]`, f);
    });
  }
  return u.toString();
}

export function registerFilmotekaRepoTools(server: McpServer, env: Env): void {
  server.tool(
    "fn_repo_search",
    [
      "Wyszukiwanie w cyfrowym repozytorium Filmoteki Narodowej (repozytorium.fn.org.pl) przez Apache Solr.",
      "Brak JSON API — zwraca tę samą stronę HTML wyników co serwis (kafelki z odnośnikami do /?q=pl/node/…).",
      "Opcjonalne facets to wartości filtrów Solr, na przykład bundle:doc (dokumentalne), bundle:feature (fabularne), bundle:article, bundle:person.",
      "Opcjonalny page to indeks strony liczony od zera (pomiń lub 0 dla pierwszej).",
    ].join(" "),
    {
      query: z.string().min(1).describe("Fraza wyszukiwania (tytuły, osoby, tematy)."),
      lang: z
        .enum(["pl", "en"])
        .default("pl")
        .describe("Segment języka serwisu w URL (pl lub en)."),
      facets: z
        .array(z.string())
        .optional()
        .describe(
          "Filtry facetów jako \"pole:wartość\", np. bundle:doc, bundle:feature, sm_field_year:1964 (z odnośników facety HTML).",
        ),
      page: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Indeks strony wyników liczony od zera (drug strona = 1 gdy istnieje pager)."),
    },
    async ({ query, lang, facets, page }) => {
      return (async () => {
        try {
          const url = buildSiteSearchUrl({ query, lang, facets, page });
          const cacheKey = makeCacheKey("fn_repo_search", { query, lang, facets, page });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: { Accept: HTML_ACCEPT } },
            SEARCH_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling fn_repo_search: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "fn_repo_get_node",
    [
      "Pobiera jedną stronę repozytorium po identyfikatorze węzła Drupala (numeryczny), jak w /?q=pl/node/8937.",
      "Zwraca HTML (metadane, opis, osadzone filmy, odnośniki do osób).",
    ].join(" "),
    {
      node_id: z.number().int().positive().describe("Identyfikator węzła Drupala z odnośników wyników wyszukiwania."),
      lang: z.enum(["pl", "en"]).default("pl").describe("Prefiks języka dla ścieżki węzła."),
    },
    async ({ node_id, lang }) => {
      return (async () => {
        try {
          const u = new URL(ORIGIN);
          u.searchParams.set("q", drupalQ(`node/${node_id}`, lang));
          const url = u.toString();
          const cacheKey = makeCacheKey("fn_repo_get_node", { node_id, lang });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: { Accept: HTML_ACCEPT } },
            PAGE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling fn_repo_get_node: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "fn_repo_film_index",
    [
      "Przeglądanie katalogu filmów wg pierwszej litery tytułu (A–Z, polskie litery lub INNE).",
      "Zwraca listę HTML z odnośnikami do /?q=pl/node/… — tę samą co „katalog filmów” na stronie.",
    ].join(" "),
    {
      letter: z
        .string()
        .min(1)
        .max(3)
        .describe("Klucz indeksu: A–Z, Ą, Ć, E, Ł, Ń, Ó, Ś, Ź, Ż lub - (myślnik) dla „INNE”."),
      lang: z.enum(["pl", "en"]).default("pl").describe("Prefiks języka."),
    },
    async ({ letter, lang }) => {
      return (async () => {
        try {
          const segment = letter === "-" ? "-" : encodeURIComponent(letter);
          const u = new URL(ORIGIN);
          u.searchParams.set("q", drupalQ(`fnsearch/film_index/${segment}`, lang));
          const url = u.toString();
          const cacheKey = makeCacheKey("fn_repo_film_index", { letter, lang });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: { Accept: HTML_ACCEPT } },
            PAGE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling fn_repo_film_index: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "fn_repo_browse_kind",
    [
      "Przeglądanie wg rodzaju produkcji: fabularne, dokumentalne, animacje i eksperymentalne albo magazyn — jak pozycje w menu głównym.",
      "Zwraca HTML (nie JSON).",
    ].join(" "),
    {
      kind: z
        .enum(["feature", "doc", "animation", "magazine"])
        .describe(
          "Identyfikator rodzaju: feature — fabularne, doc — dokumentalne, animation — animacje, magazine — magazyn filmowy.",
        ),
      lang: z.enum(["pl", "en"]).default("pl").describe("Prefiks języka."),
    },
    async ({ kind, lang }) => {
      return (async () => {
        try {
          const u = new URL(ORIGIN);
          u.searchParams.set("q", drupalQ(`search/${kind}`, lang));
          const url = u.toString();
          const cacheKey = makeCacheKey("fn_repo_browse_kind", { kind, lang });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: { Accept: HTML_ACCEPT } },
            PAGE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling fn_repo_browse_kind: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );
}
