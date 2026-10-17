#!/usr/bin/env node
/**
 * Build-time generator for `cloud/web/src/generated/mcp-docs.json`.
 * Extracts the complete catalogue of sources, 3 Meta-Router tools,
 * granular operations (with full JSON Schema parameters), and MCP client configs
 * directly from the compiled root `dist/` package.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const outPath = resolve(__dirname, "../src/generated/mcp-docs.json");

const SOURCE_META = {
  bn: {
    portalUrl: "https://bibliotekanauki.pl",
    apiUrl: "https://bibliotekanauki.pl/api/oai/articles",
    protocol: "REST JSON + OAI-PMH 2.0 XML",
    notes: "Wyszukiwarka pełnotekstowa REST (/api/search) oraz repozytorium OAI-PMH (oai_dc, jats, bwnmeta).",
  },
  rcin: {
    portalUrl: "https://rcin.org.pl",
    apiUrl: "https://rcin.org.pl/oai-pmh-repository.xml",
    protocol: "OAI-PMH 2.0 XML",
    notes: "Repozytorium Cyfrowe Instytutów Naukowych PAN (OAI-PMH ListRecords/GetRecord + filtrowanie lokalne).",
  },
  ruj: {
    portalUrl: "https://ruj.uj.edu.pl",
    apiUrl: "https://ruj.uj.edu.pl/server/api/discover/search/objects",
    protocol: "DSpace 7 REST JSON",
    notes: "Repozytorium Uniwersytetu Jagiellońskiego. Obsługuje tryb minimize_pii.",
  },
  agh: {
    portalUrl: "https://repo.agh.edu.pl",
    apiUrl: "https://api.repo.agh.edu.pl/server/api",
    protocol: "DSpace 7 REST JSON",
    notes: "Repozytorium Akademii Górniczo-Hutniczej w Krakowie.",
  },
  amu: {
    portalUrl: "https://repozytorium.amu.edu.pl",
    apiUrl: "https://repozytorium.amu.edu.pl/server/api",
    protocol: "DSpace 7 REST JSON",
    notes: "Repozytorium Uniwersytetu im. Adama Mickiewicza w Poznaniu.",
  },
  uafm: {
    portalUrl: "https://repozytorium.uafm.edu.pl",
    apiUrl: "https://repozytorium.uafm.edu.pl/server/api",
    protocol: "DSpace 7 REST JSON",
    notes: "Repozytorium Uniwersytetu Andrzeja Frycza Modrzewskiego w Krakowie.",
  },
  icm: {
    portalUrl: "https://open.icm.edu.pl",
    apiUrl: "https://open.icm.edu.pl/server/api",
    protocol: "DSpace 7 REST JSON",
    notes: "Repozytorium Centrum Otwartej Nauki (CeON) ICM Uniwersytetu Warszawskiego.",
  },
  rodbuk: {
    portalUrl: "https://rodbuk.pl",
    apiUrl: "https://rodbuk.pl/api/search",
    protocol: "Dataverse REST JSON",
    notes: "Krakowskie Repozytorium Otwartych Danych Badawczych Uczelni (UJ, AGH, PK, UEK, URK, UP).",
  },
  repod: {
    portalUrl: "https://repod.icm.edu.pl",
    apiUrl: "https://repod.icm.edu.pl/api/search",
    protocol: "Dataverse REST JSON",
    notes: "Repozytorium Otwartych Danych Badawczych ICM UW (wyszukiwanie i pobieranie metadanych DOI).",
  },
  polon: {
    portalUrl: "https://radon.nauka.gov.pl",
    apiUrl: "https://radon.nauka.gov.pl/opendata/polon",
    protocol: "REST JSON (RAD-on OpenData)",
    notes: "Zintegrowana Sieć Informacji o Nauce i Szkolnictwie Wyższym (instytucje, kierunki, dyscypliny, projekty).",
  },
  pbn: {
    portalUrl: "https://pbn.nauka.gov.pl",
    apiUrl: "https://pbn.nauka.gov.pl/api/v1",
    protocol: "REST JSON (X-App-Id / X-App-Token)",
    notes: "Polska Bibliografia Naukowa — wymaga kluczy PBN_APP_ID oraz PBN_APP_TOKEN.",
  },
  ludzie: {
    portalUrl: "https://ludzie.nauka.gov.pl",
    apiUrl: "https://ludzie.nauka.gov.pl/api/profiles-api",
    protocol: "REST JSON",
    notes: "Baza Ludzie Nauki (OPI PIB) — wyszukiwanie klasyczne, semantyczne AI oraz pełne profile naukowców.",
  },
  baztol: {
    portalUrl: "https://baztol.library.put.poznan.pl",
    apiUrl: "http://baztol.library.put.poznan.pl",
    protocol: "Vaadin 7 UIDL + HTML/JS",
    notes: "Polskie Zasoby Sieciowe z Zakresu Nauk Technicznych (Politechnika Poznańska).",
  },
  sum: {
    portalUrl: "https://katalog.sum.edu.pl",
    apiUrl: "https://katalog.sum.edu.pl/X",
    protocol: "Ex Libris Aleph X-Services XML",
    notes: "Katalog OPAC Biblioteki Śląskiego Uniwersytetu Medycznego (zapytania CCL, rekordy MARC21).",
  },
  ppm: {
    portalUrl: "https://ppm.edu.pl",
    apiUrl: "https://ppm.edu.pl/index.seam",
    protocol: "Omega-PSIR / JSF Seam + REST",
    notes: "Polska Platforma Medyczna — publikacje, doktoraty, dane badawcze, patenty i profile 8 uczelni medycznych.",
  },
  dane: {
    portalUrl: "https://dane.gov.pl",
    apiUrl: "https://api.dane.gov.pl/1.4",
    protocol: "JSON:API 1.4",
    notes: "Portal Otwartych Danych RP (zbiory danych, zasoby CSV/XLSX/JSON/API instytucji publicznych).",
  },
  bdl: {
    portalUrl: "https://bdl.stat.gov.pl",
    apiUrl: "https://bdl.stat.gov.pl/api/v1",
    protocol: "REST JSON (GUS BDL v1)",
    notes: "Bank Danych Lokalnych GUS (tematy, zmienne, jednostki NUTS/TERYT, szeregi czasowe). Opcjonalny BDL_CLIENT_ID.",
  },
  imgw: {
    portalUrl: "https://danepubliczne.imgw.pl",
    apiUrl: "https://danepubliczne.imgw.pl/api/data",
    protocol: "REST JSON",
    notes: "Dane pomiarowe IMGW-PIB na żywo: stacje synoptyczne, hydrologiczne, meteorologiczne i ostrzeżenia.",
  },
  krakow_od: {
    portalUrl: "https://otwartedane.um.krakow.pl/zbiory-danych",
    apiUrl: "https://api.um.krakow.pl/devportal",
    protocol: "REST JSON (WSO2 API Manager, OData)",
    notes: "Otwarte Dane Miasta Krakowa — 45 zbiorów UMK (demografia, transport KMK, żłobki, szkoły, parki, pojazdy, turystyka) z tabelami REST API i dokumentacją Swagger.",
  },
  krakow_msip: {
    portalUrl: "https://msip.krakow.pl",
    apiUrl: "https://msip3.um.krakow.pl/server/rest/services",
    protocol: "ArcGIS REST (MapServer/FeatureServer, Geoportal)",
    notes: "Miejski System Informacji Przestrzennej Krakowa — 179 zbiorów przestrzennych, usługi WMS/WFS i zapytania do warstw ArcGIS (EPSG:2178).",
  },
  krakow_strategia: {
    portalUrl: "https://strategia.krakow.pl",
    apiUrl: "https://strategia.krakow.pl/252790,artykul,bank_informacji_o_miescie_i_metropolii.html",
    protocol: "HTML / Bank Informacji o Mieście",
    notes: "Strategia Rozwoju Krakowa — raporty o stanie miasta, Kraków w liczbach, Barometr Krakowski, prognozy demograficzne do 2050 r.",
  },
  isap: {
    portalUrl: "https://isap.sejm.gov.pl",
    apiUrl: "https://api.sejm.gov.pl/eli",
    protocol: "REST JSON (Sejm ELI API)",
    notes: "Internetowy System Aktów Prawnych (Dziennik Ustaw i Monitor Polski od 1918 r., metadane i teksty ujednolicone).",
  },
  saos: {
    portalUrl: "https://www.saos.org.pl",
    apiUrl: "https://www.saos.org.pl/api",
    protocol: "REST JSON",
    notes: "System Analizy Orzeczeń Sądowych (sądy powszechne, SN, TK, KIO — wyszukiwanie, pełne uzasadnienia, hurtowe zrzuty).",
  },
  bs_sejm: {
    portalUrl: "https://bs.sejm.gov.pl",
    apiUrl: "https://bs.sejm.gov.pl/F",
    protocol: "Ex Libris Aleph OPAC",
    notes: "Katalog OPAC Biblioteki Sejmowej (monografie, periodyki, druki parlamentarne i prawnicze).",
  },
  pkn: {
    portalUrl: "https://www.pkn.pl",
    apiUrl: "https://www.pkn.pl/szukaj",
    protocol: "HTML / Drupal Search",
    notes: "Serwis Polskiego Komitetu Normalizacyjnego — artykuły, komunikaty i materiały informacyjne.",
  },
  wiedza: {
    portalUrl: "https://wiedza.pkn.pl",
    apiUrl: "https://wiedza.pkn.pl/wyszukiwarka-norm",
    protocol: "Liferay XML (;a=1.xml)",
    notes: "Katalog Polskich Norm (PN-EN, PN-ISO) — numery norm, daty publikacji, statusy aktualności, ICS i komitety techniczne.",
  },
  wolnelektury: {
    portalUrl: "https://wolnelektury.pl",
    apiUrl: "https://wolnelektury.pl/api",
    protocol: "REST JSON",
    notes: "Biblioteka cyfrowa Wolne Lektury — utwory, autorzy, epoki, gatunki, kolekcje oraz linki do pełnych tekstów TXT/EPUB/PDF.",
  },
  ninateka: {
    portalUrl: "https://ninateka.pl",
    apiUrl: "https://ninateka.pl/api/products",
    protocol: "REST JSON",
    notes: "VOD Filmoteki Narodowej – Instytutu Audiowizualnego (FINA): filmy dokumentalne, fabularne, spektakle, audycje.",
  },
  gapla: {
    portalUrl: "https://gapla.fn.org.pl",
    apiUrl: "https://gapla.fn.org.pl",
    protocol: "HTML + JSON-LD",
    notes: "Galeria Plakatu Filmowego Filmoteki Narodowej (plakaty polskiej szkoły plakatu, autorzy, filmy).",
  },
  fototeka: {
    portalUrl: "https://fototeka.fn.org.pl",
    apiUrl: "https://fototeka.fn.org.pl",
    protocol: "HTML / Katalog FN",
    notes: "Fototeka Filmoteki Narodowej — fotosy, zdjęcia z planów filmowych i portrety ludzi polskiego kina.",
  },
  filmpolski: {
    portalUrl: "https://www.filmpolski.pl",
    apiUrl: "https://www.filmpolski.pl/fp",
    protocol: "HTML / Indeks FilmPolski",
    notes: "Internetowa Baza Filmu Polskiego PWSFTviT w Łodzi (filmy, seriale, etiudy, spektakle TV, biogramy).",
  },
  fototekaslaska: {
    portalUrl: "https://fototekaslaska.pl",
    apiUrl: "https://fototekaslaska.pl/wp-json/wp/v2",
    protocol: "WordPress REST JSON + HTML",
    notes: "Fototeka Śląska Muzeum Wsi Opolskiej — archiwalne fotografie etnograficzne i historyczne Śląska.",
  },
  fn_repo: {
    portalUrl: "https://repozytorium.fn.org.pl",
    apiUrl: "https://repozytorium.fn.org.pl",
    protocol: "HTML / Katalog zasobów + cross-search FINA",
    notes: "Repozytorium Cyfrowe Filmoteki Narodowej (karty filmowe, materiały archiwalne, cross-search z Ninateką/Fototeką/FilmPolski).",
  },
  nac: {
    portalUrl: "https://www.nac.gov.pl",
    apiUrl: "https://www.nac.gov.pl/?rest_route=/wp/v2",
    protocol: "WordPress REST JSON + RSS 2.0",
    notes: "Narodowe Archiwum Cyfrowe — aktualności, artykuły edukacyjne, wystawy i strony informacyjne.",
  },
  pauart: {
    portalUrl: "http://www.pauart.pl/app",
    apiUrl: "http://www.pauart.pl/api",
    protocol: "REST JSON",
    notes: "Katalog Zbiorów Artystycznych i Naukowych Polskiej Akademii Umiejętności (grafika, rysunek, fotografia, rękopisy).",
  },
  blz: {
    portalUrl: "https://bazalegalnychzrodel.pl",
    apiUrl: "https://bazalegalnychzrodel.pl/wp-json/wp/v2",
    protocol: "WordPress REST JSON (CPT listing)",
    notes: "Baza Legalnych Źródeł Fundacji Legalna Kultura (katalog legalnych serwisów kultury w Polsce).",
  },
  dokumenty_slaska: {
    portalUrl: "https://www.dokumentyslaska.pl",
    apiUrl: "https://www.dokumentyslaska.pl",
    protocol: "HTML / Katalog regestów",
    notes: "Dokumenty Śląska — regesty dokumentów średniowiecznych, herbarze, nagrobki i inskrypcje śląskie.",
  },
  jbc: {
    portalUrl: "https://jbc.bj.uj.edu.pl",
    apiUrl: "https://jbc.bj.uj.edu.pl/graphql",
    protocol: "dLibra GraphQL + Anubis PoW + Hybrydowy OCR/HTR",
    notes: "Jagiellońska Biblioteka Cyfrowa UJ — starodruki, rękopisy, czasopisma i monografie (z obsługą OCR/HTR skanów PDF).",
  },
  sbc: {
    portalUrl: "https://www.sbc.org.pl",
    apiUrl: "https://www.sbc.org.pl/graphql",
    protocol: "dLibra GraphQL + Anubis PoW",
    notes: "Śląska Biblioteka Cyfrowa — dziedzictwo kulturowe i naukowe regionu śląskiego.",
  },
  fbc: {
    portalUrl: "https://fbc.pionier.net.pl",
    apiUrl: "https://fbc.pionier.net.pl/graphql",
    protocol: "Federacja Bibliotek Cyfrowych PIONIER",
    notes: "Agregat metadanych ponad 150 polskich bibliotek cyfrowych i repozytoriów sieci PIONIER.",
  },
  pbm: {
    portalUrl: "https://polskabibliotekamuzyczna.pl",
    apiUrl: "https://polskabibliotekamuzyczna.pl/wp-json/wp/v2",
    protocol: "WordPress REST JSON",
    notes: "Polska Biblioteka Muzyczna PWM — partytury, biogramy kompozytorów, hasła i multimedia.",
  },
  swa: {
    portalUrl: "https://www.szukajwarchiwach.gov.pl",
    apiUrl: "https://www.szukajwarchiwach.gov.pl",
    protocol: "REST / Portal Szukaj w Archiwach",
    notes: "Centralny portal państwowej sieci archiwalnej (zespoły, jednostki archiwalne, skany metryk i akt).",
  },
  gwa: {
    portalUrl: "https://www.genealogiawarchiwach.pl",
    apiUrl: "https://www.genealogiawarchiwach.pl",
    protocol: "Portal Genealogia w Archiwach",
    notes: "Wyszukiwarka akt metrykalnych i stanu cywilnego archiwów państwowych (m.in. Bydgoszcz, Toruń, Włocławek).",
  },
  plock_genea: {
    portalUrl: "https://archiwum.plock.ap.gov.pl",
    apiUrl: "https://archiwum.plock.ap.gov.pl/wp-content/uploads/2021/03/GENEA.xlsx",
    protocol: "XLSX Parser (in-memory)",
    notes: "Indeks genealogiczny GENEA Archiwum Państwowego w Płocku (automatyczna ekstrakcja arkusza XLSX).",
  },
  ekartoteka: {
    portalUrl: "https://e-kartoteka.net",
    apiUrl: "https://e-kartoteka.net/pl/search",
    protocol: "HTML / Wyszukiwarka kartoteki",
    notes: "Poznańska Kartoteka Ewidencji Ludności (1870–1931) — skany i indeksy kart meldunkowych mieszkańców Poznania.",
  },
  archiwum_powstania: {
    portalUrl: "https://archiwumpowstania.pl",
    apiUrl: "https://archiwumpowstania.pl/pl/search",
    protocol: "HTML / Katalog Powstania Wielkopolskiego",
    notes: "Cyfrowe Archiwum Powstania Wielkopolskiego 1918–1919 — biogramy powstańców, dokumenty i fotografie.",
  },
  warszawa_ap: {
    portalUrl: "https://www.warszawa.ap.gov.pl",
    apiUrl: "https://www.warszawa.ap.gov.pl/wyszukiwarki/",
    protocol: "PHP / Wyszukiwarki AP Warszawa",
    notes: "6 baz AP w Warszawie: stan cywilny (asc), ewidencja ludności (ewidencja), księgi hipoteczne (hipoteka), akta notarialne (notariat), zdjęcia (zdjecia), mapy (mapy).",
  },
  zamosc_ap: {
    portalUrl: "https://zamosc.ap.gov.pl/ludnosc-zamoscia/",
    apiUrl: "https://zamosc.ap.gov.pl/wp-admin/admin-ajax.php",
    protocol: "WordPress AJAX / DataTables",
    notes: "Baza 'Ludność Zamościa' Archiwum Państwowego w Zamościu — spisy mieszkańców i księgi ludności.",
  },
  archiwa_jency: {
    portalUrl: "https://archiwa.gov.pl/jency-baza-danych/",
    apiUrl: "https://archiwa.gov.pl/wp-admin/admin-ajax.php",
    protocol: "WordPress AJAX (NDAP)",
    notes: "Baza danych jeńców wojennych Naczelnej Dyrekcji Archiwów Państwowych.",
  },
  archiwa_dziedzictwo: {
    portalUrl: "https://archiwa.gov.pl",
    apiUrl: "https://archiwa.gov.pl/wp-admin/admin-ajax.php",
    protocol: "WordPress AJAX (NDAP)",
    notes: "Katalog obiektów dziedzictwa dokumentacyjnego (program Pamięć Świata UNESCO / Polska Lista Krajowa).",
  },
  straty: {
    portalUrl: "https://straty.pl",
    apiUrl: "https://straty.pl/szukaj-osoby.php",
    protocol: "HTML / Formularz straty.pl",
    notes: "Program 'Straty osobowe i ofiary represji pod okupacją niemiecką w latach 1939–1945' (IPN / Fundacja Polsko-Niemieckie Pojednanie).",
  },
  agad: {
    portalUrl: "https://agad.gov.pl",
    apiUrl: "https://agad.gov.pl",
    protocol: "XML / HTML Inwentarze AGAD",
    notes: "Archiwum Główne Akt Dawnych — 9 wyspecjalizowanych inwentarzy XML/HTML (metrykalia kresowe, Metryka Koronna, AKW Turcja, cmentarze) i wyszukiwarka.",
  },
  postdiploma: {
    portalUrl: "http://www.postdiploma.pl",
    apiUrl: "http://www.postdiploma.pl",
    protocol: "XML (ryga.xml / Extranea.xml)",
    notes: "Bazy Postdiploma: Polacy na Politechnice Ryskiej (ryga) oraz dokumenty dyplomatyczne Extranea (extranea).",
  },
  lublin_ap: {
    portalUrl: "https://lublin.ap.gov.pl",
    apiUrl: "https://lublin.ap.gov.pl/ksiazkimeldunkowe/",
    protocol: "PHP / Księgi Meldunkowe AP Lublin",
    notes: "Księgi meldunkowe mieszkańców Lublina i Zamościa z zasobu Archiwum Państwowego w Lublinie.",
  },
  opole_ap: {
    portalUrl: "https://baza.opole.ap.gov.pl",
    apiUrl: "https://baza.opole.ap.gov.pl",
    protocol: "HTML / Baza AP Opole",
    notes: "Baza danych zasobu Archiwum Państwowego w Opolu (księgi metrykalne, katastry, akta cechowe i miejskie).",
  },
  piotrkow_ap: {
    portalUrl: "https://www.piotrkow-tryb.ap.gov.pl/p,77,indeksy",
    apiUrl: "https://www.piotrkow-tryb.ap.gov.pl/p,77,indeksy",
    protocol: "HTML + Ekstrakcja tabel XLSX/CSV",
    notes: "Indeksy archiwalne i genealogiczne Archiwum Państwowego w Piotrkowie Trybunalskim.",
  },
};

const PATH_CTX_DARWIN = {
  platform: "darwin",
  home: "~",
  env: {},
  exists: () => false,
  listDir: () => [],
};

const PATH_CTX_WIN = {
  platform: "win32",
  home: "%USERPROFILE%",
  env: { APPDATA: "%APPDATA%", USERPROFILE: "%USERPROFILE%" },
  exists: () => false,
  listDir: () => [],
};

const PATH_CTX_LINUX = {
  platform: "linux",
  home: "~",
  env: {},
  exists: () => false,
  listDir: () => [],
};

function extractParameters(inputSchema) {
  if (!inputSchema || typeof inputSchema !== "object" || !inputSchema.properties) {
    return [];
  }
  const requiredSet = new Set(Array.isArray(inputSchema.required) ? inputSchema.required : []);
  return Object.entries(inputSchema.properties).map(([name, prop]) => {
    const p = prop || {};
    let type = p.type || "any";
    if (Array.isArray(type)) {
      type = type.join(" | ");
    } else if (Array.isArray(p.anyOf)) {
      type = p.anyOf.map((x) => x.type || "any").join(" | ");
    } else if (Array.isArray(p.oneOf)) {
      type = p.oneOf.map((x) => x.type || "any").join(" | ");
    }
    if (type === "array" && p.items?.type) {
      type = `${p.items.type}[]`;
    }
    return {
      name,
      type,
      required: requiredSet.has(name),
      default: p.default !== undefined ? p.default : undefined,
      enum: Array.isArray(p.enum) ? p.enum : undefined,
      description: p.description || "",
    };
  });
}

async function main() {
  const distServerPath = resolve(repoRoot, "dist/server.js");
  if (!existsSync(distServerPath)) {
    if (existsSync(outPath)) {
      console.log("[generate-mcp-docs] dist/server.js not found; keeping existing mcp-docs.json");
      return;
    }
    throw new Error("dist/server.js not found and no cached mcp-docs.json exists. Run `npm run build` in repo root first.");
  }

  const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const { SOURCE_GROUPS, SOURCES } = await import(pathToFileURL(resolve(repoRoot, "dist/sources.js")).href);
  const { createServer, TOOL_TITLES } = await import(pathToFileURL(distServerPath).href);
  const { CLIENTS, MANUAL_CLIENTS, editClientConfig } = await import(
    pathToFileURL(resolve(repoRoot, "dist/clients.js")).href
  );

  let Client, InMemoryTransport;
  try {
    ({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
    ({ InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js"));
  } catch {
    ({ Client } = await import(pathToFileURL(resolve(repoRoot, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js")).href));
    ({ InMemoryTransport } = await import(pathToFileURL(resolve(repoRoot, "node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js")).href));
  }

  async function inspectServer(options) {
    const server = createServer({}, options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "docs-generator", version: pkg.version });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    let resourceTemplates = [];
    try {
      const res = await client.listResourceTemplates();
      resourceTemplates = res.resourceTemplates || [];
    } catch {
      resourceTemplates = [];
    }
    await client.close();
    await server.close();
    return { tools, resourceTemplates };
  }

  // 1. Groups
  const groups = Object.entries(SOURCE_GROUPS).map(([id, label]) => ({
    id,
    label,
  }));

  // 2. Router mode
  const routerResult = await inspectServer({ mode: "router" });
  const routerTools = routerResult.tools.map((t) => ({
    name: t.name,
    title: t.title || TOOL_TITLES[t.name] || t.name,
    description: t.description || "",
    annotations: t.annotations || {},
    parameters: extractParameters(t.inputSchema),
  }));

  // 3. Map each source to its granular tools
  const toolToSource = new Map();
  const sourceOperations = new Map();

  for (const src of SOURCES) {
    const { tools } = await inspectServer({ mode: "granular", sources: [src.id] });
    const names = tools.map((t) => t.name);
    sourceOperations.set(src.id, names);
    for (const name of names) {
      toolToSource.set(name, src);
    }
  }

  // 4. All granular tools
  const granularResult = await inspectServer({ mode: "granular" });
  const granularTools = granularResult.tools.map((t) => {
    const src = toolToSource.get(t.name);
    return {
      name: t.name,
      title: t.title || TOOL_TITLES[t.name] || t.name,
      sourceId: src?.id || "other",
      sourceName: src?.name || "",
      group: src?.group || "nauka",
      description: t.description || "",
      annotations: t.annotations || {},
      parameters: extractParameters(t.inputSchema),
    };
  });

  // 5. Sources list with metadata
  const sources = SOURCES.map((src) => {
    const ops = sourceOperations.get(src.id) || [];
    const meta = SOURCE_META[src.id] || {
      portalUrl: "",
      apiUrl: "",
      protocol: "HTTP / REST",
      notes: src.name,
    };
    const primarySearch =
      ops.find((n) => n.includes("search") || n.includes("find") || n.includes("filter") || n.includes("synop") || n.includes("catalog")) ||
      ops[0] ||
      null;
    const primaryGet =
      ops.find((n) => n.includes("get_") || n.includes("present") || n.includes("fetch_file")) ||
      ops[1] ||
      ops[0] ||
      null;
    return {
      id: src.id,
      group: src.group,
      name: src.name,
      requiresAuth: Boolean(src.requiresAuth),
      portalUrl: meta.portalUrl,
      apiUrl: meta.apiUrl,
      protocol: meta.protocol,
      notes: meta.notes,
      primarySearch,
      primaryGet,
      operations: ops,
    };
  });

  // 6. Clients (13 auto + 9 manual = 22 clients)
  const unixSpec = { command: "npx", args: ["-y", "polish-academic-mcp"] };
  const winSpec = { command: "cmd", args: ["/c", "npx", "-y", "polish-academic-mcp"] };

  const autoClients = CLIENTS.map((c) => {
    const unixEdit = editClientConfig(c, null, unixSpec);
    const winEdit = editClientConfig(c, null, winSpec);
    return {
      id: c.id,
      name: c.name,
      auto: true,
      format: c.format,
      paths: {
        macos: c.configPath(PATH_CTX_DARWIN),
        windows: c.configPath(PATH_CTX_WIN),
        linux: c.configPath(PATH_CTX_LINUX),
      },
      restartHint: c.restart,
      snippetUnix: unixEdit.status === "changed" ? unixEdit.text.trim() : "",
      snippetWindows: winEdit.status === "changed" ? winEdit.text.trim() : "",
    };
  });

  const manualClients = MANUAL_CLIENTS.map((c) => ({
    id: c.id,
    name: c.name,
    auto: false,
    format: "manual",
    paths: null,
    restartHint: "Zrestartuj aplikację lub odśwież listę serwerów MCP.",
    snippetUnix: c.instructions(unixSpec),
    snippetWindows: c.instructions(winSpec),
  }));

  const clients = [...autoClients, ...manualClients];

  const payload = {
    version: pkg.version,
    stats: {
      sourcesCount: sources.length,
      groupsCount: groups.length,
      routerToolsCount: routerTools.length,
      granularToolsCount: granularTools.length,
      clientsCount: clients.length,
      autoClientsCount: autoClients.length,
      manualClientsCount: manualClients.length,
    },
    groups,
    routerTools,
    resourceTemplates: routerResult.resourceTemplates,
    sources,
    granularTools,
    clients,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `[generate-mcp-docs] Generated ${outPath} (${sources.length} sources, ${groups.length} groups, ${granularTools.length} granular tools, ${routerTools.length} router tools, ${clients.length} clients)`
  );
}

main().catch((err) => {
  console.error("[generate-mcp-docs] Error:", err);
  process.exit(1);
});
