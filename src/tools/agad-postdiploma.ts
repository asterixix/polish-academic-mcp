import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { extractCompactHtml, extractCompactXml } from "../extract.js";
import { decodeBufferWithCharset, grepExtractedText } from "../content-fetcher.js";

const CACHE_TTL = 86_400;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const AGAD_STATIC_SOURCES = {
  michalewicz: {
    url: "https://agad.gov.pl/genealogia/michalewicz.xml",
    title: "Baza Michalewicza — gminy wyznaniowe żydowskie w Galicji (7 797 miejscowości)",
    isHtml: false,
  },
  luceoria: {
    url: "https://agad.gov.pl/genealogia/geoluceoria.xml",
    title: "Luceoria — wykaz miejscowości i parafii diecezji łuckiej (5 447 miejscowości)",
    isHtml: false,
  },
  indexmet: {
    url: "https://www.agad.gov.pl/inwentarze/indexmet.xml",
    title: "Skorowidz geograficzny ksiąg metrykalnych zabużańskich w AGAD (5 070 miejscowości)",
    isHtml: true,
  },
  turcja: {
    url: "https://www.agad.gov.pl/AKW_Turcja/Tur.xml",
    title: "Archiwum Koronne Warszawskie — dział Turecki (dokumenty dyplomatyczne osmańskie)",
    isHtml: false,
  },
  cmentarze_plany: {
    url: "https://www.agad.gov.pl/cmentarze/cm_plany.xml",
    title: "Plany cmentarzy wojennych z I wojny światowej w zasobie AGAD (z linkami do skanów JPG)",
    isHtml: false,
  },
  cmentarze_wykaz: {
    url: "https://www.agad.gov.pl/cmentarze/frn.html",
    title: "Wykaz cmentarzy wojennych z I wojny światowej (tabela ISO-8859-2)",
    isHtml: true,
  },
  metrykalia_katalog: {
    url: "https://agad.gov.pl/metrykalia.html",
    title: "Metrykalia Koronne i Libri Legationum — katalog zestawów 14–20 oraz sumariuszy PDF",
    isHtml: true,
  },
  inwentarze_katalog: {
    url: "https://www.agad.gov.pl/inwentarze/testy.html",
    title: "Wykaz inwentarzy ksiąg metrykalnych wyznań chrześcijańskich i mojżeszowych w AGAD",
    isHtml: true,
  },
  polonica: {
    url: "https://www.agad.gov.pl/inwentarze/polon.xml",
    title: "Polonika w archiwach zagranicznych (6 430 rekordów inwentarzowych)",
    isHtml: true,
  },
} as const;

type AgadStaticKey = keyof typeof AGAD_STATIC_SOURCES;

// In-memory cache for parsed static AGAD texts so repeated searches do not re-download
const agadTextCache = new Map<string, Promise<string>>();

