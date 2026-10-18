# Dostarczanie i konwersja dokumentów: plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (zalecane) albo superpowers:executing-plans. Kroki używają składni checkbox (`- [ ]`).

**Goal:** Dokumenty, których serwer nie czyta (skany, PDF bez warstwy tekstowej, JPG/PNG, DOCX/ODT/ODS/XLS/XLSX, EPUB), trafiają do użytkownika jako plik na dysku. Wynik narzędzia to tekst ze ścieżką, MIME i rozmiarem. Zmiana dotyczy pakietu npm/stdio, a w cloud tylko komunikatu o braku konwersji.

**Architecture:** Jedna funkcja klasyfikująca format w `src/` (magic bytes). Npm: dokumenty nieczytelne trafiają do zapisu w `%LOCALAPPDATA%\polish-academic-mcp\docs` i wynik zawiera ścieżkę. Cloud: ten sam klasyfikator daje komunikat bez zapisu (Worker nie ma dysku). CSV/TSV/XLSX i PDF z warstwą tekstową zostają na istniejących parserach. Brak nowych zależności.

**Tech Stack:** TypeScript strict, Node >= 18 (`fs/promises`, `os`, `path`), zod, `node:test` + tsx (istniejący runner).

**Spec:** `docs/superpowers/specs/2026-10-18-cloud-document-conversion-design.md`

## Global Constraints

- Node >= 18, TypeScript strict, ESM z importami `.js`.
- Zero nowych zależności runtime.
- Nic nie pisze na stdout (`console.log` zakazany w `src/`), logi na stderr.
- Błędy zwracane jako `isError: true`, bez rzucania do MCP.
- Liczba narzędzi i ich ID bez zmian (`tests/mcp-contract.test.ts`).
- Pakiet npm bez zmian zachowania dla formatów, które już czyta (PDF z tekstem, CSV, XLSX, HTML, XML, JSON).
- Cloud: brak zapisu na dysk, brak OCR, brak wywołań Eden OCR.

## Review Focus

1. Dokument bez rozszerzenia lub z mylącym MIME (np. PDF podany jako `application/octet-stream`): klasyfikacja po magic bytes, nie po nazwie.
2. Nazwa pliku z nieprawidłowymi znakami lub próbą wyjścia poza katalog (`../`, ścieżka absolutna): zapis tylko do katalogu docelowego, bezpieczna nazwa.
3. Brak katalogu zapisu lub brak uprawnień: komunikat błędu, bez wyjątku do MCP.
4. Ten sam dokument pobrany dwa razy: nadpisanie bez błędu, ścieżka stabilna.
5. Bardzo duży dokument (np. 200 MB): odrzucenie przez istniejący limit `readBodyCapped`, bez zapisu na dysk.

## Zakres zmian w plikach

- Create: `src/document-kind.ts` (klasyfikacja formatu + decyzja: parsuj / zapisz / komunikat)
- Create: `src/document-store.ts` (zapis pliku do katalogu, bezpieczna nazwa, wynik ze ścieżką)
- Modify: `src/content-fetcher.ts` (w `parseDocumentBuffer` gałąź dla formatów nieczytelnych; ta sama ścieżka dla npm)
- Modify: `src/router.ts` (w `get_record` przekazanie wyniku zapisu do odpowiedzi)
- Modify: `cloud/src/tool-bridge.ts` lub `cloud/src/env.ts` (flaga cloud: bez zapisu, komunikat)
- Test: `tests/document-kind.test.ts`, `tests/document-store.test.ts`
- Modify (jeśli trzeba): `tests/router.test.ts`, `tests/mcp-contract.test.ts`

---

## Tasks

### Task 1: Klasyfikacja formatu (`src/document-kind.ts`)

**Files:**
- Create: `src/document-kind.ts`
- Test: `tests/document-kind.test.ts`

**Interfaces:**
- Consumes: nic (czysta funkcja)
- Produces: `classifyDocument(buf: Buffer, name: string, mime: string): DocumentKind`, gdzie `DocumentKind = "pdf-text" | "pdf-scan" | "image" | "office" | "epub" | "delimited" | "other"`

- [ ] **Step 1: Napisz failing test**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDocument } from "../src/document-kind.js";

test("PDF po magic bytes, nawet bez rozszerzenia", () => {
  const buf = Buffer.from("%PDF-1.4\n%%EOF");
  assert.equal(classifyDocument(buf, "plik", "application/octet-stream"), "pdf-scan");
});

