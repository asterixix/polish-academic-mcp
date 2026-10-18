/**
 * Multi-format full-text & structured data extractor (`src/content-fetcher.ts`).
 *
 * Allows LLMs (Claude, OpenAI, Perplexity, Cursor) to download, parse, search inside,
 * and paginate ANY document or dataset referenced by Polish academic, legal, statistical,
 * archival, and digital library records:
 *  - PDF (`%PDF-...` via `node:zlib` FlateDecode + ToUnicode CMap + TJ/Tj/ET text operators)
 *  - XLSX / ZIP (`PK\x03\x04` via central directory + `inflateRawSync`, `xl/sharedStrings.xml` + `xl/worksheets/sheet*.xml`)
 *  - CSV / TSV (automatic delimiter `;`, `,`, `\t` detection, column & row filtering)
 *  - XML / OAI-PMH / EAD / TEI / MARC-XML (with charset detection & entity decoding)
 *  - HTML (clean text + preserved bitstream/download URLs + tables)
 *  - JSON / JSON-LD / IIIF Presentation Manifests
 *
 * Also discovers direct downloadable bitstreams (PDF, CSV, XLSX, XML, IIIF, DjVu)
 * embedded in repository records (DSpace 7, Dataverse, Biblioteka Nauki, ISAP ELI,
 * dLibra, RCIN, Szukaj w Archiwach, Wolne Lektury, etc.).
 */

import { inflateRawSync, inflateSync, unzipSync } from "node:zlib";
import { classifyDocument } from "./document-kind.js";
import {
  decodeHtmlEntities,
  extractCompactHtml,
  extractCompactXml,
  formatAndSliceOutput,
  looksLikeHtml,
  looksLikeXml,
} from "./extract.js";

const DEFAULT_TIMEOUT_MS = 30_000;
/** Above this size only the beginning of a PDF is read (scanned scores are often 50–80 MB). */
const MAX_INLINE_PDF_BYTES = 25_000_000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type DetectedFormat =
  | "pdf"
  | "xlsx"
  | "zip"
  | "csv"
  | "tsv"
  | "json"
  | "xml"
  | "html"
  | "text";

export interface DiscoveredFile {
  type: string;
  label: string;
  url: string;
}

export interface ParsedDocument {
  url: string;
  detectedFormat: DetectedFormat;
  contentType: string;
  byteLength: number;
  text: string;
  metadata: Record<string, unknown>;
  discoveredFiles: DiscoveredFile[];
  raw?: Buffer;
}

// ─── 1. Charset Detection & Buffer Decoding ──────────────────────────────────

export function decodeBufferWithCharset(buf: Buffer, contentTypeHeader = ""): string {
  const headerCharset = contentTypeHeader.match(/charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i)?.[1];
  const asciiHead = buf.subarray(0, Math.min(buf.length, 2048)).toString("latin1");
  const metaCharset =
    asciiHead.match(/charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i)?.[1] ??
    asciiHead.match(/encoding\s*=\s*["']([a-zA-Z0-9_-]+)["']/i)?.[1];

  const charset = (headerCharset ?? metaCharset ?? "utf-8").toLowerCase();
  try {
    if (charset.includes("8859-2") || charset === "latin2" || charset === "iso88592") {
      return new TextDecoder("iso-8859-2").decode(buf);
    }
    if (charset.includes("1250") || charset === "cp1250") {
      return new TextDecoder("windows-1250").decode(buf);
    }
    if (charset.includes("8859-1") || charset === "latin1") {
      return new TextDecoder("iso-8859-1").decode(buf);
    }
  } catch {
    // Fallback to utf-8 below
  }
  return buf.toString("utf8");
}

// ─── 2. Format Detection ─────────────────────────────────────────────────────

export function detectBufferFormat(
  buf: Buffer,
  url: string,
  contentTypeHeader = "",
): DetectedFormat {
  const ct = contentTypeHeader.toLowerCase();
  const cleanUrl = url.split("?")[0].toLowerCase();

  // Magic bytes check
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "pdf";
  }
  if (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  ) {
    if (
      cleanUrl.endsWith(".xlsx") ||
      ct.includes("spreadsheetml") ||
      ct.includes("excel") ||
      buf.includes(Buffer.from("xl/worksheets/"))
    ) {
      return "xlsx";
    }
    return "zip";
  }

  if (ct.includes("application/pdf") || cleanUrl.endsWith(".pdf")) return "pdf";
  if (ct.includes("text/tab-separated-values") || cleanUrl.endsWith(".tsv") || cleanUrl.endsWith(".tab")) {
    return "tsv";
  }
  if (ct.includes("text/csv") || ct.includes("application/csv") || cleanUrl.endsWith(".csv")) {
    return "csv";
  }

  const textSample = decodeBufferWithCharset(
    buf.subarray(0, Math.min(buf.length, 4096)),
    contentTypeHeader,
  ).trimStart();

  if (
    ct.includes("json") ||
    cleanUrl.endsWith(".json") ||
    textSample.startsWith("{") ||
    textSample.startsWith("[")
  ) {
    return "json";
  }
  if (
    ct.includes("xml") ||
    cleanUrl.endsWith(".xml") ||
    looksLikeXml(textSample)
  ) {
    return "xml";
  }
  if (
    ct.includes("html") ||
    cleanUrl.endsWith(".html") ||
    cleanUrl.endsWith(".htm") ||
    looksLikeHtml(textSample)
  ) {
    return "html";
  }

  // Heuristic CSV/TSV check for plain text files with consistent delimiters
  const firstLines = textSample.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 5);
  if (firstLines.length >= 2) {
    const tabCounts = firstLines.map((l) => (l.match(/\t/g) ?? []).length);
    if (tabCounts[0] >= 2 && tabCounts.every((c) => c === tabCounts[0])) return "tsv";
    const semiCounts = firstLines.map((l) => (l.match(/;/g) ?? []).length);
    if (semiCounts[0] >= 2 && semiCounts.every((c) => c === semiCounts[0])) return "csv";
  }

  return "text";
}

