import { toToolErrorText } from "../tool-error-handling.js";
/**
 * GUS Bank Danych Lokalnych (BDL) — regional and national statistics (BDL web UI: bdl.stat.gov.pl).
 * REST API v1: https://bdl.stat.gov.pl/api/v1/ — JSON/XML, OpenAPI at .../swagger/doc/swagger.json
 *
 * Anonymous access works; optional env BDL_CLIENT_ID sets header X-ClientId for higher rate limits
 * (register at api.stat.gov.pl). Responses are cached to reduce duplicate calls.
 *
 * Tools:
 *   bdl_search_subjects      — thematic tree search by name fragment.
 *   bdl_search_variables     — search statistical variables (N1…N5 text, subject, level, years).
 *   bdl_search_units         — search territorial units (name, level, year).
 *   bdl_get_variable         — metadata for one variable by numeric id.
 *   bdl_get_data_by_variable — values for one variable across units (unit-level, years, paging).
 *   bdl_get_data_by_unit     — values for one unit for one or more variable ids.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const API_BASE = "https://bdl.stat.gov.pl/api/v1";
const JSON_HEADERS = { Accept: "application/json" } as const;
/** Search / metadata: 1 h — same order of magnitude as dane.gov.pl */
const SEARCH_TTL = 3_600; // seconds — search / metadata
const DATA_TTL = 3_600; // tabular responses

function bdlHeaders(env: Env): Record<string, string> {
  const h: Record<string, string> = { ...JSON_HEADERS };
  if (env.BDL_CLIENT_ID?.trim()) {
    h["X-ClientId"] = env.BDL_CLIENT_ID.trim();
  }
  return h;
}

function appendYearParams(params: URLSearchParams, years: number[] | undefined): void {
  if (!years?.length) return;
  for (const y of years) params.append("year", String(y));
}

const subjectSort = z
  .enum([
    "Id",
    "-Id",
    "Id,Name",
    "Id,-Name",
    "-Id,Name",
    "-Id,-Name",
    "Name",
    "-Name",
    "Name,Id",
    "Name,-Id",
    "-Name,Id",
    "-Name,-Id",
  ])
  .optional();

const variableSort = z
  .enum([
    "Id",
    "-Id",
    "Id,SubjectId",
    "Id,-SubjectId",
    "-Id,SubjectId",
    "-Id,-SubjectId",
    "SubjectId",
    "-SubjectId",
    "SubjectId,Id",
    "SubjectId,-Id",
    "-SubjectId,Id",
    "-SubjectId,-Id",
  ])
  .optional();

