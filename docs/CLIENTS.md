# Konfiguracja aplikacji AI

> Stan na 2026-09-24. Najprostsza droga to kreator: `npx -y polish-academic-mcp setup`. Ten dokument opisuje, co kreator robi w każdej aplikacji, oraz jak skonfigurować ją ręcznie.

## Spis treści

- [Zasady wspólne](#zasady-wspólne)
- Aplikacje okienkowe: [Claude Desktop](#claude-desktop) · [LM Studio](#lm-studio) · [AnythingLLM](#anythingllm-desktop) · [Jan](#jan) · [Perplexity](#perplexity-macos) · [Msty, Cherry Studio i inne](#msty-cherry-studio-i-inne)
- Edytory: [Cursor](#cursor) · [VS Code](#vs-code-github-copilot) · [Windsurf](#windsurf) · [Cline](#cline) · [Roo Code](#roo-code) · [Continue](#continue) · [Zed](#zed)
- Terminal: [Claude Code](#claude-code) · [Gemini CLI](#gemini-cli) · [Codex CLI](#openai-codex-cli) · [opencode](#opencode) · [GitHub Copilot CLI](#github-copilot-cli) · [Goose](#goose) · [Hermes Agent](#hermes-agent) · [OpenClaw](#openclaw)
- Serwery i przeglądarka: [Open WebUI](#open-webui) · [ChatGPT i Claude.ai](#chatgpt-i-claudeai-w-przeglądarce)
- [Diagnostyka](#diagnostyka)

---

## Zasady wspólne

**Wymagania:** Node.js 18.17 lub nowszy (zalecana wersja LTS z [nodejs.org](https://nodejs.org)). Sprawdzisz ją poleceniem `node --version`.

**Wpis serwera.** Prawie każda aplikacja potrzebuje tych samych trzech informacji:

| Pole                         | Wartość                                          |
| ---------------------------- | ------------------------------------------------ |
| polecenie (`command`)        | `npx`                                            |
| argumenty (`args`)           | `["-y", "polish-academic-mcp"]`                  |
| zmienne (`env`, opcjonalnie) | np. `{"POLISH_ACADEMIC_SOURCES": "nauka,prawo"}` |

Jako nazwę serwera stosujemy `polish-academic`. Nie dodawaj serwera dwa razy pod różnymi nazwami, bo narzędzia się zdublują (kreator usuwa takie duplikaty).

**Windows.** `npx` jest tam skryptem `.cmd` i część aplikacji nie potrafi go uruchomić bezpośrednio („spawn npx ENOENT”). Pewny wariant:

```json
{ "command": "cmd", "args": ["/c", "npx", "-y", "polish-academic-mcp"] }
```

**macOS/Linux z nvm, fnm, volta lub asdf.** Aplikacje uruchamiane z Docka lub menu nie widzą Node.js zainstalowanego tymi narzędziami. Podaj pełną ścieżkę do `npx` (wynik `which npx`) i uzupełnij `PATH`:

```json
{
  "command": "/Users/ala/.nvm/versions/node/v22.11.0/bin/npx",
  "args": ["-y", "polish-academic-mcp"],
  "env": { "PATH": "/Users/ala/.nvm/versions/node/v22.11.0/bin:/usr/local/bin:/usr/bin:/bin" }
}
```

Kreator `setup` wykrywa obie sytuacje i zapisuje właściwy wariant.

**Wybór baz.** Wszystkie 85 narzędzi to ok. 26 tys. tokenów. Przy małych modelach lokalnych i w aplikacjach z limitem narzędzi (Cursor ok. 40, Windsurf 100, VS Code 128 łącznie ze wszystkich serwerów) ustaw `POLISH_ACADEMIC_SOURCES`, np. `nauka` albo `prawo,dane`. Grupy: `nauka`, `dane`, `prawo`, `normy`, `kultura`; pełna lista: `npx -y polish-academic-mcp --list-sources`.

**Sekrety PBN.** Trzy narzędzia `pbn_*` wymagają `PBN_APP_ID` i `PBN_APP_TOKEN` w sekcji `env`. Bez nich zwracają instrukcję, a pozostałe 82 narzędzia działają normalnie. Ponowne uruchomienie `setup` zachowuje te zmienne (i inne, które dopiszesz ręcznie).

**Wersja.** Wpis bez numeru wersji (`polish-academic-mcp`) sprawia, że npx przy starcie pobiera nowsze wydania. Aby przypiąć sprawdzoną wersję, użyj `polish-academic-mcp@<wersja>` albo `setup --pin`.

**Pierwszy test.** Po ponownym uruchomieniu aplikacji zapytaj: „Wyszukaj w Bibliotece Nauki artykuły o uczeniu maszynowym z 2024 roku.” Model powinien wywołać `bn_search_publications`.

---

## Claude Desktop

**Kreator:** `npx -y polish-academic-mcp setup --client claude-desktop`

**Ręcznie:** Claude → Settings → Developer → **Edit Config** otwiera właściwy plik:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`; wersja z Microsoft Store: `%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming\Claude\claude_desktop_config.json`
- Linux (kompilacje nieoficjalne): `~/.config/Claude/claude_desktop_config.json`

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

Na Windows użyj wariantu `cmd /c` z [zasad wspólnych](#zasady-wspólne).

**Weryfikacja:** zamknij Claude całkowicie (także z zasobnika / paska menu) i otwórz ponownie. W oknie rozmowy menu narzędzi powinno pokazywać `polish-academic`. Logi: `~/Library/Logs/Claude/mcp-server-polish-academic.log` (macOS), `%APPDATA%\Claude\logs\` (Windows).

---

## Claude Code

**Kreator:** `npx -y polish-academic-mcp setup --client claude-code` (zapisuje w zakresie użytkownika, w `~/.claude.json`).

**Ręcznie**, poleceniem Claude Code:

```bash
claude mcp add --scope user polish-academic -- npx -y polish-academic-mcp
# z wyborem baz:
claude mcp add --scope user -e POLISH_ACADEMIC_SOURCES=nauka,prawo polish-academic -- npx -y polish-academic-mcp
# Windows bez WSL:
claude mcp add --scope user polish-academic -- cmd /c npx -y polish-academic-mcp
```

Dla jednego projektu zapisz plik `.mcp.json` w katalogu projektu (wtedy korzysta z niego cały zespół):

```json
{
  "mcpServers": {
    "polish-academic": { "command": "npx", "args": ["-y", "polish-academic-mcp"] }
  }
}
```

**Weryfikacja:** `claude mcp list` w terminalu albo `/mcp` w sesji Claude Code.

---

## Cursor

**Kreator:** `npx -y polish-academic-mcp setup --client cursor`, albo przycisk „Add to Cursor” w [README](../README.md#instalacja-jednym-kliknięciem).

**Ręcznie:** `~/.cursor/mcp.json` (wszystkie projekty) lub `.cursor/mcp.json` (jeden projekt):

```json
{
  "mcpServers": {
    "polish-academic": {
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"],
      "env": { "POLISH_ACADEMIC_SOURCES": "nauka" }
    }
  }
}
```

**Limit narzędzi:** Cursor ostrzega powyżej ok. 40 narzędzi i część z nich przestaje być dostępna dla agenta. Włącz jedną lub dwie grupy baz albo wyłącz pojedyncze narzędzia w ustawieniach MCP.

**Weryfikacja:** Cursor Settings → sekcja MCP: serwer powinien mieć zielony status i listę narzędzi. Narzędzia działają w trybie Agent.

---

## VS Code (GitHub Copilot)

**Kreator:** `npx -y polish-academic-mcp setup --client vscode`, albo przycisk „Zainstaluj w VS Code” w [README](../README.md#instalacja-jednym-kliknięciem).

**Ręcznie:** paleta poleceń (Ctrl/Cmd+Shift+P) → **MCP: Open User Configuration** (wszystkie projekty) lub plik `.vscode/mcp.json` (jeden projekt). VS Code używa klucza `servers` i pola `type`:

```json
{
  "servers": {
    "polish-academic": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"]
    }
  }
}
```

Z terminala: `code --add-mcp '{"name":"polish-academic","command":"npx","args":["-y","polish-academic-mcp"]}'`.

Jeśli plik `mcp.json` zawiera komentarze, kreator go nie zmienia (żeby ich nie utracić) i wypisuje wpis do wklejenia.

**Limit narzędzi:** 128 narzędzi na zapytanie łącznie ze wszystkich serwerów; w razie błędu wyłącz część narzędzi w oknie wyboru narzędzi czatu lub ogranicz bazy.

**Weryfikacja:** **MCP: List Servers** → `polish-academic` → Start. W czacie Copilota wybierz tryb Agent i sprawdź listę narzędzi.

---

## Windsurf

**Kreator:** `npx -y polish-academic-mcp setup --client windsurf`

**Ręcznie:** `~/.codeium/windsurf/mcp_config.json` (Windows: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`), format `mcpServers` jak w Cursorze.

**Limit narzędzi:** 100 aktywnych narzędzi łącznie ze wszystkich serwerów. Przy innych serwerach ogranicz bazy lub wyłącz część narzędzi w panelu MCP.

**Weryfikacja:** panel Cascade → ikona MCP → odśwież; serwer powinien pokazać listę narzędzi.

---

## Cline

**Kreator:** `npx -y polish-academic-mcp setup --client cline`

**Ręcznie:** panel Cline → MCP Servers → Configure (otwiera `cline_mcp_settings.json` w katalogu `globalStorage/saoudrizwan.claude-dev/settings/` ustawień VS Code):

```json
{
  "mcpServers": {
    "polish-academic": {
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"],
      "disabled": false
    }
  }
}
```

---

## Roo Code

**Kreator:** `npx -y polish-academic-mcp setup --client roo-code`

**Ręcznie:** panel Roo Code → MCP Servers → Edit Global MCP (`mcp_settings.json`) albo `.roo/mcp.json` w projekcie. Format jak w Cline.

---

## Continue

Wypisanie instrukcji: `npx -y polish-academic-mcp setup --print continue`

Dopisz do `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: polish-academic
    type: stdio
    command: npx
    args: ["-y", "polish-academic-mcp"]
```

Narzędzia MCP działają w trybie Agent.

---

## Zed

Wypisanie instrukcji: `npx -y polish-academic-mcp setup --print zed`

Settings → Open Settings (`settings.json`), w obiekcie głównym:

```json
{
  "context_servers": {
    "polish-academic": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"],
      "env": {}
    }
  }
}
```

Kreator nie edytuje tego pliku, bo zwykle zawiera komentarze. Status serwera (zielona kropka) widać w ustawieniach panelu Agent.

---

## Gemini CLI

**Kreator:** `npx -y polish-academic-mcp setup --client gemini-cli`

**Ręcznie:** `~/.gemini/settings.json` (wszystkie projekty) lub `.gemini/settings.json` (projekt), format `mcpServers`:

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

**Weryfikacja:** `/mcp` w sesji Gemini CLI.

---

## OpenAI Codex CLI

**Kreator:** `npx -y polish-academic-mcp setup --client codex`

**Ręcznie:** `codex mcp add polish-academic -- npx -y polish-academic-mcp` albo wpis w `~/.codex/config.toml`:

```toml
[mcp_servers.polish-academic]
command = "npx"
args = ["-y", "polish-academic-mcp"]
startup_timeout_sec = 60
tool_timeout_sec = 120

[mcp_servers.polish-academic.env]
POLISH_ACADEMIC_SOURCES = "nauka"
```

Domyślny limit startu serwera w Codeksie to 10 s, a pierwsze uruchomienie `npx` pobiera pakiet, dlatego warto go podnieść (kreator ustawia 60 s).

**Weryfikacja:** `/mcp` w sesji Codeksa.

---

## opencode

**Kreator:** `npx -y polish-academic-mcp setup --client opencode`

**Ręcznie:** `~/.config/opencode/opencode.json` (lub `opencode.json` w projekcie). opencode podaje polecenie jako jedną tablicę:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "polish-academic": {
      "type": "local",
      "command": ["npx", "-y", "polish-academic-mcp"],
      "enabled": true,
      "environment": { "POLISH_ACADEMIC_SOURCES": "nauka" }
    }
  }
}
```

---

## GitHub Copilot CLI

**Kreator:** `npx -y polish-academic-mcp setup --client copilot-cli`

**Ręcznie:** w sesji `copilot` wpisz `/mcp add` i wypełnij formularz (typ: Local/STDIO, polecenie `npx -y polish-academic-mcp`) albo edytuj `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "polish-academic": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"],
      "tools": ["*"]
    }
  }
}
```

---

## Goose

Wypisanie instrukcji: `npx -y polish-academic-mcp setup --print goose`

`goose configure` → Add Extension → Command-line Extension, polecenie `npx -y polish-academic-mcp`. Albo w `~/.config/goose/config.yaml`:

```yaml
extensions:
  polish-academic:
    name: polish-academic
    type: stdio
    cmd: npx
    args: ["-y", "polish-academic-mcp"]
    enabled: true
    timeout: 300
```

---

## Hermes Agent

Wypisanie instrukcji: `npx -y polish-academic-mcp setup --print hermes`

W `~/.hermes/config.yaml` (sekcja `mcp_servers`, klucz = nazwa serwera):

```yaml
mcp_servers:
  polish-academic:
    command: "npx"
    args: ["-y", "polish-academic-mcp"]
```

Uruchom Hermes ponownie.

---

## OpenClaw

```bash
openclaw mcp set polish-academic '{"command":"npx","args":["-y","polish-academic-mcp"]}'
```

Następnie uruchom OpenClaw ponownie.

---

## LM Studio

**Kreator:** `npx -y polish-academic-mcp setup --client lm-studio`

**Ręcznie:** zakładka Program (prawy panel) → Install → **Edit mcp.json** (plik `~/.lmstudio/mcp.json`), format `mcpServers` jak w Cursorze.

**Modele lokalne:** wybierz model obsługujący wywołania narzędzi (tool use) i włącz tylko potrzebną grupę baz, np. `"env": {"POLISH_ACADEMIC_SOURCES": "nauka"}`. Wszystkie 85 narzędzi (ok. 26 tys. tokenów) nie zmieści się w oknie kontekstu wielu małych modeli.

**Weryfikacja:** w czacie włącz `mcp/polish-academic` na liście integracji i zadaj pytanie testowe. LM Studio pyta o zgodę przed każdym wywołaniem narzędzia.

---

## AnythingLLM Desktop

**Kreator:** `npx -y polish-academic-mcp setup --client anythingllm`

**Ręcznie:** plik `plugins/anythingllm_mcp_servers.json` w katalogu danych AnythingLLM:

- macOS: `~/Library/Application Support/anythingllm-desktop/storage/plugins/`
- Windows: `%APPDATA%\anythingllm-desktop\storage\plugins\`
- Linux: `~/.config/anythingllm-desktop/storage/plugins/`

Format `mcpServers` jak w Cursorze. W wersji Docker plik leży w katalogu `storage` kontenera, a sam kontener musi mieć Node.js.

**Weryfikacja:** Agent Skills → MCP Servers → Refresh. Narzędzia działają w rozmowie z `@agent`.

---

## Jan

Settings → MCP Servers → „+ Add MCP Server”: nazwa `polish-academic`, polecenie `npx`, argumenty `-y` i `polish-academic-mcp`. Wypisanie instrukcji: `npx -y polish-academic-mcp setup --print jan`.

---

## Perplexity (macOS)

Settings → Connectors → zainstaluj pomocnika **PerplexityXPC** (wymagany dla serwerów lokalnych) → Add Connector → zakładka Simple: nazwa `polish-academic`, polecenie `npx -y polish-academic-mcp`. Poczekaj na status „Running”.

---

## Msty, Cherry Studio i inne

Większość aplikacji przyjmuje wpis w formacie `mcpServers` (import JSON) albo formularz „polecenie + argumenty”. Wypisanie gotowego wpisu: `npx -y polish-academic-mcp setup --print generic`. Na Windows użyj wariantu `cmd /c` (Cherry Studio bywa potrzebne `npx.cmd`).

---

## Open WebUI

Open WebUI obsługuje natywnie tylko serwery MCP po HTTP (Streamable HTTP), a ten serwer działa przez stdio. Użyj mostu [mcpo](https://github.com/open-webui/mcpo) (wymaga [uv](https://docs.astral.sh/uv/)):

```bash
uvx mcpo --port 8000 -- npx -y polish-academic-mcp
```

Następnie w Open WebUI: Settings → Tools → „+” → `http://localhost:8000` (z kontenera Docker: `http://host.docker.internal:8000`). Dokumentację wystawionych narzędzi zobaczysz pod `http://localhost:8000/docs`.

---

## ChatGPT i Claude.ai w przeglądarce

ChatGPT (także w trybie deweloperskim) i Claude.ai w przeglądarce łączą się tylko ze **zdalnymi** serwerami MCP przez HTTPS. Ten pakiet jest serwerem lokalnym (stdio), więc nie da się go w nich bezpośrednio podłączyć. Użyj aplikacji desktopowej (Claude Desktop) albo jednego z edytorów lub narzędzi terminalowych powyżej.

---

## Diagnostyka

```bash
npx -y polish-academic-mcp doctor
```

Sprawdza wersję Node.js, obecność `npx`, połączenie z bazami, zmienne środowiskowe oraz to, które wykryte aplikacje mają skonfigurowany serwer (i czy zapisana ścieżka do `npx` nadal istnieje).

Inne kroki:

1. **Ręczne uruchomienie:** `npx -y polish-academic-mcp --version` powinno wypisać numer wersji.
2. **Log zapytań:** dodaj do `env` serwera `"POLISH_ACADEMIC_DEBUG": "1"`. Każde zapytanie HTTP (adres bez wartości parametrów, status, czas) trafi do logu serwera w aplikacji.
3. **Inspektor MCP:** `npx @modelcontextprotocol/inspector npx -y polish-academic-mcp` otwiera w przeglądarce panel do ręcznego wywoływania narzędzi.
4. **Tabela typowych błędów:** [README → Rozwiązywanie problemów](../README.md#rozwiązywanie-problemów).
