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
export function scoreToolCallSuccess(response) {
    const text = response.text.trim();
    const hasErrorPrefix = /^error[:\s]/i.test(text);
    const isHttpFailure = response.statusCode >= 400;
    const ok = !response.error && !hasErrorPrefix && !isHttpFailure;
    return {
        metricId: "CORE-M1",
        rq: "CORE",
        score: ok ? 1 : 0,
        passed: ok,
        threshold: 1.0,
        evidence: {
            statusCode: response.statusCode,
            error: response.error,
            hasErrorPrefix,
        },
        notes: ok
            ? "Tool call completed successfully."
            : `Tool call failed: ${response.error ?? `status=${response.statusCode}`}`,
    };
}
function hasAnySpanAttributes(response) {
    const span = response.spanAttributes ?? {};
    return Object.keys(span).length > 0;
}
function estimateTextTokens(text) {
    const normalized = text.trim();
    if (!normalized)
        return 0;
    return Math.ceil(normalized.length / 4);
}
function hasFieldInText(text, field) {
    const f = field.toLowerCase();
    const patterns = {
        title: /article-title|dc:title|<title|\"title\"|title/i,
        author: /dc:creator|dc\.contributor\.author|creator|contributor|\"authors?\"|author|authors/i,
        date: /dc:date|dateissued|issued|published|\"date\"|date/i,
        subject: /dc:subject|\"subject\"|subject|keywords?/i,
        abstract: /dc:description|jats:abstract|\"abstract\"|abstract|description/i,
        doi: /dc:identifier\.doi|\"doi\"|doi|10\.\d{4,9}\//i,
        publisher: /dc:publisher|\"publisher\"|publisher/i,
        language: /dc:language|\"language\"|language|lang/i,
    };
    const pattern = patterns[f];
    if (pattern)
        return pattern.test(text);
    return text.includes(f);
}
// ─────────────────────────────────────────────────────────────────────────────
// RQ1 Metrics — Architectural Properties & Context Construction
// ─────────────────────────────────────────────────────────────────────────────
/**
 * RQ1-M1: Context Fill Ratio
 * What fraction of the context window is occupied by retrieved metadata
 * vs. the query itself? High ratio = metadata-dominated context.
 */
export function scoreContextFillRatio(response, testCase) {
    if (!hasAnySpanAttributes(response)) {
        return {
            metricId: "RQ1-M1",
            rq: "RQ1",
            score: 1.0,
            passed: true,
            threshold: 0.1,
            evidence: { skipped: true, reason: "No context token span attributes available" },
            notes: "No context-token span data (remote non-eval mode) — skipped.",
        };
    }
    const span = response.spanAttributes ?? {};
    const metadataTokens = Number(span["context.tokens_metadata"] ?? estimateTextTokens(response.text));
    const queryTokens = Number(span["context.tokens_query"] ?? estimateTextTokens(JSON.stringify(testCase.toolArgs)));
    const totalTokens = metadataTokens + queryTokens;
    const ratio = totalTokens > 0 ? metadataTokens / totalTokens : 0;
    return {
        metricId: "RQ1-M1",
        rq: "RQ1",
        score: ratio,
        passed: ratio >= 0.1 && ratio <= 0.9, // pathological if <10% or >90%
        threshold: 0.1,
        evidence: {
            metadataTokens,
            queryTokens,
            totalTokens,
            contextFillRatio: ratio,
            fieldBreakdown: {
                title: span["context.tokens_title"],
                author: span["context.tokens_author"],
                abstract: span["context.tokens_abstract"],
                subject: span["context.tokens_subject"],
                ukd: span["context.tokens_ukd"],
            },
        },
        notes: `Context fill ratio: ${(ratio * 100).toFixed(1)}%. ${ratio > 0.9 ? "WARNING: metadata dominates — query may be lost." :
            ratio < 0.1 ? "WARNING: very little metadata in context." : "OK"}`,
    };
}
/**
 * RQ1-M2: Fragment Omission Rate
 * What fraction of requested metadata fields were omitted from the response?
 * High omission = architectural constraint is silently dropping data.
 */
