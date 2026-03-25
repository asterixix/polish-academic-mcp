import type { EvalTestCase, ResearchQuestion } from "../scripts/eval/test-cases.js";
import {
  computeCompositeScore,
  type CompositeScore,
  type ToolResponse,
} from "../scripts/eval/metrics.js";
import { getCasesByTool } from "../scripts/eval/test-cases.js";

type JsonPrimitive = string | number | boolean | null;

function isJsonPrimitive(v: unknown): v is JsonPrimitive {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isJsonPrimitive(a) && isJsonPrimitive(b)) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

function subsetMatchScore(expected: Record<string, unknown>, actual: Record<string, unknown>): {
  score: number;
  matchedKeys: string[];
  missingKeys: string[];
  mismatchKeys: string[];
} {
  const expectedKeys = Object.keys(expected);
  const matchedKeys: string[] = [];
  const missingKeys: string[] = [];
  const mismatchKeys: string[] = [];

  if (expectedKeys.length === 0) return { score: 1, matchedKeys: [], missingKeys: [], mismatchKeys: [] };

  for (const k of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(actual, k)) {
      missingKeys.push(k);
      continue;
    }
    const ev = expected[k];
    const av = actual[k];
    if (deepEqual(ev, av)) matchedKeys.push(k);
    else mismatchKeys.push(k);
  }

  return {
    score: matchedKeys.length / expectedKeys.length,
    matchedKeys,
    missingKeys,
    mismatchKeys,
  };
}

function responseToText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((item) =>
        item && typeof item === "object" && "text" in item
          ? String((item as Record<string, unknown>)["text"])
          : JSON.stringify(item),
      )
      .join("\n");
  }
  return JSON.stringify(raw ?? "");
}

function extractToolResultFromJsonRpcPayload(payload: unknown): {
  toolResult: Record<string, unknown> | null;
  errorText?: string;
  statusCode: number;
} {
  const candidates = Array.isArray(payload) ? payload : [payload];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const obj = c as Record<string, unknown>;

    // JSON-RPC result response
    if (obj.result && typeof obj.result === "object") {
      return { toolResult: obj.result as Record<string, unknown>, statusCode: 200 };
    }

    // JSON-RPC error response
    if (obj.error && typeof obj.error === "object") {
      const msg = (obj.error as Record<string, unknown>)["message"];
      return { toolResult: null, errorText: typeof msg === "string" ? msg : undefined, statusCode: 500 };
    }
  }

  return { toolResult: null, statusCode: 500 };
}

export interface RqEvalMatch {
  matched: boolean;
  testCaseId: string | null;
  matchStrategy: "exact" | "subset_best_effort" | "none";
  matchRatio: number;
  matchRqs: ResearchQuestion[];
}

export interface RqEvalReport {
  match: RqEvalMatch;
  composite: CompositeScore;
}

export function computeRqEvalForToolCall(params: {
  toolName: string;
  toolArgs: unknown;
  toolResult: Record<string, unknown>;
  spanAttributes: Record<string, unknown>;
  latencyMs: number;
}): RqEvalReport | null {
  const { toolName, toolArgs, toolResult, spanAttributes, latencyMs } = params;

  const content = toolResult["content"];
  if (!Array.isArray(content) && !(content === undefined || content === null)) {
    // Still compute but response.text might be odd; don't bail.
  }

  const raw = content ?? toolResult;
  const text = responseToText(raw);

  const isError = Boolean(toolResult["isError"]) || typeof toolResult["error"] === "string" || Boolean(toolResult["error"]);
  const statusCode = isError ? 500 : 200;
  const error =
    isError && typeof toolResult["error"] === "string"
      ? String(toolResult["error"])
      : isError
        ? "tool_is_error"
        : undefined;

  const toolResponse: ToolResponse = {
    raw,
    text,
    latencyMs,
    statusCode,
    spanAttributes,
    error,
  };

  const candidates = getCasesByTool(toolName);
  if (!candidates || candidates.length === 0) return null;

  const actualArgs = isPlainObject(toolArgs) ? (toolArgs as Record<string, unknown>) : {};

  let best: { tc: EvalTestCase; ratio: number; strategy: RqEvalMatch["matchStrategy"] } | null = null;
  let exact: EvalTestCase | null = null;

  for (const tc of candidates) {
    if (deepEqual(tc.toolArgs, actualArgs)) {
      exact = tc;
      break;
    }

    const expected = isPlainObject(tc.toolArgs) ? tc.toolArgs : {};
    const sub = subsetMatchScore(expected as Record<string, unknown>, actualArgs);
    if (!best || sub.score > best.ratio) {
      best = { tc, ratio: sub.score, strategy: "subset_best_effort" };
    }
  }

  const matchedTc = exact ?? best?.tc ?? null;
  const ratio = exact ? 1 : best?.ratio ?? 0;

  const match: RqEvalMatch = {
    matched: Boolean(matchedTc),
    testCaseId: matchedTc ? matchedTc.id : null,
    matchStrategy: exact ? "exact" : best ? "subset_best_effort" : "none",
    matchRatio: ratio,
    matchRqs: matchedTc?.rq ?? ([] as ResearchQuestion[]),
  };

  if (!matchedTc) return null;

  const composite = computeCompositeScore(toolResponse, matchedTc, toolName);

  return {
    match,
    composite,
  };
}

// Helper for index.ts (parsing stage); exported to keep index.ts small.
export function extractToolResultAndSpan(payload: unknown): {
  toolResult: Record<string, unknown> | null;
  spanAttributes: Record<string, unknown>;
  statusCode: number;
  errorText?: string;
} {
  const { toolResult, errorText, statusCode } = extractToolResultFromJsonRpcPayload(payload);
  if (!toolResult) {
    return { toolResult: null, spanAttributes: {}, statusCode, errorText };
  }

  const span = toolResult["_span"];
  const spanAttributes = isPlainObject(span) ? (span as Record<string, unknown>) : {};

  return { toolResult, spanAttributes, statusCode, errorText };
}