export function registerBdlTools(server: McpServer, env: Env): void {
  // ── bdl_search_subjects ───────────────────────────────────────────────────
  server.tool(
    "bdl_search_subjects",
    [
      "Wyszukiwanie tematów statystycznych w BDL GUS po fragmencie nazwy. Użyj, aby odkryć identyfikatory tematów przed pobraniem zmiennych lub przeglądaniem drzewa.",
      "API: GET /subjects/search. Paginacja liczona od zera.",
      "Zwraca JSON (identyfikator tematu, nazwa, identyfikatory potomków, poziomy).",
    ].join(" "),
    {
      name: z
        .string()
        .describe("Fragment nazwy tematu (polskie lub angielskie etykiety zależnie od parametru lang)"),
      page: z.number().int().min(0).default(0).describe("Indeks strony liczony od zera"),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Liczba wyników na stronę (maks. 100)"),
      sort: subjectSort.describe("Kierunek sortowania (opcjonalnie)"),
      lang: z.enum(["pl", "en"]).default("pl").describe("Język odpowiedzi"),
    },
    async ({ name, page, page_size, sort, lang }) => {
      return (async () => {
        try {
          const params = new URLSearchParams({
            name,
            page: String(page),
            "page-size": String(page_size),
            lang,
          });
          if (sort) params.set("sort", sort);
          const url = `${API_BASE}/subjects/search?${params}`;
          const key = makeCacheKey("bdl_search_subjects", { name, page, page_size, sort, lang });
          const text = await cachedFetch(
            env.CACHE_KV,
            key,
            url,
            { headers: bdlHeaders(env) },
            SEARCH_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling bdl_search_subjects: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  // ── bdl_search_variables ──────────────────────────────────────────────────
  server.tool(
    "bdl_search_variables",
    [
      "Wyszukiwanie zmiennych statystycznych BDL (cech). Filtruj po tekście nazwy (N1…N5), identyfikatorze tematu,",
      "poziomie i latach. Podawaj krótką nazwę wskaźnika (np. „bezrobocie”, „stopa bezrobocia”) — frazy z województwem/miastem dają 0 trafień w API.",
      "Przy trafieniach dołącza pole voivodeship_data: wartości dla wszystkich województw (unit-level=2), w tym MAŁOPOLSKIE.",
      "Użyj numerycznego identyfikatora wyniku z bdl_get_data_by_variable lub bdl_get_data_by_unit.",
      "API: GET /variables/search. Paginacja liczona od zera.",
    ].join(" "),
    {
      name: z
        .string()
        .optional()
        .describe("Tekst dopasowywany w polach N1…N5 (np. fragment polskiej etykiety zmiennej)"),
      subject_id: z
        .string()
        .optional()
        .describe("Identyfikator nadrzędnego tematu z bdl_search_subjects lub drzewa BDL (np. P1312)"),
      level: z
        .number()
        .int()
        .optional()
        .describe("Filtr poziomu terytorialnego lub poziomu zmiennej, gdy ma zastosowanie"),
      years: z
        .array(z.number().int())
        .optional()
        .describe("Ograniczenie do zmiennych dostępnych dla wskazanych lat kalendarzowych"),
      page: z.number().int().min(0).default(0).describe("Indeks strony liczony od zera"),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Liczba wyników na stronę (maks. 100)"),
      sort: variableSort.describe("Kierunek sortowania (opcjonalnie)"),
      lang: z.enum(["pl", "en"]).default("pl").describe("Język odpowiedzi"),
    },
    async ({ name, subject_id, level, years, page, page_size, sort, lang }) => {
      return (async () => {
        try {
          const searchOnce = async (nameQ: string | undefined) => {
            const params = new URLSearchParams({
              page: String(page),
              "page-size": String(page_size),
              lang,
            });
            if (nameQ) params.set("name", nameQ);
            if (subject_id) params.set("subject-id", subject_id);
            if (level !== undefined) params.set("level", String(level));
            appendYearParams(params, years);
            if (sort) params.set("sort", sort);
            const url = `${API_BASE}/variables/search?${params}`;
            const key = makeCacheKey("bdl_search_variables", {
              name: nameQ,
              subject_id,
              level,
              years,
              page,
              page_size,
              sort,
              lang,
            });
            return cachedFetch(env.CACHE_KV, key, url, { headers: bdlHeaders(env) }, SEARCH_TTL);
          };

          // BDL AND-match: długie frazy z geo → 0 trafień. Próbuj pełną nazwę, potem krótkie tokeny.
          let usedName = name?.trim() || undefined;
          let text = await searchOnce(usedName);
          let parsed = JSON.parse(text) as {
            totalRecords?: number;
            results?: Array<Record<string, unknown>>;
          };
          if ((parsed.totalRecords ?? 0) === 0 && usedName && /\s/.test(usedName)) {
            const tokens = usedName
              .split(/\s+/)
              .filter((t) => t.length >= 4)
              .sort((a, b) => b.length - a.length);
            for (const tok of [...tokens, "bezrobocie", "stopa bezrobocia"].filter(
              (t, i, a) => a.indexOf(t) === i,
            )) {
              const retry = await searchOnce(tok);
              const retryParsed = JSON.parse(retry) as typeof parsed;
              if ((retryParsed.totalRecords ?? 0) > 0) {
                text = retry;
                parsed = retryParsed;
                usedName = tok;
                break;
              }
            }
          }

          // Dołącz dane wojewódzkie (unit-level=2) dla 1–2 pierwszych zmiennych — bez osobnego get_record.
          const top = (parsed.results ?? []).slice(0, 2);
          const voivodeship_data: Array<Record<string, unknown>> = [];
          for (const v of top) {
            const vid = Number(v.id);
            if (!Number.isFinite(vid)) continue;
            try {
              const dataUrl = `${API_BASE}/data/by-variable/${vid}?unit-level=2&page-size=20&lang=${lang}`;
              const dataKey = makeCacheKey("bdl_voiv_sample", { vid, lang });
              const dataText = await cachedFetch(
                env.CACHE_KV,
                dataKey,
                dataUrl,
                { headers: bdlHeaders(env) },
                DATA_TTL,
              );
              const data = JSON.parse(dataText) as {
                results?: Array<{ id?: string; name?: string; values?: unknown[] }>;
              };
              voivodeship_data.push({
                variable_id: vid,
                variable_label: [v.n1, v.n2, v.n3].filter(Boolean).join(" · "),
                unit_level: 2,
                note: "Wartości dla wszystkich województw (poziom 2 BDL). Szukaj wiersza MAŁOPOLSKIE / innego województwa po name.",
                results: (data.results ?? []).map((u) => ({
                  unit_id: u.id,
                  name: u.name,
                  values: (u.values ?? []).slice(-8),
                })),
              });
            } catch {
              /* pomiń wzbogacenie przy błędzie API */
            }
          }

          const items = (parsed.results ?? []).map((r) => ({
            ...r,
            id: r.id,
            source: "bdl",
            get_record: `bdl:${r.id}`,
            title: [r.n1, r.n2, r.n3].filter(Boolean).join(" · "),
          }));

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ...parsed,
                    query_used: usedName ?? null,
                    source: "bdl",
                    items,
                    voivodeship_data,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling bdl_search_variables: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  // ── bdl_search_units ──────────────────────────────────────────────────────
  server.tool(
    "bdl_search_units",
    [
      "Wyszukiwanie jednostek terytorialnych BDL (województwa, powiaty, gminy) po fragmencie nazwy.",
      "Opcjonalne filtry poziomu i roku. Użyj zwróconego identyfikatora jednostki z bdl_get_data_by_unit.",
      "API: GET /units/search. Paginacja liczona od zera.",
    ].join(" "),
    {
      name: z.string().optional().describe("Fragment nazwy jednostki (np. miasto lub województwo)"),
      levels: z
        .array(z.number().int())
        .optional()
        .describe(
          "Filtry poziomu TERYT (np. 2 dla województwa; sprawdź metadane /levels BDL gdy nie jesteś pewien)",
        ),
      years: z
        .array(z.number().int())
        .optional()
        .describe("Lata, dla których definicja jednostki powinna istnieć"),
      page: z.number().int().min(0).default(0).describe("Indeks strony liczony od zera"),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Liczba wyników na stronę (maks. 100)"),
      sort: subjectSort.describe("Kierunek sortowania (opcjonalnie)"),
      lang: z.enum(["pl", "en"]).default("pl").describe("Język odpowiedzi"),
    },
    async ({ name, levels, years, page, page_size, sort, lang }) => {
      return (async () => {
        try {
          const params = new URLSearchParams({
            page: String(page),
            "page-size": String(page_size),
            lang,
          });
          if (name) params.set("name", name);
          if (levels?.length) levels.forEach((l) => params.append("level", String(l)));
          appendYearParams(params, years);
          if (sort) params.set("sort", sort);
          const url = `${API_BASE}/units/search?${params}`;
          const key = makeCacheKey("bdl_search_units", {
            name,
            levels,
            years,
            page,
            page_size,
            sort,
            lang,
          });
          const text = await cachedFetch(
            env.CACHE_KV,
            key,
            url,
            { headers: bdlHeaders(env) },
            SEARCH_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling bdl_search_units: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  // ── bdl_get_variable ─────────────────────────────────────────────────────
  server.tool(
    "bdl_get_variable",
    [
      "Pobiera metadane jednej zmiennej BDL po numerycznym identyfikatorze (z wyników bdl_search_variables).",
      "API: GET /variables/{id}.",
    ].join(" "),
    {
      variable_id: z.number().int().positive().describe("Identyfikator zmiennej (liczba całkowita)"),
      lang: z.enum(["pl", "en"]).default("pl").describe("Język odpowiedzi"),
    },
    async ({ variable_id, lang }) => {
      return (async () => {
        try {
          const params = new URLSearchParams({ lang });
          const url = `${API_BASE}/variables/${variable_id}?${params}`;
          const key = makeCacheKey("bdl_get_variable", { variable_id, lang });
          const text = await cachedFetch(
            env.CACHE_KV,
            key,
            url,
            { headers: bdlHeaders(env) },
            SEARCH_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling bdl_get_variable: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  // ── bdl_get_data_by_variable ──────────────────────────────────────────────
  server.tool(
    "bdl_get_data_by_variable",
    [
      "Pobiera wartości statystyczne dla jednej zmiennej dla zestawu jednostek terytorialnych (np. wszystkie województwa).",
      "Ustaw unit_level (identyfikator poziomu BDL) i opcjonalnie unit_parent_id, aby zawęzić wyniki;",
      "filtr lat określa zwracane okresy. Paginacja liczona od zera.",
      "API: GET /data/by-variable/{var-id}.",
    ].join(" "),
    {
      variable_id: z.number().int().positive().describe("Identyfikator zmiennej"),
      years: z
        .array(z.number().int())
        .optional()
        .describe("Lata kalendarzowe do uwzględnienia (powtórzony parametr year= w API); pomiń dla wszystkich dostępnych"),
      unit_level: z
        .number()
        .int()
        .optional()
        .describe(
          "Poziom terytorialny BDL (np. 2 = województwo); użyj BDL /levels lub metadanych gdy nie jesteś pewien",
        ),
      unit_parent_id: z
        .string()
        .optional()
        .describe("Identyfikator jednostki nadrzędnej, by ograniczyć do jej potomków (np. kod województwa)"),
      aggregate_id: z.number().int().default(1).describe("Identyfikator poziomu agregacji (domyślnie 1)"),
      page: z.number().int().min(0).default(0).describe("Indeks strony liczony od zera"),
      page_size: z.number().int().min(1).max(100).default(20).describe("Wierszy na stronę"),
      lang: z.enum(["pl", "en"]).default("pl").describe("Język odpowiedzi"),
    },
    async ({
      variable_id,
      years,
      unit_level,
      unit_parent_id,
      aggregate_id,
      page,
      page_size,
      lang,
    }) => {
      return (async () => {
        try {
          const params = new URLSearchParams({
            page: String(page),
            "page-size": String(page_size),
            lang,
            aggregate_id: String(aggregate_id),
          });
          appendYearParams(params, years);
          if (unit_level !== undefined) params.set("unit-level", String(unit_level));
          if (unit_parent_id) params.set("unit-parent-id", unit_parent_id);
          const url = `${API_BASE}/data/by-variable/${variable_id}?${params}`;
          const key = makeCacheKey("bdl_get_data_by_variable", {
            variable_id,
            years,
            unit_level,
            unit_parent_id,
            aggregate_id,
            page,
            page_size,
            lang,
          });
          const text = await cachedFetch(
            env.CACHE_KV,
            key,
            url,
            { headers: bdlHeaders(env) },
            DATA_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling bdl_get_data_by_variable: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  // ── bdl_get_data_by_unit ───────────────────────────────────────────────────
  server.tool(
    "bdl_get_data_by_unit",
    [
      "Pobiera wartości dla jednej jednostki terytorialnej dla jednej lub wielu zmiennych (numeryczne identyfikatory zmiennych).",
      "Wymaga co najmniej jednego identyfikatora zmiennej. Opcjonalna lista lat i paginacja.",
      "API: GET /data/by-unit/{unit-id} z powtórzonymi parametrami var-id.",
    ].join(" "),
    {
      unit_id: z
        .string()
        .describe("Identyfikator jednostki terytorialnej z bdl_search_units (np. kod w stylu TERYT)"),
      variable_ids: z
        .array(z.number().int().positive())
        .min(1)
        .describe("Jeden lub więcej identyfikatorów zmiennych"),
      years: z.array(z.number().int()).optional().describe("Lata kalendarzowe do uwzględnienia"),
      aggregate_id: z.number().int().default(1).describe("Identyfikator poziomu agregacji (domyślnie 1)"),
      page: z.number().int().min(0).default(0).describe("Indeks strony liczony od zera"),
      page_size: z.number().int().min(1).max(100).default(20).describe("Wierszy na stronę"),
      lang: z.enum(["pl", "en"]).default("pl").describe("Język odpowiedzi"),
    },
    async ({ unit_id, variable_ids, years, aggregate_id, page, page_size, lang }) => {
      return (async () => {
        try {
          const params = new URLSearchParams({
            page: String(page),
            "page-size": String(page_size),
            lang,
            aggregate_id: String(aggregate_id),
          });
          for (const vid of variable_ids) params.append("var-id", String(vid));
          appendYearParams(params, years);
          const url = `${API_BASE}/data/by-unit/${encodeURIComponent(unit_id)}?${params}`;
          const key = makeCacheKey("bdl_get_data_by_unit", {
            unit_id,
            variable_ids,
            years,
            aggregate_id,
            page,
            page_size,
            lang,
          });
          const text = await cachedFetch(
            env.CACHE_KV,
            key,
            url,
            { headers: bdlHeaders(env) },
            DATA_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling bdl_get_data_by_unit: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );
}
