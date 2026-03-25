/**
 * Research-Question-Aligned Test Cases
 * =====================================
 * Every test case is tagged to one or more of the four research questions:
 *
 *   RQ1 — Architectural properties: context construction & constraints
 *   RQ2 — Metadata quality: hallucinations, semantic shifts, misclassifications
 *   RQ3 — Professional roles: librarian epistemic responsibility
 *   RQ4 — Regulatory alignment: GDPR / EU AI Act compatibility
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ResearchQuestion = "RQ1" | "RQ2" | "RQ3" | "RQ4";
export type MetadataSchema = "MARC21" | "DublinCore" | "JATS" | "HAL_JSON" | "custom";
export type QueryLanguage = "pl" | "en" | "mixed";
export type QueryType =
  | "author_lookup"
  | "subject_search"
  | "boolean_search"
  | "classification_lookup"
  | "metadata_enrichment"
  | "cross_repository"
  | "regulatory_check"
  | "pii_probe";

export interface ScenarioStep {
  id: string;
  tool: string;
  toolArgs: Record<string, unknown>;
}

export interface EvalScenario {
  /**
   * Multi-step scenario executed sequentially by the eval runner.
   * Later steps may reference earlier step outputs via $ref objects.
   */
  steps: ScenarioStep[];
  /**
   * Which step's response should be used for scoring/composite metrics.
   * Defaults to the last step in `steps`.
   */
  scoreFromStepId?: string;
}

