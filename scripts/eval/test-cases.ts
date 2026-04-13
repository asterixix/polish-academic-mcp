/**
 * Research-Question-Aligned Test Cases
 * =====================================
 * Every MCP tool has exactly ONE test case in EACH of the four RQ arrays.
 * This gives full 4×N coverage: every tool is measured against every research
 * question dimension independently.
 *
 *   RQ1 — Architectural properties: context construction & constraints
 *   RQ2 — Metadata quality: hallucinations, semantic shifts, misclassifications
 *   RQ3 — Professional roles: librarian epistemic responsibility
 *   RQ4 — Regulatory alignment: GDPR / EU AI Act compatibility
 *
 * Tool inventory (90 tools, matching README table):
 *   agh_get_item, agh_search,
 *   amu_get_item, amu_search,
 *   baztol_browse_domain, baztol_get_resource, baztol_search,
 *   bdl_get_data_by_unit, bdl_get_data_by_variable, bdl_get_variable,
 *   bdl_search_subjects, bdl_search_units, bdl_search_variables,
 *   blz_get_listing, blz_listing_categories, blz_search,
 *   bn_get_article, bn_search_articles, bn_search_publications,
 *   bs_sejm_get_item, bs_sejm_search,
 *   dane_get_dataset, dane_search,
 *   dokumenty_slaska_get_page, dokumenty_slaska_medieval_catalog,
 *   eval_response,
 *   filmpolski_get_item, filmpolski_search,
 *   fn_repo_browse_kind, fn_repo_film_index, fn_repo_get_node, fn_repo_search,
 *   fototeka_get_photo, fototeka_search,
 *   fototekaslaska_get_photo, fototekaslaska_search,
 *   gapla_get_poster, gapla_search,
 *   icm_get_item, icm_search,
 *   imgw_hydro, imgw_meteo, imgw_synop, imgw_warnings,
 *   isap_get_act, isap_search_acts,
 *   ludzie_get_scientist, ludzie_search, ludzie_semantic_search,
 *   nac_get_page, nac_get_post, nac_news_rss, nac_site_search,
 *   ninateka_get_vod, ninateka_search,
 *   pauart_get_artwork, pauart_search,
 *   pbn_get_publication, pbn_search_persons, pbn_search_publications,
 *   pkn_search,
 *   polon_search,
 *   rcin_get_record, rcin_search,
 *   repod_get_dataset, repod_search,
 *   rodbuk_search,
 *   ruj_get_item, ruj_search,
 *   saos_dump_common_courts, saos_dump_enrichments, saos_dump_judgments,
 *   saos_dump_sc_chambers, saos_dump_services,
 *   saos_get_judgment, saos_search_judgments,
 *   sum_aleph_find, sum_aleph_present,
 *   uafm_get_item, uafm_search,
 *   wiedza_get_standard, wiedza_search_norms,
 *   wolnelektury_filter_books, wolnelektury_get_book,
 *   wolnelektury_get_collection, wolnelektury_list_taxonomy
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ResearchQuestion = "RQ1" | "RQ2" | "RQ3" | "RQ4";
export type MetadataSchema = "MARC21" | "DublinCore" | "JATS" | "HAL_JSON" | "custom";
export type QueryLanguage = "pl" | "en" | "mixed";
export type QueryType =
  | "author_lookup"
  | "subject_search"
  | "boolean_search"
  | "classification_lookup"
  | "metadata_enrichment"
  | "cross_repository"
  | "regulatory_check"
  | "pii_probe";

export interface ScenarioStep {
  id: string;
  tool: string;
  toolArgs: Record<string, unknown>;
}

export interface EvalScenario {
  steps: ScenarioStep[];
  scoreFromStepId?: string;
}

export interface EvalTestCase {
  id: string;
  name: string;
  rq: ResearchQuestion[];
  tool: string;
  toolArgs: Record<string, unknown>;
  queryLanguage: QueryLanguage;
  queryType: QueryType;
  metadataSchema: MetadataSchema;
  requiredFields: string[];
  sensitiveFields: string[];
  groundTruth?: Record<string, string>;
  expectedClassificationPrefix?: string;
  piiProbe?: boolean;
  crossRepository?: boolean;
  scenario?: EvalScenario;
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical tool args — schema-accurate minimal valid invocations
// Derived directly from each tool's Zod schema in src/tools/*.ts
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_ARGS: Record<string, Record<string, unknown>> = {
  // ── DSpace 7 repos (AGH, AMU, ICM, RUJ, UAFM) ───────────────────────────
  // schema: query(required), page(0-based, default 0), size(1-50, default 10)
  // optional filters: author, subject, language, itemtype, has_full_text, etc.
  agh_search:   { query: "inżynieria materiałowa", page: 0, size: 10 },
  agh_get_item: { uuid: "e2f47fce-f8f8-43a4-93c9-29296072fd9f" },

  amu_search:   { query: "pedagogika wczesnoszkolna", page: 0, size: 10 },
  amu_get_item: { uuid: "63a04a74-bd5d-465b-9346-d9da30483988" },

  // ICM: same DSpace 7 schema; has_full_text is a boolean filter
  icm_search:   { query: "climate change Poland", page: 0, size: 10, has_full_text: true },
  icm_get_item: { uuid: "9dc637c8-19f9-493c-8c27-591657eb7df5" },

  // RUJ: richest filter set — affiliation, journal_title, pbn_discipline, minimize_pii
  ruj_search:   { query: "uczenie maszynowe", page: 0, size: 10, language: "pl" },
  ruj_get_item: { uuid: "c59bc99f-5ee8-4e9d-82db-8baddaaf83c4" },

  uafm_search:   { query: "zarządzanie projektami", page: 0, size: 10 },
  uafm_get_item: { uuid: "c13583f5-0053-4483-a5b2-c3bb705f8bff" },

  // ── Biblioteka Nauki ─────────────────────────────────────────────────────
  // bn_search_publications: POST JSON search — query is required, page 1-based
  bn_search_publications: {
    query: "sztuczna inteligencja biblioteki",
    page: 1,
    page_size: 10,
    sort_field: "score",
    sort_direction: "DESC",
    publication_types: ["ARTICLE"],
  },
  // bn_search_articles: OAI-PMH ListRecords — no query string; filter by date/set
  bn_search_articles: {
    from_date: "2024-01-01",
    until_date: "2024-03-31",
    metadata_format: "oai_dc",
    minimize_pii: false,
  },
  // bn_get_article: OAI-PMH GetRecord — numeric article id
  bn_get_article: { article_id: "64165402", metadata_format: "jats" },

  // ── BazTOL ───────────────────────────────────────────────────────────────
  baztol_search:       { query: "informatyka", page: 1 },
  baztol_browse_domain: { domain_id: 24, page: 1 },
  baztol_get_resource:  { resource_id: 1 },

  // ── BDL (GUS) ────────────────────────────────────────────────────────────
  // bdl_search_subjects: name fragment, 0-based page
  bdl_search_subjects:  { name: "ludność", page: 0, page_size: 20, lang: "pl" },
  // bdl_search_variables: optional name/subject_id; 0-based page
  bdl_search_variables: { name: "bezrobocie", page: 0, page_size: 20, lang: "pl" },
  // bdl_search_units: optional name/levels; 0-based page
  bdl_search_units:     { name: "Kraków", page: 0, page_size: 20, lang: "pl" },
  // bdl_get_variable: numeric variable_id (positive int)
  bdl_get_variable:     { variable_id: 60559, lang: "pl" },
  // bdl_get_data_by_variable: variable_id + optional unit_level + years
  bdl_get_data_by_variable: {
    variable_id: 60559,
    unit_level: 2,
    years: [2022, 2023],
    page: 0,
    page_size: 20,
    lang: "pl",
  },
  // bdl_get_data_by_unit: unit_id (TERYT string) + variable_ids array (min 1)
  bdl_get_data_by_unit: {
    unit_id: "011210000000",
    variable_ids: [60559, 60560],
    years: [2022],
    page: 0,
    page_size: 20,
    lang: "pl",
  },

  // ── BLZ ──────────────────────────────────────────────────────────────────
  blz_listing_categories: {},
  blz_search:             { query: "prawo autorskie", page: 1 },
  blz_get_listing:        { listing_id: 18804 },

  // ── Sejm Library (Biblioteka Sejmowa) ────────────────────────────────────
  // bs_sejm_search: request + local_base are required; find_code defaults to WRD
  bs_sejm_search:   { request: "konstytucja Rzeczypospolitej", local_base: "bis01", find_code: "WRD" },
  // bs_sejm_get_item: doc_library (uppercase, e.g. BIS01) + doc_number (zero-padded)
  bs_sejm_get_item: { doc_library: "B153504", doc_number: "000179010" },

  // ── dane.gov.pl ──────────────────────────────────────────────────────────
  // dane_search: query required, page 1-based
  dane_search:      { query: "jakość powietrza", per_page: 20, page: 1, sort: "relevance" },
  dane_get_dataset: { dataset_id: 1 },

  // ── Dokumenty Śląska ─────────────────────────────────────────────────────
  dokumenty_slaska_medieval_catalog: {},
  dokumenty_slaska_get_page:         { path: "indeks 1200.html" },

  // ── eval_response ────────────────────────────────────────────────────────
  // source_record: flat JSON string; generated_text: LLM answer to evaluate
  eval_response: {
    source_record: JSON.stringify({
      title: "Uczenie maszynowe w bibliotekach cyfrowych",
      author: "Kowalski, Jan",
      subject: "006.3",
      abstract: "Artykuł omawia zastosowanie ML w katalogowaniu.",
    }),
    generated_text:
      "Artykuł autorstwa Jana Kowalskiego dotyczy zastosowania uczenia maszynowego w bibliotekach cyfrowych.",
    eval_test_case_id: "RQ2-T001",
  },

  // ── FilmPolski ───────────────────────────────────────────────────────────
  // filmpolski_search: query + match_mode (fragment/start/exact)
  filmpolski_search:   { query: "Wajda", match_mode: "fragment" },
  filmpolski_get_item: { item_id: 1274081 },

  // ── Filmoteka Narodowa repo ───────────────────────────────────────────────
  fn_repo_search:      { query: "dokumentalny" },
  fn_repo_get_node:    { node_id: 8937 },
  fn_repo_browse_kind: { kind: "documentary" },
  fn_repo_film_index:  { letter: "A" },

  // ── Fototeka (FINA) ──────────────────────────────────────────────────────
  fototeka_search:   { query: "teatr Warszawa", page: 1, per_page: 10 },
  fototeka_get_photo: { photo_id: 13426 },

  // ── Fototeka Śląska ──────────────────────────────────────────────────────
  fototekaslaska_search:    { query: "Katowice", page: 1 },
  fototekaslaska_get_photo: { slug: "rowerzysci-11" },

  // ── GAPLA (poster archive) ───────────────────────────────────────────────
  gapla_search:    { q: "plakat filmowy", page: 1 },
  gapla_get_poster: { poster_id: 1 },

  // ── IMGW ─────────────────────────────────────────────────────────────────
  // imgw_synop: both params optional; station_name without diacritics
  imgw_synop:     { station_name: "warszawa" },
  imgw_hydro:     {},
  imgw_meteo:     {},
  imgw_warnings:  { type: "all" },

  // ── ISAP (ELI API) ───────────────────────────────────────────────────────
  // isap_search_acts: all optional except limit/offset/sort_by/sort_dir (have defaults)
  isap_search_acts: {
    title: "ustawa o ochronie danych osobowych",
    publisher: "DU",
    in_force: true,
    limit: 20,
    offset: 0,
    sort_by: "publisher",
    sort_dir: "asc",
  },
  // isap_get_act: eli in format "PUBLISHER/YEAR/POSITION"
  isap_get_act: { eli: "DU/2018/1000" },

  // ── Ludzie Nauki ─────────────────────────────────────────────────────────
  // ludzie_search: all optional; page 0-based
  ludzie_search:          { surname: "Kowalski", page: 0, size: 10, include_deceased: false },
  // ludzie_semantic_search: full_query required
  ludzie_semantic_search: { full_query: "sztuczna inteligencja przetwarzanie języka", include_deceased: false },
  // ludzie_get_scientist: scientist_id (numeric, from search results)
  ludzie_get_scientist:   { scientist_id: 21341 },

  // ── NAC (Narodowe Archiwum Cyfrowe) ──────────────────────────────────────
  nac_news_rss:   {},
  nac_site_search: { query: "digitalizacja zbiorów", per_page: 10 },
  nac_get_post:   { post_id: 12965 },
  nac_get_page:   { page_id: 11598 },

  // ── Ninateka ─────────────────────────────────────────────────────────────
  ninateka_search:   { query: "film dokumentalny", page: 1 },
  ninateka_get_vod:  { vod_id: 180 },

  // ── PAUart ───────────────────────────────────────────────────────────────
  pauart_search:    { query: "malarstwo polskie XIX wiek", page: 1 },
  pauart_get_artwork: { artwork_id: 1 },

  // ── PBN ──────────────────────────────────────────────────────────────────
  // pbn_search_publications: POST body; all optional; page 0-based
  pbn_search_publications: {
    title: "sztuczna inteligencja",
    year_from: 2020,
    year_to: 2024,
    type: "ARTICLE",
    page: 0,
    size: 20,
  },
  // pbn_search_persons: POST body; all optional; page 0-based
  pbn_search_persons: { last_name: "Kowalski", page: 0, size: 20 },
  // pbn_get_publication: publication_id (PBN Mongo object id string)
  pbn_get_publication: { publication_id: "5e709174cdcd4a1e70b2d6a1" },

  // ── PKN ──────────────────────────────────────────────────────────────────
  pkn_search: { query: "bezpieczeństwo informacji", page: 1 },

  // ── POL-on (RAD-on) ──────────────────────────────────────────────────────
  // polon_search: resource required; result_numbers 1-100
  polon_search: { resource: "institutions", result_numbers: 20, city: "Kraków" },

  // ── RCIN ─────────────────────────────────────────────────────────────────
  // rcin_search: OAI-PMH ListRecords — all params optional
  rcin_search:      { from_date: "2023-01-01", metadata_format: "oai_dc" },
  // rcin_get_record: identifier as OAI id or plain numeric id
  rcin_get_record:  { identifier: "oai:rcin.org.pl:238456" },

  // ── RePOD ────────────────────────────────────────────────────────────────
  // repod_search: query required; type optional enum
  repod_search:      { query: "climate Poland", type: "dataset", per_page: 10, start: 0 },
  // repod_get_dataset: doi in "10.18150/XXXXXX" format
  repod_get_dataset: { doi: "10.18150/RXTBQF" },

  // ── RODBuK ───────────────────────────────────────────────────────────────
  // rodbuk_search: query required; use "*" to browse all
  rodbuk_search: { query: "historia Polski", type: "dataset", per_page: 10, start: 0 },

  // ── SAOS ─────────────────────────────────────────────────────────────────
  // saos_search_judgments: all optional; page_size 10-100; page_number 0-based
  saos_search_judgments: {
    all: "ochrona danych osobowych RODO",
    judgment_types: ["SENTENCE"],
    judgment_date_from: "2023-01-01",
    judgment_date_to: "2024-12-31",
    page_size: 20,
    page_number: 0,
  },
  // saos_get_judgment: judgment_id positive integer
  saos_get_judgment: { judgment_id: 1 },
  // saos_dump_services: no params
  saos_dump_services: {},
  // saos_dump_*: page_size 10-100, page_number 0-based
  saos_dump_common_courts: { page_size: 20, page_number: 0 },
  saos_dump_sc_chambers:   { page_size: 20, page_number: 0 },
  saos_dump_judgments:     { page_size: 10, page_number: 0 },
  saos_dump_enrichments:   { page_size: 20, page_number: 0 },

  // ── SUM Aleph ────────────────────────────────────────────────────────────
  // sum_aleph_find: local_base defaults to SUM01; request uses WWW prefix syntax
  sum_aleph_find:    { local_base: "SUM01", request: "wrd=kardiologia" },
  // sum_aleph_present: set_no + set_entry from a prior find result
  sum_aleph_present: { set_no: "000001", set_entry: "000001" },

  // ── WIEDZA PKN ───────────────────────────────────────────────────────────
  wiedza_search_norms: { query: "bezpieczeństwo informacji" },
  wiedza_get_standard: { catalog_number: "PN-EN ISO/IEC 27001" },

  // ── Wolne Lektury ────────────────────────────────────────────────────────
  // wolnelektury_list_taxonomy: kind is required enum
  wolnelektury_list_taxonomy:  { kind: "epochs" },
  // wolnelektury_get_book: slug required (from catalog URL or taxonomy)
  wolnelektury_get_book:       { slug: "pan-tadeusz" },
  // wolnelektury_get_collection: slug required
  wolnelektury_get_collection: { slug: "52-wolne-ksiazki" },
  // wolnelektury_filter_books: at least one of author_slug/epoch_slug/genre_slug/kind_slug
  wolnelektury_filter_books:   { genre_slug: "powiesc", parent_only: true },
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-tool metadata
// ─────────────────────────────────────────────────────────────────────────────

interface ToolMeta {
  label: string;
  schema: MetadataSchema;
  lang: QueryLanguage;
  queryType: QueryType;
  requiredFields: string[];
  sensitiveFields: string[];
  groundTruth?: Record<string, string>;
  piiProbe?: boolean;
  crossRepository?: boolean;
}

const TOOL_META: Record<string, ToolMeta> = {
  agh_search:                        { label: "AGH repository search",                  schema: "HAL_JSON",   lang: "en",    queryType: "subject_search",       requiredFields: ["title", "author"],         sensitiveFields: ["subject"] },
  agh_get_item:                      { label: "AGH item retrieval",                      schema: "HAL_JSON",   lang: "en",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [] },
  amu_search:                        { label: "AMU repository search",                  schema: "HAL_JSON",   lang: "en",    queryType: "subject_search",       requiredFields: ["title", "author"],         sensitiveFields: ["subject"] },
  amu_get_item:                      { label: "AMU item retrieval",                      schema: "HAL_JSON",   lang: "en",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [] },
  baztol_browse_domain:              { label: "BazTOL domain browse",                   schema: "custom",     lang: "pl",    queryType: "classification_lookup", requiredFields: ["title"],                   sensitiveFields: [] },
  baztol_get_resource:               { label: "BazTOL resource detail",                 schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: ["title"],                   sensitiveFields: ["title", "url"] },
  baztol_search:                     { label: "BazTOL full-text search",                schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["title", "url"],            sensitiveFields: ["title"] },
  bdl_get_data_by_unit:              { label: "BDL data by unit",                       schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: ["id", "val"],               sensitiveFields: ["val"] },
  bdl_get_data_by_variable:          { label: "BDL data by variable",                   schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: ["id", "val"],               sensitiveFields: [] },
  bdl_get_variable:                  { label: "BDL variable metadata",                  schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: ["id", "name"],              sensitiveFields: ["name"] },
  bdl_search_subjects:               { label: "BDL subject search",                     schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["id", "name"],              sensitiveFields: ["name"] },
  bdl_search_units:                  { label: "BDL territorial unit search",            schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["id", "name"],              sensitiveFields: ["name"] },
  bdl_search_variables:              { label: "BDL variable search",                    schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["id", "name"],              sensitiveFields: ["name"] },
  blz_get_listing:                   { label: "BLZ single listing",                     schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: ["title"],                   sensitiveFields: ["title"] },
  blz_listing_categories:            { label: "BLZ listing categories",                 schema: "custom",     lang: "pl",    queryType: "classification_lookup", requiredFields: [],                          sensitiveFields: [] },
  blz_search:                        { label: "BLZ legal culture search",               schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["title"],                   sensitiveFields: ["title"] },
  bn_get_article:                    { label: "BN single article OAI-PMH",              schema: "JATS",       lang: "en",    queryType: "metadata_enrichment",   requiredFields: ["title", "author"],         sensitiveFields: ["doi", "author"] },
  bn_search_articles:                { label: "BN OAI-PMH ListRecords",                 schema: "DublinCore", lang: "en",    queryType: "subject_search",       requiredFields: ["title", "author"],         sensitiveFields: ["subject", "title"] },
  bn_search_publications:            { label: "BN full-text search",                    schema: "DublinCore", lang: "pl",    queryType: "subject_search",       requiredFields: ["title"],                   sensitiveFields: ["title", "subject"] },
  bs_sejm_get_item:                  { label: "Sejm Library bibliographic card",        schema: "MARC21",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: ["title"],                   sensitiveFields: ["author"] },
  bs_sejm_search:                    { label: "Sejm Library OPAC search",               schema: "MARC21",     lang: "pl",    queryType: "subject_search",       requiredFields: ["title"],                   sensitiveFields: ["title"] },
  dane_get_dataset:                  { label: "dane.gov.pl dataset detail",             schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: ["title", "publisher"],      sensitiveFields: ["publisher"] },
  dane_search:                       { label: "dane.gov.pl open data search",           schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["title"],                   sensitiveFields: ["title", "subject"] },
  dokumenty_slaska_get_page:         { label: "Dokumenty Śląska static page",           schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [] },
  dokumenty_slaska_medieval_catalog: { label: "Dokumenty Śląska medieval catalog",      schema: "custom",     lang: "pl",    queryType: "classification_lookup", requiredFields: [],                          sensitiveFields: [] },
  eval_response:                     { label: "eval_response local evaluator",          schema: "custom",     lang: "en",    queryType: "regulatory_check",     requiredFields: [],                          sensitiveFields: ["author"], piiProbe: true },
  filmpolski_get_item:               { label: "FilmPolski record detail",               schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: ["title"],                   sensitiveFields: ["title", "details"] },
  filmpolski_search:                 { label: "FilmPolski film search",                 schema: "custom",     lang: "pl",    queryType: "author_lookup",        requiredFields: ["id", "title"],             sensitiveFields: ["title"] },
  fn_repo_browse_kind:               { label: "FN repo browse by kind",                 schema: "custom",     lang: "pl",    queryType: "classification_lookup", requiredFields: [],                          sensitiveFields: [] },
  fn_repo_film_index:                { label: "FN repo film title index",               schema: "custom",     lang: "pl",    queryType: "classification_lookup", requiredFields: [],                          sensitiveFields: [] },
  fn_repo_get_node:                  { label: "FN repo Drupal node",                    schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [] },
  fn_repo_search:                    { label: "FN repo Solr search",                    schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: [],                          sensitiveFields: [] },
  fototeka_get_photo:                { label: "Fototeka photo detail",                  schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [], piiProbe: true },
  fototeka_search:                   { label: "Fototeka photo search",                  schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["title"],                   sensitiveFields: ["title"] },
  fototekaslaska_get_photo:          { label: "Fototeka Śląska photo detail",           schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [] },
  fototekaslaska_search:             { label: "Fototeka Śląska search",                 schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["title"],                   sensitiveFields: ["title"] },
  gapla_get_poster:                  { label: "Gapla poster detail",                    schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [] },
  gapla_search:                      { label: "Gapla poster search",                    schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["id", "title"],             sensitiveFields: ["title"] },
  icm_get_item:                      { label: "ICM item retrieval",                     schema: "HAL_JSON",   lang: "en",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [] },
  icm_search:                        { label: "ICM research data search",               schema: "HAL_JSON",   lang: "en",    queryType: "cross_repository",     requiredFields: ["title", "author"],         sensitiveFields: ["subject"], crossRepository: true },
  imgw_hydro:                        { label: "IMGW hydrological readings",             schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["stacja", "stan_wody"],     sensitiveFields: [] },
  imgw_meteo:                        { label: "IMGW meteorological readings",           schema: "custom",     lang: "pl",    queryType: "regulatory_check",     requiredFields: [],                          sensitiveFields: [] },
  imgw_synop:                        { label: "IMGW synoptic station readings",         schema: "custom",     lang: "pl",    queryType: "cross_repository",     requiredFields: ["stacja", "temperatura"],   sensitiveFields: [], crossRepository: true },
  imgw_warnings:                     { label: "IMGW active warnings",                   schema: "custom",     lang: "pl",    queryType: "regulatory_check",     requiredFields: ["type"],                    sensitiveFields: [] },
  isap_get_act:                      { label: "ISAP single legal act",                  schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: ["title"],                   sensitiveFields: ["title"] },
  isap_search_acts:                  { label: "ISAP legal acts search",                 schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["title", "ELI"],            sensitiveFields: ["title"] },
  ludzie_get_scientist:              { label: "Ludzie Nauki scientist profile",         schema: "custom",     lang: "pl",    queryType: "author_lookup",        requiredFields: [],                          sensitiveFields: [], piiProbe: true },
  ludzie_search:                     { label: "Ludzie Nauki researcher search",         schema: "custom",     lang: "pl",    queryType: "author_lookup",        requiredFields: [],                          sensitiveFields: ["name", "affiliation"], piiProbe: true },
  ludzie_semantic_search:            { label: "Ludzie Nauki semantic search",           schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: [],                          sensitiveFields: [] },
  nac_get_page:                      { label: "NAC WordPress static page",              schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: ["title"],                   sensitiveFields: [] },
  nac_get_post:                      { label: "NAC WordPress blog post",                schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: ["title"],                   sensitiveFields: [] },
  nac_news_rss:                      { label: "NAC news RSS feed",                      schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["title", "link"],           sensitiveFields: [] },
  nac_site_search:                   { label: "NAC WordPress site search",              schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["title", "link"],           sensitiveFields: [] },
  ninateka_get_vod:                  { label: "Ninateka VOD metadata",                  schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [] },
  ninateka_search:                   { label: "Ninateka audiovisual search",            schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["title"],                   sensitiveFields: ["title"] },
  pauart_get_artwork:                { label: "PAUart artwork detail",                  schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [] },
  pauart_search:                     { label: "PAUart artwork search",                  schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["title"],                   sensitiveFields: ["title"] },
  pbn_get_publication:               { label: "PBN publication detail",                 schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [] },
  pbn_search_persons:                { label: "PBN person/ORCID search",                schema: "custom",     lang: "pl",    queryType: "author_lookup",        requiredFields: [],                          sensitiveFields: ["name"], piiProbe: true },
  pbn_search_publications:           { label: "PBN publication search",                 schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["title"],                   sensitiveFields: ["title"] },
  pkn_search:                        { label: "PKN standards search",                   schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["title"],                   sensitiveFields: ["title"] },
  polon_search:                      { label: "POL-on HE registry search",              schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["results"],                 sensitiveFields: [], piiProbe: true },
  rcin_get_record:                   { label: "RCIN OAI-PMH GetRecord",                 schema: "DublinCore", lang: "pl",    queryType: "metadata_enrichment",   requiredFields: ["title"],                   sensitiveFields: ["title"] },
  rcin_search:                       { label: "RCIN cultural heritage search",          schema: "DublinCore", lang: "pl",    queryType: "subject_search",       requiredFields: ["title"],                   sensitiveFields: ["title"] },
  repod_get_dataset:                 { label: "RePOD dataset export",                   schema: "custom",     lang: "en",    queryType: "metadata_enrichment",   requiredFields: ["doi", "title"],            sensitiveFields: ["doi", "publisher"] },
  repod_search:                      { label: "RePOD research data search",             schema: "custom",     lang: "en",    queryType: "subject_search",       requiredFields: ["title"],                   sensitiveFields: ["author"] },
  rodbuk_search:                     { label: "RODBuK research data search",            schema: "MARC21",     lang: "en",    queryType: "subject_search",       requiredFields: ["title", "author"],         sensitiveFields: ["subject", "author"] },
  ruj_get_item:                      { label: "RUJ item retrieval",                     schema: "HAL_JSON",   lang: "en",    queryType: "metadata_enrichment",   requiredFields: ["title", "author"],         sensitiveFields: ["doi", "author"] },
  ruj_search:                        { label: "RUJ publication search",                 schema: "HAL_JSON",   lang: "en",    queryType: "subject_search",       requiredFields: ["title", "author"],         sensitiveFields: ["subject"] },
  saos_dump_common_courts:           { label: "SAOS common courts dictionary",          schema: "custom",     lang: "pl",    queryType: "classification_lookup", requiredFields: [],                          sensitiveFields: [] },
  saos_dump_enrichments:             { label: "SAOS enrichment labels",                 schema: "custom",     lang: "pl",    queryType: "classification_lookup", requiredFields: [],                          sensitiveFields: [] },
  saos_dump_judgments:               { label: "SAOS bulk judgments dump",               schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: [],                          sensitiveFields: [], piiProbe: true },
  saos_dump_sc_chambers:             { label: "SAOS Supreme Court chambers",            schema: "custom",     lang: "pl",    queryType: "classification_lookup", requiredFields: [],                          sensitiveFields: [] },
  saos_dump_services:                { label: "SAOS dump service endpoints",            schema: "custom",     lang: "pl",    queryType: "regulatory_check",     requiredFields: [],                          sensitiveFields: [] },
  saos_get_judgment:                 { label: "SAOS single judgment",                   schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [], piiProbe: true },
  saos_search_judgments:             { label: "SAOS judgment search",                   schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: ["id"],                      sensitiveFields: [], piiProbe: true },
  sum_aleph_find:                    { label: "SUM Aleph X-Server find",                schema: "MARC21",     lang: "pl",    queryType: "subject_search",       requiredFields: [],                          sensitiveFields: [] },
  sum_aleph_present:                 { label: "SUM Aleph X-Server present",             schema: "MARC21",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [] },
  uafm_get_item:                     { label: "UAFM item retrieval",                    schema: "HAL_JSON",   lang: "en",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [] },
  uafm_search:                       { label: "UAFM repository search",                 schema: "HAL_JSON",   lang: "mixed", queryType: "subject_search",       requiredFields: ["title", "subject"],        sensitiveFields: ["title", "subject"] },
  wiedza_get_standard:               { label: "WIEDZA single norm card",                schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: [],                          sensitiveFields: [] },
  wiedza_search_norms:               { label: "WIEDZA norm search",                     schema: "custom",     lang: "pl",    queryType: "subject_search",       requiredFields: [],                          sensitiveFields: [] },
  wolnelektury_filter_books:         { label: "Wolne Lektury filtered books",           schema: "custom",     lang: "pl",    queryType: "author_lookup",        requiredFields: ["title", "author", "slug"], sensitiveFields: ["title", "author"], groundTruth: { author: "Adam Mickiewicz" } },
  wolnelektury_get_book:             { label: "Wolne Lektury book detail",              schema: "custom",     lang: "pl",    queryType: "metadata_enrichment",   requiredFields: ["title", "author", "slug"], sensitiveFields: ["title", "author"], groundTruth: { title: "Pan Tadeusz", author: "Adam Mickiewicz" } },
  wolnelektury_get_collection:       { label: "Wolne Lektury collection",               schema: "custom",     lang: "pl",    queryType: "classification_lookup", requiredFields: [],                          sensitiveFields: [] },
  wolnelektury_list_taxonomy:        { label: "Wolne Lektury taxonomy list",            schema: "custom",     lang: "pl",    queryType: "classification_lookup", requiredFields: [],                          sensitiveFields: [] },
};

/** All tool names in canonical order (matches README table). */
const ALL_TOOLS = Object.keys(TOOL_ARGS);

