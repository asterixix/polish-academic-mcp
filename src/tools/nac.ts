import { toToolErrorText } from "../tool-error-handling.js";
/**
 * NAC — Narodowe Archiwum Cyfrowe (www.nac.gov.pl).
 *
 * The institutional site is WordPress (RSS + optional REST). Digitized holdings are published
 * separately in “Szukaj w Archiwach” (https://szukajwarchiwach.gov.pl/) — see NAC:
 * https://www.nac.gov.pl/archiwum-cyfrowe/systemy-i-infrastruktura-it/szukajwarchiwach-pl/
 * There is no documented public JSON API for that archive search; community notes describe
 * session-heavy HTML flows (e.g. https://github.com/jasiek/szukajwarchiwach), and the service
 * often sits behind bot/WAF protection — not suitable for reliable Worker `fetch`.
 *
 * Tools:
 *   nac_news_rss     — RSS 2.0 feed of news (aktualności) from nac.gov.pl.
 *   nac_site_search  — WordPress REST search across posts/pages (`/wp-json/wp/v2/search`).
 *   nac_get_post     — Single post or page JSON (`/wp-json/wp/v2/posts/{id}` or …/pages/{id}).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const SITE = "https://www.nac.gov.pl";
const RSS_URL = `${SITE}/feed/`;
const WP_REST_BASE = `${SITE}/?rest_route=/wp/v2`;

const JSON_HEADERS = {
  Accept: "application/json",
  "Accept-Language": "pl,en;q=0.8",
  Referer: `${SITE}/`,
  "User-Agent": "Mozilla/5.0 (compatible; PolishAcademicMCP/1.0)",
};
const RSS_HEADERS = { Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8" };

const FEED_TTL = 3_600; // 1 h — news
const WP_TTL = 3_600; // 1 h — CMS

function buildWpRestUrl(path: string, params?: URLSearchParams): string {
  const cleanPath = path.replace(/^\/+/, "");
  const base = `${WP_REST_BASE}/${cleanPath}`;
  if (!params || params.size === 0) {
    return base;
  }
  return `${base}&${params.toString()}`;
}

export function registerNacTools(server: McpServer, env: Env): void {
  // ── nac_news_rss ──────────────────────────────────────────────────────────
  server.tool(
    "nac_news_rss",
    [
      "Fetch the NAC institutional news RSS 2.0 feed (aktualności, WordPress).",
      "Returns raw XML. This is not the digitized archival catalogue — that lives on",
      "szukajwarchiwach.gov.pl (no stable public REST API for programmatic search).",
    ].join(" "),
    {},
    async () => {
      return (async () => {
        try {
          const key = makeCacheKey("nac_news_rss", {});
          const text = await cachedFetch(
            env.CACHE_KV,
            key,
            RSS_URL,
            { headers: RSS_HEADERS },
            FEED_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling nac_news_rss: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  // ── nac_site_search ───────────────────────────────────────────────────────
  server.tool(
    "nac_site_search",
    [
      "Wyszukiwanie w serwisie WordPress nac.gov.pl (wpisy i strony) przez REST API.",
      "Zwraca trafienia JSON z title, URL, id, subtype — użyj nac_get_post / nac_get_page z tym identyfikatorem.",
      "Jeśli odpowiedź to HTTP 403, WAF origin może blokować zautomatyzowanych klientów; spróbuj z innej sieci albo skorzystaj z serwisu.",
    ].join(" "),
    {
      query: z.string().min(1).describe("Fraza wyszukiwania (polskie słowa kluczowe)"),
      per_page: z.number().int().min(1).max(50).default(10).describe("Maksymalna liczba wyników (1–50)"),
      subtypes: z
        .array(z.enum(["post", "page"]))
        .default(["post", "page"])
        .describe("Podtypy obiektów WordPress do przeszukania (post vs page)"),
    },
    async ({ query, per_page, subtypes }) => {
      return (async () => {
        try {
          const params = new URLSearchParams({
            search: query,
            per_page: String(per_page),
          });
          for (const s of subtypes) params.append("subtype", s);
          const url = buildWpRestUrl("search", params);
          const key = makeCacheKey("nac_site_search", { query, per_page, subtypes });
          const text = await cachedFetch(env.CACHE_KV, key, url, { headers: JSON_HEADERS }, WP_TTL);
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling nac_site_search: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  // ── nac_get_post ──────────────────────────────────────────────────────────
  server.tool(
    "nac_get_post",
    "Pobiera pojedynczy wpis blogowy z nac.gov.pl jako JSON REST WordPress (`/wp/v2/posts/{id}`).",
    {
      post_id: z.number().int().positive().describe("Numeryczny identyfikator wpisu z nac_site_search lub URL"),
    },
    async ({ post_id }) => {
      return (async () => {
        try {
          const url = buildWpRestUrl(`posts/${post_id}`);
          const key = makeCacheKey("nac_get_post", { post_id });
          const text = await cachedFetch(env.CACHE_KV, key, url, { headers: JSON_HEADERS }, WP_TTL);
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling nac_get_post: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  // ── nac_get_page ──────────────────────────────────────────────────────────
  server.tool(
    "nac_get_page",
    "Pobiera pojedynczą stronę statyczną z nac.gov.pl jako JSON REST WordPress (`/wp/v2/pages/{id}`).",
    {
      page_id: z.number().int().positive().describe("Numeryczny identyfikator strony z nac_site_search"),
    },
    async ({ page_id }) => {
      return (async () => {
        try {
          const url = buildWpRestUrl(`pages/${page_id}`);
          const key = makeCacheKey("nac_get_page", { page_id });
          const text = await cachedFetch(env.CACHE_KV, key, url, { headers: JSON_HEADERS }, WP_TTL);
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling nac_get_page: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );
}
