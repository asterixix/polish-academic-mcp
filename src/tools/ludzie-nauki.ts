import { toToolErrorText } from "../tool-error-handling.js";
/**
 * Ludzie Nauki (ludzie.nauka.gov.pl) — publiczny rejestr profili naukowców (OPI / POLON).
 * SPA pod /ln/; REST: /api/profiles-api (bez klucza API).
 *
 * Tools:
 *   ludzie_search          — lista profili (paginacja, filtry nazwiskowe, dziedzina).
 *   ludzie_semantic_search — wyszukiwanie semantyczne (pełna fraza).
 *   ludzie_get_scientist   — ORCID, stopnie/tytuły, słowa kluczowe + link do profilu.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const API_BASE = "https://ludzie.nauka.gov.pl/api/profiles-api";
const PROFILE_URL = "https://ludzie.nauka.gov.pl/ln/profile";
const JSON_HEADERS = { Accept: "application/json" };
const CACHE_TTL = 3_600; // 1 h — rejestr bywa aktualizowany

/* eslint-disable @typescript-eslint/no-explicit-any */
function displayName(p: any): string {
  const parts = [p?.title, p?.firstName, p?.secondName, p?.surname].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function summarizeScientistSearch(raw: string): string {
  try {
    const json = JSON.parse(raw);
    const page = json?.page;
    const content: any[] = page?.content ?? [];
    const profiles = content.map((p) => ({
      profileId: p.profileId as string,
      name: displayName(p) || undefined,
      institution: p.calculatedInstitutionName ?? undefined,
      domainCode: p.domainCode ?? undefined,
      disciplines: p.disciplines,
      dead: p.dead as boolean | undefined,
      url: `${PROFILE_URL}/${p.profileId as string}`,
    }));
    return JSON.stringify(
      {
        totalHits: json.totalHits,
        page: {
          number: page?.pageable?.pageNumber,
          size: page?.pageable?.pageSize,
          totalInResponse: page?.total,
        },
        isSemanticSearchNeeded: json.isSemanticSearchNeeded,
        filterHint: json.filterHint ?? undefined,
        profiles,
      },
      null,
      2,
    );
  } catch {
    return raw;
  }
}

function summarizeSemanticSearch(raw: string, maxItems: number): string {
  try {
    const json = JSON.parse(raw);
    const arr: any[] = json?.profileDataResponses ?? [];
    const slice = arr.slice(0, maxItems);
    const profiles = slice.map((p) => ({
      profileId: p.profileId as string,
      name: displayName(p) || undefined,
      institution: p.calculatedInstitutionName ?? undefined,
      domainCode: p.domainCode ?? undefined,
      disciplines: p.disciplines,
      dead: p.dead as boolean | undefined,
      url: `${PROFILE_URL}/${p.profileId as string}`,
    }));
    return JSON.stringify(
      {
        totalReturned: arr.length,
        showing: profiles.length,
        truncated: arr.length > maxItems,
        profiles,
      },
      null,
      2,
    );
  } catch {
    return raw;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function registerLudzieNaukiTools(server: McpServer, env: Env): void {
  server.tool(
    "ludzie_search",
    [
      "Wyszukiwanie profili naukowców w Ludziach Nauki (ludzie.nauka.gov.pl), polskim publicznym rejestrze badaczy.",
      "Wyszukiwanie strukturalne z paginacją (strony liczone od zera). Filtruj po nazwisku, opcjonalnym imieniu, opcjonalnym kodzie dziedziny naukowej (np. DZ0106N).",
      "Pomiń filtry imion, by przeglądać uporządkowane wyniki (duża wartość totalHits).",
      "Odpowiedź zawiera profileId dla ludzie_get_scientist oraz publiczne adresy profili pod /ln/profile/{id}.",
    ].join(" "),
    {
      surname: z
        .string()
        .optional()
        .describe(
          "Filtr nazwiska (dopasowanie częściowe). Pomiń surname i first_name, by przeglądać rejestr alfabetycznie.",
        ),
      first_name: z
        .string()
        .optional()
        .describe("Filtr imienia (opcjonalny, używaj z nazwiskiem lub bez)."),
      domain_code: z
        .string()
        .optional()
        .describe(
          "Kod dziedziny naukowej z klasyfikacji polskiej, np. DZ0106N (nauki ścisłe), DZ0105N (nauki społeczne).",
        ),
      page: z.number().int().min(0).default(0).describe("Numer strony liczony od zera"),
      size: z.number().int().min(1).max(50).default(10).describe("Liczba wyników na stronę (1–50)"),
      include_deceased: z
        .boolean()
        .default(false)
        .describe("Gdy true, przekazuje withTheDead=true, by uwzględnić profile zmarłych badaczy."),
    },
    async ({ surname, first_name, domain_code, page, size, include_deceased }) => {
      return (async () => {
        try {
          const params = new URLSearchParams({
            page: String(page),
            size: String(size),
            withTheDead: String(include_deceased),
          });
          if (surname) params.set("surname", surname);
          if (first_name) params.set("firstName", first_name);
          if (domain_code) params.set("domainCode", domain_code);

          const url = `${API_BASE}/v1.1/public/profile/scientistSearchData?${params}`;
          const cacheKey = makeCacheKey("ludzie_search", {
            surname,
            first_name,
            domain_code,
            page,
            size,
            include_deceased,
          });
          const data = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text: summarizeScientistSearch(data) }] };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error ludzie_search: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "ludzie_semantic_search",
    [
      "Wyszukiwanie semantyczne / pełnotekstowe profili w Ludziach Nauki (ludzie.nauka.gov.pl).",
      "Używaj dla tematów badawczych, słów kluczowych lub zapytań w języku naturalnym (nie tylko nazwisk).",
      "Zwraca rankingowaną listę profili z profileId (dla ludzie_get_scientist) i adresami URL profili.",
      "Duże odpowiedzi są obcinane w podsumowaniu — zawęź full_query, jeśli potrzebujesz wyczerpującej listy.",
    ].join(" "),
    {
      full_query: z
        .string()
        .describe("Fraza wyszukiwania (polska lub angielska), np. uczenie maszynowe, bioinformatyka."),
      include_deceased: z
        .boolean()
        .default(false)
        .describe("Gdy true, uwzględnia profile oznaczone jako zmarłe."),
      max_profiles: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(40)
        .describe("Maksymalna liczba profili w skróconym podsumowaniu (API może zwrócić więcej)."),
    },
    async ({ full_query, include_deceased, max_profiles }) => {
      return (async () => {
        try {
          const params = new URLSearchParams({
            fullQuery: full_query,
            withTheDead: String(include_deceased),
          });
          const url = `${API_BASE}/v1.0/public/profile/semanticSearchData?${params}`;
          const cacheKey = makeCacheKey("ludzie_semantic", {
            full_query,
            include_deceased,
            max_profiles,
          });
          const data = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            CACHE_TTL,
          );
          return {
            content: [{ type: "text", text: summarizeSemanticSearch(data, max_profiles) }],
          };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error ludzie_semantic_search: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "ludzie_get_scientist",
    [
      "Pobiera publiczne szczegóły jednego profilu Ludzi Nauki: ORCID, stopnie i tytuły naukowe (POLON) oraz najważniejsze słowa kluczowe.",
      "profile_id to pole profileId z ludzie_search lub ludzie_semantic_search.",
      "Zwraca skompaktowany obiekt JSON; profileUrl wskazuje stronę czytelną dla człowieka.",
    ].join(" "),
    {
      profile_id: z
        .string()
        .describe("Identyfikator profilu naukowca z wyników ludzie_search lub ludzie_semantic_search, np. jhMVc1vG5Yz."),
    },
    async ({ profile_id }) => {
      return (async () => {
        try {
          const orcidUrl = `${API_BASE}/v1.0/public/profile/${encodeURIComponent(profile_id)}/orcid`;
          const degreesUrl = `${API_BASE}/v1.0/public/profile/${encodeURIComponent(profile_id)}/degreesAndTitles`;
          const kwUrl = `${API_BASE}/v1.0/public/profile/${encodeURIComponent(profile_id)}/keyWords`;
          const key = (suffix: string) => makeCacheKey(`ludzie_${suffix}`, { profile_id });

          const [orcidRaw, degreesRaw, kwRaw] = await Promise.all([
            cachedFetch(env.CACHE_KV, key("orcid"), orcidUrl, { headers: JSON_HEADERS }, CACHE_TTL),
            cachedFetch(
              env.CACHE_KV,
              key("degrees"),
              degreesUrl,
              { headers: JSON_HEADERS },
              CACHE_TTL,
            ),
            cachedFetch(env.CACHE_KV, key("kw"), kwUrl, { headers: JSON_HEADERS }, CACHE_TTL),
          ]);

          let orcidParsed: unknown;
          let degreesParsed: unknown;
          let keywordsParsed: unknown;
          try {
            orcidParsed = JSON.parse(orcidRaw);
          } catch {
            orcidParsed = orcidRaw;
          }
          try {
            degreesParsed = JSON.parse(degreesRaw);
          } catch {
            degreesParsed = degreesRaw;
          }
          try {
            keywordsParsed = JSON.parse(kwRaw);
          } catch {
            keywordsParsed = kwRaw;
          }

          const text = JSON.stringify(
            {
              profileId: profile_id,
              profileUrl: `${PROFILE_URL}/${profile_id}`,
              orcid: orcidParsed,
              degreesAndTitles: degreesParsed,
              keywords: keywordsParsed,
            },
            null,
            2,
          );
          return { content: [{ type: "text", text }] };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error ludzie_get_scientist: ${toToolErrorText(e)}`,
              },
            ],
            isError: true,
          };
        }
      })();
    },
  );
}
