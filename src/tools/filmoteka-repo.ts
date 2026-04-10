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
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const ORIGIN = "https://repozytorium.fn.org.pl";
const HTML_ACCEPT = "text/html; charset=utf-8";
const SEARCH_TTL = 3_600;
const PAGE_TTL = 86_400;

const API_FIELDS = ["title", "url", "html"];

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
      "Search the Filmoteka Narodowa digital repository (repozytorium.fn.org.pl) via Apache Solr.",
      "No JSON API — returns the same HTML result page as the website (tiles with links to /?q=pl/node/…).",
      "Optional facets are Solr filter values, e.g. bundle:doc (documentary), bundle:feature (fiction), bundle:article, bundle:person.",
      "Optional page is 0-based pager index (omit or 0 for first page).",
    ].join(" "),
    {
      query: z.string().min(1).describe("Search phrase (titles, people, topics)."),
      lang: z
        .enum(["pl", "en"])
        .default("pl")
        .describe("Site language segment in URLs (pl or en)."),
      facets: z
        .array(z.string())
        .optional()
        .describe(
          'Facet filters as "field:value", e.g. bundle:doc, bundle:feature, sm_field_year:1964 (from HTML facet links).',
        ),
      page: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("0-based result page index (second page = 1 when pager exists)."),
    },
    async ({ query, lang, facets, page }) => {
      return withToolExecutionSpan(
        {
          toolName: "fn_repo_search",
          params: { query, lang, facets, page } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "fn-repozytorium");
          try {
            const url = buildSiteSearchUrl({ query, lang, facets, page });
            const cacheKey = makeCacheKey("fn_repo_search", { query, lang, facets, page });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: { Accept: HTML_ACCEPT } }, SEARCH_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = toToolErrorText(err);
            return {
              content: [{ type: "text", text: `Error calling fn_repo_search: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "fn_repo_get_node",
    [
      "Fetch one repository page by Drupal node id (numeric), as in /?q=pl/node/8937.",
      "Returns HTML (metadata, description, video embeds, person links).",
    ].join(" "),
    {
      node_id: z.number().int().positive().describe("Drupal node id from search result links."),
      lang: z.enum(["pl", "en"]).default("pl").describe("Language prefix for the node path."),
    },
    async ({ node_id, lang }) => {
      return withToolExecutionSpan(
        {
          toolName: "fn_repo_get_node",
          params: { node_id, lang } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "fn-repozytorium");
          try {
            const u = new URL(ORIGIN);
            u.searchParams.set("q", drupalQ(`node/${node_id}`, lang));
            const url = u.toString();
            const cacheKey = makeCacheKey("fn_repo_get_node", { node_id, lang });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: { Accept: HTML_ACCEPT } }, PAGE_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = toToolErrorText(err);
            return {
              content: [{ type: "text", text: `Error calling fn_repo_get_node: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "fn_repo_film_index",
    [
      "Browse the film catalog by first letter of title (A–Z, Polish letters, or INNE).",
      "Returns HTML list linking to /?q=pl/node/… — same as the site “katalog filmów”.",
    ].join(" "),
    {
      letter: z
        .string()
        .min(1)
        .max(3)
        .describe(
          "Index key: A–Z, Ą, Ć, E, Ł, Ń, Ó, Ś, Ź, Ż, or - (hyphen) for “INNE”.",
        ),
      lang: z.enum(["pl", "en"]).default("pl").describe("Language prefix."),
    },
    async ({ letter, lang }) => {
      return withToolExecutionSpan(
        {
          toolName: "fn_repo_film_index",
          params: { letter, lang } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(letter),
        },
        async (span) => {
          span.setAttribute("mcp.source", "fn-repozytorium");
          try {
            const segment = letter === "-" ? "-" : encodeURIComponent(letter);
            const u = new URL(ORIGIN);
            u.searchParams.set("q", drupalQ(`fnsearch/film_index/${segment}`, lang));
            const url = u.toString();
            const cacheKey = makeCacheKey("fn_repo_film_index", { letter, lang });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: { Accept: HTML_ACCEPT } }, PAGE_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = toToolErrorText(err);
            return {
              content: [{ type: "text", text: `Error calling fn_repo_film_index: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "fn_repo_browse_kind",
    [
      "Browse by production kind: fiction (fabularne), documentary, animation/experimental, or magazine — same entries as the top menu.",
      "Returns HTML (not JSON).",
    ].join(" "),
    {
      kind: z
        .enum(["feature", "doc", "animation", "magazine"])
        .describe("feature = fabularne, doc = dokumentalne, animation = animacje, magazine = magazyn."),
      lang: z.enum(["pl", "en"]).default("pl").describe("Language prefix."),
    },
    async ({ kind, lang }) => {
      return withToolExecutionSpan(
        {
          toolName: "fn_repo_browse_kind",
          params: { kind, lang } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "fn-repozytorium");
          try {
            const u = new URL(ORIGIN);
            u.searchParams.set("q", drupalQ(`search/${kind}`, lang));
            const url = u.toString();
            const cacheKey = makeCacheKey("fn_repo_browse_kind", { kind, lang });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: { Accept: HTML_ACCEPT } }, PAGE_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = toToolErrorText(err);
            return {
              content: [{ type: "text", text: `Error calling fn_repo_browse_kind: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