// ─── 3. Zero-Dependency PDF Text Extractor (`node:zlib`) ─────────────────────

/**
 * Extracts text from PDF buffers using built-in `node:zlib` to decompress
 * `/FlateDecode` streams, parses `/ToUnicode` CMaps (`beginbfchar` / `beginbfrange`),
 * and decodes PDF text operators (`Tj`, `TJ`, `'`, `"`, `Td`, `TD`, `T*`).
 */
export function extractTextFromPdfBuffer(buf: Buffer): {
  text: string;
  pageCountEstimate: number;
  streamCount: number;
} {
  const rawLatin1 = buf.toString("latin1");
  const pageMatches = rawLatin1.match(/\/Type\s*\/Page\b(?!s)/g);
  const pageCountEstimate = pageMatches ? pageMatches.length : 1;

  // Decompress all streams
  const decompressedStreams: string[] = [];
  let searchPos = 0;
  while (searchPos < buf.length) {
    const streamIdx = rawLatin1.indexOf("stream", searchPos);
    if (streamIdx === -1) break;

    // Ensure "stream" is not "endstream"
    if (streamIdx >= 3 && rawLatin1.slice(streamIdx - 3, streamIdx) === "end") {
      searchPos = streamIdx + 6;
      continue;
    }

    let dataStart = streamIdx + 6;
    if (buf[dataStart] === 0x0d && buf[dataStart + 1] === 0x0a) dataStart += 2;
    else if (buf[dataStart] === 0x0a || buf[dataStart] === 0x0d) dataStart += 1;
    else {
      searchPos = streamIdx + 6;
      continue;
    }

    const endStreamIdx = rawLatin1.indexOf("endstream", dataStart);
    if (endStreamIdx === -1) break;

    let dataEnd = endStreamIdx;
    while (dataEnd > dataStart && (buf[dataEnd - 1] === 0x0a || buf[dataEnd - 1] === 0x0d)) {
      dataEnd -= 1;
    }

    const dictHeader = rawLatin1.slice(Math.max(0, streamIdx - 350), streamIdx);
    const slice = buf.subarray(dataStart, dataEnd);

    if (/\/FlateDecode\b/.test(dictHeader)) {
      let inflated: Buffer | null = null;
      try {
        inflated = unzipSync(slice);
      } catch {
        try {
          inflated = inflateSync(slice);
        } catch {
          try {
            inflated = inflateRawSync(slice);
          } catch {
            inflated = null;
          }
        }
      }
      if (inflated) {
        decompressedStreams.push(inflated.toString("latin1"));
      }
    } else if (!/\/(DCTDecode|JPXDecode|JBIG2Decode|CCITTFaxDecode)\b/.test(dictHeader)) {
      decompressedStreams.push(slice.toString("latin1"));
    }

    searchPos = endStreamIdx + 9;
  }

  // Pass 1: Build global ToUnicode CMap table from any CMap streams
  const toUnicode = new Map<number, string>();
  for (const s of decompressedStreams) {
    if (!s.includes("beginbfchar") && !s.includes("beginbfrange")) continue;
    parseToUnicodeCMap(s, toUnicode);
  }

  // Pass 2: Extract text blocks (`BT ... ET`) from content streams
  const pagesOrChunks: string[] = [];
  for (const s of decompressedStreams) {
    if (!s.includes("BT") || !s.includes("ET")) continue;
    if (s.includes("beginbfchar") || s.includes("beginbfrange")) continue;
    const chunkText = extractPdfContentStreamText(s, toUnicode);
    if (chunkText.trim().length > 0) {
      pagesOrChunks.push(chunkText.trim());
    }
  }

  const combined = pagesOrChunks
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text:
      combined.length > 0
        ? combined
        : "[Dokument PDF nie zawiera warstwy tekstowej lub wymaga zewnętrznego OCR (skan rastrowy).]",
    pageCountEstimate,
    streamCount: decompressedStreams.length,
  };
}

