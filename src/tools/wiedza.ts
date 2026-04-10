import { toToolErrorText } from "../tool-error-handling.js";
/**
 * Portal WIEDZA (wiedza.pkn.pl) — wyszukiwarka Polskich Norm i powiązanych dokumentów.
 * Backend: Liferay 6.1; brak publicznego JSON API — używany jest formularz portletu
 * (sesja cookie + token Liferay p_auth).
 *
 * Tools:
 *   wiedza_search_norms — POST wyszukiwania (HTML z listą wyników).
 *   wiedza_get_standard  — GET karty normy po dokładnym numerze z wyników wyszukiwania.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const WIEDZA_ORIGIN = "https://wiedza.pkn.pl";
const PREFIX = "_searchstandards_WAR_p4scustomerpknzwnelsearchstandardsportlet";
const PORTLET_ID = "searchstandards_WAR_p4scustomerpknzwnelsearchstandardsportlet";

const LANDING: Record<"pl" | "en" | "ru", string> = {
  pl: "/web/guest/wyszukiwarka-norm",
  en: "/en/wyszukiwarka-norm",
  ru: "/ru/wyszukiwarka-norm",
};

const DEFAULT_UA = "Mozilla/5.0 (compatible; PolishAcademicMCP/1.0)";

const API_FIELDS = [
  "standard_number",
  "title",
  "ics",
  "language",
  "status",
  "rows",
];

type HeadersWithCookies = Headers & { getSetCookie?: () => string[] };

function collectCookieHeader(headers: Headers): string {
  const gn = (headers as HeadersWithCookies).getSetCookie?.();
  if (gn && gn.length > 0) {
    return gn.map((c) => c.split(";")[0]!.trim()).filter(Boolean).join("; ");
  }
  return "";
}

function parseAuthToken(html: string): string | null {
  const m = /Liferay\.authToken = '([^']+)'/.exec(html);
  return m?.[1] ?? null;
}

function parseFormDate(html: string): string | null {
  const esc = PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`name="${esc}_formDate" type="hidden" value="(\\d+)"`).exec(html);
  return m?.[1] ?? null;
}

async function fetchLandingSession(
  locale: keyof typeof LANDING,
): Promise<{ html: string; cookieHeader: string; landingPath: string }> {
  const landingPath = LANDING[locale];
  const url = `${WIEDZA_ORIGIN}${landingPath}`;
  const res = await fetch(url, {
    redirect: "follow",
    headers: { Accept: "text/html", "User-Agent": DEFAULT_UA },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  }
  const html = await res.text();
  const cookieHeader = collectCookieHeader(res.headers);
  return { html, cookieHeader, landingPath };
}

function buildSearchBody(
  formDate: string,
  p: {
    standard_number?: string;
    title?: string;
    title_english?: string;
    content?: string;
    ics?: string;
    sector?: string;
    technical_committee?: string;
    directive?: string;
    introduction?: string;
    publish_from?: string;
    publish_to?: string;
    withdrawal_from?: string;
    withdrawal_to?: string;
    title_match: "words" | "phrase";
    language: "ALL" | "P" | "E" | "D" | "F";
    status: "all" | "standard-actual" | "standard-withdrawal";
    rows_on_page: "20" | "30" | "50" | "75";
  },
): string {
  const u = new URLSearchParams();
  u.set(`${PREFIX}_formDate`, formDate);
  u.set("hiddenInputStandardNumber", p.standard_number ?? "");
  u.set(`${PREFIX}_standardNumber`, p.standard_number ?? "");
  u.set("searchType", p.title_match === "phrase" ? "2" : "1");
  u.set(`${PREFIX}_standardIcs`, p.ics ?? "");
  u.set(`${PREFIX}_standardTitle`, p.title ?? "");
  u.set(`${PREFIX}_standardTitleEnglish`, p.title_english ?? "");
  u.set(`${PREFIX}_standardContent`, p.content ?? "");
  u.set(`${PREFIX}_startDate`, p.publish_from ?? "");
  u.set(`${PREFIX}_endDate`, p.publish_to ?? "");
  u.set(`${PREFIX}_withdrawalStartDate`, p.withdrawal_from ?? "");
  u.set(`${PREFIX}_withdrawalEndDate`, p.withdrawal_to ?? "");
  u.set(`${PREFIX}_standardDirectiveNumber`, p.directive ?? "");
  u.set(`${PREFIX}_standardIntroducted`, p.introduction ?? "");
  u.set(`${PREFIX}_standardKt`, p.technical_committee ?? "");
  u.set(`${PREFIX}_standardSector`, p.sector ?? "");
  u.set(`${PREFIX}_standardLanguage`, p.language);
  u.set(`${PREFIX}_standardActual`, p.status);
  u.set(`${PREFIX}_standardRowsOnPage`, p.rows_on_page);
  return u.toString();
}

function postSearchUrl(token: string): string {
  const q = new URLSearchParams({
    p_auth: token,
    p_p_id: PORTLET_ID,
    p_p_lifecycle: "1",
    p_p_state: "normal",
    p_p_mode: "view",
    p_p_col_id: "column-1",
    p_p_col_pos: "1",
    p_p_col_count: "2",
    [`${PREFIX}_javax.portlet.action`]: "searchStandardsAction",
  });
  return `${WIEDZA_ORIGIN}/wyszukiwarka-norm?${q}`;
}

function getStandardUrl(token: string, standardNumber: string): string {
  const q = new URLSearchParams({
    p_auth: token,
    p_p_id: PORTLET_ID,
    p_p_lifecycle: "1",
    p_p_state: "normal",
    p_p_mode: "view",
    p_p_col_id: "column-1",
    p_p_col_pos: "1",
    p_p_col_count: "2",
    [`${PREFIX}_standardNumber`]: standardNumber,
    [`${PREFIX}_javax.portlet.action`]: "showStandardDetailsAction",
  });
  return `${WIEDZA_ORIGIN}/wyszukiwarka-norm?${q}`;
}

const wiedzaSearchFields = {
  locale: z
    .enum(["pl", "en", "ru"])
    .default("pl")
    .describe("Język strony wyszukiwarki (ścieżka Liferay: pl / en / ru)."),
  standard_number: z.string().optional().describe("Numer normy (np. PN-EN ISO 9001)."),
  title: z.string().optional().describe("Tytuł normy (język polski)."),
  title_english: z.string().optional().describe("Tytuł w języku angielskim."),
  content: z.string().optional().describe("Fragment treści normy (wyszukiwanie)."),
  ics: z.string().optional().describe("Klasyfikacja ICS."),
  sector: z.string().optional().describe("Sektor normalizacji."),
  technical_committee: z.string().optional().describe("Organ techniczny (KT, np. PKN/KT 40)."),
  directive: z.string().optional().describe("Numer dyrektywy (np. 2009/48/EC)."),
  introduction: z.string().optional().describe("Norma wprowadzająca (np. EN ISO 9001)."),
  publish_from: z.string().optional().describe("Data publikacji od (YYYY-MM-DD)."),
  publish_to: z.string().optional().describe("Data publikacji do (YYYY-MM-DD)."),
  withdrawal_from: z.string().optional().describe("Data wycofania od (YYYY-MM-DD)."),
  withdrawal_to: z.string().optional().describe("Data wycofania do (YYYY-MM-DD)."),
  title_match: z
    .enum(["words", "phrase"])
    .default("words")
    .describe("Sposób dopasowania tytułu: words — słowa; phrase — fraza."),
  language: z
    .enum(["ALL", "P", "E", "D", "F"])
    .default("ALL")
    .describe("Wersja językowa: ALL — wszystkie; P — polska; E — angielska; D — niemiecka; F — francuska."),
  status: z
    .enum(["all", "standard-actual", "standard-withdrawal"])
    .default("all")
    .describe("Status: all; standard-actual — aktualne; standard-withdrawal — wycofane."),
  rows_on_page: z
    .enum(["20", "30", "50", "75"])
    .default("50")
    .describe("Liczba wierszy na stronie wyników."),
};

const wiedzaSearchSchema = z.object(wiedzaSearchFields).refine(
  (d) => {
    const textFields = [
      d.standard_number,
      d.title,
      d.title_english,
      d.content,
      d.ics,
      d.sector,
      d.technical_committee,
      d.directive,
      d.introduction,
    ];
    const hasText = textFields.some((s) => typeof s === "string" && s.trim().length > 0);
    const dateFields = [d.publish_from, d.publish_to, d.withdrawal_from, d.withdrawal_to];
    const hasDate = dateFields.some((s) => typeof s === "string" && s.trim().length > 0);
    return hasText || hasDate;
  },
  {
    message:
      "Podaj co najmniej jedno kryterium: numer/tytuł/treść/ICS/sektor/KT/dyrektywa/wprowadzenie lub zakres dat.",
  },
);

export function registerWiedzaTools(server: McpServer, _env: Env): void {
  server.tool(
    "wiedza_search_norms",
    [
      "Wyszukiwarka norm na portalu WIEDZA (wiedza.pkn.pl) — Liferay, odpowiedź to surowy HTML z listą wyników.",
      "Wymaga dwóch żądań (sesja + POST); nie używa KV cache.",
      "Użyj dokładnego numeru normy z wyniku w wiedza_get_standard.",
    ].join(" "),
    wiedzaSearchFields,
    async (raw) => {
      const parseResult = wiedzaSearchSchema.safeParse(raw);
      if (!parseResult.success) {
        const msg = parseResult.error.issues.map((i) => i.message).join("; ");
        return {
          content: [{ type: "text", text: `Error calling wiedza_search_norms: ${msg}` }],
          isError: true,
        };
      }
      const args = parseResult.data;
      return withToolExecutionSpan(
        {
          toolName: "wiedza_search_norms",
          params: args as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(
            [
              args.standard_number,
              args.title,
              args.title_english,
              args.content,
              args.ics,
            ]
              .filter(Boolean)
              .join(" "),
          ),
        },
        async (span) => {
          span.setAttribute("mcp.source", "wiedza-pkn");
          try {
            const { html, cookieHeader, landingPath } = await fetchLandingSession(args.locale);
            if (!cookieHeader) {
              throw new Error("Serwer nie zwrócił ciasteczek sesji (Set-Cookie) — wyszukiwanie Liferay nie zadziała.");
            }
            const token = parseAuthToken(html);
            const formDate = parseFormDate(html);
            if (!token || !formDate) {
              throw new Error("Nie znaleziono tokenu Liferay ani formDate w HTML strony wyszukiwarki.");
            }
            const body = buildSearchBody(formDate, args);
            const postUrl = postSearchUrl(token);
            const res = await fetch(postUrl, {
              method: "POST",
              headers: {
                Accept: "text/html",
                "Content-Type": "application/x-www-form-urlencoded",
                Cookie: cookieHeader,
                Referer: `${WIEDZA_ORIGIN}${landingPath}`,
                "User-Agent": DEFAULT_UA,
              },
              body,
            });
            if (!res.ok) {
              throw new Error(`HTTP ${res.status} ${res.statusText} — wyszukiwanie norm`);
            }
            const out = await res.text();
            return { content: [{ type: "text", text: out }] };
          } catch (err) {
            const msg = toToolErrorText(err);
            return {
              content: [{ type: "text", text: `Error calling wiedza_search_norms: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "wiedza_get_standard",
    [
      "Pobiera stronę szczegółów pojedynczej normy na WIEDZA po dokładnym numerze katalogowym (jak w linku z wyników wyszukiwania).",
      "Zwraca surowy HTML. Wymaga sesji; nie używa KV cache.",
    ].join(" "),
    {
      standard_number: z
        .string()
        .min(1)
        .describe(
          'Dokładny numer normy z wyniku wyszukiwania, np. "PN-EN ISO 9001:2015-10F" (zwykle z sufiksem wersji).',
        ),
      locale: z
        .enum(["pl", "en", "ru"])
        .default("pl")
        .describe("Język strony referera (sesja z tej samej ścieżki co wyszukiwarka)."),
    },
    async ({ standard_number, locale }) => {
      return withToolExecutionSpan(
        {
          toolName: "wiedza_get_standard",
          params: { standard_number, locale } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(standard_number),
        },
        async (span) => {
          span.setAttribute("mcp.source", "wiedza-pkn");
          try {
            const { html, cookieHeader, landingPath } = await fetchLandingSession(locale);
            if (!cookieHeader) {
              throw new Error("Serwer nie zwrócił ciasteczek sesji (Set-Cookie).");
            }
            const token = parseAuthToken(html);
            if (!token) {
              throw new Error("Nie znaleziono tokenu Liferay w HTML.");
            }
            const url = getStandardUrl(token, standard_number);
            const res = await fetch(url, {
              redirect: "follow",
              headers: {
                Accept: "text/html",
                Cookie: cookieHeader,
                Referer: `${WIEDZA_ORIGIN}${landingPath}`,
                "User-Agent": DEFAULT_UA,
              },
            });
            if (!res.ok) {
              throw new Error(`HTTP ${res.status} ${res.statusText} — szczegóły normy`);
            }
            const out = await res.text();
            return { content: [{ type: "text", text: out }] };
          } catch (err) {
            const msg = toToolErrorText(err);
            return {
              content: [{ type: "text", text: `Error calling wiedza_get_standard: ${msg}` }],
              isError: true,
            };
          }
        },
      );
    },
  );
}