test("PNG po sygnaturze", () => {
  const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(classifyDocument(buf, "x.bin", ""), "image");
});

test("DOCX (ZIP z word/) to office", () => {
  const buf = Buffer.from("PK\x03\x04", "binary");
  assert.equal(classifyDocument(buf, "list.docx", ""), "office");
});

test("CSV zostaje delimited", () => {
  assert.equal(classifyDocument(Buffer.from("a,b\n1,2"), "d.csv", "text/csv"), "delimited");
});
```

- [ ] **Step 2: Uruchom test, zobacz błąd**

Run: `node --test --import tsx tests/document-kind.test.ts`
Expected: FAIL (moduł nie istnieje)

- [ ] **Step 3: Minimalna implementacja**

Uwaga: rozróżnienie `pdf-text` i `pdf-scan` wymaga wywołania `extractTextFromPdfBuffer`. Klasyfikator zwraca `pdf` i decyzję o tekście podejmuje wywołujący. Poprawka testu: `pdf` zamiast `pdf-scan`.

```typescript
export type DocumentKind = "pdf" | "image" | "office" | "epub" | "delimited" | "other";

export function classifyDocument(buf: Buffer, name: string, mime: string): DocumentKind {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image";
  if (buf.subarray(0, 4).equals(Buffer.from("PK\x03\x04", "binary"))) {
    if (/\.(docx|odt|ods|xlsx|xls)$/i.test(name)) return "office";
    if (/\.epub$/i.test(name) || /epub/i.test(mime)) return "epub";
    return "other";
  }
  if (/\.(csv|tsv)$/i.test(name)) return "delimited";
  return "other";
}
```

Zmień w teście oczekiwaną wartość dla PDF na `"pdf"`.

- [ ] **Step 4: Uruchom test, zobacz że przechodzi**

Run: `node --test --import tsx tests/document-kind.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/document-kind.ts tests/document-kind.test.ts
git commit -m "feat: classify document formats by magic bytes"
```

---

### Task 2: Zapis dokumentu do katalogu (`src/document-store.ts`)

**Files:**
- Create: `src/document-store.ts`
- Test: `tests/document-store.test.ts`

**Interfaces:**
- Consumes: nic z Task 1 (przyjmuje bajty i nazwę)
- Produces: `saveDocument(buf: Buffer, name: string, dir?: string): Promise<{ path: string; bytes: number }>`, gdzie domyślny katalog to `join(process.env.LOCALAPPDATA ?? homedir(), "polish-academic-mcp", "docs")`

- [ ] **Step 1: Napisz failing test**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveDocument } from "../src/document-store.js";

test("zapis do katalogu, zwraca ścieżkę i rozmiar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pa-docs-"));
  const r = await saveDocument(Buffer.from("abc"), "list.pdf", dir);
  assert.equal(r.bytes, 3);
  assert.equal((await readFile(r.path)).toString(), "abc");
});

test("nazwa z ../ nie wychodzi poza katalog", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pa-docs-"));
  const r = await saveDocument(Buffer.from("x"), "../../evil.pdf", dir);
  assert.ok(r.path.startsWith(dir));
});
```

- [ ] **Step 2: Uruchom test, zobacz błąd**

Run: `node --test --import tsx tests/document-store.test.ts`
Expected: FAIL (brak modułu)

- [ ] **Step 3: Minimalna implementacja**

```typescript
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export function defaultDocsDir(): string {
  return join(process.env.LOCALAPPDATA ?? homedir(), "polish-academic-mcp", "docs");
}

export async function saveDocument(
  buf: Buffer,
  name: string,
  dir = defaultDocsDir(),
): Promise<{ path: string; bytes: number }> {
  await mkdir(dir, { recursive: true });
  const safe = basename(name).replace(/[^\w.\-]/g, "_") || "document";
  const path = join(dir, safe);
  await writeFile(path, buf);
  return { path, bytes: buf.length };
}
```

- [ ] **Step 4: Uruchom test**

Run: `node --test --import tsx tests/document-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/document-store.ts tests/document-store.test.ts
git commit -m "feat: save unreadable documents to a local docs folder"
```

---

### Task 3: Podpięcie w `parseDocumentBuffer` (npm)