function parseToUnicodeCMap(stream: string, map: Map<number, string>): void {
  const bfcharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
  let match: RegExpExecArray | null;
  while ((match = bfcharRegex.exec(stream)) !== null) {
    const pairRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let pair: RegExpExecArray | null;
    while ((pair = pairRegex.exec(match[1])) !== null) {
      const srcCode = Number.parseInt(pair[1], 16);
      const targetStr = hexToUtf16String(pair[2]);
      if (Number.isFinite(srcCode) && targetStr) {
        map.set(srcCode, targetStr);
      }
    }
  }

  const bfrangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((match = bfrangeRegex.exec(stream)) !== null) {
    const rangeRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]+)\])/g;
    let rng: RegExpExecArray | null;
    while ((rng = rangeRegex.exec(match[1])) !== null) {
      const startCode = Number.parseInt(rng[1], 16);
      const endCode = Number.parseInt(rng[2], 16);
      if (!Number.isFinite(startCode) || !Number.isFinite(endCode) || endCode < startCode) continue;
      if (endCode - startCode > 2048) continue;

      if (rng[3]) {
        const baseTarget = Number.parseInt(rng[3], 16);
        for (let code = startCode; code <= endCode; code++) {
          const cp = baseTarget + (code - startCode);
          if (cp > 0 && cp <= 0x10ffff) {
            map.set(code, String.fromCodePoint(cp));
          }
        }
      } else if (rng[4]) {
        const hexTargets = Array.from(rng[4].matchAll(/<([0-9A-Fa-f]+)>/g), (m) => m[1]);
        for (let i = 0; i < hexTargets.length && startCode + i <= endCode; i++) {
          map.set(startCode + i, hexToUtf16String(hexTargets[i]));
        }
      }
    }
  }
}

function hexToUtf16String(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length === 0) return "";
  if (clean.length === 2) {
    return String.fromCharCode(Number.parseInt(clean, 16));
  }
  let out = "";
  for (let i = 0; i < clean.length; i += 4) {
    const code = Number.parseInt(clean.slice(i, i + 4), 16);
    if (Number.isFinite(code) && code > 0) {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

function decodePdfLiteralString(literal: string, toUnicode: Map<number, string>): string {
  let bytes: number[] = [];
  for (let i = 0; i < literal.length; i++) {
    const ch = literal[i];
    if (ch === "\\") {
      const next = literal[i + 1];
      if (!next) break;
      if (/[0-7]/.test(next)) {
        const oct = literal.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? next;
        bytes.push(Number.parseInt(oct, 8));
        i += oct.length;
      } else {
        switch (next) {
          case "n":
            bytes.push(10);
            break;
          case "r":
            bytes.push(13);
            break;
          case "t":
            bytes.push(9);
            break;
          case "b":
            bytes.push(8);
            break;
          case "f":
            bytes.push(12);
            break;
          default:
            bytes.push(next.charCodeAt(0));
            break;
        }
        i += 1;
      }
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }

  // UTF-16BE BOM check
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return out;
  }

  if (toUnicode.size > 0) {
    let mapped = "";
    for (const b of bytes) {
      mapped += toUnicode.get(b) ?? String.fromCharCode(b);
    }
    return mapped;
  }

  return Buffer.from(bytes).toString("latin1");
}

function decodePdfHexString(hex: string, toUnicode: Map<number, string>): string {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length === 0) return "";
  if (toUnicode.size > 0) {
    // Check 2-byte codes first if hex length is a multiple of 4 and CMap has >255 keys
    const hasTwoByteKeys = Array.from(toUnicode.keys()).some((k) => k > 255);
    if (hasTwoByteKeys && clean.length % 4 === 0) {
      let out = "";
      for (let i = 0; i < clean.length; i += 4) {
        const code = Number.parseInt(clean.slice(i, i + 4), 16);
        out += toUnicode.get(code) ?? (code > 31 && code < 127 ? String.fromCharCode(code) : "");
      }
      return out;
    }
    let out = "";
    for (let i = 0; i < clean.length; i += 2) {
      const code = Number.parseInt(clean.slice(i, i + 2), 16);
      out += toUnicode.get(code) ?? String.fromCharCode(code);
    }
    return out;
  }
  return hexToUtf16String(clean);
}

function extractPdfContentStreamText(stream: string, toUnicode: Map<number, string>): string {
  const btEtRegex = /\bBT\b([\s\S]*?)\bET\b/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = btEtRegex.exec(stream)) !== null) {
    const body = match[1];
    let blockOut = "";
    // Match TJ arrays, Tj literals/hex, or line-break operators (Td, TD, T*, ', ")
    const tokenRegex =
      /\[([\s\S]*?)\]\s*TJ|\((?:\\.|[^\\()])*\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]+)>\s*Tj|(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+T[dD]\b|\bT\*/g;
    let tok: RegExpExecArray | null;
    while ((tok = tokenRegex.exec(body)) !== null) {
      if (tok[1] !== undefined) {
        // TJ array: `[(text) -250 (more) <0041>] TJ`
        const arrBody = tok[1];
        const itemRegex = /\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)/g;
        let item: RegExpExecArray | null;
        while ((item = itemRegex.exec(arrBody)) !== null) {
          if (item[1] !== undefined) {
            blockOut += decodePdfLiteralString(item[1], toUnicode);
          } else if (item[2] !== undefined) {
            blockOut += decodePdfHexString(item[2], toUnicode);
          } else if (item[3] !== undefined) {
            const kern = Number.parseFloat(item[3]);
            if (kern < -120 && !blockOut.endsWith(" ")) {
              blockOut += " ";
            }
          }
        }
      } else if (tok[0].startsWith("(")) {
        const inner = tok[0].replace(/\)\s*(?:Tj|'|")$/, "").slice(1);
        blockOut += decodePdfLiteralString(inner, toUnicode);
        if (tok[0].endsWith("'") || tok[0].endsWith('"')) blockOut += "\n";
      } else if (tok[2] !== undefined) {
        blockOut += decodePdfHexString(tok[2], toUnicode);
      } else if (tok[4] !== undefined) {
        const dy = Number.parseFloat(tok[4]);
        if (Math.abs(dy) > 0.5) blockOut += "\n";
        else if (!blockOut.endsWith(" ")) blockOut += " ";
      } else if (tok[0] === "T*") {
        blockOut += "\n";
      }
    }
    if (blockOut.trim().length > 0) {
      blocks.push(blockOut.trim());
    }
  }
  return blocks.join("\n");
}

