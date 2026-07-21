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

const ELI_BASE = "https://api.sejm.gov.pl/eli";
const JSON_HEADERS = { Accept: "application/json" };
const SEARCH_TTL = 3_600;
const ACT_TTL = 86_400;

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
    for (const part of k
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
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
      "Wyszukiwanie polskich aktów prawnych indeksowanych w ISAP przez API JSON ELI Sejmu (European Legislation Identifier).",
      "Użyj title do wyszukiwania pełnotekstowego w tytułach; keyword dopasowuje tagi słów kluczowych ISAP (nie dowolny tekst).",
      "Filtruj po wydawcy (np. DU = Dziennik Ustaw), roku, typie (np. Ustawa, Rozporządzenie), obowiązywaniu, datach.",
      "Zwraca surowy JSON z items[].ELI, title, displayAddress, texts, references. Zobacz https://api.sejm.gov.pl/eli/openapi/",
    ].join(" "),
    {
      title: z.string().optional().describe("Słowa do znalezienia w tytule aktu."),
      keyword: z
        .string()
        .optional()
        .describe(
          "Tag lub tagi słów kluczowych ISAP rozdzielone przecinkami; dopasowuje tagi kontrolowanego słownika (np. szkolnictwo, podatki), nie tekst swobodny.",
        ),
      year: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Rok kalendarzowy aktu w dzienniku (np. 2025)."),
      publisher: z
        .string()
        .optional()
        .describe('Kod wydawcy aktu prawnego, np. "DU" (Dziennik Ustaw), "MP" (Monitor Polski); parametr typu tekst.'),
      type: z
        .string()
        .optional()
        .describe('Typ aktu, np. "Ustawa", "Rozporządzenie", "Obwieszczenie".'),
      position: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Numer pozycji w dzienniku (poz.)."),
      volume: z.number().int().optional().describe("Numer tomu (wolumen dziennika urzędowego)."),
      in_force: z
        .boolean()
        .optional()
        .describe("Gdy true, tylko akty aktualnie obowiązujące (API: inForce=1)."),
      date_from: z.string().optional().describe("Data ogłoszenia od (yyyy-MM-dd)."),
      date_to: z.string().optional().describe("Data ogłoszenia do (yyyy-MM-dd)."),
      date_effect_from: z.string().optional().describe("Data wejścia w życie od (yyyy-MM-dd)."),
      date_effect_to: z.string().optional().describe("Data wejścia w życie do (yyyy-MM-dd)."),
      pub_date_from: z.string().optional().describe("Data publikacji od (yyyy-MM-dd)."),
      pub_date_to: z.string().optional().describe("Data publikacji do (yyyy-MM-dd)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maksymalna liczba wyników (domyślnie API 500; ograniczone do 100)."),
      offset: z.number().int().min(0).default(0).describe("Przesunięcie liczone od zera dla paginacji."),
      sort_by: z
        .enum(["publisher", "position", "title", "change"])
        .default("publisher")
        .describe("Pole sortowania (zobacz API ELI)."),
      sort_dir: z.enum(["asc", "desc"]).default("asc").describe("Kierunek sortowania listy wyników (rosnąco lub malejąco)."),
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
      return (async () => {
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
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            SEARCH_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling isap_search_acts: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "isap_get_act",
    [
      "Pobiera jeden akt prawny z ISAP po identyfikatorze ELI (te same numery co w wynikach wyszukiwania).",
      "Przykład ELI: DU/2026/370 — Dziennik Ustaw, rok 2026, pozycja 370. Zwraca JSON z title, texts (nazwy plików PDF), references.",
    ].join(" "),
    {
      eli: z.string().min(3).describe('Identyfikator ELI, np. "DU/2026/370" (wydawca/rok/pozycja).'),
    },
    async ({ eli }) => {
      return (async () => {
        try {
          const path = eliToPath(eli);
          const url = `${ELI_BASE}/acts/${path}`;
          const cacheKey = makeCacheKey("isap_act", { eli });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            ACT_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling isap_get_act: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );
}
