import { toToolErrorText } from "../tool-error-handling.js";
/**
 * POL-on public registry data via RAD-on Open Data API (no API key).
 * Base: https://radon.nauka.gov.pl/opendata/polon
 * Catalog: https://radon.nauka.gov.pl/pomoc/knowledge-base/katalog-udostepnianych-danych-api/
 *
 * Tool:
 *   polon_search — paginated JSON from one of the main POL-on datasets, with optional filters.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const API_BASE = "https://radon.nauka.gov.pl/opendata/polon";
const JSON_HEADERS = { Accept: "application/json" };
const CACHE_TTL = 86_400;

const RESOURCE_SEGMENTS = {
  institutions: "institutions",
  employees: "employees",
  projects: "projects",
  publications: "publications",
  courses: "courses",
  branches: "branches",
} as const;

type ResourceKey = keyof typeof RESOURCE_SEGMENTS;

function buildPolonUrl(
  resource: ResourceKey,
  args: {
    result_numbers: number;
    page_token?: string;
    city?: string;
    voivodeship?: string;
    institution_name?: string;
    first_name?: string;
    last_name?: string;
    discipline_name?: string;
    project_title_pl?: string;
    project_title_en?: string;
    project_number?: string;
    keywords?: string;
    publication_title?: string;
    course_name?: string;
  },
): string {
  const segment = RESOURCE_SEGMENTS[resource];
  const q = new URLSearchParams();
  q.set("resultNumbers", String(args.result_numbers));
  if (args.page_token) q.set("token", args.page_token);

  const set = (key: string, value: string | undefined): void => {
    if (value !== undefined && value !== "") q.set(key, value);
  };

  switch (resource) {
    case "institutions":
      set("city", args.city);
      set("voivodeship", args.voivodeship);
      set("name", args.institution_name);
      break;
    case "branches":
      set("city", args.city);
      set("voivodeship", args.voivodeship);
      break;
    case "employees":
      set("firstName", args.first_name);
      set("lastName", args.last_name);
      set("disciplineName", args.discipline_name);
      break;
    case "projects":
      set("projectTitlePl", args.project_title_pl);
      set("projectTitleEn", args.project_title_en);
      set("projectNumber", args.project_number);
      set("keywords", args.keywords);
      break;
    case "publications":
      set("title", args.publication_title);
      set("lastName", args.last_name);
      break;
    case "courses":
      set("courseName", args.course_name);
      break;
  }

  return `${API_BASE}/${segment}?${q}`;
}

export function registerPolonTools(server: McpServer, env: Env): void {
  server.tool(
    "polon_search",
    [
      "Query Polish POL-on registry data exposed by RAD-on Open Data API (same data as polon.nauka.gov.pl / radon.nauka.gov.pl/dane).",
      "No API key. Returns raw JSON: results[], pagination.maxCount, pagination.token (pass token as page_token for next page).",
      "Resources: institutions (higher-ed & science units), branches, employees (academic staff; supports first_name, last_name, discipline_name),",
      "projects (project_title_pl/en, project_number, keywords), publications PBN (publication_title, last_name as author surname), courses (course_name).",
      "Optional city/voivodeship apply to institutions and branches. Use accurate Polish strings; API matching is server-side.",
    ].join(" "),
    {
      resource: z
        .enum(["institutions", "employees", "projects", "publications", "courses", "branches"])
        .describe("POL-on dataset to query"),
      result_numbers: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Rozmiar strony (resultNumbers); maks. 100 na żądanie"),
      page_token: z
        .string()
        .optional()
        .describe("Token paginacji z poprzedniej odpowiedzi (pole pagination.token)"),
      city: z
        .string()
        .optional()
        .describe("Filtr: miasto — używaj dla instytucji lub oddziałów (UTF-8, np. Kraków)"),
      voivodeship: z
        .string()
        .optional()
        .describe("Filtr: nazwa polskiego województwa — instytucje lub oddziały"),
      institution_name: z
        .string()
        .optional()
        .describe("Filtr: fragment nazwy instytucji — tylko instytucje"),
      first_name: z.string().optional().describe("Filtr: imię pracownika — tylko pracownicy"),
      last_name: z
        .string()
        .optional()
        .describe(
          "Filtr: nazwisko — pracownicy (firstName + lastName) lub publikacje (nazwisko autora)",
        ),
      discipline_name: z
        .string()
        .optional()
        .describe("Filtr: nazwa dyscypliny naukowej — tylko pracownicy (np. astronomia)"),
      project_title_pl: z
        .string()
        .optional()
        .describe("Filtr: polski tytuł projektu — tylko projekty"),
      project_title_en: z
        .string()
        .optional()
        .describe("Filtr: angielski tytuł projektu — tylko projekty"),
      project_number: z
        .string()
        .optional()
        .describe("Filtr: numer grantu lub projektu — tylko projekty"),
      keywords: z.string().optional().describe("Filtr: słowa kluczowe projektu — tylko projekty"),
      publication_title: z
        .string()
        .optional()
        .describe("Filtr: fragment tytułu publikacji — tylko publikacje"),
      course_name: z.string().optional().describe("Filtr: nazwa kierunku studiów — tylko kierunki"),
    },
    async (params) => {
      const {
        resource,
        result_numbers,
        page_token,
        city,
        voivodeship,
        institution_name,
        first_name,
        last_name,
        discipline_name,
        project_title_pl,
        project_title_en,
        project_number,
        keywords,
        publication_title,
        course_name,
      } = params;

      return (async () => {
        try {
          const url = buildPolonUrl(resource, {
            result_numbers,
            page_token,
            city,
            voivodeship,
            institution_name,
            first_name,
            last_name,
            discipline_name,
            project_title_pl,
            project_title_en,
            project_number,
            keywords,
            publication_title,
            course_name,
          });
          const cacheKey = makeCacheKey("polon_search", params as Record<string, unknown>);
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: JSON_HEADERS },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling polon_search: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );
}
