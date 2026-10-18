import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { saveDocument } from "../src/document-store.js";

test("zapis do katalogu, zwraca ścieżkę i rozmiar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pa-docs-"));
  const r = await saveDocument(Buffer.from("abc"), "list.pdf", dir);
  assert.equal(r.bytes, 3);
  assert.equal(dirname(r.path), dir);
  assert.equal((await readFile(r.path)).toString(), "abc");
});

test("nazwa z ../ nie wychodzi poza katalog", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pa-docs-"));
  const r = await saveDocument(Buffer.from("x"), "../../evil.pdf", dir);
  assert.equal(dirname(resolve(r.path)) + sep, resolve(dir) + sep);
});
