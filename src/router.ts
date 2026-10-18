import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  SOURCES,
  SOURCE_GROUPS,
  type SourceGroup,
  type SourceId,
} from "./sources.js";
import { normalizeQueryForSource } from "./query-normalize.js";
import { formatAndSliceOutput } from "./extract.js";
import {
  discoverBitstreamsInText,
  type DiscoveredFile,
  fetchAndParseUrl,
  grepExtractedText,
  type ParsedDocument,
} from "./content-fetcher.js";
import { saveDocument } from "./document-store.js";

export async function unreadableDocumentNote(
  parsedDoc: ParsedDocument,
  saveDocuments: boolean,
): Promise<string | undefined> {
  if (!parsedDoc.metadata.needsFile || !parsedDoc.raw) return undefined;
  if (!saveDocuments) {
    return `Dokument nie jest czytany przez serwer (brak OCR). Pobierz go i odczytaj lokalnie: ${parsedDoc.url}`;
  }
  try {
    const saved = await saveDocument(parsedDoc.raw, new URL(parsedDoc.url).pathname.split("/").pop() ?? "document");
    return `Plik zapisany: ${saved.path} (${parsedDoc.contentType || "application/octet-stream"}, ${saved.bytes} B). Odczytaj go lokalnym narzędziem GenAI.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Nie udało się zapisać dokumentu lokalnie: ${msg}`;
  }
}

export type ToolCallContent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      data: string;
      mimeType: string;
    };

