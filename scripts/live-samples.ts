/** Minimal schema-valid arguments used by the live smoke runner. */
export const LIVE_SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  // ── DSpace 7 repos (AGH, AMU, ICM, RUJ, UAFM) ───────────────────────────
  // schema: query(required), page(0-based, default 0), size(1-50, default 10)
  // optional filters: author, subject, language, itemtype, has_full_text, etc.
  agh_search: { query: "inżynieria materiałowa", page: 0, size: 10 },
  agh_get_item: { uuid: "e2f47fce-f8f8-43a4-93c9-29296072fd9f" },

  amu_search: { query: "pedagogika wczesnoszkolna", page: 0, size: 10 },
  amu_get_item: { uuid: "63a04a74-bd5d-465b-9346-d9da30483988" },

  // ICM: same DSpace 7 schema; has_full_text is a boolean filter
  icm_search: { query: "climate change Poland", page: 0, size: 10, has_full_text: true },
  icm_get_item: { uuid: "9dc637c8-19f9-493c-8c27-591657eb7df5" },

  // RUJ: richest filter set — affiliation, journal_title, pbn_discipline, minimize_pii
  ruj_search: { query: "uczenie maszynowe", page: 0, size: 10, language: "pl" },
  ruj_get_item: { uuid: "c59bc99f-5ee8-4e9d-82db-8baddaaf83c4" },

  uafm_search: { query: "zarządzanie projektami", page: 0, size: 10 },
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
  baztol_search: { query: "informatyka", page: 1 },
  baztol_browse_domain: { domain_id: 24, page: 1 },
  baztol_get_resource: { resource_id: 1 },

  // ── BDL (GUS) ────────────────────────────────────────────────────────────
  // bdl_search_subjects: name fragment, 0-based page
  bdl_search_subjects: { name: "ludność", page: 0, page_size: 20, lang: "pl" },
  // bdl_search_variables: optional name/subject_id; 0-based page
  bdl_search_variables: { name: "bezrobocie", page: 0, page_size: 20, lang: "pl" },
  // bdl_search_units: optional name/levels; 0-based page
  bdl_search_units: { name: "Kraków", page: 0, page_size: 20, lang: "pl" },
  // bdl_get_variable: numeric variable_id (positive int)
  bdl_get_variable: { variable_id: 60559, lang: "pl" },
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
  blz_search: { query: "prawo autorskie", page: 1 },
  blz_get_listing: { listing_id: 18804 },

  // ── Sejm Library (Biblioteka Sejmowa) ────────────────────────────────────
  // bs_sejm_search: request + local_base are required; find_code defaults to WRD
  bs_sejm_search: {
    request: "konstytucja Rzeczypospolitej",
    local_base: "bis01",
    find_code: "WRD",
  },
  // bs_sejm_get_item: doc_library (uppercase, e.g. BIS01) + doc_number (zero-padded)
  bs_sejm_get_item: { doc_library: "B153504", doc_number: "000179010" },

  // ── dane.gov.pl ──────────────────────────────────────────────────────────
  // dane_search: query required, page 1-based
  dane_search: { query: "jakość powietrza", per_page: 20, page: 1, sort: "relevance" },
  dane_get_dataset: { dataset_id: 1 },

  // ── Dokumenty Śląska ─────────────────────────────────────────────────────
  dokumenty_slaska_medieval_catalog: {},
  dokumenty_slaska_get_page: { path: "indeks 1200.html" },

  // ── FilmPolski ───────────────────────────────────────────────────────────
  // filmpolski_search: query + match_mode (fragment/start/exact)
  filmpolski_search: { query: "Wajda", match_mode: "fragment" },
  filmpolski_get_item: { item_id: 1274081 },

  // ── Filmoteka Narodowa repo ───────────────────────────────────────────────
  fn_repo_search: { query: "dokumentalny" },
  fn_repo_get_node: { node_id: 8937 },
  fn_repo_browse_kind: { kind: "documentary" },
  fn_repo_film_index: { letter: "A" },

  // ── Fototeka (FINA) ──────────────────────────────────────────────────────
  fototeka_search: { query: "teatr Warszawa", page: 1, per_page: 10 },
  fototeka_get_photo: { photo_id: 13426 },

  // ── Fototeka Śląska ──────────────────────────────────────────────────────
  fototekaslaska_search: { query: "Katowice", page: 1 },
  fototekaslaska_get_photo: { slug: "rowerzysci-11" },

  // ── GAPLA (poster archive) ───────────────────────────────────────────────
  gapla_search: { q: "plakat filmowy", page: 1 },
  gapla_get_poster: { poster_id: 1 },

  // ── IMGW ─────────────────────────────────────────────────────────────────
  // imgw_synop: both params optional; station_name without diacritics
  imgw_synop: { station_name: "warszawa" },
  imgw_hydro: {},
  imgw_meteo: {},
  imgw_warnings: { type: "all" },

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
  ludzie_search: { surname: "Kowalski", page: 0, size: 10, include_deceased: false },
  // ludzie_semantic_search: full_query required
  ludzie_semantic_search: {
    full_query: "sztuczna inteligencja przetwarzanie języka",
    include_deceased: false,
  },
  // ludzie_get_scientist: scientist_id (numeric, from search results)
  ludzie_get_scientist: { scientist_id: 21341 },

  // ── NAC (Narodowe Archiwum Cyfrowe) ──────────────────────────────────────
  nac_news_rss: {},
  nac_site_search: { query: "digitalizacja zbiorów", per_page: 10 },
  nac_get_post: { post_id: 12965 },
  nac_get_page: { page_id: 11598 },

  // ── Ninateka ─────────────────────────────────────────────────────────────
  ninateka_search: { query: "film dokumentalny", page: 1 },
  ninateka_get_vod: { vod_id: 180 },

  // ── PAUart ───────────────────────────────────────────────────────────────
  pauart_search: { query: "malarstwo polskie XIX wiek", page: 1 },
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
  rcin_search: { from_date: "2023-01-01", metadata_format: "oai_dc" },
  // rcin_get_record: identifier as OAI id or plain numeric id
  rcin_get_record: { identifier: "oai:rcin.org.pl:238456" },

  // ── RePOD ────────────────────────────────────────────────────────────────
  // repod_search: query required; type optional enum
  repod_search: { query: "climate Poland", type: "dataset", per_page: 10, start: 0 },
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
  saos_dump_sc_chambers: { page_size: 20, page_number: 0 },
  saos_dump_judgments: { page_size: 10, page_number: 0 },
  saos_dump_enrichments: { page_size: 20, page_number: 0 },

  // ── SUM Aleph ────────────────────────────────────────────────────────────
  // sum_aleph_find: local_base defaults to SUM01; request uses WWW prefix syntax
  sum_aleph_find: { local_base: "SUM01", request: "wrd=kardiologia" },
  // sum_aleph_present: set_no + set_entry from a prior find result
  sum_aleph_present: { set_no: "000001", set_entry: "000001" },

  // ── WIEDZA PKN ───────────────────────────────────────────────────────────
  wiedza_search_norms: { query: "bezpieczeństwo informacji" },
  wiedza_get_standard: { catalog_number: "PN-EN ISO/IEC 27001" },

  // ── Wolne Lektury ────────────────────────────────────────────────────────
  // wolnelektury_list_taxonomy: kind is required enum
  wolnelektury_list_taxonomy: { kind: "epochs" },
  // wolnelektury_get_book: slug required (from catalog URL or taxonomy)
  wolnelektury_get_book: { slug: "pan-tadeusz" },
  // wolnelektury_get_collection: slug required
  wolnelektury_get_collection: { slug: "52-wolne-ksiazki" },
  // wolnelektury_filter_books: at least one of author_slug/epoch_slug/genre_slug/kind_slug
  wolnelektury_filter_books: { genre_slug: "powiesc", parent_only: true },
};
