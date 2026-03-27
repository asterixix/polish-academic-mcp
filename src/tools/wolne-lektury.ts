/**
 * Wolne Lektury — public JSON API (no key).
 * Docs: https://wolnelektury.pl/api/
 *
 * The flat /api/books/ catalog returns a multi-megabyte JSON array — do not call it.
 * Use taxonomy lists to find slugs, then filter_books or get_book / get_collection.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const API_BASE = "https://wolnelektury.pl/api";
const JSON_HEADERS = { Accept: "application/json" };
const TAXONOMY_TTL = 86_400;
const BOOK_TTL = 86_400;
const FILTER_TTL = 86_400;

const FIELDS = ["title", "author", "slug", "href"];

function enc(slug: string): string {
  return encodeURIComponent(slug.trim());
}

/** Build /api/authors/.../epochs/.../genres/.../kinds/.../books/ or parent_books/ */
function buildFilteredBooksPath(args: {
  author_slug?: string;
  epoch_slug?: string;
  genre_slug?: string;
  kind_slug?: string;
  parent_only: boolean;
}): string {
  const segments: string[] = [];
  if (args.author_slug) segments.push(`authors/${enc(args.author_slug)}/`);
  if (args.epoch_slug) segments.push(`epochs/${enc(args.epoch_slug)}/`);
  if (args.genre_slug) segments.push(`genres/${enc(args.genre_slug)}/`);
  if (args.kind_slug) segments.push(`kinds/${enc(args.kind_slug)}/`);
  if (segments.length === 0) {
    throw new Error(
      "Provide at least one of author_slug, epoch_slug, genre_slug, kind_slug (flat /api/books/ is too large).",
    );
  }
  const leaf = args.parent_only ? "parent_books/" : "books/";
  return `${API_BASE}/${segments.join("")}${leaf}`;
}

const taxonomyKind = z.enum([
  "authors",
  "epochs",
  "genres",
  "kinds",
  "themes",
  "collections",
]);

export function registerWolneLekturyTools(server: McpServer, env: Env): void {
  server.tool(
    "wolnelektury_get_book",
    [
      "Fetch one book from Wolne Lektury by URL slug (e.g. lalka, pan-tadeusz).",
      "Returns JSON: title, authors, epochs, genres, download links (epub, pdf, …), children volumes, optional fragment preview.",
      "Discover slugs via wolnelektury_list_taxonomy and wolnelektury_filter_books or from wolnelektury.pl catalog URLs.",
    ].join(" "),
    {
      slug: z
        .string()
        .min(1)
        .describe("Book slug from /katalog/lektura/{slug}/ or API href, e.g. lalka."),
    },
    async ({ slug }) => {
      return withToolExecutionSpan(
        {
          toolName: "wolnelektury_get_book",
          params: { slug } as Record<string, unknown>,
          fieldsRequested: FIELDS,
          fieldsReturned: FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(slug),
        },
        async (span) => {
          span.setAttribute("mcp.source", "wolne-lektury");
          try {
            const url = `${API_BASE}/books/${enc(slug)}/`;
            const cacheKey = makeCacheKey("wolnelektury_book", { slug });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: JSON_HEADERS }, BOOK_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling wolnelektury_get_book: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "wolnelektury_get_collection",
    [
      "Fetch one thematic collection by slug (metadata + embedded books list).",
      "Use wolnelektury_list_taxonomy with kind=collections to list collection slugs and titles.",
    ].join(" "),
    {
      slug: z.string().min(1).describe("Collection slug from API or site URL."),
    },
    async ({ slug }) => {
      return withToolExecutionSpan(
        {
          toolName: "wolnelektury_get_collection",
          params: { slug } as Record<string, unknown>,
          fieldsRequested: ["title", "books"],
          fieldsReturned: ["title", "books"],
          tokensByField: {},
          queryTokens: estimateTokens(slug),
        },
        async (span) => {
          span.setAttribute("mcp.source", "wolne-lektury");
          try {
            const url = `${API_BASE}/collections/${enc(slug)}/`;
            const cacheKey = makeCacheKey("wolnelektury_collection", { slug });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: JSON_HEADERS }, BOOK_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling wolnelektury_get_collection: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "wolnelektury_filter_books",
    [
      "List books matching combined filters (AND). API does not expose full-text search; this is the supported way to narrow the catalog.",
      "Paths are built as /api/authors/.../epochs/.../genres/.../kinds/.../books/ (see https://wolnelektury.pl/api/).",
      "Set parent_only=true to use parent_books/ (top-level works only, no sub-volumes).",
      "Requires at least one filter. Filtering only by kind_slug can return a large JSON (~1MB+); prefer adding author or epoch when possible.",
    ].join(" "),
    {
      author_slug: z.string().optional().describe("Author slug, e.g. boleslaw-prus."),
      epoch_slug: z.string().optional().describe("Literary epoch slug, e.g. pozytywizm."),
      genre_slug: z.string().optional().describe("Genre slug, e.g. powiesc."),
      kind_slug: z.string().optional().describe("Literary kind slug, e.g. epika, liryka."),
      parent_only: z
        .boolean()
        .default(false)
        .describe("Use parent_books/ instead of books/ (omit sub-volumes)."),
    },
    async (params) => {
      const { author_slug, epoch_slug, genre_slug, kind_slug, parent_only } = params;
      return withToolExecutionSpan(
        {
          toolName: "wolnelektury_filter_books",
          params: params as Record<string, unknown>,
          fieldsRequested: FIELDS,
          fieldsReturned: FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(
            [author_slug, epoch_slug, genre_slug, kind_slug].filter(Boolean).join(" "),
          ),
        },
        async (span) => {
          span.setAttribute("mcp.source", "wolne-lektury");
          try {
            const url = buildFilteredBooksPath({
              author_slug,
              epoch_slug,
              genre_slug,
              kind_slug,
              parent_only,
            });
            const cacheKey = makeCacheKey("wolnelektury_filter_books", {
              author_slug,
              epoch_slug,
              genre_slug,
              kind_slug,
              parent_only,
            });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: JSON_HEADERS }, FILTER_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling wolnelektury_filter_books: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "wolnelektury_list_taxonomy",
    [
      "List reference data for discovery: authors, epochs, genres, kinds, themes, or collections (names, slugs, hrefs).",
      "Use slugs with wolnelektury_filter_books or wolnelektury_get_book / wolnelektury_get_collection.",
      "Responses are cached 24h; themes/collections are ~100KB.",
    ].join(" "),
    {
      kind: taxonomyKind.describe("Which taxonomy endpoint to list."),
    },
    async ({ kind }) => {
      return withToolExecutionSpan(
        {
          toolName: "wolnelektury_list_taxonomy",
          params: { kind } as Record<string, unknown>,
          fieldsRequested: ["name", "slug", "href"],
          fieldsReturned: ["name", "slug", "href"],
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "wolne-lektury");
          try {
            const url = `${API_BASE}/${kind}/`;
            const cacheKey = makeCacheKey("wolnelektury_taxonomy", { kind });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: JSON_HEADERS }, TAXONOMY_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling wolnelektury_list_taxonomy: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
