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
  /\b(co\s+mówi[ąa]?|jakie\s+są|jaki\s+jest|czy\s+(?:istniej|można|są)|powiedz(?:\s+mi)?|znajd[źz]|wyszukaj|szukam|chcę\s+wiedzieć|interesuje\s+mnie|proszę\s+o|daj\s+mi|pokaż|opisz|wyjaśnij|podsumuj|przeanalizuj|what\s+(?:do|are|is)|tell\s+me|find|search\s+for|please)\b/gi;

/** Generic result-type / meta nouns that rarely help APIs. */
const META_NOUNS =
  /\b(orzeczeni\w*|wyrok\w*|ustaw\w*|rozporządzeni\w*|publikacj\w*|artykuł\w*|rekord\w*|wynik\w*|danych|dane|informacj\w*|baza|bazy|bazie|api|search|judgment\w*|ruling\w*|dataset\w*|źródł\w*|źródeł|dokument\w*|plik\w*|pdf)\b/gi;

/** Prepositions / fillers around years. */
const YEAR_FILLERS = /\b(po|od|do|sprzed|przed|after|since|from|until|before|year|rok(?:u|iem)?|lata(?:ch)?)\b/gi;

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
];

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function extractYears(text: string): { years: string[]; cleaned: string } {
  const years = [...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => m[1]);
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
  return {
    judgments: /\b(saos|orzeczen|wyrok|sąd|frankow|kredyt\s+walut)/i.test(q),
    legislation: /\b(isap|ustaw|rozporząd|kodeks|eli\b|dziennik\s+ustaw)/i.test(q),
    stats: /\b(gus|bdl|statyst|bezroboc|inflac|ludność|demograf|dane\.gov)/i.test(q),
    publications:
      /\b(publikac|artykuł|doi|orcid|repozytor|nauka|bibliograf|badaw)/i.test(q) ||
      (!/\b(saos|isap|gus|bdl|norma|film|książ)/i.test(q) && q.length > 0),
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
  return { query: q || query.trim(), filters: dateFiltersForSchema(schemaKeys, norm) };
}
