/**
 * Custom OTel span helpers for the Polish Academic MCP worker.
 *
 * Five span types map to the five pipeline stages:
 *   1. agent.request        — incoming MCP session / user query
 *   2. llm.call             — each call to the LLM (tokens in/out, tool decision)
 *   3. mcp.tool_selection   — tool chosen by the LLM + reasoning
 *   4. mcp.tool_execution   — actual tool call to a catalog API
 *   5. llm.response         — final generated response (hallucination markers)
 *
 * Research variables tracked:
 *   - Fragment selection log (which metadata fields were passed to LLM)
 *   - Context window usage per field (token counts)
 *   - Hallucination markers (fidelity score, classification drift)
 *   - Language quality flags (transliteration errors, code-switching)
 */

import { trace, SpanStatusCode, SpanKind, type Span } from "@opentelemetry/api";

const tracer = trace.getTracer("polish-academic-mcp", "1.0.0");

// ─────────────────────────────────────────────────────────────────────────────
// 1. Agent Request Span
//    Root span — one per incoming MCP session / user query.
//    Called from the fetch() handler before any tool dispatch.
// ─────────────────────────────────────────────────────────────────────────────
export async function withAgentRequestSpan<T>(
  sessionId: string,
  queryText: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    "agent.request",
    { kind: SpanKind.SERVER },
    async (span) => {
      try {
        span.setAttribute("span.kind", "agent.request");
        span.setAttribute("agent.session_id", sessionId);
        span.setAttribute("agent.query_length", queryText.length);
        span.setAttribute("agent.language_detected", detectLanguage(queryText));
        span.setAttribute(
          "agent.has_polish_chars",
          /[ąęóśźżćńł]/i.test(queryText),
        );
        span.setAttribute(
          "agent.query_token_estimate",
          estimateTokens(queryText),
        );
        span.setAttribute(
          "agent.query_is_boolean",
          /\bAND\b|\bOR\b|\bNOT\b/.test(queryText),
        );
        span.setAttribute(
          "agent.query_has_date_range",
          /\b\d{4}\b.*\b\d{4}\b/.test(queryText),
        );
        span.setAttribute(
          "agent.query_has_author",
          /autor|author|napisał|napisała/i.test(queryText),
        );
        span.setAttribute(
          "agent.query_has_subject",
          /temat|subject|dziedzina|UKD/i.test(queryText),
        );
        return await fn(span);
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message,
        });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. LLM Call Span
// ─────────────────────────────────────────────────────────────────────────────
export interface LlmCallMeta {
  model: string;
  tokensIn: number;
  tokensOut: number;
  toolDecision: string | null;
  reasoningTokens: number;
  // Optional prompt breakdown
  systemPromptTokens?: number;
  retrievedMetadataTokens?: number;
  userQueryTokens?: number;
  conversationHistoryTokens?: number;
  // Session context
  callSequenceN?: number;
  priorToolsInSession?: string[];
  chosenTool?: string;
}

export async function withLlmCallSpan<T>(
  meta: LlmCallMeta,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan("llm.call", async (span) => {
    try {
      span.setAttribute("span.kind", "llm.call");
      span.setAttribute("llm.model", meta.model);
      span.setAttribute("llm.tokens_in", meta.tokensIn);
      span.setAttribute("llm.tokens_out", meta.tokensOut);
      span.setAttribute("llm.tokens_total", meta.tokensIn + meta.tokensOut);
      span.setAttribute("llm.tool_decision", meta.toolDecision ?? "none");
      span.setAttribute(
        "llm.decided_to_use_tool",
        meta.toolDecision !== null,
      );
      span.setAttribute("llm.reasoning_tokens", meta.reasoningTokens);
      span.setAttribute("llm.reasoning_present", meta.reasoningTokens > 0);

      // Optional prompt breakdown
      if (meta.systemPromptTokens !== undefined) {
        span.setAttribute(
          "llm.prompt_tokens_system",
          meta.systemPromptTokens,
        );
      }
      if (meta.retrievedMetadataTokens !== undefined) {
        span.setAttribute(
          "llm.prompt_tokens_context",
          meta.retrievedMetadataTokens,
        );
      }
      if (meta.userQueryTokens !== undefined) {
        span.setAttribute(
          "llm.prompt_tokens_query",
          meta.userQueryTokens,
        );
      }
      if (meta.conversationHistoryTokens !== undefined) {
        span.setAttribute(
          "llm.prompt_tokens_history",
          meta.conversationHistoryTokens,
        );
      }
      if (
        meta.systemPromptTokens !== undefined &&
        meta.retrievedMetadataTokens !== undefined &&
        meta.userQueryTokens !== undefined
      ) {
        const total =
          meta.systemPromptTokens +
          meta.retrievedMetadataTokens +
          meta.userQueryTokens;
        span.setAttribute(
          "llm.context_fill_ratio",
          total > 0 ? meta.retrievedMetadataTokens / total : 0,
        );
      }

      // Session depth
      if (meta.callSequenceN !== undefined) {
        span.setAttribute("llm.call_sequence_n", meta.callSequenceN);
      }
      if (meta.priorToolsInSession !== undefined) {
        span.setAttribute(
          "llm.prior_tools_in_session",
          meta.priorToolsInSession.join(","),
        );
        if (meta.chosenTool) {
          span.setAttribute(
            "llm.repeated_tool",
            meta.priorToolsInSession.includes(meta.chosenTool),
          );
          span.setAttribute(
            "llm.tool_switch",
            meta.priorToolsInSession.length > 0 &&
              !meta.priorToolsInSession.includes(meta.chosenTool),
          );
        }
      }

      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Tool Selection Span
// ─────────────────────────────────────────────────────────────────────────────
export async function withToolSelectionSpan<T>(
  selectedTool: string,
  candidateTools: string[],
  selectionReason: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan("mcp.tool_selection", async (span) => {
    try {
      span.setAttribute("span.kind", "mcp.tool_selection");
      span.setAttribute("mcp.selected_tool", selectedTool);
      span.setAttribute("mcp.candidate_count", candidateTools.length);
      span.setAttribute("mcp.candidate_tools", candidateTools.join(","));
      span.setAttribute(
        "mcp.selection_reason",
        selectionReason.slice(0, 200),
      );
      span.setAttribute(
        "mcp.selection_is_first_candidate",
        candidateTools[0] === selectedTool,
      );
      span.setAttribute(
        "mcp.reasoning_word_count",
        selectionReason.split(/\s+/).length,
      );
      span.setAttribute(
        "mcp.reasoning_mentions_pl",
        /polski|polsk|Poland|Polish/i.test(selectionReason),
      );
      span.setAttribute(
        "mcp.reasoning_mentions_marc",
        /MARC|Dublin Core|UKD|metadata/i.test(selectionReason),
      );
      span.setAttribute(
        "mcp.reasoning_mentions_source",
        /biblioteka|repozytorium|baza|katalog/i.test(selectionReason),
      );
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Tool Execution Span
//    Core span for every MCP tool call — records fragment selection, context
//    window usage, latency, and output size.
// ─────────────────────────────────────────────────────────────────────────────
export interface ToolExecutionMeta {
  toolName: string;
  params: Record<string, unknown>;
  /** Metadata fields the API is expected to return for this tool */
  fieldsRequested: string[];
  /** Metadata fields actually present in the response (detected heuristically) */
  fieldsReturned: string[];
  /** Approximate token count per metadata field (estimated from raw text) */
  tokensByField: Record<string, number>;
  /** Tokens consumed by the query string itself */
  queryTokens: number;
}

export async function withToolExecutionSpan<T>(
  meta: ToolExecutionMeta,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    `mcp.tool/${meta.toolName}`,
    async (span) => {
      const start = Date.now();
      try {
        span.setAttribute("span.kind", "mcp.tool_execution");
        span.setAttribute("mcp.tool.name", meta.toolName);
        span.setAttribute(
          "mcp.tool.param_count",
          Object.keys(meta.params).length,
        );

        // Safe param attributes — no raw query text (PII risk)
        if (typeof meta.params.language === "string")
          span.setAttribute("mcp.tool.language", meta.params.language);
        if (typeof meta.params.per_page === "number")
          span.setAttribute("mcp.tool.per_page", meta.params.per_page);
        if (typeof meta.params.page === "number")
          span.setAttribute("mcp.tool.page", meta.params.page);

        // Extended params instrumentation (I-9)
        span.setAttribute(
          "params.filter_language",
          typeof meta.params.language === "string"
            ? meta.params.language
            : "none",
        );
        span.setAttribute(
          "params.filter_has_subject",
          meta.params.subject !== undefined,
        );
        span.setAttribute(
          "params.filter_has_author",
          meta.params.author !== undefined,
        );
        span.setAttribute(
          "params.query_word_count",
          String(meta.params.query ?? "")
            .split(/\s+/)
            .filter(Boolean).length,
        );
        span.setAttribute(
          "params.query_is_phrase",
          /".+"/.test(String(meta.params.query ?? "")),
        );
        span.setAttribute(
          "params.pagination_page",
          typeof meta.params.page === "number"
            ? meta.params.page
            : typeof meta.params.start === "number"
              ? meta.params.start
              : 0,
        );
        span.setAttribute(
          "params.pagination_per_page",
          typeof meta.params.per_page === "number" ? meta.params.per_page : 10,
        );

        // Fragment selection log
        span.setAttribute(
          "fragment.fields_requested",
          meta.fieldsRequested.join(","),
        );
        span.setAttribute(
          "fragment.fields_returned",
          meta.fieldsReturned.join(","),
        );
        span.setAttribute(
          "fragment.fields_requested_n",
          meta.fieldsRequested.length,
        );
        span.setAttribute(
          "fragment.fields_returned_n",
          meta.fieldsReturned.length,
        );
        const omitted = meta.fieldsRequested.filter(
          (f) => !meta.fieldsReturned.includes(f),
        );
        span.setAttribute("fragment.fields_omitted", omitted.join(","));
        span.setAttribute(
          "fragment.omission_rate",
          meta.fieldsRequested.length > 0
            ? omitted.length / meta.fieldsRequested.length
            : 0,
        );

        // Per-field boolean presence (I-7)
        for (const field of [
          "title",
          "author",
          "abstract",
          "subject",
          "ukd",
          "keywords",
          "date",
          "publisher",
          "doi",
          "language",
        ]) {
          span.setAttribute(
            `fragment.has_${field}`,
            meta.fieldsReturned.includes(field),
          );
        }

        // Context window usage per field
        const totalTokens = Object.values(meta.tokensByField).reduce(
          (a, b) => a + b,
          0,
        );
        span.setAttribute(
          "context.tokens_total",
          totalTokens + meta.queryTokens,
        );
        span.setAttribute("context.tokens_query", meta.queryTokens);
        span.setAttribute("context.tokens_metadata", totalTokens);
        span.setAttribute(
          "context.tokens_title",
          meta.tokensByField["title"] ?? 0,
        );
        span.setAttribute(
          "context.tokens_author",
          meta.tokensByField["author"] ?? 0,
        );
        span.setAttribute(
          "context.tokens_subject",
          meta.tokensByField["subject"] ?? 0,
        );
        span.setAttribute(
          "context.tokens_abstract",
          meta.tokensByField["abstract"] ?? 0,
        );
        span.setAttribute(
          "context.tokens_ukd",
          meta.tokensByField["ukd"] ?? 0,
        );
        span.setAttribute(
          "context.metadata_ratio",
          totalTokens + meta.queryTokens > 0
            ? totalTokens / (totalTokens + meta.queryTokens)
            : 0,
        );

        const result = await fn(span);

        span.setAttribute("mcp.tool.latency_ms", Date.now() - start);
        span.setAttribute(
          "mcp.tool.output_bytes",
          JSON.stringify(result).length,
        );
        span.setAttribute("mcp.tool.success", true);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setAttribute("mcp.tool.success", false);
        span.setAttribute("mcp.tool.latency_ms", Date.now() - start);
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message,
        });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Response Generation Span
// ─────────────────────────────────────────────────────────────────────────────
export interface ResponseMeta {
  tokensGenerated: number;
  responseBytes: number;
  hallucinationDetected: boolean;
  hallucinationType: "none" | "factual" | "classification" | "semantic_shift";
  fidelityScore: number;
  fieldsCited: string[];
  fieldsAdded: string[];
  originalClassification: string;
  generatedClassification: string;
  classificationMatch: boolean;
  languageDetectedResponse: string;
  hasTransliterationError: boolean;
  hasCodeSwitching: boolean;
  // Extended language fields (I-12)
  diacriticErrorsCount?: number;
  codeSwitchSentenceCount?: number;
  // Extended classification fields (I-13)
  sourceHasUkd?: boolean;
  sourceHasKaba?: boolean;
  ukdDigitsMatch?: number;
  ukdDepthOriginal?: number;
  ukdDepthGenerated?: number;
  driftDirection?: "match" | "generalized" | "specialized" | "shifted";
  // Schema type (I-10)
  schemaType?: "MARC21" | "DublinCore" | "custom";
  sourceFieldCount?: number;
  // Semantic shift (I-11)
  titlePreserved?: boolean;
  subjectGeneralized?: boolean;
  subjectShiftScore?: number;
  abstractTruncated?: boolean;
  abstractExpanded?: boolean;
}

export async function withResponseGenerationSpan<T>(
  meta: ResponseMeta,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan("llm.response", async (span) => {
    try {
      span.setAttribute("span.kind", "llm.response");
      span.setAttribute("llm.tokens_generated", meta.tokensGenerated);
      span.setAttribute("llm.response_bytes", meta.responseBytes);

      // Hallucination markers
      span.setAttribute("hallucination.detected", meta.hallucinationDetected);
      span.setAttribute("hallucination.type", meta.hallucinationType);
      span.setAttribute(
        "hallucination.fidelity_score",
        meta.fidelityScore,
      );

      // Fragment attribution
      span.setAttribute(
        "response.fields_cited",
        meta.fieldsCited.join(","),
      );
      span.setAttribute(
        "response.fields_cited_n",
        meta.fieldsCited.length,
      );
      span.setAttribute(
        "response.fields_added",
        meta.fieldsAdded.join(","),
      );
      span.setAttribute(
        "response.fields_added_n",
        meta.fieldsAdded.length,
      );
      span.setAttribute(
        "response.amplification_rate",
        meta.fieldsCited.length > 0
          ? meta.fieldsAdded.length / meta.fieldsCited.length
          : 0,
      );

      // Classification drift
      span.setAttribute(
        "classification.original",
        meta.originalClassification,
      );
      span.setAttribute(
        "classification.generated",
        meta.generatedClassification,
      );
      span.setAttribute("classification.match", meta.classificationMatch);
      span.setAttribute(
        "classification.drifted",
        !meta.classificationMatch,
      );

      // Language quality
      span.setAttribute(
        "language.response_lang",
        meta.languageDetectedResponse,
      );
      span.setAttribute(
        "language.transliteration_error",
        meta.hasTransliterationError,
      );
      span.setAttribute("language.code_switching", meta.hasCodeSwitching);

      // Extended language flags (I-12)
      if (meta.diacriticErrorsCount !== undefined)
        span.setAttribute(
          "language.diacritic_errors_count",
          meta.diacriticErrorsCount,
        );
      if (meta.codeSwitchSentenceCount !== undefined)
        span.setAttribute(
          "language.code_switch_sentence_count",
          meta.codeSwitchSentenceCount,
        );

      // Schema type (I-10)
      if (meta.schemaType !== undefined)
        span.setAttribute("source.schema_type", meta.schemaType);
      if (meta.sourceFieldCount !== undefined)
        span.setAttribute("source.field_count", meta.sourceFieldCount);

      // Extended classification (I-13)
      if (meta.sourceHasUkd !== undefined)
        span.setAttribute("classification.source_has_ukd", meta.sourceHasUkd);
      if (meta.sourceHasKaba !== undefined)
        span.setAttribute(
          "classification.source_has_kaba",
          meta.sourceHasKaba,
        );
      if (meta.ukdDigitsMatch !== undefined)
        span.setAttribute(
          "classification.ukd_digits_match",
          meta.ukdDigitsMatch,
        );
      if (meta.ukdDepthOriginal !== undefined)
        span.setAttribute(
          "classification.ukd_depth_original",
          meta.ukdDepthOriginal,
        );
      if (meta.ukdDepthGenerated !== undefined)
        span.setAttribute(
          "classification.ukd_depth_generated",
          meta.ukdDepthGenerated,
        );
      if (meta.driftDirection !== undefined)
        span.setAttribute(
          "classification.drift_direction",
          meta.driftDirection,
        );

      // Semantic shift (I-11)
      if (meta.titlePreserved !== undefined)
        span.setAttribute("semantic.title_preserved", meta.titlePreserved);
      if (meta.subjectGeneralized !== undefined)
        span.setAttribute(
          "semantic.subject_generalized",
          meta.subjectGeneralized,
        );
      if (meta.subjectShiftScore !== undefined)
        span.setAttribute(
          "semantic.subject_shift_score",
          meta.subjectShiftScore,
        );
      if (meta.abstractTruncated !== undefined)
        span.setAttribute(
          "semantic.abstract_truncated",
          meta.abstractTruncated,
        );
      if (meta.abstractExpanded !== undefined)
        span.setAttribute(
          "semantic.abstract_expanded",
          meta.abstractExpanded,
        );

      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Naive language detection based on character heuristics */
function detectLanguage(text: string): "pl" | "en" | "mixed" | "unknown" {
  const plChars = (text.match(/[ąęóśźżćńł]/gi) ?? []).length;
  const enWords = (text.match(/\b(the|and|for|with|from|that)\b/gi) ?? [])
    .length;
  if (plChars > 2) return enWords > 2 ? "mixed" : "pl";
  if (enWords > 2) return "en";
  return "unknown";
}

/**
 * Estimate token count for a string.
 * Approximation: 1 token ≈ 4 chars for Latin, 3 chars for Polish
 * (Polish morphology produces more tokens per word than English).
 */
export function estimateTokens(text: string): number {
  const plChars = (text.match(/[ąęóśźżćńł]/gi) ?? []).length;
  const ratio = plChars > text.length * 0.05 ? 3 : 4;
  return Math.ceil(text.length / ratio);
}

/**
 * Scan raw API response text for metadata field presence.
 * Works for both JSON (key names) and XML (element names) responses.
 * Returns a subset of the candidate fields that appear in the text.
 */
export function detectFieldsInText(
  text: string,
  candidates: string[],
): string[] {
  const lower = text.toLowerCase();
  return candidates.filter((field) => {
    // JSON key match: "fieldname" or field:
    // XML element match: <dc:fieldname> or <fieldname>
    return (
      lower.includes(`"${field}"`) ||
      lower.includes(`<dc:${field}`) ||
      lower.includes(`<${field}`) ||
      lower.includes(`dc.${field}`) ||
      // UKD special case: look for digit.digit patterns
      (field === "ukd" && /\b\d{1,3}\.\d/.test(text))
    );
  });
}

/** Annotate the active span — safe to call anywhere, no-op if no active span */
export function annotateCurrentSpan(
  attrs: Record<string, string | number | boolean>,
): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
}
