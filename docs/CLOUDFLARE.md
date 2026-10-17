# Cloudflare Workers + Pages oraz publikacja w katalogach (Claude, ChatGPT, Perplexity)

Środowisko w katalogu [`cloud/`](../cloud/) udostępnia:

1. **Zdalny serwer MCP** (`/mcp`) z **OAuth 2.1** (PKCE S256, Dynamic Client Registration, Client ID Metadata Documents, RFC 8414, RFC 9728) — gotowy do publikacji w oficjalnych katalogach **Claude Connectors Directory**, **ChatGPT Directory** i **Perplexity Connectors Marketplace** (limit **100** wywołań narzędzi / miesiąc na konto).
2. **AI Search Mode** w przeglądarce — czat badawczy z modelem `anthropic/claude-haiku-5.5` (Eden AI / Cloudflare AI Gateway / Workers AI fallback), z limitem **2** wyszukiwań / tydzień bez logowania i **5** / tydzień po zalogowaniu.
3. **Logowanie**: ORCID OAuth, e-mail+hasło (PBKDF2-SHA256) oraz passkey (WebAuthn), w tym wbudowane konto recenzenckie (demo account) na potrzeby weryfikacji przez zespoły Anthropic i OpenAI.

Lokalny pakiet npm (`npx -y polish-academic-mcp`) pozostaje niezależny — chmura współdzieli kod narzędzi z `src/tools/*` oraz `src/router.ts`.

---

## Jedno ujednolicone środowisko MCP (Meta-Router)

Zdalny serwer `/mcp` oraz AI Search udostępniają **jedno ujednolicone środowisko MCP** składające się z 3 skonsolidowanych narzędzi (`list_sources`, `search`, `get_record`) obsługujących wszystkie **55 polskich baz** (126 operacji natywnych) z automatyczną ekstrakcją treści (PDF z warstwą tekstową oraz OCR/HTR dla skanów, XLSX, CSV, XML, HTML) oraz referencjami do dokumentacji docelowych API (`https://pamcp.pl/connectors`, `https://pamcp.pl/openapi.json`).

Wszystkie narzędzia posiadają:
- czytelny tytuł (`title` oraz `annotations.title`),
- jawne adnotacje bezpieczeństwa wymagane przez Claude, ChatGPT, Perplexity i katalogi MCP:
  - `readOnlyHint: true`
  - `destructiveHint: false`
  - `idempotentHint: true`
  - `openWorldHint: true`

---

## Szybkie wdrożenie (Cloudflare)

```bash
cd cloud
npm install

# Utwórz zasoby (raz) i wklej ID do wrangler.jsonc:
npx wrangler d1 create polish-academic-mcp
npx wrangler kv namespace create CACHE_KV
npx wrangler kv namespace create CACHE_KV --preview

# Migracje D1
npm run db:migrate:local
npm run db:migrate:remote

# Sekrety
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ORCID_CLIENT_ID
npx wrangler secret put ORCID_CLIENT_SECRET
npx wrangler secret put EDENAI_API_KEY      # lub ANTHROPIC_API_KEY / OPENROUTER_API_KEY
# opcjonalnie:
npx wrangler secret put REVIEWER_DEMO_EMAIL
npx wrangler secret put REVIEWER_DEMO_PASSWORD
npx wrangler secret put BDL_CLIENT_ID
npx wrangler secret put PBN_APP_ID
npx wrangler secret put PBN_APP_TOKEN

# Build UI + wdrożenie Workera
npm run deploy
```

W `cloud/wrangler.jsonc` zmienna `PUBLIC_BASE_URL` jest domyślnie ustawiona na kanoniczny adres produkcyjny `https://pamcp.pl` (kod źródłowy: `https://github.com/asterixix/polish-academic-mcp`).

---

## Endpointy

| Ścieżka | Opis |
| ------- | ---- |
| `/` | AI Search Mode (UI) |
| `/login` | Logowanie ORCID / e-mail+hasło / passkey |
| `/account` | Przydziały zapytań (AI Search + MCP) |
| `/connectors` | Dokumentacja konektora, instrukcje i przykładowe prompty (Documentation URL) |
| `/privacy` | Polityka prywatności zgodna z wymogami Anthropic, OpenAI i RODO (Privacy Policy URL) |
| `/terms` | Regulamin usługi zgodny z polityką braku upselli w czacie (Terms of Service URL) |
| `/mcp` | Streamable HTTP MCP (`POST`, `GET`, `DELETE`) — wymaga Bearer OAuth 2.1 |
| `/sse`, `/messages` | Legacy SSE MCP |
| `/oauth/authorize`, `/oauth/token`, `/oauth/register` | OAuth 2.1 + PKCE S256 + DCR |
| `/.well-known/oauth-authorization-server` | Metadane serwera autoryzacji (RFC 8414 + CIMD) |
| `/.well-known/oauth-protected-resource` | Metadane chronionego zasobu MCP (RFC 9728) |
| `/openapi.json`, `/.well-known/ai-plugin.json` | Specyfikacja OpenAPI 3.1 i manifest wtyczki |
| `/api/search`, `/api/fetch` | Aliasy Deep Research (zwracają zminimalizowane odpowiedzi bez metadanych diagnostycznych) |
| `/api/directory-metadata` | Pełny pakiet metadanych zgłoszeniowych JSON dla katalogów Claude/ChatGPT/Perplexity |
| `/api/quota`, `/api/health`, `/api/tools` | Status i katalog narzędzi |

