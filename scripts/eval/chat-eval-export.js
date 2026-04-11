/**
 * Shared schema for `eval_response` research exports and offline replay.
 * The MCP tool returns JSON matching {@link ChatEvalResearchExport}.
 */
import { computeCompositeScore, } from "./metrics.js";
import { getTestCaseById, toolForEvalResponseCompositeScore, } from "./test-cases.js";
export const CHAT_EVAL_SCHEMA_VERSION = 1;
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function buildToolResponseForChatEval(params) {
    const { generatedText, otelSpanAttributes, latencyMs = 0 } = params;
    return {
        raw: { kind: "chat_eval_synthetic" },
        text: generatedText,
        latencyMs,
        statusCode: 200,
        spanAttributes: otelSpanAttributes,
    };
}
/** Recompute {@link CompositeScore} from a saved export file (verification / notebooks). */
export function recompositeFromChatEvalExport(parsed) {
    if (!isPlainObject(parsed))
        return null;
    const inputs = parsed["inputs"];
    if (!isPlainObject(inputs))
        return null;
    const caseId = inputs["eval_test_case_id"];
    if (typeof caseId !== "string")
        return null;
    const tc = getTestCaseById(caseId);
    if (!tc)
        return null;
    const gen = inputs["generated_text"];
    if (typeof gen !== "string")
        return null;
    const attrs = parsed["otel_span_attributes"];
    if (!isPlainObject(attrs))
        return null;
    const toolResponse = buildToolResponseForChatEval({
        generatedText: gen,
        otelSpanAttributes: attrs,
    });
    const selectedTool = toolForEvalResponseCompositeScore(tc);
    return computeCompositeScore(toolResponse, tc, selectedTool);
}
export function replayChatEvalExportFile(parsed) {
    const errors = [];
    if (!isPlainObject(parsed)) {
        return { ok: false, errors: ["root must be an object"], recomputed: null, testCase: undefined };
    }
    if (parsed.schema_version !== CHAT_EVAL_SCHEMA_VERSION) {
        errors.push(`expected schema_version ${CHAT_EVAL_SCHEMA_VERSION}`);
    }
    const inputsObj = isPlainObject(parsed.inputs) ? parsed.inputs : null;
    if (!inputsObj) {
        errors.push("inputs must be an object");
    }
    if (!isPlainObject(parsed.otel_span_attributes)) {
        errors.push("otel_span_attributes must be an object");
    }
    const caseIdRaw = inputsObj ? inputsObj["eval_test_case_id"] : undefined;
    const caseId = typeof caseIdRaw === "string" ? caseIdRaw : undefined;
    const testCase = caseId ? getTestCaseById(caseId) : undefined;
    if (caseId && !testCase) {
        errors.push(`unknown eval_test_case_id: ${caseId}`);
    }
    const recomputed = recompositeFromChatEvalExport(parsed);
    const ok = errors.length === 0;
    return { ok, errors, recomputed, testCase };
}
