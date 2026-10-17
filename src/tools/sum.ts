import { toToolErrorText } from "../tool-error-handling.js";
/**
 * Śląski Uniwersytet Medyczny w Katowicach (ŚUM) — katalog biblioteczny Aleph (Ex Libris).
 * OPAC: https://katalog.sum.edu.pl/
 *
 * Interfejs maszynowy: Aleph **X-Server** pod adresem `/X` (XML).
 * Uwaga: rzeczywisty kod głównej bazy katalogowej ŚUM w systemie Aleph to **`SLA01`**
 * (od dawnej nazwy: Śląska Akademia Medyczna), a nie `SUM01`. Przekazanie nieistniejącego kodu
 * `SUM01` powodowało traktowanie go przez Aleph jako zewnętrznego celu Z39.50/SRU i błąd
 * `SRU gate configuration file is missing`. Narzędzie automatycznie mapuje `SUM01` -> `SLA01`.
 *
 * Dostępne bazy lokalne (`local_base`):
 *   - `SLA01` (lub `sla`) — katalog główny Biblioteki ŚUM
 *   - `ks`                — książki
 *   - `cz`                — czasopisma
 *   - `cdm01`             — Centrum Dokumentacji Dziejów Medycyny i Farmacji Górnego Śląska
 *
 * Narzędzia:
 *   sum_aleph_find    — wyszukiwanie `op=find` (np. `wrd=farmakologia`, `wti=anatomia`, `wau=Kowalski`) + podgląd pierwszych rekordów.
 *   sum_aleph_present — pobranie pełnych rekordów MARC/XML (`op=present`) dla wskazanego `set_no` i `set_entry`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { decodeHtmlEntities } from "../extract.js";

const CATALOG_ORIGIN = "https://katalog.sum.edu.pl";
const X_URL = `${CATALOG_ORIGIN}/X`;

const XML_HEADERS = { Accept: "application/xml, text/xml;q=0.9, */*;q=0.8" };
const CACHE_TTL = 86_400; // 24 h

function normalizeAlephBase(base: string): string {
  const trimmed = base.trim();
  if (!trimmed || /^sum0?1?$/i.test(trimmed)) {
    return "SLA01";
  }
  return trimmed;
}

function normalizeAlephRequest(request: string): string {
  const trimmed = request.trim();
  if (/^[a-z]{2,4}=/i.test(trimmed)) {
    return trimmed;
  }
  return `wrd=${trimmed}`;
}

function normalizeSetEntry(entry: string): string {
  const trimmed = entry.trim().replace(/,/g, "-");
  if (/^\d+$/.test(trimmed)) {
    return trimmed.padStart(9, "0");
  }
  const parts = trimmed.split("-");
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return `${parts[0].padStart(9, "0")}-${parts[1].padStart(9, "0")}`;
  }
  return trimmed;
}

export interface SumMarcSummary {
  entry: string;
  doc_number: string;
  title: string;
  author?: string;
  publication?: string;
  year?: string;
  isbn_or_issn?: string;
  subjects?: string[];
}

export function parseAlephPresentXml(xml: string): SumMarcSummary[] {
  const summaries: SumMarcSummary[] = [];
  const recordRe = /<record>\s*<record_header>\s*<set_entry>(\d+)<\/set_entry>\s*<\/record_header>\s*<doc_number>(\d+)<\/doc_number>([\s\S]*?)<\/record>/gi;
  let m: RegExpExecArray | null;
  while ((m = recordRe.exec(xml)) !== null) {
    const entry = m[1];
    const docNumber = m[2];
    const body = m[3];

    const getSubfields = (fieldId: string): Record<string, string[]> => {
      const out: Record<string, string[]> = {};
      const varRe = new RegExp(`<varfield\\s+id="${fieldId}"[^>]*>([\\s\\S]*?)<\\/varfield>`, "gi");
      let vm: RegExpExecArray | null;
      while ((vm = varRe.exec(body)) !== null) {
        const subRe = /<subfield\s+label="([^"]+)">([\s\S]*?)<\/subfield>/gi;
        let sm: RegExpExecArray | null;
        while ((sm = subRe.exec(vm[1])) !== null) {
          const code = sm[1];
          const val = decodeHtmlEntities(sm[2]).trim();
          if (!out[code]) out[code] = [];
          out[code].push(val);
        }
      }
      return out;
    };

    const f245 = getSubfields("245");
    const f100 = getSubfields("100");
    const f700 = getSubfields("700");
    const f260 = getSubfields("260");
    const f020 = getSubfields("020");
    const f022 = getSubfields("022");
    const f650 = getSubfields("650");

    const titleParts = [...(f245["a"] ?? []), ...(f245["b"] ?? [])];
    const title = titleParts.join(" ").replace(/\s*\/\s*$/, "").trim();
    const author =
      (f100["a"] ?? [])[0] ??
      (f245["c"] ?? [])[0] ??
      (f700["a"] ?? []).slice(0, 3).join("; ") ??
      undefined;
    const pubParts = [...(f260["a"] ?? []), ...(f260["b"] ?? []), ...(f260["c"] ?? [])];
    const year = (f260["c"] ?? [])[0]?.replace(/[^\d-]/g, "") || undefined;
    const isbnIssn = (f020["a"] ?? f022["a"] ?? [])[0];
    const subjects = f650["a"]?.slice(0, 8);

    summaries.push({
      entry,
      doc_number: docNumber,
      title,
      author,
      publication: pubParts.length > 0 ? pubParts.join(" ") : undefined,
      year,
      isbn_or_issn: isbnIssn,
      subjects: subjects && subjects.length > 0 ? subjects : undefined,
    });
  }
  return summaries;
}