export interface ToolCallResult {
  content: ToolCallContent[];
  isError?: boolean;
  [key: string]: unknown;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolCallResult>;

export interface CapturedTool {
  name: string;
  sourceId: SourceId;
  group: SourceGroup;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: ToolHandler;
}

const PRIMARY_SEARCH_TOOL_BY_SOURCE: Partial<Record<SourceId, string>> = {
  bn: "bn_search_publications",
  ruj: "ruj_search",
  agh: "agh_search",
  amu: "amu_search",
  uafm: "uafm_search",
  icm: "icm_search",
  rodbuk: "rodbuk_search",
  repod: "repod_search",
  dane: "dane_search",
  polon: "polon_search",
  pbn: "pbn_search_publications",
  bdl: "bdl_search_variables",
  imgw: "imgw_synop",
  pkn: "pkn_search",
  wiedza: "wiedza_search_norms",
  blz: "blz_search",
  baztol: "baztol_search",
  nac: "nac_site_search",
  sum: "sum_aleph_find",
  ppm: "ppm_search",
  ludzie: "ludzie_search",
  pauart: "pauart_search",
  isap: "isap_search_acts",
  bs_sejm: "bs_sejm_search",
  saos: "saos_search_judgments",
  wolnelektury: "wolnelektury_filter_books",
  ninateka: "ninateka_search",
  gapla: "gapla_search",
  fototeka: "fototeka_search",
  filmpolski: "filmpolski_search",
  fototekaslaska: "fototekaslaska_search",
  fn_repo: "fn_repo_search",
  rcin: "rcin_search",
  dokumenty_slaska: "dokumenty_slaska_medieval_catalog",
  jbc: "jbc_search",
  sbc: "sbc_search",
  fbc: "fbc_search",
  pbm: "pbm_search",
  swa: "swa_search",
  gwa: "gwa_search",
  plock_genea: "plock_genea_search",
  ekartoteka: "ekartoteka_search",
  archiwum_powstania: "archiwum_powstania_search",
  warszawa_ap: "warszawa_ap_search",
  zamosc_ap: "zamosc_ap_search",
  archiwa_jency: "archiwa_jency_search",
  archiwa_dziedzictwo: "archiwa_dziedzictwo_search",
  straty: "straty_search",
  agad: "agad_search",
  postdiploma: "postdiploma_search",
  lublin_ap: "lublin_ap_search",
  opole_ap: "opole_ap_search",
  piotrkow_ap: "piotrkow_ap_search",
  krakow_od: "krakow_od_search",
  krakow_msip: "krakow_msip_search",
  krakow_strategia: "krakow_strategia_search",
};

const PRIMARY_GET_TOOL_BY_SOURCE: Partial<Record<SourceId, string>> = {
  bn: "bn_get_article",
  ruj: "ruj_get_item",
  agh: "agh_get_item",
  amu: "amu_get_item",
  uafm: "uafm_get_item",
  icm: "icm_get_item",
  repod: "repod_get_dataset",
  dane: "dane_get_dataset",
  pbn: "pbn_get_publication",
  bdl: "bdl_get_variable",
  wiedza: "wiedza_get_standard",
  blz: "blz_get_listing",
  baztol: "baztol_get_resource",
  nac: "nac_get_post",
  sum: "sum_aleph_present",
  ppm: "ppm_get_record",
  ludzie: "ludzie_get_scientist",
  pauart: "pauart_get_artwork",
  isap: "isap_get_act",
  bs_sejm: "bs_sejm_get_item",
  saos: "saos_get_judgment",
  wolnelektury: "wolnelektury_get_book",
  ninateka: "ninateka_get_vod",
  gapla: "gapla_get_poster",
  fototeka: "fototeka_get_photo",
  filmpolski: "filmpolski_get_item",
  fototekaslaska: "fototekaslaska_get_photo",
  fn_repo: "fn_repo_get_node",
  rcin: "rcin_get_record",
  dokumenty_slaska: "dokumenty_slaska_get_page",
  jbc: "jbc_get_publication",
  sbc: "sbc_get_publication",
  fbc: "fbc_get_record",
  pbm: "pbm_get_item",
  swa: "swa_get_unit",
  archiwum_powstania: "archiwum_powstania_get_record",
  archiwa_jency: "archiwa_jency_get_record",
  archiwa_dziedzictwo: "archiwa_dziedzictwo_get_record",
  straty: "straty_get_person",
  krakow_od: "krakow_od_get_dataset",
  krakow_msip: "krakow_msip_get_dataset",
  krakow_strategia: "krakow_strategia_get_article",
};

/**
 * Sources excluded from automatic category-wide fan-out when only a text `query`
 * is provided (e.g. requires auth tokens if missing, or OAI-PMH date-only harvester,
 * or 12.7MB cold XLSX download unless requested). They can still be queried explicitly via `sources` or `operation`.
 */
const SKIP_CATEGORY_FANOUT_WITHOUT_EXPLICIT: ReadonlySet<SourceId> = new Set<SourceId>([
  "uafm", // upstream eRIKA returns HTTP 404
  "rcin", // OAI-PMH ListRecords without full-text keyword search
  "dokumenty_slaska", // static page/catalog fetch without keyword query
  "plock_genea", // 12.7MB GENEA.xlsx download on first cold call — query explicitly via sources=['plock_genea']
  "imgw", // synop/hydro zwraca wszystkie stacje pogodowe — zaśmieca fan-out kategorii dane; wołaj sources=['imgw']
]);

const QUERY_PARAM_CANDIDATES = [
  "query",
  "q",
  "title",
  "all",
  "search",
  "phrase",
  "name",
  "lastname",
  "nazwisko",
  "keywords",
  "keyword",
  "request",
  "term",
  "text",
  "station",
  "author_slug",
] as const;

const LIMIT_PARAM_CANDIDATES = [
  "page_size",
  "size",
  "per_page",
  "rows",
  "limit",
  "count",
] as const;

const ID_PARAM_CANDIDATES = [
  "id",
  "uuid",
  "article_id",
  "publication_id",
  "record_id",
  "item_id",
  "dataset_id",
  "eli",
  "judgment_id",
  "standard_number",
  "slug",
  "node_id",
  "photo_id",
  "poster_id",
  "artwork_id",
  "scientist_id",
  "profile_id",
  "resource_id",
  "listing_id",
  "post_id",
  "page_id",
  "vod_id",
  "path",
  "variable_id",
  "unit_id",
  "identifier",
  "set_no",
] as const;

function slugifyPolish(input: string): string {
  const map: Record<string, string> = {
    ą: "a",
    ć: "c",
    ę: "e",
    ł: "l",
    ń: "n",
    ó: "o",
    ś: "s",
    ź: "z",
    ż: "z",
  };
  return input
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => map[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSearchArgs(
  tool: CapturedTool,
  query: string | undefined,
  limitPerSource: number,
  extraFilters: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...extraFilters };
  const schemaKeys = Object.keys(tool.schema);

  if (query && query.trim().length > 0) {
    const trimmed = query.trim();
    // Universal cleanup for every source (strip DB names, conversational fluff, years→filters)
    const { query: cleaned, filters: dateFilters } = normalizeQueryForSource(
      trimmed,
      tool.sourceId,
      schemaKeys,
    );
    for (const [k, v] of Object.entries(dateFilters)) {
      if (!(k in raw)) raw[k] = v;
    }

    const hasExplicitQueryField = QUERY_PARAM_CANDIDATES.some((k) => k in raw);
    if (!hasExplicitQueryField) {
      if (tool.name === "sum_aleph_find" && !cleaned.includes("=")) {
        raw.request = `wrd=${cleaned}`;
      } else if (tool.name === "wolnelektury_filter_books") {
        raw.author_slug = slugifyPolish(cleaned);
      } else if (schemaKeys.includes("surname") && schemaKeys.includes("first_name")) {
        const parts = cleaned.split(/\s+/);
        if (parts.length >= 2) {
          raw.first_name = parts.slice(0, -1).join(" ");
          raw.surname = parts.at(-1);
        } else {
          raw.surname = cleaned;
        }
      } else if (schemaKeys.includes("full_query")) {
        raw.full_query = cleaned;
      } else if (schemaKeys.includes("surname")) {
        raw.surname = cleaned;
      } else {
        for (const candidate of QUERY_PARAM_CANDIDATES) {
          if (schemaKeys.includes(candidate)) {
            raw[candidate] = cleaned;
            break;
          }
        }
      }
    }
  }

  for (const limitKey of LIMIT_PARAM_CANDIDATES) {
    if (schemaKeys.includes(limitKey) && !(limitKey in raw)) {
      // SAOS requires page_size >= 10
      raw[limitKey] =
        tool.sourceId === "saos" && limitKey === "page_size"
          ? Math.max(10, limitPerSource)
          : limitPerSource;
      break;
    }
  }

  const parsed = z.object(tool.schema).safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  // shortcut: pola z błędem zostają surowe, reszta dostaje domyślne wartości Zod (page, lang); pełna walidacja tylko w handlerze narzędzia
  const out: Record<string, unknown> = { ...raw };
  for (const [key, field] of Object.entries(tool.schema)) {
    const res = (field as z.ZodTypeAny).safeParse(raw[key]);
    if (res.success) out[key] = res.data;
  }
  return out;
}

function coerceFieldValue(schemaField: z.ZodTypeAny | undefined, val: string): unknown {
  if (!schemaField) return val;
  const num = Number(val);
  if (Number.isFinite(num) && val.trim() !== "") {
    const numCheck = schemaField.safeParse(num);
    if (numCheck.success) return numCheck.data;
  }
  return val;
}

function buildGetRecordArgs(
  tool: CapturedTool,
  recordId: string | undefined,
  extraParams: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...extraParams };
  const schemaKeys = Object.keys(tool.schema);

  if (recordId && recordId.trim().length > 0) {
    const trimmed = recordId.trim();
    const hasIdAlready = ID_PARAM_CANDIDATES.some((k) => k in raw);
    if (!hasIdAlready) {
      if (tool.name === "isap_get_act") {
        const schemaHasSplit =
          schemaKeys.includes("publisher") &&
          schemaKeys.includes("year") &&
          schemaKeys.includes("position");
        if (schemaHasSplit && !("publisher" in raw && "year" in raw && "position" in raw)) {
          const parts = trimmed.split("/").filter(Boolean);
          if (parts.length === 3 && (parts[0] === "DU" || parts[0] === "MP")) {
            raw.publisher = parts[0];
            raw.year = Number(parts[1]);
            raw.position = Number(parts[2]);
          } else if (schemaKeys.includes("eli")) {
            raw.eli = trimmed;
          }
        } else if (schemaKeys.includes("eli")) {
          raw.eli = trimmed;
        }
      } else {
        let matchedKey: string | undefined;
        for (const candidate of ID_PARAM_CANDIDATES) {
          if (schemaKeys.includes(candidate)) {
            matchedKey = candidate;
            break;
          }
        }
        if (!matchedKey && schemaKeys.length === 1) {
          matchedKey = schemaKeys[0];
        }
        if (matchedKey) {
          raw[matchedKey] = coerceFieldValue(tool.schema[matchedKey], trimmed);
        }
      }
    }
  }

  const parsed = z.object(tool.schema).safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  return raw;
}

export interface DeepenCandidate {
  source: string;
  id: string;
  label?: string;
}

/**
 * Wyciąga z surowej odpowiedzi JSON narzędzia kandydatów do pogłębienia przez
 * get_record (source + id + etykieta). Działa na nieprzetworzonym tekście,
 * zanim router utnie odpowiedź do budżetu znaków.
 */
const NON_RECORD_KEYS = new Set(["category", "categories", "institution", "relationships"]);

export function extractDeepenCandidates(sourceId: string, rawText: string, limit = 8): DeepenCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return [];
  }
  const out: DeepenCandidate[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > 6 || node == null || out.length >= limit) return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 40)) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    let id: string | undefined;
    if (typeof o.get_record === "string" && o.get_record.includes(":")) {
      id = o.get_record.slice(o.get_record.indexOf(":") + 1);
    } else {
      const rawId = o.id ?? o.slug ?? o.dataset_id ?? o.record_id ?? (sourceId === "ruj" ? o.uuid : undefined);
      if (typeof rawId === "string" || typeof rawId === "number") id = String(rawId);
    }
    // Identyfikatory UUID nie są kluczami get_record dla MSIP (dataset_id jest liczbą).
    if (id && sourceId === "krakow_msip" && !/^\d+$/.test(id)) id = undefined;
    if (id && id.trim().length > 0) {
      const key = `${sourceId}:${id}`;
      if (!seen.has(key)) {
        seen.add(key);
        const label = o.title ?? o.name ?? o.slug;
        out.push({ source: sourceId, id, ...(typeof label === "string" ? { label: label.slice(0, 120) } : {}) });
      }
    }
    for (const [k, v] of Object.entries(o)) {
      // shortcut: pomija znane klucze relacji (kategorie, instytucje), żeby nie brać ich ID za rekordy; inne zagnieżdżone obiekty nadal są przeszukiwane, upgrade: mapowanie per-źródło
      if (NON_RECORD_KEYS.has(k)) continue;
      if (typeof v === "object") walk(v, depth + 1);
    }
  };
  walk(parsed, 0);
  return out;
}

