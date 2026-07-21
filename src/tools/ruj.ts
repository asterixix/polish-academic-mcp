import { toToolErrorText } from "../tool-error-handling.js";
/**
 * RUJ — Jagiellonian University Repository.
 * 300 000+ records (articles, monographs, dissertations, chapters).
 * Runs DSpace 7, responds with HAL+JSON.  Anonymous read access for all public items.
 *
 * Tools:
 *   ruj_search    — full-text + faceted discovery search.
 *   ruj_get_item  — single item metadata by UUID.
 *
 * IMPORTANT: GET /server/api/core/items (list all) is admin-only → always use
 * the /discover/search/objects endpoint.
 *
 * Filter schema derived from:
 *   GET https://ruj.uj.edu.pl/server/api/discover/search
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const API_BASE = "https://ruj.uj.edu.pl/server/api";
const JSON_HEADERS = { Accept: "application/json" };
const CACHE_TTL = 86_400; // 24 h

/**
 * Append a DSpace discovery filter parameter.
 * If the caller already embedded a valid operator suffix (e.g. "Smith,equals")
 * it is used as-is; otherwise the defaultOp is appended.
 */
const VALID_OPS = new Set([
  "equals",
  "notequals",
  "contains",
  "notcontains",
  "authority",
  "notauthority",
  "query",
]);
function addFilter(params: URLSearchParams, field: string, value: string, defaultOp: string): void {
  const lastComma = value.lastIndexOf(",");
  const trailingToken = lastComma !== -1 ? value.slice(lastComma + 1) : "";
  params.append(`f.${field}`, VALID_OPS.has(trailingToken) ? value : `${value},${defaultOp}`);
}