export function registerSumTools(server: McpServer, env: Env): void {
  // ── sum_aleph_find ────────────────────────────────────────────────────────
  server.tool(
    "sum_aleph_find",
    [
      "Wyszukiwanie w katalogu bibliotecznym Aleph Śląskiego Uniwersytetu Medycznego w Katowicach (katalog.sum.edu.pl) przez X-Server (`op=find`).",
      "Domyślny kod bazy to `SLA01` (katalog główny ŚUM; obsługiwane też: `ks` książki, `cz` czasopisma, `cdm01` historia medycyny; przekazywane `SUM01` jest automatycznie mapowane na `SLA01`).",
      "Parametr `request` przyjmuje składnię indeksów Aleph (np. `wrd=farmakologia`, `wti=anatomia`, `wau=Kowalski`) lub zwykłą frazę tekstową.",
      "Zwraca numer utworzonego zestawu (`set_number`), liczbę trafień (`no_records`) oraz automatyczny podgląd pierwszych 5 rekordów MARC.",
    ].join(" "),
    {
      local_base: z
        .string()
        .min(1)
        .default("SLA01")
        .describe("Kod bazy bibliograficznej Aleph ŚUM: SLA01 (domyślnie, katalog główny), ks (książki), cz (czasopisma), cdm01 (historia medycyny)"),
      request: z
        .string()
        .min(1)
        .describe("Zapytanie wyszukiwawcze, np. wrd=kardiologia, wti=farmakologia lub zwykła fraza słowna"),
    },
    async ({ local_base, request }) => {
      try {
        const effectiveBase = normalizeAlephBase(local_base);
        const effectiveRequest = normalizeAlephRequest(request);
        const params = new URLSearchParams({
          op: "find",
          base: effectiveBase,
          request: effectiveRequest,
        });
        const url = `${X_URL}?${params}`;
        const key = makeCacheKey("sum_aleph_find_v2", {
          local_base: effectiveBase,
          request: effectiveRequest,
        });
        const findXml = await cachedFetch(
          env.CACHE_KV,
          key,
          url,
          { headers: XML_HEADERS },
          CACHE_TTL,
        );

        const setMatch = findXml.match(/<set_number>(\d+)<\/set_number>/i);
        const countMatch = findXml.match(/<no_records>(\d+)<\/no_records>/i);
        const setNumber = setMatch ? setMatch[1] : null;
        const totalRecords = countMatch ? Number.parseInt(countMatch[1], 10) : 0;

        let previewRecords: SumMarcSummary[] = [];
        if (setNumber && totalRecords > 0) {
          const maxPreview = Math.min(totalRecords, 5);
          const entryRange = `000000001-${String(maxPreview).padStart(9, "0")}`;
          const presentParams = new URLSearchParams({
            op: "present",
            set_number: setNumber,
            set_no: setNumber,
            set_entry: entryRange,
            format: "marc",
          });
          const presentUrl = `${X_URL}?${presentParams}`;
          const presentXml = await cachedFetch(
            env.CACHE_KV,
            makeCacheKey("sum_aleph_find_preview_v2", { setNumber, entryRange }),
            presentUrl,
            { headers: XML_HEADERS },
            CACHE_TTL,
          ).catch(() => "");
          if (presentXml) {
            previewRecords = parseAlephPresentXml(presentXml);
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  base: effectiveBase,
                  request: effectiveRequest,
                  set_number: setNumber,
                  total_records: totalRecords,
                  preview_records: previewRecords,
                  raw_find_xml: findXml.trim(),
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
          content: [{ type: "text", text: `Error calling sum_aleph_find: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // ── sum_aleph_present ─────────────────────────────────────────────────────
  server.tool(
    "sum_aleph_present",
    [
      "Pobiera pełne rekordy katalogowe z serwera Aleph X-Server Śląskiego Uniwersytetu Medycznego (`op=present`, format MARC/XML).",
      "Użyj `set_no` (numeru zestawu zwróconego przez sum_aleph_find, np. '000221' lub '000001') oraz `set_entry` (np. '000000001' lub zakresu '000000001-000000005').",
      "Zwraca ustrukturyzowane podsumowanie pól MARC (tytuł, autor, wydawca, rok, ISBN/ISSN, hasła przedmiotowe) oraz pełny XML `<oai_marc>`.",
    ].join(" "),
    {
      set_no: z
        .string()
        .min(1)
        .describe("Numer zestawu wyników zwrócony przez sum_aleph_find, np. 000001 lub 000221"),
      set_entry: z
        .string()
        .min(1)
        .describe(
          "Indeks wpisu lub zakres: pojedynczy numer (np. 000000001 lub 1) albo zakres od-do (np. 000000001-000000005)",
        ),
      format: z.string().default("marc").describe("Format prezentacji wyników w Aleph (domyślnie marc)"),
    },
    async ({ set_no, set_entry, format }) => {
      try {
        const cleanSetNo = set_no.trim().padStart(6, "0");
        const cleanEntry = normalizeSetEntry(set_entry);
        const params = new URLSearchParams({
          op: "present",
          set_number: cleanSetNo,
          set_no: cleanSetNo,
          set_entry: cleanEntry,
          format,
        });
        const url = `${X_URL}?${params}`;
        const key = makeCacheKey("sum_aleph_present_v2", {
          set_no: cleanSetNo,
          set_entry: cleanEntry,
          format,
        });
        const text = await cachedFetch(
          env.CACHE_KV,
          key,
          url,
          { headers: XML_HEADERS },
          CACHE_TTL,
        );
        const records = parseAlephPresentXml(text);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  set_no: cleanSetNo,
                  set_entry: cleanEntry,
                  records_count: records.length,
                  records,
                  raw_xml: text,
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
          content: [{ type: "text", text: `Error calling sum_aleph_present: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
