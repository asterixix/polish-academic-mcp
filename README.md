# Polish Academic MCP

[![SafeSkill 82/100](https://img.shields.io/badge/SafeSkill-82%2F100_Passes%20with%20Notes-yellow)](https://safeskill.dev/scan/asterixix-polish-academic-mcp)

Lokalny serwer MCP (Model Context Protocol) dla polskich baz naukowych, publicznych i kulturowych.
Pakiet działa przez stdio (Node.js), więc można go podpiąć bezpośrednio do klientów MCP (Claude Desktop, Cursor i inne).

> **MCP** (Model Context Protocol) to otwarty standard pozwalający modelom językowym (Claude, GPT, Bielik.AI itp.) na wywoływanie zewnętrznych narzędzi i API w ustandaryzowany sposób.

**Aktualna konstrukcja projektu**

- Lokalny serwer `stdio` (Node.js), uruchamiany z `dist/index.js`.
- Brak warstw OAuth, token mintingu i rate-limitingu z wcześniejszej wersji cloudflare'owej.
- Cache in-memory w runtime lokalnym.
- Dystrybucja jako npm package + bundle MCPB (`manifest.json`).

Jeśli korzystasz z publicznie hostowanej instancji MCP (nie tej lokalnej z repo), polityka telemetryczna zależy od operatora tej instancji.

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
| `amu_search`         | [AMU — Repozytorium UAM](https://repozytorium.amu.edu.pl)    | Wyszukiwanie publikacji Uniwersytetu Adama Mickiewicza w Poznaniu          |
| `amu_get_item`       | AMU                                                          | Pobranie metadanych pozycji po UUID                             |
| `uafm_search`        | [UAFM — Repozytorium UAFM](https://repozytorium.uafm.edu.pl) | Wyszukiwanie publikacji Uniwersytetu Andrzeja Frycza Modrzewskiego w Krakowie |
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
| `baztol_search`           | [BazTOL — brama zasobów PUT](http://baztol.library.put.poznan.pl) | Wyszukiwanie pełnotekstowe (HTML; katalog nieaktualizowany od 2022) |
| `baztol_browse_domain`    | BazTOL                                                       | Przeglądanie po dziedzinie (id z menu)                            |
| `baztol_get_resource`     | BazTOL                                                       | Szczegóły zasobu po ID (HTML)                                     |
| `nac_news_rss`            | [NAC — Narodowe Archiwum Cyfrowe](https://www.nac.gov.pl/)    | Kanał RSS aktualności instytucji (XML)                             |
| `nac_site_search`       | NAC                                                          | Wyszukiwarka WordPress REST (`?rest_route=/wp/v2/search`; posty/strony; JSON) |
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

**[Narodowe Archiwum Cyfrowe](https://www.nac.gov.pl/)** — strona instytucji na WordPressie: narzędzia **`nac_*`** używają kanału **RSS** (`/feed/`) oraz WordPress REST przez fallback `?rest_route=/wp/v2/...` (często stabilniejszy niż `/wp-json/...` przy ochronach WAF). Zdigitalizowane materiały archiwalne są w serwisie [Szukaj w Archiwach](https://szukajwarchiwach.gov.pl/) ([informacje NAC](https://www.nac.gov.pl/archiwum-cyfrowe/systemy-i-infrastruktura-it/szukajwarchiwach-pl/)) — **brak tam publicznego, udokumentowanego API** do przeszukiwania katalogu z Workerów; często działa też ochrona przed botami (Incapsula).

**[Katalog Biblioteki Śląskiego Uniwersytetu Medycznego](https://katalog.sum.edu.pl/)** to OPAC **Aleph (Ex Libris)**. Interfejs maszynowy: **Aleph X-Services** pod `https://katalog.sum.edu.pl/X` (odpowiedzi XML), zgodnie z [dokumentacją Ex Libris](https://developers.exlibrisgroup.com/aleph/apis/aleph-x-services/). **`sum_aleph_find`** woła `op=find` (np. `request=wrd=…`); na instalacji może pojawić się komunikat o braku konfiguracji bramki SRU — wtedy wyszukiwanie przez X-Server wymaga naprawy po stronie biblioteki. **`sum_aleph_present`** (`op=present`, format `marc` itd.) służy do pobrania rekordów z numeru zestawu i pozycji.

Większość baz oferuje **otwarty dostęp do odczytu** bez obowiązkowych kluczy API. Wyjątki: narzędzia **WIEDZA** (`wiedza_*`) nie buforują odpowiedzi w KV (sesja Liferay); **PKN www** (`pkn_search`) ma krótszy TTL cache niż repozytoria akademickie. **BDL (GUS)** działa anonimowo, ale możesz ustawić zmienną środowiskową `BDL_CLIENT_ID` (nagłówek `X-ClientId`), jeśli masz klucz z [Portalu API GUS](https://api.stat.gov.pl/home/bdlapi) — wtedy wyższe limity wywołań po stronie GUS. Dokumentacja REST: `https://bdl.stat.gov.pl/api/v1/` (OpenAPI: `…/swagger/doc/swagger.json`).

**PBN (wymagane dostępy):** aby włączyć narzędzia **`pbn_search_publications`**, **`pbn_search_persons`** i **`pbn_get_publication`**, musisz mieć aktywny dostęp do API PBN i ustawić co najmniej `PBN_APP_ID` + `PBN_APP_TOKEN` (opcjonalnie `PBN_USER_TOKEN`). Dostęp i rejestracja aplikacji: [OpenAPI PBN](https://pbn.nauka.gov.pl/centrum-pomocy/open-api-w-wersji-produkcyjnej-pbn/) oraz [Centrum pomocy PBN](https://pbn.nauka.gov.pl/centrum-pomocy/kategoria/api/).

---

## Wymagania

- Node.js 18+
- npm

---

## Instalacja i uruchomienie lokalne

```bash
# 1. Sklonuj repozytorium
git clone https://github.com/asterixix/polish-academic-mcp.git
cd polish-academic-mcp

# 2. Zainstaluj zależności
npm install

# 3. Zbuduj projekt
npm run build

# 4. Uruchom serwer MCP
npm start
```

Tryb deweloperski:

```bash
npm run dev
```

Uruchomienie bez lokalnego builda (globalnie przez npm registry):

```bash
npx -y polish-academic-mcp
```

---

## Podłączenie klientów MCP (konfiguracja `npx`)

Poniżej znajdziesz aktualne, praktyczne konfiguracje dla najpopularniejszych hostów MCP. Ten pakiet działa jako **lokalny serwer stdio**, więc podstawowy wariant to:

```json
{
  "command": "npx",
  "args": ["-y", "polish-academic-mcp"]
}
```

### 0) Wymagania wspólne

1. Zainstaluj Node.js 18+.
2. Upewnij się, że `npx` działa w terminalu (`npx --version`).
3. W klientach GUI (Desktop) sprawdź, czy aplikacja widzi `npx` w `PATH`.

### 1) Claude Code (CLI)

Najprościej przez komendę:

```bash
claude mcp add --transport stdio polish-academic-mcp -- npx -y polish-academic-mcp
```

Sprawdzenie:

```bash
claude mcp list
```

Uwaga dla Windows (poza WSL):

```bash
claude mcp add --transport stdio polish-academic-mcp -- cmd /c npx -y polish-academic-mcp
```

### 2) Claude Desktop

Claude Desktop promuje obecnie Desktop Extensions (`.mcpb`), ale ręczna konfiguracja `mcpServers` nadal jest spotykana.

Przykład:

```json
{
  "mcpServers": {
    "polish-academic-mcp": {
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"]
    }
  }
}
```

Typowe lokalizacje pliku konfiguracji:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`
- Linux: zależnie od sposobu instalacji desktopowej (zwykle katalog konfiguracyjny aplikacji Claude)

### 3) ChatGPT

W ChatGPT (Apps/Connectors oraz Responses API) oficjalnie używa się **zdalnych MCP** (HTTP/SSE), nie lokalnego `stdio` uruchamianego przez `npx` bezpośrednio w aplikacji.

To oznacza, że dla tego pakietu masz 2 ścieżki:

1. Używaj go lokalnie w klientach obsługujących `stdio` (`Claude Code`, `Gemini CLI`, `LM Studio`, `AnythingLLM`, `Cursor`).
2. Jeśli koniecznie chcesz ChatGPT: wystaw serwer jako zdalny endpoint MCP (HTTP/SSE), a potem podłącz URL w ChatGPT.

### 4) Gemini (Gemini CLI)

Gemini CLI obsługuje MCP przez `mcpServers` w `settings.json` oraz komendy `gemini mcp ...`.

Przykład `settings.json`:

```json
{
  "mcpServers": {
    "polish-academic-mcp": {
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"]
    }
  }
}
```

Lub przez CLI:

```bash
gemini mcp add polish-academic-mcp npx -y polish-academic-mcp
```

### 5) LM Studio

Od LM Studio `0.3.17` dostępne są lokalne i zdalne MCP. Konfiguracja używa formatu `mcp.json` (zgodnego z notacją Cursor).

Przykład `mcp.json`:

```json
{
  "mcpServers": {
    "polish-academic-mcp": {
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"]
    }
  }
}
```

### 6) AnythingLLM (Desktop / Docker)

AnythingLLM czyta konfigurację z `plugins/anythingllm_mcp_servers.json` (w katalogu storage AnythingLLM).

Przykład:

```json
{
  "mcpServers": {
    "polish-academic-mcp": {
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"]
    }
  }
}
```

Uwaga: AnythingLLM uruchamia MCP-y przy wejściu w „Agent Skills” lub wywołaniu agenta (niekoniecznie od razu przy starcie aplikacji).

### 7) Perplexity

Perplexity publikuje oficjalny **własny serwer MCP** (np. `https://mcp.perplexity.ai/mcp`) do użycia w klientach MCP.

Jeśli celem jest uruchomienie **tego** pakietu (`polish-academic-mcp`) bezpośrednio „wewnątrz Perplexity”, publiczna dokumentacja Perplexity skupia się obecnie na korzystaniu z endpointów MCP, a nie na lokalnym `stdio` przez `npx` jako w klasycznych klientach desktopowych.

### 8) Inne klienty (Cursor, Windsurf, Cline, Open WebUI itd.)

W większości przypadków działa standardowy wpis `mcpServers`:

```json
{
  "mcpServers": {
    "polish-academic-mcp": {
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"]
    }
  }
}
```

Jeśli klient wspiera tylko zdalne MCP, potrzebny będzie endpoint HTTP/SSE zamiast lokalnego `stdio`.

### Źródła (oficjalne / referencyjne)

- OpenAI Developers (MCP and Connectors): `https://developers.openai.com/api/docs/guides/tools-connectors-mcp`
- OpenAI Developers (Building MCP servers for ChatGPT Apps): `https://developers.openai.com/api/docs/mcp`
- Claude Code docs (MCP): `https://code.claude.com/docs/en/mcp`
- Claude Help Center (Claude Desktop + local MCP): `https://support.claude.com/en/articles/10949351-getting-started-with-model-context-protocol-mcp-on-claude-for-desktop`
- Gemini CLI docs (MCP servers): `https://geminicli.com/docs/tools/mcp-server/`
- LM Studio docs (Use MCP Servers): `https://lmstudio.ai/docs/app/mcp`
- AnythingLLM docs (overview): `https://docs.anythingllm.com/mcp-compatibility/overview`
- AnythingLLM docs (desktop): `https://docs.anythingllm.com/mcp-compatibility/desktop`
- AnythingLLM docs (docker): `https://docs.anythingllm.com/mcp-compatibility/docker`
- Perplexity MCP URL (referencje integracyjne): `https://mcp.perplexity.ai/mcp`

---

## Troubleshooting (Claude: "Server transport closed unexpectedly")

Jeśli po `initialize` połączenie się zamyka:

1. Użyj bezpośrednio `node` + ścieżki absolutnej do `dist/index.js` (nie `npx`).
2. Upewnij się, że build istnieje: `npm run build`.
3. Sprawdź, czy Claude widzi poprawny Node w swoim środowisku PATH.
4. Odczytaj stderr serwera:
   - `stdin end`
   - `stdin close`

Wpisy `stdin end/close` zwykle oznaczają, że host zamknął stdin procesu MCP.

---

## Zmienne środowiskowe

Opcjonalne zmienne używane przez wybrane narzędzia:

- `BDL_CLIENT_ID`
- `WEB3FORMS_ACCESS_KEY`
- `PBN_APP_ID`
- `PBN_APP_TOKEN`
- `PBN_USER_TOKEN`

---

## Architektura techniczna (obecna)

```text
Klient MCP (Claude/Cursor/itp.)
       │  stdio JSON-RPC
       ▼
Node runtime (src/index.ts)
  ├── StdioServerTransport
  ├── createServer(env)
  └── tools/* (rejestracja narzędzi źródłowych)
```

Kluczowe decyzje projektowe:

- Lokalny, prosty transport stdio.
- Brak middleware OAuth/rate-limit (usunięte z wersji cloudflare).
- Odpowiedzi z narzędzi zwracane w formacie przyjaznym MCP.
- In-memory cache dla runtime lokalnego.

---

## Development

```bash
npm run lint
npm run build
```

Wskazówki dla chętnych do pomocy:

- `CONTRIBUTING.md`
- `AGENTS.md`
- [`docs/CLIENTS.md`](docs/CLIENTS.md) — konfiguracja per klient MCP (Claude Desktop, Cursor, LM Studio, AnythingLLM, Perplexity, Open WebUI, OpenClaw, Hermes Agent, Cline, Continue, Roo Code).
- [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) — prompt dla agentów AI, którzy mają skonfigurować serwer samodzielnie.

---

## Licencja

MIT
