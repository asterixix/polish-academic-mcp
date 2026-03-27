# Polish Academic MCP

Zdalny serwer MCP działający na Cloudflare Workers, który udostępnia dziesięć polskich baz danych jako narzędzia wywoływane przez AI.

> **MCP** (Model Context Protocol) to otwarty standard pozwalający modelom językowym (Claude, GPT, Bielik.AI itp.) na wywoływanie zewnętrznych narzędzi i API w ustandaryzowany sposób.

**WAŻNE!** Serwer zdalny (link do cloudflare) zbiera domyślnie anonimowe dane ewaluacyjne z każdego zapytania narzędzia MCP jako dane do dalszych badań i ewaluacji, czyli jak używasz tego narzędzia to tak jakbyś wypełniał dla mnie ankietę do badań <3 Dzięki za zrozumienie! 

Jeśli nie chcesz przekazywać mi danych badawczych wystarczy odpalić serwer lokalnie ;)

---

## Autoreklama: Token JWT i wsparcie dla OAuth

Jeśli interesuje Ciebie większy rate limiting i w tym wsparcie do OAuth co da ci możliwość podpiąć MCP np. pod Perplexity to napisz na [artur@sendyka.dev](mailto:artur@sendyka.dev) z zapytaniem. Jeśli wykorzystanie będzie znaczne (no tak powyżej 100 requestów na dobę) czy komercyjne to niestety będzie to już odpłatne.

---

## Dostępne bazy danych i narzędzia

| Narzędzie            | Baza danych                                                  | Opis                                                            |
| -------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `bn_search_articles` | [Biblioteka Nauki](https://bibliotekanauki.pl)               | Przeszukiwanie polskich artykułów naukowych (OAI-PMH)           |
| `bn_get_article`     | Biblioteka Nauki                                             | Pobranie szczegółów artykułu po ID                              |
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
| `imgw_synop`         | [IMGW-PIB](https://danepubliczne.imgw.pl)                    | Aktualne odczyty ze stacji synoptycznych (pogodowych)           |
| `imgw_hydro`         | IMGW-PIB                                                     | Aktualne odczyty z wodowskazów i stacji hydrologicznych         |
| `imgw_meteo`         | IMGW-PIB                                                     | Aktualne odczyty ze stacji meteorologicznych                    |
| `imgw_warnings`      | IMGW-PIB                                                     | Aktywne ostrzeżenia meteorologiczne i hydrologiczne             |

Wszystkie bazy oferują **otwarty, nieuwierzytelniony dostęp do odczytu** — żadne klucze API nie są wymagane.

---

## Wymagania dla developmnetu

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

| Baza danych                                               | TTL cache  |
| --------------------------------------------------------- | ---------- |
| Biblioteka Nauki, RUJ, AGH, AMU, UAFM, ICM, RODBuK, RePOD | 24 godziny |
| dane.gov.pl, IMGW-PIB                                     | 1 godzina  |

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
               ├── biblioteka-nauki.ts → https://bibliotekanauki.pl/api/oai/
               ├── ruj.ts             → https://ruj.uj.edu.pl/server/api/
               ├── agh.ts             → https://repo.agh.edu.pl/server/api/
               ├── amu.ts             → https://repozytorium.amu.edu.pl/server/api/
               ├── uafm.ts            → https://repozytorium.uafm.edu.pl/server/api/
               ├── icm.ts             → https://open.icm.edu.pl/server/api/
               ├── rodbuk.ts          → https://rodbuk.pl/api/
               ├── repod.ts           → https://repod.icm.edu.pl/api/
               ├── dane.ts            → https://api.dane.gov.pl/1.4/
               └── imgw.ts            → https://danepubliczne.imgw.pl/api/data/
```

Kluczowe decyzje projektowe:

- **Bezstanowy** — nowa instancja `McpServer` na każde żądanie (wymagane od SDK 1.26.0)
- **Kompaktowe podsumowania JSON** dla repozytoriów DSpace 7 (RUJ, AGH, AMU, UAFM, ICM) zamiast surowego HAL+JSON — zmniejsza zużycie tokenów
- **Surowe odpowiedzi XML/JSON** dla API bez warstwy normalizacji (Biblioteka Nauki, dane.gov.pl, IMGW) — oszczędza czas CPU
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
