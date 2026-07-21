import { toToolErrorText } from "../tool-error-handling.js";
/**
 * RCIN — Repozytorium Cyfrowe Instytutów Naukowych (Digital Repository of Scientific Institutes).
 * Public API: OAI-PMH 2.0 at /oai-pmh-repository.xml (no authentication).
 *
 * Tools:
 *   rcin_search     — OAI ListRecords: slice by date range and/or OAI set, paginated.
 *   rcin_get_record — OAI GetRecord for one object by OAI identifier or numeric id.
 *
 * This is metadata harvesting (not the portal’s interactive full-text search UI).
 * Raw XML is returned — no DOM parsing in the Worker.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const OAI_BASE = "https://rcin.org.pl/oai-pmh-repository.xml";
const CACHE_TTL = 86_400;

function normalizeIdentifier(id: string): string {
  const t = id.trim();
  if (/^oai:/i.test(t)) return t;
  if (/^\d+$/.test(t)) return `oai:rcin.org.pl:${t}`;
  return t;
}

export function registerRcinTools(server: McpServer, env: Env): void {
  server.tool(
    "rcin_search",
    [
      "Search (harvest) RCIN metadata via OAI-PMH ListRecords.",
      "Filter by optional from_date/until_date (YYYY-MM-DD) and/or OAI setSpec (e.g. rcin.org.pl:literature).",
      "Returns raw XML. Use resumption_token from the previous response for the next page.",
      "For interactive keyword search on the website, use https://rcin.org.pl/dlibra/ — this tool exposes the OAI API only.",
    ].join(" "),
    {
      from_date: z
        .string()
        .optional()
        .describe("Earliest datestamp boundary, format YYYY-MM-DD (optional)."),
      until_date: z
        .string()
        .optional()
        .describe("Latest datestamp boundary, format YYYY-MM-DD (optional)."),
      set: z
        .string()
        .optional()
        .describe("Identyfikator setSpec protokołu OAI do zawężenia wyników, np. rcin.org.pl:literature. Pomiń dla wszystkich zbiorów."),
      metadata_format: z
        .enum(["oai_dc", "oai_qdc", "mets", "oai_etdms", "dlibra_avs"])
        .default("oai_dc")
        .describe(
          "Schemat metadanych: oai_dc — Dublin Core (domyślnie, zwięzły); oai_qdc — kwalifikowany Dublin Core; mets — METS; oai_etdms — prace dyplomowe; dlibra_avs — schemat atrybutów dLibra.",
        ),
      resumption_token: z
        .string()
        .optional()
        .describe("Token from a prior ListRecords response to fetch the next chunk."),
    },
    async ({ from_date, until_date, set, metadata_format, resumption_token }) => {
      return (async () => {
        try {
          let url: string;
          if (resumption_token) {
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
          const cacheKey = makeCacheKey("rcin_search", { url });
          const xml = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
          return { content: [{ type: "text", text: xml }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling rcin_search: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "rcin_get_record",
    [
      "Fetch a single RCIN object via OAI-PMH GetRecord.",
      "Pass record_id as the numeric id from browse/search URLs, or full OAI id oai:rcin.org.pl:NNNNN.",
    ].join(" "),
    {
      record_id: z
        .string()
        .describe(
          "Numeric content id or full OAI identifier, e.g. 204728 or oai:rcin.org.pl:204728",
        ),
      metadata_format: z
        .enum(["oai_dc", "oai_qdc", "mets", "oai_etdms", "dlibra_avs"])
        .default("oai_dc")
        .describe("Schemat metadanych (domyślnie oai_dc)."),
    },
    async ({ record_id, metadata_format }) => {
      return (async () => {
        try {
          const identifier = normalizeIdentifier(record_id);
          const params = new URLSearchParams({
            verb: "GetRecord",
            metadataPrefix: metadata_format,
            identifier,
          });
          const url = `${OAI_BASE}?${params}`;
          const cacheKey = makeCacheKey("rcin_get", { identifier, metadata_format });
          const xml = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
          return { content: [{ type: "text", text: xml }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling rcin_get_record: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );
}
