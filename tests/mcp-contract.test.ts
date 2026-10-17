import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetVersion = "1.2.0";
const expectedToolNames = [
  "agad_search",
  "agh_get_item",
  "agh_search",
  "amu_get_item",
  "amu_search",
  "archiwa_dziedzictwo_get_record",
  "archiwa_dziedzictwo_search",
  "archiwa_jency_get_record",
  "archiwa_jency_search",
  "archiwum_powstania_get_record",
  "archiwum_powstania_search",
  "baztol_browse_domain",
  "baztol_get_resource",
  "baztol_search",
  "bdl_get_data_by_unit",
  "bdl_get_data_by_variable",
  "bdl_get_variable",
  "bdl_search_subjects",
  "bdl_search_units",
  "bdl_search_variables",
  "blz_get_listing",
  "blz_listing_categories",
  "blz_search",
  "bn_get_article",
  "bn_search_articles",
  "bn_search_publications",
  "bs_sejm_get_item",
  "bs_sejm_search",
  "dane_get_dataset",
  "dane_search",
  "dokumenty_slaska_get_page",
  "dokumenty_slaska_medieval_catalog",
  "ekartoteka_search",
  "fbc_get_record",
  "fbc_search",
  "filmpolski_get_item",
  "filmpolski_search",
  "fn_repo_browse_kind",
  "fn_repo_film_index",
  "fn_repo_get_node",
  "fn_repo_search",
  "fototeka_get_photo",
  "fototeka_search",
  "fototekaslaska_get_photo",
  "fototekaslaska_search",
  "gapla_get_poster",
  "gapla_search",
  "gwa_search",
  "icm_get_item",
  "icm_search",
  "imgw_hydro",
  "imgw_meteo",
  "imgw_synop",
  "imgw_warnings",
  "isap_get_act",
  "isap_search_acts",
  "jbc_get_publication",
  "jbc_ocr_htr",
  "jbc_search",
  "krakow_msip_get_dataset",
  "krakow_msip_list_services",
  "krakow_msip_query_layer",
  "krakow_msip_search",
  "krakow_od_fetch_api",
  "krakow_od_get_dataset",
  "krakow_od_search",
  "krakow_strategia_get_article",
  "krakow_strategia_list_bank",
  "krakow_strategia_search",
  "lublin_ap_search",
  "ludzie_get_scientist",
  "ludzie_search",
  "ludzie_semantic_search",
  "nac_get_page",
  "nac_get_post",
  "nac_news_rss",
  "nac_site_search",
  "ninateka_get_vod",
  "ninateka_search",
  "opole_ap_search",
  "pauart_get_artwork",
  "pauart_search",
  "pbm_get_item",
  "pbm_search",
  "pbn_get_publication",
  "pbn_search_persons",
  "pbn_search_publications",
  "piotrkow_ap_search",
  "pkn_search",
  "plock_genea_search",
  "polon_search",
  "postdiploma_search",
  "ppm_get_record",
  "ppm_search",
  "rcin_get_record",
  "rcin_search",
  "repod_get_dataset",
  "repod_search",
  "rodbuk_search",
  "ruj_get_item",
  "ruj_search",
  "saos_dump_common_courts",
  "saos_dump_enrichments",
  "saos_dump_judgments",
  "saos_dump_sc_chambers",
  "saos_dump_services",
  "saos_get_judgment",
  "saos_search_judgments",
  "sbc_get_publication",
  "sbc_search",
  "straty_get_person",
  "straty_search",
  "sum_aleph_find",
  "sum_aleph_present",
  "swa_get_unit",
  "swa_search",
  "uafm_get_item",
  "uafm_search",
  "warszawa_ap_search",
  "wiedza_get_standard",
  "wiedza_search_norms",
  "wolnelektury_filter_books",
  "wolnelektury_get_book",
  "wolnelektury_get_collection",
  "wolnelektury_list_taxonomy",
  "zamosc_ap_search",
] as const;

type Tool = {
  name: string;
  title?: string;
  description?: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  inputSchema: { properties?: Record<string, { description?: string }> };
};

// Polish function words and common morphology that appear in well-written tool descriptions.
const polishMarkers = [
  "ą",
  "ć",
  "ę",
  "ł",
  "ń",
  "ó",
  "ś",
  "ź",
  "ż",
  "baza",
  "dane",
  "dla",
  "domyślnie",
  "filtr",
  "identyfikator",
  "indeks",
  "jednostk",
  "konfiguracj",
  "limit",
  "list",
  "metadane",
  "minimalny",
  "maksymalny",
  "nazwa",
  "nagłówek",
  "numer",
  "opcjonalny",
  "paginacj",
  "parametr",
  "pobier",
  "pole",
  "rozmiar",
  "sortowan",
  "stron",
  "słowo",
  "tekst",
  "typ",
  "użyj",
  "wyszuk",
  "wynik",
  "zapytan",
  "zawartość",
  "zwraca",
  "źródło",
  "rok",
  "lat",
  "dat",
];