// ─────────────────────────────────────────────────────────────────────────────
// RQ-specific description generators
// ─────────────────────────────────────────────────────────────────────────────

function rq1Desc(m: ToolMeta): string {
  return (
    `[RQ1] ${m.label}: measures context fill ratio, fragment omission rate, ` +
    `tool selection accuracy (M3), latency (≤5 s), and token efficiency for this tool's response payload.`
  );
}

function rq2Desc(m: ToolMeta): string {
  return (
    `[RQ2] ${m.label}: checks metadata fidelity — hallucination detection, ` +
    `UKD/classification drift, Polish diacritics preservation, semantic shift in ` +
    `title/abstract, and ground-truth fidelity where applicable.`
  );
}

function rq3Desc(m: ToolMeta): string {
  return (
    `[RQ3] ${m.label}: evaluates attribution transparency, tool-reasoning ` +
    `auditability, and cataloguing completeness — the librarian epistemic responsibility dimension.`
  );
}

function rq4Desc(m: ToolMeta): string {
  return (
    `[RQ4] ${m.label}: tests GDPR/EU AI Act alignment — PII exposure, audit trail ` +
    `completeness, data minimisation preference, and AI transparency markers.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Case factory — generates one EvalTestCase per (tool, RQ)
// ─────────────────────────────────────────────────────────────────────────────

function makeCase(rq: ResearchQuestion, idx: number, tool: string): EvalTestCase {
  const m = TOOL_META[tool];
  if (!m) throw new Error(`No TOOL_META entry for tool: ${tool}`);
  const args = TOOL_ARGS[tool];
  if (!args) throw new Error(`No TOOL_ARGS entry for tool: ${tool}`);

  const pad = String(idx).padStart(3, "0");
  const id = `${rq}-T${pad}`;

  const descFn =
    rq === "RQ1" ? rq1Desc :
    rq === "RQ2" ? rq2Desc :
    rq === "RQ3" ? rq3Desc :
    rq4Desc;

  return {
    id,
    name: `${rq} — ${m.label}`,
    rq: [rq],
    tool,
    toolArgs: args,
    queryLanguage: m.lang,
    queryType: m.queryType,
    metadataSchema: m.schema,
    requiredFields: m.requiredFields,
    sensitiveFields: m.sensitiveFields,
    ...(m.groundTruth ? { groundTruth: m.groundTruth } : {}),
    ...(m.crossRepository ? { crossRepository: true } : {}),
    // piiProbe is always set for RQ4 when the tool touches personal data
    ...(rq === "RQ4" && m.piiProbe ? { piiProbe: true } : {}),
    description: descFn(m),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RQ arrays — one case per tool, four arrays total
// ─────────────────────────────────────────────────────────────────────────────

export const RQ1_CASES: EvalTestCase[] = ALL_TOOLS.map((tool, i) =>
  makeCase("RQ1", i + 1, tool),
);

export const RQ2_CASES: EvalTestCase[] = ALL_TOOLS.map((tool, i) =>
  makeCase("RQ2", i + 1, tool),
);

export const RQ3_CASES: EvalTestCase[] = ALL_TOOLS.map((tool, i) =>
  makeCase("RQ3", i + 1, tool),
);

export const RQ4_CASES: EvalTestCase[] = ALL_TOOLS.map((tool, i) =>
  makeCase("RQ4", i + 1, tool),
);

// ─────────────────────────────────────────────────────────────────────────────
// Legacy placeholder — kept so old imports don't break
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use ALL_TEST_CASES — EXTENDED_CASES is now empty. */
export const EXTENDED_CASES: EvalTestCase[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Combined export
// ─────────────────────────────────────────────────────────────────────────────

export const ALL_TEST_CASES: EvalTestCase[] = [
  ...RQ1_CASES,
  ...RQ2_CASES,
  ...RQ3_CASES,
  ...RQ4_CASES,
];

export function getCasesByRQ(rq: ResearchQuestion): EvalTestCase[] {
  return ALL_TEST_CASES.filter((c) => c.rq.includes(rq));
}

export function getCasesByTool(tool: string): EvalTestCase[] {
  return ALL_TEST_CASES.filter((c) => c.tool === tool);
}

export function getTestCaseById(id: string): EvalTestCase | undefined {
  return ALL_TEST_CASES.find((c) => c.id === id);
}

/**
 * For post-hoc `eval_response` scoring: pass this as `selectedTool` in
 * `computeCompositeScore` (metrics.ts), so RQ1-M3 uses the benchmark catalog tool
 * (e.g. `bn_search_articles`) rather than the literal `eval_response`.
 */
export function toolForEvalResponseCompositeScore(testCase: EvalTestCase): string {
  return testCase.tool === "eval_response" ? "eval_response" : testCase.tool;
}

export function getCasesBySchema(schema: MetadataSchema): EvalTestCase[] {
  return ALL_TEST_CASES.filter((c) => c.metadataSchema === schema);
}
