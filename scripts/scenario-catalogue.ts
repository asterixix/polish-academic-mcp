/**
 * Scenariusze badawcze dla każdej bazy i każdego narzędzia.
 *
 * Każdy scenariusz ma pytanie inne niż zestaw „Babik / Chopin / Sendyka / akcyza 2026”.
 * Kroki wołają natywne narzędzia (tryb granularny). `$nazwa` i `$nazwa:number`
 * w argumentach biorą się z grupy 1 wcześniejszego `capture`. `read` pobiera
 * plik wskazany adresem (PDF, TXT, CSV) i szuka w nim frazy.
 *
 * Uruchomienie: `npx tsx scripts/scenario-all.ts`
 * Jedna baza: `npx tsx scripts/scenario-all.ts --source ruj,isap`
 */

export type ScenarioValue = string | number | boolean | null | ScenarioValue[];

export interface ScenarioStep {
  tool: string;
  args?: Record<string, ScenarioValue>;
  /** Nazwa → wyrażenie regularne z jedną grupą przechwytującą. */
  capture?: Record<string, string>;
  /** Adres do pobrania po kroku. Może zawierać `$nazwa`. */
  read?: { url: string; grep?: string };
  /** Adres wycięty z odpowiedzi tego kroku (grupa 1). */
  readFromOutput?: { pattern: string; grep?: string };
  timeoutMs?: number;
}