const englishVerbStems = [
  "browse",
  "fetch",
  "get",
  "list",
  "retrieve",
  "return",
  "returns",
  "search",
  "semantic",
  "load",
  "loads",
  "render",
  "rendern",
  "parse",
  "parses",
  "send",
  "sends",
  "create",
  "creates",
  "delete",
  "deletes",
  "update",
  "updates",
  "show",
  "shows",
];

// Tokenize a description into lowercased word stems (>=3 chars). Treat ASCII letters,
// digits, and a curated set of Polish diacritics as word characters.
function tokenize(text: string): string[] {
  const cleaned = text.replace(/https?:\/\/\S+/gu, " ").replace(/[^\p{L}\p{N} ]+/gu, " ");
  return cleaned
    .split(/\s+/u)
    .filter((word) => word.length >= 3)
    .map((word) => word.toLowerCase());
}

function hasPolishMarker(stem: string): boolean {
  return polishMarkers.some((marker) => stem.startsWith(marker));
}

function looksPolish(description: string): boolean {
  const tokens = tokenize(description);
  if (tokens.length === 0) return false;
  const englishHits = tokens.filter((stem) => englishVerbStems.includes(stem)).length;
  const polishHits = tokens.filter(hasPolishMarker).length;
  // 1) Any clear Polish morphology wins outright.
  if (polishHits > 0) return true;
  // 2) A description made up almost entirely of unprefixed English words is not Polish.
  if (englishHits / tokens.length >= 0.3) return false;
  // 3) Conservative fallback: token should contain a Polish-specific diacritic.
  return /[ąćęłńóśźż]/iu.test(description);
}

function summarize(values: string[]): string {
  const sample = values.slice(0, 10).join(", ");
  return `${values.length}: ${sample}${values.length > 10 ? ", …" : ""}`;
}

const client = new Client({ name: "contract-tests", version: "1.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "src/index.ts"],
  cwd: root,
  stderr: "pipe",
});
let tools: Tool[] = [];
let listTimedOut = false;
let handshakeTimer: ReturnType<typeof setTimeout> | undefined;

before(async () => {
  // Guard against the (rare) case of a child that hangs the handshake.
  const listPromise = (async () => {
    const listed = (await client.connect(transport), await client.listTools());
    return listed.tools as Tool[];
  })();
  const timeout = new Promise<never>((_, reject) => {
    handshakeTimer = setTimeout(() => {
      listTimedOut = true;
      reject(new Error("MCP handshake or listTools timed out after 30s"));
    }, 30_000);
  });
  tools = await Promise.race([listPromise, timeout]);
});

after(async () => {
  if (handshakeTimer !== undefined) clearTimeout(handshakeTimer);
  await client.close();
});

test("handshake MCP zgłasza wersję serwera 1.2.0", () => {
  if (listTimedOut) throw new Error("handshake never completed");
  assert.equal(client.getServerVersion()?.version, targetVersion);
});

test("tools/list zachowuje dokładnie 126 stabilnych identyfikatorów", () => {
  assert.deepEqual(tools.map(({ name }) => name).sort(), [...expectedToolNames]);
});

test("wszystkie narzędzia mają polskie opisy", () => {
  const invalid = tools
    .filter(({ description }) => !description || !looksPolish(description))
    .map(({ name }) => name);
  assert.equal(invalid.length, 0, `Niepolskie lub puste opisy narzędzi (${summarize(invalid)})`);
});

test("wszystkie parametry mają polskie opisy", () => {
  const invalid = tools.flatMap((tool) =>
    Object.entries(tool.inputSchema.properties ?? {})
      .filter(([, schema]) => !schema.description || !looksPolish(schema.description))
      .map(([name]) => `${tool.name}.${name}`),
  );
  assert.equal(invalid.length, 0, `Niepolskie lub puste opisy parametrów (${summarize(invalid)})`);
});

test("wszystkie narzędzia mają title oraz jawne adnotacje readOnlyHint, destructiveHint i openWorldHint (wymogi Claude i ChatGPT)", () => {
  for (const tool of tools) {
    assert.ok(tool.title && tool.title.trim().length > 0, `${tool.name} nie ma pola title`);
    assert.ok(
      tool.annotations?.title && tool.annotations.title.trim().length > 0,
      `${tool.name} nie ma pola annotations.title`,
    );
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} musi mieć readOnlyHint: true`);
    assert.equal(
      tool.annotations?.destructiveHint,
      false,
      `${tool.name} musi mieć destructiveHint: false`,
    );
    assert.equal(
      tool.annotations?.openWorldHint,
      true,
      `${tool.name} musi mieć openWorldHint: true`,
    );
  }
});
