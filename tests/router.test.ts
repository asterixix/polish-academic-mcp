import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  extractCompactHtml,
  extractCompactXml,
  formatAndSliceOutput,
} from "../src/extract.js";
import {
  discoverBitstreamsInText,
  extractTextFromPdfBuffer,
  grepExtractedText,
  parseDelimitedText,
  parseDocumentBuffer,
  rewriteRepositoryContentUrl,
} from "../src/content-fetcher.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Tool = {
  name: string;
  title?: string;
  description?: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
  inputSchema: { properties?: Record<string, { description?: string }> };
};

const client = new Client({ name: "router-tests", version: "1.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "src/index.ts", "--mode=router"],
  cwd: root,
  stderr: "pipe",
});

let tools: Tool[] = [];

before(async () => {
  await client.connect(transport);
  const listed = await client.listTools();
  tools = listed.tools as Tool[];
});

after(async () => {
  await client.close();
});

test("tryb --mode=router wystawia dokładnie 3 skonsolidowane narzędzia Meta-Routera", () => {
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["get_record", "list_sources", "search"],
  );
  for (const tool of tools) {
    assert.ok(tool.title && tool.title.trim().length > 0, `${tool.name} bez title`);
    assert.ok(
      tool.annotations?.title && tool.annotations.title.trim().length > 0,
      `${tool.name} bez annotations.title`,
    );
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} bez readOnlyHint`);
    assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} bez destructiveHint: false`);
    assert.equal(tool.annotations?.openWorldHint, true, `${tool.name} bez openWorldHint`);
    assert.match(
      tool.description ?? "",
      /https:\/\/pamcp\.pl\/connectors/,
      `${tool.name} musi zawierać link do dokumentacji Target API Docs`,
    );
  }
});

