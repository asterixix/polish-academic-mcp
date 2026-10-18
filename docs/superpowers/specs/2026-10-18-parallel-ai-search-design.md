# Parallel w AI Search (cloud) — specyfikacja

Data: 2026-10-18
Status: do przeglądu przez właściciela

## Cel

Rozszerzyć tryb AI Search w `cloud/` o wyszukiwanie w internecie przez API Parallel, tak aby model (Haiku przez Eden AI) mógł uzupełniać odpowiedzi o treści spoza 55 polskich baz obsługiwanych przez Polish Academic MCP.

## Zakres

W zakresie:
- Dwa nowe narzędzia dla modelu w AI Search: `web_search` (Parallel Search API) i `web_fetch` (Parallel Extract API).
- Wywołania REST bezpośrednio z Workera (bez klienta MCP).
- Jeden sekret `PARALLEL_API_KEY`.

Poza zakresem:
- Task API (deep research), FindAll, Entity Search, Monitor.
- Zmiany w publicznym `/mcp` (Parallel nie jest tam dodawany).
- Osobny limit kosztowy lub licznik w D1 dla Parallel.

## Decyzje (zatwierdzone)

| Temat | Decyzja |
|---|---|
| Miejsce | Tylko AI Search w przeglądarce |
| Produkty | Search + Extract |
| Sposób wywołania | REST `/v1/search`, `/v1/extract` (nie klient MCP) |
| Klucz | Jeden sekret serwera `PARALLEL_API_KEY`, płaci właściciel |
| Tryb Search | `fast` (domyślnie, najtańszy) |
| Limity użytkowników | Każde wywołanie Parallel wlicza się do puli AI Search (2/tydz. anon, 5/tydz. zalogowany); bez osobnego limitu |
| Limit wywołań | Do 5 wywołań Parallel (`web_search` + `web_fetch` łącznie) na jedno pytanie użytkownika |
| `web_fetch` | Dostępny modelowi zawsze, także dla URL podanego przez użytkownika |

## Architektura

### 1. `cloud/src/parallel.ts` (nowy moduł)

Dwie funkcje, obie zwracają tekst gotowy dla modelu:

- `parallelSearch(env, objective, searchQueries): Promise<ToolCallResult>`
  - `POST https://api.parallel.ai/v1/search`, nagłówek `x-api-key: <PARALLEL_API_KEY>`
  - Body (zweryfikowane w OpenAPI `V1SearchRequest`): `objective`, `search_queries` (1–3 zapytania, po stronie modelu), `mode: "fast"`, `max_chars_total` (limit excerpts, ustawiany po stronie serwera), `advanced_settings.max_results` (ustawiany po stronie serwera, nie przez model; 10 domyślnie zgodnie z cennikiem).
- `parallelExtract(env, urls, objective?): Promise<ToolCallResult>`
  - `POST https://api.parallel.ai/v1/extract`, nagłówek `x-api-key`
  - Body (zweryfikowane w `V1ExtractRequest`): `urls` (max 20; model dostaje limit np. 3), `objective` opcjonalnie, `max_chars_total` (serwer). `full_content` i `excerpt_settings` wyłącznie w `advanced_settings` (wymóg `/v1`, inaczej 422). Domyślnie `full_content` jest wyłączony, więc nie ustawiamy go.
  - Wynik zawiera `errors[]` (np. `fetch_error`); błędy poszczególnych URL-i są zwracane modelowi jako tekst, nie jako wyjątek.

Wspólne zasady:
- Timeout: 20 s dla search, 30 s dla extract (`AbortSignal.timeout`).
- Brak klucza: funkcja nie jest wywoływana, a narzędzia nie są oferowane modelowi.
- Błąd HTTP, timeout lub nieprawidłowy JSON: zwrot `{ isError: true, content: [text] }` z treścią błędu, bez rzucania wyjątku. Model widzi błąd i może odpowiedzieć bez sieci.
- Przy sukcesie zwraca surowy tekst odpowiedzi (wyniki: tytuł, URL, excerpts), zgodnie z zasadą „nie parsuj dużych JSON-ów w handlerach”. Dopuszczalne jest przycięcie do limitu znaków (np. 20 000).
- Żadnego `console.log` na stdout; błędy logowane przez istniejący mechanizm audytu w `ai-search.ts`.

