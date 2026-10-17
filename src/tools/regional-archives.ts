import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { extractCompactHtml, decodeHtmlEntities } from "../extract.js";
import { parseXlsxBuffer } from "../content-fetcher.js";

const CACHE_TTL = 86_400;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// In-memory cache for AP Płock GENEA.xlsx buffer so repeated searches are sub-millisecond
let geneaBufferPromise: Promise<Buffer> | null = null;
const GENEA_XLSX_URL = "https://archiwum.plock.ap.gov.pl/wp-content/uploads/2021/03/GENEA.xlsx";

async function getGeneaXlsxBuffer(): Promise<Buffer> {
  if (!geneaBufferPromise) {
    geneaBufferPromise = (async () => {
      const res = await fetch(GENEA_XLSX_URL, {
        headers: { "User-Agent": BROWSER_UA },
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        geneaBufferPromise = null;
        throw new Error(`HTTP ${res.status} podczas pobierania ${GENEA_XLSX_URL}`);
      }
      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    })();
  }
  return geneaBufferPromise;
}

// ─── 1. AP Płock — Baza GENEA (`plock_genea`) ────────────────────────────────

export function registerPlockGeneaTools(server: McpServer, _env: Env): void {
  server.tool(
    "plock_genea_search",
    [
      "Przeszukuje bazę genealogiczną GENEA Archiwum Państwowego w Płocku (146 167 indeksów metrykalnych urodzeń, małżeństw i zgonów z parafii regionu płockiego).",
      "Pobiera i dekompresuje w pamięci arkusz GENEA.xlsx (przez node:zlib) oraz filtruje wiersze według nazwiska, imienia, parafii lub roku.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Nazwisko, imię, nazwa parafii lub rok do wyszukania w bazie GENEA AP Płock."),
      max_rows: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(50)
        .describe("Maksymalna liczba pasujących rekordów do zwrócenia (1–500)."),
    },
    async ({ query, max_rows }) => {
      try {
        const buf = await getGeneaXlsxBuffer();
        const parsed = parseXlsxBuffer(buf, { grep: query, maxRows: max_rows });
        const summary = [
          `Baza GENEA — Archiwum Państwowe w Płocku (${GENEA_XLSX_URL})`,
          `Łącznie rekordów w arkuszu: ${parsed.totalRows} | Pasujących do "${query}": ${parsed.matchedRows}`,
          "",
          parsed.text,
        ].join("\n");
        return { content: [{ type: "text", text: summary }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling plock_genea_search: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

// ─── 2. e-kartoteka Poznań (`ekartoteka`) ────────────────────────────────────

export function registerEkartotekaTools(server: McpServer, env: Env): void {
  server.tool(
    "ekartoteka_search",
    [
      "Wyszukiwanie kart meldunkowych mieszkańców Poznania (XIX–XX w.) w bazie e-kartoteka.net (Archiwum Państwowe w Poznaniu).",
      "Zwraca ustrukturyzowane wpisy zawierające nazwiska, imiona, daty urodzenia oraz bezpośrednie linki do skanów kart meldunkowych w wysokiej rozdzielczości (photos.szukajwarchiwach.gov.pl).",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Nazwisko poszukiwanej osoby w kartotece ewidencji ludności Poznania."),
      search_mode: z
        .enum(["exact", "extended"])
        .default("exact")
        .describe("Tryb wyszukiwania nazwiska: exact (dokładne) lub extended (rozszerzone / oboczne)."),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony wyników (liczony od 1)."),
    },
    async ({ query, search_mode, page }) => {
      try {
        const key = makeCacheKey("ekartoteka_search", { query, search_mode, page });
        const url = `https://e-kartoteka.net/pl/search?page=${page}`;
        const body = new URLSearchParams({
          lastname: query,
          sort: "1",
          search_mode: search_mode === "extended" ? "ext" : "",
        }).toString();
        const rawHtml = await cachedFetch(
          env.CACHE_KV,
          key,
          url,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": BROWSER_UA,
            },
            body,
          },
          CACHE_TTL,
        );
        return { content: [{ type: "text", text: extractCompactHtml(rawHtml) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling ekartoteka_search: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

// ─── 3. Archiwum Powstania Wielkopolskiego (`archiwum_powstania`) ────────────

export function registerArchiwumPowstaniaTools(server: McpServer, env: Env): void {
  server.tool(
    "archiwum_powstania_search",
    [
      "Wyszukiwanie osób (powstańców wielkopolskich) oraz źródeł archiwalnych w bazie Archiwum Powstania Wielkopolskiego (archiwumpowstania.pl).",
      "Zwraca listę dopasowanych biogramów i rekordów wraz z linkami zawierającymi identyfikator oraz token do pobrania szczegółów.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Nazwisko i imię powstańca, miejscowość lub jednostka wojskowa."),
    },
    async ({ query }) => {
      try {
        const key = makeCacheKey("archiwum_powstania_search", { query });
        const body = new URLSearchParams({ phrase: query }).toString();
        const rawHtml = await cachedFetch(
          env.CACHE_KV,
          key,
          "https://archiwumpowstania.pl/pl/search",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": BROWSER_UA,
            },
            body,
          },
          CACHE_TTL,
        );
        return { content: [{ type: "text", text: extractCompactHtml(rawHtml) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling archiwum_powstania_search: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "archiwum_powstania_get_record",
    [
      "Pobiera pełną kartę biogramu powstańca lub rekordu źródłowego z Archiwum Powstania Wielkopolskiego na podstawie ścieżki URL lub identyfikatora.",
    ].join(" "),
    {
      id: z
        .string()
        .min(1)
        .describe(
          "Ścieżka lub URL rekordu z wyników wyszukiwania (np. '/pl/record?type=person&id=1234&token=abcd').",
        ),
    },
    async ({ id }) => {
      try {
        const clean = id.trim();
        const url = clean.startsWith("http")
          ? clean
          : `https://archiwumpowstania.pl${clean.startsWith("/") ? "" : "/"}${clean}`;
        const key = makeCacheKey("archiwum_powstania_get_record", { url });
        const rawHtml = await cachedFetch(
          env.CACHE_KV,
          key,
          url,
          { headers: { "User-Agent": BROWSER_UA } },
          CACHE_TTL,
        );
        return { content: [{ type: "text", text: extractCompactHtml(rawHtml) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling archiwum_powstania_get_record: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

// ─── 4. AP Zamość — Ludność Zamościa (`zamosc_ap`) ───────────────────────────

export function registerZamoscApTools(server: McpServer, env: Env): void {
  server.tool(
    "zamosc_ap_search",
    [
      "Przeszukuje bazę danych 'Ludność Zamościa' prowadzoną przez Archiwum Państwowe w Zamościu (zamosc.ap.gov.pl/ludnosc-zamoscia/) przez interfejs JSON WP Data Access DataTables.",
      "Zwraca nazwiska, imiona, imiona rodziców, daty urodzenia, wyznanie, zawód, adres zamieszkania oraz sygnaturę akt.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Nazwisko, imię lub adres w Zamościu do wyszukania w bazie ludności."),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony wyników (liczony od 1)."),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Liczba rekordów na stronę (1–100)."),
    },
    async ({ query, page, page_size }) => {
      try {
        const key = makeCacheKey("zamosc_ap_search", { query, page, page_size });
        const cached = await env.CACHE_KV.get(key);
        if (cached !== null) {
          return { content: [{ type: "text", text: cached }] };
        }

        // Fetch page once to obtain fresh wpnonce for pubid=1
        const pageRes = await fetch("https://zamosc.ap.gov.pl/ludnosc-zamoscia/", {
          headers: { "User-Agent": BROWSER_UA },
          signal: AbortSignal.timeout(20_000),
        });
        const pageHtml = await pageRes.text();
        const nonceMatch =
          pageHtml.match(/wpnonce["'\s:=]+["']([0-9a-fA-F]{10})["']/) ??
          pageHtml.match(/data-wpnonce=["']([0-9a-fA-F]{10})["']/);
        const wpnonce = nonceMatch?.[1] ?? "";

        const start = (page - 1) * page_size;
        const form = new URLSearchParams({
          action: "wpda_datatables",
          pubid: "1",
          wpnonce,
          draw: "1",
          start: String(start),
          length: String(page_size),
          "search[value]": query,
          "search[regex]": "false",
        });

        const ajaxRes = await fetch("https://zamosc.ap.gov.pl/wp-admin/admin-ajax.php", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": BROWSER_UA,
          },
          body: form.toString(),
          signal: AbortSignal.timeout(30_000),
        });
        const text = await ajaxRes.text();
        env.CACHE_KV.put(key, text, { expirationTtl: CACHE_TTL }).catch(() => {});
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling zamosc_ap_search: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

// ─── 5. Archiwa.gov.pl — Jeńcy (`archiwa_jency`) ─────────────────────────────

export interface JencyRecord {
  id: string;
  nazwisko: string;
  imie: string;
  imie_ojca: string;
  rok_urodzenia: string;
  data_urodzenia: string;
  miejsce_urodzenia: string;
  oboz_lub_jednostka: string;
  archiwum: string;
  url: string;
}

function cleanCellHtml(cell: string): string {
  return decodeHtmlEntities(cell.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseJencyAjaxResponse(rawJson: string): {
  success: boolean;
  message?: string;
  items: JencyRecord[];
} {
  try {
    const parsed = JSON.parse(rawJson) as {
      success?: boolean;
      data?: { html?: string; message?: string };
    };
    const html = parsed?.data?.html ?? "";
    if (!parsed?.success || !html) {
      return {
        success: false,
        message: parsed?.data?.message ?? "Brak wyników.",
        items: [],
      };
    }

    const items: JencyRecord[] = [];
    const rowRe = /<tr\s+data-entry-id="(\d+)"[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html)) !== null) {
      const entryId = m[1];
      const inner = m[2];
      const hrefMatch = inner.match(/href="([^"]+)"/i);
      const cells: string[] = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let td: RegExpExecArray | null;
      while ((td = tdRe.exec(inner)) !== null) {
        cells.push(cleanCellHtml(td[1]));
      }
      items.push({
        id: entryId,
        nazwisko: cells[0] ?? "",
        imie: cells[1] ?? "",
        imie_ojca: cells[2] ?? "",
        rok_urodzenia: cells[3] ?? "",
        data_urodzenia: cells[4] ?? "",
        miejsce_urodzenia: cells[5] ?? "",
        oboz_lub_jednostka: cells[6] ?? "",
        archiwum: cells[7] ?? "",
        url: hrefMatch ? hrefMatch[1] : `https://archiwa.gov.pl/jency-baza-danych/${entryId}/`,
      });
    }
    return { success: true, items };
  } catch {
    return { success: false, message: extractCompactHtml(rawJson), items: [] };
  }
}

async function queryJencyAjax(
  env: Env,
  filters: Record<string, string>,
  page: number,
): Promise<{ success: boolean; message?: string; items: JencyRecord[] }> {
  const params: Record<string, string> = {
    action: "ndap_db_list_ajax",
    db: "wp_jency",
    source: "wp_source",
    pageno: String(page),
    orderby: "namepl",
    sort: "asc",
    ...filters,
  };
  const key = makeCacheKey("archiwa_jency_ajax_v2", params);
  const body = new URLSearchParams(params).toString();
  const rawJson = await cachedFetch(
    env.CACHE_KV,
    key,
    "https://archiwa.gov.pl/wp-admin/admin-ajax.php",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": BROWSER_UA,
      },
      body,
    },
    CACHE_TTL,
  );
  return parseJencyAjaxResponse(rawJson);
}

export function registerArchiwaJencyTools(server: McpServer, env: Env): void {
  server.tool(
    "archiwa_jency_search",
    [
      "Wyszukiwanie w bazie danych Jeńców Wojennych na portalu Archiwów Państwowych (archiwa.gov.pl/jency-baza-danych/).",
      "Zwraca ustrukturyzowaną listę rekordów wraz z numerycznym identyfikatorem `id` (np. '4898' dla Jana Piotra Kowalskiego) do użycia w archiwa_jency_get_record, imieniem, nazwiskiem, imieniem ojca, datą i miejscem urodzenia oraz sygnaturą archiwum.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Nazwisko, imię i nazwisko lub nazwa obozu jenieckiego do wyszukania w bazie jeńców."),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony wyników (liczony od 1)."),
    },
    async ({ query, page }) => {
      try {
        const trimmed = query.trim();
        let res = await queryJencyAjax(env, { "filters[namepl]": trimmed }, page);

        // If multi-word query (e.g. "Jan Kowalski" or "Jan Piotr Kowalski") returned 0 results on surname alone,
        // split into surname and given name candidates.
        if (res.items.length === 0 && /\s+/.test(trimmed)) {
          const tokens = trimmed.split(/\s+/).filter(Boolean);
          const last = tokens[tokens.length - 1];
          const first = tokens.slice(0, -1).join(" ");
          res = await queryJencyAjax(
            env,
            { "filters[namepl]": last, "filters[firstnamepl]": first },
            page,
          );
          if (res.items.length === 0) {
            res = await queryJencyAjax(
              env,
              { "filters[namepl]": tokens[0], "filters[firstnamepl]": tokens.slice(1).join(" ") },
              page,
            );
          }
        }

        // Also fallback to birthplace / camp search if surname returned 0 results
        if (res.items.length === 0) {
          res = await queryJencyAjax(env, { "filters[birthplacepl]": trimmed }, page);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query: trimmed,
                  page,
                  count: res.items.length,
                  items: res.items,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling archiwa_jency_search: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "archiwa_jency_get_record",
    [
      "Pobiera szczegóły pojedynczego rekordu z bazy Jeńców Wojennych na podstawie numerycznego identyfikatora `id` (np. '4898') zwróconego przez archiwa_jency_search.",
    ].join(" "),
    {
      id: z
        .string()
        .min(1)
        .describe("Identyfikator liczbowy rekordu w bazie jeńców (np. '4898')."),
    },
    async ({ id }) => {
      try {
        const cleanId = id.trim().replace(/\D+/g, "") || id.trim();
        const ajaxRes = await queryJencyAjax(env, { "filters[id]": cleanId }, 1);
        const exact = ajaxRes.items.find((item) => item.id === cleanId) ?? ajaxRes.items[0] ?? null;

        // Also attempt direct card fetch in case Imperva allows it and additional fields exist
        let cardDetails: string | undefined;
        try {
          const url = `https://archiwa.gov.pl/jency-baza-danych/${encodeURIComponent(cleanId)}/`;
          const rawHtml = await cachedFetch(
            env.CACHE_KV,
            makeCacheKey("archiwa_jency_get_record_html_v2", { id: cleanId }),
            url,
            {
              method: "POST",
              headers: { "User-Agent": BROWSER_UA },
            },
            CACHE_TTL,
          );
          if (!rawHtml.includes("_Incapsula_Resource")) {
            cardDetails = extractCompactHtml(rawHtml);
          }
        } catch {
          // Ignore direct page errors when AJAX succeeded
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: cleanId,
                  record: exact,
                  related_matches: ajaxRes.items.length > 1 ? ajaxRes.items.slice(0, 5) : undefined,
                  card_details: cardDetails,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling archiwa_jency_get_record: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

// ─── 6. Archiwa.gov.pl — Dziedzictwo (`archiwa_dziedzictwo`) ─────────────────

export interface DziedzictwoRecord {
  id: string;
  title: string;
  inventory: string;
  url: string;
}

export function parseDziedzictwoAjaxResponse(rawJson: string): {
  success: boolean;
  message?: string;
  items: DziedzictwoRecord[];
} {
  try {
    const parsed = JSON.parse(rawJson) as {
      success?: boolean;
      data?: { html?: string; message?: string };
    };
    const html = parsed?.data?.html ?? "";
    if (!parsed?.success || !html) {
      return {
        success: false,
        message: parsed?.data?.message ?? "Brak wyników.",
        items: [],
      };
    }

    const items: DziedzictwoRecord[] = [];
    const rowRe = /<tr\s+data-href="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html)) !== null) {
      const href = m[1];
      const inner = m[2];
      const idMatch = href.match(/\/ndap-entry\/(\d+)\//i);
      const entryId = idMatch ? idMatch[1] : href;
      const cells: string[] = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let td: RegExpExecArray | null;
      while ((td = tdRe.exec(inner)) !== null) {
        cells.push(cleanCellHtml(td[1]));
      }
      items.push({
        id: entryId,
        title: cells[0] ?? "",
        inventory: cells[1] ?? "",
        url: href,
      });
    }
    return { success: true, items };
  } catch {
    return { success: false, message: extractCompactHtml(rawJson), items: [] };
  }
}

export function buildPolishArchiveStemCandidates(query: string): string[] {
  const q = query.trim();
  const candidates: string[] = [q];
  const add = (s: string) => {
    const clean = s.trim();
    if (clean.length >= 3 && !candidates.includes(clean)) {
      candidates.push(clean);
    }
  };

  // Known historical place-name inflections in archival fond titles ("w Warszawie", "w Wilnie", "we Lwowie", etc.)
  const lower = q.toLowerCase();
  if (lower === "warszawa" || lower === "warszawie") {
    add("Warszaw");
    add("Warszawie");
    add("warszawsk");
  } else if (lower === "wilno" || lower === "wilnie") {
    add("Wiln");
    add("Wilnie");
    add("wileńsk");
  } else if (lower === "lwów" || lower === "lwow" || lower === "lwowie") {
    add("Lwowie");
    add("Lwow");
    add("lwowsk");
  } else if (lower === "kraków" || lower === "krakow" || lower === "krakowie") {
    add("Krakow");
    add("Krakowie");
    add("krakowsk");
  } else if (lower === "poznań" || lower === "poznan" || lower === "poznaniu") {
    add("Poznan");
    add("Poznaniu");
    add("poznańsk");
  } else if (lower === "gdańsk" || lower === "gdansk" || lower === "gdańsku") {
    add("Gdańsk");
    add("gdansk");
  } else if (lower === "ukraina" || lower === "ukrainie") {
    add("Ukrain");
    add("ukraińsk");
  } else if (lower === "litwa" || lower === "litwie") {
    add("Litw");
    add("litewsk");
  } else if (lower === "białoruś" || lower === "bialorus" || lower === "białorusi") {
    add("Białoru");
    add("białorusk");
  }

  // Generic Polish morphological stem stripping for nominative/locative/genitive endings
  const stripped = q.replace(/(?:owie|ach|ami|iem|em|ie|om|ów|ow|y|i|a|o|ę|e|u)$/i, "");
  if (stripped.length >= 4) {
    add(stripped);
    // Handle ó -> o alternation in stem (e.g. Lwów -> Lwow, Kraków -> Krakow, Stanisławów -> Stanisławow)
    if (stripped.includes("ó") || stripped.includes("Ó")) {
      add(stripped.replace(/ó/g, "o").replace(/Ó/g, "O"));
    }
  }

  return candidates;
}

async function queryDziedzictwoAjax(
  env: Env,
  fields: Record<string, string>,
  page: number,
): Promise<{ success: boolean; message?: string; items: DziedzictwoRecord[] }> {
  const params: Record<string, string> = {
    action: "ndap_db_filter",
    db: "wp_dziedzictwo",
    pageno: String(page),
    ...fields,
  };
  const key = makeCacheKey("archiwa_dziedzictwo_ajax_v2", params);
  const body = new URLSearchParams(params).toString();
  const rawJson = await cachedFetch(
    env.CACHE_KV,
    key,
    "https://archiwa.gov.pl/wp-admin/admin-ajax.php",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": BROWSER_UA,
      },
      body,
    },
    CACHE_TTL,
  );
  return parseDziedzictwoAjaxResponse(rawJson);
}

export function registerArchiwaDziedzictwoTools(server: McpServer, env: Env): void {
  server.tool(
    "archiwa_dziedzictwo_search",
    [
      "Wyszukiwanie w bazie danych 'Dziedzictwo' (polonika i materiały archiwalne dotyczące historii Polski przechowywane w instytucjach zagranicznych i krajowych) na portalu Archiwów Państwowych (archiwa.gov.pl/dziedzictwo-baza-danych/).",
      "Automatycznie uwzględnia odmianę fleksyjną polskich nazw własnych w tytułach zespołów (np. 'Warszawa' -> 'w Warszawie' / 'Warszaw'). Zwraca ustrukturyzowaną listę rekordów wraz z numerycznym `id` do użycia w archiwa_dziedzictwo_get_record.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Tytuł zespołu, nazwa instytucji, hasło geograficzne (np. Warszawa, Wilno, Lwów) lub osobowe."),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony wyników (liczony od 1)."),
    },
    async ({ query, page }) => {
      try {
        const candidates = buildPolishArchiveStemCandidates(query);
        let matchedCandidate = candidates[0];
        let res = { success: false, items: [] as DziedzictwoRecord[] };

        for (const candidate of candidates) {
          const attempt = await queryDziedzictwoAjax(env, { "fields[titlepl]": candidate }, page);
          if (attempt.items.length > 0) {
            res = attempt;
            matchedCandidate = candidate;
            break;
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query,
                  matched_stem: matchedCandidate,
                  page,
                  count: res.items.length,
                  items: res.items,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling archiwa_dziedzictwo_search: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "archiwa_dziedzictwo_get_record",
    [
      "Pobiera szczegółową kartę wpisu z bazy Dziedzictwo (archiwa.gov.pl/ndap-entry/{id}/?db=wp_dziedzictwo) na podstawie identyfikatora `id` zwróconego przez archiwa_dziedzictwo_search.",
    ].join(" "),
    {
      id: z
        .string()
        .min(1)
        .describe("Identyfikator liczbowy wpisu w bazie Dziedzictwo (np. '25')."),
    },
    async ({ id }) => {
      try {
        const cleanId = id.trim().replace(/\D+/g, "") || id.trim();
        const ajaxRes = await queryDziedzictwoAjax(env, { "fields[id]": cleanId }, 1);
        const exact = ajaxRes.items.find((item) => item.id === cleanId) ?? ajaxRes.items[0] ?? null;

        let cardDetails: string | undefined;
        try {
          const url = `https://archiwa.gov.pl/ndap-entry/${encodeURIComponent(cleanId)}/?db=wp_dziedzictwo`;
          const rawHtml = await cachedFetch(
            env.CACHE_KV,
            makeCacheKey("archiwa_dziedzictwo_get_record_html_v2", { id: cleanId }),
            url,
            {
              method: "POST",
              headers: { "User-Agent": BROWSER_UA },
            },
            CACHE_TTL,
          );
          if (!rawHtml.includes("_Incapsula_Resource")) {
            cardDetails = extractCompactHtml(rawHtml);
          }
        } catch {
          // Ignore direct page errors when AJAX succeeded
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: cleanId,
                  record: exact,
                  card_details: cardDetails,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling archiwa_dziedzictwo_get_record: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

// ─── 7. Straty.pl — IPN (`straty`) ───────────────────────────────────────────

export function registerStratyTools(server: McpServer, env: Env): void {
  server.tool(
    "straty_search",
    [
      "Wyszukiwanie ofiar i osób represjonowanych pod okupacją niemiecką w latach 1939–1945 w bazie 'Straty osobowe i ofiary represji' (straty.pl — Instytut Pamięci Narodowej).",
      "Zwraca tabelę dopasowanych osób wraz z identyfikatorami (np. id123456), których można użyć w straty_get_person.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Nazwisko poszukiwanej osoby (lub 'Nazwisko Imię')."),
      imie: z
        .string()
        .optional()
        .describe("Opcjonalne imię poszukiwanej osoby."),
      rok_urodzenia: z
        .string()
        .optional()
        .describe("Opcjonalny rok urodzenia (np. 1910)."),
      miejsce_urodzenia: z
        .string()
        .optional()
        .describe("Opcjonalna nazwa miejscowości urodzenia poszukiwanej osoby."),
    },
    async ({ query, imie, rok_urodzenia, miejsce_urodzenia }) => {
      try {
        const parts = query.trim().split(/\s+/);
        const nazwisko = parts[0] ?? query.trim();
        const resolvedImie = imie ?? (parts.length > 1 ? parts.slice(1).join(" ") : "");
        const key = makeCacheKey("straty_search", {
          nazwisko,
          imie: resolvedImie,
          rok_urodzenia,
          miejsce_urodzenia,
        });
        const body = new URLSearchParams({
          nazwisko,
          imie: resolvedImie,
          imie_ojca: "",
          ur_rok: rok_urodzenia ?? "",
          ur_miejsce: miejsce_urodzenia ?? "",
          zam_miejsce: "",
          szukaj: "Szukaj",
        }).toString();
        const rawHtml = await cachedFetch(
          env.CACHE_KV,
          key,
          "https://straty.pl/szukaj-osoby.php",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": BROWSER_UA,
            },
            body,
          },
          CACHE_TTL,
        );
        return { content: [{ type: "text", text: extractCompactHtml(rawHtml) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error calling straty_search: ${msg}` }], isError: true };
      }
    },
  );

  server.tool(
    "straty_get_person",
    [
      "Pobiera pełną ankietę personalną ofiary/osoby represjonowanej z bazy straty.pl (IPN) wraz z przebiegiem represji i źródłami archiwalnymi.",
    ].join(" "),
    {
      id: z
        .string()
        .min(1)
        .describe("Identyfikator osoby z wyników straty_search (np. 'id123456' lub sam numer '123456')."),
    },
    async ({ id }) => {
      try {
        const numericId = id.trim().replace(/^id/i, "");
        const fieldName = `id${numericId}`;
        const key = makeCacheKey("straty_get_person", { id: numericId });
        const body = new URLSearchParams({ [fieldName]: "1" }).toString();
        const rawHtml = await cachedFetch(
          env.CACHE_KV,
          key,
          "https://straty.pl/szukaj-osoby.php",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": BROWSER_UA,
            },
            body,
          },
          CACHE_TTL,
        );
        return { content: [{ type: "text", text: extractCompactHtml(rawHtml) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling straty_get_person: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

// ─── 8. AP Opole — Baza danych (`opole_ap`) ──────────────────────────────────

export function registerOpoleApTools(server: McpServer, env: Env): void {
  server.tool(
    "opole_ap_search",
    [
      "Przeszukuje bazę danych Archiwum Państwowego w Opolu (baza.opole.ap.gov.pl — tzw. Lista Żydowska i ewidencja archiwalna z terenu Śląska Opolskiego).",
      "Zwraca tabelę zawierającą nazwisko, imię, nazwisko panieńskie, datę i miejsce urodzenia, adres zamieszkania, wyznanie oraz sygnaturę archiwalną.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Nazwisko, imię, miejscowość lub sygnatura do wyszukania w bazie AP Opole."),
    },
    async ({ query }) => {
      try {
        const key = makeCacheKey("opole_ap_search", { query });
        const url = `https://baza.opole.ap.gov.pl/?q=${encodeURIComponent(query)}`;
        const rawHtml = await cachedFetch(
          env.CACHE_KV,
          key,
          url,
          { headers: { "User-Agent": BROWSER_UA } },
          CACHE_TTL,
        );
        return { content: [{ type: "text", text: extractCompactHtml(rawHtml) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling opole_ap_search: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

// ─── 9. AP Piotrków Trybunalski — Indeksy (`piotrkow_ap`) ────────────────────

export function registerPiotrkowApTools(server: McpServer, env: Env): void {
  server.tool(
    "piotrkow_ap_search",
    [
      "Przeszukuje katalog indeksów archiwalnych i inwentarzy Archiwum Państwowego w Piotrkowie Trybunalskim (piotrkow-tryb.ap.gov.pl/p,77,indeksy) oraz wyszukiwarkę serwisu.",
      "Zwraca listę dostępnych wykazów i indeksów PDF (do bezpośredniego pobrania i przeszukania pełnotekstowego przez get_record z parametrem url i grep).",
    ].join(" "),
    {
      query: z
        .string()
        .optional()
        .describe("Opcjonalna fraza filtrująca wykaz indeksów lub wyszukiwana na stronie AP Piotrków Trybunalski."),
    },
    async ({ query }) => {
      try {
        const key = makeCacheKey("piotrkow_ap_search", { query: query ?? "" });
        const indexUrl = "https://www.piotrkow-tryb.ap.gov.pl/p,77,indeksy";
        const rawHtml = await cachedFetch(
          env.CACHE_KV,
          key,
          indexUrl,
          { headers: { "User-Agent": BROWSER_UA } },
          CACHE_TTL,
        );
        const normalizedHtml = rawHtml.replace(
          /href=["'](index\.php\?c=getfile&(?:amp;)?id=\d+)["']/gi,
          'href="https://www.piotrkow-tryb.ap.gov.pl/$1"',
        );
        let text = extractCompactHtml(normalizedHtml);
        if (query && query.trim().length > 0) {
          const qLower = query.trim().toLowerCase();
          const filtered = text
            .split("\n")
            .filter((line) => line.toLowerCase().includes(qLower) || line.includes("getfile"));
          if (filtered.length > 0) {
            text = filtered.join("\n");
          }
        }
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling piotrkow_ap_search: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