**Files:**
- Modify: `src/content-fetcher.ts` (gałąź `else` w `parseDocumentBuffer`, linia ~1113)
- Test: `tests/router.test.ts` (dodaj test)

**Interfaces:**
- Consumes: `classifyDocument` (Task 1), `saveDocument` (Task 2)
- Produces: `ParsedDocument` z `metadata.savedPath` i `metadata.savedBytes` dla formatów `image`, `office`, `epub`, `other` z sygnaturą binarną (nie tekst), oraz dla `pdf` bez warstwy tekstowej.

Uwaga: `parseDocumentBuffer` jest synchroniczna. Zapis jest asynchroniczny. Rozwiązanie: nie zmieniać sygnatury. Zapis robi `get_record` w `router.ts` (Task 4), a `parseDocumentBuffer` tylko oznacza `metadata.needsFile = true`.

- [ ] **Step 1: Napisz failing test**

W `tests/router.test.ts` dodaj:

```typescript
test("parseDocumentBuffer oznacza PDF bez tekstu jako needsFile", () => {
  const buf = Buffer.from("%PDF-1.4\n%%EOF");
  const parsed = parseDocumentBuffer(buf, "https://x.test/a.pdf", "application/pdf");
  assert.equal(parsed.metadata.needsFile, true);
});
```

- [ ] **Step 2: Uruchom test, zobacz błąd**

Run: `node --test --import tsx tests/router.test.ts`
Expected: FAIL (`needsFile` undefined)

- [ ] **Step 3: Implementacja**

W `src/content-fetcher.ts`, w `parseDocumentBuffer`, po gałęzi PDF dodaj ustawienie `needsFile` gdy `extractedText` jest puste. Dla formatów `image`, `office`, `epub` ustaw `needsFile` na początku bloku `else`:

```typescript
const kind = classifyDocument(buf, url, contentType);
if (kind === "image" || kind === "office" || kind === "epub") {
  metadata.needsFile = true;
  return { text: "", metadata, discoveredFiles };
}
```

Wymagany import: `import { classifyDocument } from "./document-kind.js";`. Dokładny kształt zwracany przez funkcję sprawdź w `ParsedDocument` (plik `content-fetcher.ts`, typ zwracany przez `parseDocumentBuffer`) i dostosuj nazwy pól.

Dla PDF: po `extractTextFromPdfBuffer` jeśli `extractedText.trim() === ""`, ustaw `metadata.needsFile = true`. (OCR zostaje, bo istniejący kod `ocrScannedPdfOrImageBuffer` już tu jest; decyzja o usunięciu OCR z npm jest poza tym planem. Patrz "Otwarte" poniżej.)

- [ ] **Step 4: Uruchom test i pełne testy**

Run: `node --test --import tsx tests/router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/content-fetcher.ts tests/router.test.ts
git commit -m "feat: flag unreadable documents as needsFile in parseDocumentBuffer"
```

---

### Task 4: `get_record` zapisuje plik i zwraca ścieżkę (npm)

**Files:**
- Modify: `src/router.ts` (gałąź bezpośredniego URL w `get_record`, linia ~929, oraz `include_fulltext` ~1079)
- Test: `tests/router.test.ts`

**Interfaces:**
- Consumes: `metadata.needsFile` (Task 3), `saveDocument` (Task 2)
- Produces: w tekście wyniku linia `Plik zapisany: <ścieżka> (<MIME>, <bytes> B). Odczytaj go lokalnym narzędziem GenAI.` gdy `needsFile` jest true.

- [ ] **Step 1: Napisz failing test**

Test wymaga żeby `fetchAndParseUrl` można było podmienić. Sprawdź czy `router.ts` udostępnia wstrzykiwanie fetchera (np. parametr). Jeśli nie: test używa lokalnego serwera HTTP (`node:http`) zwracającego PDF bez tekstu i sprawdza, że w wyniku pojawia się linia `Plik zapisany:` i że plik istnieje.

```typescript
// szkic: serwer http na 127.0.0.1, zwraca Buffer.from("%PDF-1.4\n%%EOF")
// wywołanie get_record z url=http://127.0.0.1:<port>/a.pdf
// oczekiwane: tekst zawiera "Plik zapisany:" i ścieżka istnieje na dysku
```

- [ ] **Step 2: Uruchom test, zobacz błąd**

