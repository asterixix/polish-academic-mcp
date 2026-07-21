# Przewodnik dla agentów AI

> Ten dokument jest pisany jako **prompt wejściowy** dla agenta AI (np. Claude Code, Hermes Agent), który ma za zadanie skonfigurować serwer MCP `polish-academic-mcp` w środowisku użytkownika. Zawiera minimalny, wystarczający zestaw instrukcji, by agent mógł wykonać zadanie bez dodatkowych pytań.

---

## Kontekst

`polish-academic-mcp` to lokalny serwer MCP (Model Context Protocol) udostępniający **85 narzędzi** do wyszukiwania w polskich bazach naukowych, publicznych i kulturowych. Serwer:

- działa **lokalnie** (proces Node.js), komunikacja przez **stdio**,
- jest dystrybuowany wyłącznie jako pakiet npm (`npx -y polish-academic-mcp`),
- **nie wymaga** zdalnego HTTP, OAuth ani tuneli,
- działa na Node.js 18+ (sprawdź `node --version`),
- ma 82 narzędzia bez żadnej konfiguracji,
- ma 3 narzędzia PBN, które wymagają sekretów `PBN_APP_ID` i `PBN_APP_TOKEN` w zmiennych środowiskowych.

Wszystkie 85 nazw narzędzi jest **stabilne** — nie zmieniają się między wersjami.

---

## Cel zadania

Dodaj serwer `polish-academic-mcp` do klienta MCP użytkownika. Klient jest określony przez parametr `client` podany przez użytkownika (np. `claude-desktop`, `cursor`, `lm-studio`, `perplexity`, `open-webui`, `openclaw`, `hermes`, `cline`, `continue`, `roo-code`).

---

## Kroki

### 1. Wykryj klienta

Jeśli klient nie jest podany jawnie, zapytaj użytkownika: „Z jakiego klienta MCP korzystasz (Claude Desktop, Cursor, LM Studio, AnythingLLM, Perplexity, Open WebUI, OpenClaw, Hermes Agent, Cline, Continue, Roo Code)?"

Nie próbuj odgadywać klienta po platformie — różni użytkownicy tej samej platformy mogą używać różnych klientów.

### 2. Sprawdź wymagania wstępne

```bash
node --version          # wymaga ≥ 18
npx --version           # zwykle w zestawie z node
```

Jeśli `node` jest starszy niż 18, przerwij i poinformuj użytkownika, że potrzebuje aktualizacji Node.

### 3. Wybierz plik konfiguracyjny

Dla każdego klienta użyj właściwej ścieżki i formatu. Poniższa tabela daje dokładne instrukcje:

| Klient | Ścieżka pliku konfiguracyjnego |
| --- | --- |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` |
| Claude Code (per projekt) | `.mcp.json` w katalogu projektu |
| Claude Code (globalnie) | `~/.claude.json` |
| Cursor (per projekt) | `.cursor/mcp.json` w projekcie |
| Cursor (globalnie) | `~/.cursor/mcp.json` |
| LM Studio | wykrywane przez GUI, edytuj przez **Program → Edit mcp.json** |
| AnythingLLM | GUI: **Settings → Agent Skills → MCP Servers** |
| Perplexity (macOS) | obok pliku Claude Desktop, zwykle `~/Library/Application Support/Perplexity/...` |
| Open WebUI | zmienna `MCP_SERVERS` przy uruchomieniu kontenera Docker |
| OpenClaw | `~/.openclaw/config.json` |
| Hermes Agent | `~/.hermes/profiles/<profil>/config.yaml` |
| Cline / Roo Code | plik ustawień rozszerzenia VS Code (otwórz przez GUI) |
| Continue | `~/.continue/config.json` |

### 4. Wstaw konfigurację

Dla klientów z plikiem JSON wstaw **obie** sekcje (scal z istniejącą zawartością, nie nadpisuj):

```json
{
  "mcpServers": {
    "polish-academic": {
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"]
    }
  }
}
```

Jeśli użytkownik podał sekrety PBN, dodaj sekcję `env`:

```json
{
  "mcpServers": {
    "polish-academic": {
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"],
      "env": {
        "PBN_APP_ID": "<wartość>",
        "PBN_APP_TOKEN": "<wartość>"
      }
    }
  }
}
```

**Nie zapisuj sekretów w pliku konfiguracyjnym bez wyraźnej zgody użytkownika.** Zamiast tego poproś o podanie wartości lub poleć ustawienie przez zmienną środowiskową (`export PBN_APP_ID=...`).

### 5. Dla klientów YAML (Hermes Agent)

```yaml
mcp_servers:
  - name: polish-academic
    command: npx
    args: ["-y", "polish-academic-mcp"]
```

### 6. Dla Open WebUI (Docker)

Dodaj do zmiennej środowiskowej `MCP_SERVERS` kontenera:

```json
[
  {
    "name": "polish-academic",
    "command": "npx",
    "args": ["-y", "polish-academic-mcp"]
  }
]
```

### 7. Weryfikacja

Po wstawieniu konfiguracji:

1. **Zrestartuj klienta MCP** (nie zawsze wystarczy przeładowanie — pełen restart).
2. **Sprawdź listę narzędzi** — powinno być widocznych 85 pozycji z prefiksem `bn_*`, `ruj_*`, `agh_*` itd.
3. **Wykonaj jedno wywołanie testowe:**
   ```
   bn_search_publications z query="uczenie maszynowe"
   ```
   lub w języku naturalnym: „Wyszukaj artykuły o uczeniu maszynowym w Bibliotece Nauki."

4. **Oczekiwany wynik:** JSON z listą trafień zawierającą tytuły, autorów i abstrakty.

### 8. Raportowanie

Po zakończeniu wygeneruj raport w formacie:

```markdown
## Konfiguracja polish-academic-mcp dla `<klient>`

