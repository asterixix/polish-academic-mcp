/**
 * Śląski Uniwersytet Medyczny (SUM) — library catalogue (Aleph / Ex Libris).
 * OPAC: https://katalog.sum.edu.pl/
 *
 * Public machine interface: Aleph **X-Server** at `/X` (XML). See Ex Libris:
 * https://developers.exlibrisgroup.com/aleph/apis/aleph-x-services/
 *
 * As of 2026-03, `op=find` responds with `<error>SRU gate configuration file is missing.</error>`
 * — server-side SRU gate is not configured, so full-text/CCL search via X-Services may not work
 * until the library fixes it. `op=present` (MARC/XML for a hit in a result set) works in tests.
 *
 * Tools:
 *   sum_aleph_find    — X-Services `find` (request uses WWW index prefixes: wrd=, wti=, wau=, …).
 *   sum_aleph_present — X-Services `present` — fetch MARC (or other format) for set_no/set_entry.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const CATALOG_ORIGIN = "https://katalog.sum.edu.pl";
const X_URL = `${CATALOG_ORIGIN}/X`;

const XML_HEADERS = { Accept: "application/xml, text/xml;q=0.9, */*;q=0.8" };
const CACHE_TTL = 86_400; // 24 h — catalogue records

const API_FIELDS = ["title", "author", "doc_number"];

export function registerSumTools(server: McpServer, env: Env): void {
  // ── sum_aleph_find ────────────────────────────────────────────────────────
  server.tool(
    "sum_aleph_find",
    [
      "Search the SUM (ŚUM Katowice) Aleph catalogue via X-Server `op=find` (returns XML).",
      "Parameter `request` uses Aleph WWW query prefixes, e.g. `wrd=kardiologia`, `wti=title words`,",
      "`wau=author` (see Ex Libris X-Services introduction).",
      "If the response contains `SRU gate configuration file is missing`, the server is broken for",
      "find until the library configures the SRU gate — `sum_aleph_present` may still work for sets.",
    ].join(" "),
    {
      local_base: z
        .string()
        .min(1)
        .default("SUM01")
        .describe("Aleph local bibliographic base code (e.g. SUM01; confirm in local Aleph docs)"),
      request: z
        .string()
        .min(1)
        .describe("Find request (WWW prefix syntax), e.g. wrd=medycyna or wti=anestezjologia"),
    },
    async ({ local_base, request }) => {
      return withToolExecutionSpan(
        {
          toolName: "sum_aleph_find",
          params: { local_base, request } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(request),
        },
        async (span) => {
          span.setAttribute("mcp.source", "sum-aleph");
          try {
            const params = new URLSearchParams({
              op: "find",
              base: local_base,
              request,
            });
            const url = `${X_URL}?${params}`;
            const key = makeCacheKey("sum_aleph_find", { local_base, request });
            const text = await cachedFetch(env.CACHE_KV, key, url, { headers: XML_HEADERS }, CACHE_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling sum_aleph_find: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── sum_aleph_present ─────────────────────────────────────────────────────
  server.tool(
    "sum_aleph_present",
    [
      "Fetch catalogue records from the SUM Aleph X-Server `op=present` (XML, typically MARC in `<oai_marc>`).",
      "Use `set_no` and `set_entry` from a prior `find` result set in the same session when search works;",
      "or indices as returned by the OPAC (8-digit zero-padded entry numbers are common).",
      "Format: `marc` (default) or other Aleph-supported format string for this installation.",
    ].join(" "),
    {
      set_no: z
        .string()
        .min(1)
        .describe("Result set number from find (e.g. 000001)"),
      set_entry: z
        .string()
        .min(1)
        .describe(
          "Entry index or range: one value (e.g. 000000001) or from-to (e.g. 000000001,000000005) per Aleph docs",
        ),
      format: z
        .string()
        .default("marc")
        .describe("Presentation format (e.g. marc)"),
    },
    async ({ set_no, set_entry, format }) => {
      return withToolExecutionSpan(
        {
          toolName: "sum_aleph_present",
          params: { set_no, set_entry, format } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "sum-aleph");
          try {
            const params = new URLSearchParams({
              op: "present",
              set_no: set_no,
              set_entry: set_entry,
              format,
            });
            const url = `${X_URL}?${params}`;
            const key = makeCacheKey("sum_aleph_present", { set_no, set_entry, format });
            const text = await cachedFetch(env.CACHE_KV, key, url, { headers: XML_HEADERS }, CACHE_TTL);
            return { content: [{ type: "text", text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Error calling sum_aleph_present: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
