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

Serwer udostępnia narzędzia m.in. dla:

- Biblioteka Nauki (`bn_*`)
- RCIN (`rcin_*`)
- RUJ / AGH / AMU / UAFM / ICM (`*_search`, `*_get_item`)
- RePOD i RODBuK (`repod_*`, `rodbuk_search`)
- dane.gov.pl (`dane_*`)
- POL-on i PBN (`polon_*`, `pbn_*`)
- BDL GUS (`bdl_*`)
- IMGW (`imgw_*`)
- ISAP, Biblioteka Sejmowa, SAOS (`isap_*`, `bs_sejm_*`, `saos_*`)
- NAC, Ninateka, Gapla, Fototeka, FilmPolski, Fototeka Śląska
- Wolne Lektury, BazTOL, Baza Legalnych Źródeł, Dokumenty Śląska, Repozytorium FN

Pełny i aktualny rejestr narzędzi znajduje się w `src/server.ts`.

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

## Bundle MCPB

Repo zawiera manifest MCPB i wspiera pakowanie do pliku bundle.

```bash
npm run bundle:mcpb
```

Wynik:

- `release/polish-academic-mcp.mcpb`

Pełny flow release (build, testy, bundle, publish):

```bash
npm run release
```

---

## Podłączenie klientów MCP

### Claude Desktop

Preferowana konfiguracja (stabilniejsza niż `npx` w środowiskach GUI):

```json
{
  "mcpServers": {
    "polish-academic-mcp": {
      "command": "node",
      "args": ["D:/polish-academic-mcp/dist/index.js"]
    }
  }
}
```

Lokalizacja pliku:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`

### Cursor i inne klienty MCP

Użyj analogicznego polecenia stdio:

```bash
node D:/polish-academic-mcp/dist/index.js
```

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

Wskazówki contributorskie:

- `CONTRIBUTING.md`
- `AGENTS.md`

---

## Licencja

MIT
