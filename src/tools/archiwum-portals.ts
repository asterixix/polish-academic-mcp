import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { extractCompactHtml } from "../extract.js";

const SWA_BASE = "https://www.szukajwarchiwach.gov.pl";
const GWA_BASE = "https://www.genealogiawarchiwach.pl";
const CACHE_TTL = 86_400;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function registerSzukajWArchiwachTools(server: McpServer, env: Env): void {
  server.tool(
    "swa_search",
    [
      "Wyszukiwanie zespołów archiwalnych, serii i jednostek w ogólnopolskim portalu Szukaj w Archiwach (szukajwarchiwach.gov.pl).",
      "Wykorzystuje zasób Liferay searchContentAuto z parametrem macierzowym ;a=1.xml omijającym zaporę Imperva Incapsula i zwracającym dane JSON.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe(
          "Fraza wyszukiwania (nazwa zespołu, miejscowość, nazwisko, sygnatura, temat, np. 'Akta stanu cywilnego Warszawa').",
        ),
    },
    async ({ query }) => {
      try {
        const key = makeCacheKey("swa_search", { query });
        const qs = new URLSearchParams({
          p_p_id: "Wyszukiwarka",
          p_p_lifecycle: "2",
          p_p_state: "normal",
          p_p_mode: "view",
          p_p_resource_id: "searchContentAuto",
          p_p_cacheability: "cacheLevelPage",
          _Wyszukiwarka_q: query,
        });
        const url = `${SWA_BASE}/pl/wyszukiwarka;a=1.xml?${qs}`;
        const body = new URLSearchParams({ _Wyszukiwarka_searchKey: query }).toString();
        const text = await cachedFetch(
          env.CACHE_KV,
          key,
          url,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              Accept: "application/json, text/javascript, */*; q=0.01",
              "X-Requested-With": "XMLHttpRequest",
              "User-Agent": BROWSER_UA,
            },
            body,
          },
          CACHE_TTL,
        );
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error calling swa_search: ${msg}` }], isError: true };
      }
    },
  );

  server.tool(
    "swa_get_unit",
    [
      "Pobiera szczegółową kartę zespołu archiwalnego (zespol), serii (seria) lub jednostki archiwalnej (jednostka) z portalu Szukaj w Archiwach wraz z linkami do skanów cyfrowych.",
    ].join(" "),
    {
      id: z
        .string()
        .min(1)
        .describe("Identyfikator liczbowy jednostki, serii lub zespołu w Szukaj w Archiwach (np. 17756054)."),
      kind: z
        .enum(["jednostka", "zespol", "seria"])
        .default("jednostka")
        .describe("Typ obiektu archiwalnego: jednostka (domyślnie), zespol lub seria."),
    },
    async ({ id, kind }) => {
      try {
        const cleanId = id.trim();
        const key = makeCacheKey("swa_get_unit", { id: cleanId, kind });
        const url = `${SWA_BASE}/pl/${kind}/-/${kind}/${encodeURIComponent(cleanId)};a=1.xml`;
        const rawHtml = await cachedFetch(
          env.CACHE_KV,
          key,
          url,
          {
            headers: {
              Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
              "User-Agent": BROWSER_UA,
            },
          },
          CACHE_TTL,
        );
        const text = extractCompactHtml(rawHtml);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error calling swa_get_unit: ${msg}` }], isError: true };
      }
    },
  );
}

export function registerGenealogiaWArchiwachTools(server: McpServer, env: Env): void {
  server.tool(
    "gwa_search",
    [
      "Wyszukiwanie indeksów genealogicznych, osób i ksiąg metrykalnych w portalu Genealogia w Archiwach (genealogiawarchiwach.pl — Archiwa Państwowe w Toruniu, Bydgoszczy, Włocławku i inne).",
      "Realizuje dwuetapową inicjalizację sesji Vaadin 7 i wyciąga ustrukturyzowane rekordy z drzewa stanu UIDL.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Nazwisko osoby, nazwa miejscowości lub parafii do wyszukania w bazie Genealogia w Archiwach."),
      query_type: z
        .enum(["ALL", "PERSON", "INDEX", "ARCHIVE_UNIT"])
        .default("ALL")
        .describe("Zakres wyszukiwania: ALL (wszystko), PERSON (osoby), INDEX (indeksy), ARCHIVE_UNIT (jednostki)."),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony wyników (liczony od 1)."),
    },
    async ({ query, query_type, page }) => {
      try {
        const key = makeCacheKey("gwa_search", { query, query_type, page });
        const cached = await env.CACHE_KV.get(key);
        if (cached !== null) {
          return { content: [{ type: "text", text: cached }] };
        }

        // Step 1: Bootstrap session cookie (VSESSIONID)
        const initRes = await fetch(`${GWA_BASE}/`, {
          headers: { "User-Agent": BROWSER_UA },
          signal: AbortSignal.timeout(20_000),
        });
        const setCookie = initRes.headers.get("set-cookie") ?? "";
        const cookiePair = setCookie.split(";")[0] ?? "";

        // Step 2: Vaadin browserDetails POST with hash fragment query
        const hashLoc = `${GWA_BASE}/#!home/search?query.type=${query_type}&query.query=${encodeURIComponent(query)}&query.page=${page}&query.Meaning=true`;
        const qs = new URLSearchParams({
          "v-browserDetails": "1",
          theme: "mytheme",
          "v-appId": "ROOT-2521314",
          "v-sh": "1080",
          "v-sw": "1920",
          "v-cw": "1920",
          "v-ch": "1080",
          "v-curdate": String(Date.now()),
          "v-tzo": "-60",
          "v-dstd": "60",
          "v-rtzo": "-60",
          "v-dston": "true",
          "v-vw": "1920",
          "v-vh": "1080",
          "v-loc": hashLoc,
          "v-wn": "ROOT-2521314-0.123456",
        });

        const uidlRes = await fetch(`${GWA_BASE}/?${qs}`, {
          method: "POST",
          headers: {
            "User-Agent": BROWSER_UA,
            ...(cookiePair ? { Cookie: cookiePair } : {}),
          },
          signal: AbortSignal.timeout(30_000),
        });

        const rawJson = await uidlRes.text();
        let formatted = rawJson;
        try {
          const outer = JSON.parse(rawJson) as { uidl?: string };
          if (outer.uidl) {
            const uidlObj = JSON.parse(outer.uidl) as {
              state?: Record<string, { templateName?: string; templateContents?: string; text?: string }>;
            };
            const results: string[] = [];
            for (const node of Object.values(uidlObj.state ?? {})) {
              if (node.templateContents) {
                results.push(extractCompactHtml(node.templateContents));
              } else if (node.text && node.text.length > 20) {
                results.push(node.text);
              }
            }
            if (results.length > 0) {
              formatted = results.join("\n---\n");
            }
          }
        } catch {
          // Keep raw response if UIDL structure varies
        }

        env.CACHE_KV.put(key, formatted, { expirationTtl: CACHE_TTL }).catch(() => {});
        return { content: [{ type: "text", text: formatted }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error calling gwa_search: ${msg}` }], isError: true };
      }
    },
  );
}