// ─── 4. Zero-Dependency ZIP & XLSX Parser (`node:zlib`) ──────────────────────

export interface ZipEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  data: Buffer;
}

/**
 * Reads ZIP archive entries using the Central Directory at the end of the buffer
 * (supports data descriptors with bit 3 set, used by Excel/XLSX files).
 */
export function readZipArchive(buf: Buffer, maxEntries = 30): ZipEntry[] {
  const entries: ZipEntry[] = [];
  // Find End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  const minOffset = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x05 &&
      buf[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) return entries;

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  let ptr = cdOffset;

  for (let idx = 0; idx < totalEntries && entries.length < maxEntries; idx++) {
    if (ptr + 46 > buf.length) break;
    const sig = buf.readUInt32LE(ptr);
    if (sig !== 0x02014b50) break;

    const compressionMethod = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);

    const fileName = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    ptr += 46 + nameLen + extraLen + commentLen;

    if (fileName.endsWith("/")) continue;
    if (localHeaderOffset + 30 > buf.length) continue;

    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > buf.length) continue;

    const rawSlice = buf.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    try {
      if (compressionMethod === 0) {
        data = rawSlice;
      } else if (compressionMethod === 8) {
        data = inflateRawSync(rawSlice);
      } else {
        continue;
      }
      entries.push({
        fileName,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        data,
      });
    } catch {
      // Skip corrupted or unsupported entry
    }
  }

  return entries;
}

/**
 * Parses an `.xlsx` spreadsheet buffer into a clean Markdown/TSV-like table
 * with optional keyword search (`grep`) and row limits.
 */
export function parseXlsxBuffer(
  buf: Buffer,
  options: { grep?: string; maxRows?: number } = {},
): { text: string; totalRows: number; matchedRows: number; sheets: string[] } {
  const entries = readZipArchive(buf, 50);
  const sharedStringsEntry = entries.find((e) => e.fileName === "xl/sharedStrings.xml");
  const sharedStrings: string[] = [];

  if (sharedStringsEntry) {
    const sstXml = sharedStringsEntry.data.toString("utf8");
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let siMatch: RegExpExecArray | null;
    while ((siMatch = siRegex.exec(sstXml)) !== null) {
      const tMatches = Array.from(siMatch[1].matchAll(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g), (m) =>
        decodeHtmlEntities(m[1]),
      );
      sharedStrings.push(tMatches.join(""));
    }
  }

  const sheetEntries = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.fileName))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));

  const maxRows = options.maxRows ?? 200;
  const grepLower = options.grep?.trim().toLowerCase();
  const outLines: string[] = [];
  let totalRows = 0;
  let matchedRows = 0;

  for (const sheet of sheetEntries) {
    const xml = sheet.data.toString("utf8");
    const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch: RegExpExecArray | null;
    let headerLine: string | null = null;

    while ((rowMatch = rowRegex.exec(xml)) !== null) {
      totalRows += 1;
      const rowXml = rowMatch[1];
      const cells: string[] = [];
      const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
        const attrs = cellMatch[1];
        const inner = cellMatch[2];
        const cellType = attrs.match(/\bt="([^"]+)"/)?.[1];
        const vText = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        if (cellType === "s") {
          const idx = Number.parseInt(vText, 10);
          cells.push(sharedStrings[idx] ?? vText);
        } else if (cellType === "inlineStr") {
          const tText = inner.match(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/)?.[1] ?? "";
          cells.push(decodeHtmlEntities(tText));
        } else {
          cells.push(decodeHtmlEntities(vText));
        }
      }

      if (cells.every((c) => c.trim() === "")) continue;
      const line = cells.map((c) => c.replace(/\s+/g, " ").trim()).join(" | ");
      if (headerLine === null) {
        headerLine = line;
        outLines.push(`=== Arkusz: ${sheet.fileName} ===`, `NAGŁÓWEK: ${headerLine}`, "---");
        continue;
      }

      if (grepLower && !line.toLowerCase().includes(grepLower)) {
        continue;
      }
      matchedRows += 1;
      if (matchedRows <= maxRows) {
        outLines.push(line);
      }
    }
  }

  if (matchedRows > maxRows) {
    outLines.push(`... [Pokazano ${maxRows} z ${matchedRows} pasujących wierszy (łącznie w arkuszu: ${totalRows})]`);
  }

  return {
    text: outLines.join("\n"),
    totalRows,
    matchedRows,
    sheets: sheetEntries.map((s) => s.fileName),
  };
}