test("list_sources zwraca katalog źródeł, kategorii oraz szczegółowe operacje dla wybranej bazy", async () => {
  const allResult = await client.callTool({
    name: "list_sources",
    arguments: { category: "prawo" },
  });
  assert.notEqual(allResult.isError, true);
  const content = (allResult.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
  const parsed = JSON.parse(content) as {
    totalSources: number;
    sources: Array<{ id: string; group: string; operations: unknown[] }>;
  };
  assert.equal(parsed.totalSources, 3);
  assert.deepEqual(
    parsed.sources.map((s) => s.id),
    ["isap", "saos", "bs_sejm"],
  );

  const detailResult = await client.callTool({
    name: "list_sources",
    arguments: { source: "isap", include_operations: true },
  });
  const detailParsed = JSON.parse(
    (detailResult.content as Array<{ type: string; text: string }>)[0]?.text ?? "{}",
  ) as {
    sources: Array<{
      id: string;
      operations: Array<{ operation: string; parameters: Record<string, string> }>;
    }>;
  };
  assert.equal(detailParsed.sources.length, 1);
  assert.equal(detailParsed.sources[0].id, "isap");
  assert.deepEqual(
    detailParsed.sources[0].operations.map((o) => o.operation),
    ["isap_search_acts", "isap_get_act"],
  );
});

test("extract.ts oczyszcza HTML, usuwa base64 i wspiera stronicowanie offset/maxChars", () => {
  const noisyHtml = `
    <!DOCTYPE html>
    <html>
      <head><style>body { color: red; }</style><script>alert(1);</script></head>
      <body>
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA" />
        <table>
          <tr><th>Nazwisko</th><th>Imię</th><th>Akcja</th></tr>
          <tr><td>Kowalski</td><td>Jan</td><td><a href="/record/123">Szczegóły</a></td></tr>
        </table>
      </body>
    </html>
  `;
  const compact = extractCompactHtml(noisyHtml);
  assert.doesNotMatch(compact, /alert\(1\)/);
  assert.doesNotMatch(compact, /iVBORw0KGgo/);
  assert.match(compact, /Kowalski \| Jan \| Szczegóły \[\/record\/123\]/);

  const xml = `<OAI-PMH>\n  <record>\n    <title>Test</title>\n  </record>\n</OAI-PMH>`;
  assert.equal(
    extractCompactXml(xml),
    "<OAI-PMH>\n<record>\n<title>Test</title>\n</record>\n</OAI-PMH>",
  );

  const longText = "A".repeat(2500);
  const page1 = formatAndSliceOutput(longText, { format: "raw", offset: 0, maxChars: 1000 });
  assert.match(page1, /wyświetlono znaki 0–1000 z 2500/);
  assert.match(page1, /offset=1000/);
});

test("content-fetcher.ts wyodrębnia tekst z PDF (FlateDecode + BT/ET), CSV/TSV z grep oraz wykrywa bitstreamy", () => {
  // 1) Synthetic PDF with FlateDecode content stream
  const contentStream = "BT /F1 12 Tf 72 720 Td [(Polska Akademia Nauk) -200 (Raport Badawczy 2026)] TJ ET";
  const compressed = deflateSync(Buffer.from(contentStream, "latin1"));
  const pdfHeader = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Filter /FlateDecode /Length " +
      compressed.length +
      " >>\nstream\r\n",
    "latin1",
  );
  const pdfFooter = Buffer.from("\r\nendstream\nendobj\n%%EOF", "latin1");
  const pdfBuf = Buffer.concat([pdfHeader, compressed, pdfFooter]);

  const extractedPdf = extractTextFromPdfBuffer(pdfBuf);
  assert.equal(extractedPdf.pageCountEstimate, 1);
  assert.match(extractedPdf.text, /Polska Akademia Nauk Raport Badawczy 2026/);

  // 2) CSV parsing + grep filtering
  const csvSample = [
    "Nazwisko;Imie;Miejscowosc;Rok",
    "Kowalski;Jan;Warszawa;1912",
    "Nowak;Anna;Krakow;1920",
    "Kowalski;Piotr;Lublin;1935",
  ].join("\n");
  const parsedCsv = parseDelimitedText(csvSample, { grep: "Kowalski" });
  assert.equal(parsedCsv.totalRows, 3);
  assert.equal(parsedCsv.matchedRows, 2);
  assert.match(parsedCsv.text, /Kowalski \| Jan \| Warszawa \| 1912/);
  assert.doesNotMatch(parsedCsv.text, /Nowak/);

  // 3) Bitstream discovery from ISAP & DSpace JSON
  const sampleRecord = JSON.stringify({
    ELI: "DU/2023/123",
    _links: {
      self: {
        href: "https://ruj.uj.edu.pl/server/api/core/items/3fa85f64-5717-4562-b3fc-2c963f66afa6",
      },
    },
    file: "https://example.edu.pl/bitstreams/999/content",
    sheet: "https://archiwum.plock.ap.gov.pl/wp-content/uploads/2021/03/GENEA.xlsx",
  });
  const files = discoverBitstreamsInText(sampleRecord, "isap");
  assert.ok(files.some((f) => f.url.endsWith("DU/2023/123/text.pdf")));
  assert.ok(files.some((f) => f.url.endsWith("/bundles")));
  assert.ok(files.some((f) => f.url.endsWith("GENEA.xlsx")));

  const isapWithoutEli = JSON.stringify({
    pos: 1289,
    publisher: "DU",
    textPDF: true,
    year: 2026,
    references: { "Podstawa prawna": [{ id: "DU/2026/1287" }] },
  });
  const isapFiles = discoverBitstreamsInText(isapWithoutEli, "isap");
  assert.ok(isapFiles.some((f) => f.url.endsWith("/acts/DU/2026/1289/text.pdf")));
  assert.equal(isapFiles.some((f) => f.url.includes("/1287/")), false);

  assert.equal(
    rewriteRepositoryContentUrl(
      "https://jbc.bj.uj.edu.pl/dlibra/applet/publication/425260/edition/472659?handler=pdf",
    ),
    "https://jbc.bj.uj.edu.pl/Content/472659/",
  );

  const longLine = `${"x".repeat(800)}podatku dochodowego od osób prawnych${"y".repeat(800)}`;
  const grepped = grepExtractedText(longLine, "podatk");
  assert.equal(grepped.matchCount, 1);
  assert.match(grepped.matchedText, /podatku dochodowego/);
  assert.ok(grepped.matchedText.length < 600);

  // 4) parseDocumentBuffer with grep on PDF
  const doc = parseDocumentBuffer(pdfBuf, "https://example.org/test.pdf", "application/pdf", {
    grep: "Akademia",
  });
  assert.equal(doc.detectedFormat, "pdf");
  assert.match(doc.text, /Znaleziono 1 wystąpień wzorca "Akademia"/);
});