async function getAgadStaticText(key: AgadStaticKey): Promise<string> {
  const existing = agadTextCache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const def = AGAD_STATIC_SOURCES[key];
    const res = await fetch(def.url, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      agadTextCache.delete(key);
      throw new Error(`HTTP ${res.status} podczas pobierania ${def.url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const decoded = decodeBufferWithCharset(buf, res.headers.get("content-type") ?? "");
    return def.isHtml ? extractCompactHtml(decoded) : extractCompactXml(decoded);
  })();

  agadTextCache.set(key, promise);
  return promise;
}

export function registerAgadTools(server: McpServer, env: Env): void {
  server.tool(
    "agad_search",
    [
      "Wyszukiwanie w bazach danych i inwentarzach Archiwum Głównego Akt Dawnych (AGAD — agad.gov.pl):",
      "obsługuje dynamiczną wyszukiwarkę zespołów i regestów AGAD (/szukaj/?zbior=45 — np. Polacy na uniwersytecie w Dorpacie, Metryka Koronna, Libri Legationum — zestawy 14..20, zbiory 1..101)",
      "oraz przeszukiwanie indeksów geograficznych i tematycznych AGAD: michalewicz (gminy żydowskie w Galicji), luceoria (parafie diecezji łuckiej), indexmet (księgi metrykalne zabużańskie), turcja (AKW dział turecki), cmentarze_plany, cmentarze_wykaz, metrykalia_katalog, inwentarze_katalog oraz polonica.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe(
          "Fraza wyszukiwania: nazwisko (np. w zbiorze studentów w Dorpacie zbior=45), nazwa miejscowości (np. Lwów, Brody, Łuck w bazach michalewicz/luceoria/indexmet) lub hasło rzeczowe.",
        ),
      collection: z
        .enum([
          "szukaj",
          "michalewicz",
          "luceoria",
          "indexmet",
          "turcja",
          "cmentarze_plany",
          "cmentarze_wykaz",
          "metrykalia_katalog",
          "inwentarze_katalog",
          "polonica",
        ])
        .default("szukaj")
        .describe(
          "Kolekcja AGAD do przeszukania: szukaj (wyszukiwarka /szukaj/, domyślnie zbior=45), michalewicz, luceoria, indexmet, turcja, cmentarze_plany, cmentarze_wykaz, metrykalia_katalog, inwentarze_katalog lub polonica.",
        ),
      zbior: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(45)
        .describe(
          "Numer zbioru w wyszukiwarce /szukaj/ (domyślnie 45 = Polacy na uniwersytecie w Dorpacie; inne zbiory to 1..101).",
        ),
      zestaw: z
        .number()
        .int()
        .optional()
        .describe(
          "Opcjonalny numer zestawu w wyszukiwarce /szukaj/ (np. 14–20 dla tomów Metryki Koronnej i Libri Legationum z metrykalia.html).",
        ),
    },
    async ({ query, collection, zbior, zestaw }) => {
      try {
        if (collection === "szukaj") {
          const qs = new URLSearchParams({
            q: query,
            data_od: "",
            data_do: "",
            s: "Szukaj",
          });
          if (zestaw !== undefined) {
            qs.set("zestaw", String(zestaw));
          } else {
            qs.set("zbior", String(zbior));
          }
          const url = `https://agad.gov.pl/szukaj/?${qs}`;
          const key = makeCacheKey("agad_search_szukaj", { query, zbior, zestaw: zestaw ?? "" });
          const rawHtml = await cachedFetch(
            env.CACHE_KV,
            key,
            url,
            { headers: { "User-Agent": BROWSER_UA } },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text: extractCompactHtml(rawHtml) }] };
        }

        const staticKey = collection as AgadStaticKey;
        const def = AGAD_STATIC_SOURCES[staticKey];
        const fullText = await getAgadStaticText(staticKey);
        const grepped = grepExtractedText(fullText, query, 3, 40);
        const header = `=== [AGAD: ${collection}] ${def.title} (${def.url}) ===`;
        return {
          content: [{ type: "text", text: `${header}\n${grepped.matchedText}` }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error calling agad_search: ${msg}` }], isError: true };
      }
    },
  );
}

export function registerPostdiplomaTools(server: McpServer, env: Env): void {
  server.tool(
    "postdiploma_search",
    [
      "Przeszukuje bazy XML serwisu postdiploma.pl powiązane z inwentarzami AGAD:",
      "ryga (http://www.postdiploma.pl/ryga.xml — Polacy na Politechnice Ryskiej) oraz extranea (http://www.postdiploma.pl/Extranea.xml — dokumenty i korespondencja dyplomatyczna Extranea).",
      "Używa protokołu HTTP z uwagi na wygasły certyfikat TLS serwera postdiploma.pl.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Nazwisko studenta (w bazie ryga), miejsce pochodzenia, rok lub słowo kluczowe."),
      dataset: z
        .enum(["all", "ryga", "extranea"])
        .default("all")
        .describe("Baza postdiploma.pl: all (obie bazy), ryga (Politechnika Ryska) lub extranea (Extranea)."),
    },
    async ({ query, dataset }) => {
      try {
        const targets: Array<{ id: "ryga" | "extranea"; url: string; label: string }> = [];
        if (dataset === "all" || dataset === "ryga") {
          targets.push({
            id: "ryga",
            url: "http://www.postdiploma.pl/ryga.xml",
            label: "Polacy na Politechnice Ryskiej (ryga.xml)",
          });
        }
        if (dataset === "all" || dataset === "extranea") {
          targets.push({
            id: "extranea",
            url: "http://www.postdiploma.pl/Extranea.xml",
            label: "Dokumenty dyplomatyczne Extranea (Extranea.xml)",
          });
        }

        const sections: string[] = [];
        for (const t of targets) {
          const key = makeCacheKey(`postdiploma_${t.id}`, {});
          const rawXml = await cachedFetch(
            env.CACHE_KV,
            key,
            t.url,
            { headers: { "User-Agent": BROWSER_UA } },
            CACHE_TTL,
          );
          const compact = extractCompactXml(rawXml);
          const grepped = grepExtractedText(compact, query, 5, 35);
          sections.push(`=== [postdiploma.pl: ${t.id}] ${t.label} ===\n${grepped.matchedText}`);
        }

        return { content: [{ type: "text", text: sections.join("\n\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling postdiploma_search: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