// ─── 5. CSV / TSV Structured Parser & Filter ─────────────────────────────────

export function parseDelimitedText(
  rawText: string,
  options: { grep?: string; maxRows?: number; forcedDelimiter?: string } = {},
): { text: string; totalRows: number; matchedRows: number; delimiter: string; columns: string[] } {
  const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { text: "", totalRows: 0, matchedRows: 0, delimiter: ",", columns: [] };
  }

  const sampleLine = lines[0];
  let delimiter = options.forcedDelimiter ?? ",";
  if (!options.forcedDelimiter) {
    const counts = [
      { d: "\t", n: (sampleLine.match(/\t/g) ?? []).length },
      { d: ";", n: (sampleLine.match(/;/g) ?? []).length },
      { d: ",", n: (sampleLine.match(/,/g) ?? []).length },
      { d: "|", n: (sampleLine.match(/\|/g) ?? []).length },
    ].sort((a, b) => b.n - a.n);
    if (counts[0].n > 0) delimiter = counts[0].d;
  }

  const splitRow = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const columns = splitRow(lines[0]);
  const grepLower = options.grep?.trim().toLowerCase();
  const maxRows = options.maxRows ?? 200;
  const formattedRows: string[] = [
    `KOLUMNY (${columns.length}): ${columns.join(" | ")}`,
    "---",
  ];

  let matchedRows = 0;
  const totalDataRows = Math.max(0, lines.length - 1);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (grepLower && !line.toLowerCase().includes(grepLower)) continue;
    matchedRows += 1;
    if (matchedRows <= maxRows) {
      formattedRows.push(splitRow(line).join(" | "));
    }
  }

  if (matchedRows > maxRows) {
    formattedRows.push(
      `... [Pokazano ${maxRows} z ${matchedRows} pasujących wierszy (łącznie wierszy danych: ${totalDataRows})]`,
    );
  }

  return {
    text: formattedRows.join("\n"),
    totalRows: totalDataRows,
    matchedRows,
    delimiter: delimiter === "\t" ? "TAB" : delimiter,
    columns,
  };
}

/**
 * dLibra's `?handler=pdf` applet is an HTML viewer. The file itself is
 * `https://{host}/Content/{editionId}/`, which redirects to the real PDF.
 */
export function rewriteRepositoryContentUrl(url: string): string {
  const applet = url.match(/^(https?:\/\/[^/]+)\/dlibra\/applet\/publication\/\d+\/edition\/(\d+)/i);
  if (applet) return `${applet[1]}/Content/${applet[2]}/`;
  return url;
}

async function readBodyCapped(
  res: Response,
  cap: number,
): Promise<{ buf: Buffer; truncated: boolean; totalHint: number | null }> {
  const totalHint = Number(res.headers.get("content-length") ?? "");
  const announced = Number.isFinite(totalHint) && totalHint > 0 ? totalHint : null;
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf: buf.subarray(0, cap), truncated: buf.length > cap, totalHint: announced ?? buf.length };
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  while (total < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    if (total + chunk.length > cap) {
      chunks.push(chunk.subarray(0, cap - total));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(chunk);
    total += chunk.length;
  }
  if (announced !== null && announced > cap) truncated = true;
  return { buf: Buffer.concat(chunks), truncated, totalHint: announced };
}

// ─── 6. Automatic Bitstream & Full-Text Link Discovery ───────────────────────

/**
 * Inspects any raw record response (JSON, XML, or HTML) and extracts direct
 * downloadable URLs for PDFs, CSVs, XLSX spreadsheets, XML files, IIIF manifests,
 * DSpace bitstreams, Dataverse file downloads, and ISAP ELI PDF/HTML texts.
 */
