# Przewodnik dla agentów AI

> Ten dokument jest **promptem wejściowym** dla agenta AI (np. Claude Code, Codex, Gemini CLI, Hermes Agent), który ma skonfigurować serwer MCP `polish-academic-mcp` u użytkownika. Zawiera wszystko, czego agent potrzebuje, by wykonać zadanie bez zgadywania.

---

## Kontekst

`polish-academic-mcp` to lokalny serwer MCP (stdio, Node.js 18.17+) z **85 narzędziami** do przeszukiwania polskich baz naukowych, publicznych i kulturowych. Dystrybucja wyłącznie przez npm (`npx -y polish-academic-mcp`). Nie wymaga zdalnego HTTP, OAuth ani tuneli. 82 narzędzia działają bez konfiguracji; 3 narzędzia `pbn_*` wymagają `PBN_APP_ID` i `PBN_APP_TOKEN`.

Pakiet zawiera kreator, który sam edytuje konfigurację aplikacji: scala wpis z istniejącym plikiem, robi kopię zapasową, pomija pliki z komentarzami (JSONC), usuwa zdublowane wpisy tego pakietu oraz dobiera polecenie do systemu (`cmd /c npx` na Windows, pełna ścieżka do `npx` przy nvm/fnm/volta). **Używaj kreatora zamiast ręcznej edycji plików.**

---

## Kroki

### 1. Ustal aplikację

Jeśli użytkownik jej nie podał, zapytaj: „W jakiej aplikacji AI chcesz używać polskich baz (np. Claude Desktop, Claude Code, Cursor, VS Code, LM Studio)?” Nie zgaduj na podstawie systemu operacyjnego.

Identyfikatory dla `--client`:

| Konfigurowane automatycznie                                                                                                                                        | Tylko instrukcja (`--print`)                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `claude-desktop`, `claude-code`, `cursor`, `vscode`, `windsurf`, `cline`, `roo-code`, `lm-studio`, `anythingllm`, `gemini-cli`, `codex`, `opencode`, `copilot-cli` | `zed`, `continue`, `goose`, `hermes`, `openclaw`, `jan`, `perplexity`, `open-webui`, `generic` |

`npx -y polish-academic-mcp setup --list` pokazuje, które aplikacje wykryto i gdzie leżą ich pliki.

### 2. Sprawdź wymagania

```bash
node --version   # wymagane >= 18.17
```

Jeśli Node.js nie ma lub jest starszy, przerwij i poproś użytkownika o instalację wersji LTS z https://nodejs.org.

### 3. Ustal zakres baz (opcjonalnie)

Wszystkie 85 narzędzi to ok. 26 tys. tokenów. Zaproponuj ograniczenie, gdy:

- aplikacja to Cursor (limit ok. 40 narzędzi), Windsurf (100) lub VS Code (128 łącznie ze wszystkimi serwerami),
- użytkownik korzysta z małego modelu lokalnego (LM Studio, Ollama, Jan).

Grupy: `nauka` (30 narzędzi), `dane` (12), `prawo` (11), `normy` (3), `kultura` (29). Lista baz: `npx -y polish-academic-mcp --list-sources`.

### 4. Pokaż plan, potem zapisz

```bash
npx -y polish-academic-mcp setup --client <id> [--sources nauka,prawo] --dry-run   # plan bez zapisu
npx -y polish-academic-mcp setup --client <id> [--sources nauka,prawo] --yes       # zapis
```

Bez `--yes` w nieinteraktywnej powłoce kreator niczego nie zapisuje. Przed zapisem poproś użytkownika o całkowite zamknięcie aplikacji docelowej (niektóre nadpisują konfigurację przy zamykaniu).

Dla aplikacji z prawej kolumny tabeli uruchom `npx -y polish-academic-mcp setup --print <id>` i przekaż użytkownikowi wypisaną instrukcję (albo wykonaj ją, jeśli to polecenie terminala, np. `openclaw mcp set …`).

Jeśli kreator zgłosi `[!] … pomijam` (np. plik z komentarzami), wypisz wpis przez `--print <id>` i wklej go do pliku ręcznie, scalając z istniejącą zawartością.

### 5. Sekrety PBN (tylko na prośbę użytkownika)

Nie pytaj o PBN, jeśli użytkownik o nim nie wspomniał. Jeśli poda klucze, **za jego wyraźną zgodą** dopisz do wpisu `polish-academic` sekcję `env` z `PBN_APP_ID` i `PBN_APP_TOKEN` (w Codeksie: tabela `[mcp_servers.polish-academic.env]`). Nie zapisuj sekretów w repozytoriach ani w plikach projektu (`.mcp.json`, `.vscode/mcp.json`).

### 6. Weryfikacja

