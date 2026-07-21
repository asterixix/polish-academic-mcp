import { toToolErrorText } from "../tool-error-handling.js";
/**
 * Dokumenty Śląska — https://www.dokumentyslaska.pl/
 * Edycja Wiesława Długosza: dokumenty, regesty, heraldyka, materiały ikonograficzne (Śląsk).
 *
 * Brak publicznego API REST ani wyszukiwarki pełnotekstowej: statyczny serwis HTML (Pajaczek),
 * nawigacja przez ramki i pliki indeksów (`indeks …`) oraz treści (`dokument …`). Nie ma sensu
 * udawać „search” po całej domenie z Workera bez indeksu zewnętrznego.
 *
 * Tools:
 *   dokumenty_slaska_get_page — pobiera jeden plik HTML (lub inny zasób tekstowy) po ścieżce względnej.
 *   dokumenty_slaska_medieval_catalog — stała lista ścieżek do głównej serii dokumentów do 1333 r.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const SITE_ORIGIN = "https://www.dokumentyslaska.pl";

const HTML_HEADERS: HeadersInit = {
  Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
  "Accept-Language": "pl,de;q=0.8,en;q=0.6",
};

const CACHE_TTL = 86_400;

/** Główna seria „Dokumenty” z menu strony głównej (ścieżki względne katalogu serwisu). */
const MEDIEVAL_CATALOG: { label: string; indeks: string; dokument: string }[] = [
  { label: "Do 1200 roku", indeks: "indeks 1200.html", dokument: "dokument 1200.html" },
  { label: "1201–1230", indeks: "indeks 1201-1230.html", dokument: "dokument 1201-1230.html" },
  { label: "1231–1250", indeks: "indeks 1231-1250.html", dokument: "dokument 1231-1250.html" },
  { label: "1251–1266", indeks: "indeks 1251-1266.html", dokument: "dokument 1251-1266.html" },
  { label: "1267–1281", indeks: "indeks 1267-1281.html", dokument: "dokument 1267-1281.html" },
  { label: "1282–1290", indeks: "indeks 1282-1290.html", dokument: "dokument 1282-1290.html" },
  { label: "1291–1300", indeks: "indeks 1291-1300.html", dokument: "dokument 1291-1300.html" },
  { label: "1301–1315", indeks: "indeks 1301-1315.html", dokument: "dokument 1301-1315.html" },
  { label: "1316–1326", indeks: "indeks 1316-1326.html", dokument: "dokument 1316-1326.html" },
  { label: "1327–1333", indeks: "indeks 1327-1333.html", dokument: "dokument 1327-1333.html" },
];

/**
 * Buduje bezpieczny URL pod domenę dokumentyslaska.pl — tylko ścieżka względna, segment po segmencie.
 */
function toSafeSiteUrl(relPath: string): string {
  const t = relPath.trim().replace(/^\/+/, "");
  if (!t || t.length > 512) {
    throw new Error("path must be non-empty and at most 512 characters");
  }
  if (/^https?:\/\//i.test(t) || t.startsWith("//")) {
    throw new Error("only relative paths under the site are allowed");
  }
  if (t.includes("..")) {
    throw new Error("path must not contain ..");
  }
  const parts = t.split("/");
  for (const p of parts) {
    if (p === "" || p === "." || p === "..") {
      throw new Error("invalid path segment");
    }
  }
  const encoded = parts
    .map((seg) => {
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch {
        return encodeURIComponent(seg);
      }
    })
    .join("/");
  return `${SITE_ORIGIN}/${encoded}`;
}

export function registerDokumentySlaskaTools(server: McpServer, env: Env): void {
  server.tool(
    "dokumenty_slaska_get_page",
    [
      "Pobiera pojedynczą stronę ze statycznego serwisu Dokumenty Śląska (średniowieczne dokumenty śląskie, regesty, pieczęcie, ikonografia).",
      "Brak publicznego API wyszukiwania — treści są statyczne w HTML; użyj indeks*.html dla spisów treści oraz dokument*.html dla pełnych wydań, gdy dostarcza je menu.",
      "Przekaż ścieżkę względną, na przykład \"indeks 1200.html\", \"kamenz/index.html\" lub \"bibliografia.html\". Spacje w nazwach plików są dozwolone.",
      "Zwraca surowy HTML (iso-8859-2 na większości stron). Podążaj za odnośnikami z odpowiedzi, by pobrać dalsze strony.",
    ].join(" "),
    {
      path: z
        .string()
        .min(1)
        .describe(
          "Ścieżka względna od katalogu głównego serwisu, np. indeks 1200.html, dokument 1201-1230.html, bibliografia.html, kamenz/index.html",
        ),
    },
    async ({ path: relPath }) => {
      return (async () => {
        try {
          const url = toSafeSiteUrl(relPath);
          const cacheKey = makeCacheKey("dokumenty_slaska_get_page", { path: relPath });
          const text = await cachedFetch(
            env.CACHE_KV,
            cacheKey,
            url,
            { headers: HTML_HEADERS },
            CACHE_TTL,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const msg = toToolErrorText(err);
          return {
            content: [{ type: "text", text: `Error calling dokumenty_slaska_get_page: ${msg}` }],
            isError: true,
          };
        }
      })();
    },
  );

  server.tool(
    "dokumenty_slaska_medieval_catalog",
    [
      "Zwraca stałą listę JSON ze ścieżkami względnymi głównej serii dokumentów średniowiecznych na dokumentyslaska.pl (menu „Dokumenty\": okresy do 1333).",
      "Użyj dokumenty_slaska_get_page ze ścieżkami indeks* dla spisu treści oraz dokument* dla pełnego tekstu wydań dla danego okresu.",
      "This is not a database query — only a navigation aid; other collections (monasteries, chronicles, etc.) use different folders — discover paths from the homepage HTML.",
    ].join(" "),
    {},
    async () => {
      return (async () => {
        const text = JSON.stringify({ site: SITE_ORIGIN, periods: MEDIEVAL_CATALOG }, null, 2);
        return { content: [{ type: "text", text }] };
      })();
    },
  );
}
