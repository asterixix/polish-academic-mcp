import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { makeCacheKey } from "../cache.js";
import { rewriteRepositoryContentUrl } from "../content-fetcher.js";
import { ocrScannedPdfOrImageBuffer } from "../ocr-htr.js";

const CACHE_TTL = 86_400;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DLIBRA_SEARCH_QUERY = `
query getSearchResults($requestInput: RequestInput) {
  components(requestInput: $requestInput) {
    searchResults {
      failureMessage
      totalResultsCount
      queryString
      searchResults {
        publicationId
        elementId
        rootId
        Title: attributeValues(rdfName: "Title")
        Creator: attributeValues(rdfName: "Creator")
        Date: attributeValues(rdfName: "Date")
        Subject: attributeValues(rdfName: "Subject")
      }
    }
  }
}
`;

const DLIBRA_PUBLICATION_QUERY = `
query getPublication($requestInput: RequestInput) {
  components(requestInput: $requestInput) {
    publicationPage {
      canonicalUrl
      content_url
      allowDownload
      contentTypeDisplayable
    }
  }
}
`;

function dlibraSearchInput(query: string, page: number, size: number): Record<string, unknown> {
  return {
    requestInput: {
      page: "results",
      language: "pl",
      params: [
        { name: "q", value: query },
        { name: "action", value: "SimpleSearchAction" },
        { name: "type", value: "-6" },
        { name: "p", value: String(page - 1) },
        { name: "ipp", value: String(size) },
      ],
    },
  };
}

function dlibraPublicationInput(id: string): Record<string, unknown> {
  return {
    requestInput: {
      page: "publication",
      language: "pl",
      params: [{ name: "id", value: id }],
    },
  };
}

function absolutizeContent(origin: string, raw: string): string {
  const parsed = JSON.parse(raw) as {
    data?: {
      components?: {
        publicationPage?: { content_url?: string | null; canonicalUrl?: string | null } | null;
      } | null;
    };
  };
  const page = parsed.data?.components?.publicationPage;
  if (page?.content_url) {
    if (page.content_url.startsWith("/")) {
      page.content_url = `${origin}${page.content_url}`;
    }
    const applet = page.content_url.match(
      /^(https?:\/\/[^/]+)\/dlibra\/applet\/publication\/\d+\/edition\/(\d+)/i,
    );
    if (applet) page.content_url = `${applet[1]}/Content/${applet[2]}/`;
  }
  return JSON.stringify(parsed, null, 2).replace(/<\/?em>/gi, "");
}

function solvePsncPow(html: string): string | null {
  const tsMatch = html.match(/const\s+ts\s*=\s*["']([^"']+)["']/);
  const sigMatch = html.match(/const\s+signature\s*=\s*["']([^"']+)["']/);
  if (!tsMatch || !sigMatch) return null;

  const ts = tsMatch[1];
  const signature = sigMatch[1];
  for (let nonce = 0; nonce < 5_000_000; nonce++) {
    const hash = createHash("md5")
      .update(`${signature}${nonce}`)
      .digest("hex");
    if (hash.startsWith("00000")) {
      return `captcha_pow=${ts}_${nonce}`;
    }
  }
  return null;
}