// ── Compact HAL+JSON parsers ─────────────────────────────────────────────
// JSON.parse returns `any`; we accept that explicitly here for brevity.
/* eslint-disable @typescript-eslint/no-explicit-any */
function dcFirst(meta: any, key: string): string {
  const arr = meta?.[key];
  return Array.isArray(arr) && arr.length > 0 ? String(arr[0]?.value ?? "") : "";
}
function dcAll(meta: any, key: string): string[] {
  const arr = meta?.[key];
  if (!Array.isArray(arr)) return [];
  return (arr as any[]).map((v) => String(v?.value ?? "")).filter(Boolean);
}
function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function scrubPii(text: string): string {
  return text
    .replace(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/g, "[REDACTED_ORCID]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/\b\d{11}\b/g, "[REDACTED_PESEL]")
    .replace(/\+?[\d\s\-()]{9,}/g, "[REDACTED_PHONE]");
}

/**
 * Collapse ruj_search HAL+JSON into a compact summary.
 * Returns the raw string unchanged if parsing fails.
 */
function summarizeSearch(raw: string, minimizePii = false): string {
  try {
    const json = JSON.parse(raw);
    const sr = json?._embedded?.searchResult;
    const objects: any[] = sr?._embedded?.objects ?? [];
    const p = sr?.page ?? {};
    const items = objects.map((obj: any) => {
      const it = obj?._embedded?.indexableObject ?? {};
      const m = it.metadata ?? {};
      const abs = dcFirst(m, "dc.abstract.en") || dcFirst(m, "dc.abstract.pl");
      const h: string = it.handle ?? "";
      return {
        uuid: it.uuid as string | undefined,
        handle: h || undefined,
        url: h ? `https://ruj.uj.edu.pl/xmlui/handle/${h}` : undefined,
        title: dcFirst(m, "dc.title") || undefined,
        titleAlt: dcFirst(m, "dc.title.alternative") || undefined,
        authors: minimizePii ? [] : dcAll(m, "dc.contributor.author"),
        type: dcFirst(m, "dc.type") || undefined,
        language: dcFirst(m, "dc.language") || undefined,
        dateIssued: dcFirst(m, "dc.date.issued") || undefined,
        dateSubmitted: dcFirst(m, "dc.date.submitted") || undefined,
        affiliation: minimizePii ? undefined : dcFirst(m, "dc.affiliation") || undefined,
        subject: dcFirst(m, "dc.subject.en") || dcFirst(m, "dc.subject.pl") || undefined,
        abstract: abs ? trunc(abs, 500) : undefined,
      };
    });
    const out = JSON.stringify(
      {
        totalElements: p.totalElements,
        page: { number: p.number, size: p.size, totalPages: p.totalPages },
        items,
      },
      null,
      2,
    );
    return minimizePii ? scrubPii(out) : out;
  } catch {
    return minimizePii ? scrubPii(raw) : raw;
  }
}

/**
 * Collapse ruj_get_item HAL+JSON into a compact summary.
 * Returns the raw string unchanged if parsing fails.
 */
function summarizeItem(raw: string): string {
  try {
    const it = JSON.parse(raw);
    const m = it?.metadata ?? {};
    const h: string = it.handle ?? "";
    return JSON.stringify(
      {
        uuid: it.uuid as string | undefined,
        handle: h || undefined,
        url: h ? `https://ruj.uj.edu.pl/xmlui/handle/${h}` : undefined,
        title: dcFirst(m, "dc.title") || undefined,
        titleAlt: dcFirst(m, "dc.title.alternative") || undefined,
        authors: dcAll(m, "dc.contributor.author"),
        advisors: dcAll(m, "dc.contributor.advisor"),
        reviewers: dcAll(m, "dc.contributor.reviewer"),
        type: dcFirst(m, "dc.type") || undefined,
        language: dcFirst(m, "dc.language") || undefined,
        dateIssued: dcFirst(m, "dc.date.issued") || undefined,
        dateSubmitted: dcFirst(m, "dc.date.submitted") || undefined,
        dateAccessioned: dcFirst(m, "dc.date.accessioned") || undefined,
        affiliation: dcFirst(m, "dc.affiliation") || undefined,
        fieldOfStudy: dcFirst(m, "dc.fieldofstudy") || undefined,
        area: dcFirst(m, "dc.area") || undefined,
        subjectEN: dcFirst(m, "dc.subject.en") || undefined,
        subjectPL: dcFirst(m, "dc.subject.pl") || undefined,
        doi: dcFirst(m, "dc.identifier.doi") || undefined,
        identifierURI: dcFirst(m, "dc.identifier.uri") || undefined,
        entityType: (it.entityType as string | undefined) || undefined,
        inArchive: it.inArchive as boolean | undefined,
        lastModified: (it.lastModified as string | undefined) || undefined,
        abstractEN: dcFirst(m, "dc.abstract.en") || undefined,
        abstractPL: dcFirst(m, "dc.abstract.pl") || undefined,
      },
      null,
      2,
    );
  } catch {
    return raw;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function registerRujTools(server: McpServer, env: Env): void {
  // ── ruj_search ────────────────────────────────────────────────────────────
  server.tool(
    "ruj_search",
    [
      "Wyszukiwanie publikacji w Repozytorium Uniwersytetu Jagiellońskiego (RUJ) przez mechanizm discovery DSpace 7.",
      "Wspiera wyszukiwanie pełnotekstowe z 14 polami filtrów, 7 opcjami sortowania i paginacją liczoną od zera.",
      "Wyniki w formacie HAL+JSON z wyróżnieniami trafień i pełnymi metadanymi Dublin Core.",
      "Każda wartość filtra może zawierać operator po przecinku, na przykład 'Kowalski,equals'.",
      "Jeśli operator nie jest podany, stosowany jest operator domyślny dla danego pola.",
      "Obsługiwane operatory: equals, notequals, contains, notcontains, authority, notauthority, query.",
    ].join(" "),
    {
      // ── Rdzeń ───────────────────────────────────────────────────────────────
      query: z.string().describe("Wyrażenie do wyszukiwania pełnotekstowego"),
      page: z.number().int().min(0).default(0).describe("Numer strony liczony od zera"),
      size: z.number().int().min(1).max(50).default(10).describe("Liczba wyników na stronę (1–50)"),
      sort: z
        .enum([
          "score,desc",
          "dc.title,asc",
          "dc.title,desc",
          "dc.date.issued,asc",
          "dc.date.issued,desc",
          "dc.date.accessioned,asc",
          "dc.date.accessioned,desc",
        ])
        .default("score,desc")
        .describe("Pole i kierunek sortowania"),

      // ── Filtry (wszystkie opcjonalne) ─────────────────────────────────────────
      // Domyślny operator podany w nawiasie; dodaj ',operator', by nadpisać.
      itemtype: z
        .string()
        .optional()
        .describe(
          "Filtr typu dokumentu (domyślnie: equals). " +
            "Znane wartości: JournalArticle, Book, BookSection, JournalEditorship.",
        ),
      author: z.string().optional().describe("Filtr autora (domyślnie: contains)."),
      subject: z.string().optional().describe("Filtr tematu lub słowa kluczowego (domyślnie: equals)."),
      language: z
        .string()
        .optional()
        .describe("Kod języka (domyślnie: equals). Na przykład 'pl', 'en'."),
      affiliation: z
        .string()
        .optional()
        .describe("Filtr afiliacji instytucjonalnej autora (domyślnie: contains)."),
      affiliation_em: z
        .string()
        .optional()
        .describe(
          "Filtr afiliacji autora korespondencyjnego (domyślnie: contains). " +
            "Mapowane na pole DSpace affiliationEm.",
        ),
      journal_title: z
        .string()
        .optional()
        .describe(
          "Filtr tytułu czasopisma (domyślnie: contains). " + "Mapowane na pole DSpace journalTitle.",
        ),
      subtype: z.string().optional().describe("Filtr podtypu publikacji (domyślnie: equals)."),
      entity_type: z
        .string()
        .optional()
        .describe(
          "Filtr typu obiektu DSpace (domyślnie: equals). " + "Mapowane na pole DSpace entityType.",
        ),
      pbn_discipline: z
        .string()
        .optional()
        .describe(
          "Filtr dyscypliny naukowej PBN (domyślnie: equals). " +
            "Mapowane na pole DSpace pbndiscipline.",
        ),
      has_full_text: z
        .boolean()
        .optional()
        .describe(
          "Gdy true, ogranicza wyniki do obiektów z plikami w oryginalnym pakiecie " +
            "(dostępny tekst w repozytorium). " +
            "Mapowane na pole DSpace has_content_in_original_bundle.",
        ),
      date_issued: z
        .string()
        .optional()
        .describe(
          "Filtr daty wydania (domyślnie: equals). " +
            "Dla zakresów użyj operatora query z notacją Solr, " +
            "na przykład '[2020-01-01 TO 2023-12-31],query'. " +
            "Mapowane na pole DSpace dateIssued.",
        ),
      date_accessioned: z
        .string()
        .optional()
        .describe(
          "Filtr daty zdeponowania w repozytorium (domyślnie: equals). " +
            "Mapowane na pole DSpace dateAccessioned.",
        ),
      date_submitted: z
        .string()
        .optional()
        .describe(
          "Filtr daty złożenia (domyślnie: equals). " + "Mapowane na pole DSpace dateSubmitted.",
        ),
      minimize_pii: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Gdy true, redaguje identyfikatory osobowe i usuwa pola autor oraz afiliacja dla zastosowań wrażliwych na prywatność.",
        ),
    },
    async ({
      query,
      page,
      size,
      sort,
      itemtype,
      author,
      subject,
      language,
      affiliation,
      affiliation_em,
      journal_title,
      subtype,
      entity_type,
      pbn_discipline,
      has_full_text,
      date_issued,
      date_accessioned,
      date_submitted,
      minimize_pii,
    }) => {
      return (async () => {
        try {
          const searchParams = new URLSearchParams({
            query,
            page: String(page),
            size: String(size),
            sort,
          });

          if (itemtype) addFilter(searchParams, "itemtype", itemtype, "equals");
          if (author) addFilter(searchParams, "author", author, "contains");
          if (subject) addFilter(searchParams, "subject", subject, "equals");
          if (language) addFilter(searchParams, "language", language, "equals");
          if (affiliation) addFilter(searchParams, "affiliation", affiliation, "contains");
          if (affiliation_em) addFilter(searchParams, "affiliationEm", affiliation_em, "contains");
          if (journal_title) addFilter(searchParams, "journalTitle", journal_title, "contains");
          if (subtype) addFilter(searchParams, "subtype", subtype, "equals");
          if (entity_type) addFilter(searchParams, "entityType", entity_type, "equals");
          if (pbn_discipline) addFilter(searchParams, "pbndiscipline", pbn_discipline, "equals");
          if (date_issued) addFilter(searchParams, "dateIssued", date_issued, "equals");
          if (date_accessioned)
            addFilter(searchParams, "dateAccessioned", date_accessioned, "equals");
          if (date_submitted) addFilter(searchParams, "dateSubmitted", date_submitted, "equals");
          if (has_full_text !== undefined) {
            searchParams.append("f.has_content_in_original_bundle", `${has_full_text},equals`);
          }

          const url = `${API_BASE}/discover/search/objects?${searchParams}`;
          const cacheKey = makeCacheKey("ruj_search", {
            query,
            page,
            size,
            sort,
            itemtype,
            author,
            subject,
            language,
            affiliation,
            affiliation_em,
            journal_title,
            subtype,
            entity_type,
            pbn_discipline,
            has_full_text,
            date_issued,
            date_accessioned,
            date_submitted,
          });
          const data = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            CACHE_TTL,
          );
          return {
            content: [{ type: "text", text: summarizeSearch(data, Boolean(minimize_pii)) }],
          };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error searching RUJ: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );

  // ── ruj_get_item ──────────────────────────────────────────────────────────
  server.tool(
    "ruj_get_item",
    [
      "Pobiera pełne metadane pojedynczego obiektu w Repozytorium Uniwersytetu Jagiellońskiego na podstawie UUID.",
      "UUID znajduje się w polu 'uuid' wyników ruj_search.",
    ].join(" "),
    {
      uuid: z
        .string()
        .describe("UUID obiektu z wyników ruj_search, np. 3fa85f64-5717-4562-b3fc-2c963f66afa6"),
    },
    async ({ uuid }) => {
      return (async () => {
        try {
          const url = `${API_BASE}/core/items/${uuid}`;
          const cacheKey = makeCacheKey("ruj_item", { uuid });
          const data = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text: summarizeItem(data) }] };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error fetching RUJ item ${uuid}: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );
}
