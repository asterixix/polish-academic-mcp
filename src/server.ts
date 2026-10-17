/**
 * MCP server factory.
 *
 * A new McpServer instance MUST be created for every request — sharing a
 * global instance causes cross-client data leakage (CVE fixed in SDK 1.26.0).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { Env } from "./types.js";
import { SOURCE_GROUPS, SOURCES, groupsOf, type SourceGroup, type SourceId } from "./sources.js";
import {
  registerRouterTools,
  type CapturedTool,
  type ToolHandler,
} from "./router.js";

/** Fallback when package.json is unavailable (e.g. Cloudflare Workers bundle). */
export const PACKAGE_VERSION_FALLBACK = "1.2.0";

// Mirror src/index.ts: read the version from package.json so the handshake
// value cannot drift from the published package. On Workers the filesystem
// path may be missing after bundling — fall back to the pinned constant.
function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, "..", "package.json");
    const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    return typeof raw.version === "string" ? raw.version : PACKAGE_VERSION_FALLBACK;
  } catch {
    return PACKAGE_VERSION_FALLBACK;
  }
}
import { registerBibliotekaTools } from "./tools/biblioteka-nauki.js";
import { registerRujTools } from "./tools/ruj.js";
import { registerRodbukTools } from "./tools/rodbuk.js";
import { registerRepodTools } from "./tools/repod.js";
import { registerDaneTools } from "./tools/dane.js";
import { registerAmuTools } from "./tools/amu.js";
import { registerUafmTools } from "./tools/uafm.js";
import { registerIcmTools } from "./tools/icm.js";
import { registerImgwTools } from "./tools/imgw.js";
import { registerAghTools } from "./tools/agh.js";
import { registerRcinTools } from "./tools/rcin.js";
import { registerPknTools } from "./tools/pkn.js";
import { registerPolonTools } from "./tools/polon.js";
import { registerPbnTools } from "./tools/pbn.js";
import { registerBdlTools } from "./tools/bdl.js";
import { registerBaztolTools } from "./tools/baztol.js";
import { registerNacTools } from "./tools/nac.js";
import { registerSumTools } from "./tools/sum.js";
import { registerPpmTools } from "./tools/ppm.js";
import { registerIsapTools } from "./tools/isap.js";
import { registerSejmBsTools } from "./tools/sejm-bs.js";
import { registerSaosTools } from "./tools/saos.js";
import { registerWolneLekturyTools } from "./tools/wolne-lektury.js";
import { registerNinatekaTools } from "./tools/ninateka.js";
import { registerGaplaTools } from "./tools/gapla.js";
import { registerLudzieNaukiTools } from "./tools/ludzie-nauki.js";
import { registerPauartTools } from "./tools/pauart.js";
import { registerWiedzaTools } from "./tools/wiedza.js";
import { registerBlzTools } from "./tools/blz.js";
import { registerFototekaTools } from "./tools/fototeka.js";
import { registerFilmpolskiTools } from "./tools/filmpolski.js";
import { registerFototekaslaskaTools } from "./tools/fototekaslaska.js";
import { registerFilmotekaRepoTools } from "./tools/filmoteka-repo.js";
import { registerDokumentySlaskaTools } from "./tools/dokumenty-slaska.js";
import { registerJbcTools, registerSbcTools, registerFbcTools } from "./tools/dlibra.js";
import { registerPbmTools } from "./tools/pbm.js";
import {
  registerSzukajWArchiwachTools,
  registerGenealogiaWArchiwachTools,
} from "./tools/archiwum-portals.js";
import {
  registerPlockGeneaTools,
  registerEkartotekaTools,
  registerArchiwumPowstaniaTools,
  registerZamoscApTools,
  registerArchiwaJencyTools,
  registerArchiwaDziedzictwoTools,
  registerStratyTools,
  registerOpoleApTools,
  registerPiotrkowApTools,
} from "./tools/regional-archives.js";
import {
  registerWarszawaApTools,
  registerLublinApTools,
} from "./tools/warszawa-lublin-ap.js";
import {
  registerAgadTools,
  registerPostdiplomaTools,
} from "./tools/agad-postdiploma.js";

type RegisterFn = (server: McpServer, env: Env) => void;