---

## Gotowe materiały do publikacji w katalogach

### Wspólne dane identyfikacyjne i linki

- **Nazwa (Server / Plugin Name):** `Polish Academic` *(zgodnie z wytycznymi OpenAI bez słów „MCP”, „MCP Server” ani „Plugin” w nazwie)*
- **Slug URL:** `polish-academic`
- **Krótki opis (One-liner, ≤200 znaków):**
  > Przeszukuj 51 polskich baz naukowych, prawnych (ISAP, SAOS), statystycznych (GUS BDL), normalizacyjnych i archiwalnych w trybie tylko do odczytu.
- **Pełny opis (Description, ≤2000 znaków):**
  > Polish Academic zapewnia ujednolicony dostęp w trybie tylko do odczytu (read-only) do 51 polskich baz naukowych, rejestrów publicznych, systemów aktów prawnych, orzeczeń sądowych, norm technicznych oraz cyfrowych archiwów kultury i genealogii.
  >
  > Najważniejsze obsługiwane źródła:
  > • Nauka i repozytoria: Biblioteka Nauki, RCIN, Repozytorium UJ (RUJ), AGH, UAM, ICM UW, RODBuK, RePOD, RAD-on / POL-on, Ludzie Nauki, PBN, BazTOL, katalog Aleph ŚUM.
  > • Dane publiczne i statystyka: Bank Danych Lokalnych GUS (BDL), dane.gov.pl, IMGW-PIB (dane synoptyczne, hydrologiczne, ostrzeżenia).
  > • Prawo: ISAP / ELI Sejm API (Dziennik Ustaw, Monitor Polski, pełne teksty PDF), SAOS (orzeczenia sądów powszechnych, SN i TK), Biblioteka Sejmowa.
  > • Normy: Polski Komitet Normalizacyjny (PKN) oraz wyszukiwarka norm WIEDZA.
  > • Kultura, historia i archiwa: Wolne Lektury, FilmPolski.pl, Ninateka, Fototeka FINA, Gapla, Fototeka Śląska, Repozytorium FN, Narodowe Archiwum Cyfrowe (NAC), PAUart, JBC, SBC, FBC PIONIER, Polska Biblioteka Muzyczna, Szukaj w Archiwach, Genealogia w Archiwach, AGAD, IPN Straty.pl oraz regionalne Archiwa Państwowe (Warszawa, Lublin, Poznań e-kartoteka, Płock, Zamość, Opole, Piotrków).
  >
  > Serwer udostępnia 3 skonsolidowane narzędzia Meta-Routera (`list_sources`, `search`, `get_record`) z automatyczną ekstrakcją tekstu z plików PDF, arkuszy XLSX/CSV oraz dokumentów XML/HTML, a także pełny tryb 113 narzędzi szczegółowych (`?mode=granular`).
- **Kategorie (1–5):** `Research`, `Education`, `Legal`, `Data & Analytics`, `Productivity`
- **Remote MCP Server URL:** `https://pamcp.pl/mcp` *(lub `https://pamcp.pl/mcp?mode=granular` dla 113 narzędzi)*
- **Documentation URL:** `https://pamcp.pl/connectors`
- **Privacy Policy URL:** `https://pamcp.pl/privacy`
- **Terms of Service URL:** `https://pamcp.pl/terms`
- **Icon URL:** `https://pamcp.pl/logo.jpg`
- **Source Code / GitHub Repository:** `https://github.com/asterixix/polish-academic-mcp`
- **Support Contact / Primary Contact:** `Artur Sendyka` — `artur@sendyka.dev`
- **Company / Publisher Website:** `https://pamcp.pl` (strona autora: `https://sendyka.dev`, kod: `https://github.com/asterixix/polish-academic-mcp`)

### Konto testowe dla recenzentów (Test Account Credentials — Claude Step 8 & ChatGPT Testing)

Serwer obsługuje automatyczne aprowizowanie konta demo przy pierwszym logowaniu na `/login` (lub podczas przepływu OAuth 2.1 `/oauth/authorize` bez 2FA i bez konieczności zakładania nowego konta):

