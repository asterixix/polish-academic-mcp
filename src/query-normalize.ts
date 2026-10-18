/**
 * Universal research-query normalization for Meta-Router + AI Search.
 * Conversational / meta / database-name noise routinely returns 0 hits
 * from Polish public APIs (SAOS, ISAP, BDL, repositories). This module
 * extracts a core phrase, year bounds, and light variants for fan-out.
 */

export type QueryHints = {
  judgments: boolean;
  legislation: boolean;
  stats: boolean;
  publications: boolean;
  culture: boolean;
  norms: boolean;
};

export type NormalizedQuery = {
  original: string;
  /** Clean phrase suitable for full-text / keyword APIs. */
  core: string;
  /** Alternative phrasings to try when the core returns empty. */
  variants: string[];
  /** First 20xx year found → YYYY-01-01 */
  yearFrom?: string;
  yearTo?: string;
  hints: QueryHints;
};

/** Source / product names that poison full-text search when left in the query. */
const SOURCE_META =
  /\b(saos|isap|bdl|gus|pbn|polon|ruj|repod|rodbuk|ppm|rcin|agh|amu|uafm|icm|pkn|baztol|blz|nac|pauart|ninateka|gapla|fototeka|filmpolski|filmoteka|wolne\s*lektury|biblioteka\s*nauki|biblioteka\s*sejmowa|bs\s*sejm|dane\.gov(?:\.pl)?|radon|eli\b|mcp|meta[- ]?router)\b/gi;

/** Conversational fluff and task verbs (PL + EN). */
const CONVERSATIONAL =
  /(?<=[^\p{L}\p{N}]|^)(co\s+mówi[ąa]?|jakie\s+są|jaki\s+jest|czy\s+(?:istniej|można|są)|powiedz(?:\s+mi)?|znajd[źz]|wyszukaj|szukam|chcę\s+wiedzieć|interesuje\s+mnie|prosz[ęe](?:\s+o)?|daj\s+mi|pokaż|opisz|wyjaśnij|podsumuj|przeanalizuj|sprawd[źz]|sprawdz|zweryfikuj|ustal|porównaj|what\s+(?:do|are|is)|tell\s+me|find|search\s+for|check|please)(?=[^\p{L}\p{N}]|$)/giu;

/** Generic result-type / meta nouns that rarely help APIs. */
const META_NOUNS =
  /\b(orzeczeni\w*|wyrok\w*|ustaw\w*|rozporządzeni\w*|publikacj\w*|artykuł\w*|rekord\w*|wynik\w*|danych|dane|informacj\w*|baza|bazy|bazie|api|search|judgment\w*|ruling\w*|dataset\w*|źródł\w*|źródeł|dokument\w*|plik\w*|pdf)\b/gi;

/** Prepositions / fillers around years. */
const YEAR_FILLERS = /\b(po|od|do|sprzed|przed|na(?:\s+rok)?|w\s+roku|after|since|from|until|before|year|rok(?:u|iem)?|lata(?:ch)?)\b/gi;

const PLURAL_FIXES: Array<[RegExp, string]> = [
  [/\bkredyty\b/gi, "kredyt"],
  [/\bfrankowe\b/gi, "frankowy"],
  [/\bwalutowe\b/gi, "walutowy"],
  [/\bartykuły\b/gi, "artykuł"],
  [/\bpublikacje\b/gi, "publikacja"],
  [/\bustawy\b/gi, "ustawa"],
  [/\bnormy\b/gi, "norma"],
  [/\bfilmy\b/gi, "film"],
  [/\bksiążki\b/gi, "książka"],
  [/\bcudzoziemc(?:ach|ami|om|ów|a)\b/gi, "cudzoziemcy"],
  [/\bkrakowie\b/gi, "kraków"],
  [/\bwarszawie\b/gi, "warszawa"],
  [/\bwrocławiu\b/gi, "wrocław"],
  [/\bpoznaniu\b/gi, "poznań"],
  [/\bgdańsku\b/gi, "gdańsk"],
  [/\bpolsce\b/gi, "polska"],
  [/\bmałopolsc(?:e|ie)|małopolskim\b/gi, "małopolska"],
];

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function extractYears(text: string): { years: string[]; cleaned: string } {
  const currentYear = new Date().getFullYear();
  // shortcut: lata przyszłe (np. "do 2050") są usuwane z frazy, ale nie stają się filtrem daty; wymaga osobnej obsługi zakresów "do YYYY"
  const years = [...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)]
    .map((m) => m[1])
    .filter((y) => Number(y) <= currentYear);
  const cleaned = text.replace(/\b(19\d{2}|20\d{2})\b/g, " ");
  return { years: [...new Set(years)], cleaned };
}