export function discoverBitstreamsInText(rawText: string, sourceHint?: string): DiscoveredFile[] {
  const found: DiscoveredFile[] = [];
  const seen = new Set<string>();

  const addFile = (type: string, label: string, url: string) => {
    const clean = url.trim().replace(/&amp;/g, "&");
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    found.push({ type, label, url: clean });
  };

  // 1) ISAP ELI record: synthesize direct PDF & HTML full-text links if ELI is present
  if (sourceHint === "isap" || rawText.includes('"ELI"') || rawText.includes('"eli"')) {
    const eliMatch = rawText.match(/"(?:ELI|eli)"\s*:\s*"((?:DU|MP)\/\d{4}\/\d+)"/);
    if (eliMatch) {
      const eli = eliMatch[1];
      addFile("pdf", `Tekst ogłoszony aktu (${eli} PDF)`, `https://api.sejm.gov.pl/eli/acts/${eli}/text.pdf`);
      addFile("html", `Tekst ogłoszony aktu (${eli} HTML)`, `https://api.sejm.gov.pl/eli/acts/${eli}/text.html`);
      addFile("pdf", `Tekst ujednolicony aktu (${eli} PDF)`, `https://api.sejm.gov.pl/eli/acts/${eli}/text/U/i.pdf`);
    }
  }

  // ELI API list/detail objects often have publisher+year+pos and textPDF, without an "ELI" key.
  const isapActRegex =
    /"pos"\s*:\s*(\d+)[\s\S]{0,500}?"publisher"\s*:\s*"(DU|MP)"[\s\S]{0,1200}?"textPDF"\s*:\s*true[\s\S]{0,1200}?"year"\s*:\s*(\d{4})/g;
  let isapAct: RegExpExecArray | null;
  while ((isapAct = isapActRegex.exec(rawText)) !== null) {
    const eli = `${isapAct[2]}/${isapAct[3]}/${isapAct[1]}`;
    addFile(
      "pdf",
      `Tekst ogłoszony aktu (${eli} PDF)`,
      `https://api.sejm.gov.pl/eli/acts/${eli}/text.pdf`,
    );
    if (found.length >= 25) break;
  }

  // 2) DSpace 7 (RUJ, AGH, AMU, UAFM): synthesize `/bundles` link when item UUID is present
  const dspaceSelfMatch = rawText.match(
    /"self"\s*:\s*\{\s*"href"\s*:\s*"(https?:\/\/[^"]+\/server\/api\/core\/items\/([0-9a-f-]{36}))"/i,
  );
  if (dspaceSelfMatch) {
    addFile("json", "Lista plików (bundles) obiektu DSpace", `${dspaceSelfMatch[1]}/bundles`);
  }

  // 3) Dataverse (RODBuK, RePOD, ICM): extract datafile IDs or persistentIds
  const dvFileRegex = /"datafile"\s*:\s*\{[\s\S]*?"id"\s*:\s*(\d+)[\s\S]*?"filename"\s*:\s*"([^"]+)"/g;
  let dvMatch: RegExpExecArray | null;
  while ((dvMatch = dvFileRegex.exec(rawText)) !== null) {
    const fileId = dvMatch[1];
    const fileName = dvMatch[2];
    const host =
      sourceHint === "rodbuk"
        ? "https://cracow.rodbuk.pl"
        : sourceHint === "icm"
          ? "https://dane.icm.edu.pl"
          : "https://repod.icm.edu.pl";
    addFile(
      fileName.split(".").pop()?.toLowerCase() ?? "file",
      `Plik danych badawczych: ${fileName}`,
      `${host}/api/access/datafile/${fileId}`,
    );
  }

  // 4) Generic URLs in JSON/XML/HTML pointing to downloadable formats
  const urlRegex = /https?:\/\/[^\s"'<>\\)\]]+/gi;
  let uMatch: RegExpExecArray | null;
  while ((uMatch = urlRegex.exec(rawText)) !== null) {
    const url = uMatch[0].replace(/[.,;]+$/, "");
    const lower = url.toLowerCase();
    // Skip XML schema definitions and namespaces (W3C, OAI-PMH XSD, JATS DTD)
    if (
      lower.endsWith(".xsd") ||
      lower.endsWith(".dtd") ||
      lower.includes("/xsd/") ||
      lower.includes("openarchives.org/oai/") ||
      /www\.(w3|openarchives)\.org/i.test(lower) ||
      lower.includes("jats.nlm.nih.gov")
    ) {
      continue;
    }
    if (lower.endsWith(".pdf") || (lower.includes("/bitstreams/") && lower.endsWith("/content"))) {
      addFile("pdf", "Dokument PDF / Bitstream", url);
    } else if (/handler=pdf|\/applet\/publication\//i.test(lower)) {
      addFile("pdf", "Treść publikacji biblioteki cyfrowej (PDF)", rewriteRepositoryContentUrl(url));
    } else if (lower.endsWith(".csv") || lower.includes("format=csv")) {
      addFile("csv", "Dane tabelaryczne CSV", url);
    } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      addFile("xlsx", "Arkusz kalkulacyjny Excel (XLSX/XLS)", url);
    } else if (lower.endsWith(".tsv") || lower.endsWith(".tab")) {
      addFile("tsv", "Dane tabelaryczne TSV/TAB", url);
    } else if (lower.endsWith(".xml") || lower.includes(";a=1.xml")) {
      addFile("xml", "Dane strukturalne XML", url);
    } else if (lower.endsWith(".epub") || lower.endsWith(".txt")) {
      addFile(lower.endsWith(".epub") ? "epub" : "txt", "Pełny tekst utworu", url);
    } else if (lower.includes("manifest.json") || lower.includes("/iiif/")) {
      addFile("iiif", "Manifest IIIF / skan cyfrowy", url);
    } else if (lower.includes("photos.szukajwarchiwach.gov.pl")) {
      addFile("image", "Skan archiwalny wysokiej rozdzielczości", url);
    }
    if (found.length >= 25) break;
  }

  // 5) Biblioteka Nauki: otwarty PDF ma stały adres /articles/{publicationId}.pdf
  const bnDocRegex =
    /"publicationId"\s*:\s*"(\d+)"[\s\S]{0,1200}?"fullTextFormats"\s*:\s*\[([^\]]*)\]/g;
  let bnMatch: RegExpExecArray | null;
  while ((bnMatch = bnDocRegex.exec(rawText)) !== null) {
    if (!/"PDF"/i.test(bnMatch[2])) continue;
    addFile(
      "pdf",
      `Pełny tekst publikacji Biblioteki Nauki ${bnMatch[1]}`,
      `https://bibliotekanauki.pl/articles/${bnMatch[1]}.pdf`,
    );
    if (found.length >= 25) break;
  }

  return found;
}

