import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDocument } from "../src/document-kind.js";

test("PDF po magic bytes, nawet bez rozszerzenia", () => {
  const buf = Buffer.from("%PDF-1.4\n%%EOF");
  assert.equal(classifyDocument(buf, "plik", "application/octet-stream"), "pdf");
});

test("PNG i JPEG po sygnaturze", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(classifyDocument(png, "x.bin", ""), "image");
  assert.equal(classifyDocument(jpg, "x.bin", ""), "image");
});

test("DOCX/ODT (ZIP) to office", () => {
  const buf = Buffer.from("PK\x03\x04rest", "binary");
  assert.equal(classifyDocument(buf, "list.docx", ""), "office");
  assert.equal(classifyDocument(buf, "list.odt", ""), "office");
});

test("EPUB po nazwie lub MIME", () => {
  const buf = Buffer.from("PK\x03\x04rest", "binary");
  assert.equal(classifyDocument(buf, "book.epub", ""), "epub");
  assert.equal(classifyDocument(buf, "book", "application/epub+zip"), "epub");
});

test("CSV zostaje delimited", () => {
  assert.equal(classifyDocument(Buffer.from("a,b\n1,2"), "d.csv", "text/csv"), "delimited");
});
