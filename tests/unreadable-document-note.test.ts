import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParsedDocument } from "../src/content-fetcher.js";
import { unreadableDocumentNote } from "../src/router.js";

function doc(over: Partial<ParsedDocument>): ParsedDocument {
  return {
    url: "https://example.org/files/skan.pdf",
    contentType: "application/pdf",
    byteLength: 3,
    detectedFormat: "pdf",
    text: "",
    discoveredFiles: [],
    metadata: { needsFile: true },
    raw: Buffer.from("%PDF"),
    ...over,
  } as ParsedDocument;
}

test("cloud (saveDocuments=false) zwraca komunikat z URL, bez zapisu", async () => {
  const note = await unreadableDocumentNote(doc({}), false);
  assert.equal(
    note,
    "Dokument nie jest czytany przez serwer (brak OCR). Pobierz go i odczytaj lokalnie: https://example.org/files/skan.pdf",
  );
});

test("npm (saveDocuments=true) zapisuje plik i podaje ścieżkę", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pa-note-"));
  process.env.LOCALAPPDATA = dir;
  try {
    const note = await unreadableDocumentNote(doc({}), true);
    assert.match(note ?? "", /^Plik zapisany: .*skan\.pdf \(application\/pdf, 4 B\)/);
    const path = /Plik zapisany: (.*?) \(/.exec(note ?? "")?.[1] ?? "";
    assert.equal((await readFile(path)).toString(), "%PDF");
  } finally {
    delete process.env.LOCALAPPDATA;
  }
});

test("dokument czytelny nie dostaje notatki", async () => {
  const note = await unreadableDocumentNote(
    doc({ metadata: { needsFile: false } as ParsedDocument["metadata"], raw: undefined }),
    true,
  );
  assert.equal(note, undefined);
});