// ─── 7. Full-Text Search (`grep`) Inside Extracted Content ───────────────────

export function grepExtractedText(
  text: string,
  pattern: string,
  contextLines = 2,
  maxMatches = 40,
): { matchedText: string; matchCount: number } {
  const lines = text.split(/\r?\n/);
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    regex = new RegExp(escaped, "i");
  }

  const snippets: string[] = [];
  let matchCount = 0;
  let lastIncludedLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 400) {
      const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
      const re = new RegExp(regex.source, flags);
      let local = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(lines[i])) !== null) {
        matchCount += 1;
        local += 1;
        if (snippets.length < maxMatches) {
          const start = Math.max(0, match.index - 180);
          const end = Math.min(lines[i].length, match.index + match[0].length + 180);
          const slice = lines[i].slice(start, end).replace(/\s+/g, " ");
          snippets.push(`>> [L${i + 1}] ${start > 0 ? "…" : ""}${slice}${end < lines[i].length ? "…" : ""}`);
        }
        if (match[0].length === 0) re.lastIndex += 1;
        if (local >= 8) break;
      }
      continue;
    }
    if (regex.test(lines[i])) {
      matchCount += 1;
      if (snippets.length < maxMatches) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length - 1, i + contextLines);
        const block: string[] = [];
        if (start > lastIncludedLine + 1 && lastIncludedLine !== -1) {
          block.push("---");
        }
        for (let j = Math.max(start, lastIncludedLine + 1); j <= end; j++) {
          const prefix = j === i ? `>> [L${j + 1}] ` : `   [L${j + 1}] `;
          block.push(`${prefix}${lines[j]}`);
        }
        lastIncludedLine = Math.max(lastIncludedLine, end);
        snippets.push(block.join("\n"));
      }
    }
  }

  if (matchCount === 0) {
    return {
      matchedText: `Brak wystąpień wzorca "${pattern}" w dokumencie (przeszukano ${lines.length} linii, ${text.length} znaków).`,
      matchCount: 0,
    };
  }

  return {
    matchedText: [
      `Znaleziono ${matchCount} wystąpień wzorca "${pattern}" (w ${lines.length} liniach tekstu):`,
      "",
      ...snippets,
    ].join("\n"),
    matchCount,
  };
}

// ─── 8. Universal URL / Bitstream Fetcher & Parser ───────────────────────────

export interface FetchAndParseOptions {
  grep?: string;
  offset?: number;
  maxChars?: number;
  maxRows?: number;
  format?: "concise" | "detailed" | "raw";
  headers?: Record<string, string>;
}

/**
 * Fetches any remote URL (PDF, XLSX, ZIP, CSV, TSV, XML, HTML, JSON) and parses
 * it into clean text or structured rows for LLM analysis.
 */
