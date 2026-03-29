# Polish Academic MCP

[![SafeSkill 82/100](https://img.shields.io/badge/SafeSkill-82%2F100_Passes%20with%20Notes-yellow)](https://safeskill.dev/scan/asterixix-polish-academic-mcp)

Zdalny serwer MCP działający na Cloudflare Workers, który udostępnia wiele polskich baz danych i serwisów publicznych jako narzędzia wywoływane przez AI.

> **MCP** (Model Context Protocol) to otwarty standard pozwalający modelom językowym (Claude, GPT, Bielik.AI itp.) na wywoływanie zewnętrznych narzędzi i API w ustandaryzowany sposób.

**WAŻNE!** Serwer zdalny (link do cloudflare) zbiera domyślnie anonimowe dane ewaluacyjne z każdego zapytania narzędzia MCP jako dane do dalszych badań i ewaluacji, czyli jak używasz tego narzędzia to tak jakbyś wypełniał dla mnie ankietę do badań <3 Dzięki za zrozumienie! 

Jeśli nie chcesz przekazywać mi danych badawczych wystarczy odpalić serwer lokalnie ;)

---

## Autoreklama: Token JWT i wsparcie dla OAuth

Jeśli interesuje Ciebie większy rate limiting i w tym wsparcie do OAuth co da ci możliwość podpiąć MCP np. pod Perplexity to napisz na [artur@sendyka.dev](mailto:artur@sendyka.dev) z zapytaniem. Jeśli wykorzystanie będzie znaczne (no tak powyżej 100 requestów na dobę) czy komercyjne to niestety będzie to już odpłatne.

---

## Dostępne bazy danych i narzędzia

| Narzędzie                 | Baza danych                                                  | Opis                                                                 |
| ------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `bn_search_publications`  | [Biblioteka Nauki](https://bibliotekanauki.pl)               | Wyszukiwanie pełnotekstowe (API JSON portalu — frazy, tytuły, abstrakty) |
| `bn_search_articles`      | Biblioteka Nauki                                             | Listowanie rekordów OAI-PMH (`ListRecords`) po datach i/lub zbiorze czasopisma — **bez** zapytań słownych |
| `bn_get_article`          | Biblioteka Nauki                                             | Pobranie metadanych pojedynczego artykułu po ID (OAI-PMH `GetRecord`)    |
| `rcin_search`             | [RCIN — Repozytorium Cyfrowe Instytutów Naukowych](https://rcin.org.pl/dlibra) | OAI-PMH `ListRecords` (metadane obiektów; opcjonalnie zakres dat / zbiór OAI) |
| `rcin_get_record`         | RCIN                                                         | OAI-PMH `GetRecord` po ID lub `oai:rcin.org.pl:…`                    |
| `ruj_search`         | [RUJ — Repozytorium UJ](https://ruj.uj.edu.pl)               | Wyszukiwanie publikacji z Repozytorium Jagiellońskiego          |
| `ruj_get_item`       | RUJ                                                          | Pobranie metadanych pozycji po UUID                             |
| `agh_search`         | [AGH — Repozytorium AGH](https://repo.agh.edu.pl)            | Wyszukiwanie prac i publikacji AGH w Krakowie                   |
| `agh_get_item`       | AGH                                                          | Pobranie metadanych pozycji po UUID                             |
| `amu_search`         | [AMU — Repozytorium UAM](https://repozytorium.amu.edu.pl)    | Wyszukiwanie publikacji Uniwersytetu Adama Mickiewicza          |
| `amu_get_item`       | AMU                                                          | Pobranie metadanych pozycji po UUID                             |
| `uafm_search`        | [UAFM — Repozytorium UAFM](https://repozytorium.uafm.edu.pl) | Wyszukiwanie publikacji Akademii Nauk Stosowanych w Nowym Sączu |
| `uafm_get_item`      | UAFM                                                         | Pobranie metadanych pozycji po UUID                             |
| `icm_search`         | [ICM — Otwarte Dane Badawcze UW](https://open.icm.edu.pl)    | Wyszukiwanie danych badawczych ICM UW                           |
| `icm_get_item`       | ICM                                                          | Pobranie metadanych pozycji po UUID                             |
| `rodbuk_search`      | [RODBuK](https://rodbuk.pl)                                  | Wyszukiwanie zbiorów danych badawczych uczelni krakowskich      |
| `repod_search`       | [RePOD](https://repod.icm.edu.pl)                            | Wyszukiwanie polskich otwartych danych badawczych               |
| `repod_get_dataset`  | RePOD                                                        | Pobranie metadanych zbioru danych po DOI                        |
| `dane_search`        | [dane.gov.pl](https://dane.gov.pl)                           | Wyszukiwanie danych otwartych z portalu rządowego               |
| `dane_get_dataset`   | dane.gov.pl                                                  | Pobranie szczegółów zbioru danych po ID                         |
| `polon_search`          | [POL-on / RAD-on](https://radon.nauka.gov.pl/opendata/polon) | Zbiory otwarte: uczelnie, pracownicy, projekty, publikacje, kursy (JSON, token strony) |
| `pbn_search_publications` | [PBN — Polska Bibliografia Naukowa](https://pbn.nauka.gov.pl/api/) | Wyszukiwanie publikacji (JSON; wymaga `PBN_APP_ID` + `PBN_APP_TOKEN`) |
| `pbn_search_persons`    | PBN                                                          | Wyszukiwanie osób / ORCID (JSON; te same nagłówki co wyżej)        |
| `pbn_get_publication`   | PBN                                                          | Metadane publikacji po id obiektu (JSON)                           |
| `bdl_search_subjects`   | [BDL — Bank Danych Lokalnych (GUS)](https://bdl.stat.gov.pl/BDL/start) | Wyszukiwanie tematów (subjectów) po fragmencie nazwy (API v1)   |
| `bdl_search_variables`  | BDL / GUS                                                    | Wyszukiwanie zmiennych statystycznych (cech)                    |
| `bdl_search_units`      | BDL / GUS                                                    | Wyszukiwanie jednostek terytorialnych (TERYT itd.)               |
| `bdl_get_variable`      | BDL / GUS                                                    | Metadane jednej zmiennej po id liczbowym                         |
| `bdl_get_data_by_variable` | BDL / GUS                                                 | Wartości dla jednej zmiennej po jednostkach (np. województwa)    |
| `bdl_get_data_by_unit`  | BDL / GUS                                                    | Wartości dla jednej jednostki i wskazanych zmiennych             |
| `imgw_synop`         | [IMGW-PIB](https://danepubliczne.imgw.pl)                    | Aktualne odczyty ze stacji synoptycznych (pogodowych)           |
| `imgw_hydro`         | IMGW-PIB                                                     | Aktualne odczyty z wodowskazów i stacji hydrologicznych         |
| `imgw_meteo`         | IMGW-PIB                                                     | Aktualne odczyty ze stacji meteorologicznych                    |
| `imgw_warnings`      | IMGW-PIB                                                     | Aktywne ostrzeżenia meteorologiczne i hydrologiczne             |
| `pkn_search`              | [PKN — Polski Komitet Normalizacyjny](https://www.pkn.pl)    | Wyszukiwarka treści strony www.pkn.pl (Drupal / Solr, HTML)      |
| `wiedza_search_norms`     | [WIEDZA — PKN](https://wiedza.pkn.pl)                        | Wyszukiwarka norm (Liferay; sesja + POST, HTML)                   |
| `wiedza_get_standard`     | WIEDZA                                                       | Karta pojedynczej normy po numerze katalogowym (HTML)            |
| `blz_search`              | [Baza Legalnych Źródeł](https://bazalegalnychzrodel.pl) (Legalna Kultura) | WordPress REST `/wp/v2/listings` — źródła kultury cyfrowej (JSON) |
| `blz_get_listing`         | Baza Legalnych Źródeł                                        | Pojedyncze źródło po ID (JSON)                                   |
| `blz_listing_categories`  | Baza Legalnych Źródeł                                        | Taksonomia `listing_cat` (Filmy, Muzyka, Biblioteki…) — ID do `blz_search` |
| `baztol_search`           | [BazTOL — brama zasobów PUT](https://baztol.library.put.poznan.pl) | Wyszukiwanie pełnotekstowe (HTML; katalog nieaktualizowany od 2022) |
| `baztol_browse_domain`    | BazTOL                                                       | Przeglądanie po dziedzinie (id z menu)                            |
| `baztol_get_resource`     | BazTOL                                                       | Szczegóły zasobu po ID (HTML)                                     |
| `nac_news_rss`            | [NAC — Narodowe Archiwum Cyfrowe](https://www.nac.gov.pl/)    | Kanał RSS aktualności instytucji (XML)                             |
| `nac_site_search`       | NAC                                                          | Wyszukiwarka WordPress REST `/wp-json/wp/v2/search` (posty/strony; JSON) |
| `nac_get_post`          | NAC                                                          | Pojedynczy wpis blogowy po id (JSON)                               |
| `nac_get_page`          | NAC                                                          | Pojedyncza strona statyczna po id (JSON)                           |
| `sum_aleph_find`        | [Katalog Biblioteki ŚUM](https://katalog.sum.edu.pl/) (Aleph) | X-Services `op=find` — zapytanie WWW (`wrd=`, `wti=`…; XML; możliwy błąd SRU po stronie serwera) |
| `sum_aleph_present`     | Katalog ŚUM / Aleph                                         | X-Services `op=present` — rekord(y) MARC/XML (`set_no`, `set_entry`) |
| `ludzie_search`           | [Ludzie Nauki](https://ludzie.nauka.gov.pl)                  | Wyszukiwanie profili naukowców (nazwisko, dziedzina, paginacja)  |
| `ludzie_semantic_search`  | Ludzie Nauki                                                 | Wyszukiwanie semantyczne / pełnotekstowe po frazie                |
| `ludzie_get_scientist`    | Ludzie Nauki                                                 | ORCID, stopnie/tytuły, słowa kluczowe dla profilu po ID            |
| `pauart_search`           | [PAUart — PAU](http://www.pauart.pl/app)                    | Wyszukiwanie katalogu dzieł (Collectio / PAU)                       |
| `pauart_get_artwork`      | PAUart                                                       | Metadane pojedynczego dzieła po ID z katalogu                       |
| `isap_search_acts`        | [ISAP — ELI API Sejmu](https://api.sejm.gov.pl/eli/openapi/) | Wyszukiwanie aktów prawnych (tytuł, słowa kluczowe ISAP, daty, DU/MP itd.) |
| `isap_get_act`            | ISAP / ELI                                                   | Metadane pojedynczego aktu po ELI, np. `DU/2026/370`                 |
| `bs_sejm_search`          | [Biblioteka Sejmowa — OPAC](https://bs.sejm.gov.pl/F)        | Wyszukiwanie słowne (`func=find-b`); zwraca HTML listy (np. `bis01`, `pos01`) |
| `bs_sejm_get_item`        | Biblioteka Sejmowa                                           | Karta bibliograficzna (`func=item-global`) po `doc_library` + `doc_number` — HTML |
| `saos_search_judgments`   | [SAOS](https://www.saos.org.pl/help/index.php/dokumentacja-api/api-przeszukiwania-danych) | Wyszukiwanie orzeczeń (fraza `all`, daty, sygnatura, sąd, typ orzeczenia) |
| `saos_get_judgment`       | SAOS / API przeglądania                                     | Pełne orzeczenie po id liczbowym z wyszukiwarki                        |
| `saos_dump_services`      | SAOS / [API pobierania](https://www.saos.org.pl/help/index.php/dokumentacja-api/api-pobierania-danych) | Lista endpointów hurtowego pobierania (dump)                         |
| `saos_dump_common_courts` | SAOS — dump                                                 | Słownik sądów powszechnich (stronicowanie)                           |
| `saos_dump_sc_chambers`   | SAOS — dump                                                 | Słownik izb SN (stronicowanie)                                       |
| `saos_dump_judgments`     | SAOS — dump                                                 | Hurtowe orzeczenia (filtry dat / synchronizacja; duże odpowiedzi)     |
| `saos_dump_enrichments`   | SAOS — dump                                                 | Etykiety modułu wzbogacania (stronicowanie)                          |
| `wolnelektury_list_taxonomy` | [Wolne Lektury](https://wolnelektury.pl/api/)              | Słowniki: autorzy, epoki, gatunki, rodzaje, motywy, kolekcje (slugi) |
| `wolnelektury_filter_books` | Wolne Lektury                                               | Lista utworów po filtrach (autor/epoka/gatunek/rodzaj); nie woła `/api/books/` w całości |
| `wolnelektury_get_book`      | Wolne Lektury                                               | Metadane i linki do plików po slugu utworu                           |
| `wolnelektury_get_collection` | Wolne Lektury                                              | Kolekcja tematyczna + lista książek w kolekcji                      |
| `ninateka_search`         | [Ninateka — FINA VOD](https://ninateka.pl/)                  | Wyszukiwanie materiałów po słowie kluczowym (JSON API frontu; `platform=BROWSER`) |
| `ninateka_get_vod`        | Ninateka                                                    | Metadane pojedynczego materiału po id liczbowym z wyszukiwarki (JSON)  |
| `gapla_search`            | [Gapla — galeria plakatu filmowego FINA](https://gapla.fn.org.pl/) | Wyszukiwanie plakatów (`szukaj.html` — tytuł / autor / reżyseria; HTML) |
| `gapla_get_poster`        | Gapla                                                       | Strona pojedynczego plakatu po id (`plakat/{id}.html` — HTML)         |
| `fototeka_search`         | [Fototeka — FN INA](https://fototeka.fn.org.pl/)            | Wyszukiwanie fotosów i zdjęć (`wyszukiwarka.html` — tytuł / osoba / reżyseria / słowa kluczowe; HTML, paginacja `pageNumber` / `howmany`) |
| `fototeka_get_photo`      | Fototeka                                                    | Strona pojedynczego zdjęcia po id (`/pl/foto/view/{id}.html` — HTML)    |
| `filmpolski_search`       | [FilmPolski.pl](https://www.filmpolski.pl/fp/) (PWSFTviT)    | Wyszukiwarka bazy filmu (`index.php?szukaj=&rodzaj=` — HTML parsowane do JSON: osoby, filmy; tryby fragment / początek / dokładnie) |
| `filmpolski_get_item`     | FilmPolski.pl                                               | Karta rekordu po id (`index.php/{id}`) — tekst z `<article id="film|osoba">` (obcięty) |
| `fototekaslaska_search`   | [Fototeka Śląska](https://fototekaslaska.pl/) (MWO Opole)    | Wyszukiwanie zdjęć (WordPress GET `?s=&t=&y=`; HTML z `.search-list` → JSON: slug, URL, podpis, miniatura) |
| `fototekaslaska_get_photo` | Fototeka Śląska                                            | Strona rekordu `/galeria/{slug}/` — tytuł, nr katalogowy, URL zdjęcia, opis i tabela (tekst) |
| `fn_repo_search`          | [Repozytorium FN](https://repozytorium.fn.org.pl/)          | Wyszukiwanie Solr (HTML — kafelki wyników; brak publicznego JSON API) |
| `fn_repo_get_node`        | Repozytorium FN                                             | Karta rekordu po id węzła Drupal (`/?q=pl/node/{id}` — HTML)        |
| `fn_repo_film_index`      | Repozytorium FN                                             | Indeks tytułów po pierwszej literze (A–Ż / INNE — HTML)             |
| `fn_repo_browse_kind`     | Repozytorium FN                                             | Przegląd: fabularne / dokumentalne / animacje / magazyn (HTML)      |
| `dokumenty_slaska_get_page` | [Dokumenty Śląska](https://www.dokumentyslaska.pl/)     | Pobranie pojedynczej strony statycznej po ścieżce względnej (`indeks …`, `dokument …`, podkatalogi — HTML) |
| `dokumenty_slaska_medieval_catalog` | Dokumenty Śląska                                  | Lista JSON ścieżek do głównej serii dokumentów średniowiecznych (okresy do 1333 r.) — pomoc nawigacyjna |
| `eval_response`           | — (lokalnie)                                                | Ewaluacja odpowiedzi modelu względem rekordu źródłowego (RQ2)        |

### Biblioteka Sejmowa — katalog OPAC

[Katalog Biblioteki Sejmowej](https://bs.sejm.gov.pl/F) działa w systemie **Aleph** (interfejs jak w przeglądarce). **Nie udostępnia** publicznego API JSON ani dokumentacji SRU dla maszynowego dostępu w stylu REST — narzędzia `bs_sejm_search` i `bs_sejm_get_item` wołają te same adresy co formularz WWW (`func=find-b` — lista wyników, `func=item-global` — pełna karta rekordu) i zwracają **surowe HTML**.

Typowy przepływ: `bs_sejm_search` z parametrem `local_base` (np. `bis01` — katalog główny, `bis05` — artykuły z czasopism, `pos01` — nagrania z posiedzeń, `tek01` — teksty konstytucji) → z HTML listy wyników odczytaj z linków `item-global` wartości **`doc_library`** i **`doc_number`** → `bs_sejm_get_item`. Pełna lista baz jest na stronie startowej katalogu.

**Uwaga:** to nie jest to samo co [api.sejm.gov.pl](https://api.sejm.gov.pl/) — akty prawne i metadane ISAP obsługują osobne narzędzia **`isap_*`** (ELI API).

### Fototeka, FilmPolski, Fototeka Śląska i Dokumenty Śląska

**[Fototeka](https://fototeka.fn.org.pl/)** (Filmoteka Narodowa — INA) nie publikuje osobnego REST/OpenAPI. Wyniki wyszukiwania są serwowane jako **HTML** (`/pl/strona/wyszukiwarka.html` z parametrami `key`, `search_type`, `pageNumber`, `howmany`). `fototeka_get_photo` zwraca stronę rekordu (`/pl/foto/view/{id}.html`). Wewnętrzny endpoint `ajax.html` (JSON z fragmentami HTML) wymaga pełnego formularza sesji i nie jest używany w narzędziu.

**[FilmPolski.pl](https://www.filmpolski.pl/fp/)** — Internetowa Baza Filmu Polskiego; **brak publicznego API JSON**. Wyszukiwanie to GET na `index.php` (`szukaj`, `rodzaj`: fragment / początek / dokładnie). Osoby w bazie są jako „nazwisko, imię” (w trybie dokładnie wymagany jest przecinek). Narzędzia parsują HTML do **zwartego JSON** (`filmpolski_search`) i zwracają **tekst** z głównego artykułu rekordu (`filmpolski_get_item`). Regulamin serwisu ogranicza kopiowanie całej bazy — używaj krótkich fragmentów i podawaj źródło.

**[Fototeka Śląska](https://fototekaslaska.pl/)** (Muzeum Wsi Opolskiego) działa na **WordPressie** — istnieje ogólne [`/wp-json/`](https://fototekaslaska.pl/wp-json/), ale typ wpisów galerii **nie** ma publicznego endpointu `wp/v2/...` dla pojedynczych rekordów. Wyszukiwanie jak na stronie głównej: **GET** z `s` (fraza), `t` (tytuł / miejscowość / powiat / opis / nr katalogowy), opcjonalnie `y` (okres historyczny), `paged` (strona). `fototekaslaska_search` bierze tylko blok `.search-list`, żeby nie mieszać wyników z sekcją „Ostatnio dodane”. `fototekaslaska_get_photo` pobiera `/galeria/{slug}/`. Prawa do zdjęć pozostają po stronie muzeum — bez masowego pobierania plików.

**[Dokumenty Śląska](https://www.dokumentyslaska.pl/)** to **statyczna witryna** (pliki `indeks …` / `dokument …` i podkatalogi) — **brak API** i centralnej wyszukiwarki. `dokumenty_slaska_get_page` pobiera jeden zasób po bezpiecznej ścieżce względnej; `dokumenty_slaska_medieval_catalog` to stała lista JSON ścieżek głównej serii średniowiecznej (nawigacja, nie zapytanie full-text).

### NAC i katalog ŚUM (Aleph)

**[Narodowe Archiwum Cyfrowe](https://www.nac.gov.pl/)** — strona instytucji na WordPressie: narzędzia **`nac_*`** używają kanału **RSS** (`/feed/`) oraz **WordPress REST API** (`/wp-json/wp/v2/…`). Zdigitalizowane materiały archiwalne są w serwisie [Szukaj w Archiwach](https://szukajwarchiwach.gov.pl/) ([informacje NAC](https://www.nac.gov.pl/archiwum-cyfrowe/systemy-i-infrastruktura-it/szukajwarchiwach-pl/)) — **brak tam publicznego, udokumentowanego API** do przeszukiwania katalogu z Workerów; często działa też ochrona przed botami (Incapsula). **`nac_site_search`** może zwracać HTTP 403 z niektórych sieci — z edge Cloudflare zachowanie bywa inne.

**[Katalog Biblioteki Śląskiego Uniwersytetu Medycznego](https://katalog.sum.edu.pl/)** to OPAC **Aleph (Ex Libris)**. Interfejs maszynowy: **Aleph X-Services** pod `https://katalog.sum.edu.pl/X` (odpowiedzi XML), zgodnie z [dokumentacją Ex Libris](https://developers.exlibrisgroup.com/aleph/apis/aleph-x-services/). **`sum_aleph_find`** woła `op=find` (np. `request=wrd=…`); na instalacji może pojawić się komunikat o braku konfiguracji bramki SRU — wtedy wyszukiwanie przez X-Server wymaga naprawy po stronie biblioteki. **`sum_aleph_present`** (`op=present`, format `marc` itd.) służy do pobrania rekordów z numeru zestawu i pozycji.

Większość baz oferuje **otwarty dostęp do odczytu** bez obowiązkowych kluczy API. Wyjątki: narzędzia **WIEDZA** (`wiedza_*`) nie buforują odpowiedzi w KV (sesja Liferay); **PKN www** (`pkn_search`) ma krótszy TTL cache niż repozytoria akademickie. **BDL (GUS)** działa anonimowo, ale możesz ustawić zmienną środowiskową `BDL_CLIENT_ID` (nagłówek `X-ClientId`), jeśli masz klucz z [Portalu API GUS](https://api.stat.gov.pl/home/bdlapi) — wtedy wyższe limity wywołań po stronie GUS. Dokumentacja REST: `https://bdl.stat.gov.pl/api/v1/` (OpenAPI: `…/swagger/doc/swagger.json`). **PBN** (`pbn_*`): dostęp do [API produkcyjnego](https://pbn.nauka.gov.pl/centrum-pomocy/open-api-w-wersji-produkcyjnej-pbn/) wymaga par `PBN_APP_ID` / `PBN_APP_TOKEN` (oraz opcjonalnie `PBN_USER_TOKEN`) — rejestracja aplikacji instytucji według [Centrum pomocy PBN](https://pbn.nauka.gov.pl/centrum-pomocy/kategoria/api/).

---

## Wymagania dla developmentu

- [Node.js](https://nodejs.org/) 18 lub nowszy
- [Konto Cloudflare](https://dash.cloudflare.com/sign-up) (darmowe)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (instalowany jako zależność deweloperska)

---

## Instalacja i uruchomienie lokalne

```bash
# 1. Sklonuj repozytorium
git clone https://github.com/asterixix/polish-academic-mcp.git
cd polish-academic-mcp

# 2. Zainstaluj zależności
npm install

# 3. Uruchom serwer deweloperski
npm run dev
# → Serwer MCP dostępny pod adresem http://localhost:8788/mcp
```

### Testowanie z MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
# Otwórz http://localhost:5173
# W polu "Server URL" wpisz: http://localhost:8788/mcp
# Kliknij "Connect"
```

---

## Wdrożenie na Cloudflare Workers

### Krok 1 — Zaloguj się do Cloudflare

```bash
npx wrangler login
```

### Krok 2 — Utwórz przestrzenie nazw KV

```bash
npx wrangler kv namespace create "CACHE_KV"
# Skopiuj zwrócone "id" i wklej do wrangler.jsonc jako id dla CACHE_KV

npx wrangler kv namespace create "RATE_LIMIT_KV"
# Skopiuj zwrócone "id" i wklej do wrangler.jsonc jako id dla RATE_LIMIT_KV
```

### Krok 3 — Zaktualizuj `wrangler.jsonc`

Otwórz `wrangler.jsonc` i zastąp wartości placeholder prawdziwymi ID:

```jsonc
"kv_namespaces": [
  {
    "binding": "CACHE_KV",
    "id": "WKLEJ_TUTAJ_ID_CACHE_KV",
    "preview_id": "WKLEJ_TUTAJ_ID_CACHE_KV"
  },
  {
    "binding": "RATE_LIMIT_KV",
    "id": "WKLEJ_TUTAJ_ID_RATE_LIMIT_KV",
    "preview_id": "WKLEJ_TUTAJ_ID_RATE_LIMIT_KV"
  }
]
```

### Krok 4 — Wdróż

```bash
npm run deploy
# → Dostępny pod adresem: https://polish-academic-mcp.<twoje-konto>.workers.dev/mcp
```

---

## Podłączenie klientów MCP

### Claude Desktop

Dodaj do pliku konfiguracyjnego Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "polish-academic": {
      "command": "npx",
      "args": ["mcp-remote", "https://polish-academic-mcp.kolpol25.workers.dev/mcp"]
    }
  }
}
```

Lokalizacja pliku konfiguracyjnego:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Claude.ai (Connector)

1. Przejdź do **Ustawienia → Connectors → Dodaj własny connector**
2. Wpisz URL serwera: `https://polish-academic-mcp.kolpol25.workers.dev/mcp`
3. Kliknij **Zapisz**

## Podłączenie z OpenAI / ChatGPT

### ChatGPT.com (plan Plus / Pro / Team / Enterprise)

ChatGPT obsługuje zdalne serwery MCP przez protokół Streamable HTTP.

1. Otwórz [ChatGPT.com](https://chatgpt.com) i zaloguj się
2. Przejdź do **Ustawienia (Settings) → Połączone aplikacje (Connected apps)**
3. Kliknij **Dodaj narzędzia (Add tools) → Serwer MCP (MCP server)**
4. Wpisz URL serwera:
   ```
   https://polish-academic-mcp.kolpol25.workers.dev/mcp
   ```
5. Nadaj nazwę (np. `Polish Academic`) i zapisz

Narzędzia będą dostępne podczas każdej rozmowy.

> **Uwaga:** Funkcja dostępna dla subskrybentów ChatGPT Plus i wyższych planów. Opcja może znajdować się w innym miejscu menu w zależności od wersji interfejsu.

### OpenAI Responses API (Python — programistycznie)

Biblioteka `openai-agents` (Python) obsługuje zdalne serwery MCP natywnie:

```bash
pip install openai-agents
```

```python
import asyncio
from agents import Agent, Runner
from agents.mcp import MCPServerSse

async def main():
    async with MCPServerSse(
        url="https://polish-academic-mcp.kolpol25.workers.dev/mcp"
    ) as mcp_server:
        agent = Agent(
            name="Asystent Naukowy",
            model="gpt-4o",
            mcp_servers=[mcp_server],
        )
        result = await Runner.run(
            agent,
            "Wyszukaj artykuły o fotosytezie z Biblioteki Nauki",
        )
        print(result.final_output)

asyncio.run(main())
```

Możesz również użyć serwera MCP bezpośrednio przez [Responses API](https://platform.openai.com/docs/guides/tools-mcp):

```python
from openai import OpenAI

client = OpenAI()  # OPENAI_API_KEY z env

response = client.responses.create(
    model="gpt-4o",
    tools=[{
        "type": "mcp",
        "server_url": "https://polish-academic-mcp.kolpol25.workers.dev/mcp",
        "server_label": "polish-academic",
        "require_approval": "never",
    }],
    input="Znajdź polskie publikacje o uczeniu maszynowym",
)
print(response.output_text)
```

---

## Podłączenie z Google Gemini

### Gemini CLI

[Gemini CLI](https://github.com/google-gemini/gemini-cli) obsługuje serwery MCP przez plik konfiguracyjny.

Edytuj plik `~/.gemini/settings.json` (utwórz jeśli nie istnieje):

```json
{
  "mcpServers": {
    "polish-academic": {
      "httpUrl": "https://polish-academic-mcp.kolpol25.workers.dev/mcp"
    }
  }
}
```

Po zapisaniu pliku uruchom Gemini CLI normalnie — narzędzia będą dostępne automatycznie:

```bash
gemini "Wyszukaj publikacje o astrofizyce w repozytorium Jagiellońskim"
```

### Google AI Studio / Vertex AI Agent Builder

W [Google AI Studio](https://aistudio.google.com):

1. Otwórz projekt lub stwórz nowy
2. Przejdź do zakładki **Tools → Add MCP server**
3. Wpisz URL: `https://polish-academic-mcp.kolpol25.workers.dev/mcp`
4. Zapisz i przetestuj w Playground

Dla Vertex AI Agent Builder konfiguracja jest analogiczna w zakładce **Tools → Extensions → MCP**.

### Google ADK (Agent Development Kit — Python)

```bash
pip install google-adk
```

```python
from google.adk.agents import Agent
from google.adk.tools.mcp_tool import MCPToolset, SseServerParams

academic_tools = MCPToolset(
    connection_params=SseServerParams(
        url="https://polish-academic-mcp.kolpol25.workers.dev/mcp"
    )
)

agent = Agent(
    name="asystent_naukowy",
    model="gemini-2.0-flash",
    tools=[academic_tools],
    instruction="Pomagasz w wyszukiwaniu polskiej literatury naukowej.",
)
```

---

## Podłączenie z Perplexity

Perplexity nie obsługuje natywnie protokołu MCP w interfejsie webowym.  
Możliwe podejścia:

### Przez OpenAI-compatible SDK (Sonar API + narzędzia)

Perplexity Sonar API jest zgodne z formatem OpenAI. Możesz opisać narzędzia MCP ręcznie jako schematy funkcji:

```python
from openai import OpenAI

client = OpenAI(
    api_key="<twój-klucz-perplexity>",
    base_url="https://api.perplexity.ai",
)

# Przykładowe wywołanie z function calling
tools = [
    {
        "type": "function",
        "function": {
            "name": "ruj_search",
            "description": "Szuka publikacji w Repozytorium UJ",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Zapytanie"},
                    "page": {"type": "integer", "default": 0},
                    "size": {"type": "integer", "default": 10},
                },
                "required": ["query"],
            },
        },
    }
]

response = client.chat.completions.create(
    model="sonar-pro",
    messages=[{"role": "user", "content": "Znajdź artykuły o kwantach"}],
    tools=tools,
)
```

Wywołania narzędzi musisz następnie obsłużyć ręcznie, przekazując je do serwera MCP przez HTTP.

### Przez mcp-remote (lokalny proxy)

Jeśli używasz lokalnego klienta zgodnego z OpenAI tools, możesz uruchomić `mcp-remote` jako most:

```bash
# Zainstaluj mcp-remote
npm install -g mcp-remote

# Uruchom proxy (przekazuje wywołania MCP ↔ HTTP)
npx mcp-remote https://polish-academic-mcp.kolpol25.workers.dev/mcp
```

Proxy nawiązuje lokalne połączenie stdio, z którego możesz korzystać w dowolnym narzędziu obsługującym MCP stdio.

### Inne klienty MCP

Wyślij żądanie HTTP POST do `/mcp` z nagłówkiem `Accept: application/json, text/event-stream` i treścią JSON-RPC 2.0.

---

## Limity i buforowanie

### Ograniczenie liczby żądań (Rate Limiting)

- **10 wywołań narzędzi na godzinę** na adres IP klienta
- Żądania protokołu (inicjalizacja, lista narzędzi, ping) **nie są** wliczane do limitu
- Przy przekroczeniu limitu serwer zwraca HTTP 429 z nagłówkiem `Retry-After`

### Cache odpowiedzi API

Odpowiedzi z zewnętrznych API są buforowane w Cloudflare KV:

| Baza danych                                             | TTL cache  |
| ------------------------------------------------------- | ---------- |
| Biblioteka Nauki — wyszukiwanie (`bn_search_publications`) | 1 godzina  |
| Biblioteka Nauki — OAI-PMH (`bn_search_articles`, `bn_get_article`) | 24 godziny |
| RCIN (OAI-PMH), POL-on, Baza Legalnych Źródeł (`blz_*`), BazTOL, katalog ŚUM (`sum_*`) | 24 godziny |
| PBN — `pbn_search_publications`, `pbn_search_persons`  | 1 godzina  |
| PBN — `pbn_get_publication`                            | 24 godziny |
| RUJ, AGH, AMU, UAFM, ICM, RODBuK, RePOD                 | 24 godziny |
| dane.gov.pl, BDL (GUS), IMGW-PIB, NAC (`nac_*`)        | 1 godzina  |
| PKN www (`pkn_search`)                                | 1 godzina  |
| WIEDZA (`wiedza_*`)                                   | brak cache KV (świeża sesja przy każdym wywołaniu) |
| ISAP — `isap_search_acts` (api.sejm.gov.pl/eli)       | 1 godzina  |
| ISAP — `isap_get_act`                                 | 24 godziny |
| Biblioteka Sejmowa — `bs_sejm_search`                 | 1 godzina  |
| Biblioteka Sejmowa — `bs_sejm_get_item`               | 24 godziny |
| SAOS — `saos_search_judgments`                        | 1 godzina  |
| SAOS — `saos_get_judgment`, narzędzia `saos_dump_*`    | 24 godziny |
| Wolne Lektury (`wolnelektury_*`)                      | 24 godziny |
| Ninateka — `ninateka_search`                          | 1 godzina  |
| Ninateka — `ninateka_get_vod`                         | 24 godziny |
| Gapla — `gapla_search`                                | 1 godzina  |
| Gapla — `gapla_get_poster`                           | 24 godziny |
| Fototeka (`fototeka_*`)                              | 24 godziny |
| FilmPolski (`filmpolski_*`), Fototeka Śląska (`fototekaslaska_*`) | 24 godziny |
| Dokumenty Śląska (`dokumenty_slaska_*`)               | 24 godziny |
| Repozytorium FN — `fn_repo_search`                   | 1 godzina  |
| Repozytorium FN — `fn_repo_get_node`, `fn_repo_film_index`, `fn_repo_browse_kind` | 24 godziny |
| Ludzie Nauki (`ludzie_*`)                             | 1 godzina  |

### Eksport danych ewaluacyjnych do Nextcloud (WebDAV)

Jeśli ustawisz `EVAL_WEBDAV_ENABLED=true` (w `wrangler.jsonc`/env), serwer zapisuje dane
ewaluacyjne dla każdego wywołania MCP `tools/call` do Nextcloud przez WebDAV.

Wymagane zmienne:
- `NEXTCLOUD_WEBDAV_BASE_URL`
- `NEXTCLOUD_WEBDAV_USERNAME`
- `NEXTCLOUD_WEBDAV_PASSWORD`

Opcjonalne:
- `NEXTCLOUD_WEBDAV_PATH_PREFIX` (domyślnie `mcp-eval`)
- `EVAL_WEBDAV_MAX_JSON_BYTES` (domyślnie `120000`)

Dla każdego `tools/call` robione jest `PUT` pliku JSON do WebDAV:
`NEXTCLOUD_WEBDAV_PATH_PREFIX/<tool>-<timestamp>-<uuid>.json`.
Plik zawiera surową odpowiedź (w tym `_span`) oraz pole `rqEval` — policzone metryki
RQ1–RQ4, o ile wywołanie pasuje do przypadku testowego z `scripts/eval/test-cases.ts`.

### Limity ogólne

| Zasób         | Limit             |
| ------------- | ----------------- |
| Żądania       | 100 000 / dobę    |
| Czas CPU      | 10 ms / wywołanie |
| Odczyty KV    | 100 000 / dobę    |
| Zapisy KV     | 1 000 / dobę      |
| Pamięć Worker | 128 MB            |

---

## Architektura techniczna

```
Klient MCP (Claude)
       │  HTTP POST /mcp (JSON-RPC 2.0)
       ▼
Cloudflare Worker (index.ts)
  ├── Rate limit check (RATE_LIMIT_KV)
  └── createMcpHandler(createServer(env))
           └── tools/
               ├── biblioteka-nauki.ts → Biblioteka Nauki (JSON + OAI-PMH)
               ├── ruj.ts, agh.ts, amu.ts, uafm.ts, icm.ts → DSpace 7 REST
               ├── rodbuk.ts, repod.ts → Dataverse REST
               ├── dane.ts → dane.gov.pl API
               ├── polon.ts → RAD-on Open Data (POL-on)
               ├── pbn.ts → Polska Bibliografia Naukowa (PBN REST; wymaga `PBN_APP_ID` / `PBN_APP_TOKEN`)
               ├── bdl.ts → BDL GUS
               ├── rcin.ts → RCIN OAI-PMH
               ├── pkn.ts, wiedza.ts → PKN / WIEDZA (HTML)
               ├── blz.ts → bazalegalnychzrodel.pl (WordPress REST)
               ├── baztol.ts → BazTOL PUT (HTML)
               ├── nac.ts → NAC nac.gov.pl (RSS + WordPress REST)
               ├── sum.ts → katalog.sum.edu.pl — Aleph X-Server (XML)
               ├── isap.ts → api.sejm.gov.pl/eli
               ├── sejm-bs.ts → Biblioteka Sejmowa OPAC (HTML)
               ├── saos.ts → SAOS API
               ├── wolne-lektury.ts → Wolne Lektury API (JSON)
               ├── ninateka.ts → Ninateka / FINA (JSON)
               ├── gapla.ts → Gapla FINA (HTML)
               ├── fototeka.ts → Fototeka FN (HTML)
               ├── filmpolski.ts → FilmPolski.pl (parsowanie HTML → JSON / tekst)
               ├── fototekaslaska.ts → Fototeka Śląska MWO (parsowanie HTML → JSON / tekst)
               ├── filmoteka-repo.ts → Repozytorium FN (HTML / Solr)
               ├── dokumenty-slaska.ts → Dokumenty Śląska (statyczny HTML)
               ├── ludzie-nauki.ts → Ludzie Nauki REST
               ├── imgw.ts → IMGW public API
               └── response-eval.ts → eval_response (lokalnie)
```

Kluczowe decyzje projektowe:

- **Bezstanowy** — nowa instancja `McpServer` na każde żądanie (wymagane od SDK 1.26.0)
- **Kompaktowe podsumowania JSON** dla repozytoriów DSpace 7 (RUJ, AGH, AMU, UAFM, ICM) zamiast surowego HAL+JSON — zmniejsza zużycie tokenów
- **Surowe odpowiedzi XML/JSON/HTML** bez warstwy normalizacji: Biblioteka Nauki (OAI-PMH XML oraz odpowiedź JSON z `/api/search`; dokumentacja OAI: [doc.bibliotekanauki.pl](https://doc.bibliotekanauki.pl/dokumentacja-api-oai-pmh/)), RCIN (OAI-PMH), WordPress REST (Baza Legalnych Źródeł, treści na [nac.gov.pl](https://www.nac.gov.pl/)), RAD-on JSON (POL-on), [PBN](https://pbn.nauka.gov.pl/api/) (JSON), dane.gov.pl, BDL (GUS), [ELI / ISAP (api.sejm.gov.pl)](https://api.sejm.gov.pl/eli/openapi/), IMGW, katalog [ŚUM](https://katalog.sum.edu.pl/) (Aleph X-Server XML), Biblioteka Sejmowa OPAC (HTML), [Ninateka](https://ninateka.pl/) (JSON API frontu SPA), [Gapla](https://gapla.fn.org.pl/) (HTML), [Fototeka](https://fototeka.fn.org.pl/) (HTML), [Repozytorium FN](https://repozytorium.fn.org.pl/) (HTML / Solr), [Dokumenty Śląska](https://www.dokumentyslaska.pl/) (statyczny HTML) — oszczędza czas CPU
- **Parsowanie HTML do JSON / tekstu** (brak publicznego API pod wyszukiwarkę / galerię): [FilmPolski.pl](https://www.filmpolski.pl/fp/) (`filmpolski_*`), [Fototeka Śląska](https://fototekaslaska.pl/) (`fototekaslaska_*`) — mniejsze zużycie tokenów niż pełne strony HTML
- **Normalizacja wyników Dataverse** dla `rodbuk_search` i `repod_search` do stabilnych pól (`title`, `author`, `date`, `doi`) przy zachowaniu danych źródłowych
- **Fire-and-forget zapisy do KV** — nie blokują odpowiedzi

---

## Aktualizacje implementacji (RQ3/RQ4)

W ramach hardeningu ewaluacji dodano:

- **Tryb minimalizacji danych osobowych** (`minimize_pii`) w:
  - `ruj_search` — ukrywa pola autorów/afiliacji i redaguje typowe wzorce PII,
  - `bn_search_articles` — redaguje wzorce PII w odpowiedzi XML (m.in. ORCID, e-mail, PESEL-like, phone-like).
- **Normalizację odpowiedzi Dataverse** w:
  - `rodbuk_search`,
  - `repod_search`.
- **Fallback odpornościowy** w `bn_search_articles`:
  - gdy zapytanie z restrykcyjnym `set` zwróci `noRecordsMatch`, narzędzie ponawia zapytanie raz bez `set` (z zachowaniem `from_date`/`until_date` i `metadata_format`).

Domyślne zachowanie narzędzi pozostaje bezpieczne wstecznie (`minimize_pii=false`), więc istniejące integracje nie wymagają zmian.

---

## Rozwój i wkład

Przeczytaj [CONTRIBUTING.md](CONTRIBUTING.md) — wskazówki dotyczące zgłaszania błędów,
propozycji nowych baz danych i tworzenia pull requestów.

Dla agentów AI kodujących w tym projekcie: przeczytaj [AGENTS.md](AGENTS.md).

---

## Licencja

[MIT](LICENSE) © 2026 Artur Sendyka vel. asterixix na poczet Polskiej Nauki z wykorzystaniem AI
