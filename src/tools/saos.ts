import { toToolErrorText } from "../tool-error-handling.js";
/**
 * SAOS — System Analizy Orzeczeń Sądowych (public JSON API, no key).
 *
 * Search & detail (typical LLM use):
 *   saos_search_judgments — GET /api/search/judgments
 *   saos_get_judgment     — GET /api/judgments/{id}
 *
 * Bulk dump API (hurtowe pobieranie — narrow date ranges / small pageSize):
 *   https://www.saos.org.pl/help/index.php/dokumentacja-api/api-pobierania-danych
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const SAOS_BASE = "https://www.saos.org.pl/api";
const JSON_HEADERS = { Accept: "application/json" };
const SEARCH_TTL = 3_600;
const JUDGMENT_DETAIL_TTL = 86_400;
const DUMP_TTL = 86_400;

function appendIfDefined(
  p: URLSearchParams,
  key: string,
  value: string | number | boolean | undefined,
): void {
  if (value === undefined) return;
  if (typeof value === "string" && value.length === 0) return;
  p.set(key, String(value));
}

function buildSearchJudgmentsParams(args: {
  all?: string;
  page_size: number;
  page_number: number;
  sorting_field?: string;
  sorting_direction?: "ASC" | "DESC";
  legal_base?: string;
  referenced_regulation?: string;
  law_journal_entry_code?: string;
  judge_name?: string;
  case_number?: string;
  court_type?: string;
  cc_court_id?: number;
  cc_court_code?: string;
  cc_court_name?: string;
  cc_division_id?: number;
  cc_division_code?: string;
  cc_division_name?: string;
  cc_include_dependent_court_judgments?: boolean;
  sc_personnel_type?: string;
  sc_judgment_form?: string;
  sc_chamber_id?: number;
  sc_chamber_name?: string;
  sc_division_id?: number;
  sc_division_name?: string;
  judgment_types?: string[];
  keywords?: string[];
  judgment_date_from?: string;
  judgment_date_to?: string;
}): URLSearchParams {
  const p = new URLSearchParams();
  appendIfDefined(p, "pageSize", args.page_size);
  appendIfDefined(p, "pageNumber", args.page_number);
  appendIfDefined(p, "sortingField", args.sorting_field);
  appendIfDefined(p, "sortingDirection", args.sorting_direction);
  appendIfDefined(p, "all", args.all);
  appendIfDefined(p, "legalBase", args.legal_base);
  appendIfDefined(p, "referencedRegulation", args.referenced_regulation);
  appendIfDefined(p, "lawJournalEntryCode", args.law_journal_entry_code);
  appendIfDefined(p, "judgeName", args.judge_name);
  appendIfDefined(p, "caseNumber", args.case_number);
  appendIfDefined(p, "courtType", args.court_type);
  appendIfDefined(p, "ccCourtId", args.cc_court_id);
  appendIfDefined(p, "ccCourtCode", args.cc_court_code);
  appendIfDefined(p, "ccCourtName", args.cc_court_name);
  appendIfDefined(p, "ccDivisionId", args.cc_division_id);
  appendIfDefined(p, "ccDivisionCode", args.cc_division_code);
  appendIfDefined(p, "ccDivisionName", args.cc_division_name);
  if (args.cc_include_dependent_court_judgments === true) {
    p.set("ccIncludeDependentCourtJudgments", "true");
  } else if (args.cc_include_dependent_court_judgments === false) {
    p.set("ccIncludeDependentCourtJudgments", "false");
  }
  appendIfDefined(p, "scPersonnelType", args.sc_personnel_type);
  appendIfDefined(p, "scJudgmentForm", args.sc_judgment_form);
  appendIfDefined(p, "scChamberId", args.sc_chamber_id);
  appendIfDefined(p, "scChamberName", args.sc_chamber_name);
  appendIfDefined(p, "scDivisionId", args.sc_division_id);
  appendIfDefined(p, "scDivisionName", args.sc_division_name);
  appendIfDefined(p, "judgmentDateFrom", args.judgment_date_from);
  appendIfDefined(p, "judgmentDateTo", args.judgment_date_to);
  for (const t of args.judgment_types ?? []) {
    p.append("judgmentTypes", t);
  }
  for (const k of args.keywords ?? []) {
    if (k.trim()) p.append("keywords", k.trim());
  }
  return p;
}

export function registerSaosTools(server: McpServer, env: Env): void {
  server.tool(
    "saos_search_judgments",
    [
      "Search Polish court judgments in SAOS (System Analizy Orzeczeń Sądowych).",
      "Use `all` for full-text / metadata phrase (SAOS query language: https://www.saos.org.pl/help/index.php/search-query-language).",
      "Filter by dates, case number (exact full signature), court ids/codes, judge name, legal base text, judgment types (DECISION, SENTENCE, …).",
      "Returns JSON with items[].id, href, textContent snippets, court metadata. For full text use saos_get_judgment with id.",
      "ponytail: serwis SAOS cyklicznie wchodzi w tryb «Przerwa techniczna». Przy zawieszeniu skorzystaj z saos_dump_judgments.",
    ].join(" "),
    {
      all: z
        .string()
        .optional()
        .describe(
          "Fraza przeszukiwana we wszystkich polach orzeczenia (metadane i treść). Składnia zapytań SAOS opisana w pomocy.",
        ),
      page_size: z
        .number()
        .int()
        .min(10)
        .max(100)
        .default(20)
        .describe("Liczba wyników na stronę; API akceptuje zakres 10–100."),
      page_number: z.number().int().min(0).default(0).describe("Indeks strony wyników, liczony od zera."),
      sorting_field: z
        .string()
        .optional()
        .describe("Sort field, e.g. DATABASE_ID, JUDGMENT_DATE (see SAOS search API docs)."),
      sorting_direction: z.enum(["ASC", "DESC"]).optional().describe("Kierunek sortowania listy wyników."),
      legal_base: z.string().optional().describe("Wyszukiwanie pełnotekstowe w polu podstawy prawnej orzeczenia."),
      referenced_regulation: z
        .string()
        .optional()
        .describe("Wyszukiwanie w tekście wskazanego przepisu ustawy."),
      law_journal_entry_code: z
        .string()
        .optional()
        .describe("Pozycja w Dzienniku Ustaw w formacie rok/numer, np. 2024/123."),
      judge_name: z.string().optional().describe("Nazwisko sędziego (zapytanie w języku zapytań SAOS)."),
      case_number: z.string().optional().describe("Pełna sygnatura sprawy, dokładnie (nie jako substring)."),
      court_type: z
        .enum(["APPEAL", "REGIONAL", "DISTRICT"])
        .optional()
        .describe("Poziom sądu powszechnego (tylko przy filtracji sądów powszechnych)."),
      cc_court_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Wewnętrzny identyfikator sądu powszechnego w SAOS."),
      cc_court_code: z
        .string()
        .optional()
        .describe("Source court code digits, e.g. 15500000 for SA Wrocław."),
      cc_court_name: z
        .string()
        .optional()
        .describe("Exact court name including case (e.g. Sąd Apelacyjny we Wrocławiu)."),
      cc_division_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Identyfikator wydziału sądu powszechnego w SAOS."),
      cc_division_code: z.string().optional().describe("Kod wydziału w obrębie jednego sądu."),
      cc_division_name: z.string().optional().describe("Dokładna nazwa wydziału sądu."),
      cc_include_dependent_court_judgments: z
        .boolean()
        .optional()
        .describe(
          "Gdy cc_court_id wskazuje sąd apelacyjny: uwzględnij orzeczenia sądów niższej instancji z tego okręgu.",
        ),
      sc_personnel_type: z
        .string()
        .optional()
        .describe(
          "Rozmiar składu Sądu Najwyższego: ONE_PERSON, THREE_PERSON, FIVE_PERSON, SEVEN_PERSON, ALL_COURT, ALL_CHAMBER, JOINED_CHAMBERS.",
        ),
      sc_judgment_form: z
        .string()
        .optional()
        .describe("Dokładna etykieta formy orzeczenia SN, np. wyrok SN (z uwzględnieniem wielkości liter)."),
      sc_chamber_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Identyfikator izby Sądu Najwyższego w bazie SAOS."),
      sc_chamber_name: z.string().optional().describe("Dokładna nazwa izby (z uwzględnieniem wielkości liter)."),
      sc_division_id: z.number().int().positive().optional().describe("Identyfikator wydziału Sądu Najwyższego."),
      sc_division_name: z.string().optional().describe("Dokładna nazwa wydziału Sądu Najwyższego."),
      judgment_types: z
        .array(z.enum(["DECISION", "RESOLUTION", "SENTENCE", "REGULATION", "REASONS"]))
        .optional()
        .describe("Match any of these judgment types (OR)."),
      keywords: z
        .array(z.string())
        .optional()
        .describe(
          "Thematic keywords (common courts); all listed keywords must match (AND). Exact spelling.",
        ),
      judgment_date_from: z.string().optional().describe("Lower bound judgment date yyyy-MM-dd."),
      judgment_date_to: z.string().optional().describe("Upper bound judgment date yyyy-MM-dd."),
    },
    async (params) => {
      return (async () => {
        try {
          const qs = buildSearchJudgmentsParams({
            all: params.all,
            page_size: params.page_size,
            page_number: params.page_number,
            sorting_field: params.sorting_field,
            sorting_direction: params.sorting_direction,
            legal_base: params.legal_base,
            referenced_regulation: params.referenced_regulation,
            law_journal_entry_code: params.law_journal_entry_code,
            judge_name: params.judge_name,
            case_number: params.case_number,
            court_type: params.court_type,
            cc_court_id: params.cc_court_id,
            cc_court_code: params.cc_court_code,
            cc_court_name: params.cc_court_name,
            cc_division_id: params.cc_division_id,
            cc_division_code: params.cc_division_code,
            cc_division_name: params.cc_division_name,
            cc_include_dependent_court_judgments: params.cc_include_dependent_court_judgments,
            sc_personnel_type: params.sc_personnel_type,
            sc_judgment_form: params.sc_judgment_form,
            sc_chamber_id: params.sc_chamber_id,
            sc_chamber_name: params.sc_chamber_name,
            sc_division_id: params.sc_division_id,
            sc_division_name: params.sc_division_name,
            judgment_types: params.judgment_types,
            keywords: params.keywords,
            judgment_date_from: params.judgment_date_from,
            judgment_date_to: params.judgment_date_to,
          });
          const url = `${SAOS_BASE}/search/judgments?${qs}`;
          const cacheKey = makeCacheKey("saos_search_judgments", {
            url,
          });
          // ponytail: SAOS search sometimes hangs without a TCP reset. Use a shorter
          // 20s timeout here, distinct from the default 30s in src/cache.ts. The shared
          // transport still has its own ceiling; the goal is to fail fast and let the
          // caller fall back to saos_dump_judgments instead of hanging the MCP client.
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            {
              headers: JSON_HEADERS,
              signal: AbortSignal.timeout(20_000),
            },
            SEARCH_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [
              {
                type: "text",
                text:
                  `Error calling saos_search_judgments: ${msg}\n` +
                  "Serwis SAOS może być w trybie Przerwa techniczna. Spróbuj saos_dump_judgments " +
                  "z wąskim zakresem dat lub sprawdź https://www.saos.org.pl/search",
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "saos_get_judgment",
    [
      "Fetch one SAOS judgment by numeric id (from search results items[].id or /api/search/judgments).",
      "Returns full JSON including textContent, judges, courtCases, legalBases, referencedRegulations.",
    ].join(" "),
    {
      judgment_id: z.number().int().positive().describe("Identyfikator orzeczenia w bazie SAOS (liczba całkowita dodatnia)."),
    },
    async ({ judgment_id }) => {
      return (async () => {
        try {
          const url = `${SAOS_BASE}/judgments/${judgment_id}`;
          const cacheKey = makeCacheKey("saos_get_judgment", { judgment_id });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            JUDGMENT_DETAIL_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling saos_get_judgment: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "saos_dump_services",
    [
      "SAOS bulk dump API entry: lists hypermedia links to dump sub-services (commonCourts, judgments, scChambers, enrichments, deletedJudgments).",
      "For searching judgments without mirroring the full database prefer saos_search_judgments.",
      "Docs: https://www.saos.org.pl/help/index.php/dokumentacja-api/api-pobierania-danych",
    ].join(" "),
    {},
    async () => {
      return (async () => {
        try {
          const url = `${SAOS_BASE}/dump`;
          const cacheKey = makeCacheKey("saos_dump_services", {});
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            DUMP_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling saos_dump_services: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  const pageArgs = {
    page_size: z
      .number()
      .int()
      .min(10)
      .max(100)
      .default(20)
      .describe("Liczba wyników na żądanie; API akceptuje zakres 10–100."),
    page_number: z.number().int().min(0).default(0).describe("Numer strony wyników, liczony od zera."),
  };

  server.tool(
    "saos_dump_common_courts",
    [
      "SAOS dump: paginated list of common courts (names, codes, divisions).",
      "Use small page_size; responses are large. Cache TTL 24h.",
    ].join(" "),
    pageArgs,
    async ({ page_size, page_number }) => {
      return (async () => {
        try {
          const qs = new URLSearchParams({
            pageSize: String(page_size),
            pageNumber: String(page_number),
          });
          const url = `${SAOS_BASE}/dump/commonCourts?${qs}`;
          const cacheKey = makeCacheKey("saos_dump_common_courts", { page_size, page_number });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            DUMP_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling saos_dump_common_courts: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "saos_dump_sc_chambers",
    ["SAOS dump: paginated list of Supreme Court chambers and divisions."].join(" "),
    pageArgs,
    async ({ page_size, page_number }) => {
      return (async () => {
        try {
          const qs = new URLSearchParams({
            pageSize: String(page_size),
            pageNumber: String(page_number),
          });
          const url = `${SAOS_BASE}/dump/scChambers?${qs}`;
          const cacheKey = makeCacheKey("saos_dump_sc_chambers", { page_size, page_number });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            DUMP_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling saos_dump_sc_chambers: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "saos_dump_judgments",
    [
      "SAOS bulk dump of judgments (full records per row — can be very large). Prefer narrow judgment_start_date/judgment_end_date and page_size 10–20.",
      "since_modification_date: incremental sync (ISO local: yyyy-MM-dd'T'HH:mm:ss.SSS). with_generated: include SAOS enrichment module fields.",
      "Not a replacement for saos_search_judgments (different use case: mirror/sync).",
    ].join(" "),
    {
      ...pageArgs,
      judgment_start_date: z
        .string()
        .optional()
        .describe("Lower bound judgment date yyyy-MM-dd (judgmentStartDate)."),
      judgment_end_date: z
        .string()
        .optional()
        .describe("Upper bound judgment date yyyy-MM-dd (judgmentEndDate)."),
      since_modification_date: z
        .string()
        .optional()
        .describe(
          "Tylko orzeczenia zmodyfikowane po tym znaczniku czasu (parametr sinceModificationDate), format yyyy-MM-dd'T'HH:mm:ss.SSS.",
        ),
      with_generated: z
        .boolean()
        .default(true)
        .describe("Include data from SAOS enrichment module (withGenerated)."),
    },
    async ({
      page_size,
      page_number,
      judgment_start_date,
      judgment_end_date,
      since_modification_date,
      with_generated,
    }) => {
      return (async () => {
        try {
          const qs = new URLSearchParams({
            pageSize: String(page_size),
            pageNumber: String(page_number),
            withGenerated: String(with_generated),
          });
          appendIfDefined(qs, "judgmentStartDate", judgment_start_date);
          appendIfDefined(qs, "judgmentEndDate", judgment_end_date);
          appendIfDefined(qs, "sinceModificationDate", since_modification_date);
          const url = `${SAOS_BASE}/dump/judgments?${qs}`;
          const cacheKey = makeCacheKey("saos_dump_judgments", {
            page_size,
            page_number,
            judgment_start_date,
            judgment_end_date,
            since_modification_date,
            with_generated,
          });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            DUMP_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling saos_dump_judgments: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "saos_dump_enrichments",
    [
      "SAOS dump: paginated list of enrichment tags from the SAOS enrichment module (labels for judgments).",
    ].join(" "),
    pageArgs,
    async ({ page_size, page_number }) => {
      return (async () => {
        try {
          const qs = new URLSearchParams({
            pageSize: String(page_size),
            pageNumber: String(page_number),
          });
          const url = `${SAOS_BASE}/dump/enrichments?${qs}`;
          const cacheKey = makeCacheKey("saos_dump_enrichments", { page_size, page_number });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            DUMP_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling saos_dump_enrichments: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );
}