```bash
npx -y polish-academic-mcp doctor
```

Oczekiwane: `[OK]` przy Node.js, internecie i docelowej aplikacji. Następnie poproś użytkownika o ponowne uruchomienie aplikacji i zadanie pytania testowego: „Wyszukaj w Bibliotece Nauki artykuły o uczeniu maszynowym z 2024 roku.” (narzędzie `bn_search_publications`).

Jeśli sam jesteś klientem MCP z dostępem do tego serwera (np. Claude Code po `setup --client claude-code` i restarcie sesji), wykonaj to wywołanie samodzielnie.

### 7. Raport

```markdown
## Konfiguracja polish-academic-mcp dla `<aplikacja>`

**Status:** ✅ gotowe / ⚠️ wymaga ręcznej akcji / ❌ błąd
**Plik konfiguracyjny:** `<ścieżka z wyniku setup>` (kopia: `<ścieżka .bak>`)
**Bazy:** wszystkie / `<POLISH_ACADEMIC_SOURCES>`
**Sekrety PBN:** ustawione / nie ustawione
**doctor:** `<podsumowanie>`
**Test w aplikacji:** wykonano / czeka na restart aplikacji przez użytkownika

### Dalsze kroki dla użytkownika

1. Zamknij aplikację całkowicie i uruchom ponownie.
2. Zadaj pytanie testowe.
```

---

## Znane pułapki

1. **„spawn npx ENOENT” w aplikacji okienkowej:** Node.js z nvm/fnm/volta nie jest widoczny dla aplikacji z Docka. Rozwiązanie: uruchom `setup` ponownie; kreator zapisze pełną ścieżkę. Po zmianie wersji Node.js trzeba powtórzyć `setup`.
2. **Windows:** zawsze `cmd /c npx …` (kreator robi to sam).
3. **Pierwsze uruchomienie trwa dłużej:** `npx` pobiera pakiet (5–30 s). Codex ma domyślnie 10 s na start serwera; kreator podnosi ten limit do 60 s.
4. **Duplikaty:** starsze instrukcje używały nazwy `polish-academic-mcp`. Kreator usuwa wpisy uruchamiające ten pakiet pod inną nazwą, żeby narzędzia nie pojawiły się dwa razy.
5. **Uprawnienia:** pliki konfiguracyjne są w katalogu użytkownika. Nie używaj `sudo`.
6. **Aplikacje bez lokalnego MCP:** ChatGPT i Claude.ai w przeglądarce obsługują tylko zdalne serwery MCP (HTTPS). Open WebUI wymaga mostu `mcpo` (`setup --print open-webui`).

---

## Zasady komunikacji z użytkownikiem

- **Nie modyfikuj innych serwerów MCP** w plikach konfiguracyjnych.
- **Nie instaluj pakietu globalnie** (`npm install -g`). Używaj `npx -y polish-academic-mcp`.
- **Nie ogłaszaj sukcesu przed weryfikacją:** pokaż wynik `doctor` i poproś o test w aplikacji.
- Aby cofnąć zmiany: `npx -y polish-academic-mcp uninstall --client <id> --yes` (albo przywróć plik `.bak-<data>`).

---

## Prefiksy narzędzi

| Prefiks                                                                                                                                           | Baza                                          | Grupa   |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------- |
| `bn_`                                                                                                                                             | Biblioteka Nauki                              | nauka   |
| `rcin_`                                                                                                                                           | RCIN                                          | nauka   |
| `ruj_`, `agh_`, `amu_`, `uafm_`                                                                                                                   | repozytoria UJ, AGH, UAM, UAFM                | nauka   |
| `icm_`, `rodbuk_`, `repod_`                                                                                                                       | dane badawcze ICM UW, RODBuK, RePOD           | nauka   |
| `polon_`, `pbn_`, `ludzie_`                                                                                                                       | POL-on, PBN (wymaga kluczy), Ludzie Nauki     | nauka   |
| `baztol_`, `sum_`                                                                                                                                 | BazTOL, katalog ŚUM                           | nauka   |
| `dane_`, `bdl_`, `imgw_`                                                                                                                          | dane.gov.pl, BDL GUS, IMGW                    | dane    |
| `isap_`, `saos_`, `bs_sejm_`                                                                                                                      | ISAP/ELI, SAOS, Biblioteka Sejmowa            | prawo   |
| `pkn_`, `wiedza_`                                                                                                                                 | PKN, katalog norm WIEDZA                      | normy   |
| `wolnelektury_`, `ninateka_`, `gapla_`, `fototeka_`, `filmpolski_`, `fototekaslaska_`, `fn_repo_`, `nac_`, `pauart_`, `blz_`, `dokumenty_slaska_` | literatura, film, fotografia, archiwa, sztuka | kultura |