function applyPluralFixes(text: string): string {
  let out = text;
  for (const [re, rep] of PLURAL_FIXES) out = out.replace(re, rep);
  return out;
}

function detectHints(original: string): QueryHints {
  const q = original.toLowerCase();
  const hasStats = /\b(gus|bdl|statyst|bezroboc|inflac|ludność|demograf|dane\.gov|\bdane\b|cudzoziem|obcokrajow|migra|mieszka[ńn]c|meldun)/i.test(q);
  return {
    judgments: /\b(saos|orzeczen|wyrok|sąd|frankow|kredyt\s+walut)/i.test(q),
    legislation: /\b(isap|ustaw|rozporząd|kodeks|eli\b|dziennik\s+ustaw)/i.test(q),
    stats: hasStats,
    publications:
      /\b(publikac|artykuł|doi|orcid|repozytor|nauka|bibliograf|badaw)/i.test(q) ||
      (!/\b(saos|isap|gus|bdl|norma|film|książ|dane|statyst|demograf|bezroboc|ludno)/i.test(q) && q.length > 0),
    culture: /\b(film|książ|lektur|fotografi|plakat|archiw|muzeum|sztuk|ninateka|teatr)/i.test(q),
    norms: /\b(norma|pkn|iso\b|pn-|standard)/i.test(q),
  };
}

/**
 * Normalize a user or model search string into an API-friendly core phrase.
 */
