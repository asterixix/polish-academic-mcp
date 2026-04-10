import { toToolErrorText } from "../tool-error-handling.js";
/**
 * ISAP — Internetowy System Aktów Prawnych (browse via ELI API).
 * Public read API: https://api.sejm.gov.pl/eli (no key). Web UI may show CAPTCHA;
 * programmatic access uses api.sejm.gov.pl per operator notice.
 *
 * Tools:
 *   isap_search_acts — GET /eli/acts/search (JSON)
 *   isap_get_act      — GET /eli/acts/{publisher}/{year}/{position}
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const ELI_BASE = "https://api.sejm.gov.pl/eli";
const JSON_HEADERS = { Accept: "application/json" };
const SEARCH_TTL = 3_600;
const ACT_TTL = 86_400;

const API_FIELDS = ["title", "ELI", "displayAddress", "type", "year", "publisher", "entryIntoForce"];

function buildSearchParams(args: {
  title?: string;
  keywords?: string[];
  year?: number;
  publisher?: string;
  type?: string;
  position?: number;
  volume?: number;
  in_force?: boolean;
  date_from?: string;
  date_to?: string;
  date_effect_from?: string;
  date_effect_to?: string;
  pub_date_from?: string;
  pub_date_to?: string;
  limit: number;
  offset: number;
  sort_by: "publisher" | "position" | "title" | "change";
  sort_dir: "asc" | "desc";
}): URLSearchParams {
  const p = new URLSearchParams();
  if (args.title) p.set("title", args.title);
  for (const k of args.keywords ?? []) {
    for (const part of k.split(",").map((s) => s.trim()).filter(Boolean)) {
      p.append("keyword", part);
    }
  }
  if (args.year !== undefined) p.set("year", String(args.year));
  if (args.publisher) p.set("publisher", args.publisher);
  if (args.type) p.set("type", args.type);
  if (args.position !== undefined) p.set("position", String(args.position));
  if (args.volume !== undefined) p.set("volume", String(args.volume));
  if (args.in_force === true) p.set("inForce", "1");
  if (args.date_from) p.set("dateFrom", args.date_from);
  if (args.date_to) p.set("dateTo", args.date_to);
  if (args.date_effect_from) p.set("dateEffectFrom", args.date_effect_from);
  if (args.date_effect_to) p.set("dateEffectTo", args.date_effect_to);
  if (args.pub_date_from) p.set("pubDateFrom", args.pub_date_from);
  if (args.pub_date_to) p.set("pubDateTo", args.pub_date_to);
  p.set("limit", String(args.limit));
  p.set("offset", String(args.offset));
  p.set("sortBy", args.sort_by);
  p.set("sortDir", args.sort_dir);
  return p;
}

function eliToPath(eli: string): string {
  const trimmed = eli.trim().replace(/^\/+/, "");
  const segments = trimmed.split("/").filter(Boolean);
  if (segments.length < 3) {
    throw new Error('ELI must look like "DU/2026/370" (publisher/year/position).');
  }
  if (segments.some((s) => s === "..")) {
    throw new Error("Invalid ELI");
  }
  return segments.map((seg) => encodeURIComponent(seg)).join("/");
}

export function registerIsapTools(server: McpServer, env: Env): void {
  server.tool(
    "isap_search_acts",
    [
      "Search Polish legal acts indexed in ISAP via the Sejm ELI JSON API (European Legislation Identifier).",
      "Use title for full-text-in-title search; keywords match ISAP keyword tags (not arbitrary prose).",
      "Filter by publisher (e.g. DU = Dziennik Ustaw), year, type (e.g. Ustawa, Rozporządzenie), in_force, dates.",
      "Returns raw JSON with items[].ELI, title, displayAddress, texts, references. See https://api.sejm.gov.pl/eli/openapi/",
    ].join(" "),
    {
      title: z.string().optional().describe("Words to find in the act title."),
      keyword: z
        .string()
        .optional()
        .describe(
          "ISAP keyword tag(s)—comma-separated; matches controlled vocabulary tags (e.g. szkolnictwo, podatki), not free text.",
        ),
      year: z.number().int().min(1).optional().describe("Calendar year of the act in the journal (e.g. 2025)."),
      publisher: z
        .string()
        .optional()
        .describe('Publisher code, e.g. "DU" (Dziennik Ustaw), "MP" (Monitor Polski).'),
      type: z
        .string()
        .optional()
        .describe('Act type, e.g. "Ustawa", "Rozporządzenie", "Obwieszczenie".'),
      position: z.number().int().min(1).optional().describe("Position number in the journal (poz.)."),
      volume: z.number().int().optional().describe("Volume (journal volume)."),
      in_force: z
        .boolean()
        .optional()
        .describe("When true, only acts currently in force (API: inForce=1)."),
      date_from: z.string().optional().describe("Announcement date from (yyyy-MM-dd)."),
      date_to: z.string().optional().describe("Announcement date to (yyyy-MM-dd)."),
      date_effect_from: z.string().optional().describe("Entry-into-force date from (yyyy-MM-dd)."),
      date_effect_to: z.string().optional().describe("Entry-into-force date to (yyyy-MM-dd)."),
      pub_date_from: z.string().optional().describe("Promulgation date from (yyyy-MM-dd)."),
      pub_date_to: z.string().optional().describe("Promulgation date to (yyyy-MM-dd)."),
      limit: z.number().int().min(1).max(100).default(20).describe("Max results (API default 500; capped at 100 here)."),
      offset: z.number().int().min(0).default(0).describe("0-based offset for pagination."),
      sort_by: z
        .enum(["publisher", "position", "title", "change"])
        .default("publisher")
        .describe("Sort field (see ELI API)."),
      sort_dir: z.enum(["asc", "desc"]).default("asc").describe("Sort direction."),
    },
    async (params) => {
      const {
        title,
        keyword,
        year,
        publisher,
        type,
        position,
        volume,
        in_force,
        date_from,
        date_to,
        date_effect_from,
        date_effect_to,
        pub_date_from,
        pub_date_to,
        limit,
        offset,
        sort_by,
        sort_dir,
      } = params;
      return withToolExecutionSpan(
        {
          toolName: "isap_search_acts",
          params: params as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens([title, keyword].filter(Boolean).join(" ")),
        },
        async (span) => {
          span.setAttribute("mcp.source", "isap-sejm-eli");
          try {
            const keywords = keyword
              ? keyword
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : undefined;
            const searchParams = buildSearchParams({
              title,
              keywords,
              year,
              publisher,
              type,
              position,
              volume,
              in_force,
              date_from,
              date_to,
              date_effect_from,
              date_effect_to,
              pub_date_from,
              pub_date_to,
              limit,
              offset,
              sort_by,
              sort_dir,
            });
            const url = `${ELI_BASE}/acts/search?${searchParams}`;
            const cacheKey = makeCacheKey("isap_search", { url });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: JSON_HEADERS }, SEARCH_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = toToolErrorText(err);
            return {
              content: [{ type: "text", text: `Error calling isap_search_acts: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "isap_get_act",
    [
      "Fetch one legal act from ISAP by ELI identifier (same numbering as in search results).",
      "Example ELI: DU/2026/370 — Dziennik Ustaw, year 2026, position 370. Returns JSON with title, texts (PDF file names), references.",
    ].join(" "),
    {
      eli: z
        .string()
        .min(3)
        .describe('ELI id, e.g. "DU/2026/370" (publisher/year/position).'),
    },
    async ({ eli }) => {
      return withToolExecutionSpan(
        {
          toolName: "isap_get_act",
          params: { eli } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(eli),
        },
        async (span) => {
          span.setAttribute("mcp.source", "isap-sejm-eli");
          try {
            const path = eliToPath(eli);
            const url = `${ELI_BASE}/acts/${path}`;
            const cacheKey = makeCacheKey("isap_act", { eli });
            const text = await cachedFetch(env.CACHE_KV, cacheKey, url, { headers: JSON_HEADERS }, ACT_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = toToolErrorText(err);
            return {
              content: [{ type: "text", text: `Error calling isap_get_act: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