export function scoreFragmentOmission(response, testCase) {
    const span = response.spanAttributes ?? {};
    const text = response.text.toLowerCase();
    const requiredPresent = testCase.requiredFields.filter((f) => hasFieldInText(text, f));
    const omissionRate = Number(span["fragment.omission_rate"] ??
        (testCase.requiredFields.length > 0
            ? 1 - requiredPresent.length / testCase.requiredFields.length
            : 0));
    const omittedFields = String(span["fragment.fields_omitted"] ?? "")
        .split(",")
        .filter(Boolean);
    const requestedN = Number(span["fragment.fields_requested_n"] ?? 0);
    const returnedN = Number(span["fragment.fields_returned_n"] ?? 0);
    // Check required fields are present
    const missingRequired = testCase.requiredFields.filter((f) => String(span["fragment.fields_returned"] ?? "").includes(f) ||
        hasFieldInText(text, f)
        ? false
        : true);
    const score = missingRequired.length === 0 ? 1 - omissionRate : 0;
    return {
        metricId: "RQ1-M2",
        rq: "RQ1",
        score,
        passed: missingRequired.length === 0 && omissionRate < 0.3,
        threshold: 0.7,
        evidence: {
            omissionRate,
            omittedFields,
            requestedN,
            returnedN,
            missingRequired,
        },
        notes: missingRequired.length > 0
            ? `FAIL: required fields missing: ${missingRequired.join(", ")}`
            : `Omission rate: ${(omissionRate * 100).toFixed(1)}%`,
    };
}
/**
 * RQ1-M3: Tool Selection Accuracy
 * Did the agent select the expected tool for this query type?
 */
export function scoreToolSelection(response, testCase, selectedTool) {
    const correct = selectedTool === testCase.tool;
    const span = response.spanAttributes ?? {};
    const isFirstCandidate = Boolean(span["mcp.selection_is_first_candidate"]);
    const candidateCount = Number(span["mcp.candidate_count"] ?? 1);
    return {
        metricId: "RQ1-M3",
        rq: "RQ1",
        score: correct ? 1.0 : 0.0,
        passed: correct,
        threshold: 1.0,
        evidence: {
            expectedTool: testCase.tool,
            selectedTool,
            isFirstCandidate,
            candidateCount,
            selectionReason: span["mcp.selection_reason"],
        },
        notes: correct
            ? `Correct tool selected${isFirstCandidate ? " (first candidate)" : ""}.`
            : `FAIL: expected "${testCase.tool}", got "${selectedTool}".`,
    };
}
/**
 * RQ1-M4: Response Latency Score
 * Normalised latency score. 1.0 = instant, 0.0 = at or beyond threshold.
 */
export function scoreLatency(response, thresholdMs = 5000) {
    const latency = response.latencyMs;
    const score = Math.max(0, 1 - latency / thresholdMs);
    return {
        metricId: "RQ1-M4",
        rq: "RQ1",
        score,
        passed: latency < thresholdMs,
        threshold: thresholdMs,
        evidence: { latencyMs: latency, thresholdMs },
        notes: `Latency: ${latency}ms (threshold: ${thresholdMs}ms)`,
    };
}
/**
 * RQ1-M5: Token Efficiency
 * Ratio of output tokens to input tokens. Measures how much the LLM
 * expands or compresses the retrieved metadata.
 */