- **Login URL (podczas OAuth):** `https://pamcp.pl/login`
- **Demo Email / Password:** wartości sekretów `REVIEWER_DEMO_EMAIL` i `REVIEWER_DEMO_PASSWORD` (ustawiane tylko w Cloudflare Secrets / lokalnym `.dev.vars` — **nigdy w git**). Do formularzy katalogów Claude/ChatGPT/Perplexity przekaż dane prywatnie (e-mail do zespołu katalogu), nie commituj hasła.
- **Instrukcja dla recenzenta (Test & Launch instructions):**
  1. Connect to `https://pamcp.pl/mcp` via OAuth 2.0 / 2.1 (Dynamic Client Registration and PKCE S256 are automatic).
  2. On the login screen, enter the demo email and password provided privately by the maintainer, then click **Zaloguj** (Log in) and **Autoryzuj** (Authorize). No 2FA or extra sign-up is required.
  3. Test tool calls using `list_sources` (e.g. `{"category":"prawo"}`), `search` (e.g. `{"query":"odnawialne źródła energii","category":"nauka"}`), and `get_record` (e.g. `{"id":"isap:DU/2023/123"}`).

---

## 1. Instrukcja zgłoszenia do Claude Connectors Directory (`claude.ai/directory/manage`)

Otwórz [claude.ai/directory/manage](https://claude.ai/directory/manage) → **Submit new** → **MCP connector**:

1. **Step 1 — Connection:**
   - Wklej pojedynczy adres HTTPS: `https://pamcp.pl/mcp` (wszyscy użytkownicy łączą się z tym samym adresem URL).
2. **Step 2 — Tools:**
   - Narzędzia zsynchronizują się automatycznie jako **Read-only** (`list_sources`, `search`, `get_record` — każde ma przypisane `title`, `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`).
3. **Step 3 — Listing:**
   - **Server name:** `Polish Academic`
   - **URL slug:** `polish-academic`
   - **One-liner & Description:** wklej z sekcji powyżej.
   - **Categories:** `Research`, `Education`, `Legal`, `Data & Analytics`
   - **Documentation URL:** `https://pamcp.pl/connectors`
   - **Privacy Policy URL:** `https://pamcp.pl/privacy`
   - **Support contact:** `artur@sendyka.dev`
   - **Icon:** prześlij `cloud/public/logo.jpg` (`https://pamcp.pl/logo.jpg`)
4. **Step 4 — Use cases:**
   - **Primary use cases:** wyszukiwanie literatury naukowej i danych badawczych, analiza polskich ustaw (ISAP) i orzeczeń sądowych (SAOS), pobieranie statystyk publicznych GUS BDL i danych hydro-meteo IMGW, kwerendy archiwalne i genealogiczne.
   - **What users need before connecting:** bezpłatne konto w usłudze `https://pamcp.pl` (logowanie przez ORCID iD, e-mail z hasłem lub passkey).
   - **Data direction:** **Reads data only** (tylko odczyt).
5. **Step 5 — Company:**
   - **Name:** `Artur Sendyka`
   - **Website:** `https://pamcp.pl` (`https://sendyka.dev` / `https://github.com/asterixix/polish-academic-mcp`)
   - **Primary contact:** `artur@sendyka.dev`
6. **Step 6 — Authentication:**
   - Wybierz **OAuth 2.0 with Dynamic Client Registration** (serwer wspiera też Client ID Metadata Documents oraz PKCE S256 pod `https://pamcp.pl/.well-known/oauth-authorization-server` i `https://pamcp.pl/.well-known/oauth-protected-resource`).
7. **Step 7 — Data handling:**
   - Zaznacz, że konektor odpytuje oficjalne, publiczne otwarte API instytucji naukowych, rządowych i archiwalnych (Open Data / OAI-PMH / REST).
   - **Personal health data (PHI):** `No`
   - **Sponsored content / Ads:** `No`
8. **Step 8 — Test & launch:**
   - Wklej dane konta demo z sekretów `REVIEWER_DEMO_*` (przekazane prywatnie, nie z repozytorium) oraz instrukcję z sekcji powyżej.
   - Potwierdź przetestowanie każdego narzędzia w Claude / MCP Inspectorze.
9. **Step 9 & 10 — Compliance & Submit:**
   - Zatwierdź 7 oświadczeń zgodności i wyślij zgłoszenie.

---

## 2. Instrukcja zgłoszenia do ChatGPT Directory (OpenAI Platform)

1. **Developer Verification:** w OpenAI Platform Dashboard (General Settings) zweryfikuj tożsamość / domenę `pamcp.pl` (lub `sendyka.dev`) oraz ustaw kontakt wsparcia `artur@sendyka.dev`.
2. **Nazewnictwo i opis:**
   - Użyj nazwy **`Polish Academic`** (bez przyrostków „MCP”, „MCP Server” ani „Plugin”).
   - Podaj adres serwera MCP: `https://pamcp.pl/mcp`, manifest: `https://pamcp.pl/.well-known/ai-plugin.json`, OpenAPI: `https://pamcp.pl/openapi.json` oraz politykę prywatności: `https://pamcp.pl/privacy`.
   - Opis nie zawiera wzmianek o cenach, subskrypcjach ani porównań z konkurencją.
3. **Example Prompts (wymagane zamiast zrzutów ekranu):**
   - *„Wyszukaj w Bibliotece Nauki i repozytorium RUJ publikacje o zastosowaniu sztucznej inteligencji w diagnostyce medycznej.”*
   - *„Znajdź w bazie ISAP obowiązujące ustawy o odnawialnych źródłach energii oraz powiązane wyroki w SAOS.”*
   - *„Pobierz z Banku Danych Lokalnych GUS (BDL) dane o przeciętnym wynagrodzeniu i bezrobociu w województwach.”*
   - *„Przeszukaj Szukaj w Archiwach, AGAD i Straty.pl pod kątem materiałów archiwalnych dotyczących Warszawy z lat 1939–1945.”*
   - *„Wyszukaj w Wolnych Lekturach utwory Bolesława Prusa i pobierz pełny tekst wybranego opowiadania.”*
4. **Adnotacje i minimalizacja danych:**
   - Każde narzędzie zwraca jawne wartości logiczne `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`.
   - Odpowiedzi narzędzi i endpointów `/api/search` oraz `/api/fetch` nie zawierają identyfikatorów sesji, trace ID ani telemetrii.
   - Komunikaty o wyczerpaniu przydziału informują wyłącznie o dacie odnowienia i kierują do informacyjnej strony `https://pamcp.pl/account` (brak linków do checkoutu/zakupu).
5. **Konto testowe:** podaj e-mail/hasło z `REVIEWER_DEMO_*` (tylko poza gitem / w prywatnej korespondencji z recenzentem).

---

## 3. Instrukcja zgłoszenia do Perplexity (`connectors@perplexity.ai` / Connector Proposal Form)

Wypełnij formularz propozycji konektora (Single-connector plugin) lub wyślij wiadomość na `connectors@perplexity.ai`:

- **Company name & website:** Artur Sendyka — `https://pamcp.pl` (`https://sendyka.dev`, repozytorium: `https://github.com/asterixix/polish-academic-mcp`)
- **Product / service to connect:** Polish Academic (`https://pamcp.pl` — 51 Polish scientific, legal, statistical, and cultural databases)
- **Brief description of the proposed connector:**
  > Remote OAuth 2.1 MCP connector (`https://pamcp.pl/mcp`) providing read-only access to 51 Polish academic repositories (Biblioteka Nauki, RCIN, Jagiellonian University RUJ, AGH, UAM, ICM UW, RODBuK, RePOD, RAD-on/POL-on, Ludzie Nauki), legal databases (Sejm ELI/ISAP acts, SAOS court judgments), official statistics and meteorology (Statistics Poland GUS BDL, dane.gov.pl, IMGW-PIB), national standards (PKN), and digital cultural/historical archives (Wolne Lektury, FilmPolski, Ninateka, Szukaj w Archiwach, AGAD, IPN Straty.pl).
- **Customer problem / use case supported:**
  > Researchers, lawyers, journalists, analysts, and students using Perplexity need authoritative, primary-source data from Polish scientific repositories, legislation (Dziennik Ustaw), court rulings, GUS statistical tables, and state archives—many of which are deep-web databases or OAI-PMH/REST APIs not indexed by standard web search, or require server-side PDF/XLSX/XML extraction.
- **Links to API, developer, integration & security documentation:**
  - MCP Endpoint (Streamable HTTP): `https://pamcp.pl/mcp`
  - OAuth 2.1 Authorization Server Metadata (RFC 8414): `https://pamcp.pl/.well-known/oauth-authorization-server`
  - OAuth 2.1 Protected Resource Metadata (RFC 9728): `https://pamcp.pl/.well-known/oauth-protected-resource`
  - Connector & Security Documentation: `https://pamcp.pl/connectors`
  - Directory Metadata JSON: `https://pamcp.pl/api/directory-metadata`
  - Privacy Policy: `https://pamcp.pl/privacy`
  - Source Repository: `https://github.com/asterixix/polish-academic-mcp`
- **Contact for partnership and technical discussions:** Artur Sendyka (`artur@sendyka.dev`)

---

## Testy

```bash
# Z katalogu głównego repozytorium:
npm test

# Tylko testy platformy chmurowej i zgodności z katalogami:
npm run test:cloud
```
