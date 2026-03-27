/**
 * Fototeka Śląska — Muzeum Wsi Opolskiej, https://fototekaslaska.pl/
 *
 * WordPress udostępnia ogólne endpointy `/wp-json/`, ale rekordy galerii nie mają
 * publicznego `wp/v2/{post_type}` (404). Wyszukiwanie: GET na stronę główną z parametrami
 * formularza (`s`, `t`, `y`, opcjonalnie `paged`).
 *
 * Tools:
 *   fototekaslaska_search     — wyniki z sekcji `.search-list` (JSON).
 *   fototekaslaska_get_photo  — strona `/galeria/{slug}/`, metadane + opis (tekst).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const SITE = "https://fototekaslaska.pl";

const HTML_HEADERS: HeadersInit = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pl,de;q=0.8,en;q=0.7",
};

const CACHE_TTL = 86_400;

const MAX_DETAIL_CHARS = 20_000;

const API_FIELDS = ["slug", "url", "caption", "image_url"];

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;/g, "'")
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

function parseSearchList(html: string): {
  items: Array<{ slug: string; url: string; caption: string; image_url?: string }>;
  empty_message?: string;
} {
  if (/\bclass="result-empty"/.test(html) || /\bNic nie znaleziono\b/i.test(html)) {
    const m = /<div class="result-empty">\s*([^<]+)/i.exec(html);
    return {
      items: [],
      empty_message: m?.[1]?.replace(/\s+/g, " ").trim() ?? "Nic nie znaleziono.",
    };
  }

  const block = /<div class="search-list">([\s\S]*?)<h3 class="serch-recently-added">/i.exec(html);
  if (!block) {
    return { items: [], empty_message: "Brak sekcji wyników (nieznany układ strony)." };
  }

  const inner = block[1];
  const items: Array<{ slug: string; url: string; caption: string; image_url?: string }> = [];
  const liRe = /<div class="gallery-listing-single">\s*<a href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(inner)) !== null) {
    const url = m[1];
    const slugMatch = /\/galeria\/([^/]+)\/?/.exec(url);
    if (!slugMatch) continue;
    const slug = slugMatch[1];
    const body = m[2];
    const img =
      /data-src="(https?:\/\/[^"]+)"/i.exec(body)?.[1] ?? /<img[^>]*src="(https?:\/\/[^"]+)"/i.exec(body)?.[1];
    const cap = /<div class="gallery-listing-details">\s*([^<]+)/i.exec(body)?.[1];
    const caption = cap ? decodeEntities(cap).replace(/\s+/g, " ").trim() : "";
    const row: { slug: string; url: string; caption: string; image_url?: string } = {
      slug,
      url,
      caption,
    };
    if (img) row.image_url = img;
    items.push(row);
  }

  return { items };
}

function parsePhotoPage(html: string): {
  title?: string;
  catalog_note?: string;
  image_url?: string;
  details_text: string;
} {
  const title = /<div class="[^"]*\bsingle-gallery\b[^"]*"[^>]*>\s*<h2>([^<]+)<\/h2>/i.exec(html)?.[1]?.trim();
  const catalog_note = /<p class="single-gallery-n">([^<]+)<\/p>/i.exec(html)?.[1]?.trim();
  const image_url =
    /<a class="gallery-listing-box[^"]*" href="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/i.exec(html)?.[1] ??
    /<img class="lazy single-gallery-image"[^>]*data-src="(https?:\/\/[^"]+)"/i.exec(html)?.[1];

  const detailsHtml =
    /<div class="single-gallery-details">([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? "";
  let details_text = stripToPlain(detailsHtml);
  if (details_text.length > MAX_DETAIL_CHARS) {
    details_text = `${details_text.slice(0, MAX_DETAIL_CHARS)}… [truncated]`;
  }

  return {
    title: title ? decodeEntities(title) : undefined,
    catalog_note: catalog_note ? decodeEntities(catalog_note) : undefined,
    image_url,
    details_text,
  };
}

export function registerFototekaslaskaTools(server: McpServer, env: Env): void {
  server.tool(
    "fototekaslaska_search",
    [
      "Search Fototeka Śląska (rural Silesia / Opole region historical photos, Muzeum Wsi Opolskiej).",
      "WordPress site: no JSON API for gallery CPT; parses HTML from the site search form.",
      "field: title, place, district, description, or catalog_n (matches form select `t`).",
      "year_period (optional): do1900, 1900-1918, 1918-1939, 1939-1945 — form `y`; omit to search all periods.",
      "Use fototekaslaska_get_photo with `slug` from result URLs (/galeria/{slug}/).",
    ].join(" "),
    {
      query: z.string().min(1).describe("Search phrase"),
      field: z
        .enum(["title", "place", "district", "description", "catalog_n"])
        .default("title")
        .describe("Which metadata field to search (form parameter t)"),
      year_period: z
        .enum(["do1900", "1900-1918", "1918-1939", "1939-1945"])
        .optional()
        .describe("Optional historical period filter (form y). Omit for any period."),
      page: z.number().int().min(1).default(1).describe("Results page (WordPress paged)"),
    },
    async ({ query, field, year_period, page }) => {
      return withToolExecutionSpan(
        {
          toolName: "fototekaslaska_search",
          params: { query, field, year_period, page } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "fototekaslaska");
          try {
            const qs = new URLSearchParams();
            qs.set("s", query);
            qs.set("t", field);
            if (year_period !== undefined) qs.set("y", year_period);
            if (page > 1) qs.set("paged", String(page));
            const url = `${SITE}/?${qs.toString()}`;
            const cacheKey = makeCacheKey("fototekaslaska_search", { query, field, year_period, page });
            const html = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: HTML_HEADERS }, CACHE_TTL);
            const parsed = parseSearchList(html);
            const payload = {
              source: "fototekaslaska.pl",
              query,
              field,
              year_period,
              page,
              search_url: url,
              ...parsed,
            };
            return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling fototekaslaska_search: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "fototekaslaska_get_photo",
    [
      "Fetch one Fototeka Śląska photo page by URL slug (path /galeria/{slug}/).",
      "Returns title, optional catalog line, main image URL, and plain text from the description/table.",
      "Respect museum copyright and terms; do not bulk-download image files without permission.",
    ].join(" "),
    {
      slug: z
        .string()
        .min(1)
        .describe("URL segment after /galeria/ e.g. dzieci-przed-domem from fototekaslaska_search"),
    },
    async ({ slug }) => {
      return withToolExecutionSpan(
        {
          toolName: "fototekaslaska_get_photo",
          params: { slug } as Record<string, unknown>,
          fieldsRequested: ["title", "details_text", "image_url"],
          fieldsReturned: ["title", "details_text", "image_url"],
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "fototekaslaska");
          try {
            const safe = slug.replace(/^\/+|\/+$/g, "").replace(/^galeria\//, "");
            const url = `${SITE}/galeria/${encodeURI(safe)}/`;
            const cacheKey = makeCacheKey("fototekaslaska_get_photo", { slug: safe });
            const html = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: HTML_HEADERS }, CACHE_TTL);
            const parsed = parsePhotoPage(html);
            if (!parsed.title && !parsed.details_text) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      { slug: safe, url, error: "Could not parse gallery record (layout changed?)." },
                      null,
                      2,
                    ),
                  },
                ],
                isError: true,
              };
            }
            const payload = {
              slug: safe,
              url,
              ...parsed,
              source: "fototekaslaska.pl",
            };
            return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling fototekaslaska_get_photo: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
