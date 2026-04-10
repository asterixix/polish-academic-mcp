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
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const SITE = "https://www.nac.gov.pl";
const RSS_URL = `${SITE}/feed/`;
const WP_API = `${SITE}/wp-json/wp/v2`;

const JSON_HEADERS = { Accept: "application/json" };
const RSS_HEADERS = { Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8" };

const FEED_TTL = 3_600; // 1 h — news
const WP_TTL = 3_600; // 1 h — CMS

const API_FIELDS = ["title", "link", "id"];

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
      return withToolExecutionSpan(
        {
          toolName: "nac_news_rss",
          params: {} as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "nac-gov");
          try {
            const key = makeCacheKey("nac_news_rss", {});
            const text = await cachedFetch(env.CACHE_KV, key, RSS_URL, { headers: RSS_HEADERS }, FEED_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = toToolErrorText(err);
            return {
              content: [{ type: "text", text: `Error calling nac_news_rss: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── nac_site_search ───────────────────────────────────────────────────────
  server.tool(
    "nac_site_search",
    [
      "Search the nac.gov.pl WordPress site (posts and pages) via REST API.",
      "Returns JSON hits with title, URL, id, subtype — use `nac_get_post` / `nac_get_page` with that id.",
      "If the response is HTTP 403, the origin WAF may block automated clients from your egress; retry from another network or use the website.",
    ].join(" "),
    {
      query: z.string().min(1).describe("Search string (Polish keywords)"),
      per_page: z.number().int().min(1).max(50).default(10).describe("Max results (1–50)"),
      subtypes: z
        .array(z.enum(["post", "page"]))
        .default(["post", "page"])
        .describe("WordPress object subtypes for content search (post vs page)"),
    },
    async ({ query, per_page, subtypes }) => {
      return withToolExecutionSpan(
        {
          toolName: "nac_site_search",
          params: { query, per_page, subtypes } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "nac-gov");
          try {
            const params = new URLSearchParams({
              search: query,
              per_page: String(per_page),
            });
            for (const s of subtypes) params.append("subtype", s);
            const url = `${WP_API}/search?${params}`;
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
        },
      );
    },
  );

  // ── nac_get_post ──────────────────────────────────────────────────────────
  server.tool(
    "nac_get_post",
    "Fetch a single blog post from nac.gov.pl as WordPress REST JSON (`/wp/v2/posts/{id}`).",
    {
      post_id: z.number().int().positive().describe("Numeric post id from nac_site_search or URLs"),
    },
    async ({ post_id }) => {
      return withToolExecutionSpan(
        {
          toolName: "nac_get_post",
          params: { post_id } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "nac-gov");
          try {
            const url = `${WP_API}/posts/${post_id}`;
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
        },
      );
    },
  );

  // ── nac_get_page ──────────────────────────────────────────────────────────
  server.tool(
    "nac_get_page",
    "Fetch a single static page from nac.gov.pl as WordPress REST JSON (`/wp/v2/pages/{id}`).",
    {
      page_id: z.number().int().positive().describe("Numeric page id from nac_site_search"),
    },
    async ({ page_id }) => {
      return withToolExecutionSpan(
        {
          toolName: "nac_get_page",
          params: { page_id } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "nac-gov");
          try {
            const url = `${WP_API}/pages/${page_id}`;
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
        },
      );
    },
  );
}
