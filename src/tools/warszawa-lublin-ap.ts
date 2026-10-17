import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { extractCompactHtml } from "../extract.js";

const CACHE_TTL = 86_400;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const WARSZAWA_DBS = {
  all: "Wszystkie 5 wyszukiwarek AP Warszawa równolegle",
  ekshumacje: "Protokoły ekshumacji w Warszawie z lat 1945–1947",
  rha: "Rejestr Handlowy Sądu Okręgowego w Warszawie (spółki, firmy, właściciele)",
  grodzisk: "Indeksy metrykalne — oddział w Grodzisku Mazowieckim",
  "lowicz-m": "Księgi ludności i akta miejskie — oddział w Łowiczu",
  pultusk: "Indeksy metrykalne — oddział w Pułtusku",
} as const;

type WarszawaDbKey = Exclude<keyof typeof WARSZAWA_DBS, "all">;

async function searchSingleWarszawaDb(
  env: Env,
  db: WarszawaDbKey,
  query: string,
  imie?: string,
  kryterium: "firma" | "wlasciciel" | "adres" = "wlasciciel",
): Promise<string> {
  const key = makeCacheKey(`warszawa_ap_${db}`, { query, imie: imie ?? "", kryterium });
  const url = `https://www.warszawa.ap.gov.pl/wyszukiwarki/${db}/search.php`;

  let form: URLSearchParams;
  if (db === "rha") {
    form = new URLSearchParams({
      phrase: query,
      kryterium,
      submit: "Szukaj!",
    });
  } else if (db === "grodzisk" || db === "pultusk") {
    form = new URLSearchParams({
      phrase: query,
      imie: imie ?? "",
      u: "u",
      m: "m",
      z: "z",
      data1: "",
      data2: "",
      miasto: "",
      wszystko: "wszystko",
      submit: "Szukaj!",
    });
  } else {
    form = new URLSearchParams({
      phrase: query,
      submit: "Szukaj!",
    });
  }

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
      body: form.toString(),
    },
    CACHE_TTL,
  );

  return extractCompactHtml(rawHtml);
}

