# Przewodnik konfiguracji klientów MCP

> Weryfikacja: 2026-07-20. Aktualne dla `polish-academic-mcp@1.1.0`.
>
> Wszystkie snippety poniżej uruchamiają serwer lokalnie przez **stdio** (`npx -y polish-academic-mcp`). Żaden klient w tej wersji nie wymaga zdalnego HTTP ani tunelu.

## Spis treści

1. [Wspólne zasady](#wspolne-zasady)
2. [Claude Desktop](#claude-desktop)
3. [Claude Code (CLI)](#claude-code-cli)
4. [Cursor](#cursor)
5. [LM Studio](#lm-studio)
6. [AnythingLLM](#anythingllm)
7. [Perplexity (macOS)](#perplexity-macos)
8. [Open WebUI](#open-webui)
9. [OpenClaw](#openclaw)
10. [Hermes Agent](#hermes-agent)
11. [Cline / Continue / Roo Code (VS Code)](#cline--continue--roo-code-vs-code)
12. [Zmienne środowiskowe](#zmienne-srodowiskowe)
13. [Diagnostyka problemów](#diagnostyka-problemow)

---

## Wspólne zasady

### Minimalny wpis konfiguracyjny (każdy klient)

Każdy klient MCP komunikujący się przez stdio potrzebuje trzech informacji:

| Pole | Wartość dla `polish-academic-mcp` |
| --- | --- |
| Polecenie (command) | `npx` |
| Argumenty (args) | `["-y", "polish-academic-mcp"]` |
| Zmienne środowiskowe | (opcjonalne, patrz [Zmienne środowiskowe](#zmienne-srodowiskowe)) |

Większość klientów używa formatu JSON z polem `command`, `args`, `env`. Niektóre (LM Studio, AnythingLLM) mają własne GUI.

### Pierwszy test po konfiguracji

Po dodaniu serwera wykonaj w kliencie jedno z poniższych:

- **Rozmowa:** „Wyszukaj w Bibliotece Nauki artykuły o uczeniu maszynowym z 2024 roku."
- **Bezpośrednie wywołanie (jeśli klient pozwala):** `bn_search_publications` z `query="uczenie maszynowe"` i `published_date_from="2024-01-01"`.

Oczekiwany wynik: lista trafień z tytułami, autorami, abstraktami (JSON, surowy tekst). Brak odpowiedzi oznacza, że klient nie uruchomił serwera — sprawdź logi.

### Co wymaga konfiguracji warunkowej

Tylko **trzy narzędzia** wymagają sekretów w zmiennych środowiskowych:

- `pbn_search_publications`, `pbn_search_persons`, `pbn_get_publication` — wymagają `PBN_APP_ID` i `PBN_APP_TOKEN` (zapytaj swój instytut o token API PBN).

Bez tych zmiennych trzy narzędzia PBN zwracają czytelny komunikat po polsku z instrukcją. Pozostałe 82 narzędzia działają bez żadnej konfiguracji.

---

## Claude Desktop

**Platforma:** macOS, Windows, Linux.
**Format:** JSON w pliku konfiguracyjnym.
**Dokumentacja:** <https://modelcontextprotocol.io/docs/develop/build-server>

### Lokalizacja pliku

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

### Snippet

```json
{
  "mcpServers": {
    "polish-academic": {
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"],
      "env": {
        "PBN_APP_ID": "twój_pbn_id",
        "PBN_APP_TOKEN": "twój_pbn_token"
      }
    }
  }
}
```

### Weryfikacja

1. Uruchom Claude Desktop.
2. Kliknij ikonę narzędzi (🔨) w polu rozmowy. Powinna pojawić się lista 85 narzędzi `polish-academic-mcp`.
3. Zadaj pytanie: „Znajdź w repozytorium AGH prace o grafenie z 2023 roku."
4. Claude wywoła `agh_search` automatycznie.

---

## Claude Code (CLI)

**Platforma:** macOS, Linux, Windows (WSL).
**Format:** JSON w `.mcp.json` w katalogu projektu lub w konfiguracji użytkownika.
**Dokumentacja:** <https://docs.claude.com/en/docs/claude-code/mcp>

### Snippet (per projekt)

Plik `.mcp.json` w katalogu głównym repo:

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

### Snippet (globalnie)

`~/.claude.json`:

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

### Weryfikacja

W terminalu:

```bash
claude mcp list
# powinno wyświetlić polish-academic wraz z dostępnymi narzędziami
```

W rozmowie z Claude Code:

```
> Wyszukaj w Ludziach Nauki profile z dziedziny informatyki.
```

---

## Cursor

**Platforma:** macOS, Windows, Linux.
**Format:** JSON w `.cursor/mcp.json` w katalogu projektu lub globalnie `~/.cursor/mcp.json`.
**Dokumentacja:** <https://docs.cursor.com/welcome/mcp>

### Snippet

`~/.cursor/mcp.json`:

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

### Weryfikacja

1. Uruchom Cursor.
2. Otwórz Composer (Ctrl/Cmd+I) i zapytaj o dane z polskich baz naukowych.
3. Cursor wyświetli ikonę narzędzia przy każdym wywołaniu MCP.

---

## LM Studio

**Platforma:** macOS, Windows, Linux.
**Format:** GUI — program wykrywa serwery MCP automatycznie.
**Dokumentacja:** <https://lmstudio.ai/docs/developer/mcp>

### Konfiguracja

1. Otwórz LM Studio.
2. Przejdź do zakładki **Program (Ctrl/Cmd+Shift+P)** → **Install → Edit mcp.json**.
3. Wklej:

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

4. Kliknij **Save**. LM Studio automatycznie pobierze pakiet i zarejestruje serwer.

### Weryfikacja

- W panelu **Program** przy nazwie modelu pojawi się ikona narzędzi MCP.
- Po wpisaniu zapytania „Wyszukaj w BDL dane o populacji Krakowa" model powinien wywołać `bdl_search_units`.

---

## AnythingLLM

**Platforma:** macOS, Windows, Linux, Docker.
**Format:** GUI w ustawieniach agentów MCP.
**Dokumentacja:** <https://docs.anythingllm.com/mcp-compatibility/overview>

### Konfiguracja

1. Otwórz AnythingLLM.
2. Przejdź do **Settings → Agent Skills → MCP Servers**.
3. Kliknij **Add MCP Server**.
4. Wypełnij:
   - **Name:** `polish-academic`
   - **Command:** `npx`
   - **Args:** `-y,polish-academic-mcp` (oddzielone przecinkami)
5. Zapisz.

### Weryfikacja

- W nowym workspace kliknij **Agents → MCP Servers**. Przy nazwie `polish-academic` powinny widnieć 85 narzędzi.
- Zadaj pytanie agentowi włączonemu MCP — np. „Wyszukaj w PBN publikacje Kowalskiego".

---

## Perplexity (macOS)

**Platforma:** macOS (aplikacja desktop).
**Format:** JSON w `~/Library/Application Support/Perplexity/...` (sprawdź najnowszą lokalizację).
**Dokumentacja:** <https://docs.perplexity.ai/guides/mcp>

### Konfiguracja

Perplexity Desktop korzysta z tego samego formatu co Claude Desktop:

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

Plik konfiguracyjny Perplexity jest zwykle obok pliku Claude Desktop.

### Weryfikacja

- W oknie czatu ikona narzędzi MCP powinna pokazać dostępne serwery.
- Zadaj pytanie o dane z polskich baz.

---

## Open WebUI

**Platforma:** Linux (serwer WebUI), Docker.
**Format:** zmienna środowiskowa przy uruchomieniu kontenera.
**Dokumentacja:** <https://docs.openwebui.com/features/mcp>

### Snippet (Docker)

```bash
docker run -d \
  --name open-webui \
  -p 3000:8080 \
  -e OPENAI_API_KEY=... \
  -e MCP_SERVERS='[
    {
      "name": "polish-academic",
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"]
    }
  ]' \
  ghcr.io/open-webui/open-webui:main
```

### Weryfikacja

- Zaloguj się do Open WebUI.
- W nowej rozmowie kliknij **Tools**. Powinna pojawić się pozycja `polish-academic` z listą narzędzi.

---

## OpenClaw

**Platforma:** Linux, macOS.
**Format:** JSON w `~/.openclaw/config.json`.
**Dokumentacja:** <https://openclaw.dev/docs/mcp>

### Snippet

```json
{
  "servers": {
    "polish-academic": {
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"]
    }
  }
}
```

### Weryfikacja

- W CLI OpenClaw wpisz `openclaw tools list` — powinno pokazać 85 narzędzi z `polish-academic-mcp`.

---

## Hermes Agent

**Platforma:** macOS, Linux, Windows.
**Format:** YAML lub JSON w `~/.hermes/profiles/<profil>/config.yaml`.
**Dokumentacja:** <https://hermes-agent.nousresearch.com/docs>

### Snippet

W pliku profilu:

```yaml
mcp_servers:
  - name: polish-academic
    command: npx
    args: ["-y", "polish-academic-mcp"]
```

### Weryfikacja

- W CLI Hermes wpisz `hermes tools` — powinny być widoczne wszystkie 85 narzędzi.

---

## Cline / Continue / Roo Code (VS Code)

**Platforma:** dowolna z VS Code.
**Format:** JSON w konfiguracji rozszerzenia.

### Cline

`cline_mcp_settings.json`:

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

### Continue

`~/.continue/config.json` → sekcja `experimental.mcpServers`:

```json
{
  "experimental": {
    "mcpServers": [
      {
        "name": "polish-academic",
        "command": "npx",
        "args": ["-y", "polish-academic-mcp"]
      }
    ]
  }
}
```

### Roo Code

`roo_code_mcp_settings.json` (w ustawieniach rozszerzenia) — format identyczny jak Cline.

---

## Zmienne środowiskowe

| Zmienna | Narzędzia, które jej używają | Wymagana? | Skąd wziąć |
| --- | --- | --- | --- |
| `PBN_APP_ID` | `pbn_search_publications`, `pbn_search_persons`, `pbn_get_publication` | tylko dla PBN | <https://pbn.nauka.gov.pl/api/> — wniosek instytucjonalny |
| `PBN_APP_TOKEN` | j.w. | tylko dla PBN | j.w. |
| `BDL_CLIENT_ID` | `bdl_search_*`, `bdl_get_*` | opcjonalna (wyższe limity) | <https://api.stat.gov.pl> |
| `PBN_OPENAIRE_TOKEN` | (zarezerwowane na przyszłość) | — | — |

### Jak ustawić zmienne w systemie

**Linux / macOS (jednorazowo w sesji):**

```bash
export PBN_APP_ID=twoje_id
export PBN_APP_TOKEN=twoj_token
npx -y polish-academic-mcp
```

**Linux / macOS (trwale w `~/.bashrc` lub `~/.zshrc`):**

```bash
echo 'export PBN_APP_ID=twoje_id' >> ~/.bashrc
echo 'export PBN_APP_TOKEN=twoj_token' >> ~/.bashrc
```

**Windows (PowerShell):**

```powershell
$env:PBN_APP_ID="twoje_id"
$env:PBN_APP_TOKEN="twoj_token"
```

**W pliku konfiguracyjnym klienta MCP:** większość klientów akceptuje pole `env` (zob. snippety wyżej).

---

## Diagnostyka problemów

### Serwer nie startuje

1. **Sprawdź wersję Node:** `node --version` — musi być 18.0.0 lub nowsza.
2. **Sprawdź ręczne uruchomienie:**
   ```bash
   npx -y polish-academic-mcp --version
   # powinno wypisać: 1.1.0
   ```
3. **Sprawdź ścieżkę `npx`:** `which npx` (Linux/macOS) lub `where npx` (Windows).
4. **Sprawdź logi klienta** — zwykle w `Help → Show Logs` lub przez `tail -f` na pliku logu.

### Narzędzia widoczne, ale wywołania się nie udają

1. **Brak internetu** — serwer potrzebuje dostępu do oryginalnych API baz (ruj.uj.edu.pl, bibliotekanauki.pl itd.).
2. **Proxy firmowe** — niektóre bazy (np. SAOS) nie odpowiadają przez proxy. Uruchom klienta poza siecią firmową.
3. **Timeout** — domyślny limit to 30 sekund. Wolniejsze API (np. SAOS wyszukiwarka) zwracają wcześniej komunikat o konserwacji.
4. **Źródło tymczasowo niedostępne** — UAFM/eRIKA i SAOS wyszukiwarka bywają wyłączone. Komunikat po polsku wyjaśnia, co zrobić.

### Błędy autoryzacji PBN

```
PBN_APP_ID i PBN_APP_TOKEN nie są ustawione. Ustaw obie zmienne środowiskowe, aby używać pbn_*.
```

Ustaw obie zmienne (patrz wyżej) i zrestartuj klienta MCP.

### Klient nie pokazuje MCP wcale

- Sprawdź, czy Twoja wersja klienta obsługuje MCP.
- Claude Desktop < 1.0 nie wspiera MCP.
- Cursor < 0.40 nie wspiera MCP.
- VS Code wymaga zainstalowanego rozszerzenia Cline / Continue / Roo Code.

### Tryb deweloperski

Aby zobaczyć surowe logi serwera:

```bash
DEBUG=1 npx -y polish-academic-mcp 2> log.txt
```

Sprawdź `log.txt` — zawiera wszystkie wywołania HTTP z pełnymi URL i statusami.