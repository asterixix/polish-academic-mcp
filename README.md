# Polish Academic MCP

[![npm version](https://img.shields.io/npm/v/polish-academic-mcp)](https://www.npmjs.com/package/polish-academic-mcp)
[![npm downloads](https://img.shields.io/npm/dm/polish-academic-mcp)](https://www.npmjs.com/package/polish-academic-mcp)

Serwer MCP, dzięki któremu asystent AI (Claude, Copilot, Cursor, Gemini, model lokalny w LM Studio i inne) przeszukuje **polskie bazy naukowe, publiczne i kulturowe**: Bibliotekę Nauki, repozytoria uczelni, GUS, ISAP, orzeczenia sądów, Wolne Lektury, archiwa filmowe i fotograficzne. 85 narzędzi, 33 źródła, bez kont i kluczy API (poza opcjonalnym PBN).

Serwer działa **na Twoim komputerze**: aplikacja AI uruchamia go sama w tle, a serwer łączy się bezpośrednio z bazami, bez pośredniczących usług.

> **MCP** (Model Context Protocol) to otwarty standard, dzięki któremu asystenci AI mogą korzystać z zewnętrznych narzędzi i baz danych.

---

## Szybki start (bez programowania)

**1. Zainstaluj Node.js.** Wejdź na [nodejs.org](https://nodejs.org), pobierz wersję **LTS** i zainstaluj ją jak zwykły program (wszystkie opcje domyślne).

**2. Uruchom kreator.** Otwórz terminal:

- **Windows:** menu Start → wpisz „PowerShell” → Enter,
- **macOS:** Cmd+Spacja → wpisz „Terminal” → Enter,
- **Linux:** Ctrl+Alt+T,

a potem wklej i zatwierdź Enterem:

```bash
npx -y polish-academic-mcp setup
```

Kreator sam znajdzie zainstalowane aplikacje AI, zapyta, które bazy włączyć, i dopisze serwer do ich ustawień (z kopią zapasową poprzednich). Przed zapisem zamknij te aplikacje.

**3. Uruchom aplikację AI ponownie** (całkowicie: zamknij ją też z zasobnika systemowego lub paska menu) i zapytaj na przykład:

> Wyszukaj w Bibliotece Nauki artykuły o odnawialnych źródłach energii z 2024 roku.

Coś nie działa? Uruchom `npx -y polish-academic-mcp doctor`, a potem zajrzyj do [rozwiązywania problemów](#rozwiązywanie-problemów).

### Instalacja jednym kliknięciem

Jeśli masz już Node.js:

[![Dodaj do Cursora](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=polish-academic&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInBvbGlzaC1hY2FkZW1pYy1tY3AiXX0=)
[![Zainstaluj w VS Code](https://img.shields.io/badge/VS_Code-Zainstaluj-0098FF?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=polish-academic&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22polish-academic-mcp%22%5D%7D)
[![Zainstaluj w VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Zainstaluj-24bfa5?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=polish-academic&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22polish-academic-mcp%22%5D%7D&quality=insiders)

Przyciski dodają wszystkie 85 narzędzi. Cursor pokazuje modelowi najwyżej ok. 40 narzędzi, więc tam lepiej [wybrać jedną lub dwie grupy baz](#wybór-baz).

### Quick start (English)

Install [Node.js LTS](https://nodejs.org), then run `npx -y polish-academic-mcp setup`. The wizard detects your AI apps and adds the server to their MCP config (with a backup). Restart the app. Use `--sources=nauka,prawo` (or the `POLISH_ACADEMIC_SOURCES` env var) to expose only some of the 85 tools, and `npx -y polish-academic-mcp doctor` to diagnose problems.

---

## Obsługiwane aplikacje

| Aplikacja                                                                                  | Jak dodać serwer                                                                                 | Uwagi                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Claude Desktop                                                                             | kreator `setup`                                                                                  | po zapisie zamknij Claude całkowicie i otwórz ponownie                                   |
| Claude Code                                                                                | kreator `setup` albo `claude mcp add --scope user polish-academic -- npx -y polish-academic-mcp` | na Windows (poza WSL): `-- cmd /c npx -y polish-academic-mcp`                            |
| Cursor                                                                                     | kreator `setup` lub przycisk powyżej                                                             | limit ok. 40 narzędzi łącznie: wybierz 1–2 grupy                                         |
| VS Code (GitHub Copilot)                                                                   | kreator `setup` lub przycisk powyżej                                                             | limit 128 narzędzi łącznie ze wszystkich serwerów                                        |
| Windsurf                                                                                   | kreator `setup`                                                                                  | limit 100 narzędzi łącznie ze wszystkich serwerów                                        |
| Cline, Roo Code                                                                            | kreator `setup`                                                                                  |                                                                                          |
| LM Studio                                                                                  | kreator `setup`                                                                                  | przy małych modelach włącz 1 grupę baz                                                   |
| AnythingLLM Desktop                                                                        | kreator `setup`                                                                                  | narzędzia działają w trybie `@agent`                                                     |
| Gemini CLI, OpenAI Codex CLI, opencode, GitHub Copilot CLI                                 | kreator `setup`                                                                                  |                                                                                          |
| Zed, Continue, Goose, Hermes Agent, OpenClaw, Jan, Perplexity (macOS), Msty, Cherry Studio | `npx -y polish-academic-mcp setup --print <id>` wypisze gotową instrukcję                        | id: `zed`, `continue`, `goose`, `hermes`, `openclaw`, `jan`, `perplexity`, `generic`     |
| Open WebUI                                                                                 | przez most [mcpo](https://github.com/open-webui/mcpo): `setup --print open-webui`                | Open WebUI obsługuje natywnie tylko MCP po HTTP                                          |
| ChatGPT, Claude.ai w przeglądarce                                                          | nieobsługiwane                                                                                   | te usługi łączą się tylko ze zdalnymi serwerami MCP (HTTP), a ten serwer działa lokalnie |

Szczegółowe instrukcje dla każdej aplikacji (pliki konfiguracyjne, ręczna konfiguracja, weryfikacja): [docs/CLIENTS.md](docs/CLIENTS.md). Jeśli konfigurację ma wykonać agent AI, daj mu [docs/AGENT-GUIDE.md](docs/AGENT-GUIDE.md).

### Opcje kreatora

```bash
npx -y polish-academic-mcp setup                          # interaktywnie
npx -y polish-academic-mcp setup --list                   # obsługiwane aplikacje i ścieżki plików
npx -y polish-academic-mcp setup --client cursor --sources nauka --yes   # bez pytań
npx -y polish-academic-mcp setup --dry-run                # pokaż zmiany, nic nie zapisuj
npx -y polish-academic-mcp setup --pin                    # przypnij bieżącą wersję (zob. Aktualizacje)
npx -y polish-academic-mcp setup --print zed              # konfiguracja do wklejenia ręcznie
npx -y polish-academic-mcp uninstall                      # usuń serwer z aplikacji
npx -y polish-academic-mcp doctor                         # diagnostyka
```

Kreator zachowuje inne serwery i ustawienia w plikach (także Twoje zmienne we wpisie serwera, np. klucze PBN, przy ponownym uruchomieniu), przed każdą zmianą robi kopię (`*.bak-<data>`) i nie rusza plików z komentarzami (JSONC); dla nich wypisuje wpis do wklejenia. Na Windows zapisuje polecenie `cmd /c npx …`, a przy Node.js zainstalowanym przez nvm, fnm lub volta pełną ścieżkę do `npx`. Dzięki temu aplikacje okienkowe znajdą Node.js.

---

## Wybór baz

Opisy wszystkich 85 narzędzi zajmują ok. 26 tys. tokenów kontekstu przy każdym zapytaniu. Dla Claude czy GPT to nie problem, ale małe modele lokalne gubią się przy tylu narzędziach, a część aplikacji ma limity (Cursor ok. 40, Windsurf 100, VS Code 128 narzędzi łącznie ze wszystkich serwerów). Włącz tylko to, czego potrzebujesz:

| Grupa     | Zawartość                                                                                                                                    | Narzędzia |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `nauka`   | Biblioteka Nauki, RCIN, repozytoria UJ, AGH, UAM, UAFM, ICM, RODBuK, RePOD, POL-on, PBN, Ludzie Nauki, BazTOL, katalog ŚUM                   | 30        |
| `dane`    | Bank Danych Lokalnych GUS, dane.gov.pl, IMGW                                                                                                 | 12        |
| `prawo`   | ISAP (akty prawne), SAOS (orzeczenia), Biblioteka Sejmowa                                                                                    | 11        |
| `normy`   | PKN, katalog norm WIEDZA                                                                                                                     | 3         |
| `kultura` | Wolne Lektury, Ninateka, Gapla, Fototeka, FilmPolski, Fototeka Śląska, Repozytorium FN, NAC, PAUart, Baza Legalnych Źródeł, Dokumenty Śląska | 29        |

Kreator `setup` pyta o grupy. Ręcznie ustawisz je zmienną `POLISH_ACADEMIC_SOURCES` w sekcji `env` serwera:

```json
{
  "mcpServers": {
    "polish-academic": {
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"],
      "env": { "POLISH_ACADEMIC_SOURCES": "nauka,prawo" }
    }
  }
}
```

albo argumentem: `"args": ["-y", "polish-academic-mcp", "--sources=nauka,prawo"]`. Możesz łączyć grupy z pojedynczymi bazami (`nauka,isap`) i wykluczać (`nauka,-pbn`). Pełna lista identyfikatorów: `npx -y polish-academic-mcp --list-sources`. Nieznane nazwy są pomijane z ostrzeżeniem w logu, a pusty wybór włącza wszystko, więc literówka nie wyłączy serwera.

---

## Wszystkie bazy i narzędzia

| Narzędzie                           | Baza danych                                                                                            | Opis                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `bn_search_publications`            | [Biblioteka Nauki](https://bibliotekanauki.pl)                                                         | Wyszukiwanie pełnotekstowe (API JSON portalu — frazy, tytuły, abstrakty)                                                                  |
| `bn_search_articles`                | Biblioteka Nauki                                                                                       | Listowanie rekordów OAI-PMH (`ListRecords`) po datach i/lub zbiorze czasopisma — **bez** zapytań słownych                                 |
| `bn_get_article`                    | Biblioteka Nauki                                                                                       | Pobranie metadanych pojedynczego artykułu po ID (OAI-PMH `GetRecord`)                                                                     |
| `rcin_search`                       | [RCIN — Repozytorium Cyfrowe Instytutów Naukowych](https://rcin.org.pl/dlibra)                         | OAI-PMH `ListRecords` (metadane obiektów; opcjonalnie zakres dat / zbiór OAI)                                                             |
| `rcin_get_record`                   | RCIN                                                                                                   | OAI-PMH `GetRecord` po ID lub `oai:rcin.org.pl:…`                                                                                         |
| `ruj_search`                        | [RUJ — Repozytorium UJ](https://ruj.uj.edu.pl)                                                         | Wyszukiwanie publikacji z Repozytorium Jagiellońskiego                                                                                    |
| `ruj_get_item`                      | RUJ                                                                                                    | Pobranie metadanych pozycji po UUID                                                                                                       |
| `agh_search`                        | [AGH — Repozytorium AGH](https://repo.agh.edu.pl)                                                      | Wyszukiwanie prac i publikacji AGH w Krakowie                                                                                             |
| `agh_get_item`                      | AGH                                                                                                    | Pobranie metadanych pozycji po UUID                                                                                                       |
| `amu_search`                        | [AMU — Repozytorium UAM](https://repozytorium.amu.edu.pl)                                              | Wyszukiwanie publikacji Uniwersytetu Adama Mickiewicza w Poznaniu                                                                         |
| `amu_get_item`                      | AMU                                                                                                    | Pobranie metadanych pozycji po UUID                                                                                                       |
| `uafm_search`                       | [UAFM — Repozytorium UAFM](https://repozytorium.uafm.edu.pl)                                           | Wyszukiwanie publikacji Uniwersytetu Andrzeja Frycza Modrzewskiego w Krakowie                                                             |
| `uafm_get_item`                     | UAFM                                                                                                   | Pobranie metadanych pozycji po UUID                                                                                                       |
| `icm_search`                        | [ICM — Otwarte Dane Badawcze UW](https://open.icm.edu.pl)                                              | Wyszukiwanie danych badawczych ICM UW                                                                                                     |
| `icm_get_item`                      | ICM                                                                                                    | Pobranie metadanych pozycji po UUID                                                                                                       |
| `rodbuk_search`                     | [RODBuK](https://rodbuk.pl)                                                                            | Wyszukiwanie zbiorów danych badawczych uczelni krakowskich                                                                                |
| `repod_search`                      | [RePOD](https://repod.icm.edu.pl)                                                                      | Wyszukiwanie polskich otwartych danych badawczych                                                                                         |
| `repod_get_dataset`                 | RePOD                                                                                                  | Pobranie metadanych zbioru danych po DOI                                                                                                  |
| `dane_search`                       | [dane.gov.pl](https://dane.gov.pl)                                                                     | Wyszukiwanie danych otwartych z portalu rządowego                                                                                         |
| `dane_get_dataset`                  | dane.gov.pl                                                                                            | Pobranie szczegółów zbioru danych po ID                                                                                                   |
| `polon_search`                      | [POL-on / RAD-on](https://radon.nauka.gov.pl/opendata/polon)                                           | Zbiory otwarte: uczelnie, pracownicy, projekty, publikacje, kursy (JSON, token strony)                                                    |
| `pbn_search_publications`           | [PBN — Polska Bibliografia Naukowa](https://pbn.nauka.gov.pl/api/)                                     | Wyszukiwanie publikacji (JSON; wymaga `PBN_APP_ID` + `PBN_APP_TOKEN`)                                                                     |
| `pbn_search_persons`                | PBN                                                                                                    | Wyszukiwanie osób / ORCID (JSON; te same nagłówki co wyżej)                                                                               |
| `pbn_get_publication`               | PBN                                                                                                    | Metadane publikacji po id obiektu (JSON)                                                                                                  |
| `bdl_search_subjects`               | [BDL — Bank Danych Lokalnych (GUS)](https://bdl.stat.gov.pl/BDL/start)                                 | Wyszukiwanie tematów (subjectów) po fragmencie nazwy (API v1)                                                                             |
| `bdl_search_variables`              | BDL / GUS                                                                                              | Wyszukiwanie zmiennych statystycznych (cech)                                                                                              |
| `bdl_search_units`                  | BDL / GUS                                                                                              | Wyszukiwanie jednostek terytorialnych (TERYT itd.)                                                                                        |
| `bdl_get_variable`                  | BDL / GUS                                                                                              | Metadane jednej zmiennej po id liczbowym                                                                                                  |
| `bdl_get_data_by_variable`          | BDL / GUS                                                                                              | Wartości dla jednej zmiennej po jednostkach (np. województwa)                                                                             |
| `bdl_get_data_by_unit`              | BDL / GUS                                                                                              | Wartości dla jednej jednostki i wskazanych zmiennych                                                                                      |
| `imgw_synop`                        | [IMGW-PIB](https://danepubliczne.imgw.pl)                                                              | Aktualne odczyty ze stacji synoptycznych (pogodowych)                                                                                     |
| `imgw_hydro`                        | IMGW-PIB                                                                                               | Aktualne odczyty z wodowskazów i stacji hydrologicznych                                                                                   |
| `imgw_meteo`                        | IMGW-PIB                                                                                               | Aktualne odczyty ze stacji meteorologicznych                                                                                              |
| `imgw_warnings`                     | IMGW-PIB                                                                                               | Aktywne ostrzeżenia meteorologiczne i hydrologiczne                                                                                       |
| `pkn_search`                        | [PKN — Polski Komitet Normalizacyjny](https://www.pkn.pl)                                              | Wyszukiwarka treści strony www.pkn.pl (Drupal / Solr, HTML)                                                                               |
| `wiedza_search_norms`               | [WIEDZA — PKN](https://wiedza.pkn.pl)                                                                  | Wyszukiwarka norm (Liferay; sesja + POST, HTML)                                                                                           |
| `wiedza_get_standard`               | WIEDZA                                                                                                 | Karta pojedynczej normy po numerze katalogowym (HTML)                                                                                     |
| `blz_search`                        | [Baza Legalnych Źródeł](https://bazalegalnychzrodel.pl) (Legalna Kultura)                              | WordPress REST `/wp/v2/listings` — źródła kultury cyfrowej (JSON)                                                                         |
| `blz_get_listing`                   | Baza Legalnych Źródeł                                                                                  | Pojedyncze źródło po ID (JSON)                                                                                                            |
| `blz_listing_categories`            | Baza Legalnych Źródeł                                                                                  | Taksonomia `listing_cat` (Filmy, Muzyka, Biblioteki…) — ID do `blz_search`                                                                |
| `baztol_search`                     | [BazTOL — brama zasobów PUT](http://baztol.library.put.poznan.pl)                                      | Wyszukiwanie pełnotekstowe (HTML; katalog nieaktualizowany od 2022)                                                                       |
| `baztol_browse_domain`              | BazTOL                                                                                                 | Przeglądanie po dziedzinie (id z menu)                                                                                                    |
| `baztol_get_resource`               | BazTOL                                                                                                 | Szczegóły zasobu po ID (HTML)                                                                                                             |
| `nac_news_rss`                      | [NAC — Narodowe Archiwum Cyfrowe](https://www.nac.gov.pl/)                                             | Kanał RSS aktualności instytucji (XML)                                                                                                    |
| `nac_site_search`                   | NAC                                                                                                    | Wyszukiwarka WordPress REST (`?rest_route=/wp/v2/search`; posty/strony; JSON)                                                             |
| `nac_get_post`                      | NAC                                                                                                    | Pojedynczy wpis blogowy po id (JSON)                                                                                                      |
| `nac_get_page`                      | NAC                                                                                                    | Pojedyncza strona statyczna po id (JSON)                                                                                                  |
| `sum_aleph_find`                    | [Katalog Biblioteki ŚUM](https://katalog.sum.edu.pl/) (Aleph)                                          | X-Services `op=find` — zapytanie WWW (`wrd=`, `wti=`…; XML; możliwy błąd SRU po stronie serwera)                                          |
| `sum_aleph_present`                 | Katalog ŚUM / Aleph                                                                                    | X-Services `op=present` — rekord(y) MARC/XML (`set_no`, `set_entry`)                                                                      |
| `ludzie_search`                     | [Ludzie Nauki](https://ludzie.nauka.gov.pl)                                                            | Wyszukiwanie profili naukowców (nazwisko, dziedzina, paginacja)                                                                           |
| `ludzie_semantic_search`            | Ludzie Nauki                                                                                           | Wyszukiwanie semantyczne / pełnotekstowe po frazie                                                                                        |
| `ludzie_get_scientist`              | Ludzie Nauki                                                                                           | ORCID, stopnie/tytuły, słowa kluczowe dla profilu po ID                                                                                   |
| `pauart_search`                     | [PAUart — PAU](http://www.pauart.pl/app)                                                               | Wyszukiwanie katalogu dzieł (Collectio / PAU)                                                                                             |
| `pauart_get_artwork`                | PAUart                                                                                                 | Metadane pojedynczego dzieła po ID z katalogu                                                                                             |
| `isap_search_acts`                  | [ISAP — ELI API Sejmu](https://api.sejm.gov.pl/eli/openapi/)                                           | Wyszukiwanie aktów prawnych (tytuł, słowa kluczowe ISAP, daty, DU/MP itd.)                                                                |
| `isap_get_act`                      | ISAP / ELI                                                                                             | Metadane pojedynczego aktu po ELI, np. `DU/2026/370`                                                                                      |
| `bs_sejm_search`                    | [Biblioteka Sejmowa — OPAC](https://bs.sejm.gov.pl/F)                                                  | Wyszukiwanie słowne (`func=find-b`); zwraca HTML listy (np. `bis01`, `pos01`)                                                             |
| `bs_sejm_get_item`                  | Biblioteka Sejmowa                                                                                     | Karta bibliograficzna (`func=item-global`) po `doc_library` + `doc_number` — HTML                                                         |
| `saos_search_judgments`             | [SAOS](https://www.saos.org.pl/help/index.php/dokumentacja-api/api-przeszukiwania-danych)              | Wyszukiwanie orzeczeń (fraza `all`, daty, sygnatura, sąd, typ orzeczenia)                                                                 |
| `saos_get_judgment`                 | SAOS / API przeglądania                                                                                | Pełne orzeczenie po id liczbowym z wyszukiwarki                                                                                           |
| `saos_dump_services`                | SAOS / [API pobierania](https://www.saos.org.pl/help/index.php/dokumentacja-api/api-pobierania-danych) | Lista endpointów hurtowego pobierania (dump)                                                                                              |
| `saos_dump_common_courts`           | SAOS — dump                                                                                            | Słownik sądów powszechnich (stronicowanie)                                                                                                |
| `saos_dump_sc_chambers`             | SAOS — dump                                                                                            | Słownik izb SN (stronicowanie)                                                                                                            |
| `saos_dump_judgments`               | SAOS — dump                                                                                            | Hurtowe orzeczenia (filtry dat / synchronizacja; duże odpowiedzi)                                                                         |
| `saos_dump_enrichments`             | SAOS — dump                                                                                            | Etykiety modułu wzbogacania (stronicowanie)                                                                                               |
| `wolnelektury_list_taxonomy`        | [Wolne Lektury](https://wolnelektury.pl/api/)                                                          | Słowniki: autorzy, epoki, gatunki, rodzaje, motywy, kolekcje (slugi)                                                                      |
| `wolnelektury_filter_books`         | Wolne Lektury                                                                                          | Lista utworów po filtrach (autor/epoka/gatunek/rodzaj); nie woła `/api/books/` w całości                                                  |
| `wolnelektury_get_book`             | Wolne Lektury                                                                                          | Metadane i linki do plików po slugu utworu                                                                                                |
| `wolnelektury_get_collection`       | Wolne Lektury                                                                                          | Kolekcja tematyczna + lista książek w kolekcji                                                                                            |
| `ninateka_search`                   | [Ninateka — FINA VOD](https://ninateka.pl/)                                                            | Wyszukiwanie materiałów po słowie kluczowym (JSON API frontu; `platform=BROWSER`)                                                         |
| `ninateka_get_vod`                  | Ninateka                                                                                               | Metadane pojedynczego materiału po id liczbowym z wyszukiwarki (JSON)                                                                     |
| `gapla_search`                      | [Gapla — galeria plakatu filmowego FINA](https://gapla.fn.org.pl/)                                     | Wyszukiwanie plakatów (`szukaj.html` — tytuł / autor / reżyseria; HTML)                                                                   |
| `gapla_get_poster`                  | Gapla                                                                                                  | Strona pojedynczego plakatu po id (`plakat/{id}.html` — HTML)                                                                             |
| `fototeka_search`                   | [Fototeka — FN INA](https://fototeka.fn.org.pl/)                                                       | Wyszukiwanie fotosów i zdjęć (`wyszukiwarka.html` — tytuł / osoba / reżyseria / słowa kluczowe; HTML, paginacja `pageNumber` / `howmany`) |
| `fototeka_get_photo`                | Fototeka                                                                                               | Strona pojedynczego zdjęcia po id (`/pl/foto/view/{id}.html` — HTML)                                                                      |
| `filmpolski_search`                 | [FilmPolski.pl](https://www.filmpolski.pl/fp/) (PWSFTviT)                                              | Wyszukiwarka bazy filmu (`index.php?szukaj=&rodzaj=` — HTML parsowane do JSON: osoby, filmy; tryby fragment / początek / dokładnie)       |
| `filmpolski_get_item`               | FilmPolski.pl                                                                                          | Karta rekordu po id (`index.php/{id}`) — tekst z elementu `<article>` filmu lub osoby (obcięty)                                           |
| `fototekaslaska_search`             | [Fototeka Śląska](https://fototekaslaska.pl/) (MWO Opole)                                              | Wyszukiwanie zdjęć (WordPress GET `?s=&t=&y=`; HTML z `.search-list` → JSON: slug, URL, podpis, miniatura)                                |
| `fototekaslaska_get_photo`          | Fototeka Śląska                                                                                        | Strona rekordu `/galeria/{slug}/` — tytuł, nr katalogowy, URL zdjęcia, opis i tabela (tekst)                                              |
| `fn_repo_search`                    | [Repozytorium FN](https://repozytorium.fn.org.pl/)                                                     | Wyszukiwanie Solr (HTML — kafelki wyników; brak publicznego JSON API)                                                                     |
| `fn_repo_get_node`                  | Repozytorium FN                                                                                        | Karta rekordu po id węzła Drupal (`/?q=pl/node/{id}` — HTML)                                                                              |
| `fn_repo_film_index`                | Repozytorium FN                                                                                        | Indeks tytułów po pierwszej literze (A–Ż / INNE — HTML)                                                                                   |
| `fn_repo_browse_kind`               | Repozytorium FN                                                                                        | Przegląd: fabularne / dokumentalne / animacje / magazyn (HTML)                                                                            |
| `dokumenty_slaska_get_page`         | [Dokumenty Śląska](https://www.dokumentyslaska.pl/)                                                    | Pobranie pojedynczej strony statycznej po ścieżce względnej (`indeks …`, `dokument …`, podkatalogi — HTML)                                |
| `dokumenty_slaska_medieval_catalog` | Dokumenty Śląska                                                                                       | Lista JSON ścieżek do głównej serii dokumentów średniowiecznych (okresy do 1333 r.) — pomoc nawigacyjna                                   |

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

**[Narodowe Archiwum Cyfrowe](https://www.nac.gov.pl/)** — strona instytucji na WordPressie: narzędzia **`nac_*`** używają kanału **RSS** (`/feed/`) oraz WordPress REST przez fallback `?rest_route=/wp/v2/...` (często stabilniejszy niż `/wp-json/...` przy ochronach WAF). Zdigitalizowane materiały archiwalne są w serwisie [Szukaj w Archiwach](https://szukajwarchiwach.gov.pl/) ([informacje NAC](https://www.nac.gov.pl/archiwum-cyfrowe/systemy-i-infrastruktura-it/szukajwarchiwach-pl/)) — **brak tam publicznego, udokumentowanego API** do przeszukiwania katalogu; często działa też ochrona przed botami (Incapsula).

**[Katalog Biblioteki Śląskiego Uniwersytetu Medycznego](https://katalog.sum.edu.pl/)** to OPAC **Aleph (Ex Libris)**. Interfejs maszynowy: **Aleph X-Services** pod `https://katalog.sum.edu.pl/X` (odpowiedzi XML), zgodnie z [dokumentacją Ex Libris](https://developers.exlibrisgroup.com/aleph/apis/aleph-x-services/). **`sum_aleph_find`** woła `op=find` (np. `request=wrd=…`); na instalacji może pojawić się komunikat o braku konfiguracji bramki SRU — wtedy wyszukiwanie przez X-Server wymaga naprawy po stronie biblioteki. **`sum_aleph_present`** (`op=present`, format `marc` itd.) służy do pobrania rekordów z numeru zestawu i pozycji.

Większość baz oferuje **otwarty dostęp do odczytu** bez obowiązkowych kluczy API. Wyjątki: narzędzia **WIEDZA** (`wiedza_*`) nie buforują odpowiedzi (sesja Liferay); **PKN www** (`pkn_search`) ma krótszy TTL cache niż repozytoria akademickie. **BDL (GUS)** działa anonimowo, ale możesz ustawić zmienną środowiskową `BDL_CLIENT_ID` (nagłówek `X-ClientId`), jeśli masz klucz z [Portalu API GUS](https://api.stat.gov.pl/home/bdlapi) — wtedy wyższe limity wywołań po stronie GUS. Dokumentacja REST: `https://bdl.stat.gov.pl/api/v1/` (OpenAPI: `…/swagger/doc/swagger.json`).

**PBN (wymagane dostępy):** aby włączyć narzędzia **`pbn_search_publications`**, **`pbn_search_persons`** i **`pbn_get_publication`**, musisz mieć aktywny dostęp do API PBN i ustawić co najmniej `PBN_APP_ID` + `PBN_APP_TOKEN` (opcjonalnie `PBN_USER_TOKEN`). Dostęp i rejestracja aplikacji: [OpenAPI PBN](https://pbn.nauka.gov.pl/centrum-pomocy/open-api-w-wersji-produkcyjnej-pbn/) oraz [Centrum pomocy PBN](https://pbn.nauka.gov.pl/centrum-pomocy/kategoria/api/).

---

## Rozwiązywanie problemów

Najpierw uruchom `npx -y polish-academic-mcp doctor`. Sprawdza wersję Node.js, połączenie z bazami i to, które aplikacje mają skonfigurowany serwer.

| Objaw                                                                  | Co zrobić                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spawn npx ENOENT`, „command not found”, serwer ma czerwony status     | Node.js nie jest zainstalowany albo aplikacja okienkowa go nie widzi (częste przy nvm/fnm/volta na macOS). Zainstaluj LTS z [nodejs.org](https://nodejs.org) i uruchom ponownie `setup`, który zapisze pełną ścieżkę do `npx`. |
| Windows: serwer nie startuje                                           | Użyj polecenia `cmd` z argumentami `["/c", "npx", "-y", "polish-academic-mcp"]` (kreator robi to sam).                                                                                                                         |
| „Server disconnected” / „transport closed” przy pierwszym uruchomieniu | Pierwsze uruchomienie pobiera pakiet (kilka–kilkadziesiąt sekund). Poczekaj i uruchom aplikację ponownie.                                                                                                                      |
| Narzędzia nie pojawiają się                                            | Zamknij aplikację całkowicie (także z zasobnika / paska menu) i otwórz ponownie. Sprawdź limit narzędzi aplikacji i [ogranicz bazy](#wybór-baz).                                                                               |
| Model nie używa narzędzi                                               | W LM Studio, AnythingLLM i Jan włącz narzędzia w czacie lub tryb agenta i wybierz model obsługujący wywołania narzędzi (tool calling).                                                                                         |
| Błąd tylko jednej bazy                                                 | Serwis mógł być chwilowo niedostępny (np. repozytorium UAFM, wyszukiwarka SAOS). Pozostałe bazy działają niezależnie.                                                                                                          |
| Sieć firmowa z proxy                                                   | Wbudowany `fetch` w Node.js domyślnie ignoruje proxy. W aktualnych Node.js 22/24 dodaj do `env` serwera `"NODE_USE_ENV_PROXY": "1"` oraz `"HTTPS_PROXY": "http://proxy:port"`.                                                 |
| Po zmianie wersji Node.js serwer przestał działać                      | Uruchom ponownie `npx -y polish-academic-mcp setup` (`doctor` pokaże nieaktualną ścieżkę).                                                                                                                                     |

**Logi.** Komunikaty serwera trafiają do logów aplikacji, np. Claude Desktop: `~/Library/Logs/Claude/mcp-server-polish-academic.log` (macOS) lub `%APPDATA%\Claude\logs\` (Windows). Aby zobaczyć każde zapytanie HTTP do baz (adres bez wartości parametrów, status, czas), dodaj do `env` serwera `"POLISH_ACADEMIC_DEBUG": "1"`.

**Aktualizacje.** Przy wpisie `npx -y polish-academic-mcp` (bez numeru wersji) npx przy starcie aplikacji sprawdza, czy jest nowsza wersja, i ją pobiera. Jeśli wolisz aktualizować świadomie (np. w pracowni lub firmie), przypnij wersję: `npx -y polish-academic-mcp setup --pin` zapisze `polish-academic-mcp@<wersja>`. Aktualizacja to wtedy `npx -y polish-academic-mcp@<nowa-wersja> setup --pin` po sprawdzeniu nowej wersji.

**Odinstalowanie.** `npx -y polish-academic-mcp uninstall` usuwa wpis z aplikacji (z kopią zapasową pliku).

---

## Zmienne środowiskowe

Wszystkie są opcjonalne. Ustawia się je w sekcji `env` wpisu serwera w konfiguracji aplikacji.

| Zmienna                       | Działanie                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `POLISH_ACADEMIC_SOURCES`     | włączone grupy lub bazy, np. `nauka,prawo` (zob. [Wybór baz](#wybór-baz))                                                          |
| `PBN_APP_ID`, `PBN_APP_TOKEN` | dostęp do API PBN (narzędzia `pbn_*`); przyznawany instytucjom przez [PBN](https://pbn.nauka.gov.pl/centrum-pomocy/kategoria/api/) |
| `PBN_USER_TOKEN`              | token użytkownika PBN dla operacji wymagających kontekstu użytkownika                                                              |
| `BDL_CLIENT_ID`               | klucz [API GUS BDL](https://api.stat.gov.pl/home/bdlapi): wyższe limity zapytań                                                    |
| `POLISH_ACADEMIC_DEBUG`       | `1` = log każdego zapytania HTTP na stderr: adres bez wartości parametrów, status, czas (widoczny w logach aplikacji)              |

---

## Dla programistów

```bash
git clone https://github.com/asterixix/polish-academic-mcp.git
cd polish-academic-mcp
npm install
npm run build
npm test            # testy kontraktowe, konfiguracji klientów i polityki sieciowej
npm run dev         # serwer stdio z src/index.ts
npm run smoke:tools # test na żywo wszystkich narzędzi (wymaga internetu)
```

Lokalny build podłączysz do aplikacji poleceniem `node` i ścieżką bezwzględną do `dist/index.js`. Do ręcznych testów przyda się [MCP Inspector](https://github.com/modelcontextprotocol/inspector): `npx @modelcontextprotocol/inspector node dist/index.js`.

```text
Aplikacja AI (Claude, Cursor, VS Code…)
       │  stdio JSON-RPC
       ▼
src/index.ts   CLI (setup, doctor, --sources) + StdioServerTransport
src/server.ts  createServer(): rejestruje wybrane źródła z src/sources.ts
src/tools/*    jeden plik na bazę; odpowiedzi to surowe dane ze źródła
src/cache.ts   cache w pamięci, limit 30 s, jedna ponowna próba przy błędach sieci
```

Jak dodać nową bazę: [AGENTS.md](AGENTS.md). Zasady współpracy: [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Licencja

MIT
