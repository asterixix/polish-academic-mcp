/**
 * Evaluation Configuration — Polish Academic MCP Server
 * ======================================================
 * Aligned to four research questions:
 *
 *   RQ1 — Architectural properties: context construction & constraints
 *   RQ2 — Metadata quality: hallucinations, semantic shifts, misclassifications
 *   RQ3 — Professional roles: librarian epistemic responsibility
 *   RQ4 — Regulatory alignment: GDPR / EU AI Act compatibility
 *
 * Run:
 *   npm run eval              — all RQs against localhost:8787
 *   npm run eval -- --rq RQ2 — only RQ2 cases
 *   npm run eval:remote -- --rq RQ4
 *   npm run eval -- --rq RQ4 --url https://polish-academic-mcp.kolpol25.workers.dev/mcp
 */

// ─────────────────────────────────────────────────────────────────────────────
// Metric Thresholds (per RQ)
// ─────────────────────────────────────────────────────────────────────────────

export const THRESHOLDS = {
  /** RQ1 — Architecture */
  RQ1: {
    contextFillRatioMin: 0.10,   // metadata must be ≥10% of context
    contextFillRatioMax: 0.90,   // metadata must not crowd out the query
    fragmentOmissionMax: 0.30,   // at most 30% of requested fields may be omitted
    latencyMs: 5_000,            // 5 s per tool call
    tokenExpansionMin: 0.10,     // LLM must produce at least 10% of input tokens
    tokenExpansionMax: 2.00,     // LLM must not expand more than 2× input
  },

  /** RQ2 — Metadata quality */
  RQ2: {
    hallucinationFidelityMin: 0.80,   // fidelity score must be ≥0.80
    amplificationRateMax: 0.50,       // LLM may add at most 50% extra fields
    classificationDriftMin: 0.70,     // UKD depth-match score ≥0.70
    languageQualityMin: 0.80,         // diacritic / transliteration score ≥0.80
    semanticShiftMin: 0.70,           // title + subject preservation ≥0.70
    groundTruthFidelityMin: 0.80,     // known-value match rate ≥0.80
  },

  /** RQ3 — Professional roles */
  RQ3: {
    attributionTransparencyMin: 0.50, // source attribution present
    reasoningWordCountMin: 5,         // tool-selection reasoning ≥5 words
    cataloguingCompletenessMin: 0.80, // ≥80% of required MARC/DC fields present
  },

  /** RQ4 — Regulatory alignment */
  RQ4: {
    piiExposureMax: 0.00,             // zero unnecessary PII in response
    auditTrailMin: 1.00,              // all required OTel attributes present
    dataMinimisationMin: 0.80,        // least-invasive schema selected
    aiTransparencyHighRiskMin: 0.60,  // AI label required in high-risk domains
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Server configuration
// ─────────────────────────────────────────────────────────────────────────────

export const SERVER_CONFIG = {
  localUrl: "http://localhost:8787/mcp",
  remoteUrl: process.env["MCP_SERVER_URL"] ?? "http://localhost:8787/mcp",
  /** Set EVAL_MODE=true in wrangler.jsonc to enable span attribute injection */
  evalModeEnvVar: "EVAL_MODE",
};

// ─────────────────────────────────────────────────────────────────────────────
// Report settings
// ─────────────────────────────────────────────────────────────────────────────

export const REPORT_CONFIG = {
  outputDir: "./eval-results",
  /** Include full metric evidence objects in JSON output */
  includeEvidence: true,
  /** Print per-case details to stdout */
  verbose: true,
  /** Fail the process with exit code 1 if overall score < this */
  minPassScore: 0.60,
};

// ─────────────────────────────────────────────────────────────────────────────
// Variable mapping — links eval metrics to tracing.ts span attributes
// This documents which OTel attributes feed each metric.
// ─────────────────────────────────────────────────────────────────────────────

export const VARIABLE_MAP = {
  // RQ1
  "RQ1-M1_contextFillRatio":    "context.metadata_ratio",
  "RQ1-M2_fragmentOmission":    "fragment.omission_rate",
  "RQ1-M3_toolSelection":       "mcp.selected_tool",
  "RQ1-M4_latency":             "mcp.tool.latency_ms",
  "RQ1-M5_tokenEfficiency":     ["llm.tokens_in", "llm.tokens_out"],

  // RQ2
  "RQ2-M1_hallucination":       ["hallucination.detected", "hallucination.fidelity_score"],
  "RQ2-M2_classificationDrift": ["classification.match", "classification.drift_direction"],
  "RQ2-M3_languageQuality":     ["language.transliteration_error", "language.diacritic_errors_count"],
  "RQ2-M4_semanticShift":       ["semantic.title_preserved", "semantic.subject_shift_score"],
  "RQ2-M5_groundTruth":         "response.text",

  // RQ3
  "RQ3-M1_attribution":         ["response.fields_cited_n", "response.fields_added_n"],
  "RQ3-M2_reasoning":           ["mcp.selection_reason", "mcp.reasoning_word_count"],
  "RQ3-M3_cataloguing":         "fragment.fields_returned",

  // RQ4
  "RQ4-M1_piiExposure":         "response.text",
  "RQ4-M2_auditTrail":          ["agent.session_id", "mcp.tool.name", "mcp.tool.latency_ms"],
  "RQ4-M3_dataMinimisation":    ["source.schema_type", "source.field_count"],
  "RQ4-M4_aiTransparency":      "response.text",
} as const;