export interface Scenario {
  id: string;
  source: string;
  question: string;
  steps: ScenarioStep[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "bn-otwarty-dostep",
    source: "bn",
    question: "Artykuł o otwartym dostępie w polskich czasopismach i jego PDF.",
    steps: [
      {
        tool: "bn_search_publications",
        args: { query: '"otwarty dostęp" czasopismo', page: 1, page_size: 5, publication_types: ["ARTICLE"] },
        capture: { pub: '"publicationId"\\s*:\\s*"(\\d+)"' },
        read: { url: "https://bibliotekanauki.pl/articles/$pub.pdf", grep: "dostęp" },
      },
      {
        tool: "bn_get_article",
        args: { article_id: "$pub", metadata_format: "jats" },
      },
      {
        tool: "bn_search_articles",
        args: { from_date: "2024-02-01", until_date: "2024-02-07", metadata_format: "oai_dc" },
        timeoutMs: 50_000,
      },
    ],
  },
  {
    id: "ruj-informacja-naukowa",
    source: "ruj",
    question: "Prace RUJ o bibliotekoznawstwie i metadane jednego rekordu.",
    steps: [
      {
        tool: "ruj_search",
        args: { query: "bibliotekoznawstwo", page: 0, size: 5 },
        capture: { uuid: '"uuid"\\s*:\\s*"([0-9a-f-]{36})"' },
      },
      { tool: "ruj_get_item", args: { uuid: "$uuid" } },
    ],
  },
  {
    id: "agh-fotowoltaika",
    source: "agh",
    question: "Publikacje AGH o fotowoltaice.",
    steps: [
      {
        tool: "agh_search",
        args: { query: "fotowoltaika", page: 0, size: 5 },
        capture: { uuid: '"uuid"\\s*:\\s*"([0-9a-f-]{36})"' },
      },
      { tool: "agh_get_item", args: { uuid: "$uuid" } },
    ],
  },
  {
    id: "amu-korpusy",
    source: "amu",
    question: "Prace UAM o językoznawstwie korpusowym.",
    steps: [
      {
        tool: "amu_search",
        args: { query: "językoznawstwo korpusowe", page: 0, size: 5 },
        capture: { uuid: '"uuid"\\s*:\\s*"([0-9a-f-]{36})"' },
      },
      { tool: "amu_get_item", args: { uuid: "$uuid" } },
    ],
  },
  {
    id: "uafm-zarzadzanie",
    source: "uafm",
    question: "Czy repozytorium UAFM (eRIKA) odpowiada na zapytanie o zarządzanie projektami.",
    steps: [
      {
        tool: "uafm_search",
        args: { query: "zarządzanie projektami", page: 0, size: 5 },
        capture: { uuid: '"uuid"\\s*:\\s*"([0-9a-f-]{36})"' },
      },
      { tool: "uafm_get_item", args: { uuid: "$uuid" } },
    ],
  },
  {
    id: "icm-meteorologia",
    source: "icm",
    question: "Zbiór danych ICM o meteorologii albo klimacie Polski.",
    steps: [
      {
        tool: "icm_search",
        args: { query: "meteorologia Polska", page: 0, size: 5 },
        capture: { uuid: '"uuid"\\s*:\\s*"([0-9a-f-]{36})"' },
      },
      { tool: "icm_get_item", args: { uuid: "$uuid" } },
    ],
  },
  {
    id: "rodbuk-dziedzictwo",
    source: "rodbuk",
    question: "Zbiory RODBuK o dziedzictwie kulturowym.",
    steps: [
      {
        tool: "rodbuk_search",
        args: { query: "dziedzictwo kulturowe", type: "dataset", per_page: 5, start: 0 },
      },
    ],
  },
  {
    id: "rcin-zbiory",
    source: "rcin",
    question: "Tygodniowy zbiór OAI z RCIN i rekord jednego obiektu.",
    steps: [
      {
        tool: "rcin_search",
        args: { from_date: "2024-03-01", until_date: "2024-03-07", metadata_format: "oai_dc" },
        capture: { record: "oai:rcin\\.org\\.pl:(\\d+)" },
        timeoutMs: 50_000,
      },
      { tool: "rcin_get_record", args: { record_id: "$record", metadata_format: "oai_dc" } },
    ],
  },
  {
    id: "repod-spoleczne",
    source: "repod",
    question: "Zbiór RePOD z badań społecznych i jego karta Dataverse.",
    steps: [
      {
        tool: "repod_search",
        args: { query: "badania społeczne", type: "dataset", per_page: 5, start: 0 },
        capture: { doi: '"global_id"\\s*:\\s*"doi:(10\\.\\d+/[^"]+)"' },
      },
      { tool: "repod_get_dataset", args: { doi: "$doi" } },
    ],
  },
  {
    id: "polon-gdansk",
    source: "polon",
    question: "Uczelnie w Gdańsku oraz kierunki studiów o nazwie historia.",
    steps: [
      { tool: "polon_search", args: { resource: "institutions", result_numbers: 10, city: "Gdańsk" } },
      { tool: "polon_search", args: { resource: "courses", result_numbers: 10, course_name: "historia" } },
    ],
  },
  {
    id: "pbn-humanistyka",
    source: "pbn",
    question: "Publikacje i osoby w PBN dla humanistyki cyfrowej (wymaga kluczy aplikacji).",
    steps: [
      {
        tool: "pbn_search_publications",
        args: { title: "humanistyka cyfrowa", year_from: 2018, year_to: 2025, page: 0, size: 5 },
        capture: { pbnId: '"id"\\s*:\\s*"([0-9a-f]{24})"' },
      },
      { tool: "pbn_get_publication", args: { publication_id: "$pbnId" } },
      { tool: "pbn_search_persons", args: { last_name: "Tokarski", page: 0, size: 5 } },
    ],
  },
  {
    id: "ludzie-etyka-ai",
    source: "ludzie",
    question: "Naukowcy od etyki sztucznej inteligencji oraz profil osoby o nazwisku Tokarski.",
    steps: [
      {
        tool: "ludzie_semantic_search",
        args: { full_query: "etyka sztucznej inteligencji", include_deceased: false },
      },
      {
        tool: "ludzie_search",
        args: { surname: "Tokarski", page: 0, size: 5, include_deceased: true },
        capture: { profile: '"profileId"\\s*:\\s*"([A-Za-z0-9]+)"' },
      },
      { tool: "ludzie_get_scientist", args: { profile_id: "$profile" } },
    ],
  },
  {
    id: "baztol-informatyka",
    source: "baztol",
    question: "Zasoby BazTOL z informatyki i karta jednego zasobu.",
    steps: [
      {
        tool: "baztol_search",
        args: { query: "mechanika", page: 1 },
      },
      {
        tool: "baztol_browse_domain",
        args: { domain_id: 34, page: 1 },
        capture: { resource: '(?:"resource_id"\\s*:\\s*|\\?id=)(\\d+)' },
      },
      { tool: "baztol_get_resource", args: { resource_id: "$resource:number" } },
    ],
  },
  {
    id: "sum-farmacja",
    source: "sum",
    question: "Katalog Biblioteki ŚUM: farmakologia, potem karta pierwszego zestawu.",
    steps: [
      {
        tool: "sum_aleph_find",
        args: { local_base: "SLA01", request: "wrd=farmakologia" },
        capture: { setNo: '"set_number"\\s*:\\s*"(\\d+)"' },
      },
      { tool: "sum_aleph_present", args: { set_no: "$setNo", set_entry: "000000001" } },
    ],
  },
  {
    id: "ppm-farmakologia",
    source: "ppm",
    question: "Polska Platforma Medyczna (ppm.edu.pl): publikacje z farmakologii na ŚUM i karta szczegółowa.",
    steps: [
      {
        tool: "ppm_search",
        args: { query: "farmakologia", resource_type: "publication", institution: "SUM", page: 1 },
        capture: { ppmId: '"id"\\s*:\\s*"([a-zA-Z0-9_-]+/[A-Za-z0-9_-]+)"' },
      },
      { tool: "ppm_get_record", args: { id: "$ppmId" } },
    ],
  },
  {
    id: "dane-zabytki",
    source: "dane",
    question: "Zbiór dane.gov.pl o zabytkach i lista jego zasobów.",
    steps: [
      {
        tool: "dane_search",
        args: { query: "rejestr zabytków", per_page: 5, page: 1, sort: "relevance" },
        capture: { dataset: '"data"\\s*:\\s*\\[\\s*\\{\\s*"id"\\s*:\\s*"(\\d+)"' },
      },
      { tool: "dane_get_dataset", args: { dataset_id: "$dataset:number" } },
    ],
  },
  {
    id: "bdl-malzenstwa",
    source: "bdl",
    question: "Liczba małżeństw i ludność: temat, zmienna, jednostka Wrocław i szereg danych.",
    steps: [
      { tool: "bdl_search_subjects", args: { name: "ludność", page: 0, page_size: 5, lang: "pl" } },
      {
        tool: "bdl_search_variables",
        args: { name: "małżeństwa", page: 0, page_size: 5, lang: "pl" },
        capture: { varId: '"id"\\s*:\\s*(\\d+)' },
      },
      { tool: "bdl_get_variable", args: { variable_id: "$varId:number", lang: "pl" } },
      {
        tool: "bdl_get_data_by_variable",
        args: { variable_id: "$varId:number", unit_level: 2, years: [2022, 2023], page: 0, page_size: 5, lang: "pl" },
      },
      {
        tool: "bdl_search_units",
        args: { name: "Wrocław", page: 0, page_size: 5, lang: "pl" },
        capture: { unitId: '"id"\\s*:\\s*"(\\d{7,14})"' },
      },
      {
        tool: "bdl_get_data_by_unit",
        args: { unit_id: "$unitId", variable_ids: ["$varId:number"], years: [2022], page: 0, page_size: 5, lang: "pl" },
      },
    ],
  },
  {
    id: "imgw-krakow",
    source: "imgw",
    question: "Aktualna pogoda, hydrologia, klimat i ostrzeżenia dla Krakowa.",
    steps: [
      { tool: "imgw_synop", args: { station_name: "krakow" } },
      { tool: "imgw_hydro", args: {} },
      { tool: "imgw_meteo", args: {} },
      { tool: "imgw_warnings", args: { type: "all" } },
    ],
  },
  {
    id: "isap-cyberbezpieczenstwo",
    source: "isap",
    question: "Ustawa o krajowym systemie cyberbezpieczeństwa i tekst ogłoszony.",
    steps: [
      {
        tool: "isap_search_acts",
        args: { title: "krajowym systemie cyberbezpieczeństwa", publisher: "DU", type: "Ustawa", limit: 3 },
        capture: {
          publisher: '"publisher"\\s*:\\s*"(DU|MP)"',
          year: '"year"\\s*:\\s*(\\d{4})',
          pos: '"pos"\\s*:\\s*(\\d+)',
        },
      },
      {
        tool: "isap_get_act",
        args: { eli: "$publisher/$year/$pos" },
        read: { url: "https://api.sejm.gov.pl/eli/acts/$publisher/$year/$pos/text.pdf", grep: "cyber" },
      },
    ],
  },
  {
    id: "saos-wypowiedzenie",
    source: "saos",
    question: "Orzeczenia o wypowiedzeniu umowy o pracę oraz słowniki sądów SAOS.",
    steps: [
      {
        tool: "saos_search_judgments",
        args: {
          all: "wypowiedzenie umowy o pracę",
          judgment_types: ["SENTENCE"],
          judgment_date_from: "2024-01-01",
          judgment_date_to: "2025-12-31",
          page_size: 10,
          page_number: 0,
        },
        capture: { judgment: '"id"\\s*:\\s*(\\d+)' },
      },
      { tool: "saos_get_judgment", args: { judgment_id: "$judgment:number" } },
      { tool: "saos_dump_services", args: {} },
      { tool: "saos_dump_common_courts", args: { page_size: 10, page_number: 0 } },
      { tool: "saos_dump_sc_chambers", args: { page_size: 10, page_number: 0 } },
      { tool: "saos_dump_judgments", args: { page_size: 10, page_number: 0 }, timeoutMs: 45_000 },
      { tool: "saos_dump_enrichments", args: { page_size: 10, page_number: 0 } },
    ],
  },
  {
    id: "bs-sejm-prawo-prasowe",
    source: "bs_sejm",
    question: "Prawo prasowe w katalogu Biblioteki Sejmowej.",
    steps: [
      {
        tool: "bs_sejm_search",
        args: { request: "prawo prasowe", local_base: "bis01", find_code: "WRD" },
        capture: {
          library: "doc_library=([A-Za-z0-9]+)",
          doc: "doc_number=(\\d+)",
        },
      },
      { tool: "bs_sejm_get_item", args: { doc_library: "$library", doc_number: "$doc" } },
    ],
  },
  {
    id: "pkn-dostepnosc",
    source: "pkn",
    question: "Normy PKN o dostępności cyfrowej.",
    steps: [{ tool: "pkn_search", args: { query: "dostępność cyfrowa", page: 1 } }],
  },
  {
    id: "wiedza-ppoz",
    source: "wiedza",
    question: "Norma o ochronie przeciwpożarowej w katalogu WIEDZA.",
    steps: [
      {
        tool: "wiedza_search_norms",
        args: { title: "ochrona przeciwpożarowa" },
        capture: { norm: "(PN(?:-EN)?(?:-ISO)?[\\s\\d:/.-]{4,40})" },
      },
      { tool: "wiedza_get_standard", args: { standard_number: "$norm" } },
    ],
  },
  {
    id: "wolne-lektury-lalka",
    source: "wolnelektury",
    question: "Lalka Prusa: taksonomia, filtr gatunku, książka i kolekcja.",
    steps: [
      { tool: "wolnelektury_list_taxonomy", args: { kind: "authors" } },
      {
        tool: "wolnelektury_filter_books",
        args: { author_slug: "boleslaw-prus", parent_only: true },
        capture: { slug: '"slug"\\s*:\\s*"(lalka[^"]*)"' },
      },
      {
        tool: "wolnelektury_get_book",
        args: { slug: "$slug" },
        readFromOutput: { pattern: "(https://wolnelektury\\.pl/media/book/txt/[^\"]+)", grep: "Wokulski" },
      },
      { tool: "wolnelektury_get_collection", args: { slug: "52-wolne-ksiazki" } },
    ],
  },
  {
    id: "ninateka-warszawa",
    source: "ninateka",
    question: "Materiał Ninateki o Warszawie i karta jednego VOD.",
    steps: [
      {
        tool: "ninateka_search",
        args: { keyword: "Warszawa", limit: 5, first_result: 0 },
        capture: { vod: '"id"\\s*:\\s*(\\d+)' },
      },
      { tool: "ninateka_get_vod", args: { vod_id: "$vod:number" } },
    ],
  },
  {
    id: "gapla-wajda",
    source: "gapla",
    question: "Plakat do filmu Andrzeja Wajdy.",
    steps: [
      {
        tool: "gapla_search",
        args: { q: "Wajda", typ: "rezyseria", page: 1 },
        capture: { poster: "plakat/(\\d+)" },
      },
      { tool: "gapla_get_poster", args: { poster_id: "$poster:number" } },
    ],
  },
  {
    id: "fototeka-wajda",
    source: "fototeka",
    question: "Kadry filmowe Wajdy w Fototece FINA.",
    steps: [
      {
        tool: "fototeka_search",
        args: { query: "Wajda", page: 1, per_page: 5 },
        capture: { photo: "/foto/view/(\\d+)" },
      },
      { tool: "fototeka_get_photo", args: { photo_id: "$photo:number" } },
    ],
  },
  {
    id: "filmpolski-zanussi",
    source: "filmpolski",
    question: "Filmografia Krzysztofa Zanussiego.",
    steps: [
      {
        tool: "filmpolski_search",
        args: { query: "Zanussi", match_mode: "fragment" },
        capture: { item: '"id"\\s*:\\s*"(\\d+)"' },
      },
      { tool: "filmpolski_get_item", args: { item_id: "$item:number" } },
    ],
  },
  {
    id: "fototeka-slaska-nikisz",
    source: "fototekaslaska",
    question: "Zdjęcia z Opola w Fototece Śląskiej.",
    steps: [
      {
        tool: "fototekaslaska_search",
        args: { query: "Opole", field: "place", page: 1 },
        capture: { slug: '"slug"\\s*:\\s*"([^"]+)"' },
      },
      { tool: "fototekaslaska_get_photo", args: { slug: "$slug" } },
    ],
  },
  {
    id: "fn-repo-pkf",
    source: "fn_repo",
    question: "Polska Kronika Filmowa: szukanie, karta węzła, indeks na A i rodzaj dokumentalny.",
    steps: [
      {
        tool: "fn_repo_search",
        args: { query: "Polska Kronika Filmowa" },
        capture: { node: '(?:node/|"node_id"\\s*:\\s*)(\\d+)' },
      },
      { tool: "fn_repo_get_node", args: { node_id: "$node:number" } },
      { tool: "fn_repo_film_index", args: { letter: "A" } },
      { tool: "fn_repo_browse_kind", args: { kind: "dokumentalny" } },
    ],
  },
  {
    id: "nac-powstanie",
    source: "nac",
    question: "Digitalizacja i powstanie warszawskie w serwisie NAC oraz kanał aktualności.",
    steps: [
      {
        tool: "nac_news_rss",
        args: {},
        capture: { rssPost: "[?&]p=(\\d+)" },
      },
      {
        tool: "nac_site_search",
        args: { query: "powstanie warszawskie", per_page: 5 },
        capture: { pageId: '"id"\\s*:\\s*(\\d+)' },
      },
      { tool: "nac_get_post", args: { post_id: "$rssPost:number" } },
      { tool: "nac_get_page", args: { page_id: "$pageId:number" } },
    ],
  },
  {
    id: "pauart-matejko",
    source: "pauart",
    question: "Dzieło Jana Matejki w PAUart.",
    steps: [
      {
        tool: "pauart_search",
        args: { query: "Matejko", page: 1 },
        capture: { art: '"id"\\s*:\\s*"([A-Z0-9_]+)"' },
      },
      { tool: "pauart_get_artwork", args: { artwork_id: "$art" } },
    ],
  },
  {
    id: "blz-biblioteki",
    source: "blz",
    question: "Legalne źródła: kategorie, biblioteka cyfrowa i karta jednego wpisu.",
    steps: [
      { tool: "blz_listing_categories", args: {} },
      {
        tool: "blz_search",
        args: { query: "biblioteka cyfrowa", page: 1 },
        capture: { listing: '"id"\\s*:\\s*(\\d+)' },
      },
      { tool: "blz_get_listing", args: { listing_id: "$listing:number" } },
    ],
  },
  {
    id: "dokumenty-slaska-katalog",
    source: "dokumenty_slaska",
    question: "Średniowieczny katalog Dokumentów Śląska i jedna strona indeksu.",
    steps: [
      { tool: "dokumenty_slaska_medieval_catalog", args: {} },
      { tool: "dokumenty_slaska_get_page", args: { path: "indeks 1200.html" } },
    ],
  },
  {
    id: "jbc-kochanowski",
    source: "jbc",
    question: "Treny Kochanowskiego w Jagiellońskiej Bibliotece Cyfrowej, odczyt OCR/HTR skanu 8,8 MB bez warstwy tekstowej.",
    steps: [
      {
        tool: "jbc_search",
        args: { query: "Kochanowski Treny", page: 1, size: 3 },
        capture: { element: '"elementId"\\s*:\\s*"(\\d+)"' },
        timeoutMs: 45_000,
      },
      {
        tool: "jbc_get_publication",
        args: { id: "$element" },
        timeoutMs: 45_000,
      },
      {
        tool: "jbc_ocr_htr",
        args: { id: "$element", page_start: 3, page_end: 3, lang: "pl", include_images: true },
        timeoutMs: 60_000,
      },
    ],
  },
  {
    id: "sbc-slask",
    source: "sbc",
    question: "Wydawnictwa o przemyśle Górnego Śląska w Śląskiej Bibliotece Cyfrowej.",
    steps: [
      {
        tool: "sbc_search",
        args: { query: "Górny Śląsk przemysł", page: 1, size: 3 },
        capture: { element: '"elementId"\\s*:\\s*"(\\d+)"' },
        timeoutMs: 45_000,
      },
      { tool: "sbc_get_publication", args: { id: "$element" }, timeoutMs: 45_000 },
    ],
  },
  {
    id: "fbc-mickiewicz",
    source: "fbc",
    question: "Pan Tadeusz Mickiewicza w Federacji Bibliotek Cyfrowych.",
    steps: [
      {
        tool: "fbc_search",
        args: { query: "Mickiewicz Pan Tadeusz", page: 1, size: 3 },
        capture: { element: '"elementId"\\s*:\\s*"([^"]+)"' },
        timeoutMs: 45_000,
      },
      { tool: "fbc_get_record", args: { id: "$element" }, timeoutMs: 45_000 },
    ],
  },
  {
    id: "pbm-moniuszko",
    source: "pbm",
    question: "Nuty i hasło encyklopedyczne Stanisława Moniuszki.",
    steps: [
      {
        tool: "pbm_search",
        args: { query: "Moniuszko", section: "scores", page: 1, per_page: 5 },
        capture: { art: "/art/(\\d+)" },
      },
      { tool: "pbm_get_item", args: { id: "$art", kind: "art" } },
      { tool: "pbm_search", args: { query: "Moniuszko", section: "encyclopedia", page: 1, per_page: 3 } },
      { tool: "pbm_search", args: { query: "Moniuszko", section: "photos", page: 1, per_page: 3 } },
    ],
  },
  {
    id: "swa-krakow-asc",
    source: "swa",
    question: "Akta stanu cywilnego Krakowa w Szukaj w Archiwach.",
    steps: [
      {
        tool: "swa_search",
        args: { query: "Akta stanu cywilnego Kraków" },
        capture: { unit: "/jednostka/-/jednostka/(\\d+)" },
      },
      { tool: "swa_get_unit", args: { id: "$unit", kind: "jednostka" } },
    ],
  },
  {
    id: "gwa-kowalski",
    source: "gwa",
    question: "Osoby o nazwisku Kowalski w Genealogii w Archiwach.",
    steps: [
      { tool: "gwa_search", args: { query: "Kowalski", query_type: "PERSON", page: 1 }, timeoutMs: 45_000 },
    ],
  },
  {
    id: "plock-zielinski",
    source: "plock_genea",
    question: "Metryki nazwiska Zieliński w bazie GENEA AP Płock.",
    steps: [
      { tool: "plock_genea_search", args: { query: "Zieliński", max_rows: 15 }, timeoutMs: 90_000 },
    ],
  },
  {
    id: "ekartoteka-nowak",
    source: "ekartoteka",
    question: "Karty meldunkowe Nowaków w Poznaniu.",
    steps: [
      {
        tool: "ekartoteka_search",
        args: { query: "Nowak", search_mode: "exact", page: 1 },
        readFromOutput: { pattern: "(https://photos\\.szukajwarchiwach\\.gov\\.pl/[^\\s\"']+)" },
      },
    ],
  },
  {
    id: "powstanie-wielkopolskie",
    source: "archiwum_powstania",
    question: "Biogram powstańca wielkopolskiego o nazwisku Kowalski.",
    steps: [
      {
        tool: "archiwum_powstania_search",
        args: { query: "Kowalski" },
        capture: { path: "\\[([^\\]]*(?:record|person)[^\\]]*)\\]|(/pl/record\\?[^\\s\"]+)" },
      },
      { tool: "archiwum_powstania_get_record", args: { id: "$path" } },
    ],
  },
  {
    id: "warszawa-rha",
    source: "warszawa_ap",
    question: "Firma Wedel w Rejestrze Handlowym AP Warszawa oraz indeks metrykalny Grodziska.",
    steps: [
      { tool: "warszawa_ap_search", args: { query: "Wedel", database: "rha", kryterium_rha: "firma" } },
      { tool: "warszawa_ap_search", args: { query: "Kowalski", database: "grodzisk", imie: "Jan" } },
    ],
  },
  {
    id: "zamosc-ludnosc",
    source: "zamosc_ap",
    question: "Mieszkańcy Zamościa o nazwisku Kowalski.",
    steps: [{ tool: "zamosc_ap_search", args: { query: "Kowalski" } }],
  },
  {
    id: "jency-kowalski",
    source: "archiwa_jency",
    question: "Jeniec wojenny o nazwisku Kowalski i jego karta.",
    steps: [
      {
        tool: "archiwa_jency_search",
        args: { query: "Kowalski", page: 1 },
        capture: { jeniec: '"id"\\s*:\\s*"?(\\d+)"?|/jency-baza-danych/(\\d+)' },
      },
      { tool: "archiwa_jency_get_record", args: { id: "$jeniec" } },
    ],
  },
  {
    id: "dziedzictwo-polonika",
    source: "archiwa_dziedzictwo",
    question: "Polonika związane z Warszawą w bazie Dziedzictwo.",
    steps: [
      {
        tool: "archiwa_dziedzictwo_search",
        args: { query: "Warszawa", page: 1 },
        capture: { rec: '"id"\\s*:\\s*"?(\\d+)"?|/ndap-entry/(\\d+)' },
      },
      { tool: "archiwa_dziedzictwo_get_record", args: { id: "$rec" } },
    ],
  },
  {
    id: "straty-kowalski",
    source: "straty",
    question: "Osoba represjonowana Jan Kowalski, ur. w Warszawie, i jej ankieta.",
    steps: [
      {
        tool: "straty_search",
        args: { query: "Kowalski", imie: "Jan", miejsce_urodzenia: "Warszawa" },
        capture: { person: "\\bid(\\d{3,})" },
      },
      { tool: "straty_get_person", args: { id: "$person" } },
    ],
  },
  {
    id: "agad-lwow-dorpat",
    source: "agad",
    question: "Gminy żydowskie Lwowa (Michalewicz) i Polacy na uniwersytecie w Dorpacie.",
    steps: [
      { tool: "agad_search", args: { query: "Lwów", collection: "michalewicz" }, timeoutMs: 60_000 },
      { tool: "agad_search", args: { query: "Kowalski", collection: "szukaj", zbior: 45 } },
    ],
  },
  {
    id: "postdiploma-ryga",
    source: "postdiploma",
    question: "Studenci Politechniki Ryskiej o nazwisku Kowalski.",
    steps: [
      { tool: "postdiploma_search", args: { query: "Kowalski", dataset: "ryga" }, timeoutMs: 45_000 },
    ],
  },
  {
    id: "lublin-meldunki",
    source: "lublin_ap",
    question: "Kowalskich w księgach meldunkowych Lublina.",
    steps: [
      { tool: "lublin_ap_search", args: { query: "Kowalski", city: "lublin", imie: "Jan" } },
    ],
  },
  {
    id: "opole-lewin",
    source: "opole_ap",
    question: "Ewidencja AP Opole dla nazwiska Lewin.",
    steps: [{ tool: "opole_ap_search", args: { query: "Lewin" } }],
  },
  {
    id: "piotrkow-indeksy",
    source: "piotrkow_ap",
    question: "Indeksy metrykalne AP Piotrków Trybunalski i jeden wykaz PDF.",
    steps: [
      {
        tool: "piotrkow_ap_search",
        args: { query: "metryk" },
        readFromOutput: { pattern: "(https://www\\.piotrkow-tryb\\.ap\\.gov\\.pl/index\\.php\\?c=getfile&id=\\d+)" },
      },
    ],
  },
];

export function toolsUsedByScenarios(scenarios: Scenario[] = SCENARIOS): Set<string> {
  const names = new Set<string>();
  for (const scenario of scenarios) {
    for (const step of scenario.steps) names.add(step.tool);
  }
  return names;
}