**Status:** ✅ gotowe / ⚠️ wymaga ręcznej akcji / ❌ błąd
**Plik konfiguracyjny:** `<ścieżka>`
**Sekrety:** ustawione (PBN_APP_ID, PBN_APP_TOKEN) / nie ustawione
**Weryfikacja:** wykonano wywołanie `bn_search_publications` — sukces / błąd
**Narzędzia widoczne w kliencie:** 85 / 0 / (nie sprawdzono)

### Dalsze kroki dla użytkownika
1. Zrestartuj klienta.
2. Sprawdź listę narzędzi (ikona 🔨).
3. [opcjonalnie] Ustaw sekrety PBN jeśli potrzebne.
```

---

## Znane pułapki

### 1. Ścieżka `npx` nie istnieje

`which npx` (Linux/macOS) lub `where npx` (Windows). Jeśli brak — zainstaluj Node.js 18+.

### 2. Pierwsze uruchomienie trwa długo

`npx -y polish-academic-mcp` pobiera pakiet przy pierwszym uruchomieniu. Może trwać 5-30 sekund w zależności od łącza. Zachowaj cierpliwość.

### 3. Uprawnienia do pliku konfiguracyjnego

Pliki konfiguracyjne klientów są w katalogach użytkownika. Nie uruchamiaj `sudo` do ich edycji — wystarczy standardowe konto.

### 4. Wielu użytkowników na tej samej maszynie

Każdy użytkownik ma własny plik konfiguracyjny. Nie nadpisuj cudzych ustawień.

### 5. Konflikt z innym serwerem MCP o tej samej nazwie

Jeśli w pliku istnieje już wpis `polish-academic` — nie nadpisuj, scal. Użytkownik mógł mieć starszą wersję.

### 6. Klient nie wspiera MCP

Lista klientów, które **nie** wspierają MCP (stan na 2026-07-20):

- ChatGPT web/desktop (wymaga SSE/HTTP, nie stdio)
- Wszystkie edytory tekstu bez rozszerzenia MCP
- Starsze wersje VS Code (< 1.85 bez Cline/Continue)

Dla ChatGPT istnieje planowana integracja przez HTTP w przyszłej wersji MCP — w obecnej wersji 1.1.0 nie jest dostępna.

---

## Pełna lista narzędzi (do rozpoznawania po nazwie)

Narzędzia są pogrupowane tematycznie. Każda grupa ma spójny prefiks:

| Prefiks | Baza |
| --- | --- |
| `bn_*` | Biblioteka Nauki |
| `ruj_*` | Repozytorium UJ |
| `agh_*` | Repozytorium AGH |
| `amu_*` | Repozytorium UAM |
| `uafm_*` | Repozytorium UAFM (obecnie niedostępne) |
| `icm_*` | ICM Open UW |
| `rodbuk_*` | RODBuK |
| `repod_*` | RePOD |
| `dane_*` | dane.gov.pl |
| `polon_*` | POL-on |
| `pbn_*` | PBN (wymaga sekretów) |
| `bdl_*` | BDL / GUS |
| `imgw_*` | IMGW-PIB |
| `pkn_*`, `wiedza_*` | PKN |
| `blz_*` | Baza Legalnych Źródeł |
| `baztol_*` | BazTOL |
| `nac_*` | Narodowe Archiwum Cyfrowe |
| `sum_*` | Biblioteka ŚUM |
| `ludzie_*` | Ludzie Nauki |
| `pauart_*` | PAUart |
| `isap_*` | ISAP / ELI |
| `bs_sejm_*` | Biblioteka Sejmowa |
| `saos_*` | SAOS |
| `wolnelektury_*` | Wolne Lektury |
| `ninateka_*` | Ninateka |
| `gapla_*` | Gapla |
| `fototeka_*` | Fototeka |
| `filmpolski_*` | FilmPolski.pl |
| `fototekaslaska_*` | Fototeka Śląska |
| `filmoteka_repo_*` (prefix `fn_repo_*`) | Filmoteka Narodowa |
| `rcin_*` | RCIN |
| `dokumenty_slaska_*` | Dokumenty Śląska |

---

## Zasady komunikacji z użytkownikiem

- **Nie pytaj o sekrety PBN**, jeśli użytkownik nie wspomniał o PBN. Trzy narzędzia PBN bez sekretów zwracają czytelny komunikat.
- **Nie modyfikuj innych serwerów MCP** w pliku konfiguracyjnym — użytkownik może mieć inne serwery.
- **Nie instaluj pakietu globalnie** (`npm install -g`). Używaj wyłącznie `npx -y polish-academic-mcp` — to wymóg tej wersji.
- **Po wstawieniu konfiguracji zawsze zrestartuj klienta**, w przeciwnym razie MCP nie załaduje nowego serwera.
- **Nie publikuj raportu przed wykonaniem weryfikacji** — użytkownik powinien zobaczyć konkretny wynik testu, nie ogólnikowe „powinno działać".