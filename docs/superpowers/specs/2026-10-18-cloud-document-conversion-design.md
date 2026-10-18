# Cloud: konwersja dokumentów (design)

Data: 2026-10-18 (wersja 2: OCR usunięty z zakresu)
Zakres: pakiet `cloud/` (Cloudflare Workers). Pakiet npm/stdio (`src/`): PDF nie są czytane przez serwer, zamiast tego dostarczane do lokalnego narzędzia GenAI użytkownika (patrz "Lokalnie").

## Cel

Cloud (Meta-Router) czyta treść dokumentów z rekordów, gdy to możliwe bez OCR: PDF z warstwą tekstową, DOCX, ODT, ODS, XLS/XLSX, CSV/TSV, EPUB. Skany, JPG, PNG i PDF bez warstwy tekstowej nie są czytane przez serwer.

## Ograniczenia (decyzje użytkownika)

- Rezydencja wyłącznie w UE. LLM tylko przez dwa ID:
  - `amazon/anthropic.claude-haiku-5-5@eu`
  - `databricks/databricks-claude-haiku-5-5`
- Brak OCR. Nie używamy Eden OCR (`ocr_async`, upload, delete), nie używamy HTR, nie używamy MinerU (dane w Chinach, odrzucony).
- Eden AI służy wyłącznie jako dostawca LLM.
- Brak nowych zależności runtime.

## Lokalnie (npm/stdio)

Serwer MCP nie czyta PDF. Dostarcza dokument użytkownikowi, a lokalne narzędzie GenAI użytkownika odczytuje go samodzielnie. Dotyczy PDF bez warstwy tekstowej, skanów i formatów bez konwersji.

Forma dostarczenia (wynik badania, 2026-10-18):
- Specyfikacja MCP (2025-06-18 i 2026-07-28) dopuszcza `resource` z `blob` (base64) i `resource_link`.
- Klienci Claude (Claude Desktop, claude.ai, Claude Code) według zgłoszeń w repozytoriach SDK odrzucają cały wynik narzędzia, gdy zawiera blob PDF, albo ignorują `resource_link`. Nie jest to wada specyfikacji, lecz zachowanie klienta.
- Base64 w `text` nie nadaje się: model nie dekoduje go wiarygodnie, a rozmiar rośnie o ok. 33%.

Rekomendacja: serwer zapisuje plik do lokalnego katalogu roboczego (np. `%LOCALAPPDATA%\polish-academic-mcp\docs`), a wynik narzędzia to tekst z absolutną ścieżką, typem MIME i rozmiarem. Lokalne narzędzie GenAI odczytuje plik z dysku. Działa w każdym kliencie, bez base64. Wymaga, żeby serwer i narzędzie GenAI działały na tej samej maszynie (pakiet npm/stdio tak działa).

Opcja odrzucona: zasób `blob` jako główna forma (ryzyko odrzucenia w Claude Desktop/claude.ai).

## Architektura cloud

Konwerter w `cloud/` (nowy moduł, np. `cloud/src/document-convert.ts`) z jedną funkcją:

`convertDocument(env, { bytes, mime, name }) -> { text, truncated, engine }`

Routing po formacie (wykrywanie po magic bytes, nie po rozszerzeniu):

| Format | Silnik | Uwagi |
|---|---|---|
| PDF z warstwą tekstową | istniejący parser (`extractTextFromPdfBuffer`) | dokument nie opuszcza Workera |
| PDF bez tekstu, JPG, PNG | brak konwersji | zwrot komunikatu o braku OCR; plik dostarczany użytkownikowi (patrz "Lokalnie") |
| DOCX, ODT, ODS, XLS, XLSX | brak konwersji (decyzja: `env.AI.toMarkdown` znika) | komunikat; dokument dostarczany użytkownikowi (patrz "Lokalnie") |
| CSV, TSV | istniejący `parseDelimitedText` | bez zmian |
| EPUB | do decyzji | `readZipArchive` + `extractCompactHtml` albo komunikat jak dla DOCX |

Integracja: router (współdzielony) dostaje opcjonalny hook konwersji. `cloud/` podaje go przy tworzeniu serwera. Ścieżka npm nie przekazuje hooka, więc zachowanie jest identyczne.

Model LLM:
- `cloud/src/ai-search.ts`: domyślny model i fallbacki to dwa EU ID (zrobione).
- Blok bezpośredniego Anthropic/OpenRouter w `callLlm` jest wyłączony (`shortcut:` w kodzie). Trasą jest tylko Eden.

## Błędy

- Każdy błąd konwersji zwraca tekst błędu w wyniku, bez rzucania wyjątku do MCP (zgodnie z AGENTS.md, `isError: true`).
- Plik, którego nie da się przeczytać (skan, obraz, PDF bez tekstu), dostaje czytelny komunikat zamiast pustego wyniku.

## Testy

- Jednostkowe: routing po formacie, komunikat dla formatów bez konwersji, formatowanie błędu, obcinanie.
- Kontraktowe: istniejące testy (`tests/cloud-platform.test.ts`, `tests/router.test.ts`, `tests/mcp-contract.test.ts`) muszą przechodzić.

## Otwarte (wymagają decyzji)

1. Forma dostarczenia lokalnie: rekomendacja to zapis do katalogu + ścieżka w wyniku (patrz "Lokalnie"). Do akceptacji użytkownika.
2. EPUB: konwersja (zostaje `readZipArchive` + `extractCompactHtml`) czy komunikat jak dla DOCX?
3. Limity rozmiaru i stron: usunięte (decyzja użytkownika). Brak limitów w specu.

## Poza zakresem

- OCR w każdej formie (Eden `ocr_async`, upload, delete, HTR, Transkribus, kraken).
- MinerU.
- Skany, JPG, PNG, PDF bez warstwy tekstowej (w cloud).
- Dzielenie PDF i kontener Cloudflare.
- Tabele i formuły (`ocr_tables_async`, `financial_parser`).
- Tavily (klucz nieważny, osobny problem).