export function formatDeepenFooter(candidates: DeepenCandidate[]): string {
  if (candidates.length === 0) return "";
  return [
    "=== REKORDY DO POGŁĘBIENIA (wywołaj get_record z parametrami source oraz id, aby pobrać pełne dane liczbowe rekordu) ===",
    ...candidates.map((c) => `- ${c.source}:${c.id}${c.label ? ` — ${c.label}` : ""}`),
  ].join("\n");
}

function describeToolSchema(schema: Record<string, z.ZodTypeAny>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, field] of Object.entries(schema)) {
    const isOpt = field.isOptional();
    const desc = field.description ?? "";
    out[key] = `${isOpt ? "(opcjonalny) " : "(wymagany) "}${desc}`.trim();
  }
  return out;
}

const CATEGORY_KEYS = ["nauka", "dane", "prawo", "normy", "kultura"] as const satisfies readonly SourceGroup[];

const ROUTER_READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function registerRouterTools(
  server: McpServer,
  capturedTools: Map<string, CapturedTool>,
  enabledSources: ReadonlySet<SourceId>,
  hasPbnCredentials: boolean,
  saveDocuments = true,
): void {
  const toolsBySource = new Map<SourceId, CapturedTool[]>();
  for (const tool of capturedTools.values()) {
    const list = toolsBySource.get(tool.sourceId) ?? [];
    list.push(tool);
    toolsBySource.set(tool.sourceId, list);
  }

  // ---------------------------------------------------------------------------
  // 1. list_sources
  // ---------------------------------------------------------------------------
  server.tool(
    "list_sources",
    [
      "Wyświetla katalog 55 dostępnych polskich baz naukowych, prawnych, statystycznych, normalizacyjnych i kulturalnych (operacja tylko do odczytu — read-only).",
      "Pozwala sprawdzić identyfikatory źródeł, podział na kategorie tematyczne (nauka, dane, prawo, normy, kultura) oraz szczegółowe operacje i schematy parametrów każdej bazy przed wywołaniem wyszukiwania (search) lub pobrania rekordu (get_record).",
      "Dokumentacja API konektora i docelowych interfejsów API (Target API Docs): https://pamcp.pl/connectors oraz https://pamcp.pl/openapi.json.",
    ].join(" "),
    {
      category: z
        .enum(CATEGORY_KEYS)
        .optional()
        .describe(
          "Kategoria tematyczna źródeł do wyświetlenia: nauka, dane, prawo, normy lub kultura.",
        ),
      source: z
        .string()
        .optional()
        .describe(
          "Identyfikator pojedynczego źródła (np. ruj, bn, isap, saos, bdl, ppm), dla którego mają zostać zwrócone dokładne schematy parametrów wszystkich operacji.",
        ),
      include_operations: z
        .boolean()
        .default(false)
        .describe(
          "Czy dołączyć pełną listę operacji natywnych wraz z opisami ich parametrów dla każdego źródła.",
        ),
    },
    {
      title: "Katalog źródeł i operacji — Polish Academic",
      ...ROUTER_READ_ONLY_ANNOTATIONS,
    },
    async ({ category, source, include_operations }) => {
      const selectedSources = SOURCES.filter((s) => {
        if (!enabledSources.has(s.id)) return false;
        if (category && s.group !== category) return false;
        if (source && s.id !== source.trim()) return false;
        return true;
      });

      if (selectedSources.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Brak źródeł spełniających podane kryteria (category=${category ?? "wszystkie"}, source=${source ?? "wszystkie"}). Dostępne kategorie: ${CATEGORY_KEYS.join(", ")}.`,
            },
          ],
          isError: true,
        };
      }

      const showDetailedOps = include_operations || Boolean(source);
      const catalogue = selectedSources.map((s) => {
        const srcId = s.id as SourceId;
        const sourceTools = toolsBySource.get(srcId) ?? [];
        const primarySearch = PRIMARY_SEARCH_TOOL_BY_SOURCE[srcId];
        const primaryGet = PRIMARY_GET_TOOL_BY_SOURCE[srcId];
        const baseInfo: Record<string, unknown> = {
          id: s.id,
          group: s.group,
          name: s.name,
          description: SOURCE_GROUPS[s.group],
          requiresAuth: "requiresAuth" in s ? Boolean(s.requiresAuth) : false,
          primarySearchOperation: primarySearch ?? null,
          primaryGetOperation: primaryGet ?? null,
          operationsCount: sourceTools.length,
        };
        if (showDetailedOps) {
          baseInfo.operations = sourceTools.map((t) => ({
            operation: t.name,
            description: t.description,
            parameters: describeToolSchema(t.schema),
          }));
        } else {
          baseInfo.operations = sourceTools.map((t) => t.name);
        }
        return baseInfo;
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                totalSources: catalogue.length,
                categories: SOURCE_GROUPS,
                sources: catalogue,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // 2. search
  // ---------------------------------------------------------------------------
  server.tool(
    "search",
    [
      "Uniwersalne narzędzie do wyszukiwania informacji w 55 polskich bazach akademickich, rejestrach publicznych, bazach aktów prawnych, orzeczeń, norm oraz archiwach kultury (operacja tylko do odczytu — read-only).",
      "Obsługuje trzy tryby pracy: (1) równoległe przeszukiwanie całej kategorii tematycznej (parametr category), (2) równoległe przeszukiwanie wskazanych baz (parametr sources) oraz (3) wywołanie konkretnej operacji natywnej (parametr operation) z własnymi parametrami w obiekcie filters.",
      "Automatycznie oczyszcza odpowiedzi HTML i XML z szumu znaczników oraz ogranicza rozmiar zwracanych danych.",
      "Dokumentacja API konektora i docelowych interfejsów API (Target API Docs): https://pamcp.pl/connectors oraz https://pamcp.pl/openapi.json (API źródłowe m.in.: ISAP ELI API https://api.sejm.gov.pl/eli/openapi/ui, SAOS API https://www.saos.org.pl/help/index.php/dokumentacja-api, GUS BDL API https://bdl.stat.gov.pl/api/v1/, Dane.gov.pl API https://api.dane.gov.pl/doc, Wolne Lektury API https://wolnelektury.pl/api/, Biblioteka Nauki OAI-PMH https://bibliotekanauki.pl/api/oai, RAD-on OpenData https://radon.nauka.gov.pl/opendata/, Otwarte Dane Krakowa https://otwartedane.um.krakow.pl/zbiory-danych i https://api.um.krakow.pl/devportal, MSIP Kraków ArcGIS REST https://msip3.um.krakow.pl/server/rest/services, Strategia Krakowa https://strategia.krakow.pl/252790,artykul,bank_informacji_o_miescie_i_metropolii.html — pełną specyfikację parametrów każdej operacji zwraca narzędzie list_sources z include_operations=true).",
    ].join(" "),
    {
      query: z
        .string()
        .optional()
        .describe(
          "Fraza wyszukiwania pełnotekstowego: słowa kluczowe, tytuł publikacji, nazwisko autora, temat, sygnatura lub nazwa miejscowości.",
        ),
      category: z
        .enum(CATEGORY_KEYS)
        .optional()
        .describe(
          "Kategoria tematyczna baz do równoległego przeszukania: nauka, dane, prawo, normy lub kultura.",
        ),
      sources: z
        .array(z.string())
        .optional()
        .describe(
          'Lista identyfikatorów źródeł do równoległego odpytania, np. ["ruj", "bn", "agh", "ppm"] lub ["isap", "saos"].',
        ),
      operation: z
        .string()
        .optional()
        .describe(
          'Nazwa konkretnej operacji natywnej z katalogu (np. "ludzie_semantic_search", "bdl_get_data_by_variable", "imgw_warnings", "wolnelektury_list_taxonomy").',
        ),
      filters: z
        .record(z.unknown())
        .optional()
        .describe(
          "Dodatkowe parametry i kryteria przekazywane bezpośrednio do operacji lub baz docelowych (np. rok, strona, autor, typ dokumentu).",
        ),
      limit_per_source: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(5)
        .describe("Maksymalna liczba rekordów zwracana z pojedynczego źródła (1–50)."),
      format: z
        .enum(["concise", "detailed", "raw"])
        .default("concise")
        .describe(
          "Format odpowiedzi: concise (zwięzły po ekstrakcji), detailed (pełniejszy opis) lub raw (surowa odpowiedź ze źródła).",
        ),
      max_chars: z
        .number()
        .int()
        .min(1000)
        .max(100000)
        .default(100000)
        .describe("Maksymalna łączna liczba znaków w zwracanej odpowiedzi (1000–100000; domyślnie 100000 — pełna jakość wyszukiwania)."),
    },
    {
      title: "Wyszukiwanie w polskich bazach — Polish Academic",
      ...ROUTER_READ_ONLY_ANNOTATIONS,
    },
    async ({
      query,
      category,
      sources,
      operation,
      filters,
      limit_per_source,
      format,
      max_chars,
    }) => {
      // Case 1: Explicit native operation call
      if (operation) {
        const opName = operation.trim();
        const target = capturedTools.get(opName);
        if (!target || !enabledSources.has(target.sourceId)) {
          return {
            content: [
              {
                type: "text",
                text: `Nieznana lub wyłączona operacja "${operation}". Wywołaj narzędzie list_sources z parametrem include_operations=true, aby sprawdzić dostępne nazwy operacji.`,
              },
            ],
            isError: true,
          };
        }
        const args = buildSearchArgs(target, query, limit_per_source, filters);
        const res = await target.handler(args);
        const rawText = res.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        const imageBlocks = res.content.filter(
          (c): c is { type: "image"; data: string; mimeType: string } => c.type === "image",
        );
        const formatted = formatAndSliceOutput(rawText, {
          format: format === "concise" ? "detailed" : format,
          maxChars: max_chars,
          maxItems: limit_per_source,
        });
        const footer = res.isError ? "" : formatDeepenFooter(extractDeepenCandidates(target.sourceId, rawText));
        return {
          content: [{ type: "text" as const, text: footer ? `${formatted}\n\n${footer}` : formatted }, ...imageBlocks],
          ...(res.isError ? { isError: true } : {}),
        };
      }

      // Case 2: Determine target sources from `sources` array or `category`
      let targetSourceIds: SourceId[] = [];
      if (sources && sources.length > 0) {
        const invalid: string[] = [];
        for (const rawId of sources) {
          const clean = rawId.trim() as SourceId;
          if (enabledSources.has(clean)) {
            targetSourceIds.push(clean);
          } else {
            invalid.push(rawId);
          }
        }
        if (targetSourceIds.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `Żadne ze wskazanych źródeł (${invalid.join(", ")}) nie jest aktywne. Sprawdź dostępne bazy za pomocą narzędzia list_sources.`,
              },
            ],
            isError: true,
          };
        }
      } else if (category) {
        targetSourceIds = SOURCES.filter(
          (s) =>
            enabledSources.has(s.id) &&
            s.group === category &&
            !SKIP_CATEGORY_FANOUT_WITHOUT_EXPLICIT.has(s.id) &&
            !(("requiresAuth" in s && s.requiresAuth) && !hasPbnCredentials),
        ).map((s) => s.id);
      } else {
        // Default fast cross-category core selection if neither category nor sources given
        const coreDefaults: SourceId[] = ["bn", "ruj", "rodbuk", "repod", "dane", "isap", "saos"];
        // shortcut: dopina źródła miejskie tylko przy słowie "Kraków" w zapytaniu; upgrade: routing po tematach (BDL, statystyki)
        const krakowSources: SourceId[] = /krak[oó]w|krakow/i.test(query ?? "")
          ? ["krakow_od", "krakow_strategia", "krakow_msip"]
          : [];
        targetSourceIds = [...coreDefaults, ...krakowSources].filter((id) => enabledSources.has(id));
      }

      const targetTools: CapturedTool[] = [];
      for (const sourceId of targetSourceIds) {
        const toolName = PRIMARY_SEARCH_TOOL_BY_SOURCE[sourceId];
        const tool = toolName ? capturedTools.get(toolName) : (toolsBySource.get(sourceId) ?? [])[0];
        if (tool) targetTools.push(tool);
      }

      if (targetTools.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "Brak skonfigurowanych narzędzi wyszukiwania dla wybranych źródeł.",
            },
          ],
          isError: true,
        };
      }

      // Nie ścinaj agresywnie per źródło: minimum 12k, a przy małej liczbie źródeł dziel budżet po równo.
      const perSourceCharBudget = Math.max(
        12_000,
        Math.floor(max_chars / Math.max(1, targetTools.length)),
      );

      const settled = await Promise.allSettled(
        targetTools.map(async (tool) => {
          const args = buildSearchArgs(tool, query, limit_per_source, filters);
          const result = await tool.handler(args);
          const rawText = result.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");
          const compacted = formatAndSliceOutput(rawText, {
            format,
            maxChars: perSourceCharBudget,
            maxItems: limit_per_source,
          });
          return {
            source: tool.sourceId,
            operation: tool.name,
            isError: Boolean(result.isError),
            output: compacted,
            candidates: result.isError ? [] : extractDeepenCandidates(tool.sourceId, rawText),
          };
        }),
      );

      const sections: string[] = [];
      let anySuccess = false;
      for (let i = 0; i < settled.length; i++) {
        const item = settled[i];
        const tool = targetTools[i];
        if (item.status === "fulfilled") {
          if (!item.value.isError) anySuccess = true;
          sections.push(
            `=== [${item.value.source}] (${item.value.operation})${item.value.isError ? " [BŁĄD]" : ""} ===\n${item.value.output}`,
          );
        } else {
          const reason =
            item.reason instanceof Error ? item.reason.message : String(item.reason);
          sections.push(`=== [${tool.sourceId}] (${tool.name}) [BŁĄD] ===\n${reason}`);
        }
      }

      const allCandidates: DeepenCandidate[] = [];
      const candSeen = new Set<string>();
      for (const item of settled) {
        if (item.status !== "fulfilled") continue;
        for (const c of item.value.candidates) {
          const key = `${c.source}:${c.id}`;
          if (candSeen.has(key) || allCandidates.length >= 24) continue;
          candSeen.add(key);
          allCandidates.push(c);
        }
      }
      const footer = formatDeepenFooter(allCandidates);
      const combined = formatAndSliceOutput(
        [footer, ...sections].filter(Boolean).join("\n\n"),
        {
          format: "raw",
          maxChars: max_chars,
        },
      );

      return {
        content: [{ type: "text", text: combined }],
        ...(!anySuccess && settled.length > 0 ? { isError: true } : {}),
      };
    },
  );

  // ---------------------------------------------------------------------------
  // 3. get_record
  // ---------------------------------------------------------------------------
  server.tool(
    "get_record",
    [
      "Pobiera pełne metadane, treść dokumentu lub dane badawcze (PDF, HTML, XML/OAI-PMH/EAD, CSV, TSV, XLSX, ZIP, JSON) dla pojedynczego rekordu albo bezpośrednio ze wskazanego adresu URL (operacja tylko do odczytu — read-only).",
      'Przyjmuje identyfikator złożony w formacie "źródło:id" (np. "ruj:207985", "isap:DU/2023/123", "saos:12345", "wolnelektury:lalka", "ppm:1234"), osobne parametry source oraz id albo bezpośredni adres pliku/strony w parametrze url (bądź w polu id zaczynającym się od http/https).',
      "Automatycznie wykrywa powiązane pliki pełnotekstowe (bitstreamy PDF, arkusze CSV/XLSX, manifesty IIIF), wyodrębnia warstwę tekstową z plików PDF (wraz z obsługą OCR/HTR dla skanów) oraz arkuszy XLSX w pamięci i wspiera przeszukiwanie wewnątrz dokumentu (parametr grep) oraz stronicowanie (offset i max_chars).",
      "Dokumentacja API konektora i docelowych interfejsów API (Target API Docs): https://pamcp.pl/connectors oraz https://pamcp.pl/openapi.json (API źródłowe m.in.: ISAP ELI API https://api.sejm.gov.pl/eli/openapi/ui, SAOS API https://www.saos.org.pl/help/index.php/dokumentacja-api, GUS BDL API https://bdl.stat.gov.pl/api/v1/, Dane.gov.pl API https://api.dane.gov.pl/doc, Wolne Lektury API https://wolnelektury.pl/api/, Biblioteka Nauki OAI-PMH https://bibliotekanauki.pl/api/oai, RAD-on OpenData https://radon.nauka.gov.pl/opendata/, Otwarte Dane Krakowa https://otwartedane.um.krakow.pl/zbiory-danych i https://api.um.krakow.pl/devportal, MSIP Kraków ArcGIS REST https://msip3.um.krakow.pl/server/rest/services, Strategia Krakowa https://strategia.krakow.pl/252790,artykul,bank_informacji_o_miescie_i_metropolii.html — szczegółowe schematy parametrów każdej operacji zwraca narzędzie list_sources z include_operations=true).",
    ].join(" "),
    {
      id: z
        .string()
        .optional()
        .describe(
          'Identyfikator rekordu w formacie "źródło:id" (np. "ruj:207985", "isap:DU/2023/123"), sam identyfikator docelowego obiektu (UUID, numer ELI, slug, numer normy) lub bezpośredni adres URL dokumentu (http/https).',
        ),
      source: z
        .string()
        .optional()
        .describe(
          'Identyfikator źródła danych (np. "ruj", "bn", "isap", "saos", "wolnelektury", "rcin", "ppm").',
        ),
      url: z
        .string()
        .optional()
        .describe(
          "Bezpośredni adres URL pliku lub strony (PDF, XLSX, CSV, TSV, XML, HTML, JSON, ZIP) do pobrania i wyodrębnienia pełnego tekstu lub danych tabelarycznych.",
        ),
      operation: z
        .string()
        .optional()
        .describe(
          'Nazwa konkretnej operacji pobrania rekordu (np. "wolnelektury_get_collection", "nac_get_page", "bdl_get_data_by_unit"). Jeśli pominięta, wybierana jest domyślna operacja szczegółów dla danego źródła.',
        ),
      params: z
        .record(z.unknown())
        .optional()
        .describe(
          "Dodatkowe parametry przekazywane do operacji szczegółów (np. format prezentacji, numer zestawu, język).",
        ),
      include_fulltext: z
        .boolean()
        .default(false)
        .describe(
          "Czy automatycznie pobrać i wyodrębnić pełny tekst z pierwszego wykrytego pliku powiązanego z rekordem (np. pliku PDF aktu prawnego, publikacji lub arkusza danych CSV/XLSX).",
        ),
      grep: z
        .string()
        .optional()
        .describe(
          "Fraza lub wyrażenie regularne do przeszukania wewnątrz pobranego pełnego tekstu dokumentu (PDF, XML, HTML) lub do odfiltrowania pasujących wierszy w arkuszach CSV/TSV/XLSX.",
        ),
      max_rows: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .default(200)
        .describe(
          "Maksymalna liczba wierszy zwracana podczas parsowania plików tabelarycznych CSV, TSV oraz arkuszy XLSX (1–2000).",
        ),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Przesunięcie znakowe od początku dokumentu do stronicowania długich treści."),
      max_chars: z
        .number()
        .int()
        .min(1000)
        .max(100000)
        .default(80000)
        .describe("Maksymalna liczba znaków zwracana w jednym wywołaniu (1000–100000; domyślnie 80000)."),
      format: z
        .enum(["concise", "detailed", "raw"])
        .default("detailed")
        .describe(
          "Format odpowiedzi: detailed (oczyszczony tekst, pełne pola i wykryte pliki do pobrania), concise (skrócony) lub raw (surowa odpowiedź bez ekstrakcji).",
        ),
    },
    {
      title: "Pobranie rekordu i pełnego tekstu — Polish Academic",
      ...ROUTER_READ_ONLY_ANNOTATIONS,
    },
    async ({
      id,
      source,
      url,
      operation,
      params,
      include_fulltext,
      grep,
      max_rows,
      offset,
      max_chars,
      format,
    }) => {
      // Direct URL mode: when `url` is given OR `id` is an http(s):// link
      const directUrl =
        url?.trim() ||
        (id && /^https?:\/\//i.test(id.trim()) ? id.trim() : undefined);

      if (directUrl) {
        try {
          const parsedDoc = await fetchAndParseUrl(directUrl, {
            grep,
            offset,
            maxChars: max_chars,
            maxRows: max_rows,
            format,
          });
          const headerLines = [
            `=== POBRANY DOKUMENT / ZBIÓR DANYCH ===`,
            `URL: ${parsedDoc.url}`,
            `Format: ${parsedDoc.detectedFormat.toUpperCase()} (${parsedDoc.contentType || "auto"}, ${parsedDoc.byteLength} bajtów)`,
          ];
          if (parsedDoc.metadata.pageCountEstimate) {
            headerLines.push(`Szacowana liczba stron PDF: ${parsedDoc.metadata.pageCountEstimate}`);
          }
          if (parsedDoc.metadata.totalRows !== undefined) {
            headerLines.push(
              `Wiersze danych: ${parsedDoc.metadata.matchedRows} pasujących z ${parsedDoc.metadata.totalRows} łącznie`,
            );
          }
          if (parsedDoc.discoveredFiles.length > 0) {
            headerLines.push(
              `Wykryte pliki powiązane (${parsedDoc.discoveredFiles.length}):`,
              ...parsedDoc.discoveredFiles
                .slice(0, 10)
                .map((f) => `  - [${f.type.toUpperCase()}] ${f.label}: ${f.url}`),
            );
          }
          const note = await unreadableDocumentNote(parsedDoc, saveDocuments);
          if (note) headerLines.push(note);
          headerLines.push("---", parsedDoc.text);
          return {
            content: [{ type: "text", text: headerLines.join("\n") }],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: "text",
                text: `Błąd podczas pobierania lub parsowania dokumentu z adresu ${directUrl}: ${msg}`,
              },
            ],
            isError: true,
          };
        }
      }

      let resolvedSource = source?.trim();
      let resolvedId = id?.trim();

      if (!resolvedSource && resolvedId && resolvedId.includes(":")) {
        const colonIdx = resolvedId.indexOf(":");
        const prefix = resolvedId.slice(0, colonIdx).trim();
        if (enabledSources.has(prefix as SourceId)) {
          resolvedSource = prefix;
          resolvedId = resolvedId.slice(colonIdx + 1).trim();
        }
      }

      let targetTool: CapturedTool | undefined;
      if (operation) {
        const opName = operation.trim();
        const candidate = capturedTools.get(opName);
        if (!candidate || !enabledSources.has(candidate.sourceId)) {
          return {
            content: [
              {
                type: "text",
                text: `Nieznana lub wyłączona operacja "${operation}". Użyj narzędzia list_sources z parametrem include_operations=true, aby sprawdzić poprawne nazwy operacji.`,
              },
            ],
            isError: true,
          };
        }
        targetTool = candidate;
      } else if (resolvedSource) {
        const srcId = resolvedSource as SourceId;
        const primaryGetName = PRIMARY_GET_TOOL_BY_SOURCE[srcId];
        targetTool = primaryGetName
          ? capturedTools.get(primaryGetName)
          : (toolsBySource.get(srcId) ?? [])[0];
      }

      if (!targetTool) {
        return {
          content: [
            {
              type: "text",
              text: 'Nie wskazano źródła, operacji ani adresu URL. Podaj parametr source (np. "ruj", "isap", "saos"), identyfikator złożony w polu id (np. "ruj:207985"), adres http/https w polu url albo nazwę operacji w polu operation.',
            },
          ],
          isError: true,
        };
      }

      const args = buildGetRecordArgs(targetTool, resolvedId, params);
      const result = await targetTool.handler(args);
      const rawText = result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      const imageBlocks = result.content.filter(
        (c): c is { type: "image"; data: string; mimeType: string } => c.type === "image",
      );

      const discoveredFiles = discoverBitstreamsInText(rawText, targetTool.sourceId);
      let bodyText = rawText;

      if (grep && grep.trim().length > 0 && !include_fulltext) {
        const cleanedForGrep = formatAndSliceOutput(rawText, {
          format: format === "raw" ? "raw" : "detailed",
          offset: 0,
          maxChars: 500_000,
          maxItems: 500,
        });
        bodyText = grepExtractedText(cleanedForGrep, grep.trim()).matchedText;
      }

      const slicedMeta = formatAndSliceOutput(bodyText, {
        format: grep ? "raw" : format,
        offset: include_fulltext ? 0 : offset,
        maxChars: include_fulltext ? Math.min(6000, Math.floor(max_chars / 2)) : max_chars,
        maxItems: 50,
      });

      const sections: string[] = [slicedMeta];

      if (discoveredFiles.length > 0 && format !== "raw") {
        sections.push(
          [
            "",
            "=== WYKRYTE PLIKI DO POBRANIA I ANALIZY PEŁNOTEKSTOWEJ (wywołaj get_record z url=...) ===",
            ...discoveredFiles.map((f) => `- [${f.type.toUpperCase()}] ${f.label}: ${f.url}`),
          ].join("\n"),
        );
      }

      if (include_fulltext && discoveredFiles.length > 0) {
        // Prefer rich content formats (PDF, EPUB, CSV, TSV, XLSX, TXT) over XML/HTML
        const PRIORITY = ["pdf", "epub", "csv", "tsv", "xlsx", "txt", "html", "xml"];
        let preferred: DiscoveredFile | undefined;
        for (const p of PRIORITY) {
          const match = discoveredFiles.find((f) => f.type === p);
          if (match) {
            preferred = match;
            break;
          }
        }
        if (!preferred) preferred = discoveredFiles[0];
        try {
          const fulltextBudget = Math.max(2000, max_chars - sections.join("\n").length);
          const parsedDoc = await fetchAndParseUrl(preferred.url, {
            grep,
            offset,
            maxChars: fulltextBudget,
            maxRows: max_rows,
            format,
          });
          const note = await unreadableDocumentNote(parsedDoc, saveDocuments);
          sections.push(
            [
              "",
              `=== AUTOMATYCZNIE POBRANY PEŁNY TEKST / DANE: ${preferred.label} (${parsedDoc.detectedFormat.toUpperCase()}, ${parsedDoc.byteLength} B) ===`,
              ...(note ? [note] : []),
              parsedDoc.text,
            ].join("\n"),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sections.push(
            `\n[Uwaga: nie udało się automatycznie pobrać pliku ${preferred.url}: ${msg}]`,
          );
        }
      }

      return {
        content: [{ type: "text" as const, text: sections.join("\n") }, ...imageBlocks],
        ...(result.isError ? { isError: true } : {}),
      };
    },
  );

  // ---------------------------------------------------------------------------
  // 4. MCP Resource Templates (for Claude Desktop / Code & Cursor `@resource` mentions)
  // ---------------------------------------------------------------------------
  server.resource(
    "polish-academic-record",
    new ResourceTemplate("polish-academic://record/{source}/{id}", { list: undefined }),
    {
      description:
        "Rekord lub publikacja z polskiej bazy naukowej/publicznej/archiwalnej (np. polish-academic://record/ruj/207985)",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const src = String(variables.source ?? "").trim() as SourceId;
      const recId = decodeURIComponent(String(variables.id ?? "").trim());
      const primaryGetName = PRIMARY_GET_TOOL_BY_SOURCE[src];
      const tool = primaryGetName
        ? capturedTools.get(primaryGetName)
        : (toolsBySource.get(src) ?? [])[0];
      if (!tool) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `Nieznane lub wyłączone źródło "${src}".`,
            },
          ],
        };
      }
      const args = buildGetRecordArgs(tool, recId, undefined);
      const res = await tool.handler(args);
      const rawText = res.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      const discovered = discoverBitstreamsInText(rawText, tool.sourceId);
      const cleaned = formatAndSliceOutput(rawText, {
        format: "detailed",
        maxChars: 30_000,
      });
      const filesFooter =
        discovered.length > 0
          ? `\n\n=== WYKRYTE PLIKI ===\n${discovered.map((f) => `- [${f.type.toUpperCase()}] ${f.label}: ${f.url}`).join("\n")}`
          : "";
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: `${cleaned}${filesFooter}`,
          },
        ],
      };
    },
  );
}
