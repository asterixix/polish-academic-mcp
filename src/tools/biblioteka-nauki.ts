/**
 * Biblioteka Nauki — Poland's largest open-access publication database.
 * Public API: OAI-PMH (no authentication required).
 *
 * Tools:
 *   bn_search_articles  — ListRecords with optional date range / set filter.
 *   bn_get_article      — GetRecord for a single article by numeric ID.
 *
 * Responses are raw XML.  LLMs handle OAI-PMH/JATS XML well and returning
 * raw text avoids expensive DOM parsing within the 10 ms CPU budget.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const OAI_BASE = "https://bibliotekanauki.pl/api/oai/articles";
const CACHE_TTL = 86_400; // 24 h — academic records rarely change

export function registerBibliotekaTools(server: McpServer, env: Env): void {
  // ── bn_search_articles ────────────────────────────────────────────────────
  server.tool(
    "bn_search_articles",
    [
      "Search Polish scientific articles in Biblioteka Nauki via the OAI-PMH ListRecords verb.",
      "Returns raw XML.  Use metadata_format=oai_dc for smaller Dublin Core responses,",
      "or jats for rich JATS XML with abstracts, keywords, ORCIDs, and references.",
      "Use resumption_token from a previous response to fetch the next page.",
    ].join(" "),
    {
      from_date: z
        .string()
        .optional()
        .describe("Earliest publication date, format YYYY-MM-DD"),
      until_date: z
        .string()
        .optional()
        .describe("Latest publication date, format YYYY-MM-DD"),
      set: z
        .string()
        .optional()
        .describe(
          "OAI set identifier to scope results to a journal or discipline.",
        ),
      metadata_format: z
        .enum(["oai_dc", "jats"])
        .default("oai_dc")
        .describe(
          "oai_dc — Dublin Core (smaller, faster); jats — full structured metadata.",
        ),
      resumption_token: z
        .string()
        .optional()
        .describe("Token returned in a previous response for fetching the next page."),
    },
    async ({ from_date, until_date, set, metadata_format, resumption_token }) => {
      try {
        let url: string;

        if (resumption_token) {
          // When a resumption token is present, no other params are allowed.
          url = `${OAI_BASE}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumption_token)}`;
        } else {
          const params = new URLSearchParams({
            verb: "ListRecords",
            metadataPrefix: metadata_format,
          });
          if (from_date) params.set("from", from_date);
          if (until_date) params.set("until", until_date);
          if (set) params.set("set", set);
          url = `${OAI_BASE}?${params}`;
        }

        const cacheKey = makeCacheKey("bn_search", { url });
        const xml = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
        return { content: [{ type: "text", text: xml }] };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Error fetching Biblioteka Nauki: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── bn_get_article ────────────────────────────────────────────────────────
  server.tool(
    "bn_get_article",
    [
      "Fetch the full metadata record for a single article from Biblioteka Nauki by its numeric ID.",
      "Defaults to jats format which includes abstract, keywords, affiliations, and references.",
    ].join(" "),
    {
      article_id: z
        .string()
        .describe("Numeric article ID as shown in search results, e.g. 1968869"),
      metadata_format: z
        .enum(["jats", "oai_dc"])
        .default("jats")
        .describe("jats — full structured metadata (recommended); oai_dc — Dublin Core."),
    },
    async ({ article_id, metadata_format }) => {
      try {
        const identifier = `oai:bibliotekanauki.pl:${article_id}`;
        const params = new URLSearchParams({
          verb: "GetRecord",
          metadataPrefix: metadata_format,
          identifier,
        });
        const url = `${OAI_BASE}?${params}`;
        const cacheKey = makeCacheKey("bn_article", { article_id, metadata_format });
        const xml = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
        return { content: [{ type: "text", text: xml }] };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Error fetching article ${article_id}: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
