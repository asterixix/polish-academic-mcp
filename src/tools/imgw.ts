/**
 * IMGW — Institute of Meteorology and Water Management (danepubliczne.imgw.pl).
 * Public REST API providing current synoptic, hydrological, and meteorological data
 * along with warnings.  No authentication required.
 *
 * API base: https://danepubliczne.imgw.pl/api/data
 *
 * Tools:
 *   imgw_synop      — Current readings from synoptic (weather) stations. Optionally
 *                     filtered by station ID or name.
 *   imgw_hydro      — Current readings from hydrological (river gauge) stations.
 *   imgw_meteo      — Current readings from meteorological stations.
 *   imgw_warnings   — Active meteorological and/or hydrological warnings.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan } from "../tracing.js";

const API_BASE = "https://danepubliczne.imgw.pl/api/data";
const CACHE_TTL = 3_600; // 1 h — frequently updated government data

const API_FIELDS = ["date", "language"];

export function registerImgwTools(server: McpServer, env: Env): void {
  // ── imgw_synop ────────────────────────────────────────────────────────────
  server.tool(
    "imgw_synop",
    [
      "Retrieve current synoptic (weather) station readings from IMGW-PIB (danepubliczne.imgw.pl).",
      "Returns JSON with temperature, wind speed, humidity, pressure, precipitation, and more",
      "for all active synoptic stations in Poland, or for a single station when station_id or",
      "station_name is provided.",
      "Data is refreshed roughly every hour.",
      "station_id: numeric SYNOP station identifier (e.g. 12500 for Jelenia Góra).",
      "station_name: station name without Polish diacritic characters (e.g. 'jeleniagora').",
      "Providing both station_id and station_name — station_id takes precedence.",
    ].join(" "),
    {
      station_id: z
        .string()
        .optional()
        .describe("Numeric synoptic station ID, e.g. '12500'. Overrides station_name if both given."),
      station_name: z
        .string()
        .optional()
        .describe("Station name without Polish diacritics, e.g. 'jeleniagora', 'warszawa', 'krakow'."),
    },
    async ({ station_id, station_name }) => {
      return withToolExecutionSpan(
        {
          toolName: "imgw_synop",
          params: { station_id, station_name } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "imgw");
          try {
            let path: string;
            if (station_id) {
              path = `/synop/id/${encodeURIComponent(station_id)}`;
            } else if (station_name) {
              path = `/synop/station/${encodeURIComponent(station_name)}`;
            } else {
              path = "/synop";
            }
            const url = `${API_BASE}${path}`;
            const cacheKey = makeCacheKey("imgw_synop", { station_id, station_name });
            const data = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
            return { content: [{ type: "text", text: data }] };
          } catch (e) {
            return {
              content: [{ type: "text", text: `Error fetching IMGW synoptic data: ${e instanceof Error ? e.message : String(e)}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── imgw_hydro ────────────────────────────────────────────────────────────
  server.tool(
    "imgw_hydro",
    [
      "Retrieve current hydrological (river gauge) station readings from IMGW-PIB (danepubliczne.imgw.pl).",
      "Returns JSON with water level, flow rate, ice phenomena, and alarm level status",
      "for all active hydrological stations in Poland.",
      "Data is refreshed roughly every hour.",
    ].join(" "),
    {},
    async () => {
      return withToolExecutionSpan(
        {
          toolName: "imgw_hydro",
          params: {} as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "imgw");
          try {
            const url = `${API_BASE}/hydro/`;
            const cacheKey = makeCacheKey("imgw_hydro", {});
            const data = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
            return { content: [{ type: "text", text: data }] };
          } catch (e) {
            return {
              content: [{ type: "text", text: `Error fetching IMGW hydrological data: ${e instanceof Error ? e.message : String(e)}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── imgw_meteo ────────────────────────────────────────────────────────────
  server.tool(
    "imgw_meteo",
    [
      "Retrieve current meteorological station readings from IMGW-PIB (danepubliczne.imgw.pl).",
      "Returns JSON with temperature, precipitation, snow cover, wind, and related measurements",
      "for all active meteorological stations in Poland.",
      "Data is refreshed roughly every hour.",
    ].join(" "),
    {},
    async () => {
      return withToolExecutionSpan(
        {
          toolName: "imgw_meteo",
          params: {} as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "imgw");
          try {
            const url = `${API_BASE}/meteo/`;
            const cacheKey = makeCacheKey("imgw_meteo", {});
            const data = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
            return { content: [{ type: "text", text: data }] };
          } catch (e) {
            return {
              content: [{ type: "text", text: `Error fetching IMGW meteorological data: ${e instanceof Error ? e.message : String(e)}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  // ── imgw_warnings ─────────────────────────────────────────────────────────
  server.tool(
    "imgw_warnings",
    [
      "Retrieve active meteorological and/or hydrological warnings issued by IMGW-PIB (danepubliczne.imgw.pl).",
      "Returns JSON with current alert levels, affected regions, hazard descriptions, and validity periods.",
      "type: 'meteo' for weather warnings (storms, frost, heat, wind, etc.),",
      "'hydro' for flood and hydrological warnings, or 'all' for both (default).",
    ].join(" "),
    {
      type: z
        .enum(["meteo", "hydro", "all"])
        .default("all")
        .describe("Warning type: 'meteo' (weather), 'hydro' (hydrological), or 'all' for both."),
    },
    async ({ type }) => {
      return withToolExecutionSpan(
        {
          toolName: "imgw_warnings",
          params: { type } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: 0,
        },
        async (span) => {
          span.setAttribute("mcp.source", "imgw");
          try {
            const results: string[] = [];

            if (type === "meteo" || type === "all") {
              const url = `${API_BASE}/warningsmeteo`;
              const cacheKey = makeCacheKey("imgw_warnings_meteo", {});
              const data = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
              results.push(type === "all" ? `{"type":"meteo","warnings":${data}}` : data);
            }

            if (type === "hydro" || type === "all") {
              const url = `${API_BASE}/warningshydro`;
              const cacheKey = makeCacheKey("imgw_warnings_hydro", {});
              const data = await cachedFetch(env.CACHE_KV, cacheKey, url, {}, CACHE_TTL);
              results.push(type === "all" ? `{"type":"hydro","warnings":${data}}` : data);
            }

            const text = type === "all" ? `[${results.join(",")}]` : results[0];
            return { content: [{ type: "text", text: text ?? "" }] };
          } catch (e) {
            return {
              content: [{ type: "text", text: `Error fetching IMGW warnings: ${e instanceof Error ? e.message : String(e)}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