async function fetchDlibraGraphql(
  env: Env,
  cacheKey: string,
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<string> {
  const cached = await env.CACHE_KV.get(cacheKey);
  if (cached !== null) return cached;

  const body = JSON.stringify({ query, variables });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": BROWSER_UA,
  };

  let res = await fetch(endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });
  let text = await res.text();

  if (text.includes("High Load - Verifying Browser") || text.includes("captcha_pow")) {
    const cookie = solvePsncPow(text);
    if (cookie) {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { ...headers, Cookie: cookie },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      text = await res.text();
    }
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} z ${endpoint}: ${text.slice(0, 300)}`);
  }

  env.CACHE_KV.put(cacheKey, text, { expirationTtl: CACHE_TTL }).catch(() => {});
  return text;
}

export function registerJbcTools(server: McpServer, env: Env): void {
  const endpoint = "https://jbc.bj.uj.edu.pl/graphql";

  server.tool(
    "jbc_search",
    [
      "Wyszukiwanie publikacji, starodruków, rękopisów, czasopism i książek w Jagiellońskiej Bibliotece Cyfrowej (JBC UJ — jbc.bj.uj.edu.pl) przez natywne API GraphQL dLibra.",
      "Zwraca ustrukturyzowany JSON z liczbą wyników, identyfikatorami obiektów, tytułami, autorami, datami wydania, prawami i linkami.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Fraza wyszukiwania pełnotekstowego lub metadanych (tytuł, autor, temat, sygnatura)."),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony wyników (liczony od 1)."),
      size: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Liczba rekordów na stronę (1–50)."),
    },
    async ({ query, page, size }) => {
      try {
        const key = makeCacheKey("jbc_search", { query, page, size });
        const text = await fetchDlibraGraphql(
          env,
          key,
          endpoint,
          DLIBRA_SEARCH_QUERY,
          dlibraSearchInput(query, page, size),
        );
        return { content: [{ type: "text", text: text.replace(/<\/?em>/gi, "") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error calling jbc_search: ${msg}` }], isError: true };
      }
    },
  );

  server.tool(
    "jbc_get_publication",
    [
      "Pobiera pełne metadane Dublin Core pojedynczej publikacji w Jagiellońskiej Bibliotece Cyfrowej (JBC UJ) na podstawie jej identyfikatora liczbowego.",
      "Zawiera również bezpośrednie linki do manifestu IIIF oraz treści cyfrowej publikacji.",
    ].join(" "),
    {
      id: z
        .string()
        .min(1)
        .describe(
          "Identyfikator wydania (elementId) z wyników jbc_search. To ten numer otwiera kartę publikacji i plik PDF.",
        ),
    },
    async ({ id }) => {
      try {
        const cleanId = id.trim();
        const key = makeCacheKey("jbc_get_publication", { id: cleanId });
        const raw = await fetchDlibraGraphql(
          env,
          key,
          endpoint,
          DLIBRA_PUBLICATION_QUERY,
          dlibraPublicationInput(cleanId),
        );
        return {
          content: [{ type: "text", text: absolutizeContent("https://jbc.bj.uj.edu.pl", raw) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling jbc_get_publication: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "jbc_ocr_htr",
    [
      "Odczytuje tekst ze skanów PDF pozbawionych warstwy tekstowej (w tym strumieni JPEG2000 /JPXDecode), starodruków oraz rękopisów z Jagiellońskiej Biblioteki Cyfrowej (JBC UJ) i innych bibliotek cyfrowych za pomocą hybrydowego silnika OCR/HTR.",
      "Rasteryzuje wybrane strony dokumentu w wysokiej rozdzielczości, wykonuje optyczne rozpoznawanie znaków (OCR) z korekcją historyczną oraz dołącza wyrenderowane obrazy stron (image/png) do odpowiedzi MCP, umożliwiając modelowi językowemu bezpośredni wizyjny odczyt pisma ręcznego (HTR), nut i starodruków.",
    ].join(" "),
    {
      id: z
        .string()
        .min(1)
        .describe(
          "Identyfikator wydania (elementId) w JBC (np. 629965 dla Trenów Kochanowskiego) lub bezpośredni adres URL do pliku PDF/skanu.",
        ),
      page_start: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer pierwszej strony skanu do odczytania (liczony od 1)."),
      page_end: z
        .number()
        .int()
        .min(1)
        .default(5)
        .describe("Numer ostatniej strony skanu do odczytania (domyślnie 5)."),
      lang: z
        .string()
        .default("pl")
        .describe("Kod języka dla silnika rozpoznawania pisma (np. pl, de, la, en)."),
      include_images: z
        .boolean()
        .default(true)
        .describe(
          "Gdy true, dołącza wyrenderowane obrazy stron (image/png) do odpowiedzi MCP na potrzeby wizyjnego odczytu rękopisów (HTR).",
        ),
    },
    async ({ id, page_start, page_end, lang, include_images }) => {
      try {
        const clean = id.trim();
        const rawUrl =
          clean.startsWith("http://") || clean.startsWith("https://")
            ? rewriteRepositoryContentUrl(clean)
            : `https://jbc.bj.uj.edu.pl/Content/${encodeURIComponent(clean.replace(/\D+/g, "") || clean)}/`;

        const res = await fetch(rawUrl, {
          headers: {
            "User-Agent": BROWSER_UA,
            Accept: "application/pdf,image/*,*/*;q=0.8",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText} podczas pobierania skanu ${rawUrl}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const ocr = ocrScannedPdfOrImageBuffer(buf, {
          pageStart: page_start,
          pageEnd: page_end,
          lang,
          includeImages: include_images,
          maxImages: 4,
        });

        const payload = {
          id: clean,
          sourceUrl: res.url || rawUrl,
          byteLength: buf.length,
          engine: ocr.engine,
          language: ocr.language,
          pageCount: ocr.pageCount,
          processedPages: ocr.processedPages,
          fullText: ocr.text,
          pages: ocr.pages.map((p) => ({
            page: p.page,
            width: p.width,
            height: p.height,
            text: p.text,
            lines: p.lines,
            hasVisionHtrImage: Boolean(p.imageBase64),
          })),
        };

        const contentBlocks: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [{ type: "text", text: JSON.stringify(payload, null, 2) }];

        if (include_images) {
          for (const p of ocr.pages) {
            if (p.imageBase64 && p.imageMimeType) {
              contentBlocks.push({
                type: "image",
                data: p.imageBase64,
                mimeType: p.imageMimeType,
              });
            }
          }
        }

        return { content: contentBlocks };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling jbc_ocr_htr: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

export function registerSbcTools(server: McpServer, env: Env): void {
  const endpoint = "https://www.sbc.org.pl/graphql";

  server.tool(
    "sbc_search",
    [
      "Wyszukiwanie publikacji, prasy śląskiej, dokumentów regionalnych i starodruków w Śląskiej Bibliotece Cyfrowej (SBC — sbc.org.pl) przez API GraphQL dLibra.",
      "Zwraca ustrukturyzowany JSON z listą publikacji, autorami, datami i identyfikatorami.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Fraza wyszukiwania w Śląskiej Bibliotece Cyfrowej (tytuł, autor, miejscowość, temat)."),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony wyników (liczony od 1)."),
      size: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Liczba rekordów na stronę (1–50)."),
    },
    async ({ query, page, size }) => {
      try {
        const key = makeCacheKey("sbc_search", { query, page, size });
        const text = await fetchDlibraGraphql(
          env,
          key,
          endpoint,
          DLIBRA_SEARCH_QUERY,
          dlibraSearchInput(query, page, size),
        );
        return { content: [{ type: "text", text: text.replace(/<\/?em>/gi, "") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error calling sbc_search: ${msg}` }], isError: true };
      }
    },
  );

  server.tool(
    "sbc_get_publication",
    [
      "Pobiera pełne metadane publikacji ze Śląskiej Biblioteki Cyfrowej (SBC) po identyfikatorze obiektu oraz zwraca linki do treści i manifestu IIIF.",
    ].join(" "),
    {
      id: z
        .string()
        .min(1)
        .describe("Identyfikator wydania (elementId) z wyników sbc_search."),
    },
    async ({ id }) => {
      try {
        const cleanId = id.trim();
        const key = makeCacheKey("sbc_get_publication", { id: cleanId });
        const raw = await fetchDlibraGraphql(
          env,
          key,
          endpoint,
          DLIBRA_PUBLICATION_QUERY,
          dlibraPublicationInput(cleanId),
        );
        return {
          content: [{ type: "text", text: absolutizeContent("https://www.sbc.org.pl", raw) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling sbc_get_publication: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

export function registerFbcTools(server: McpServer, env: Env): void {
  const endpoint = "https://fbc.pionier.net.pl/graphql";

  server.tool(
    "fbc_search",
    [
      "Wyszukiwanie w Federacji Bibliotek Cyfrowych PIONIER (fbc.pionier.net.pl) agregującej miliony obiektów ze wszystkich polskich bibliotek cyfrowych, muzeów i repozytoriów.",
      "Korzysta z API GraphQL FBC (z automatycznym rozwiązywaniem wyzwań kryptograficznych PSNC PoW).",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Fraza wyszukiwania w Federacji Bibliotek Cyfrowych (tytuł, autor, słowo kluczowe, sygnatura)."),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony wyników (liczony od 1)."),
      size: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Liczba rekordów na stronę (1–50)."),
    },
    async ({ query, page, size }) => {
      try {
        const key = makeCacheKey("fbc_search", { query, page, size });
        const text = await fetchDlibraGraphql(
          env,
          key,
          endpoint,
          DLIBRA_SEARCH_QUERY,
          dlibraSearchInput(query, page, size),
        );
        return { content: [{ type: "text", text: text.replace(/<\/?em>/gi, "") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error calling fbc_search: ${msg}` }], isError: true };
      }
    },
  );

  server.tool(
    "fbc_get_record",
    [
      "Pobiera szczegółowe metadane pojedynczego obiektu z Federacji Bibliotek Cyfrowych PIONIER (fbc.pionier.net.pl) na podstawie identyfikatora rekordu.",
    ].join(" "),
    {
      id: z
        .string()
        .min(1)
        .describe("Identyfikator obiektu w FBC zwrócony przez fbc_search."),
    },
    async ({ id }) => {
      try {
        const cleanId = id.trim();
        const key = makeCacheKey("fbc_get_record", { id: cleanId });
        const raw = await fetchDlibraGraphql(
          env,
          key,
          endpoint,
          DLIBRA_PUBLICATION_QUERY,
          dlibraPublicationInput(cleanId),
        );
        return {
          content: [{ type: "text", text: absolutizeContent("https://fbc.pionier.net.pl", raw) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling fbc_get_record: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