export function scoreTokenEfficiency(response) {
    if (!hasAnySpanAttributes(response)) {
        return {
            metricId: "RQ1-M5",
            rq: "RQ1",
            score: 1.0,
            passed: true,
            threshold: 0.5,
            evidence: { skipped: true, reason: "No llm token span attributes available" },
            notes: "No llm token span data (remote non-eval mode) — skipped.",
        };
    }
    const span = response.spanAttributes ?? {};
    const tokensIn = Number(span["llm.tokens_in"] ?? estimateTextTokens(JSON.stringify(response.raw)));
    const tokensOut = Number(span["llm.tokens_out"] ?? estimateTextTokens(response.text));
    const ratio = tokensIn > 0 ? tokensOut / tokensIn : 0;
    // Ideal: output is 20–80% of input (compressed but not trivial)
    const score = ratio >= 0.2 && ratio <= 0.8 ? 1.0 :
        ratio < 0.2 ? ratio / 0.2 :
            Math.max(0, 1 - (ratio - 0.8) / 0.8);
    return {
        metricId: "RQ1-M5",
        rq: "RQ1",
        score,
        passed: ratio >= 0.1 && ratio <= 2.0,
        threshold: 0.5,
        evidence: { tokensIn, tokensOut, expansionRatio: ratio },
        notes: `Token expansion ratio: ${ratio.toFixed(2)} (${tokensIn} in → ${tokensOut} out)`,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// RQ2 Metrics — Metadata Quality & Epistemic Error
// ─────────────────────────────────────────────────────────────────────────────
/**
 * RQ2-M1: Hallucination Detection Score
 * Combines fidelity score from span with field-level checks.
 * Score 1.0 = no hallucination detected.
 */
export function scoreHallucination(response) {
    const span = response.spanAttributes ?? {};
    const detected = Boolean(span["hallucination.detected"]);
    const halType = String(span["hallucination.type"] ?? "none");
    const fidelity = Number(span["hallucination.fidelity_score"] ?? 1.0);
    const fieldsAdded = Number(span["response.fields_added_n"] ?? 0);
    const fieldsCited = Number(span["response.fields_cited_n"] ?? 0);
    const amplification = fieldsCited > 0 ? fieldsAdded / fieldsCited : 0;
    // Penalise both detected hallucinations and high amplification
    const score = detected ? fidelity * 0.5 : Math.max(0, 1 - amplification * 0.2);
    return {
        metricId: "RQ2-M1",
        rq: "RQ2",
        score,
        passed: !detected && amplification < 0.5,
        threshold: 0.8,
        evidence: {
            hallucinationDetected: detected,
            hallucinationType: halType,
            fidelityScore: fidelity,
            fieldsAdded,
            fieldsCited,
            amplificationRate: amplification,
        },
        notes: detected
            ? `HALLUCINATION DETECTED: type=${halType}, fidelity=${fidelity.toFixed(2)}`
            : `No hallucination. Amplification rate: ${(amplification * 100).toFixed(1)}%`,
    };
}
/**
 * RQ2-M2: Classification Drift Score
 * Measures how far the generated classification drifts from the source.
 * Uses UKD digit-match depth as a proxy for semantic distance.
 */
export function scoreClassificationDrift(response, testCase) {
    const span = response.spanAttributes ?? {};
    const hasClassificationSpan = span["classification.match"] !== undefined ||
        span["classification.generated"] !== undefined ||
        span["classification.original"] !== undefined;
    if (!hasClassificationSpan && !testCase.expectedClassificationPrefix) {
        return {
            metricId: "RQ2-M2",
            rq: "RQ2",
            score: 1.0,
            passed: true,
            threshold: 0.7,
            evidence: { skipped: true, reason: "No classification span data and no expected prefix" },
            notes: "No classification evidence available — skipped.",
        };
    }
    const classMatch = Boolean(span["classification.match"]);
    const driftDirection = String(span["classification.drift_direction"] ?? "match");
    const ukdDigitsMatch = Number(span["classification.ukd_digits_match"] ?? 0);
    const ukdDepthOriginal = Number(span["classification.ukd_depth_original"] ?? 1);
    const original = String(span["classification.original"] ?? "");
    const generated = String(span["classification.generated"] ?? "");
    // Check against expected prefix if provided
    const prefixMatch = testCase.expectedClassificationPrefix
        ? generated.startsWith(testCase.expectedClassificationPrefix)
        : classMatch;
    const depthScore = ukdDepthOriginal > 0 ? ukdDigitsMatch / ukdDepthOriginal : 1;
    const score = prefixMatch ? depthScore : depthScore * 0.3;
    return {
        metricId: "RQ2-M2",
        rq: "RQ2",
        score,
        passed: prefixMatch && driftDirection !== "shifted",
        threshold: 0.7,
        evidence: {
            classificationMatch: classMatch,
            driftDirection,
            ukdDigitsMatch,
            ukdDepthOriginal,
            depthScore,
            original,
            generated,
            expectedPrefix: testCase.expectedClassificationPrefix,
        },
        notes: classMatch
            ? `Classification preserved. Drift direction: ${driftDirection}`
            : `DRIFT: "${original}" → "${generated}" (direction: ${driftDirection})`,
    };
}
/**
 * RQ2-M3: Language Quality Score
 * Detects diacritic errors, code-switching, and transliteration mistakes
 * in Polish/English bilingual metadata.
 */
export function scoreLanguageQuality(response, testCase) {
    const span = response.spanAttributes ?? {};
    const transliterationError = Boolean(span["language.transliteration_error"]);
    const codeSwitching = Boolean(span["language.code_switching"]);
    const diacriticErrors = Number(span["language.diacritic_errors_count"] ?? 0);
    const codeSwitchSentences = Number(span["language.code_switch_sentence_count"] ?? 0);
    const responseLang = String(span["language.response_lang"] ?? "unknown");
    // For mixed-language test cases, code-switching is expected
    const codeSwitchPenalty = testCase.queryLanguage === "mixed" ? 0 : codeSwitchSentences * 0.1;
    const score = Math.max(0, 1.0
        - (transliterationError ? 0.3 : 0)
        - (diacriticErrors * 0.05)
        - codeSwitchPenalty);
    return {
        metricId: "RQ2-M3",
        rq: "RQ2",
        score,
        passed: !transliterationError && diacriticErrors === 0,
        threshold: 0.8,
        evidence: {
            transliterationError,
            codeSwitching,
            diacriticErrors,
            codeSwitchSentences,
            responseLang,
            queryLanguage: testCase.queryLanguage,
        },
        notes: [
            transliterationError ? "TRANSLITERATION ERROR detected" : null,
            diacriticErrors > 0 ? `${diacriticErrors} diacritic error(s)` : null,
            codeSwitching && testCase.queryLanguage !== "mixed" ? "Unexpected code-switching" : null,
        ].filter(Boolean).join("; ") || `Language quality OK (${responseLang})`,
    };
}
/**
 * RQ2-M4: Semantic Shift Score
 * Measures whether the LLM preserves the semantic content of titles,
 * subjects, and abstracts without generalising or specialising.
 */
export function scoreSemanticShift(response) {
    const span = response.spanAttributes ?? {};
    const titlePreserved = span["semantic.title_preserved"] !== false;
    const subjectGeneralized = Boolean(span["semantic.subject_generalized"]);
    const subjectShiftScore = Number(span["semantic.subject_shift_score"] ?? 0);
    const abstractTruncated = Boolean(span["semantic.abstract_truncated"]);
    const abstractExpanded = Boolean(span["semantic.abstract_expanded"]);
    const score = Math.max(0, 1.0
        - (titlePreserved ? 0 : 0.4)
        - (subjectGeneralized ? 0.2 : 0)
        - (subjectShiftScore * 0.2)
        - (abstractTruncated ? 0.1 : 0)
        - (abstractExpanded ? 0.1 : 0));
    return {
        metricId: "RQ2-M4",
        rq: "RQ2",
        score,
        passed: titlePreserved && !subjectGeneralized && subjectShiftScore < 0.3,
        threshold: 0.7,
        evidence: {
            titlePreserved,
            subjectGeneralized,
            subjectShiftScore,
            abstractTruncated,
            abstractExpanded,
        },
        notes: [
            !titlePreserved ? "Title not preserved" : null,
            subjectGeneralized ? "Subject was generalized" : null,
            subjectShiftScore > 0.3 ? `Subject shift score: ${subjectShiftScore.toFixed(2)}` : null,
            abstractTruncated ? "Abstract truncated" : null,
            abstractExpanded ? "Abstract expanded (possible hallucination)" : null,
        ].filter(Boolean).join("; ") || "Semantic content preserved",
    };
}
/**
 * RQ2-M5: Ground Truth Fidelity
 * Compares response field values against known ground truth.
 * Only applicable when testCase.groundTruth is defined.
 */
export function scoreGroundTruthFidelity(response, testCase) {
    if (!testCase.groundTruth || Object.keys(testCase.groundTruth).length === 0) {
        return {
            metricId: "RQ2-M5",
            rq: "RQ2",
            score: 1.0,
            passed: true,
            threshold: 0.8,
            evidence: { skipped: true },
            notes: "No ground truth defined — skipped.",
        };
    }
    const text = response.text.toLowerCase();
    const matches = {};
    let matchCount = 0;
    for (const [field, expected] of Object.entries(testCase.groundTruth)) {
        const found = text.includes(expected.toLowerCase());
        matches[field] = found;
        if (found)
            matchCount++;
    }
    const total = Object.keys(testCase.groundTruth).length;
    const score = total > 0 ? matchCount / total : 1.0;
    return {
        metricId: "RQ2-M5",
        rq: "RQ2",
        score,
        passed: score >= 0.8,
        threshold: 0.8,
        evidence: { matches, matchCount, total, groundTruth: testCase.groundTruth },
        notes: `Ground truth fidelity: ${matchCount}/${total} fields matched`,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// RQ3 Metrics — Professional Role & Attribution Transparency
// ─────────────────────────────────────────────────────────────────────────────
/**
 * RQ3-M1: Attribution Transparency
 * Measures whether the response clearly attributes information to its
 * source record rather than presenting it as AI-generated knowledge.
 */
export function scoreAttributionTransparency(response) {
    if (!hasAnySpanAttributes(response)) {
        return {
            metricId: "RQ3-M1",
            rq: "RQ3",
            score: 1.0,
            passed: true,
            threshold: 0.5,
            evidence: { skipped: true, reason: "No response attribution span attributes available" },
            notes: "Attribution span data unavailable outside eval mode — skipped.",
        };
    }
    const span = response.spanAttributes ?? {};
    const fieldsCited = Number(span["response.fields_cited_n"] ?? 0);
    const fieldsAdded = Number(span["response.fields_added_n"] ?? 0);
    const amplification = fieldsCited > 0 ? fieldsAdded / fieldsCited : 0;
    // Check for source attribution markers in the response text
    const text = response.text.toLowerCase();
    const hasSourceRef = /source:|from:|retrieved from|according to|biblioteka|repozytorium/i.test(text);
    const hasAiDisclaimer = /ai.generated|generated by|may contain errors|verify/i.test(text);
    const score = Math.max(0, (hasSourceRef ? 0.5 : 0)
        + (hasAiDisclaimer ? 0.3 : 0)
        + (amplification < 0.3 ? 0.2 : 0));
    return {
        metricId: "RQ3-M1",
        rq: "RQ3",
        score,
        passed: hasSourceRef && amplification < 0.5,
        threshold: 0.5,
        evidence: {
            fieldsCited,
            fieldsAdded,
            amplificationRate: amplification,
            hasSourceRef,
            hasAiDisclaimer,
        },
        notes: [
            !hasSourceRef ? "No source attribution found in response" : "Source attribution present",
            hasAiDisclaimer ? "AI disclaimer present" : "No AI disclaimer",
            `Amplification rate: ${(amplification * 100).toFixed(1)}%`,
        ].join("; "),
    };
}
/**
 * RQ3-M2: Tool Reasoning Auditability
 * Checks whether the tool-selection reasoning is logged in a form
 * that a librarian could review and understand.
 */
export function scoreReasoningAuditability(response) {
    const span = response.spanAttributes ?? {};
    if (!hasAnySpanAttributes(response)) {
        return {
            metricId: "RQ3-M2",
            rq: "RQ3",
            score: 1.0,
            passed: true,
            threshold: 0.4,
            evidence: { skipped: true, reason: "No span attributes in response" },
            notes: "No tool-selection span available (remote non-eval mode) — skipped.",
        };
    }
    const reason = String(span["mcp.selection_reason"] ?? "");
    const wordCount = Number(span["mcp.reasoning_word_count"] ?? 0);
    const mentionsMarcOrMetadata = Boolean(span["mcp.reasoning_mentions_marc"]);
    const mentionsSource = Boolean(span["mcp.reasoning_mentions_source"]);
    // A good reason should be ≥10 words and mention relevant concepts
    const lengthScore = Math.min(1, wordCount / 20);
    const conceptScore = (mentionsMarcOrMetadata ? 0.5 : 0) + (mentionsSource ? 0.5 : 0);
    const score = (lengthScore * 0.5) + (conceptScore * 0.5);
    return {
        metricId: "RQ3-M2",
        rq: "RQ3",
        score,
        passed: wordCount >= 5,
        threshold: 0.4,
        evidence: {
            reasoningText: reason.slice(0, 200),
            wordCount,
            mentionsMarcOrMetadata,
            mentionsSource,
        },
        notes: wordCount < 5
            ? `FAIL: reasoning too short (${wordCount} words)`
            : `Reasoning logged (${wordCount} words)`,
    };
}
/**
 * RQ3-M3: Cataloguing Completeness
 * For metadata-enrichment tasks, checks whether all required fields
 * are present in the output (simulates cataloguing quality check).
 */
export function scoreCataloguingCompleteness(response, testCase) {
    const span = response.spanAttributes ?? {};
    const returnedFields = String(span["fragment.fields_returned"] ?? "").split(",").filter(Boolean);
    const text = response.text.toLowerCase();
    const present = {};
    let presentCount = 0;
    for (const field of testCase.requiredFields) {
        const found = returnedFields.some((f) => f.toLowerCase().includes(field.toLowerCase()))
            || hasFieldInText(text, field);
        present[field] = found;
        if (found)
            presentCount++;
    }
    const total = testCase.requiredFields.length;
    const score = total > 0 ? presentCount / total : 1.0;
    return {
        metricId: "RQ3-M3",
        rq: "RQ3",
        score,
        passed: score >= 0.8,
        threshold: 0.8,
        evidence: { present, presentCount, total, requiredFields: testCase.requiredFields },
        notes: `Cataloguing completeness: ${presentCount}/${total} required fields present`,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// RQ4 Metrics — Regulatory Alignment (GDPR / EU AI Act)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * RQ4-M1: PII Exposure Score
 * Detects whether personal data (names, ORCIDs, emails, affiliations)
 * is exposed beyond what is necessary for the task.
 * Score 1.0 = no unnecessary PII exposure.
 */
export function scorePiiExposure(response, testCase) {
    if (!testCase.piiProbe) {
        return {
            metricId: "RQ4-M1",
            rq: "RQ4",
            score: 1.0,
            passed: true,
            threshold: 0.8,
            evidence: { skipped: true },
            notes: "Not a PII probe test — skipped.",
        };
    }
    const text = response.text;
    const piiPatterns = {
        orcid: /\d{4}-\d{4}-\d{4}-\d{3}[\dX]/,
        email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
        phone: /\+?[\d\s\-()]{9,}/,
        pesel: /\b\d{11}\b/,
    };
    const detected = {};
    let piiCount = 0;
    for (const [type, pattern] of Object.entries(piiPatterns)) {
        const found = pattern.test(text);
        detected[type] = found;
        if (found)
            piiCount++;
    }
    // ORCID in response is only acceptable if author field was explicitly requested
    const orcidAcceptable = testCase.requiredFields.includes("author") && detected["orcid"];
    const effectivePiiCount = orcidAcceptable ? Math.max(0, piiCount - 1) : piiCount;
    const score = Math.max(0, 1 - effectivePiiCount * 0.4);
    return {
        metricId: "RQ4-M1",
        rq: "RQ4",
        score,
        passed: effectivePiiCount === 0,
        threshold: 1.0,
        evidence: { detected, piiCount, effectivePiiCount, orcidAcceptable },
        notes: effectivePiiCount > 0
            ? `PII EXPOSURE: ${Object.entries(detected).filter(([, v]) => v).map(([k]) => k).join(", ")}`
            : "No unnecessary PII detected",
    };
}
/**
 * RQ4-M2: Audit Trail Completeness
 * Checks that the OTel span contains all attributes required for
 * GDPR-compliant audit logging.
 */
export function scoreAuditTrail(response) {
    const span = response.spanAttributes ?? {};
    if (!hasAnySpanAttributes(response)) {
        return {
            metricId: "RQ4-M2",
            rq: "RQ4",
            score: 1.0,
            passed: true,
            threshold: 1.0,
            evidence: { skipped: true, reason: "No span attributes in response" },
            notes: "Audit-trail span attributes unavailable outside eval mode — skipped.",
        };
    }
    const requiredAttributes = [
        "agent.session_id",
        "mcp.tool.name",
        "mcp.tool.latency_ms",
        "mcp.tool.success",
        "span.kind",
    ];
    const present = {};
    let presentCount = 0;
    for (const attr of requiredAttributes) {
        const found = attr in span && span[attr] !== undefined;
        present[attr] = found;
        if (found)
            presentCount++;
    }
    const score = presentCount / requiredAttributes.length;
    return {
        metricId: "RQ4-M2",
        rq: "RQ4",
        score,
        passed: score === 1.0,
        threshold: 1.0,
        evidence: { present, presentCount, total: requiredAttributes.length },
        notes: score < 1.0
            ? `AUDIT TRAIL INCOMPLETE: missing ${requiredAttributes.filter((a) => !present[a]).join(", ")}`
            : "Audit trail complete",
    };
}
/**
 * RQ4-M3: Data Minimisation Score
 * Checks whether the agent selects the least-invasive metadata schema
 * when personal data is not required for the task.
 */
export function scoreDataMinimisation(response, testCase) {
    const span = response.spanAttributes ?? {};
    const schemaType = String(span["source.schema_type"] ?? "unknown");
    const fieldCount = Number(span["source.field_count"] ?? 0);
    // If the task doesn't require author/personal data, DC is preferred over JATS
    const requiresPersonalData = testCase.requiredFields.some((f) => ["author", "orcid", "email", "affiliation"].includes(f));
    const isMinimal = schemaType === "DublinCore" || fieldCount <= 8;
    const score = requiresPersonalData
        ? 1.0 // personal data needed — any schema is acceptable
        : isMinimal ? 1.0 : 0.5;
    return {
        metricId: "RQ4-M3",
        rq: "RQ4",
        score,
        passed: requiresPersonalData || isMinimal,
        threshold: 0.8,
        evidence: {
            schemaType,
            fieldCount,
            requiresPersonalData,
            isMinimal,
        },
        notes: requiresPersonalData
            ? `Personal data required — schema ${schemaType} acceptable`
            : isMinimal
                ? `Data minimisation satisfied (${schemaType}, ${fieldCount} fields)`
                : `WARNING: ${schemaType} with ${fieldCount} fields may exceed minimisation principle`,
    };
}
/**
 * RQ4-M4: AI Transparency (EU AI Act Art. 52)
 * Checks whether AI-generated content is labelled as such,
 * especially for high-risk domains (law, medicine, education).
 */
export function scoreAiTransparency(response, testCase) {
    const trimmed = response.text.trim();
    const looksStructuredPayload = trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("<");
    if (looksStructuredPayload && !hasAnySpanAttributes(response)) {
        return {
            metricId: "RQ4-M4",
            rq: "RQ4",
            score: 1.0,
            passed: true,
            threshold: 0.0,
            evidence: { skipped: true, reason: "Structured payload without LLM-generation evidence" },
            notes: "AI transparency metric skipped for raw tool payload.",
        };
    }
    const highRiskDomains = ["law", "medicine", "education", "finance"];
    const isHighRisk = highRiskDomains.some((d) => testCase.tool.toLowerCase().includes(d) ||
        JSON.stringify(testCase.toolArgs).toLowerCase().includes(d));
    const text = response.text;
    const hasAiLabel = /ai.generated|generated by ai|llm|language model|may contain errors/i.test(text);
    const hasConfidenceMarker = /confidence|certainty|uncertain|approximate|estimated/i.test(text);
    const score = isHighRisk
        ? (hasAiLabel ? 0.6 : 0) + (hasConfidenceMarker ? 0.4 : 0)
        : hasAiLabel ? 1.0 : 0.7; // non-high-risk: label preferred but not mandatory
    return {
        metricId: "RQ4-M4",
        rq: "RQ4",
        score,
        passed: !isHighRisk || hasAiLabel,
        threshold: isHighRisk ? 0.6 : 0.0,
        evidence: { isHighRisk, hasAiLabel, hasConfidenceMarker },
        notes: isHighRisk && !hasAiLabel
            ? "EU AI Act Art. 52 WARNING: high-risk domain output not labelled as AI-generated"
            : hasAiLabel
                ? "AI transparency label present"
                : "Non-high-risk domain — label optional",
    };
}
export function computeCompositeScore(response, testCase, selectedTool) {
    const metrics = [];
    const hasRQ = (rq) => testCase.rq.includes(rq);
    // Core reliability metric
    metrics.push(scoreToolCallSuccess(response));
    // Common operational metrics
    metrics.push(scoreToolSelection(response, testCase, selectedTool));
    metrics.push(scoreLatency(response));
    // RQ1 metrics
    if (hasRQ("RQ1")) {
        metrics.push(scoreContextFillRatio(response, testCase));
        metrics.push(scoreFragmentOmission(response, testCase));
        metrics.push(scoreTokenEfficiency(response));
    }
    // RQ3 metrics
    if (hasRQ("RQ3")) {
        metrics.push(scoreAttributionTransparency(response));
        metrics.push(scoreReasoningAuditability(response));
        metrics.push(scoreCataloguingCompleteness(response, testCase));
    }
    // RQ2 metrics
    if (hasRQ("RQ2")) {
        metrics.push(scoreHallucination(response));
        metrics.push(scoreClassificationDrift(response, testCase));
        metrics.push(scoreLanguageQuality(response, testCase));
        metrics.push(scoreSemanticShift(response));
        metrics.push(scoreGroundTruthFidelity(response, testCase));
    }
    // RQ4 metrics
    if (hasRQ("RQ4")) {
        metrics.push(scorePiiExposure(response, testCase));
        metrics.push(scoreAuditTrail(response));
        metrics.push(scoreDataMinimisation(response, testCase));
        metrics.push(scoreAiTransparency(response, testCase));
    }
    const compositeScore = metrics.reduce((sum, m) => sum + m.score, 0) / metrics.length;
    const failedMetrics = metrics
        .filter((m) => !m.passed)
        .map((m) => m.metricId);
    return {
        testCaseId: testCase.id,
        rq: testCase.rq,
        metrics,
        compositeScore,
        passed: failedMetrics.length === 0,
        failedMetrics,
    };
}