### 2. `cloud/src/ai-search.ts` (zmiany)

- Definicje narzędzi `web_search` i `web_fetch` (JSON Schema) dodawane do listy `tools` przekazywanej do `callLlm` w fazie plan i w fazie wyszukiwania, tylko gdy `env.PARALLEL_API_KEY` jest ustawiony.
- Nowa stała `PARALLEL_MAX_CALLS = 5`, osobny licznik niezależny od `AI_SEARCH_MAX_TOOL_CALLS` (który dotyczy wywołań baz polskich).
- W pętli wywołań narzędzi (`runToolBatch`): jeśli `tc.name` to `web_search` lub `web_fetch`, wywołanie idzie do `parallel.ts`, a nie do `callMcpTool`. Każde takie wywołanie zwiększa licznik; po wyczerpaniu licznika model dostaje komunikat „limit wyczerpany”, bez wykonania.
- Rekordy audytu (`ToolCallRecord`) i zdarzenia SSE (`tool_result`) działają tak samo jak dla baz polskich, z tym że `name` to `web_search`/`web_fetch`.
- Ścieżka retry „second chance” (`resultsLookEmpty`) nie wywołuje Parallel.

### 3. `cloud/src/env.ts`

- Dodać `PARALLEL_API_KEY?: string` do interfejsu `CloudEnv`.
- Sekret ustawiany przez `wrangler secret put PARALLEL_API_KEY` (bez wpisu w `wrangler.jsonc`).

### 4. Prompt systemowy

- Dopisać do `routerSystem` jedno zdanie: narzędzia `web_search` i `web_fetch` służą do aktualnych informacji spoza polskich baz; użyj ich, gdy baz brakuje lub pytanie dotyczy bieżących wydarzeń; nie więcej niż 5 wywołań.
- Zmiana tylko gdy klucz jest ustawiony, żeby nie zmieniać zachowania bez Parallel.

## Testy

Jeden plik `cloud/tests/parallel.test.ts` (lub odpowiednik zgodny z konfiguracją testów w `cloud/`):
- Mapowanie sukcesu: mock `fetch` zwraca JSON, wynik zawiera tytuły i URL.
- Błąd 4xx/5xx zwraca `isError: true` bez wyjątku.
- Timeout zwraca `isError: true`.
- Budowa body: `max_results` pochodzi z serwera, a pola `full_content`/`excerpt_settings` są w `advanced_settings`.
- Limit 5 wywołań: szósta próba nie wykonuje fetcha.

Brak testów sieciowych w CI.

## Ryzyka

1. **Koszt zależny od liczby wywołań modelu.** Maksymalnie 5 wywołań na pytanie. Przy `fast` ($1/1000 zapytań) koszt maksymalny to około $0,005 na pytanie za samo Search. `web_fetch` kosztuje $1/1000 URL.
2. **Rozmiar kontekstu Haiku.** Excerpts zwiększają zużycie tokenów. Ograniczenie długości jest obowiązkowe.
3. **Nazwy pól API.** Pola `advanced_settings.max_results` i `excerpt_settings` zostały potwierdzone w dokumentacji MCP i Extract, ale dokładne schematy trzeba sprawdzić w `https://docs.parallel.ai/public-openapi.json` przed implementacją. Nagłówek auth (`Authorization: Bearer` vs `x-api-key`) też do weryfikacji w OpenAPI.
4. **Zależność od zewnętrznego serwera.** Awaria Parallel nie może przerwać całej odpowiedzi AI Search.

## Rozstrzygnięte w przeglądzie

- Limit Parallel jest **osobny** od limitu 5 wywołań baz polskich (`PARALLEL_MAX_CALLS = 5`, niezależny od `AI_SEARCH_MAX_TOOL_CALLS`).
- Po wyczerpaniu limitu Parallel model dostaje komunikat tekstowy (wynik narzędzia z `isError: true`); UI bez zmian.

## Kroki po zatwierdzeniu specyfikacji

1. Weryfikacja schematów w OpenAPI Parallel.
2. Plan implementacji (skill `writing-plans`).
3. Implementacja i testy; `npm test` w `cloud/`.
