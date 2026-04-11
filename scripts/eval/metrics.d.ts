/**
 * Research-Question-Aligned Scoring Metrics
 * ==========================================
 * Each metric function takes a raw tool response + test case and returns
 * a numeric score (0.0–1.0) plus a structured evidence record.
 *
 * Metric families:
 *   RQ1 — Context construction & architectural constraints
 *   RQ2 — Metadata quality & epistemic error detection
 *   RQ3 — Professional role / attribution transparency
 *   RQ4 — Regulatory alignment (GDPR / EU AI Act)
 */
import type { EvalTestCase } from "./test-cases.js";
export interface MetricScore {
    metricId: string;
    rq: string;
    score: number;
    passed: boolean;
    threshold: number;
    evidence: Record<string, unknown>;
    notes: string;
}
export interface ToolResponse {
    raw: unknown;
    text: string;
    latencyMs: number;
    statusCode: number;
    spanAttributes?: Record<string, unknown>;
    error?: string;
}
export declare function scoreToolCallSuccess(response: ToolResponse): MetricScore;
/**
 * RQ1-M1: Context Fill Ratio
 * What fraction of the context window is occupied by retrieved metadata
 * vs. the query itself? High ratio = metadata-dominated context.
 */
export declare function scoreContextFillRatio(response: ToolResponse, testCase: EvalTestCase): MetricScore;
/**
 * RQ1-M2: Fragment Omission Rate
 * What fraction of requested metadata fields were omitted from the response?
 * High omission = architectural constraint is silently dropping data.
 */
export declare function scoreFragmentOmission(response: ToolResponse, testCase: EvalTestCase): MetricScore;
/**
 * RQ1-M3: Tool Selection Accuracy
 * Did the agent select the expected tool for this query type?
 */
export declare function scoreToolSelection(response: ToolResponse, testCase: EvalTestCase, selectedTool: string): MetricScore;
/**
 * RQ1-M4: Response Latency Score
 * Normalised latency score. 1.0 = instant, 0.0 = at or beyond threshold.
 */
export declare function scoreLatency(response: ToolResponse, thresholdMs?: number): MetricScore;
/**
 * RQ1-M5: Token Efficiency
 * Ratio of output tokens to input tokens. Measures how much the LLM
 * expands or compresses the retrieved metadata.
 */
export declare function scoreTokenEfficiency(response: ToolResponse): MetricScore;
/**
 * RQ2-M1: Hallucination Detection Score
 * Combines fidelity score from span with field-level checks.
 * Score 1.0 = no hallucination detected.
 */
export declare function scoreHallucination(response: ToolResponse): MetricScore;
/**
 * RQ2-M2: Classification Drift Score
 * Measures how far the generated classification drifts from the source.
 * Uses UKD digit-match depth as a proxy for semantic distance.
 */
export declare function scoreClassificationDrift(response: ToolResponse, testCase: EvalTestCase): MetricScore;
/**
 * RQ2-M3: Language Quality Score
 * Detects diacritic errors, code-switching, and transliteration mistakes
 * in Polish/English bilingual metadata.
 */
export declare function scoreLanguageQuality(response: ToolResponse, testCase: EvalTestCase): MetricScore;
/**
 * RQ2-M4: Semantic Shift Score
 * Measures whether the LLM preserves the semantic content of titles,
 * subjects, and abstracts without generalising or specialising.
 */
export declare function scoreSemanticShift(response: ToolResponse): MetricScore;
/**
 * RQ2-M5: Ground Truth Fidelity
 * Compares response field values against known ground truth.
 * Only applicable when testCase.groundTruth is defined.
 */
export declare function scoreGroundTruthFidelity(response: ToolResponse, testCase: EvalTestCase): MetricScore;
/**
 * RQ3-M1: Attribution Transparency
 * Measures whether the response clearly attributes information to its
 * source record rather than presenting it as AI-generated knowledge.
 */
export declare function scoreAttributionTransparency(response: ToolResponse): MetricScore;
/**
 * RQ3-M2: Tool Reasoning Auditability
 * Checks whether the tool-selection reasoning is logged in a form
 * that a librarian could review and understand.
 */
export declare function scoreReasoningAuditability(response: ToolResponse): MetricScore;
/**
 * RQ3-M3: Cataloguing Completeness
 * For metadata-enrichment tasks, checks whether all required fields
 * are present in the output (simulates cataloguing quality check).
 */
export declare function scoreCataloguingCompleteness(response: ToolResponse, testCase: EvalTestCase): MetricScore;
/**
 * RQ4-M1: PII Exposure Score
 * Detects whether personal data (names, ORCIDs, emails, affiliations)
 * is exposed beyond what is necessary for the task.
 * Score 1.0 = no unnecessary PII exposure.
 */
export declare function scorePiiExposure(response: ToolResponse, testCase: EvalTestCase): MetricScore;
/**
 * RQ4-M2: Audit Trail Completeness
 * Checks that the OTel span contains all attributes required for
 * GDPR-compliant audit logging.
 */
export declare function scoreAuditTrail(response: ToolResponse): MetricScore;
/**
 * RQ4-M3: Data Minimisation Score
 * Checks whether the agent selects the least-invasive metadata schema
 * when personal data is not required for the task.
 */
export declare function scoreDataMinimisation(response: ToolResponse, testCase: EvalTestCase): MetricScore;
/**
 * RQ4-M4: AI Transparency (EU AI Act Art. 52)
 * Checks whether AI-generated content is labelled as such,
 * especially for high-risk domains (law, medicine, education).
 */
export declare function scoreAiTransparency(response: ToolResponse, testCase: EvalTestCase): MetricScore;
export interface CompositeScore {
    testCaseId: string;
    rq: string[];
    metrics: MetricScore[];
    compositeScore: number;
    passed: boolean;
    failedMetrics: string[];
}
export declare function computeCompositeScore(response: ToolResponse, testCase: EvalTestCase, selectedTool: string): CompositeScore;