export async function fetchAndParseUrl(
  url: string,
  options: FetchAndParseOptions = {},
): Promise<ParsedDocument> {
  const resolvedUrl = rewriteRepositoryContentUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(resolvedUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept:
          "application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values,application/xml,text/xml,application/json,text/html,*/*;q=0.8",
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} podczas pobierania ${resolvedUrl}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    const { buf, truncated, totalHint } = await readBodyCapped(res, MAX_INLINE_PDF_BYTES);
    const parsed = parseDocumentBuffer(buf, res.url || resolvedUrl, contentType, options);
    if (truncated) {
      const sizeLabel = totalHint ? `${totalHint} bajtów` : `więcej niż ${MAX_INLINE_PDF_BYTES} bajtów`;
      parsed.text = [
        `Plik ma ${sizeLabel}. Odczytano początek (${buf.length} bajtów), żeby nie pobierać całego skanu do kontekstu modelu.`,
        `Bezpośredni adres: ${res.url || resolvedUrl}`,
        parsed.text,
      ].join("\n");
      parsed.byteLength = totalHint ?? parsed.byteLength;
      parsed.metadata.truncated = true;
      parsed.metadata.announcedBytes = totalHint;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

export function parseDocumentBuffer(
  buf: Buffer,
  url: string,
  contentType = "",
  options: FetchAndParseOptions = {},
): ParsedDocument {
  const detectedFormat = detectBufferFormat(buf, url, contentType);
  const metadata: Record<string, unknown> = {
    url,
    detectedFormat,
    contentType: contentType || "application/octet-stream",
    byteLength: buf.length,
  };

  let extractedText = "";
  let discoveredFiles: DiscoveredFile[] = [];

  const kind = classifyDocument(buf, url, contentType);
  if (kind === "image" || kind === "office" || kind === "epub") {
    metadata.needsFile = true;
  } else if (detectedFormat === "pdf") {
    const pdf = extractTextFromPdfBuffer(buf);
    metadata.pageCountEstimate = pdf.pageCountEstimate;
    metadata.streamCount = pdf.streamCount;
    extractedText = pdf.text;
    if (extractedText.startsWith("[Dokument PDF nie zawiera")) metadata.needsFile = true;
  } else if (detectedFormat === "xlsx") {
    const xlsx = parseXlsxBuffer(buf, {
      grep: options.grep,
      maxRows: options.maxRows ?? 250,
    });
    metadata.totalRows = xlsx.totalRows;
    metadata.matchedRows = xlsx.matchedRows;
    metadata.sheets = xlsx.sheets;
    extractedText = xlsx.text;
  } else if (detectedFormat === "zip") {
    const entries = readZipArchive(buf, 25);
    metadata.zipEntries = entries.map((e) => ({
      fileName: e.fileName,
      uncompressedSize: e.uncompressedSize,
    }));
    const parts: string[] = [
      `Archiwum ZIP (${entries.length} plików):`,
      ...entries.map((e) => `- ${e.fileName} (${e.uncompressedSize} B)`),
      "",
    ];
    for (const entry of entries.slice(0, 5)) {
      if (/\.(txt|csv|tsv|xml|json|html|md)$/i.test(entry.fileName)) {
        const subText = decodeBufferWithCharset(entry.data);
        parts.push(`=== Plik: ${entry.fileName} ===\n${subText.slice(0, 6000)}`);
      }
    }
    extractedText = parts.join("\n");
  } else if (detectedFormat === "csv" || detectedFormat === "tsv") {
    const rawText = decodeBufferWithCharset(buf, contentType);
    const parsed = parseDelimitedText(rawText, {
      grep: options.grep,
      maxRows: options.maxRows ?? 250,
      forcedDelimiter: detectedFormat === "tsv" ? "\t" : undefined,
    });
    metadata.totalRows = parsed.totalRows;
    metadata.matchedRows = parsed.matchedRows;
    metadata.delimiter = parsed.delimiter;
    metadata.columns = parsed.columns;
    extractedText = parsed.text;
  } else if (!metadata.needsFile) {
    const rawText = decodeBufferWithCharset(buf, contentType);
    discoveredFiles = discoverBitstreamsInText(rawText);
    if (options.format === "raw") {
      extractedText = rawText;
    } else if (detectedFormat === "html") {
      extractedText = extractCompactHtml(rawText);
    } else if (detectedFormat === "xml") {
      extractedText = extractCompactXml(rawText);
    } else {
      extractedText = rawText;
    }
  }

  // Apply grep for non-tabular formats (XLSX and CSV/TSV already filter rows by grep)
  if (
    options.grep &&
    options.grep.trim().length > 0 &&
    detectedFormat !== "xlsx" &&
    detectedFormat !== "csv" &&
    detectedFormat !== "tsv"
  ) {
    const grepped = grepExtractedText(extractedText, options.grep.trim());
    metadata.grepPattern = options.grep.trim();
    metadata.grepMatches = grepped.matchCount;
    extractedText = grepped.matchedText;
  }

  const slicedText = formatAndSliceOutput(extractedText, {
    format: "raw",
    offset: options.offset ?? 0,
    maxChars: options.maxChars ?? 20_000,
  });

  return {
    url,
    detectedFormat,
    contentType,
    byteLength: buf.length,
    text: slicedText,
    metadata,
    discoveredFiles,
    raw: metadata.needsFile ? buf : undefined,
  };
}