// Record over SourceId: adding a source to src/sources.ts without mapping it here fails to compile.
const REGISTER: Record<SourceId, RegisterFn> = {
  bn: registerBibliotekaTools,
  rcin: registerRcinTools,
  ruj: registerRujTools,
  agh: registerAghTools,
  amu: registerAmuTools,
  uafm: registerUafmTools,
  icm: registerIcmTools,
  rodbuk: registerRodbukTools,
  repod: registerRepodTools,
  polon: registerPolonTools,
  pbn: registerPbnTools,
  ludzie: registerLudzieNaukiTools,
  baztol: registerBaztolTools,
  sum: registerSumTools,
  ppm: registerPpmTools,
  dane: registerDaneTools,
  bdl: registerBdlTools,
  imgw: registerImgwTools,
  isap: registerIsapTools,
  saos: registerSaosTools,
  bs_sejm: registerSejmBsTools,
  pkn: registerPknTools,
  wiedza: registerWiedzaTools,
  wolnelektury: registerWolneLekturyTools,
  ninateka: registerNinatekaTools,
  gapla: registerGaplaTools,
  fototeka: registerFototekaTools,
  filmpolski: registerFilmpolskiTools,
  fototekaslaska: registerFototekaslaskaTools,
  fn_repo: registerFilmotekaRepoTools,
  nac: registerNacTools,
  pauart: registerPauartTools,
  blz: registerBlzTools,
  dokumenty_slaska: registerDokumentySlaskaTools,
  jbc: registerJbcTools,
  sbc: registerSbcTools,
  fbc: registerFbcTools,
  pbm: registerPbmTools,
  swa: registerSzukajWArchiwachTools,
  gwa: registerGenealogiaWArchiwachTools,
  plock_genea: registerPlockGeneaTools,
  ekartoteka: registerEkartotekaTools,
  archiwum_powstania: registerArchiwumPowstaniaTools,
  warszawa_ap: registerWarszawaApTools,
  zamosc_ap: registerZamoscApTools,
  archiwa_jency: registerArchiwaJencyTools,
  archiwa_dziedzictwo: registerArchiwaDziedzictwoTools,
  straty: registerStratyTools,
  agad: registerAgadTools,
  postdiploma: registerPostdiplomaTools,
  lublin_ap: registerLublinApTools,
  opole_ap: registerOpoleApTools,
  piotrkow_ap: registerPiotrkowApTools,
};

export type ServerMode = "router" | "granular";

/** Env var read when `--mode` is not passed on the command line. */
export const MODE_ENV = "POLISH_ACADEMIC_MODE";

export interface ServerOptions {
  /** Sources to register. Defaults to every source (the stable 85-tool list). */
  sources?: readonly SourceId[];
  /**
   * Tool architecture mode:
   * - `"router"`: registers only 3 consolidated meta-tools (`list_sources`, `search`, `get_record`)
   *   that route to all enabled underlying sources in parallel with server-side extraction.
   * - `"granular"`: registers every individual tool directly on the MCP server (85 tools).
   */
  mode?: ServerMode;
  /** Called for every registered underlying source tool; used by `--list-sources` to count tools. */
  onToolRegistered?: (source: SourceId, toolName: string) => void;
}

function buildInstructions(ids: readonly SourceId[], mode: ServerMode = "granular"): string {
  const groups = groupsOf(ids)
    .map((group) => `${group} (${SOURCE_GROUPS[group]})`)
    .join("; ");
  if (mode === "router") {
    return [
      "Serwer udostępnia 3 skonsolidowane narzędzia (Meta-Router): list_sources, search oraz get_record.",
      "1. Użyj list_sources, aby poznać dostępne bazy w poszczególnych kategoriach (nauka, dane, prawo, normy, kultura) oraz ich operacje natywne.",
      "2. Użyj search z parametrem category (np. category='nauka') lub sources (np. sources=['ruj','bn']), aby równolegle przeszukać wiele baz jednocześnie, albo podaj operation, aby wywołać konkretną operację natywną.",
      "3. Użyj get_record z identyfikatorem 'źródło:id' (np. 'ruj:207985', 'isap:DU/2023/123') lub parametrami source + id, aby pobrać pełne metadane i treść rekordu.",
      "Odpowiedzi są automatycznie oczyszczane z szumu HTML/XML; długie dokumenty możesz stronicować parametrami offset i max_chars.",
      ...(ids.includes("pbn")
        ? ["Operacje pbn_* działają tylko po ustawieniu PBN_APP_ID i PBN_APP_TOKEN."]
        : []),
      `Włączone grupy: ${groups}.`,
    ].join("\n");
  }
  return [
    "Narzędzia przeszukują polskie bazy naukowe, publiczne i kulturowe. Prefiks nazwy wskazuje bazę (np. bn_ = Biblioteka Nauki, isap_ = akty prawne, bdl_ = GUS).",
    "Zwykle najpierw wywołaj narzędzie *_search, a potem *_get_* z identyfikatorem z wyników, aby pobrać szczegóły.",
    "Odpowiedzi to surowe dane ze źródła (JSON, XML lub HTML): wybierz z nich potrzebne informacje i podawaj linki do źródeł.",
    "Frazy wyszukiwania podawaj po polsku; użytkownikowi odpowiadaj w jego języku.",
    "Gdy baza zwróci błąd lub jest niedostępna, powiedz o tym i spróbuj innej bazy z tej samej grupy.",
    ...(ids.includes("pbn")
      ? ["Narzędzia pbn_* działają tylko po ustawieniu PBN_APP_ID i PBN_APP_TOKEN."]
      : []),
    `Włączone grupy: ${groups}.`,
  ].join("\n");
}

