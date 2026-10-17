import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { extractCompactHtml } from "../extract.js";

const API_BASE = "https://polskabibliotekamuzyczna.pl";
const CACHE_TTL = 86_400;
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/html, */*;q=0.8",
};

export function registerPbmTools(server: McpServer, env: Env): void {
  server.tool(
    "pbm_search",
    [
      "Wyszukiwanie w Polskiej Bibliotece Muzycznej (polskabibliotekamuzyczna.pl) — encyklopedii muzycznej (kompozytorzy, utwory, instrumenty, pojęcia), kolekcji nut cyfrowych (partytur) oraz fotografii archiwalnych.",
      "Dla encyklopedii i wpisów używa natywnego WP REST API (/wp-json/wp/v2/encyklopedia), a dla nut i fotografii szybkiego interfejsu AJAX z automatycznym oczyszczeniem miniatur base64.",
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe("Fraza wyszukiwania (np. nazwisko kompozytora, tytuł utworu, instrument, temat)."),
      section: z
        .enum(["encyclopedia", "scores", "photos"])
        .default("encyclopedia")
        .describe(
          "Sekcja Polskiej Biblioteki Muzycznej: encyclopedia (hasła encyklopedyczne), scores (nuty i partytury), photos (fotografie).",
        ),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Numer strony wyników (liczony od 1)."),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Liczba wyników na stronę (1–50)."),
    },
    async ({ query, section, page, per_page }) => {
      try {
        const key = makeCacheKey("pbm_search", { query, section, page, per_page });
        if (section === "encyclopedia") {
          const qs = new URLSearchParams({
            search: query,
            page: String(page),
            per_page: String(per_page),
            _fields: "id,date,slug,title,link,excerpt",
          });
          const url = `${API_BASE}/wp-json/wp/v2/encyklopedia?${qs}`;
          const text = await cachedFetch(env.CACHE_KV, key, url, { headers: HEADERS }, CACHE_TTL);
          return { content: [{ type: "text", text }] };
        }

        const fileType = section === "scores" ? "1" : "0";
        const searchpage = section === "scores" ? "score" : "photo";
        const first = (page - 1) * per_page;
        const qs = new URLSearchParams({
          search: query,
          fullText: query,
          rows: String(per_page),
          first: String(first),
          fileType,
          quick_ajax: "1",
          searchpage,
        });
        const url = `${API_BASE}/?${qs}`;
        const rawHtml = await cachedFetch(env.CACHE_KV, key, url, { headers: HEADERS }, CACHE_TTL);
        const text = extractCompactHtml(rawHtml);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error calling pbm_search: ${msg}` }], isError: true };
      }
    },
  );

  server.tool(
    "pbm_get_item",
    [
      "Pobiera pełną treść hasła encyklopedycznego (po liczbowym ID z WP REST API) lub kartę obiektu nutowego/fotograficznego (np. /art/{id}) z Polskiej Biblioteki Muzycznej.",
    ].join(" "),
    {
      id: z
        .string()
        .min(1)
        .describe(
          "Identyfikator liczbowy hasła encyklopedii (np. 14520) albo identyfikator obiektu /art/{id} z wyników wyszukiwania nut lub fotografii.",
        ),
      kind: z
        .enum(["encyclopedia", "art"])
        .default("encyclopedia")
        .describe(
          "Typ obiektu: encyclopedia (hasło encyklopedyczne z WP REST API) lub art (obiekt nutowy/fotograficzny ze ścieżki /art/{id}).",
        ),
    },
    async ({ id, kind }) => {
      try {
        const cleanId = id.trim().replace(/^\/?art\//, "");
        const key = makeCacheKey("pbm_get_item", { id: cleanId, kind });
        if (kind === "encyclopedia" && /^\d+$/.test(cleanId)) {
          const url = `${API_BASE}/wp-json/wp/v2/encyklopedia/${cleanId}?_fields=id,date,slug,title,link,content`;
          const text = await cachedFetch(env.CACHE_KV, key, url, { headers: HEADERS }, CACHE_TTL);
          return { content: [{ type: "text", text }] };
        }
        const url = `${API_BASE}/art/${encodeURIComponent(cleanId)}`;
        const rawHtml = await cachedFetch(env.CACHE_KV, key, url, { headers: HEADERS }, CACHE_TTL);
        const text = extractCompactHtml(rawHtml);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error calling pbm_get_item: ${msg}` }], isError: true };
      }
    },
  );
}
