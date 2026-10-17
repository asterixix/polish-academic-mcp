import { toToolErrorText } from "../tool-error-handling.js";
/**
 * Polska Platforma Medyczna (PPM) — https://ppm.edu.pl/index.seam
 * Centralny portal zarządzania wiedzą i potencjałem badawczym polskich uczelni medycznych
 * oraz instytutów badawczych:
 *   - Śląski Uniwersytet Medyczny w Katowicach (SUM)
 *   - Warszawski Uniwersytet Medyczny (WUM)
 *   - Uniwersytet Medyczny we Wrocławiu (UMW)
 *   - Gdański Uniwersytet Medyczny (GUM)
 *   - Uniwersytet Medyczny w Białymstoku (UMB)
 *   - Uniwersytet Medyczny w Lublinie (UML)
 *   - Pomorski Uniwersytet Medyczny w Szczecinie (PUM)
 *   - Instytut Medycyny Pracy w Łodzi (IMP)
 *
 * Narzędzia:
 *   ppm_search     — wyszukiwanie publikacji, naukowców, doktoratów, danych badawczych, projektów i patentów.
 *   ppm_get_record — pełna karta publikacji, profilu naukowca, doktoratu lub zbioru danych badawczych.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { decodeHtmlEntities, extractCompactHtml } from "../extract.js";

const PPM_ORIGIN = "https://ppm.edu.pl";
const HTML_HEADERS = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};
const CACHE_TTL = 86_400; // 24 h

export const PPM_RESOURCE_TYPES = [
  "publication",
  "author",
  "phd",
  "researchdata",
  "project",
  "patent",
  "journal",
] as const;

export interface PpmSearchItem {
  id: string;
  record_id: string;
  entity_type: string;
  institution: string | null;
  title: string;
  citation: string;
  doi: string | null;
  url: string;
}

function cleanHtmlText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePpmResultListHtml(html: string): {
  total_hint: number | null;
  items: PpmSearchItem[];
} {
  const countMatch =
    html.match(/Znaleziono\s+(?:ponad\s+)?(\d[\d\s\u00a0]*)\s+wynik/i) ??
    html.match(/Liczba\s+wynik[^:]*:\s*(\d[\d\s\u00a0]*)/i);
  const totalHint = countMatch
    ? Number.parseInt(countMatch[1].replace(/[\s\u00a0]/g, ""), 10)
    : null;

  const items: PpmSearchItem[] = [];
  const seen = new Set<string>();

  // Each result item in PPM has <a href="/info/{entity_type}/{record_id}?..." ...> and <div class="rowEntry">
  const blockRe =
    /<a\s+[^>]*href="\/info\/([a-zA-Z0-9_-]+)\/([A-Za-z0-9_-]+)(?:\?[^"]*)?"[^>]*>\s*<span\s+id="entity-row-title-[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<\/a>([\s\S]{0,4000}?)(?=<a\s+[^>]*href="\/info\/|<\/ul>|<div\s+class="pagination|$)/gi;

  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const entityType = m[1];
    const recordId = m[2];
    if (entityType === "domain" || entityType === "affiliation") continue;
    const fullId = `${entityType}/${recordId}`;
    if (seen.has(fullId)) continue;
    seen.add(fullId);

    const title = cleanHtmlText(m[3]);
    const tail = m[4];

    const rowEntryMatch = tail.match(/<div\s+[^>]*id="[^"]*:rowEntry"[^>]*>([\s\S]*?)<\/div>/i) ??
      tail.match(/<div\s+class="rowEntry[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const citation = rowEntryMatch ? cleanHtmlText(rowEntryMatch[1]) : cleanHtmlText(tail).slice(0, 500);

    const doiMatch =
      tail.match(/https?:\/\/doi\.org\/(10\.\d{4,9}\/[^\s"'<>&#]+)/i) ??
      tail.match(/rft_id=info%3Adoi%2F(10\.\d{4,9}%2F[^&"'\s<>]+)/i);
    const doi = doiMatch ? decodeURIComponent(doiMatch[1]) : null;

    const instMatch = recordId.match(/^([A-Z]{2,5})/i);
    const institution = instMatch ? instMatch[1].toUpperCase() : null;

    items.push({
      id: fullId,
      record_id: recordId,
      entity_type: entityType,
      institution,
      title,
      citation,
      doi,
      url: `${PPM_ORIGIN}/info/${entityType}/${recordId}`,
    });
  }

  // Fallback for author / profile result lists where markup uses slightly different link classes
  if (items.length === 0) {
    const fallbackRe =
      /href="\/info\/([a-zA-Z0-9_-]+)\/([A-Za-z0-9_-]+)(?:\?[^"]*)?"[^>]*>([\s\S]*?)<\/a>/gi;
    let fm: RegExpExecArray | null;
    while ((fm = fallbackRe.exec(html)) !== null) {
      const entityType = fm[1];
      const recordId = fm[2];
      if (entityType === "domain" || entityType === "affiliation") continue;
      const fullId = `${entityType}/${recordId}`;
      if (seen.has(fullId)) continue;
      const text = cleanHtmlText(fm[3]);
      if (!text || text.length < 3 || /^(więcej|szczegóły|pokaż|zobacz)$/i.test(text)) continue;
      seen.add(fullId);
      const instMatch = recordId.match(/^([A-Z]{2,5})/i);
      items.push({
        id: fullId,
        record_id: recordId,
        entity_type: entityType,
        institution: instMatch ? instMatch[1].toUpperCase() : null,
        title: text,
        citation: text,
        doi: null,
        url: `${PPM_ORIGIN}/info/${entityType}/${recordId}`,
      });
    }
  }

  return {
    total_hint: totalHint ?? items.length,
    items,
  };
}

export function parsePpmRecordDetailHtml(
  html: string,
  entityType: string,
  recordId: string,
): Record<string, unknown> {
  const meta: Record<string, string[]> = {};
  const metaRe = /<meta\s+name="([^"]+)"\s+content="([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) {
    const name = m[1].trim().toLowerCase();
    const content = decodeHtmlEntities(m[2]).trim();
    if (!content || /^(viewport|theme-color|generator|robots)$/i.test(name)) continue;
    if (!meta[name]) meta[name] = [];
    if (!meta[name].includes(content)) meta[name].push(content);
  }

  const titleMatch =
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ??
    html.match(/<title>([\s\S]*?)<\/title>/i);
  const pageTitle = titleMatch
    ? cleanHtmlText(titleMatch[1]).replace(/\s*-\s*Polska Platforma Medyczna.*$/i, "").trim()
    : null;

  const doiMatch =
    html.match(/https?:\/\/doi\.org\/(10\.\d{4,9}\/[^\s"'<>&#]+)/i) ??
    (meta["citation_doi"]?.[0] ? [null, meta["citation_doi"][0]] : null);

  // Extract structured label-value rows from the PPM info card
  const details: Record<string, string> = {};
  const dtDdRe =
    /<div\s+class="[^"]*(?:info-label|field-label|labelColumn)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div\s+class="[^"]*(?:info-value|field-value|valueColumn)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let dm: RegExpExecArray | null;
  while ((dm = dtDdRe.exec(html)) !== null) {
    const k = cleanHtmlText(dm[1]).replace(/:$/, "");
    const v = cleanHtmlText(dm[2]);
    if (k && v) details[k] = v;
  }

  // Also extract main content summary
  const mainSliceIdx = html.indexOf("id=\"content\"");
  const compactSummary = extractCompactHtml(
    mainSliceIdx !== -1 ? html.slice(mainSliceIdx, mainSliceIdx + 40_000) : html,
  ).slice(0, 6_000);

  return {
    id: `${entityType}/${recordId}`,
    record_id: recordId,
    entity_type: entityType,
    url: `${PPM_ORIGIN}/info/${entityType}/${recordId}`,
    title: meta["citation_title"]?.[0] ?? meta["dc.title"]?.[0] ?? pageTitle,
    authors: meta["citation_author"] ?? meta["dc.creator"] ?? [],
    publication_date: meta["citation_publication_date"]?.[0] ?? meta["dc.date"]?.[0] ?? null,
    journal_or_book:
      meta["citation_journal_title"]?.[0] ??
      meta["citation_inbook_title"]?.[0] ??
      meta["dc.source"]?.[0] ??
      null,
    publisher: meta["citation_publisher"]?.[0] ?? meta["dc.publisher"]?.[0] ?? null,
    doi: doiMatch ? doiMatch[1] : null,
    isbn: meta["citation_isbn"]?.[0] ?? null,
    issn: meta["citation_issn"]?.[0] ?? null,
    pdf_url: meta["citation_pdf_url"]?.[0] ?? null,
    keywords: meta["citation_keywords"] ?? meta["dc.subject"] ?? [],
    abstract: meta["dc.description"]?.[0] ?? meta["description"]?.[0] ?? null,
    details: Object.keys(details).length > 0 ? details : undefined,
    summary_text: compactSummary,
  };
}

export function registerPpmTools(server: McpServer, env: Env): void {
  // ── ppm_search ────────────────────────────────────────────────────────────
  server.tool(
    "ppm_search",
    [
      "Wyszukiwanie w Polskiej Platformie Medycznej (https://ppm.edu.pl/index.seam) — centralnym repozytorium publikacji, doktoratów, danych badawczych, patentów i profili naukowców polskich uczelni medycznych (m.in. ŚUM Katowice, WUM Warszawa, UMW Wrocław, GUM Gdańsk, UMB Białystok, UML Lublin, PUM Szczecin, IMP Łódź).",
      "Zwraca ustrukturyzowaną listę rekordów wraz z identyfikatorem `id` (np. 'book/SUMf8dceeba6b3b4255ae261e0970608615' lub 'article/WUM...') do użycia w ppm_get_record, tytułem, pełnym opisem bibliograficznym, DOI i kodem uczelni.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Fraza wyszukiwawcza: temat medyczny (np. kardiologia, farmakologia), tytuł publikacji, nazwisko autora lub DOI"),
      resource_type: z
        .enum(PPM_RESOURCE_TYPES)
        .default("publication")
        .describe(
          "Typ zasobu w PPM: publication (publikacje, domyślnie), author (naukowcy), phd (doktoraty), researchdata (dane badawcze), project (projekty), patent (patenty), journal (czasopisma)",
        ),
      institution: z
        .string()
        .optional()
        .describe(
          "Opcjonalny skrót uczelni do zawężenia wyników, np. SUM (Śląski Uniwersytet Medyczny), WUM, UMW, GUM, UMB, UML, PUM, IMP",
        ),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony wyników (liczony od 1, po 20 rekordów na stronę)"),
    },
    async ({ query, resource_type, institution, page }) => {
      try {
        const params = new URLSearchParams({
          r: resource_type,
          q: query.trim(),
          lang: "pl",
        });
        if (page > 1) {
          params.set("p", String(page));
        }

        const url = `${PPM_ORIGIN}/resultList.seam?${params.toString()}`;
        const cacheKey = makeCacheKey("ppm_search_v2", {
          query: query.trim(),
          resource_type,
          page,
        });
        const html = await cachedFetch(
          env.CACHE_KV,
          cacheKey,
          url,
          { headers: HTML_HEADERS },
          CACHE_TTL,
        );

        const parsed = parsePpmResultListHtml(html);
        const filteredItems =
          institution && institution.trim().length > 0
            ? parsed.items.filter(
                (it) =>
                  !it.institution ||
                  it.institution.toUpperCase() === institution.trim().toUpperCase() ||
                  it.record_id.toUpperCase().startsWith(institution.trim().toUpperCase()),
              )
            : parsed.items;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query: query.trim(),
                  resource_type,
                  institution: institution ?? null,
                  page,
                  total_hint: parsed.total_hint,
                  count: (filteredItems.length > 0 ? filteredItems : parsed.items).length,
                  items: filteredItems.length > 0 ? filteredItems : parsed.items,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const msg = toToolErrorText(err);
        return {
          content: [{ type: "text", text: `Error calling ppm_search: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // ── ppm_get_record ────────────────────────────────────────────────────────
  server.tool(
    "ppm_get_record",
    [
      "Pobiera pełną kartę rekordu z Polskiej Platformy Medycznej (https://ppm.edu.pl/info/{typ}/{id}).",
      "Przyjmuje identyfikator `id` zwrócony przez ppm_search (np. 'book/SUMf8dceeba6b3b4255ae261e0970608615', sam identyfikator 'SUMf8dceeba6b3b4255ae261e0970608615' lub pełny adres URL).",
      "Zwraca pełne metadane bibliograficzne (tytuł, autorów, afiliacje, czasopismo/monografię, rok, DOI, ISBN/ISSN, słowa kluczowe MeSH, streszczenie oraz linki Open Access PDF).",
    ].join(" "),
    {
      id: z
        .string()
        .min(1)
        .describe(
          "Identyfikator rekordu z ppm_search (np. 'book/SUMf8dceeba6b3b4255ae261e0970608615' lub 'SUMf8dceeba6b3b4255ae261e0970608615')",
        ),
    },
    async ({ id }) => {
      try {
        const trimmed = id.trim();
        let entityType = "article";
        let recordId = trimmed;

        const urlMatch = trimmed.match(/\/info\/([a-zA-Z0-9_-]+)\/([A-Za-z0-9_-]+)/i);
        if (urlMatch) {
          entityType = urlMatch[1];
          recordId = urlMatch[2];
        } else if (trimmed.includes("/")) {
          const parts = trimmed.split("/").filter(Boolean);
          entityType = parts[0];
          recordId = parts[1] ?? parts[0];
        } else {
          // Resolve exact entity_type by searching resultList for this recordId or trying common entity types
          const candidateTypes = ["article", "book", "chapter", "phd", "author", "researchdata", "project", "patent"];
          for (const candidate of candidateTypes) {
            const testUrl = `${PPM_ORIGIN}/info/${candidate}/${encodeURIComponent(recordId)}?lang=pl`;
            try {
              const html = await cachedFetch(
                env.CACHE_KV,
                makeCacheKey("ppm_get_record_probe_v1", { candidate, recordId }),
                testUrl,
                { headers: HTML_HEADERS },
                CACHE_TTL,
              );
              if (
                html.includes(recordId) &&
                !html.includes("Strona o podanym adresie nie istnieje") &&
                !html.includes("Page not found")
              ) {
                const parsed = parsePpmRecordDetailHtml(html, candidate, recordId);
                if (parsed.title) {
                  return {
                    content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }],
                  };
                }
              }
            } catch {
              // Try next entity type
            }
          }
        }

        const url = `${PPM_ORIGIN}/info/${encodeURIComponent(entityType)}/${encodeURIComponent(recordId)}?lang=pl`;
        const cacheKey = makeCacheKey("ppm_get_record_v1", { entityType, recordId });
        const html = await cachedFetch(
          env.CACHE_KV,
          cacheKey,
          url,
          { headers: HTML_HEADERS },
          CACHE_TTL,
        );
        const parsed = parsePpmRecordDetailHtml(html, entityType, recordId);
        return {
          content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }],
        };
      } catch (err) {
        const msg = toToolErrorText(err);
        return {
          content: [{ type: "text", text: `Error calling ppm_get_record: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