// Every tool only reads public data from external services.
// Claude Connectors Directory requires `title` + `readOnlyHint`/`destructiveHint`.
// ChatGPT Directory requires explicit boolean values (`true` or `false`) for
// `readOnlyHint`, `destructiveHint`, and `openWorldHint` in `annotations`.
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const SOURCE_NAME_BY_ID = new Map<SourceId, string>(
  SOURCES.map((s) => [s.id, s.name.split(" — ")[0].replace(/\s*\(wymaga kluczy\)/, "").trim()]),
);

const ACTION_TITLE_LABELS: Record<string, string> = {
  list_sources: "Katalog źródeł i operacji",
  search: "Wyszukiwanie w polskich bazach",
  get_record: "Pobranie rekordu i pełnego tekstu",
  search_publications: "Wyszukiwanie publikacji",
  search_articles: "Listowanie artykułów OAI-PMH",
  get_article: "Pobranie artykułu",
  get_item: "Pobranie rekordu",
  get_dataset: "Pobranie zbioru danych",
  search_persons: "Wyszukiwanie osób i autorów",
  get_publication: "Pobranie publikacji",
  search_subjects: "Wyszukiwanie tematów statystycznych",
  search_variables: "Wyszukiwanie zmiennych statystycznych",
  search_units: "Wyszukiwanie jednostek terytorialnych",
  get_variable: "Pobranie metadanych zmiennej",
  get_data_by_variable: "Dane statystyczne dla zmiennej",
  get_data_by_unit: "Dane statystyczne dla jednostki",
  synop: "Dane ze stacji synoptycznych",
  hydro: "Dane ze stacji hydrologicznych",
  meteo: "Dane ze stacji meteorologicznych",
  warnings: "Ostrzeżenia meteorologiczne i hydrologiczne",
  search_norms: "Wyszukiwanie norm",
  get_standard: "Pobranie karty normy",
  get_listing: "Pobranie źródła kultury",
  listing_categories: "Kategorie źródeł kultury",
  browse_domain: "Przeglądanie zasobów według dziedziny",
  get_resource: "Pobranie szczegółów zasobu",
  news_rss: "Aktualności RSS",
  site_search: "Wyszukiwanie na stronie",
  get_post: "Pobranie wpisu",
  get_page: "Pobranie strony",
  aleph_find: "Wyszukiwanie w katalogu Aleph",
  aleph_present: "Pobranie rekordów MARC z Aleph",
  semantic_search: "Wyszukiwanie semantyczne",
  get_scientist: "Pobranie profilu naukowca",
  get_artwork: "Pobranie metadanych dzieła",
  search_acts: "Wyszukiwanie aktów prawnych",
  get_act: "Pobranie aktu prawnego",
  search_judgments: "Wyszukiwanie orzeczeń sądowych",
  get_judgment: "Pobranie orzeczenia sądowego",
  dump_services: "Lista usług hurtowego pobierania",
  dump_common_courts: "Słownik sądów powszechnych",
  dump_sc_chambers: "Słownik izb Sądu Najwyższego",
  dump_judgments: "Hurtowe pobieranie orzeczeń",
  dump_enrichments: "Wzbogacenia powiązań orzeczeń",
  list_taxonomy: "Słownik taksonomii (autorzy, epoki, gatunki)",
  filter_books: "Filtrowanie lektur i książek",
  get_book: "Pobranie metadanych i plików książki",
  get_collection: "Pobranie kolekcji tematycznej",
  get_vod: "Pobranie materiału VOD",
  get_poster: "Pobranie plakatu",
  get_photo: "Pobranie fotografii",
  get_node: "Pobranie karty filmu",
  film_index: "Indeks filmów według litery",
  browse_kind: "Przeglądanie filmów według rodzaju",
  get_record_item: "Pobranie rekordu",
  medieval_catalog: "Katalog dokumentów średniowiecznych",
  get_unit: "Pobranie jednostki archiwalnej",
  get_person: "Pobranie karty osoby represjonowanej",
  ocr_htr: "Odczyt OCR/HTR skanów i rękopisów",
};