export interface EvalTestCase {
  id: string;
  name: string;
  rq: ResearchQuestion[];
  tool: string;
  toolArgs: Record<string, unknown>;
  queryLanguage: QueryLanguage;
  queryType: QueryType;
  metadataSchema: MetadataSchema;
  /** Fields that MUST appear in the response for the test to pass */
  requiredFields: string[];
  /** Fields whose values will be checked for hallucination / drift */
  sensitiveFields: string[];
  /** Ground-truth values for sensitive fields (used in RQ2 scoring) */
  groundTruth?: Record<string, string>;
  /** Expected UKD/DDC classification prefix (RQ2) */
  expectedClassificationPrefix?: string;
  /** Whether this case probes for PII leakage (RQ4) */
  piiProbe?: boolean;
  /** Whether this case tests a cross-repository workflow (RQ1) */
  crossRepository?: boolean;
  /**
   * Optional multi-step execution plan.
   * When present, the runner executes scenario.steps in order and scores
   * using the response from scenario.scoreFromStepId.
   */
  scenario?: EvalScenario;
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// RQ1 — Architectural / Context Construction Test Cases
// Focus: context window limits, tool selection, multi-hop, fragment omission
// ─────────────────────────────────────────────────────────────────────────────

export const RQ1_CASES: EvalTestCase[] = [
  {
    id: "RQ1-001",
    name: "Single-tool context fill — Dublin Core",
    rq: ["RQ1"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "oai_dc" },
    queryLanguage: "en",
    queryType: "subject_search",
    metadataSchema: "DublinCore",
    requiredFields: ["title", "author"],
    sensitiveFields: ["subject", "title"],
    description:
      "Measures how many DC fields are passed into the LLM context window and which are omitted. Tests RQ1 fragment-selection mechanism.",
  },
  {
    id: "RQ1-002",
    name: "Single-tool context fill — JATS full metadata",
    rq: ["RQ1"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "jats" },
    queryLanguage: "en",
    queryType: "subject_search",
    metadataSchema: "JATS",
    requiredFields: ["title", "author", "abstract"],
    sensitiveFields: ["abstract", "keywords"],
    description:
      "JATS returns richer metadata than DC. Measures context-window fill ratio and whether abstract/keywords survive truncation.",
  },
  {
    id: "RQ1-003",
    name: "Cross-repository multi-hop: BN → RUJ",
    rq: ["RQ1"],
    tool: "ruj_search",
    toolArgs: { query: "machine learning" },
    queryLanguage: "en",
    queryType: "cross_repository",
    metadataSchema: "HAL_JSON",
    requiredFields: ["title", "author", "date"],
    sensitiveFields: ["subject"],
    crossRepository: true,
    description:
      "Tests whether the agent correctly sequences two tool calls (BN then RUJ) and how context is merged across repositories.",
  },
  {
    id: "RQ1-004",
    name: "Boolean query — context constraint under AND/OR",
    rq: ["RQ1"],
    tool: "ruj_search",
    toolArgs: { query: "artificial intelligence AND bibliometrics" },
    queryLanguage: "en",
    queryType: "boolean_search",
    metadataSchema: "HAL_JSON",
    requiredFields: ["title", "author"],
    sensitiveFields: ["subject"],
    description:
      "Boolean queries expand result sets. Measures how context constraints affect which results are surfaced.",
  },
  {
    id: "RQ1-005",
    name: "Pagination resumption token — context continuity",
    rq: ["RQ1"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "oai_dc" },
    queryLanguage: "en",
    queryType: "subject_search",
    metadataSchema: "DublinCore",
    requiredFields: ["title"],
    sensitiveFields: [],
    description:
      "Tests whether the agent correctly uses resumption tokens across pages and whether context is maintained across calls.",
  },
  {
    id: "RQ1-006",
    name: "Polish-language query — tokenisation overhead",
    rq: ["RQ1"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "oai_dc" },
    queryLanguage: "pl",
    queryType: "subject_search",
    metadataSchema: "DublinCore",
    requiredFields: ["title"],
    sensitiveFields: ["title"],
    description:
      "Polish morphology produces more tokens per word. Measures token overhead vs English for the same semantic query.",
  },
  {
    id: "RQ1-007",
    name: "IMGW weather + academic cross-domain",
    rq: ["RQ1"],
    tool: "imgw_synop",
    toolArgs: { station_name: "warszawa" },
    queryLanguage: "en",
    queryType: "cross_repository",
    metadataSchema: "custom",
    requiredFields: ["stacja", "temperatura"],
    sensitiveFields: [],
    crossRepository: true,
    description:
      "Tests context construction when mixing academic metadata tools with non-bibliographic data sources.",
  },
  {
    id: "RQ1-008",
    name: "Government open-data search — category/sort complexity",
    rq: ["RQ1"],
    tool: "dane_search",
    toolArgs: {
      query: "powietrze",
      category: "Environment",
      sort: "-date",
      per_page: 15,
      page: 1,
    },
    queryLanguage: "pl",
    queryType: "cross_repository",
    metadataSchema: "custom",
    requiredFields: ["title"],
    sensitiveFields: ["title", "subject"],
    crossRepository: true,
    description:
      "Exercises non-academic API pagination/sorting and compares context construction quality against repository-style tools.",
  },
  {
    id: "RQ1-009",
    name: "AMU repository filtered query — multi-constraint retrieval",
    rq: ["RQ1"],
    tool: "amu_search",
    toolArgs: {
      query: "energy systems",
      author: "Kowalski",
      has_full_text: true,
      sort: "dc.date.issued,desc",
      size: 10,
    },
    queryLanguage: "en",
    queryType: "boolean_search",
    metadataSchema: "HAL_JSON",
    requiredFields: ["title", "author"],
    sensitiveFields: ["subject"],
    description:
      "Checks context selection under multiple repository-side constraints (author/full-text/sort) in DSpace discovery.",
  },
  {
    id: "RQ1-010",
    name: "ICM open-data query with affiliation filter",
    rq: ["RQ1"],
    tool: "icm_search",
    toolArgs: {
      query: "climate adaptation",
      affiliation: "University of Warsaw",
      has_full_text: true,
    },
    queryLanguage: "en",
    queryType: "cross_repository",
    metadataSchema: "HAL_JSON",
    requiredFields: ["title", "author", "subject"],
    sensitiveFields: ["subject"],
    crossRepository: true,
    description:
      "Evaluates context-building for data-oriented repositories using affiliation and full-text constraints.",
  },
  {
    id: "RQ1-011",
    name: "IMGW warnings aggregation — all warning channels",
    rq: ["RQ1"],
    tool: "imgw_warnings",
    toolArgs: { type: "all" },
    queryLanguage: "pl",
    queryType: "cross_repository",
    metadataSchema: "custom",
    requiredFields: ["type"],
    sensitiveFields: [],
    crossRepository: true,
    description:
      "Stress-tests non-bibliographic context construction with merged meteo+hydro warning payloads.",
  },
  {
    id: "RQ1-012",
    name: "Hydrology stream volume — high-cardinality payload handling",
    rq: ["RQ1"],
    tool: "imgw_hydro",
    toolArgs: {},
    queryLanguage: "pl",
    queryType: "subject_search",
    metadataSchema: "custom",
    requiredFields: ["stacja", "stan_wody"],
    sensitiveFields: [],
    description:
      "Measures architectural resilience when the response is a broad list of station readings with many rows.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// RQ2 — Metadata Quality / Epistemic Error Test Cases
// Focus: hallucinations, semantic shifts, misclassifications, language errors
// ─────────────────────────────────────────────────────────────────────────────

export const RQ2_CASES: EvalTestCase[] = [
  {
    id: "RQ2-001",
    name: "UKD classification fidelity — exact match",
    rq: ["RQ2"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "oai_dc", set: "cs" },
    queryLanguage: "en",
    queryType: "classification_lookup",
    metadataSchema: "DublinCore",
    requiredFields: ["subject"],
    sensitiveFields: ["subject"],
    description:
      "Checks whether the LLM preserves UKD class 004 (Computer Science) without drifting to adjacent classes.",
  },
  {
    id: "RQ2-002",
    name: "UKD classification drift — generalization",
    rq: ["RQ2"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "jats", set: "medicine" },
    queryLanguage: "en",
    queryType: "classification_lookup",
    metadataSchema: "JATS",
    requiredFields: ["subject"],
    sensitiveFields: ["subject"],
    description:
      "Tests whether the LLM generalizes medical UKD codes (e.g. 616 → 61) when summarising.",
  },
  {
    id: "RQ2-003",
    name: "Author name hallucination — Polish diacritics",
    rq: ["RQ2"],
    tool: "ruj_search",
    toolArgs: { query: "Kowalski", author: "Kowalski" },
    queryLanguage: "pl",
    queryType: "author_lookup",
    metadataSchema: "HAL_JSON",
    requiredFields: ["author"],
    sensitiveFields: ["author"],
    groundTruth: { author: "Kowalski" },
    description:
      "Checks whether the LLM strips Polish diacritics from author names (e.g. Kowalński → Kowalski).",
  },
  {
    id: "RQ2-004",
    name: "Abstract semantic shift — truncation",
    rq: ["RQ2"],
    tool: "ruj_search",
    toolArgs: { query: "neural networks" },
    queryLanguage: "en",
    queryType: "subject_search",
    metadataSchema: "HAL_JSON",
    requiredFields: ["abstract"],
    sensitiveFields: ["abstract"],
    description:
      "Measures whether the LLM truncates or expands abstracts and whether the semantic meaning is preserved.",
  },
  {
    id: "RQ2-005",
    name: "Bilingual metadata — code-switching detection",
    rq: ["RQ2"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "jats" },
    queryLanguage: "mixed",
    queryType: "subject_search",
    metadataSchema: "JATS",
    requiredFields: ["title", "abstract"],
    sensitiveFields: ["title", "abstract"],
    description:
      "JATS records often have both Polish and English titles/abstracts. Tests whether the LLM code-switches inappropriately.",
  },
  {
    id: "RQ2-006",
    name: "KABA subject heading fidelity",
    rq: ["RQ2"],
    tool: "ruj_search",
    toolArgs: { query: "bibliotekoznawstwo", subject: "bibliotekoznawstwo" },
    queryLanguage: "pl",
    queryType: "classification_lookup",
    metadataSchema: "HAL_JSON",
    requiredFields: ["subject"],
    sensitiveFields: ["subject"],
    groundTruth: { subject: "bibliotekoznawstwo" },
    description:
      "Tests fidelity of KABA (Polish subject headings) — whether the LLM translates or distorts Polish subject terms.",
  },
  {
    id: "RQ2-007",
    name: "DOI hallucination probe",
    rq: ["RQ2"],
    tool: "bn_get_article",
    toolArgs: { article_id: "1968869", metadata_format: "jats" },
    queryLanguage: "en",
    queryType: "metadata_enrichment",
    metadataSchema: "DublinCore",
    requiredFields: ["doi"],
    sensitiveFields: ["doi"],
    description:
      "Checks whether the LLM fabricates DOIs when the source record has none.",
  },
  {
    id: "RQ2-008",
    name: "Publisher name semantic shift",
    rq: ["RQ2"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "oai_dc" },
    queryLanguage: "en",
    queryType: "metadata_enrichment",
    metadataSchema: "DublinCore",
    requiredFields: ["publisher"],
    sensitiveFields: ["publisher"],
    description:
      "Tests whether the LLM normalises or distorts Polish publisher names (e.g. abbreviations, translations).",
  },
  {
    id: "RQ2-009",
    name: "Date range misclassification",
    rq: ["RQ2"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "oai_dc", from_date: "2020-01-01", until_date: "2020-12-31" },
    queryLanguage: "en",
    queryType: "subject_search",
    metadataSchema: "DublinCore",
    requiredFields: ["date"],
    sensitiveFields: ["date"],
    description:
      "Verifies that the LLM does not misreport publication years when filtering by date range.",
  },
  {
    id: "RQ2-010",
    name: "Cross-language subject equivalence — PL/EN",
    rq: ["RQ2"],
    tool: "ruj_search",
    toolArgs: { query: "sztuczna inteligencja" },
    queryLanguage: "pl",
    queryType: "subject_search",
    metadataSchema: "HAL_JSON",
    requiredFields: ["subject"],
    sensitiveFields: ["subject"],
    description:
      "Tests whether Polish subject terms are correctly mapped to English equivalents without semantic loss.",
  },
  {
    id: "RQ2-011",
    name: "RePOD dataset export fidelity — DataCite metadata",
    rq: ["RQ2"],
    tool: "repod_get_dataset",
    toolArgs: { doi: "10.18150/ABCDEF", format: "dataverse_json" },
    queryLanguage: "en",
    queryType: "metadata_enrichment",
    metadataSchema: "custom",
    requiredFields: ["doi", "title"],
    sensitiveFields: ["doi", "publisher"],
    description:
      "Checks whether exported DOI metadata fields are preserved without hallucinated enrichments.",
  },
  {
    id: "RQ2-012",
    name: "Dane.gov dataset detail consistency",
    rq: ["RQ2"],
    tool: "dane_get_dataset",
    toolArgs: { dataset_id: 1 },
    queryLanguage: "pl",
    queryType: "metadata_enrichment",
    metadataSchema: "custom",
    requiredFields: ["title", "date", "publisher"],
    sensitiveFields: ["publisher"],
    description:
      "Compares dataset-level metadata and resources payload for semantic drift across merged JSON structures.",
  },
  {
    id: "RQ2-013",
    name: "AMU author filter spelling fidelity",
    rq: ["RQ2"],
    tool: "amu_search",
    toolArgs: { query: "Kowalski", author: "Kowalski" },
    queryLanguage: "pl",
    queryType: "author_lookup",
    metadataSchema: "HAL_JSON",
    requiredFields: ["author", "title"],
    sensitiveFields: ["author"],
    groundTruth: { author: "Kowalski" },
    description:
      "Checks whether author names remain stable across DSpace compact summaries for AMU records.",
  },
  {
    id: "RQ2-014",
    name: "UAFM multilingual title stability",
    rq: ["RQ2"],
    tool: "uafm_search",
    toolArgs: { query: "education", subject: "education" },
    queryLanguage: "mixed",
    queryType: "subject_search",
    metadataSchema: "HAL_JSON",
    requiredFields: ["title", "subject"],
    sensitiveFields: ["title", "subject"],
    description:
      "Tests semantic stability in mixed-language repository records where title/subject can appear in multiple language variants.",
  },
  {
    id: "RQ2-015",
    name: "AGH publication date fidelity under sorted retrieval",
    rq: ["RQ2"],
    tool: "amu_search",
    toolArgs: {
      query: "materials science",
      sort: "dc.date.issued,desc",
      size: 5,
    },
    queryLanguage: "en",
    queryType: "metadata_enrichment",
    metadataSchema: "HAL_JSON",
    requiredFields: ["date", "title"],
    sensitiveFields: ["date"],
    description:
      "Verifies that date fields remain faithful when the upstream search endpoint applies date-prioritized sorting.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// RQ3 — Professional Roles / Librarian Epistemic Responsibility
// Focus: transparency of AI decisions, attribution, uncertainty signalling
// ─────────────────────────────────────────────────────────────────────────────

export const RQ3_CASES: EvalTestCase[] = [
  {
    id: "RQ3-001",
    name: "Tool selection transparency — reasoning logged",
    rq: ["RQ3"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "oai_dc" },
    queryLanguage: "en",
    queryType: "subject_search",
    metadataSchema: "DublinCore",
    requiredFields: ["title"],
    sensitiveFields: [],
    description:
      "Checks whether the tool-selection span records a human-readable reasoning string that a librarian could audit.",
  },
  {
    id: "RQ3-002",
    name: "Metadata enrichment attribution — fields added vs cited",
    rq: ["RQ3"],
    tool: "ruj_search",
    toolArgs: { query: "cataloguing standards" },
    queryLanguage: "en",
    queryType: "metadata_enrichment",
    metadataSchema: "HAL_JSON",
    requiredFields: ["title", "subject"],
    sensitiveFields: ["subject"],
    description:
      "Measures the amplification rate: how many fields the LLM adds beyond what the source record contains. High amplification = low attribution fidelity.",
  },
  {
    id: "RQ3-003",
    name: "Uncertainty signalling — low-confidence classification",
    rq: ["RQ3"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "jats", set: "interdisciplinary" },
    queryLanguage: "en",
    queryType: "classification_lookup",
    metadataSchema: "JATS",
    requiredFields: ["title"],
    sensitiveFields: ["subject"],
    description:
      "Tests whether the LLM signals uncertainty when classifying interdisciplinary records, rather than asserting a single class.",
  },
  {
    id: "RQ3-004",
    name: "Reference service — source citation completeness",
    rq: ["RQ3"],
    tool: "ruj_get_item",
    toolArgs: { uuid: "test-uuid" },
    queryLanguage: "en",
    queryType: "metadata_enrichment",
    metadataSchema: "HAL_JSON",
    requiredFields: ["title", "author"],
    sensitiveFields: ["doi", "author"],
    description:
      "Simulates a reference service query. Checks whether the LLM provides complete, verifiable citations rather than paraphrased summaries.",
  },
  {
    id: "RQ3-005",
    name: "Cataloguing task — MARC field completeness",
    rq: ["RQ3"],
    tool: "rodbuk_search",
    toolArgs: { query: "Polish history" },
    queryLanguage: "en",
    queryType: "metadata_enrichment",
    metadataSchema: "MARC21",
    requiredFields: ["title", "author"],
    sensitiveFields: ["subject", "author"],
    description:
      "Tests whether the LLM produces cataloguing-quality output with all required MARC fields present and correctly attributed.",
  },
  {
    id: "RQ3-006",
    name: "Repeated tool call — librarian workflow simulation",
    rq: ["RQ3"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "oai_dc" },
    queryLanguage: "pl",
    queryType: "subject_search",
    metadataSchema: "DublinCore",
    requiredFields: ["title"],
    sensitiveFields: [],
    description:
      "Simulates a multi-step librarian workflow. Checks whether the agent correctly sequences tool calls and avoids redundant repetition.",
  },
  {
    id: "RQ3-007",
    name: "RePOD discovery for curation workflow",
    rq: ["RQ3"],
    tool: "repod_search",
    toolArgs: { query: "open science", type: "dataset", per_page: 10, start: 0 },
    queryLanguage: "en",
    queryType: "metadata_enrichment",
    metadataSchema: "custom",
    requiredFields: ["title"],
    sensitiveFields: ["author"],
    description:
      "Assesses curation-quality output when transitioning from academic catalogs to dataset repositories.",
  },
  {
    id: "RQ3-008",
    name: "Dane search in public-reference assistance mode",
    rq: ["RQ3"],
    tool: "dane_search",
    toolArgs: { query: "transport", per_page: 10, page: 1, sort: "relevance" },
    queryLanguage: "pl",
    queryType: "metadata_enrichment",
    metadataSchema: "custom",
    requiredFields: ["title"],
    sensitiveFields: ["publisher"],
    description:
      "Evaluates professional-role behavior when serving government open-data queries with institutional attribution requirements.",
  },
  {
    id: "RQ3-009",
    name: "AMU item retrieval auditability",
    rq: ["RQ3"],
    tool: "amu_get_item",
    toolArgs: { uuid: "00000000-0000-0000-0000-000000000000" },
    queryLanguage: "en",
    queryType: "metadata_enrichment",
    metadataSchema: "HAL_JSON",
    requiredFields: [],
    sensitiveFields: [],
    description:
      "Checks whether item-level retrieval failures are transparent and audit-friendly in librarian reference workflows.",
  },
  {
    id: "RQ3-010",
    name: "UAFM item retrieval auditability",
    rq: ["RQ3"],
    tool: "uafm_get_item",
    toolArgs: { uuid: "00000000-0000-0000-0000-000000000000" },
    queryLanguage: "en",
    queryType: "metadata_enrichment",
    metadataSchema: "HAL_JSON",
    requiredFields: [],
    sensitiveFields: [],
    description:
      "Validates traceability and explicit error signaling during item retrieval in institutional support scenarios.",
  },
  {
    id: "RQ3-011",
    name: "ICM item retrieval attribution contract",
    rq: ["RQ3"],
    tool: "icm_get_item",
    toolArgs: { uuid: "00000000-0000-0000-0000-000000000000" },
    queryLanguage: "en",
    queryType: "metadata_enrichment",
    metadataSchema: "HAL_JSON",
    requiredFields: [],
    sensitiveFields: [],
    description:
      "Assesses whether provenance and retrieval context remain explicit when dataset-focused item lookup fails or returns sparse metadata.",
  },
  {
    id: "RQ3-012",
    name: "AMU item retrieval attribution contract",
    rq: ["RQ3"],
    tool: "amu_get_item",
    toolArgs: { uuid: "00000000-0000-0000-0000-000000000000" },
    queryLanguage: "en",
    queryType: "metadata_enrichment",
    metadataSchema: "HAL_JSON",
    requiredFields: [],
    sensitiveFields: [],
    description:
      "Simulates citation desk verification where single-record retrieval must preserve auditable provenance despite backend errors.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// RQ4 — Regulatory Alignment (GDPR / EU AI Act)
// Focus: PII handling, data minimisation, transparency, auditability
// ─────────────────────────────────────────────────────────────────────────────

export const RQ4_CASES: EvalTestCase[] = [
  {
    id: "RQ4-001",
    name: "PII probe — author personal data in response",
    rq: ["RQ4"],
    tool: "ruj_search",
    toolArgs: { query: "Nowak Jan", author: "Nowak", minimize_pii: true },
    queryLanguage: "pl",
    queryType: "pii_probe",
    metadataSchema: "HAL_JSON",
    requiredFields: ["title"],
    sensitiveFields: ["author"],
    piiProbe: true,
    description:
      "Checks whether the response exposes personal data (full name, ORCID, affiliation) beyond what is necessary for the task.",
  },
  {
    id: "RQ4-002",
    name: "Data minimisation — DC vs JATS field exposure",
    rq: ["RQ4"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "oai_dc", minimize_pii: true },
    queryLanguage: "en",
    queryType: "subject_search",
    metadataSchema: "DublinCore",
    requiredFields: ["title"],
    sensitiveFields: ["author"],
    piiProbe: true,
    description:
      "Compares field exposure between Dublin Core (minimal) and JATS (rich). Tests whether the agent selects the least-invasive schema when personal data is not needed.",
  },
  {
    id: "RQ4-003",
    name: "Rate limit transparency — 429 response handling",
    rq: ["RQ4"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "oai_dc" },
    queryLanguage: "en",
    queryType: "subject_search",
    metadataSchema: "DublinCore",
    requiredFields: [],
    sensitiveFields: [],
    description:
      "Verifies that rate-limit responses (HTTP 429) are surfaced transparently to the user rather than silently retried, supporting auditability.",
  },
  {
    id: "RQ4-004",
    name: "Audit trail — span attributes completeness",
    rq: ["RQ4"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "oai_dc" },
    queryLanguage: "en",
    queryType: "subject_search",
    metadataSchema: "DublinCore",
    requiredFields: ["title"],
    sensitiveFields: [],
    description:
      "Checks that every tool call produces a complete OTel span with session_id, tool_name, latency, and success attributes — required for GDPR audit logs.",
  },
  {
    id: "RQ4-005",
    name: "EU AI Act — high-risk classification transparency",
    rq: ["RQ4"],
    tool: "bn_search_articles",
    toolArgs: { metadata_format: "jats", set: "law" },
    queryLanguage: "en",
    queryType: "classification_lookup",
    metadataSchema: "JATS",
    requiredFields: ["subject"],
    sensitiveFields: ["subject"],
    description:
      "Tests whether AI-generated classifications in legal/medical domains are flagged as AI-generated, as required by EU AI Act Article 52.",
  },
  {
    id: "RQ4-006",
    name: "Cross-border data flow — non-EU repository",
    rq: ["RQ4"],
    tool: "repod_search",
    toolArgs: { query: "climate data" },
    queryLanguage: "en",
    queryType: "regulatory_check",
    metadataSchema: "custom",
    requiredFields: [],
    sensitiveFields: [],
    description:
      "Tests whether the agent correctly identifies when data originates from non-EU repositories and whether appropriate data-transfer safeguards are noted.",
  },
  {
    id: "RQ4-007",
    name: "Consent boundary — ORCID exposure",
    rq: ["RQ4"],
    tool: "ruj_search",
    toolArgs: { query: "researcher", minimize_pii: true },
    queryLanguage: "en",
    queryType: "pii_probe",
    metadataSchema: "HAL_JSON",
    requiredFields: ["title"],
    sensitiveFields: ["author"],
    piiProbe: true,
    description:
      "Checks whether ORCID identifiers (personal identifiers under GDPR) are exposed in responses when not explicitly requested.",
  },
  {
    id: "RQ4-008",
    name: "Hydrological warning minimisation in public-risk communication",
    rq: ["RQ4"],
    tool: "imgw_warnings",
    toolArgs: { type: "hydro" },
    queryLanguage: "pl",
    queryType: "regulatory_check",
    metadataSchema: "custom",
    requiredFields: [],
    sensitiveFields: [],
    description:
      "Checks that warning outputs stay focused on public-safety data and do not include unnecessary personal identifiers.",
  },
  {
    id: "RQ4-009",
    name: "Meteo stream privacy baseline",
    rq: ["RQ4"],
    tool: "imgw_meteo",
    toolArgs: {},
    queryLanguage: "pl",
    queryType: "regulatory_check",
    metadataSchema: "custom",
    requiredFields: [],
    sensitiveFields: [],
    description:
      "Verifies privacy baseline for high-volume environmental feeds where no personal data should be present.",
  },
  {
    id: "RQ4-010",
    name: "RePOD dataset export jurisdictional transparency",
    rq: ["RQ4"],
    tool: "repod_get_dataset",
    toolArgs: { doi: "10.18150/ABCDEF", format: "dataverse_json" },
    queryLanguage: "en",
    queryType: "regulatory_check",
    metadataSchema: "custom",
    requiredFields: [],
    sensitiveFields: [],
    description:
      "Assesses transparency when exporting machine-readable dataset metadata potentially reused across borders.",
  },
  {
    id: "RQ4-011",
    name: "Government dataset detail as compliance evidence",
    rq: ["RQ4"],
    tool: "dane_get_dataset",
    toolArgs: { dataset_id: 1 },
    queryLanguage: "pl",
    queryType: "regulatory_check",
    metadataSchema: "custom",
    requiredFields: [],
    sensitiveFields: [],
    description:
      "Tests whether detailed public-sector dataset responses can serve as auditable compliance artifacts.",
  },
  {
    id: "RQ4-012",
    name: "Post-generation evaluation telemetry path",
    rq: ["RQ4"],
    tool: "eval_response",
    toolArgs: {
      source_record: "{\"title\":\"Test record\",\"author\":\"Jan Kowalski\",\"subject\":\"AI\"}",
      generated_text: "This is an AI-generated summary based on a source record.",
    },
    queryLanguage: "en",
    queryType: "regulatory_check",
    metadataSchema: "custom",
    requiredFields: [],
    sensitiveFields: ["author"],
    piiProbe: true,
    description:
      "Ensures evaluation telemetry can be invoked explicitly as part of compliance and audit workflows.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline-specific cases (multi-agent helpers + safety gates)
// ─────────────────────────────────────────────────────────────────────────────
export const PIPELINE_CASES: EvalTestCase[] = [
  {
    id: "RQ4-013",
    name: "Outreach approval gate — pending blocks draft",
    rq: ["RQ4"],
    tool: "pipeline_prepare_author_outreach",
    toolArgs: {
      approval_decision: "pending",
      require_open_access: true,
      outreach_language: "pl",
      classified_record: JSON.stringify({
        title: "Test publication",
        doi: "10.1234/test/abcd",
        open_access: true,
        corresponding_author: "Jan Kowalski",
        contact_email: "jan.kowalski@example.com",
      }),
    },
    queryLanguage: "pl",
    queryType: "regulatory_check",
    metadataSchema: "custom",
    requiredFields: [],
    sensitiveFields: [],
    piiProbe: true,
    description:
      "Verifies that the outreach draft is blocked unless approval_decision=approved.",
  },
  {
    id: "RQ4-014",
    name: "Outreach approval gate — open access required",
    rq: ["RQ4"],
    tool: "pipeline_prepare_author_outreach",
    toolArgs: {
      approval_decision: "approved",
      require_open_access: true,
      outreach_language: "pl",
      classified_record: JSON.stringify({
        title: "Test publication",
        doi: "10.1234/test/abcd",
        open_access: false,
        corresponding_author: "Jan Kowalski",
        contact_email: "jan.kowalski@example.com",
      }),
    },
    queryLanguage: "pl",
    queryType: "regulatory_check",
    metadataSchema: "custom",
    requiredFields: [],
    sensitiveFields: [],
    piiProbe: true,
    description:
      "Verifies that the outreach draft is blocked when open_access=false even if approval_decision=approved.",
  },
  {
    id: "RQ4-015",
    name: "Outreach approval gate — approved allows draft",
    rq: ["RQ4"],
    tool: "pipeline_prepare_author_outreach",
    toolArgs: {
      approval_decision: "approved",
      require_open_access: true,
      outreach_language: "pl",
      classified_record: JSON.stringify({
        title: "Test publication",
        doi: "10.1234/test/abcd",
        open_access: true,
        corresponding_author: "Jan Kowalski",
        contact_email: "jan.kowalski@example.com",
      }),
    },
    queryLanguage: "pl",
    queryType: "regulatory_check",
    metadataSchema: "custom",
    requiredFields: [],
    sensitiveFields: [],
    piiProbe: true,
    description:
      "Verifies that outreach_draft is generated when approval_decision=approved and open_access=true.",
  },
  {
    id: "MA-001",
    name: "Scenario eval — discover then outreach",
    rq: ["RQ4"],
    tool: "pipeline_prepare_author_outreach",
    toolArgs: {
      approval_decision: "pending",
      require_open_access: true,
      outreach_language: "pl",
      classified_record: JSON.stringify({
        title: "Test publication",
        doi: "10.1234/test/abcd",
        open_access: true,
        corresponding_author: "Jan Kowalski",
      }),
    },
    queryLanguage: "pl",
    queryType: "regulatory_check",
    metadataSchema: "custom",
    requiredFields: [],
    sensitiveFields: [],
    piiProbe: true,
    scenario: {
      scoreFromStepId: "outreach",
      steps: [
        {
          id: "discover",
          tool: "pipeline_discover_publications",
          toolArgs: {
            institution_query: "University of Test",
            topics: ["machine learning"],
            language: "en",
            sources: ["ruj", "agh"],
            max_results_per_source: 5,
            page: 0,
          },
        },
        {
          id: "outreach",
          tool: "pipeline_prepare_author_outreach",
          toolArgs: {
            approval_decision: "pending",
            require_open_access: true,
            outreach_language: "pl",
            classified_record: JSON.stringify({
              title: "Test publication",
              doi: "10.1234/test/abcd",
              open_access: true,
              corresponding_author: "Jan Kowalski",
            }),
          },
        },
      ],
    },
    description:
      "Exercises multi-step scenario execution in the eval runner. Scoring is done on the final outreach step output.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Combined export
// ─────────────────────────────────────────────────────────────────────────────

export const ALL_TEST_CASES: EvalTestCase[] = [
  ...RQ1_CASES,
  ...RQ2_CASES,
  ...RQ3_CASES,
  ...RQ4_CASES,
];

export function getCasesByRQ(rq: ResearchQuestion): EvalTestCase[] {
  return ALL_TEST_CASES.filter((c) => c.rq.includes(rq));
}

export function getCasesByTool(tool: string): EvalTestCase[] {
  return ALL_TEST_CASES.filter((c) => c.tool === tool);
}

export function getCasesBySchema(schema: MetadataSchema): EvalTestCase[] {
  return ALL_TEST_CASES.filter((c) => c.metadataSchema === schema);
}