export function normalizeResearchQuery(input: string): NormalizedQuery {
  const original = (input || "").trim();
  if (!original) {
    return {
      original: "",
      core: "",
      variants: [],
      hints: {
        judgments: false,
        legislation: false,
        stats: false,
        publications: false,
        culture: false,
        norms: false,
      },
    };
  }

  const hints = detectHints(original);
  const { years, cleaned: withoutYears } = extractYears(original);

  let core = withoutYears
    .replace(SOURCE_META, " ")
    .replace(CONVERSATIONAL, " ")
    .replace(META_NOUNS, " ")
    .replace(YEAR_FILLERS, " ")
    .replace(/[?？！!…]+/g, " ")
    .replace(/[„”"«»]/g, " ")
    .replace(/[,:;|/\\]+/g, " ");

  core = applyPluralFixes(collapseSpaces(core));

  // Drop leftover tiny stopwords
  core = collapseSpaces(
    core
      .split(/\s+/)
      .filter((w) => w.length > 1 || /^\d+$/.test(w))
      .join(" "),
  );

  if (!core || core.length < 2) {
    // Fallback: only strip source names + conversational, keep domain nouns
    core = collapseSpaces(
      applyPluralFixes(
        original
          .replace(SOURCE_META, " ")
          .replace(CONVERSATIONAL, " ")
          .replace(YEAR_FILLERS, " ")
          .replace(/\b(19\d{2}|20\d{2})\b/g, " "),
      ),
    );
  }
  if (!core) core = original;

  const variants: string[] = [];
  // Shorter variant: first 2–4 content tokens
  const tokens = core.split(/\s+/).filter(Boolean);
  if (tokens.length > 3) {
    variants.push(tokens.slice(0, 3).join(" "));
  }
  if (tokens.length > 2) {
    variants.push(tokens.slice(0, 2).join(" "));
  }
  // Without soft adjectives if any remain
  const noSoft = tokens.filter((t) => !/^(dotycząc\w*|w\s+sprawie|o)$/i.test(t)).join(" ");
  if (noSoft && noSoft !== core) variants.push(noSoft);
  // Stats: BDL matches short indicator labels (AND on all words) — add bare stems.
  if (hints.stats) {
    if (/\bbezroboc/i.test(original)) {
      variants.push("bezrobocie", "stopa bezrobocia", "stopa bezrobocia rejestrowanego", "bezrobotni");
    }
    if (/\binflac/i.test(original)) variants.push("inflacja");
    if (/\bludno[sś]ć|demograf/i.test(original)) variants.push("ludność", "demografia");
  }

  const uniqueVariants = [...new Set(variants.map(collapseSpaces).filter((v) => v && v !== core))];

  const sortedYears = [...years].sort();
  const yearFrom = sortedYears[0] ? `${sortedYears[0]}-01-01` : undefined;
  const yearTo = sortedYears.length > 1 ? `${sortedYears[sortedYears.length - 1]}-12-31` : undefined;

  return { original, core, variants: uniqueVariants, yearFrom, yearTo, hints };
}

/** Prefer schema date fields when present. */
export function dateFiltersForSchema(
  schemaKeys: string[],
  norm: NormalizedQuery,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!norm.yearFrom) return out;
  if (schemaKeys.includes("judgment_date_from")) out.judgment_date_from = norm.yearFrom;
  else if (schemaKeys.includes("date_from")) out.date_from = norm.yearFrom;
  else if (schemaKeys.includes("from")) out.from = norm.yearFrom;
  else if (schemaKeys.includes("year_from")) out.year_from = norm.yearFrom.slice(0, 4);
  else if (schemaKeys.includes("year") && !schemaKeys.includes("year_to")) {
    // Only set year when it is a single bound field and we have one year
    if (!norm.yearTo) out.year = norm.yearFrom.slice(0, 4);
  }
  if (norm.yearTo) {
    if (schemaKeys.includes("judgment_date_to")) out.judgment_date_to = norm.yearTo;
    else if (schemaKeys.includes("date_to")) out.date_to = norm.yearTo;
    else if (schemaKeys.includes("to")) out.to = norm.yearTo;
    else if (schemaKeys.includes("year_to")) out.year_to = norm.yearTo.slice(0, 4);
  }
  return out;
}

/**
 * Geo / admin words poison BDL variable-name search (AND match on N1…N5).
 * "bezrobocie województwie małopolskim" → 0 hits; "bezrobocie" → trafienia + dane wojewódzkie.
 */
const BDL_GEO_ADMIN =
  /\b(województw\w*|powiat\w*|gmin\w*|miast\w*|miasto|metropoli\w*|region\w*|według|wg|poziomie?|terytorialn\w*|w\s+podziale|na\s+poziomie|dla\s+obszaru|małopolsk\w*|mazowieck\w*|śląsk\w*|slask\w*|wielkopolsk\w*|dolnośląsk\w*|dolnoslask\w*|pomorsk\w*|łódzk\w*|lodzk\w*|lubelsk\w*|podkarpack\w*|świętokrzysk\w*|swietokrzysk\w*|podlask\w*|warmińsk\w*|warminsk\w*|mazursk\w*|kujawsk\w*|zachodniopomorsk\w*|opolsk\w*|lubusk\w*|kraków|krakow|warszawa|wrocław|wroclaw|poznań|poznan|gdańsk|gdansk|łódź|lodz|szczecin|lublin|bydgoszcz|białystok|bialystok|katowice|gdynia)\b/gi;

/**
 * Rewrite a free-text query field for a given source tool.
 * Returns the cleaned string (and optional date filters to merge).
 */
export function normalizeQueryForSource(
  query: string,
  sourceId: string,
  schemaKeys: string[],
): { query: string; filters: Record<string, string> } {
  const norm = normalizeResearchQuery(query);
  let q = norm.core;
  // SAOS-specific light lemma already in plural fixes
  if (sourceId === "saos" && /\bkredyt\b/i.test(q) && /\bfrank/i.test(query)) {
    if (!/\bfrankowy\b/i.test(q)) q = collapseSpaces(`${q} frankowy`);
  }
  if (sourceId === "bdl" || sourceId === "imgw") {
    // BDL: zostaw wyłącznie nazwę wskaźnika. IMGW: synop nie przyjmuje fraz geograficznych jako query.
    q = collapseSpaces(q.replace(BDL_GEO_ADMIN, " "));
    if (!q && /\bbezroboc/i.test(query)) q = "bezrobocie";
    if (!q && /\binflac/i.test(query)) q = "inflacja";
    if (!q) q = norm.variants[0] || norm.core || query.trim();
  }
  return { query: q || query.trim(), filters: dateFiltersForSchema(schemaKeys, norm) };
}