/** Build a human-readable Polish title for any MCP tool (required by Claude & ChatGPT directories). */
export function buildToolTitle(toolName: string, sourceId?: SourceId): string {
  if (toolName in ACTION_TITLE_LABELS && !sourceId) {
    return `${ACTION_TITLE_LABELS[toolName]} — Polish Academic`;
  }
  const resolvedSource =
    sourceId ??
    SOURCES.find((s) => toolName === s.id || toolName.startsWith(`${s.id}_`))?.id;
  if (!resolvedSource) {
    return ACTION_TITLE_LABELS[toolName] ?? toolName.replace(/_/g, " ");
  }
  const sourceLabel = SOURCE_NAME_BY_ID.get(resolvedSource) ?? resolvedSource.toUpperCase();
  const actionKey = toolName.startsWith(`${resolvedSource}_`)
    ? toolName.slice(resolvedSource.length + 1)
    : toolName;
  const actionLabel =
    ACTION_TITLE_LABELS[actionKey] ??
    (actionKey === "search"
      ? "Wyszukiwanie"
      : actionKey === "get_record"
        ? "Pobranie rekordu"
        : actionKey.replace(/_/g, " "));
  return `${sourceLabel}: ${actionLabel}`;
}

const GROUP_BY_SOURCE = new Map<SourceId, SourceGroup>(
  SOURCES.map((s) => [s.id, s.group]),
);

export function createServer(env: Env, options: ServerOptions = {}): McpServer {
  const ids = options.sources ?? SOURCES.map((s) => s.id);
  const mode: ServerMode = options.mode ?? "granular";
  const server = new McpServer(
    { name: "Polish Academic", version: readPackageVersion() },
    { instructions: buildInstructions(ids, mode) },
  );

  let current: SourceId = ids[0];
  const register = server.tool.bind(server) as (...args: unknown[]) => RegisteredTool;
  const capturedTools = new Map<string, CapturedTool>();

  // Intercept tool registrations from all tool modules so we can:
  // 1) always notify options.onToolRegistered(source, name)
  // 2) in "router" mode, capture the tool definitions in memory without exposing all granular schemas
  // 3) in "granular" mode, register them directly on the MCP server with title + readOnly/destructive/openWorld annotations
  server.tool = ((...args: unknown[]) => {
    const name = String(args[0]);
    options.onToolRegistered?.(current, name);

    if (mode === "router") {
      const description = typeof args[1] === "string" ? args[1] : "";
      const schema =
        args.length >= 4 && typeof args[2] === "object" && args[2] !== null
          ? (args[2] as Record<string, z.ZodTypeAny>)
          : {};
      const handler = (args[args.length - 1] as ToolHandler).bind(null);
      capturedTools.set(name, {
        name,
        sourceId: current,
        group: GROUP_BY_SOURCE.get(current) ?? "nauka",
        description,
        schema,
        handler,
      });
      return { update: () => {} } as unknown as RegisteredTool;
    }

    const tool = register(...args);
    const title = tool.title ?? buildToolTitle(name, current);
    tool.update({
      title,
      annotations: {
        title,
        ...READ_ONLY_ANNOTATIONS,
        ...tool.annotations,
      },
    });
    return tool;
  }) as McpServer["tool"];

  const enabled = new Set(ids);
  for (const { id } of SOURCES) {
    if (!enabled.has(id)) continue;
    current = id;
    REGISTER[id](server, env);
  }

  if (mode === "router") {
    // Restore server.tool to register the 3 consolidated Meta-Router tools on the MCP server.
    server.tool = ((...args: unknown[]) => {
      const name = String(args[0]);
      const tool = register(...args);
      const title = tool.title ?? buildToolTitle(name);
      tool.update({
        title,
        annotations: {
          title,
          ...READ_ONLY_ANNOTATIONS,
          ...tool.annotations,
        },
      });
      return tool;
    }) as McpServer["tool"];

    const hasPbnCredentials = Boolean(env.PBN_APP_ID && env.PBN_APP_TOKEN);
    registerRouterTools(server, capturedTools, enabled, hasPbnCredentials);
  }

  return server;
}
