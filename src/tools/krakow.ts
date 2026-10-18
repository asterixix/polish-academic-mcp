import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";
import { decodeHtmlEntities, extractCompactHtml } from "../extract.js";
import { toToolErrorText } from "../tool-error-handling.js";

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36", "Accept-Language": "pl-PL,pl;q=0.9" };
const TTL = 3600;
function norm(s: string): string { return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, " ").trim(); }
function clean(html: string): string { return decodeHtmlEntities(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
// shortcut: max 20 stron x 100 wierszy na tabelę (wywołania sekwencyjne), upgrade: równoległe pobieranie lub filtr OData
const MAX_PAGES = 20;
export async function fetchAllRows(url: string, env: Env): Promise<{ rows: unknown[]; complete: boolean }> {
  const rows: unknown[] = [];
  let next: string | null = url;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const raw = await cachedFetch(env.CACHE_KV, makeCacheKey("krakow_od_page", { u: next }), next, { headers: { Accept: "application/json" } }, TTL);
    const j = JSON.parse(raw) as { value?: unknown[]; nextLink?: string };
    rows.push(...(Array.isArray(j.value) ? j.value : []));
    const after = j.nextLink ? new URL(j.nextLink).searchParams.get("$after") : null;
    next = after ? `${url.split("?")[0]}?$after=${encodeURIComponent(after)}` : null;
  }
  return { rows, complete: next === null };
}
function err(tool: string, e: unknown) { return { content: [{ type: "text" as const, text: `Error calling ${tool}: ${toToolErrorText(e)}` }], isError: true }; }
function matches(query: string, ...fields: string[]): boolean { const q = norm(query); if (!q) return true; const hay = norm(fields.join(" ")); return q.split(" ").filter(Boolean).every((t) => hay.includes(t)) || hay.includes(q); }

// ---------- Otwarte Dane UMK: 45 zbiorów / 42 API (WSO2) ----------
export const KRAKOW_OD_CATALOG: Array<{ slug: string; title: string; category: string }> = [
  ["bezrobotni-i-oferty-pracy-w-krakowie-od-2023-roku","Bezrobotni i oferty pracy w Krakowie, od 2023 roku","Przedsiębiorczość i nauka"],
  ["centra-aktywnosci-seniora-w-krakowie","Centra Aktywności Seniora w Krakowie","Społeczeństwo obywatelskie"],
  ["cudzoziemcy-w-krakowie","Cudzoziemcy w Krakowie zameldowani na pobyt czasowy","Mieszkańcy"],
  ["cudzoziemcy-w-krakowie-zameldowani-na-pobyt-staly","Cudzoziemcy w Krakowie zameldowani na pobyt stały","Mieszkańcy"],
  ["dzialalnosc-biblioteki-krakow","Działalność Biblioteki Kraków","Kultura i ochrona dziedzictwa"],
  ["dzialalnosc-miejskich-osrodkow-kultury-w-krakowie","Działalność miejskich centrów i ośrodków kultury w Krakowie","Kultura i ochrona dziedzictwa"],
  ["dzialalnosc-miejskich-instytucji-muzycznych-w-krakowie","Działalność miejskich instytucji muzycznych w Krakowie","Kultura i ochrona dziedzictwa"],
  ["dzialalnosc-miejskich-muzeow-i-galerii-w-krakowie","Działalność miejskich muzeów i galerii w Krakowie","Kultura i ochrona dziedzictwa"],
  ["dzialalnosc-teatrow-miejskich-w-2021-roku","Działalność teatrów miejskich w Krakowie","Kultura i ochrona dziedzictwa"],
  ["impreza-biegowa-bieg-nocny","Impreza biegowa Bieg Nocny","Sport i rekreacja"],
  ["impreza-biegowa-bieg-trzech-kopcow","Impreza biegowa Bieg Trzech Kopców","Sport i rekreacja"],
  ["impreza-biegowa-cracovia-maraton","Impreza biegowa Cracovia Maraton","Sport i rekreacja"],
  ["impreza-biegowa-cracovia-polmaraton","Impreza biegowa Cracovia Półmaraton Królewski","Sport i rekreacja"],
  ["impreza-biegowa-krakowska-piatka","Impreza biegowa Krakowska Piątka","Sport i rekreacja"],
  ["impreza-biegowa-krakowski-bieg-kobiet","Impreza biegowa Krakowski Bieg Kobiet","Sport i rekreacja"],
  ["infrastruktura-sportowa-szkol-i-placowek-niesamorzadowych-w-roku-szkolnym-2023-2024","Infrastruktura sportowa szkół niesamorządowych 2023/2024","Sport i rekreacja"],
  ["infrastruktura-sportowa-szkol-i-oplacowek-samorzadowych-w-roku-szkolnym-2023-2024","Infrastruktura sportowa szkół samorządowych 2023/2024","Sport i rekreacja"],
  ["kluby-dzieciece-w-krakowie","Kluby dziecięce w Krakowie","Zdrowie"],
  ["kluby-rodzicow-z-dziecmi-do-lat-3-w-krakowie","Kluby Rodziców z dziećmi do lat 3 w Krakowie","Pomoc i integracja społeczna"],
  ["komunikacja-miejska-w-krakowie-kmk","Komunikacja Miejska w Krakowie (KMK)","Transport"],
  ["krakowskie-noce-i-sztuka-do-rzeczy-krakowski-design","Krakowskie Noce i Sztuka do rzeczy – krakowski design","Kultura i ochrona dziedzictwa"],
  ["krakow-statystyki-demograficzne","Kraków - statystyki demograficzne","Mieszkańcy"],
  ["liczba-uczestnikow-spotkan-biznesowych-w-krakowie","Liczba uczestników spotkań biznesowych w Krakowie","Turystyka i promocja"],
  ["lista-bibliotek-miejskich-biblioteki-krakow","Lista bibliotek miejskich (filii) Biblioteki Kraków","Kultura i ochrona dziedzictwa"],
  ["lista-muzeow-miejskich-w-krakowie","Lista muzeów miejskich w Krakowie","Kultura i ochrona dziedzictwa"],
  ["lista-teatrow-miejskich-w-krakowie","Lista teatrów miejskich w Krakowie","Kultura i ochrona dziedzictwa"],
  ["lista-uslug-administracyjnych-i-procedur-zewnetrznych-gminy-miejskiej-krakow","Lista usług administracyjnych Gminy Miejskiej Kraków","Administracja i cyfryzacja"],
  ["mieszkancy-krakowa-zameldowani-na-pobyt-czasowy","Mieszkańcy Krakowa zameldowani na pobyt czasowy","Mieszkańcy"],
  ["mieszkancy-zameldowani-na-pobyt-staly","Mieszkańcy Krakowa zameldowani na pobyt stały","Mieszkańcy"],
  ["mobilnosc-aktywna-rowery-w-krakowie","Mobilność Aktywna (Rowery) w Krakowie","Transport"],
  ["parki-kieszonkowe-w-krakowie","Parki kieszonkowe w Krakowie","Ochrona i kształtowanie środowiska"],
  ["parki-miejskie-w-krakowie","Parki miejskie w Krakowie","Ochrona i kształtowanie środowiska"],
  ["podmioty-lecznicze-prowadzone-przez-gmine-miejska-krakow","Podmioty lecznicze prowadzone przez Gminę Miejską Kraków","Zdrowie"],
  ["powierzanie-pracy-cudzoziemcom-za-posrednictwem-gup-w-krakowie-od-2023-roku","Powierzanie pracy cudzoziemcom za pośrednictwem GUP w Krakowie, od 2023 roku","Przedsiębiorczość i nauka"],
  ["przedszkola-w-krakowie-liczba-dzieci","Przedszkola w Krakowie - liczba dzieci","Oświata i wychowanie"],
  ["ruch-turystyczny-w-krakowie-od-2015-roku","Ruch turystyczny w Krakowie, od 2015 roku","Turystyka i promocja"],
  ["system-informacji-miejskiej-w-krakowie-sim","System Informacji Miejskiej w Krakowie (SIM)","Transport"],
  ["szkoly-muzyczne-prowadzone-przez-gmine-miejska-krakow","Szkoły muzyczne prowadzone przez Gminę Miejską Kraków","Oświata i wychowanie"],
  ["szkoly-podstawowe-w-krakowie-liczba-dzieci","Szkoły podstawowe w Krakowie - liczba uczniów","Oświata i wychowanie"],
  ["szkoly-ponadpodstawowe-w-krakowie-liczba-uczniow","Szkoły ponadpodstawowe w Krakowie - liczba uczniów","Oświata i wychowanie"],
  ["wykaz-rzeczy-znalezionych-na-terenie-gminy-miejskiej-krakow","Wykaz rzeczy znalezionych na terenie Gminy Miejskiej Kraków","Administracja i cyfryzacja"],
  ["zarejestrowane-pojazdy-w-krakowie","Zarejestrowane pojazdy w Krakowie","Transport"],
  ["zlobki-niesamorzadowe-prowadzone-na-zlecenie-gminy-miejskiej-krakow","Żłobki prowadzone na zlecenie Gminy Miejskiej Kraków","Zdrowie"],
  ["zlobki-prywatne-w-krakowie","Żłobki prywatne w Krakowie","Zdrowie"],
  ["zlobki-samorzadowe-w-krakowie","Żłobki samorządowe w Krakowie","Zdrowie"],
].map(([slug, title, category]) => ({ slug, title, category }));

export function parseKrakowOdWebComponents(html: string): Array<{ name: string; apiUrl?: string; metaUrl?: string; swaggerUrl?: string }> {
  const m = html.match(/window\.WEB_COMPONENTS\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  try { return (JSON.parse(m[1]) as Array<{ name: string; options?: Record<string, string> }>).map((c) => ({ name: c.name, apiUrl: c.options?.apiUrl, metaUrl: c.options?.metaUrl, swaggerUrl: c.options?.swaggerUrl })); } catch { return []; }
}
export function parseKrakowOdSearchHtml(html: string): string[] {
  return [...new Set([...html.matchAll(/href="\/zbiory-danych\/([^"?#]+)"/g)].map((x) => x[1]))];
}
export function parseMsipCatalogHtml(html: string): Array<{ dataset_id: number; title: string; url: string }> {
  const out = new Map<number, string>();
  for (const m of html.matchAll(/href="\/dataset\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi)) { const id = Number(m[1]); const t = clean(m[2]); if (t && !out.has(id)) out.set(id, t); }
  return [...out.entries()].map(([dataset_id, title]) => ({ dataset_id, title, url: `https://msip.krakow.pl/dataset/${dataset_id}` }));
}
export function parseMsipDatasetHtml(html: string, datasetId: number) {
  const text = clean(html);
  const grab = (label: string) => { const i = text.indexOf(label); if (i < 0) return null; const rest = text.slice(i + label.length).trim(); return rest.split(/(?:Tytuł zasobu:|Streszczenie:|Słowa kluczowe:|Kategoria:|Typ reprezentacji|Referencyjny układ|Dostęp do danych|Ograniczenia wykorzystania:|Pochodzenie danych:|Właściciel danych:|Standard metadanych:)/)[0].trim().slice(0, 1200) || null; };
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((x) => decodeHtmlEntities(x[1]));
  return { dataset_id: datasetId, url: `https://msip.krakow.pl/dataset/${datasetId}`, title: grab("Tytuł zasobu:"), summary: grab("Streszczenie:"), keywords: grab("Słowa kluczowe:"), category: grab("Kategoria:"), downloads: [...new Set(links.filter((u) => /msip\.um\.krakow\.pl\/Dane\//i.test(u)))], services: [...new Set(links.filter((u) => /WMSServer|WFSServer/i.test(u)))], metadata: [...new Set(links.filter((u) => /geoportal\/rest\/metadata/i.test(u)))] };
}

export const KRAKOW_STRATEGIA_BANK: Array<{ id: number; slug: string; title: string }> = [
  { id: 253584, slug: "raport-o-stanie-gminy", title: "Raport o stanie Gminy" },
  { id: 253591, slug: "raport-o-stanie-miasta", title: "Raport o stanie Miasta" },
  { id: 253604, slug: "krakow-w-liczbach---krakow-in-numbers", title: "Kraków w liczbach / Krakow in numbers" },
  { id: 255436, slug: "prognoza-demograficzna-dla-krakowa-do-2050-roku", title: "Prognoza demograficzna dla Krakowa do 2050 roku" },
  { id: 269787, slug: "prognoza-demograficzna-dla-mof-do-2050-roku", title: "Prognoza demograficzna dla MOF do 2050 roku" },
  { id: 262613, slug: "dojazdy-do-pracy---2019-r--i-2020-r-", title: "Dojazdy do pracy - 2019 r. i 2020 r." },
  { id: 254969, slug: "sytuacja-demograficzna-krakowa---2018-r-", title: "Sytuacja demograficzna Krakowa - 2018 r." },
  { id: 254988, slug: "sytuacja-dochodowa-krakowa---2018-r-", title: "Sytuacja dochodowa Krakowa - 2018 r." },
  { id: 255006, slug: "sytuacja-demograficzna-kom---2018-r-", title: "Sytuacja demograficzna KOM - 2018 r." },
  { id: 254995, slug: "sytuacja-dochodowa-kom---2018-r-", title: "Sytuacja dochodowa KOM - 2018 r." },
  { id: 264935, slug: "sytuacja-demograficzna-osi---2018-r-", title: "Sytuacja demograficzna OSI - 2018 r." },
  { id: 264938, slug: "sytuacja-dochodowa-osi---2018-r-", title: "Sytuacja dochodowa OSI - 2018 r." },
  { id: 253657, slug: "barometr-krakowski", title: "Barometr Krakowski" },
  { id: 254017, slug: "badanie-jakosci-zycia-i-jakosci-uslug-publicznych", title: "Badanie Jakości Życia i Jakości Usług Publicznych" },
];
const STRATEGIA_DZIEDZINY = ["Kraków i krakowianie","Administracja i cyfryzacja","Bezpieczeństwo publiczne","Społeczeństwo obywatelskie","Oświata i wychowanie","Przedsiębiorczość i nauka","Turystyka i promocja","Kultura i ochrona dziedzictwa","Mieszkalnictwo","Ochrona i kształtowanie środowiska","Planowanie przestrzenne i architektura","Sport i rekreacja","Transport","Gospodarka komunalna","Pomoc i integracja społeczna","Zdrowie"];

// ---------- register: krakow_od ----------
export function registerKrakowOdTools(server: McpServer, env: Env): void {
  server.tool("krakow_od_search",
    "Wyszukiwanie we wszystkich zbiorach Otwarte Dane Miasta Krakowa (https://otwartedane.um.krakow.pl/zbiory-danych — 45 zbiorów, 12 kategorii, 14 dostawców danych Urzędu Miasta Krakowa; dokumentacja API: https://api.um.krakow.pl/devportal oraz katalog WSO2 https://api.um.krakow.pl/api/am/devportal/v3/apis). Przeszukuje na żywo wyszukiwarkę portalu (/search?q=) i pełny katalog zbiorów (m.in. bezrobotni, cudzoziemcy, zameldowani, demografia, żłobki, przedszkola, szkoły, parki, pojazdy, ruch turystyczny, komunikacja miejska KMK, biblioteki, muzea, teatry). Zwraca listę zbiorów ze slugiem do pobrania przez krakow_od_get_dataset.",
    { query: z.string().describe("Fraza wyszukiwawcza po polsku, np. bezrobotni, żłobki, parki, ruch turystyczny, zameldowani"), category: z.string().optional().describe("Opcjonalna nazwa kategorii zbioru, np. Mieszkańcy, Zdrowie, Transport, Kultura i ochrona dziedzictwa"), page: z.number().int().min(1).default(1).describe("Numer strony katalogu zbiorów, liczony od 1") },
    async ({ query, category, page }) => {
      try {
        let liveSlugs: string[] = [];
        try { const h = await cachedFetch(env.CACHE_KV, makeCacheKey("krakow_od_search_live", { query }), `https://otwartedane.um.krakow.pl/search?q=${encodeURIComponent(query)}`, { headers: UA }, TTL); liveSlugs = parseKrakowOdSearchHtml(h); } catch { /* fallback to catalogue */ }
        let items = KRAKOW_OD_CATALOG.filter((d) => matches(query, d.title, d.category, d.slug) && (!category || norm(d.category) === norm(category)));
        if (liveSlugs.length) { const rank = new Map(liveSlugs.map((s, i) => [s, i])); items = [...items].sort((a, b) => (rank.get(a.slug) ?? 99) - (rank.get(b.slug) ?? 99)); const extra = liveSlugs.filter((s) => !items.some((d) => d.slug === s)).map((s) => ({ slug: s, title: s, category: category ?? "" })); items = [...items, ...extra]; }
        const per = 20; const slice = items.slice((page - 1) * per, page * per);
        // shortcut: prognozy do 2050 są tylko w krakow_strategia (artykuły z PDF), wskazówka dla zapytań o prognozę, upgrade: przeszukiwać strategię równolegle
        const strategia_hint = /prognoz|2050|demograf/i.test(query) ? "Prognozy do 2050 roku nie ma w Otwartych Danych. Użyj krakow_strategia_get_article z id 255436 (Kraków) lub 269787 (MOF)." : undefined;
        return { content: [{ type: "text", text: JSON.stringify({ query, category: category ?? null, page, total: items.length, count: slice.length, strategia_hint, items: slice.map((d) => ({ ...d, id: d.slug, source: "krakow_od", get_record: `krakow_od:${d.slug}`, url: `https://otwartedane.um.krakow.pl/zbiory-danych/${d.slug}` })) }, null, 2) }] };
      } catch (e) { return err("krakow_od_search", e); }
    });
  server.tool("krakow_od_get_dataset",
    "Pobiera pełną kartę zbioru Otwarte Dane Miasta Krakowa (https://otwartedane.um.krakow.pl/zbiory-danych/{slug}) wraz z metadanymi portalu (kategoria, dostawca danych, częstotliwość aktualizacji, poziom otwartości, daty), wykrytymi tabelami REST API na api.um.krakow.pl (komponenty data-exporter/data-table, format OData JSON {value:[...]}) oraz ich danymi liczbowymi: pole rows zawiera wiersze tabeli ze wszystkich stron API (nextLink/$after, do 20 stron; complete=false gdy limit został osiągnięty); zwraca też adresy dokumentacji Swagger/OpenAPI i linki zewnętrzne (m.in. warstwy ArcGIS Hub ZTP dla Komunikacji Miejskiej KMK). Identyfikator slug zwraca krakow_od_search.",
    { slug: z.string().describe("Identyfikator slug zbioru z wyników krakow_od_search, np. bezrobotni-i-oferty-pracy-w-krakowie-od-2023-roku albo pełny adres URL zbioru"), include_data: z.boolean().default(true).describe("Czy pobrać przykładowe wiersze danych z każdej wykrytej tabeli API (domyślnie tak)") },
    async ({ slug, include_data }) => {
      try {
        const cleanSlug = slug.trim().replace(/^https?:\/\/otwartedane\.um\.krakow\.pl\/zbiory-danych\//, "").replace(/[/?#].*$/, "");
        const url = `https://otwartedane.um.krakow.pl/zbiory-danych/${cleanSlug}`;
        const html = await cachedFetch(env.CACHE_KV, makeCacheKey("krakow_od_dataset", { cleanSlug }), url, { headers: UA }, TTL);
        const title = clean(html.match(/<h5 class="text-4xl[^"]*">([\s\S]*?)<\/h5>/i)?.[1] ?? html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? cleanSlug);
        const metadata: Record<string, string> = {};
        for (const m of html.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) { const k = clean(m[1]); const v = clean(m[2]); if (k && v) metadata[k] = v; }
        const desc = clean(html.match(/<div class="rich-text-content">([\s\S]*?)<\/div>/i)?.[1] ?? "").slice(0, 2000);
        const comps = parseKrakowOdWebComponents(html);
        const tables: Array<Record<string, unknown>> = [];
        const seen = new Set<string>();
        for (const c of comps.filter((x) => x.apiUrl && !seen.has(x.apiUrl) && seen.add(x.apiUrl))) {
          const t: Record<string, unknown> = { api_url: c.apiUrl, metadata_url: c.metaUrl ?? null, export_formats: ["JSON", "CSV", "XLSX"] };
          if (include_data) { try { const { rows, complete } = await fetchAllRows(c.apiUrl!, env); t.total_rows = rows.length; t.complete = complete; t.rows = rows; } catch (e2) { t.data_error = toToolErrorText(e2); } }
          tables.push(t);
        }
        tables.sort((a, b) => (String(b.api_url).match(/(20\d{2})/)?.[1] ?? "").localeCompare(String(a.api_url).match(/(20\d{2})/)?.[1] ?? ""));
        const swagger = [...new Set(comps.map((c) => c.swaggerUrl).filter(Boolean))];
        const external = [...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((x) => x[1]).filter((u) => !/otwartedane|fonts\.|api\.um\.krakow\.pl\/api\/am/i.test(u)))].slice(0, 20);
        return { content: [{ type: "text", text: JSON.stringify({ slug: cleanSlug, title, url, description: desc, metadata, tables, swagger_urls: swagger, external_links: external }, null, 2) }] };
      } catch (e) { return err("krakow_od_get_dataset", e); }
    });
  server.tool("krakow_od_fetch_api",
    "Pobiera dane bezpośrednio z publicznego REST API Otwarte Dane Miasta Krakowa na api.um.krakow.pl (WSO2 API Manager, 42 opublikowane API OD-*, katalog: https://api.um.krakow.pl/api/am/devportal/v3/apis?limit=100, dokumentacja: https://api.um.krakow.pl/devportal). Przyjmuje pełny adres tabeli API zwrócony przez krakow_od_get_dataset (np. https://api.um.krakow.pl/opendata-przedsiebiorczosc-i-nauka/v1/bezrobotni albo .../v1/metadata) i zwraca wiersze JSON {value:[...]}; obsługuje parametry zapytania OData przekazane w adresie. Zwraca ograniczoną liczbę wierszy, aby odpowiedź zmieściła się w kontekście modelu.",
    { api_url: z.string().describe("Pełny adres URL tabeli API na api.um.krakow.pl zwrócony przez krakow_od_get_dataset, np. https://api.um.krakow.pl/opendata-mieszkancy-statystyki/v1/Statystyka_mieszkancy"), limit: z.number().int().min(1).max(500).default(50).describe("Maksymalna liczba wierszy danych do zwrócenia, od 1 do 500") },
    async ({ api_url, limit }) => {
      try {
        const u = new URL(api_url.trim());
        if (u.hostname !== "api.um.krakow.pl") throw new Error("Dozwolone są wyłącznie adresy API na api.um.krakow.pl");
        const { rows, complete } = await fetchAllRows(u.toString(), env);
        const out = { api_url: u.toString(), total_rows: rows.length, complete, returned_rows: Math.min(limit, rows.length), rows: rows.slice(0, limit) };
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
      } catch (e) { return err("krakow_od_fetch_api", e); }
    });
}

// ---------- register: krakow_msip ----------
const MSIP3 = "https://msip3.um.krakow.pl/server/rest/services";
const MSIP_UM = "https://msip.um.krakow.pl/arcgis/rest/services";
export function registerKrakowMsipTools(server: McpServer, env: Env): void {
  server.tool("krakow_msip_search",
    "Wyszukiwanie we wszystkich zbiorach Miejskiego Systemu Informacji Przestrzennej w Krakowie (MSIP, https://msip.krakow.pl/ — Katalog danych i usług z 179 zbiorami, m.in. budynki i działki ewidencyjne, punkty adresowe i ulice EMUiA, dzielnice, MPZP, decyzje WZ i pozwolenia na budowę, mapy hałasu, ortofotomapy, zameldowania) oraz w katalogu metadanych Geoportal MSIP (https://msip.um.krakow.pl/geoportal/rest/metadata/search, 863 rekordy). Zwraca identyfikatory dataset_id do pobrania przez krakow_msip_get_dataset oraz rekordy metadanych z linkami JSON/XML/HTML.",
    { query: z.string().describe("Fraza wyszukiwawcza po polsku, np. działki, hałas, dzielnice, budynki, zameldowania"), page: z.number().int().min(1).default(1).describe("Numer strony wyników katalogu, liczony od 1") },
    async ({ query, page }) => {
      try {
        const katHtml = await cachedFetch(env.CACHE_KV, makeCacheKey("krakow_msip_catalog", {}), "https://msip.krakow.pl/228340,artykul,katalog-danych.html", { headers: UA }, 86400);
        const catalog = parseMsipCatalogHtml(katHtml).filter((d) => matches(query, d.title));
        let geo: unknown = null;
        try { const g = await cachedFetch(env.CACHE_KV, makeCacheKey("krakow_msip_geo", { query, page }), `https://msip.um.krakow.pl/geoportal/rest/metadata/search?q=${encodeURIComponent(query)}&f=json&max=10&start=${(page - 1) * 10 + 1}`, { headers: { Accept: "application/json" } }, TTL); const gj = JSON.parse(g) as { total?: number; results?: Array<{ id: string; title: string; description?: string }> }; geo = { total: gj.total ?? null, results: (gj.results ?? []).map((r) => ({ metadata_id: r.id, title: r.title, description: (r.description ?? "").slice(0, 300), metadata_json: `https://msip.um.krakow.pl/geoportal/rest/metadata/item/${r.id}`, metadata_xml: `https://msip.um.krakow.pl/geoportal/rest/metadata/item/${r.id}/xml` })) }; } catch { geo = null; }
        const per = 20; const slice = catalog.slice((page - 1) * per, page * per).map((d) => ({ ...d, id: d.dataset_id, source: "krakow_msip", get_record: `krakow_msip:${d.dataset_id}` }));
        return { content: [{ type: "text", text: JSON.stringify({ query, page, catalog_total: catalog.length, catalog_items: slice, geoportal: geo }, null, 2) }] };
      } catch (e) { return err("krakow_msip_search", e); }
    });
  server.tool("krakow_msip_get_dataset",
    "Pobiera pełną kartę zbioru przestrzennego MSIP Kraków (https://msip.krakow.pl/dataset/{id}) z Katalogu danych i usług: tytuł zasobu, streszczenie, słowa kluczowe, kategorię, typ reprezentacji przestrzennej, układ współrzędnych EPSG:2178, właściciela danych oraz wszystkie dostępy do danych — pliki do pobrania SHP/DXF/JSON (ZIP) z msip.um.krakow.pl/Dane/, usługi WMS i WFS (GetCapabilities) oraz metadane ISO 19115 w Geoportalu. Dla zbiorów demograficznych (zameldowania, ludność) zwraca dodatkowo pole zameldowania_wg_dzielnic z liczbą mieszkańców zameldowanych w każdej z 18 dzielnic Krakowa z warstwy ArcGIS Demografia/Elud_Dz. Identyfikator dataset_id zwraca krakow_msip_search.",
    { dataset_id: z.number().int().describe("Numeryczny identyfikator zbioru MSIP z wyników krakow_msip_search, np. 1483 dla dzielnic") },
    async ({ dataset_id }) => {
      try {
        const html = await cachedFetch(env.CACHE_KV, makeCacheKey("krakow_msip_dataset", { dataset_id }), `https://msip.krakow.pl/dataset/${dataset_id}`, { headers: UA }, 86400);
        const card = parseMsipDatasetHtml(html, dataset_id) as Record<string, unknown>;
        // Zbiory demograficzne: dołącz od razu liczby zameldowań wg dzielnic z warstwy Demografia/Elud_Dz (najnowszy stan).
        if (/zameldowan|demograf|ludno/i.test(`${card.title ?? ""} ${card.summary ?? ""} ${card.keywords ?? ""}`)) {
          try {
            const qUrl = `${MSIP3}/Demografia/Elud_Dz/MapServer/0/query?where=1%3D1&outFields=nazwa_dz,id_dz,na_dzien_txt,na_dzien_kod,r_ogolem,k_ogolem,m_ogolem&returnGeometry=false&resultRecordCount=2000&f=json`;
            const raw = await cachedFetch(env.CACHE_KV, makeCacheKey("krakow_msip_elud", {}), qUrl, { headers: { Accept: "application/json" } }, TTL);
            const feats = ((JSON.parse(raw) as { features?: Array<{ attributes: Record<string, unknown> }> }).features ?? []).map((f) => f.attributes);
            const maxKod = Math.max(0, ...feats.map((a) => Number(a.na_dzien_kod) || 0));
            const latest = feats.filter((a) => Number(a.na_dzien_kod) === maxKod).sort((a, b) => (Number(a.id_dz) || 0) - (Number(b.id_dz) || 0));
            if (latest.length) card.zameldowania_wg_dzielnic = { na_dzien: latest[0].na_dzien_txt, zrodlo: "MSIP ArcGIS Demografia/Elud_Dz (ludność wg dzielnic i grup wieku)", dzielnice: latest.map((a) => ({ dzielnica: a.nazwa_dz, zameldowani_ogolem: a.r_ogolem, kobiety: a.k_ogolem, mezczyzni: a.m_ogolem })) };
          } catch { /* karta bez danych liczbowych */ }
        }
        return { content: [{ type: "text", text: JSON.stringify(card, null, 2) }] };
      } catch (e) { return err("krakow_msip_get_dataset", e); }
    });
  server.tool("krakow_msip_list_services",
    "Listuje usługi ArcGIS REST Miejskiego Systemu Informacji Przestrzennej w Krakowie z dwóch serwerów: MSIP3 (https://msip3.um.krakow.pl/server/rest/services, ArcGIS Server 12.1, 36 folderów tematycznych m.in. Demografia, Geodezja, Planowanie, Pobieranie, Transport, Zdrowie, Zabytki) oraz MSIP UM (https://msip.um.krakow.pl/arcgis/rest/services, ArcGIS 10.81, m.in. Obserwatorium, Metropolia_Krakowska, Hosted). Bez folderu zwraca spis folderów, z folderem — listę usług MapServer/FeatureServer w folderze, gotowych do zapytań przez krakow_msip_query_layer.",
    { folder: z.string().optional().describe("Opcjonalna nazwa folderu usług ArcGIS, np. Pobieranie, Demografia, Transport albo Obserwatorium") },
    async ({ folder }) => {
      try {
        const fetchJson = async (url: string) => JSON.parse(await cachedFetch(env.CACHE_KV, makeCacheKey("krakow_msip_services", { url }), url, { headers: { Accept: "application/json" } }, TTL)) as { folders?: string[]; services?: Array<{ name: string; type: string }> };
        if (!folder) { const [a, b] = await Promise.all([fetchJson(`${MSIP3}?f=json`), fetchJson(`${MSIP_UM}?f=json`)]); return { content: [{ type: "text", text: JSON.stringify({ msip3: { base: MSIP3, folders: a.folders ?? [], root_services: a.services ?? [] }, msip_um: { base: MSIP_UM, folders: b.folders ?? [], root_services: b.services ?? [] } }, null, 2) }] }; }
        const out: Record<string, unknown> = { folder };
        for (const [key, base] of [["msip3", MSIP3], ["msip_um", MSIP_UM]] as const) { try { const j = await fetchJson(`${base}/${encodeURIComponent(folder)}?f=json`); out[key] = j.services ?? j; } catch (e2) { out[key] = { error: toToolErrorText(e2) }; } }
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
      } catch (e) { return err("krakow_msip_list_services", e); }
    });
  server.tool("krakow_msip_query_layer",
    "Wykonuje zapytanie atrybutowe do warstwy ArcGIS MapServer MSIP Kraków (operacja query, format JSON, układ EPSG:2178) na serwerze MSIP3 https://msip3.um.krakow.pl/server/rest/services albo MSIP UM https://msip.um.krakow.pl/arcgis/rest/services — np. usługa Pobieranie/Dzielnice warstwa 0 zwraca 18 dzielnic z nazwami i powierzchnią, Demografia/Elud_Dz zwraca zameldowania według grup wieku i płci, Transport/ZTP_Komunikacja_Miejska_i_Rowerowa zwraca obiekty transportu publicznego. Listę usług zwraca krakow_msip_list_services. Zwraca atrybuty obiektów bez geometrii, chyba że zaznaczysz zwracanie geometrii.",
    { service: z.string().describe("Nazwa usługi ArcGIS z folderem, np. Pobieranie/Dzielnice albo Demografia/Elud_Dz"), layer_id: z.number().int().min(0).default(0).describe("Numer warstwy w usłudze, liczony od 0"), where: z.string().default("1=1").describe("Klauzula zapytania SQL warstwy, np. 1=1 albo nazwa LIKE '%Stare%'"), result_record_count: z.number().int().min(1).max(2000).default(20).describe("Maksymalna liczba obiektów do zwrócenia, od 1 do 2000"), server: z.enum(["msip3", "msip_um"]).default("msip3").describe("Serwer ArcGIS do zapytania: msip3 (domyślny, nowszy) albo msip_um"), return_geometry: z.boolean().default(false).describe("Czy zwracać geometrię obiektów przestrzennych (domyślnie nie)") },
    async ({ service, layer_id, where, result_record_count, server: srv, return_geometry }) => {
      try {
        if (/^\s|\.\./.test(service) || !/^[A-Za-z0-9_ąćęłńóśźżĄĆĘŁŃÓŚŹŻ /-]+$/.test(service)) throw new Error("Nieprawidłowa nazwa usługi ArcGIS");
        const base = srv === "msip_um" ? MSIP_UM : MSIP3;
        const url = `${base}/${service.split("/").map(encodeURIComponent).join("/")}/MapServer/${layer_id}/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=${return_geometry}&resultRecordCount=${result_record_count}&f=json`;
        const raw = await cachedFetch(env.CACHE_KV, makeCacheKey("krakow_msip_query", { url }), url, { headers: { Accept: "application/json" } }, TTL);
        const j = JSON.parse(raw) as { features?: Array<{ attributes: Record<string, unknown> }>; error?: unknown };
        if (j.error) throw new Error(JSON.stringify(j.error));
        return { content: [{ type: "text", text: JSON.stringify({ service, layer_id, where, count: j.features?.length ?? 0, features: (j.features ?? []).map((f) => f.attributes) }, null, 2) }] };
      } catch (e) { return err("krakow_msip_query_layer", e); }
    });
}

// ---------- register: krakow_strategia ----------
export function registerKrakowStrategiaTools(server: McpServer, env: Env): void {
  server.tool("krakow_strategia_search",
    "Wyszukiwanie w serwisie Strategia Rozwoju Krakowa (https://strategia.krakow.pl, portal Rozwój Krakowa Urzędu Miasta Krakowa) — przeszukuje na żywo wyszukiwarkę serwisu (portal Rozwój Krakowa, sp_port_id=128) oraz indeks Banku Informacji o Mieście i Metropolii (https://strategia.krakow.pl/252790,artykul,bank_informacji_o_miescie_i_metropolii.html): Raport o stanie Gminy i Miasta, Kraków w liczbach, Barometr Krakowski, prognozy demograficzne do 2050 roku, statystyka eksperymentalna i badania jakości życia. Zwraca artykuły z identyfikatorem do pobrania przez krakow_strategia_get_article.",
    { query: z.string().describe("Fraza wyszukiwawcza po polsku, np. demografia, raport o stanie, barometr, dojazdy do pracy"), page: z.number().int().min(1).default(1).describe("Numer strony wyników wyszukiwania, liczony od 1") },
    async ({ query, page }) => {
      try {
        const bank = KRAKOW_STRATEGIA_BANK.filter((a) => matches(query, a.title)).map((a) => ({ ...a, source: "krakow_strategia", get_record: `krakow_strategia:${a.id}`, url: `https://strategia.krakow.pl/bank-informacji-o-miescie-i-metropolii/${a.id},artykul,${a.slug}.html`, origin: "bank" }));
        let live: Array<Record<string, unknown>> = [];
        try {
          const body = new URLSearchParams({ search_query: query, sp_count: "20", sp_port_id: "128", sp_mode: "0", sp_mod_id: "null", sp_sort: "1", sp_archive: "1" });
          const html = await cachedFetch(env.CACHE_KV, makeCacheKey("krakow_strategia_search", { query, page }), "https://strategia.krakow.pl/search/17924,0,szukaj.html", { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() }, TTL);
          const seen = new Set<string>();
          for (const m of html.matchAll(/href="(https?:\/\/strategia\.krakow\.pl\/[^"]*(?:artykul|komunikat)[^"]*)"/gi)) { const u = decodeHtmlEntities(m[1]).trim(); if (/strona-glowna|kontakt/i.test(u) || seen.has(u)) continue; seen.add(u); const artId = u.match(/\/(\d+),(?:artykul|komunikat)/)?.[1]; live.push({ title: u.split("/").pop()?.replace(/\.html$/, "").replace(/^\d+,artykul,/, "").replace(/[-_]+/g, " ") ?? u, url: u, ...(artId ? { id: Number(artId) } : {}), source: "krakow_strategia", origin: "search" } as { title: string; url: string; source: string }); }
          live = live.slice((page - 1) * 20, page * 20);
        } catch { /* bank fallback */ }
        return { content: [{ type: "text", text: JSON.stringify({ query, page, bank_items: bank, live_items: live }, null, 2) }] };
      } catch (e) { return err("krakow_strategia_search", e); }
    });
  server.tool("krakow_strategia_get_article",
    "Pobiera pełną treść artykułu z serwisu Strategia Rozwoju Krakowa / Banku Informacji o Mieście i Metropolii (https://strategia.krakow.pl) wraz z listą wszystkich załączników do pobrania (pliki PDF/XLS/XLSX raportów na plikimpi.krakow.pl/zalacznik/, odnośniki BIP Kraków) oraz adresem wersji PDF artykułu (getPdf). Przyjmuje identyfikator liczbowy artykułu z Banku (np. 253584), ścieżkę artykułu albo pełny adres URL zwrócony przez krakow_strategia_search lub krakow_strategia_list_bank.",
    { id: z.string().describe("Identyfikator artykułu: liczba z Banku (np. 253584), ścieżka bank-informacji-o-miescie-i-metropolii/253584,artykul,raport-o-stanie-gminy.html albo pełny adres URL strategia.krakow.pl") },
    async ({ id }) => {
      try {
        let url = id.trim();
        const bankHit = KRAKOW_STRATEGIA_BANK.find((a) => String(a.id) === url);
        if (bankHit) url = `https://strategia.krakow.pl/bank-informacji-o-miescie-i-metropolii/${bankHit.id},artykul,${bankHit.slug}.html`;
        else if (/^\d+$/.test(url)) url = `https://strategia.krakow.pl/${url},artykul,.html`;
        else if (!/^https?:\/\//i.test(url)) url = `https://strategia.krakow.pl/${url.replace(/^\//, "")}`;
        const html = await cachedFetch(env.CACHE_KV, makeCacheKey("krakow_strategia_article", { url }), url, { headers: UA }, TTL);
        const dokId = url.match(/\/(\d+),artykul/)?.[1] ?? url.match(/dok_id=(\d+)/)?.[1] ?? null;
        const attachments = [...new Set([...html.matchAll(/href="([^"]+)"/g)].map((x) => decodeHtmlEntities(x[1])).filter((u) => /plikimpi\.krakow\.pl\/zalacznik|bip\.krakow\.pl/i.test(u)))];
        return { content: [{ type: "text", text: JSON.stringify({ url, pdf_url: dokId ? `https://strategia.krakow.pl/getPdf/?dok_id=${dokId}` : null, attachments, text: extractCompactHtml(html).slice(0, 12000) }, null, 2) }] };
      } catch (e) { return err("krakow_strategia_get_article", e); }
    });
  server.tool("krakow_strategia_list_bank",
    "Zwraca pełny spis Banku Informacji o Mieście i Metropolii w serwisie Strategia Rozwoju Krakowa (https://strategia.krakow.pl/252790,artykul,bank_informacji_o_miescie_i_metropolii.html): raporty o stanie Gminy i Miasta Krakowa, Kraków w liczbach, Biuletyn Statystyczny, prognozy demograficzne do 2050 roku, statystykę eksperymentalną (dojazdy do pracy, sytuacja demograficzna i dochodowa), badania społeczne (Barometr Krakowski, Badanie Jakości Życia) oraz 16 dziedzin zarządzania miastem. Każdy artykuł pobierzesz narzędziem krakow_strategia_get_article, a załączniki PDF/XLS zwrócone w karcie artykułu pobierzesz narzędziem get_record przez adres URL.",
    {},
    async () => {
      try {
        let liveTitles: Record<number, string> = {};
        try { const html = await cachedFetch(env.CACHE_KV, makeCacheKey("krakow_strategia_bank", {}), "https://strategia.krakow.pl/252790,artykul,bank_informacji_o_miescie_i_metropolii.html", { headers: UA }, TTL); for (const m of html.matchAll(/href="\/bank-informacji-o-miescie-i-metropolii\/(\d+),artykul,([^"]+)\.html"/gi)) liveTitles[Number(m[1])] = m[2]; } catch { /* static */ }
        return { content: [{ type: "text", text: JSON.stringify({ bank_url: "https://strategia.krakow.pl/252790,artykul,bank_informacji_o_miescie_i_metropolii.html", articles: KRAKOW_STRATEGIA_BANK.map((a) => ({ ...a, source: "krakow_strategia", get_record: `krakow_strategia:${a.id}`, url: `https://strategia.krakow.pl/bank-informacji-o-miescie-i-metropolii/${a.id},artykul,${a.slug}.html`, live_slug: liveTitles[a.id] ?? null })), dziedziny_zarzadzania: STRATEGIA_DZIEDZINY, external: [{ title: "Biuletyn Statystyczny Miasta Krakowa (BIP)", url: "https://www.bip.krakow.pl/?mmi=234" }, { title: "Statystyczne Vademecum Samorządowca (GUS)", url: "https://svs.stat.gov.pl/" }] }, null, 2) }] };
      } catch (e) { return err("krakow_strategia_list_bank", e); }
    });
}