export function registerWarszawaApTools(server: McpServer, env: Env): void {
  server.tool(
    "warszawa_ap_search",
    [
      "Przeszukuje wyszukiwarki genealogiczne i historyczne Archiwum Państwowego w Warszawie (warszawa.ap.gov.pl):",
      "ekshumacje (protokoły ekshumacji z lat 1945–1947), rha (Rejestr Handlowy — firmy, właściciele, adresy), grodzisk (indeksy metrykalne Grodzisk Maz.), lowicz-m (księgi ludności Łowicz) oraz pultusk (indeksy metrykalne Pułtusk).",
      "Domyślnie (database='all') odpytuje równolegle wszystkie 5 baz.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Nazwisko osoby, nazwa firmy, ulica lub miejscowość do wyszukania."),
      database: z
        .enum(["all", "ekshumacje", "rha", "grodzisk", "lowicz-m", "pultusk"])
        .default("all")
        .describe(
          "Baza AP Warszawa do przeszukania: all (wszystkie 5 baz równolegle), ekshumacje, rha, grodzisk, lowicz-m lub pultusk.",
        ),
      imie: z
        .string()
        .optional()
        .describe("Opcjonalne imię (wykorzystywane w bazach metrykalnych grodzisk i pultusk)."),
      kryterium_rha: z
        .enum(["wlasciciel", "firma", "adres"])
        .default("wlasciciel")
        .describe("Kryterium wyszukiwania w Rejestrze Handlowym (rha): wlasciciel, firma lub adres."),
    },
    async ({ query, database, imie, kryterium_rha }) => {
      try {
        const dbs: WarszawaDbKey[] =
          database === "all"
            ? ["ekshumacje", "rha", "grodzisk", "lowicz-m", "pultusk"]
            : [database];

        const settled = await Promise.allSettled(
          dbs.map(async (db) => ({
            db,
            label: WARSZAWA_DBS[db],
            text: await searchSingleWarszawaDb(env, db, query, imie, kryterium_rha),
          })),
        );

        const sections: string[] = [];
        for (const item of settled) {
          if (item.status === "fulfilled") {
            sections.push(
              `=== [AP Warszawa: ${item.value.db}] ${item.value.label} ===\n${item.value.text.slice(0, 4500)}`,
            );
          } else {
            const msg = item.reason instanceof Error ? item.reason.message : String(item.reason);
            sections.push(`=== [AP Warszawa] Błąd ===\n${msg}`);
          }
        }
        return { content: [{ type: "text", text: sections.join("\n\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling warszawa_ap_search: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

const LUBLIN_CITIES = {
  all: "Wszystkie księgi meldunkowe AP Lublin (Lublin, Kock, Radzyń Podlaski, Chełm, Międzyrzec)",
  lublin: "Księgi meldunkowe miasta Lublina",
  kock: "Księgi meldunkowe miasta Kocka",
  radzyn: "Księgi meldunkowe miasta Radzynia Podlaskiego",
  chelm: "Księgi meldunkowe miasta Chełma",
  miedzyrzec: "Księgi meldunkowe miasta Międzyrzeca Podlaskiego",
} as const;

type LublinCityKey = Exclude<keyof typeof LUBLIN_CITIES, "all">;

async function searchSingleLublinCity(
  env: Env,
  city: LublinCityKey,
  query: string,
  imie?: string,
  page = 1,
  pageSize = 25,
): Promise<string> {
  const key = makeCacheKey(`lublin_ap_${city}`, { query, imie: imie ?? "", page, pageSize });
  let qFilter = `(nazwisko~contains~${query.trim()})`;
  if (imie && imie.trim().length > 0) {
    qFilter += `(imie~contains~${imie.trim()})`;
  }
  const qs = new URLSearchParams({
    q: qFilter,
    goto: String(page),
    pagesize: String(pageSize),
    orderby: "anazwisko",
  });
  const url = `https://lublin.ap.gov.pl/ksiazkimeldunkowe/${city}_nazwiska_list.php?${qs}`;
  const rawHtml = await cachedFetch(
    env.CACHE_KV,
    key,
    url,
    { headers: { "User-Agent": BROWSER_UA } },
    CACHE_TTL,
  );
  return extractCompactHtml(rawHtml);
}

export function registerLublinApTools(server: McpServer, env: Env): void {
  server.tool(
    "lublin_ap_search",
    [
      "Przeszukuje bazę Ksiąg Meldunkowych Archiwum Państwowego w Lublinie (lublin.ap.gov.pl/ksiazkimeldunkowe/) obejmującą stałych i niestałych mieszkańców miast: Lublin, Kock, Radzyń Podlaski, Chełm oraz Międzyrzec Podlaski.",
      "Zwraca nazwiska, imiona, imiona rodziców, wyznanie, zawód, adres domu, sygnaturę księgi i strony.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Nazwisko poszukiwanej osoby w księgach meldunkowych."),
      city: z
        .enum(["all", "lublin", "kock", "radzyn", "chelm", "miedzyrzec"])
        .default("all")
        .describe(
          "Miasto do przeszukania: all (Lublin, Kock i Radzyń równolegle), lublin, kock, radzyn, chelm lub miedzyrzec.",
        ),
      imie: z
        .string()
        .optional()
        .describe("Opcjonalne imię poszukiwanej osoby."),
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
        .default(25)
        .describe("Liczba rekordów na stronę (1–100)."),
    },
    async ({ query, city, imie, page, page_size }) => {
      try {
        const cities: LublinCityKey[] =
          city === "all" ? ["lublin", "kock", "radzyn"] : [city];

        const settled = await Promise.allSettled(
          cities.map(async (c) => ({
            city: c,
            label: LUBLIN_CITIES[c],
            text: await searchSingleLublinCity(env, c, query, imie, page, page_size),
          })),
        );

        const sections: string[] = [];
        for (const item of settled) {
          if (item.status === "fulfilled") {
            sections.push(
              `=== [AP Lublin: ${item.value.city}] ${item.value.label} ===\n${item.value.text.slice(0, 5000)}`,
            );
          } else {
            const msg = item.reason instanceof Error ? item.reason.message : String(item.reason);
            sections.push(`=== [AP Lublin] Błąd ===\n${msg}`);
          }
        }
        return { content: [{ type: "text", text: sections.join("\n\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error calling lublin_ap_search: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