Run: `node --test --import tsx tests/router.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementacja**

W gałęzi bezpośredniego URL po `fetchAndParseUrl`, jeśli `parsedDoc.metadata.needsFile` i `parsedDoc.bytes` (potrzebne bajty, patrz Otwarte), wywołaj `saveDocument(bytes, fileName)` i dopisz linię do tekstu wyniku.

Otwarte implementacyjnie: `fetchAndParseUrl` nie zwraca bajtów. Dodaj do `ParsedDocument` pole `raw?: Buffer` ustawiane tylko gdy `needsFile` (krótkie, bez kopii dla innych formatów).

- [ ] **Step 4: Uruchom testy**

Run: `node --test --import tsx tests/router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/router.ts src/content-fetcher.ts tests/router.test.ts
git commit -m "feat: get_record saves unreadable documents and returns their path"
```

---

### Task 5: Cloud: komunikat zamiast zapisu

**Files:**
- Modify: `cloud/src/tool-bridge.ts` (przekazanie flagi do serwera) albo `src/router.ts` (opcja `saveDocuments: boolean`, domyślnie true)
- Test: `tests/cloud-platform.test.ts`

**Interfaces:**
- Consumes: `metadata.needsFile` (Task 3)
- Produces: w cloud tekst `Dokument nie jest czytany przez serwer (brak OCR). Pobierz go i odczytaj lokalnie: <url>` zamiast zapisu.

- [ ] **Step 1: Napisz failing test**

```typescript
test("cloud: needsFile daje komunikat bez zapisu na dysk", async () => {
  // wywołanie get_record w trybie cloud z PDF bez tekstu
  // oczekiwane: tekst zawiera "brak OCR", brak "Plik zapisany:"
});
```

- [ ] **Step 2: Uruchom test, zobacz błąd**

Run: `node --test --import tsx tests/cloud-platform.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementacja**

Dodaj opcję `saveDocuments` (domyślnie `true`) przekazywaną z `cloud/` jako `false`. Gałąź z Task 4 działa tylko gdy `saveDocuments` jest `true`, w przeciwnym razie zwraca komunikat z URL.

- [ ] **Step 4: Uruchom testy**

Run: `node --test --import tsx tests/cloud-platform.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cloud/src/tool-bridge.ts src/router.ts tests/cloud-platform.test.ts
git commit -m "feat: cloud returns a link instead of saving unreadable documents"
```

---

### Task 6: Testy kontraktowe i pełny przebieg

**Files:**
- Modify: `tests/mcp-contract.test.ts` (jeśli zmienił się opis `get_record`)

- [ ] **Step 1: Uruchom pełny zestaw**

Run: `npm test`
Expected: wszystkie testy PASS (build + node --test)

- [ ] **Step 2: Typy**

Run: `npx tsc --noEmit`
Expected: brak błędów

- [ ] **Step 3: Commit (jeśli były zmiany)**

```bash
git add tests/mcp-contract.test.ts
git commit -m "test: contract update for get_record file delivery"
```

---

## Otwarte (przed wykonaniem)

1. OCR w npm: `ocrScannedPdfOrImageBuffer` jest w ścieżce PDF bez tekstu. Spec mówi "brak OCR"; plan tego nie usuwa w npm (nie było to w zakresie spec dla npm). Decyzja potrzebna: usunąć OCR z npm (`src/ocr-htr.ts` i `jbc_ocr_htr`?) czy zostawić.
2. Zwracanie bajtów z `fetchAndParseUrl` (`raw` w `ParsedDocument`) może zwiększyć zużycie pamięci przy 25 MB. Akceptowalne przy limicie, do potwierdzenia.
3. Test Task 4 wymaga lokalnego serwera HTTP lub wstrzyknięcia fetchera.
4. Zatwierdzenie specu i wybór metody wykonania (subagent-driven vs executing-plans) przez użytkownika jeszcze nie padło.

## Self-review

- Spec coverage: routing (Task 1), zapis lokalny (Task 2, 4), npm/cloud rozróżnienie (Task 5), brak OCR w cloud (Task 5, OCR w npm do decyzji), EPUB jako komunikat (Task 1, 3).
- Placeholdery: Task 4 i 5 mają szkice testów zamiast pełnego kodu, bo zależą od istniejących wzorców w `tests/router.test.ts`; do uzupełnienia przed wykonaniem.
- Spójność typów: `DocumentKind` i `classifyDocument` używane spójnie w Task 1 i 3; `saveDocument` w Task 2 i 4.
