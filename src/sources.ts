/**
 * Catalogue of data sources and thematic groups.
 *
 * Lets users enable only part of the 85 tools (`--sources=nauka,prawo` or the
 * POLISH_ACADEMIC_SOURCES env var). The full tool list is ~26k tokens, which
 * overflows small local models and exceeds tool caps in some clients
 * (Cursor ~40, Windsurf 100, VS Code 128). With no selection every source is on,
 * so the default tool list stays stable.
 *
 * When adding a new database: add it here and map its register function in
 * `src/server.ts` (the compiler enforces the mapping).
 */

export const SOURCE_GROUPS = {
  nauka: "publikacje, repozytoria uczelni, dane badawcze, profile naukowców",
  dane: "dane publiczne: statystyka GUS (BDL), dane.gov.pl, pogoda i wody (IMGW)",
  prawo: "akty prawne (ISAP), orzeczenia sądów (SAOS), katalog Biblioteki Sejmowej",
  normy: "normy i Polski Komitet Normalizacyjny",
  kultura: "literatura, film, fotografia, plakat, archiwa, sztuka",
} as const;

export type SourceGroup = keyof typeof SOURCE_GROUPS;

export const SOURCES = [
  { id: "bn", group: "nauka", name: "Biblioteka Nauki" },
  { id: "rcin", group: "nauka", name: "RCIN — Repozytorium Cyfrowe Instytutów Naukowych" },
  { id: "ruj", group: "nauka", name: "Repozytorium Uniwersytetu Jagiellońskiego" },
  { id: "agh", group: "nauka", name: "Repozytorium AGH" },
  { id: "amu", group: "nauka", name: "Repozytorium UAM" },
  { id: "uafm", group: "nauka", name: "Repozytorium UAFM" },
  { id: "icm", group: "nauka", name: "Otwarte Dane Badawcze ICM UW" },
  { id: "rodbuk", group: "nauka", name: "RODBuK" },
  { id: "repod", group: "nauka", name: "RePOD" },
  { id: "polon", group: "nauka", name: "POL-on / RAD-on" },
  { id: "pbn", group: "nauka", name: "Polska Bibliografia Naukowa (wymaga kluczy)" },
  { id: "ludzie", group: "nauka", name: "Ludzie Nauki" },
  { id: "baztol", group: "nauka", name: "BazTOL (Politechnika Poznańska)" },
  { id: "sum", group: "nauka", name: "Katalog Biblioteki ŚUM" },
  { id: "dane", group: "dane", name: "dane.gov.pl" },
  { id: "bdl", group: "dane", name: "Bank Danych Lokalnych GUS" },
  { id: "imgw", group: "dane", name: "IMGW-PIB" },
  { id: "isap", group: "prawo", name: "ISAP / ELI API Sejmu" },
  { id: "saos", group: "prawo", name: "SAOS — orzeczenia sądów" },
  { id: "bs_sejm", group: "prawo", name: "Biblioteka Sejmowa" },
  { id: "pkn", group: "normy", name: "PKN — www.pkn.pl" },
  { id: "wiedza", group: "normy", name: "WIEDZA — katalog norm PKN" },
  { id: "wolnelektury", group: "kultura", name: "Wolne Lektury" },
  { id: "ninateka", group: "kultura", name: "Ninateka" },
  { id: "gapla", group: "kultura", name: "Gapla — plakat filmowy" },
  { id: "fototeka", group: "kultura", name: "Fototeka FINA" },
  { id: "filmpolski", group: "kultura", name: "FilmPolski.pl" },
  { id: "fototekaslaska", group: "kultura", name: "Fototeka Śląska" },
  { id: "fn_repo", group: "kultura", name: "Repozytorium Filmoteki Narodowej" },
  { id: "nac", group: "kultura", name: "Narodowe Archiwum Cyfrowe" },
  { id: "pauart", group: "kultura", name: "PAUart" },
  { id: "blz", group: "kultura", name: "Baza Legalnych Źródeł" },
  { id: "dokumenty_slaska", group: "kultura", name: "Dokumenty Śląska" },
] as const satisfies readonly { id: string; group: SourceGroup; name: string }[];

export type SourceId = (typeof SOURCES)[number]["id"];

/** Env var read when `--sources` is not passed on the command line. */
export const SOURCES_ENV = "POLISH_ACADEMIC_SOURCES";

export interface SourceSelection {
  /** Enabled source ids, in catalogue order. */
  ids: SourceId[];
  /** Tokens that matched neither a group nor a source id. */
  unknown: string[];
}

const ALL_TOKENS = new Set(["all", "wszystko", "*"]);

function expandToken(token: string): SourceId[] | null {
  if (ALL_TOKENS.has(token)) return SOURCES.map((s) => s.id);
  if (token in SOURCE_GROUPS) return SOURCES.filter((s) => s.group === token).map((s) => s.id);
  const source = SOURCES.find((s) => s.id === token);
  return source ? [source.id] : null;
}

/**
 * Parse a selection such as "nauka,prawo", "bn isap", or "all,-saos".
 * A leading "-" or "!" excludes a group or source. Undefined or empty input
 * selects everything.
 */
export function parseSourceSelection(spec: string | undefined): SourceSelection {
  const tokens = (spec ?? "")
    .split(/[\s,;]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const include = new Set<SourceId>();
  const exclude = new Set<SourceId>();
  const unknown: string[] = [];
  let sawInclude = false;

  for (const raw of tokens) {
    const negated = raw.startsWith("-") || raw.startsWith("!");
    // Accept "fn-repo" as well as "fn_repo"; leading "-" is the exclusion marker.
    const token = (negated ? raw.slice(1) : raw).replace(/-/g, "_");
    const expanded = expandToken(token);
    if (!expanded) {
      unknown.push(raw);
      continue;
    }
    if (negated) {
      expanded.forEach((id) => exclude.add(id));
    } else {
      sawInclude = true;
      expanded.forEach((id) => include.add(id));
    }
  }

  const base = sawInclude ? include : new Set<SourceId>(SOURCES.map((s) => s.id));
  const ids = SOURCES.map((s) => s.id).filter((id) => base.has(id) && !exclude.has(id));
  return { ids, unknown };
}

/** Groups that have at least one enabled source, in catalogue order. */
export function groupsOf(ids: readonly SourceId[]): SourceGroup[] {
  const enabled = new Set(ids);
  return (Object.keys(SOURCE_GROUPS) as SourceGroup[]).filter((group) =>
    SOURCES.some((s) => s.group === group && enabled.has(s.id)),
  );
}
