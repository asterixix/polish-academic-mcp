# Polish Academic MCP

Zdalny serwer MCP działający na Cloudflare Workers (darmowy plan), który udostępnia pięć polskich akademickich baz danych jako narzędzia wywoływane przez AI.

> **MCP** (Model Context Protocol) to otwarty standard pozwalający modelom językowym (Claude, GPT-4 itp.) na wywoływanie zewnętrznych narzędzi i API w ustandaryzowany sposób.

---

## Dostępne bazy danych i narzędzia

| Narzędzie | Baza danych | Opis |
|---|---|---|
| `bn_search_articles` | [Biblioteka Nauki](https://bibliotekanauki.pl) | Przeszukiwanie polskich artykułów naukowych (OAI-PMH) |
| `bn_get_article` | Biblioteka Nauki | Pobranie szczegółów artykułu po ID |
| `ruj_search` | [RUJ — Repozytorium UJ](https://ruj.uj.edu.pl) | Wyszukiwanie publikacji z Repozytorium Jagiellońskiego |
| `ruj_get_item` | RUJ | Pobranie metadanych pozycji po UUID |
| `rodbuk_search` | [RODBuK](https://rodbuk.pl) | Wyszukiwanie zbiorów danych badawczych uczelni krakowskich |
| `repod_search` | [RePOD](https://repod.icm.edu.pl) | Wyszukiwanie polskich otwartych danych badawczych |
| `repod_get_dataset` | RePOD | Pobranie metadanych zbioru danych po DOI |
| `dane_search` | [dane.gov.pl](https://dane.gov.pl) | Wyszukiwanie danych otwartych z portalu rządowego |
| `dane_get_dataset` | dane.gov.pl | Pobranie szczegółów zbioru danych po ID |

Wszystkie bazy oferują **otwarty, nieuwierzytelniony dostęp do odczytu** — żadne klucze API nie są wymagane.

---

## Wymagania

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

## Automatyczne wdrożenie przez GitHub Actions

Repozytorium zawiera gotowy workflow CI/CD (`.github/workflows/deploy.yml`).

### Konfiguracja sekretów w GitHub

Przejdź do: **GitHub → Settings → Secrets and variables → Actions** i dodaj:

| Sekret | Wartość |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token API z [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens) z uprawnieniami `Workers:Edit` i `Workers KV:Edit` |
| `CLOUDFLARE_ACCOUNT_ID` | ID twojego konta Cloudflare (widoczny w prawym panelu dashboardu) |

Po skonfigurowaniu sekretów każdy push na gałąź `main` automatycznie wdroży serwer.

---

## Podłączenie klientów MCP

### Claude Desktop

Dodaj do pliku konfiguracyjnego Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "polish-academic": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://polish-academic-mcp.<twoje-konto>.workers.dev/mcp"
      ]
    }
  }
}
```

Lokalizacja pliku konfiguracyjnego:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Claude.ai (Connector)

1. Przejdź do **Ustawienia → Connectors → Dodaj własny connector**
2. Wpisz URL serwera: `https://polish-academic-mcp.<twoje-konto>.workers.dev/mcp`
3. Kliknij **Zapisz**

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

| Baza danych | TTL cache |
|---|---|
| Biblioteka Nauki, RUJ, RODBuK, RePOD | 24 godziny |
| dane.gov.pl | 1 godzina |

### Limity darmowego planu Cloudflare

| Zasób | Limit |
|---|---|
| Żądania | 100 000 / dobę |
| Czas CPU | 10 ms / wywołanie |
| Odczyty KV | 100 000 / dobę |
| Zapisy KV | 1 000 / dobę |
| Pamięć Worker | 128 MB |

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
               ├── rodbuk.ts          → https://rodbuk.pl/api/
               ├── repod.ts           → https://repod.icm.edu.pl/api/
               └── dane.ts            → https://api.dane.gov.pl/1.4/
```

Kluczowe decyzje projektowe:
- **Bezstanowy** — nowa instancja `McpServer` na każde żądanie (wymagane od SDK 1.26.0)
- **Brak Durable Objects** — całość działa na darmowym planie
- **Surowe odpowiedzi XML/JSON** zwracane do LLM bez parsowania — oszczędza czas CPU
- **Fire-and-forget zapisy do KV** — nie blokują odpowiedzi

---

## Rozwój i wkład

Przeczytaj [CONTRIBUTING.md](CONTRIBUTING.md) — wskazówki dotyczące zgłaszania błędów,
propozycji nowych baz danych i tworzenia pull requestów.

Dla agentów AI kodujących w tym projekcie: przeczytaj [AGENTS.md](AGENTS.md).

---

## Licencja

[MIT](LICENSE) © 2026 Artur / asterixix
