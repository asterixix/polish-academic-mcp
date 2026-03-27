/**
 * Ludzie Nauki (ludzie.nauka.gov.pl) â€” publiczny rejestr profili naukowcĂłw (OPI / POLON).
 * SPA pod /ln/; REST: /api/profiles-api (bez klucza API).
 *
 * Tools:
 *   ludzie_search          â€” lista profili (paginacja, filtry nazwiskowe, dziedzina).
 *   ludzie_semantic_search â€” wyszukiwanie semantyczne (peĹ‚na fraza).
 *   ludzie_get_scientist   â€” ORCID, stopnie/tytuĹ‚y, sĹ‚owa kluczowe + link do profilu.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { withToolExecutionSpan, estimateTokens } from "../tracing.js";

const API_BASE = "https://ludzie.nauka.gov.pl/api/profiles-api";
const PROFILE_URL = "https://ludzie.nauka.gov.pl/ln/profile";
const JSON_HEADERS = { Accept: "application/json" };
const CACHE_TTL = 3_600; // 1 h â€” rejestr bywa aktualizowany

const API_FIELDS = ["name", "institution", "discipline", "title", "orcid", "keywords"];

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
      "Search scientist profiles in Ludzie Nauki (ludzie.nauka.gov.pl), Poland's public researcher registry.",
      "Structured search with pagination (0-based page). Filter by surname, optional first name, optional scientific domain code (e.g. DZ0106N).",
      "Omit name filters to browse ordered results (large totalHits).",
      "Response includes profileId for ludzie_get_scientist and public profile URLs under /ln/profile/{id}.",
    ].join(" "),
    {
      surname: z
        .string()
        .optional()
        .describe("Last name filter (partial match). Omit surname and first_name to browse the registry alphabetically."),
      first_name: z.string().optional().describe("First name filter (optional, use with or without surname)."),
      domain_code: z
        .string()
        .optional()
        .describe(
          "Scientific domain code from Polish classification, e.g. DZ0106N (exact sciences), DZ0105N (social sciences).",
        ),
      page: z.number().int().min(0).default(0).describe("Page number â€” 0-based"),
      size: z.number().int().min(1).max(50).default(10).describe("Results per page (1â€“50)"),
      include_deceased: z
        .boolean()
        .default(false)
        .describe("When true, pass withTheDead=true to include posthumous profiles."),
    },
    async ({ surname, first_name, domain_code, page, size, include_deceased }) => {
      return withToolExecutionSpan(
        {
          toolName: "ludzie_search",
          params: {
            surname,
            first_name,
            domain_code,
            page,
            size,
            include_deceased,
          } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens([surname, first_name, domain_code].filter(Boolean).join(" ")),
        },
        async (span) => {
          span.setAttribute("mcp.source", "ludzie-nauki");
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
                  text: `Error ludzie_search: ${e instanceof Error ? e.message : String(e)}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "ludzie_semantic_search",
    [
      "Semantic / full-text-style search of Ludzie Nauki profiles (ludzie.nauka.gov.pl).",
      "Use for research topics, keywords, or natural-language queries (not only surnames).",
      "Returns a ranked list of profiles with profileId (for ludzie_get_scientist) and profile URLs.",
      "Large responses are truncated in the summary â€” narrow full_query if you need exhaustive lists.",
    ].join(" "),
    {
      full_query: z
        .string()
        .describe("Search phrase (Polish or English), e.g. machine learning, bioinformatyka."),
      include_deceased: z
        .boolean()
        .default(false)
        .describe("When true, include profiles marked as deceased."),
      max_profiles: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(40)
        .describe("Maximum profiles to include in the compact summary (API may return more)."),
    },
    async ({ full_query, include_deceased, max_profiles }) => {
      return withToolExecutionSpan(
        {
          toolName: "ludzie_semantic_search",
          params: { full_query, include_deceased, max_profiles } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(full_query),
        },
        async (span) => {
          span.setAttribute("mcp.source", "ludzie-nauki");
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
                  text: `Error ludzie_semantic_search: ${e instanceof Error ? e.message : String(e)}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
  );

  server.tool(
    "ludzie_get_scientist",
    [
      "Fetch public detail for one Ludzie Nauki profile: ORCID, academic degrees/titles (POLON), and top keywords.",
      "profile_id is the profileId field from ludzie_search or ludzie_semantic_search.",
      "Returns a compact JSON object; see profileUrl for the human-readable page.",
    ].join(" "),
    {
      profile_id: z
        .string()
        .describe("Profile id from ludzie_search / ludzie_semantic_search (e.g. jhMVc1vG5Yz)."),
    },
    async ({ profile_id }) => {
      return withToolExecutionSpan(
        {
          toolName: "ludzie_get_scientist",
          params: { profile_id } as Record<string, unknown>,
          fieldsRequested: API_FIELDS,
          fieldsReturned: API_FIELDS,
          tokensByField: {},
          queryTokens: estimateTokens(profile_id),
        },
        async (span) => {
          span.setAttribute("mcp.source", "ludzie-nauki");
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
                  text: `Error ludzie_get_scientist: ${e instanceof Error ? e.message : String(e)}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
  );
}
