import { SOURCE_GROUPS, SOURCES, type SourceGroup, type SourceId } from "../../src/sources.js";
import { normalizeQueryForSource, normalizeResearchQuery } from "../../src/query-normalize.js";
import type { CloudEnv } from "./env.js";
import { ensureAnonKey, readSessionUser } from "./auth.js";
import { jsonResponse } from "./crypto-util.js";
import {
  aiSearchLimit,
  aiSubject,
  consumeQuota,
  getQuota,
  isoWeekPeriodKey,
  resolveAiSearchLimit,
  resolveMcpLimit,
  mcpSubject,
  monthPeriodKey,
  nextWeekResetMessage,
} from "./quota.js";
import { callMcpTool, listMcpTools, type ToolInfo } from "./tool-bridge.js";
import { getUserPreferences, type UserPreferences } from "./account-api.js";
import { getAppSetting, logAdminEvent } from "./admin.js";
import { withDeveloperContact } from "./error-contact.js";
import { logActivity, purgeExpiredActivityLogs } from "./activity-log.js";



interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface AiSearchBody {
  query?: string;
  messages?: ChatMessage[];
  sources?: string;
  thread_id?: string;
}

/** Approximate tokens when provider omits usage (≈4 chars/token for PL/EN mix). */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated: boolean;
}

export interface AuditStep {
  id: string;
  phase:
    | "routing"
    | "tool_discovery"
    | "llm_plan"
    | "tool_call"
    | "llm_synthesis"
    | "complete"
    | "error";
  title: string;
  detail?: string;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  data?: Record<string, unknown>;
}

export interface LlmAttemptRecord {
  provider: string;
  requested_model: string;
  resolved_model: string;
  status: "ok" | "error";
  http_status?: number | null;
  duration_ms: number;
  error?: string | null;
  cost_usd?: number | null;
  edenai_metadata?: Record<string, unknown> | null;
}

export interface LlmCallRecord {
  id: string;
  phase: "plan" | "synthesis";
  provider: string;
  model: string;
  temperature: number | null;
  max_tokens: number;
  system_prompt: string;
  messages: ChatMessage[];
  tools_offered?: Array<{ name: string; description?: string }>;
  response_text: string;
  tool_calls: LlmToolCall[];
  usage: TokenUsage;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  raw_stop_reason?: string;
  cost_usd?: number | null;
  edenai_metadata?: Record<string, unknown> | null;
  attempts?: LlmAttemptRecord[];
}

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  response_text: string;
  response_chars: number;
  is_error?: boolean;
}

export interface AuditLog {
  schema: "polish_academic_mcp_ai_provenance_v1";
  trace_id: string;
  created_at: string;
  completed_at?: string;
  query: string;
  authenticated: boolean;
  user_id: string | null;
  groups: SourceGroup[];
  source_ids: SourceId[];
  quota: unknown;
  steps: AuditStep[];
  llm_calls: LlmCallRecord[];
  tool_calls: ToolCallRecord[];
  token_totals: TokenUsage;
  answer?: string;
  followups?: string[];
  error?: string;
}

interface LlmToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface LlmResult {
  text: string;
  toolCalls: LlmToolCall[];
  provider: string;
  model: string;
  temperature: number | null;
  max_tokens: number;
  usage: TokenUsage;
  stop_reason?: string;
  cost_usd?: number | null;
  edenai_metadata?: Record<string, unknown> | null;
  attempts?: LlmAttemptRecord[];
}

/**
 * Model IDs that exist in Eden AI's public catalog (`GET /v3/models`).
 * Invalid `fallbacks` entries are validated before provider selection and cause
 * `400 · Caller fault` with `Providers: n/a` — even when the primary model is valid.
 * Do NOT use stale aliases like `anthropic/claude-haiku-latest` or `…-4-5` unless
 * confirmed present in the catalog.
 */
export const EDEN_CATALOG_HAIKU_FALLBACKS = [
  "amazon/anthropic.claude-haiku-5-5@eu",
  "databricks/databricks-claude-haiku-5-5",
] as const;

const EU_HAIKU_MODEL = "amazon/anthropic.claude-haiku-5-5@eu";

/**
 * Normalize model ID for Eden AI /v3/chat/completions.
 * Eden AI catalog uses hyphens in Claude version numbers (e.g. `anthropic/claude-haiku-5-5`),
 * never dots (`5.5` -> `5-5`). Sending `anthropic/claude-haiku-5.5` or unknown fallback IDs
 * causes Eden AI to reject the request before provider selection with `400 · Caller fault`.
 */
export function normalizeEdenModel(rawModel: string): {
  model: string;
  fallbacks: string[];
} {
  let m = (rawModel || "").trim() || EU_HAIKU_MODEL;
  if (!m.includes("/") && !m.startsWith("@")) {
    m = `anthropic/${m}`;
  }
  // Convert dotted version numbers in Claude model IDs (e.g. 5.5 -> 5-5, 4.5 -> 4-5)
  m = m.replace(/(claude-[a-z0-9-]+?)-(\d+)\.(\d+)/gi, "$1-$2-$3");
  m = m.replace(/(\d+)\.(\d+)/g, (full, a, b) =>
    m.toLowerCase().includes("claude") ? `${a}-${b}` : full,
  );

  const fallbacks = EDEN_CATALOG_HAIKU_FALLBACKS.filter((c) => c !== m).slice(0, 3);
  return { model: m, fallbacks };
}

/**
 * Strip `$schema` from JSON Schema objects before passing to OpenAI/Eden AI `tools[].function.parameters`
 * so strict upstream validators do not reject the tool definition.
 */
function sanitizeToolParameters(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }
  const { $schema: _schema, ...rest } = schema;
  return rest.type ? rest : { type: "object", properties: {}, ...rest };
}

/**
 * Ensure messages are non-empty and merge consecutive turns of the same role
 * so Anthropic / Eden AI never rejects consecutive `user` or `assistant` messages with HTTP 400.
 */
function normalizeChatMessages(messages: ChatMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    const content = typeof m.content === "string" ? m.content.trim() : "";
    if (!content) continue;
    const role: "user" | "assistant" = m.role === "assistant" ? "assistant" : "user";
    const prev = out[out.length - 1];
    if (prev && prev.role === role) {
      prev.content = `${prev.content}\n\n${content}`;
    } else {
      out.push({ role, content });
    }
  }
  if (out.length === 0) {
    out.push({ role: "user", content: "Pomóż w wyszukiwaniu." });
  }
  // Anthropic requires the first non-system message to have role "user"
  if (out[0].role !== "user") {
    out.shift();
  }
  return out.length > 0 ? out : [{ role: "user", content: "Pomóż w wyszukiwaniu." }];
}

export class EdenAiHttpError extends Error {
  status: number;
  responseBody: string;
  requestedModel: string;
  edenModel: string;
  fallbacks: string[];
  durationMs: number;
  toolCount: number;
  messageCount: number;
  bodyBytes: number;
  requestId: string | null;

  constructor(opts: {
    status: number;
    responseBody: string;
    requestedModel: string;
    edenModel: string;
    fallbacks: string[];
    durationMs: number;
    toolCount?: number;
    messageCount?: number;
    bodyBytes?: number;
    requestId?: string | null;
  }) {
    super(`Eden AI HTTP ${opts.status} (${opts.edenModel}): ${opts.responseBody.slice(0, 500)}`);
    this.name = "EdenAiHttpError";
    this.status = opts.status;
    this.responseBody = opts.responseBody;
    this.requestedModel = opts.requestedModel;
    this.edenModel = opts.edenModel;
    this.fallbacks = opts.fallbacks;
    this.durationMs = opts.durationMs;
    this.toolCount = opts.toolCount ?? 0;
    this.messageCount = opts.messageCount ?? 0;
    this.bodyBytes = opts.bodyBytes ?? 0;
    this.requestId = opts.requestId ?? null;
  }
}

/** Compact diagnostics for admin_events / activity_logs (no secrets, no full prompts). */
export function edenAiRequestDiagnostics(opts: {
  phase?: string | null;
  traceId?: string | null;
  requestedModel: string;
  edenModel: string;
  fallbacks: string[];
  toolCount: number;
  messageCount: number;
  bodyBytes?: number;
  httpStatus?: number | null;
  durationMs?: number;
  errorBody?: string | null;
  requestId?: string | null;
  costUsd?: number | null;
  resolvedModel?: string | null;
  edenaiMetadata?: Record<string, unknown> | null;
}): Record<string, unknown> {
  let parsedError: unknown = null;
  if (opts.errorBody) {
    try {
      parsedError = JSON.parse(opts.errorBody);
    } catch {
      parsedError = opts.errorBody.slice(0, 800);
    }
  }
  return {
    phase: opts.phase ?? null,
    trace_id: opts.traceId ?? null,
    requested_model: opts.requestedModel,
    normalized_model: opts.edenModel,
    resolved_model: opts.resolvedModel ?? null,
    fallbacks: opts.fallbacks,
    tool_count: opts.toolCount,
    message_count: opts.messageCount,
    body_bytes: opts.bodyBytes ?? null,
    http_status: opts.httpStatus ?? null,
    duration_ms: opts.durationMs ?? null,
    cost_usd: opts.costUsd ?? null,
    eden_request_id: opts.requestId ?? null,
    edenai_metadata: opts.edenaiMetadata ?? null,
    error_body: opts.errorBody ? opts.errorBody.slice(0, 1200) : null,
    error_parsed: parsedError,
  };
}

function pickGroups(query: string): SourceGroup[] {
  const q = query.toLowerCase();
  const scores: Record<SourceGroup, number> = {
    nauka: 0,
    dane: 0,
    prawo: 0,
    normy: 0,
    kultura: 0,
  };
  const rules: Array<[SourceGroup, RegExp]> = [
    ["nauka", /nauka|publikac|artykuł|orcid|doi|repozytor|badaw|doktor|profesor|bibliograf|uczelni|student/i],
    ["dane", /\b(dane|gus|statyst|bdl|pogod|imgw|dane\.gov|ludność|bezroboc|inflac|demograf|cudzoziem|obcokrajow|migra|mieszka[ńn]c|meldun|pozwolen|zezwolen|pobyt|krak[oó]w)/i],
    ["prawo", /ustaw|rozporząd|orzeczen|sąd|saos|isap|kodeks|wyrok|sejm|prawo/i],
    ["normy", /norma|pkn|iso\b|pn-|standard/i],
    ["kultura", /film|książ|lektur|fotografi|plakat|archiw|muzeum|sztuk|ninateka|teatr/i],
  ];
  for (const [group, re] of rules) {
    if (re.test(q)) scores[group] += 2;
  }
  if (Object.values(scores).every((s) => s === 0)) scores.nauka = 1;
  return (Object.keys(scores) as SourceGroup[])
    .filter((g) => scores[g] > 0)
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, 3);
}

function sourcesForGroups(groups: SourceGroup[]): SourceId[] {
  const set = new Set(groups);
  return SOURCES.filter((s) => set.has(s.group) && s.id !== "pbn").map((s) => s.id);
}

/**
 * Curated per-group cores for AI Search fan-out.
 * Full category search can hit 12–20 upstream APIs per tool call and burn the
 * Cloudflare Worker subrequest budget (50 free / 10k paid) before synthesis.
 */
const AI_SEARCH_CORE_BY_GROUP: Record<SourceGroup, SourceId[]> = {
  nauka: ["bn", "ruj", "rodbuk", "repod", "agh", "ppm"],
  dane: ["bdl", "dane", "krakow_od"],
  prawo: ["saos", "isap", "bs_sejm"],
  normy: ["pkn", "wiedza", "blz"],
  kultura: ["wolnelektury", "ninateka", "fototeka", "filmpolski"],
};

/** Max parallel Meta-Router tool calls in round 1 (each may fan out to N sources). */
const AI_SEARCH_MAX_TOOL_CALLS = 5;
/** Default deepen get_record cap — leave headroom for the synthesis LLM fetch. */
const AI_SEARCH_DEFAULT_DEEPEN = 4;

function sumUsage(parts: TokenUsage[]): TokenUsage {
  const input = parts.reduce((a, p) => a + p.input_tokens, 0);
  const output = parts.reduce((a, p) => a + p.output_tokens, 0);
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    estimated: parts.some((p) => p.estimated),
  };
}

function usageFromText(system: string, messages: ChatMessage[], response: string): TokenUsage {
  const inputText = [system, ...messages.map((m) => m.content)].join("\n");
  const input_tokens = estimateTokens(inputText);
  const output_tokens = estimateTokens(response);
  return {
    input_tokens,
    output_tokens,
    total_tokens: input_tokens + output_tokens,
    estimated: true,
  };
}

async function callEdenAi(
  env: CloudEnv,
  system: string,
  messages: ChatMessage[],
  tools: ToolInfo[] | undefined,
  model: string,
  traceId?: string,
  phase?: "plan" | "synthesis" | "probe",
): Promise<LlmResult> {
  const apiKey = env.EDENAI_API_KEY!.trim();
  const base = (env.EDENAI_API_BASE?.trim() || "https://api.edenai.run/v3").replace(/\/$/, "");
  const url = `${base}/chat/completions`;
  const maxTokens = 16_384;
  const { model: edenModel, fallbacks } = normalizeEdenModel(model);

  const anthropicTools = (tools ?? []).slice(0, 40).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: sanitizeToolParameters(t.inputSchema),
    },
  }));

  const normalizedMessages = normalizeChatMessages(messages);
  const sessionId = traceId?.slice(0, 128);
  const body: Record<string, unknown> = {
    model: edenModel,
    max_tokens: maxTokens,
    messages: [
      ...(system.trim() ? [{ role: "system", content: system.trim() }] : []),
      ...normalizedMessages,
    ],
    // Visible in Eden AI dashboard (Requests → Tags)
    tags: {
      client: "pamcp",
      feature: "ai-search",
      phase: phase ?? "llm",
    },
  };
  // Only send catalog-valid fallbacks; empty/invalid IDs → 400 Caller fault (Providers: n/a)
  if (fallbacks.length > 0) body.fallbacks = fallbacks;
  if (sessionId) body.session_id = sessionId;
  if (anthropicTools.length > 0) body.tools = anthropicTools;

  const bodyJson = JSON.stringify(body);
  const t0 = Date.now();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    "x-edenai-metadata": "enabled",
  };
  if (sessionId) {
    headers["x-session-id"] = sessionId;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: bodyJson,
  });
  const durationMs = Date.now() - t0;
  const requestId =
    res.headers.get("x-request-id") ||
    res.headers.get("x-edenai-request-id") ||
    res.headers.get("cf-ray") ||
    null;
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new EdenAiHttpError({
      status: res.status,
      responseBody: errText,
      requestedModel: model,
      edenModel,
      fallbacks,
      durationMs,
      toolCount: anthropicTools.length,
      messageCount: normalizedMessages.length + (system.trim() ? 1 : 0),
      bodyBytes: bodyJson.length,
      requestId,
    });
  }
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    model?: string;
    cost?: number;
    edenai_metadata?: Record<string, unknown>;
  };
  const msg = json.choices?.[0]?.message;
  const text = typeof msg?.content === "string" ? msg.content : "";
  const toolCalls: LlmToolCall[] = [];
  for (const tc of msg?.tool_calls ?? []) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function?.arguments ?? "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }
    if (tc.function?.name) toolCalls.push({ name: tc.function.name, arguments: args });
  }
  const usage: TokenUsage = json.usage
    ? {
        input_tokens: json.usage.prompt_tokens ?? 0,
        output_tokens: json.usage.completion_tokens ?? 0,
        total_tokens:
          json.usage.total_tokens ??
          (json.usage.prompt_tokens ?? 0) + (json.usage.completion_tokens ?? 0),
        estimated: false,
      }
    : usageFromText(system, messages, text);

  return {
    text,
    toolCalls,
    provider: "edenai",
    model: json.model ?? edenModel,
    temperature: null,
    max_tokens: maxTokens,
    usage,
    stop_reason: json.choices?.[0]?.finish_reason,
    cost_usd: typeof json.cost === "number" ? json.cost : null,
    edenai_metadata: {
      ...(json.edenai_metadata ?? {}),
      ...(requestId ? { http_request_id: requestId } : {}),
      duration_ms: durationMs,
      request_body_bytes: bodyJson.length,
      tool_count: anthropicTools.length,
    },
  };
}

/**
 * Lightweight diagnostic probe for Eden AI /v3/chat/completions used by the Admin panel.
 */
export async function probeEdenAiChat(env: CloudEnv): Promise<{
  ok: boolean;
  configured: boolean;
  requested_model: string;
  normalized_model: string;
  fallbacks: string[];
  resolved_model?: string;
  duration_ms: number;
  http_status?: number | null;
  cost_usd?: number | null;
  edenai_metadata?: Record<string, unknown> | null;
  response_preview?: string;
  error?: string | null;
}> {
  const forcedModel = await getAppSetting<string | null>(env, "force_model", null).catch(() => null);
  const rawModel = (forcedModel && String(forcedModel).trim()) || env.AI_MODEL?.trim() || EU_HAIKU_MODEL;
  const { model: normalizedModel, fallbacks } = normalizeEdenModel(rawModel);
  if (!env.EDENAI_API_KEY?.trim()) {
    return {
      ok: false,
      configured: false,
      requested_model: rawModel,
      normalized_model: normalizedModel,
      fallbacks,
      duration_ms: 0,
      error: "Brak sekretu EDENAI_API_KEY.",
    };
  }
  const t0 = Date.now();
  try {
    const res = await callEdenAi(
      env,
      "Odpowiedz jednym słowem: OK.",
      [{ role: "user", content: "ping" }],
      undefined,
      rawModel,
      `admin-probe-${Date.now()}`,
      "probe",
    );
    const durationMs = Date.now() - t0;
    await logAdminEvent(
      env,
      "info",
      "edenai.probe",
      `Test Eden AI OK (${res.model}, ${durationMs} ms)`,
      edenAiRequestDiagnostics({
        phase: "probe",
        requestedModel: rawModel,
        edenModel: normalizedModel,
        fallbacks,
        toolCount: 0,
        messageCount: 1,
        httpStatus: 200,
        durationMs,
        costUsd: res.cost_usd ?? null,
        resolvedModel: res.model,
        edenaiMetadata: res.edenai_metadata ?? null,
      }),
    );
    return {
      ok: true,
      configured: true,
      requested_model: rawModel,
      normalized_model: normalizedModel,
      fallbacks,
      resolved_model: res.model,
      duration_ms: durationMs,
      http_status: 200,
      cost_usd: res.cost_usd ?? null,
      edenai_metadata: res.edenai_metadata ?? null,
      response_preview: res.text.slice(0, 120),
      error: null,
    };
  } catch (err) {
    const durationMs = Date.now() - t0;
    const httpStatus = err instanceof EdenAiHttpError ? err.status : null;
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errBody = err instanceof EdenAiHttpError ? err.responseBody : null;
    await logAdminEvent(
      env,
      "error",
      "edenai.probe",
      `Test Eden AI FAIL: ${errorMsg.slice(0, 240)}`,
      edenAiRequestDiagnostics({
        phase: "probe",
        requestedModel: rawModel,
        edenModel: normalizedModel,
        fallbacks,
        toolCount: err instanceof EdenAiHttpError ? err.toolCount : 0,
        messageCount: err instanceof EdenAiHttpError ? err.messageCount : 1,
        bodyBytes: err instanceof EdenAiHttpError ? err.bodyBytes : undefined,
        httpStatus,
        durationMs,
        errorBody: errBody,
        requestId: err instanceof EdenAiHttpError ? err.requestId : null,
      }),
    );
    return {
      ok: false,
      configured: true,
      requested_model: rawModel,
      normalized_model: normalizedModel,
      fallbacks,
      duration_ms: durationMs,
      http_status: httpStatus,
      error: errorMsg,
    };
  }
}

interface LlmCallContext {
  phase: "plan" | "synthesis";
  traceId: string;
  userId?: string | null;
  anonKey?: string | null;
  forceModel?: string | null;
  onProviderError?: (attempt: LlmAttemptRecord) => void;
}

async function callLlm(
  env: CloudEnv,
  system: string,
  messages: ChatMessage[],
  tools?: ToolInfo[],
  ctx?: LlmCallContext,
): Promise<LlmResult> {
  const model =
    (ctx?.forceModel && ctx.forceModel.trim()) ||
    env.AI_MODEL?.trim() ||
    EU_HAIKU_MODEL;
  const gatewayUrl = env.AI_GATEWAY_URL?.trim();
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  const openrouterKey = env.OPENROUTER_API_KEY?.trim();
  const aigToken = env.CF_AIG_TOKEN?.trim();
  const edenKey = env.EDENAI_API_KEY?.trim();
  const attempts: LlmAttemptRecord[] = [];

  // Prefer Eden AI (OpenAI-compatible) for Claude Haiku research synthesis.
  if (edenKey) {
    const t0 = Date.now();
    const { model: normalizedEdenModel, fallbacks } = normalizeEdenModel(model);
    try {
      const res = await callEdenAi(
        env,
        system,
        messages,
        tools,
        model,
        ctx?.traceId,
        ctx?.phase ?? "plan",
      );
      const durationMs = Date.now() - t0;
      attempts.push({
        provider: "edenai",
        requested_model: model,
        resolved_model: res.model,
        status: "ok",
        http_status: 200,
        duration_ms: durationMs,
        cost_usd: res.cost_usd ?? null,
        edenai_metadata: res.edenai_metadata ?? null,
      });
      // Success telemetry — lets admin confirm site queries actually hit Eden AI
      await logAdminEvent(
        env,
        "info",
        "edenai.chat",
        `Eden AI ${ctx?.phase ?? "llm"} OK (${res.model}, ${durationMs} ms, cost=${res.cost_usd ?? "n/a"})`,
        edenAiRequestDiagnostics({
          phase: ctx?.phase ?? null,
          traceId: ctx?.traceId ?? null,
          requestedModel: model,
          edenModel: normalizedEdenModel,
          fallbacks,
          toolCount: tools?.length ?? 0,
          messageCount: messages.length,
          httpStatus: 200,
          durationMs,
          costUsd: res.cost_usd ?? null,
          resolvedModel: res.model,
          edenaiMetadata: res.edenai_metadata ?? null,
        }),
      ).catch(() => {});
      return { ...res, attempts };
    } catch (err) {
      const durationMs = Date.now() - t0;
      const httpStatus = err instanceof EdenAiHttpError ? err.status : null;
      const errMsg = err instanceof Error ? err.message : String(err);
      const errBody = err instanceof EdenAiHttpError ? err.responseBody.slice(0, 1200) : errMsg.slice(0, 1200);
      const workerLimit = /too many subrequests/i.test(errMsg);
      const failedAttempt: LlmAttemptRecord = {
        provider: "edenai",
        requested_model: model,
        resolved_model: normalizedEdenModel,
        status: "error",
        http_status: httpStatus,
        duration_ms: durationMs,
        error: errMsg.slice(0, 600),
      };
      attempts.push(failedAttempt);
      ctx?.onProviderError?.(failedAttempt);
      console.error(
        workerLimit
          ? "Worker subrequest limit hit before/during Eden AI; trying other providers:"
          : "Eden AI call failed, trying other providers:",
        errMsg,
      );

      const diag = edenAiRequestDiagnostics({
        phase: ctx?.phase ?? null,
        traceId: ctx?.traceId ?? null,
        requestedModel: model,
        edenModel: normalizedEdenModel,
        fallbacks,
        toolCount: err instanceof EdenAiHttpError ? err.toolCount : (tools?.length ?? 0),
        messageCount: err instanceof EdenAiHttpError ? err.messageCount : messages.length,
        bodyBytes: err instanceof EdenAiHttpError ? err.bodyBytes : undefined,
        httpStatus,
        durationMs,
        errorBody: errBody,
        requestId: err instanceof EdenAiHttpError ? err.requestId : null,
      });

      // Persist detailed error — distinguish CF Worker budget exhaustion from Eden API 4xx
      await Promise.allSettled([
        logAdminEvent(
          env,
          "error",
          workerLimit ? "worker.subrequests" : "edenai.chat",
          workerLimit
            ? `Worker subrequest limit during Eden AI ${ctx?.phase ?? "llm"} (${normalizedEdenModel}): fan-out narzędzi wyczerpał budżet fetchy przed syntezą`
            : `Eden AI ${ctx?.phase ?? "llm"} HTTP ${httpStatus ?? "ERR"} (${normalizedEdenModel}): ${errMsg.slice(0, 260)}`,
          { ...diag, worker_subrequest_limit: workerLimit },
        ),
        logActivity(env, {
          eventType: "error",
          subjectKind: ctx?.userId ? "user" : "anon",
          userId: ctx?.userId ?? null,
          anonKey: ctx?.userId ? null : (ctx?.anonKey ?? null),
          traceId: ctx?.traceId ?? null,
          path: "/api/ai-search",
          summary: workerLimit
            ? `Worker subrequest limit (${ctx?.phase ?? "llm"}): ${errMsg.slice(0, 200)}`
            : `Eden AI error (${ctx?.phase ?? "llm"}, HTTP ${httpStatus ?? "ERR"}, model ${normalizedEdenModel}): ${errMsg.slice(0, 240)}`,
          status: "error",
          durationMs,
          meta: {
            provider: "edenai",
            worker_subrequest_limit: workerLimit,
            ...diag,
          },
        }),
      ]);

      // Further outbound fetches will also fail once the Worker budget is exhausted —
      // skip Anthropic / Workers AI fallbacks and surface a clear cause.
      if (workerLimit) {
        throw new Error(
          `Limit subrequestów Cloudflare Workera wyczerpany w fazie ${ctx?.phase ?? "llm"} ` +
            `(fan-out narzędzi + deepen). Podnieś limits.subrequests w wrangler.jsonc (plan Paid) ` +
            `lub zmniejsz deepen_record_limit. Oryginał: ${errMsg.slice(0, 180)}`,
        );
      }
    }
  }

  // shortcut: direct Anthropic/OpenRouter disabled for EU-only residency, Eden is the only LLM route; re-enable only with EU-hosted endpoints
  if (false && (gatewayUrl || anthropicKey || openrouterKey)) {
    const t0 = Date.now();
    try {
      const res = await callAnthropicCompatible(env, system, messages, tools, {
        model,
        gatewayUrl,
        anthropicKey,
        openrouterKey,
        aigToken,
      });
      attempts.push({
        provider: res.provider,
        requested_model: model,
        resolved_model: res.model,
        status: "ok",
        http_status: 200,
        duration_ms: Date.now() - t0,
      });
      return { ...res, attempts };
    } catch (err) {
      const durationMs = Date.now() - t0;
      const errMsg = String((err as Error | undefined)?.message ?? err);
      const failedAttempt: LlmAttemptRecord = {
        provider: openrouterKey ? "openrouter" : gatewayUrl ? "anthropic_via_ai_gateway" : "anthropic",
        requested_model: model,
        resolved_model: model,
        status: "error",
        duration_ms: durationMs,
        error: errMsg.slice(0, 600),
      };
      attempts.push(failedAttempt);
      ctx?.onProviderError?.(failedAttempt);
      console.error("AI Gateway call failed, falling back to Workers AI:", errMsg);
    }
  }

  const t0 = Date.now();
  const fallbackRes = await callWorkersAiFallback(env, system, messages, tools);
  attempts.push({
    provider: fallbackRes.provider,
    requested_model: model,
    resolved_model: fallbackRes.model,
    status: "ok",
    duration_ms: Date.now() - t0,
  });
  return { ...fallbackRes, attempts };
}

/**
 * Pull get_record targets from Meta-Router search output for a deepen round.
 * Router `search` zwraca tekst w sekcjach `=== [source] (operation) ===` oraz
 * stopkę `=== REKORDY DO POGŁĘBIENIA ===` z liniami `- source:id — etykieta`;
 * obie formy są tu parsowane (wcześniej funkcja oczekiwała czystego JSON-a
 * z polami source/id na rekordach, więc runda pogłębiania nigdy nie startowała).
 */
export function extractRecordTargets(
  toolResults: Array<{ name: string; text: string; isError?: boolean }>,
  limit = 6,
): LlmToolCall[] {
  const out: LlmToolCall[] = [];
  const seen = new Set<string>();
  const push = (source: string, id: string) => {
    if (out.length >= limit) return;
    const src = source.trim().replace(/_search.*$/, "").replace(/_get.*$/, "");
    const rid = id.trim();
    if (!src || !rid) return;
    if (src === "krakow_msip" && !/^\d+$/.test(rid)) return;
    const key = `${src}:${rid}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      name: "get_record",
      arguments: { source: src, id: rid, include_fulltext: true, max_chars: 80_000 },
    });
    // BDL: metadane zmiennej to za mało — pobierz wartości wojewódzkie (unit-level=2).
    if (src === "bdl" && /^\d+$/.test(rid)) {
      out.push({
        name: "search",
        arguments: {
          operation: "bdl_get_data_by_variable",
          filters: { variable_id: Number(rid), unit_level: 2, page_size: 20 },
          max_chars: 80_000,
          format: "raw",
        },
      });
    }
  };

  const walkJson = (node: unknown, fallbackSource: string, depth = 0): void => {
    if (depth > 6 || node == null || out.length >= limit) return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 40)) walkJson(item, fallbackSource, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const itemSource =
      typeof o.source === "string" && /^[a-z][a-z0-9_]*$/.test(o.source) ? o.source : fallbackSource;
    if (typeof o.get_record === "string" && o.get_record.includes(":")) {
      const idx = o.get_record.indexOf(":");
      push(o.get_record.slice(0, idx), o.get_record.slice(idx + 1));
    } else {
      const rawId = o.id ?? o.record_id ?? o.publicationId ?? o.slug ?? o.dataset_id ?? o.uuid;
      if ((typeof rawId === "string" || typeof rawId === "number") && (o.id != null || o.slug != null || o.dataset_id != null || o.record_id != null || o.publicationId != null)) {
        push(itemSource || String(o.tool ?? ""), String(rawId));
      }
    }
    for (const v of Object.values(o)) {
      if (typeof v === "object") walkJson(v, fallbackSource, depth + 1);
    }
  };

  for (const r of toolResults) {
    if (r.isError || r.name !== "search" || out.length >= limit) continue;
    // 1) Stopka REKORDY DO POGŁĘBIENIA routera: linie "- source:id — etykieta".
    for (const m of r.text.matchAll(/^-\s+([a-z][a-z0-9_]*):(\S+?)(?:\s+—\s+.*)?$/gm)) {
      push(m[1], m[2]);
    }
    // 2) Sekcje === [source] (operation) === z JSON-em pojedynczego źródła.
    const sectionRe = /^=== \[([^\]]+)\] \(([^)]+)\)[^\n]*$/gm;
    const marks: Array<{ source: string; start: number; bodyStart: number }> = [];
    for (const m of r.text.matchAll(sectionRe)) {
      marks.push({ source: m[1], start: m.index ?? 0, bodyStart: (m.index ?? 0) + m[0].length });
    }
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1].start : r.text.length;
      const body = r.text.slice(marks[i].bodyStart, end).trim();
      try {
        walkJson(JSON.parse(body), marks[i].source);
      } catch {
        /* ucięty lub nie-JSON korpus sekcji — stopka wyżej już pokrywa kandydatów */
      }
    }
    // 3) Czysty JSON bez sekcji (bezpośrednie wywołania operacji).
    if (marks.length === 0) {
      try {
        walkJson(JSON.parse(r.text), "");
      } catch {
        /* ignore non-JSON */
      }
    }
  }
  return out;
}

async function callAnthropicCompatible(
  _env: CloudEnv,
  system: string,
  messages: ChatMessage[],
  tools: ToolInfo[] | undefined,
  opts: {
    model: string;
    gatewayUrl?: string;
    anthropicKey?: string;
    openrouterKey?: string;
    aigToken?: string;
  },
): Promise<LlmResult> {
  const maxTokens = 4096;
  const anthropicTools = (tools ?? []).slice(0, 40).map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema?.type ? t.inputSchema : { type: "object", properties: {}, ...t.inputSchema },
  }));

  const body: Record<string, unknown> = {
    model: opts.model.startsWith("anthropic/") ? opts.model.replace(/^anthropic\//, "") : opts.model,
    max_tokens: maxTokens,
    system,
    messages: messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
  };
  if (anthropicTools.length > 0) body.tools = anthropicTools;

  let url: string;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (opts.openrouterKey) {
    url = opts.gatewayUrl?.includes("openrouter")
      ? opts.gatewayUrl
      : "https://openrouter.ai/api/v1/chat/completions";
    headers.authorization = `Bearer ${opts.openrouterKey}`;
    const orModel = opts.model.includes("/") ? opts.model : `anthropic/${opts.model}`;
    const orBody = {
      model: orModel,
      messages: [
        { role: "system", content: system },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      tools: anthropicTools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      })),
      max_tokens: maxTokens,
    };
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(orBody) });
    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const json = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      model?: string;
    };
    const msg = json.choices?.[0]?.message;
    const toolCalls: LlmToolCall[] = [];
    for (const tc of msg?.tool_calls ?? []) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments ?? "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      if (tc.function?.name) toolCalls.push({ name: tc.function.name, arguments: args });
    }
    const text = msg?.content ?? "";
    const usage: TokenUsage = json.usage
      ? {
          input_tokens: json.usage.prompt_tokens ?? 0,
          output_tokens: json.usage.completion_tokens ?? 0,
          total_tokens:
            json.usage.total_tokens ??
            (json.usage.prompt_tokens ?? 0) + (json.usage.completion_tokens ?? 0),
          estimated: false,
        }
      : usageFromText(system, messages, text);
    return {
      text,
      toolCalls,
      provider: "openrouter",
      model: json.model ?? orModel,
      temperature: null,
      max_tokens: maxTokens,
      usage,
      stop_reason: json.choices?.[0]?.finish_reason,
    };
  }

  if (opts.gatewayUrl) {
    url = opts.gatewayUrl.replace(/\/$/, "");
    if (!url.includes("/v1/messages") && !url.includes("/anthropic")) {
      url = `${url}/v1/messages`;
    } else if (!url.endsWith("/v1/messages") && url.includes("gateway.ai.cloudflare.com")) {
      url = `${url}/anthropic/v1/messages`;
    }
  } else {
    url = "https://api.anthropic.com/v1/messages";
  }
  if (opts.anthropicKey) {
    headers["x-api-key"] = opts.anthropicKey;
    headers["anthropic-version"] = "2023-06-01";
  }
  if (opts.aigToken) headers["cf-aig-authorization"] = `Bearer ${opts.aigToken}`;

  if (
    typeof body.model === "string" &&
    (body.model === "claude-haiku-5.5" || body.model === "claude-haiku-5-5")
  ) {
    body.model = "claude-haiku-4-5-20251001";
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    model?: string;
    stop_reason?: string;
  };
  let text = "";
  const toolCalls: LlmToolCall[] = [];
  for (const block of json.content ?? []) {
    if (block.type === "text" && block.text) text += block.text;
    if (block.type === "tool_use" && block.name) {
      toolCalls.push({ name: block.name, arguments: block.input ?? {} });
    }
  }
  const usage: TokenUsage = json.usage
    ? {
        input_tokens: json.usage.input_tokens ?? 0,
        output_tokens: json.usage.output_tokens ?? 0,
        total_tokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0),
        estimated: false,
      }
    : usageFromText(system, messages, text);

  return {
    text,
    toolCalls,
    provider: opts.gatewayUrl ? "anthropic_via_ai_gateway" : "anthropic",
    model: json.model ?? String(body.model),
    temperature: null,
    max_tokens: maxTokens,
    usage,
    stop_reason: json.stop_reason,
  };
}

async function callWorkersAiFallback(
  env: CloudEnv,
  system: string,
  messages: ChatMessage[],
  tools?: ToolInfo[],
): Promise<LlmResult> {
  const fallback = env.AI_FALLBACK_MODEL?.trim() || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const maxTokens = 2048;
  const toolHint =
    tools && tools.length > 0
      ? `\nDostępne narzędzia (wybierz max 3 jako JSON w bloku \`\`\`tools ... \`\`\`):\n${tools
          .slice(0, 25)
          .map((t) => `- ${t.name}: ${t.description?.slice(0, 120) ?? ""}`)
          .join("\n")}\nFormat: [{"name":"tool_name","arguments":{...}}]`
      : "";

  const prompt = [
    system + toolHint,
    ...messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
    "ASSISTANT:",
  ].join("\n\n");

  const result = (await env.AI.run(fallback as keyof AiModels, {
    prompt,
    max_tokens: maxTokens,
  })) as { response?: string };

  const text = result.response ?? "";
  const toolCalls: LlmToolCall[] = [];
  const match = /```tools\s*([\s\S]*?)```/i.exec(text) || /\[(\s*\{[\s\S]*"name"[\s\S]*\})\s*\]/.exec(text);
  if (match) {
    try {
      const parsed = JSON.parse(match[1].startsWith("[") ? match[1] : match[0]) as LlmToolCall[];
      if (Array.isArray(parsed)) {
        for (const item of parsed.slice(0, 5)) {
          if (item?.name) toolCalls.push({ name: item.name, arguments: item.arguments ?? {} });
        }
      }
    } catch {
      /* ignore parse errors */
    }
  }
  const cleaned = text.replace(/```tools[\s\S]*?```/gi, "").trim();
  return {
    text: cleaned,
    toolCalls,
    provider: "workers_ai",
    model: fallback,
    temperature: null,
    max_tokens: maxTokens,
    usage: usageFromText(system + toolHint, messages, cleaned),
  };
}

function sseEncode(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function newStepId(): string {
  return crypto.randomUUID();
}

export async function handleAiSearchRoutes(
  request: Request,
  env: CloudEnv,
  path: string,
): Promise<Response | null> {
  if (path === "/api/quota" && request.method === "GET") {
    const user = await readSessionUser(env, request);
    const { anonKey, setCookie } = await ensureAnonKey(env, request);
    const subject = aiSubject(user?.id ?? null, anonKey);
    const period = isoWeekPeriodKey();
    const limit = await resolveAiSearchLimit(env, user?.id ?? null, Boolean(user));
    const ai = await getQuota(env, subject, "ai_search_weekly", period, limit);
    let mcp = null;
    if (user) {
      mcp = await getQuota(
        env,
        mcpSubject(user.id),
        "mcp_monthly",
        monthPeriodKey(),
        await resolveMcpLimit(env, user.id),
      );
    }
    const headers = new Headers({ "content-type": "application/json" });
    if (setCookie) headers.append("set-cookie", setCookie);
    return new Response(JSON.stringify({ ai_search: ai, mcp, authenticated: Boolean(user) }), {
      headers,
    });
  }

  if (path !== "/api/ai-search" || request.method !== "POST") return null;

  const user = await readSessionUser(env, request);
  const { anonKey, setCookie } = await ensureAnonKey(env, request);
  const subject = aiSubject(user?.id ?? null, anonKey);
  const period = isoWeekPeriodKey();
  const limit = await resolveAiSearchLimit(env, user?.id ?? null, Boolean(user));
  const before = await getQuota(env, subject, "ai_search_weekly", period, limit);

  if (!before.allowed) {
    const headers = new Headers({ "content-type": "application/json" });
    if (setCookie) headers.append("set-cookie", setCookie);
    const quotaMsg = user
      ? `Wykorzystano limit ${limit} wyszukiwań AI w tym tygodniu. Odnowienie: ${nextWeekResetMessage(period)}.`
      : `Wykorzystano limit ${limit} wyszukiwań bez logowania w tym tygodniu. Zaloguj się (ORCID / email / passkey), aby zwiększyć limit do ${aiSearchLimit(env, true)}/tydzień.`;
    return new Response(
      JSON.stringify({
        error: "quota_exceeded",
        message: withDeveloperContact(quotaMsg),
        quota: before,
        login_required: !user,
      }),
      { status: 429, headers },
    );
  }

  const maintenance = await getAppSetting<string>(env, "maintenance_message", "");
  if (maintenance && String(maintenance).trim()) {
    return jsonResponse(
      {
        error: "maintenance",
        message: withDeveloperContact(String(maintenance).trim()),
      },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as AiSearchBody;
  const query = body.query?.trim() || body.messages?.filter((m) => m.role === "user").at(-1)?.content?.trim() || "";
  if (!query) {
    return jsonResponse({ error: "Podaj query lub messages." }, { status: 400 });
  }

  await consumeQuota(env, subject, "ai_search_weekly", period, limit);
  const quota = await getQuota(env, subject, "ai_search_weekly", period, limit);

  const groups = pickGroups(query);
  const explicitSources = body.sources
    ? sourcesForGroups(
        body.sources
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter((s): s is SourceGroup => s in SOURCE_GROUPS),
      )
    : undefined;
  const sourceIds = explicitSources ?? sourcesForGroups(groups);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(sseEncode(event, data)));
      };

      const traceId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const audit: AuditLog = {
        schema: "polish_academic_mcp_ai_provenance_v1",
        trace_id: traceId,
        created_at: createdAt,
        query,
        authenticated: Boolean(user),
        user_id: user?.id ?? null,
        groups,
        source_ids: sourceIds,
        quota,
        steps: [],
        llm_calls: [],
        tool_calls: [],
        token_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated: false },
      };

      const pushStep = (
        phase: AuditStep["phase"],
        title: string,
        detail?: string,
        data?: Record<string, unknown>,
      ): AuditStep => {
        const step: AuditStep = {
          id: newStepId(),
          phase,
          title,
          detail,
          started_at: new Date().toISOString(),
          data,
        };
        audit.steps.push(step);
        send("step", step);
        send("status", { message: title, phase, quota });
        return step;
      };

      const endStep = (step: AuditStep, extra?: Record<string, unknown>) => {
        step.ended_at = new Date().toISOString();
        step.duration_ms = Date.parse(step.ended_at) - Date.parse(step.started_at);
        if (extra) step.data = { ...step.data, ...extra };
        send("step", step);
      };

      send("audit_meta", {
        trace_id: traceId,
        schema: audit.schema,
        created_at: createdAt,
        query,
        authenticated: audit.authenticated,
      });

      try {
        const routeStep = pushStep(
          "routing",
          `Dobieram bazy: ${groups.map((g) => SOURCE_GROUPS[g]).join("; ")}`,
          `Grupy: ${groups.join(", ")}. Źródła: ${sourceIds.length}.`,
          { groups, source_ids: sourceIds },
        );
        endStep(routeStep);

        const discStep = pushStep("tool_discovery", "Ładuję narzędzia Meta-Router (list_sources, search, get_record)");
        const tools = await listMcpTools(env, explicitSources, "router");
        endStep(discStep, {
          tool_count: tools.length,
          tool_names: tools.map((t) => t.name),
        });
        send("status", { message: `Dostępnych narzędzi: ${tools.length}`, toolCount: tools.length });

        const history: ChatMessage[] = body.messages?.length
          ? body.messages
          : [{ role: "user", content: query }];

        const routerExtraEarly = String(await getAppSetting<string>(env, "router_extra", "") || "").trim();
        const routerSystem =
          "Jesteś routerem Polish Academic MCP (tryb Meta-Router) dla badaczy. Masz narzędzia list_sources, search i get_record. " +
          "Cel: w jednym przebiegu zebrać jak najwięcej materiału (publikacje, dane, akty, linki, pełne rekordy). " +
          "Wywołaj 2-4 równoległe search z category (nauka|dane|prawo|normy|kultura) lub sources=[...] oraz warianty zapytań. " +
          "Zasady zapytań (krytyczne dla recall): " +
          "1) krótkie frazy merytoryczne po polsku (rzeczowniki + przymiotniki tematu); " +
          "2) NIE wstawiaj nazw baz (SAOS, ISAP, BDL, GUS, Biblioteka Nauki, RUJ…) ani słów meta (orzeczenia, baza, wyniki); " +
          "3) lata oddawaj filtrami / osobnym wariantem, nie jako śmieci w frazie; " +
          '4) przykłady dobre: "kredyt frankowy", "energia odnawialna", "bezrobocie małopolska"; złe: "SAOS orzeczenia kredyty frankowe 2020". ' +
          "KRYTYCZNE: NIE pisz odpowiedzi użytkownikowi. NIE zmyślaj publikacji, orzeczeń, DOI, sygnatur, liczb ani streszczeń. " +
          "Wyłącznie tool_use / function calls." +
          (routerExtraEarly ? ` ${routerExtraEarly.slice(0, 2000)}` : "");

        const forcedModelRaw = await getAppSetting<string | null>(env, "force_model", null).catch(() => null);
        const forcedModel = forcedModelRaw && String(forcedModelRaw).trim() ? String(forcedModelRaw).trim() : null;

        const planStep = pushStep(
          "llm_plan",
          "Model planuje wyszukiwanie (LLM #1)",
          "Pełny prompt systemowy i wiadomości trafiają do logu audytu.",
        );
        send("thought", {
          phase: "plan",
          message: "Model otrzymuje listę narzędzi Meta-Router i decyduje, które wywołać.",
        });

        const planStarted = new Date().toISOString();
        const plan = await callLlm(env, routerSystem, history, tools, {
          phase: "plan",
          traceId,
          userId: user?.id ?? null,
          anonKey,
          forceModel: forcedModel,
          onProviderError: (failedAttempt) => {
            send("thought", {
              phase: "plan",
              message: `Uwaga: wywołanie ${failedAttempt.provider} (${failedAttempt.resolved_model}) zwróciło błąd (${failedAttempt.http_status ?? "ERR"}) — przełączam na zapasowego providera.`,
            });
          },
        });
        const planEnded = new Date().toISOString();

        const planRecord: LlmCallRecord = {
          id: newStepId(),
          phase: "plan",
          provider: plan.provider,
          model: plan.model,
          temperature: plan.temperature,
          max_tokens: plan.max_tokens,
          system_prompt: routerSystem,
          messages: history,
          tools_offered: tools.map((t) => ({ name: t.name, description: t.description?.slice(0, 200) })),
          response_text: plan.text,
          tool_calls: plan.toolCalls,
          usage: plan.usage,
          started_at: planStarted,
          ended_at: planEnded,
          duration_ms: Date.parse(planEnded) - Date.parse(planStarted),
          raw_stop_reason: plan.stop_reason,
          cost_usd: plan.cost_usd ?? null,
          edenai_metadata: plan.edenai_metadata ?? null,
          attempts: plan.attempts,
        };
        audit.llm_calls.push(planRecord);
        send("llm", {
          id: planRecord.id,
          phase: planRecord.phase,
          provider: planRecord.provider,
          model: planRecord.model,
          temperature: planRecord.temperature,
          max_tokens: planRecord.max_tokens,
          system_prompt: planRecord.system_prompt,
          messages: planRecord.messages,
          tools_offered: planRecord.tools_offered,
          response_text: planRecord.response_text,
          tool_calls: planRecord.tool_calls,
          usage: planRecord.usage,
          duration_ms: planRecord.duration_ms,
          stop_reason: planRecord.raw_stop_reason,
          cost_usd: planRecord.cost_usd,
          edenai_metadata: planRecord.edenai_metadata,
          attempts: planRecord.attempts,
        });
        send("tokens", {
          call_id: planRecord.id,
          phase: "plan",
          usage: plan.usage,
          cumulative: sumUsage(audit.llm_calls.map((c) => c.usage)),
        });
        endStep(planStep, {
          model: plan.model,
          provider: plan.provider,
          usage: plan.usage,
          tool_call_count: plan.toolCalls.length,
          attempts: plan.attempts,
        });

        const normQ = normalizeResearchQuery(query);
        const coreQ = normQ.core || query;

        /** Rewrite every search tool-call query through the universal normalizer. */
        const rewriteSearchArgs = (args: Record<string, unknown>): Record<string, unknown> => {
          const next = { ...args };
          // Pełna jakość: nie przycinaj odpowiedzi narzędzi poniżej 100k znaków.
          next.max_chars = Math.max(Number(next.max_chars) || 0, 100_000);
          // Prefer explicit short source lists over full-category fan-out (subrequest budget).
          const cat = typeof next.category === "string" ? (next.category as SourceGroup) : null;
          let sources = Array.isArray(next.sources) ? next.sources.map(String) : [];
          if (sources.length === 0 && cat && cat in AI_SEARCH_CORE_BY_GROUP) {
            sources = [...AI_SEARCH_CORE_BY_GROUP[cat]];
            next.sources = sources;
            delete next.category;
          } else if (sources.length > 6) {
            sources = sources.slice(0, 6);
            next.sources = sources;
          }
          if (typeof next.query === "string" && next.query.trim()) {
            const n = normalizeResearchQuery(next.query);
            next.query = n.core || next.query;
            // Gdy model celuje wyłącznie w BDL — użyj krótkiej frazy wskaźnika (bez geo).
            if (sources.length === 1 && sources[0] === "bdl") {
              const { query: bdlQ } = normalizeQueryForSource(next.query as string, "bdl", ["name"]);
              next.query = bdlQ || next.query;
            }
            if (n.yearFrom) {
              const filters =
                next.filters && typeof next.filters === "object" && !Array.isArray(next.filters)
                  ? { ...(next.filters as Record<string, unknown>) }
                  : {};
              if (!filters.judgment_date_from) filters.judgment_date_from = n.yearFrom;
              next.filters = filters;
            }
          }
          return next;
        };

        let toolCalls: LlmToolCall[] = plan.toolCalls.slice(0, AI_SEARCH_MAX_TOOL_CALLS).map((tc) =>
          tc.name === "search"
            ? { ...tc, arguments: rewriteSearchArgs(tc.arguments as Record<string, unknown>) }
            : tc,
        );
        let heuristicFallback = false;

        const pushUnique = (list: LlmToolCall[], item: LlmToolCall) => {
          const key = JSON.stringify({ name: item.name, arguments: item.arguments });
          if (list.some((t) => JSON.stringify({ name: t.name, arguments: t.arguments }) === key)) {
            return list;
          }
          return [...list, item];
        };

        /** Targeted fan-out — explicit short source lists only (never bare category). */
        const buildFanout = (): LlmToolCall[] => {
          const extra: LlmToolCall[] = [];
          const cats = groups.length ? groups : (["nauka"] as SourceGroup[]);
          const fullBudget = { limit_per_source: 8, max_chars: 100_000, format: "detailed" as const };
          for (const cat of cats.slice(0, 2)) {
            extra.push({
              name: "search",
              arguments: {
                query: coreQ,
                sources: [...AI_SEARCH_CORE_BY_GROUP[cat]],
                ...fullBudget,
              },
            });
          }
          // Shorter variant improves recall on noisy APIs
          if (normQ.variants[0] && normQ.variants[0] !== coreQ) {
            const primary = cats[0] ?? "nauka";
            extra.push({
              name: "search",
              arguments: {
                query: normQ.variants[0],
                sources: AI_SEARCH_CORE_BY_GROUP[primary].slice(0, 3),
                ...fullBudget,
              },
            });
          }
          if (normQ.hints.judgments || cats.includes("prawo")) {
            extra.push({
              name: "search",
              arguments: {
                query: coreQ,
                sources: ["saos", "isap"],
                ...fullBudget,
                ...(normQ.yearFrom
                  ? { filters: { judgment_date_from: normQ.yearFrom } }
                  : {}),
              },
            });
          }
          if (normQ.hints.stats || cats.includes("dane")) {
            const isKrakow = /krak[oó]w/i.test(query);
            const daneSources: SourceId[] = isKrakow ? ["krakow_od", "bdl", "dane"] : ["bdl", "dane"];
            const bdlQ =
              normalizeQueryForSource(query, "bdl", ["name"]).query ||
              normQ.variants.find((v) => /^bezrobocie$/i.test(v)) ||
              "bezrobocie";
            extra.push({
              name: "search",
              arguments: { query: isKrakow ? coreQ : bdlQ, sources: daneSources, ...fullBudget },
            });
          }
          if (normQ.hints.publications || cats.includes("nauka")) {
            extra.push({
              name: "search",
              arguments: {
                query: coreQ,
                sources: ["bn", "ruj", "rodbuk"],
                limit_per_source: 8,
              },
            });
          }
          if (normQ.hints.culture || cats.includes("kultura")) {
            extra.push({
              name: "search",
              arguments: {
                query: coreQ,
                sources: [...AI_SEARCH_CORE_BY_GROUP.kultura],
                limit_per_source: 8,
              },
            });
          }
          if (normQ.hints.norms || cats.includes("normy")) {
            extra.push({
              name: "search",
              arguments: {
                query: coreQ,
                sources: [...AI_SEARCH_CORE_BY_GROUP.normy],
                limit_per_source: 8,
              },
            });
          }
          return extra;
        };

        const fanout = buildFanout();
        if (toolCalls.length === 0) {
          heuristicFallback = true;
          toolCalls = fanout.slice(0, AI_SEARCH_MAX_TOOL_CALLS);
          send("thought", {
            phase: "plan",
            message: `Model nie zwrócił tool_use. Heurystyka: oczyszczone zapytanie „${coreQ}” + ograniczony fan-out źródeł (budżet subrequestów Workera).`,
          });
        } else {
          // Always merge cleaned fan-out so noisy model queries don't leave empty results.
          for (const e of fanout) {
            toolCalls = pushUnique(toolCalls, e);
          }
          toolCalls = toolCalls.slice(0, AI_SEARCH_MAX_TOOL_CALLS);
          send("thought", {
            phase: "plan",
            message: `Normalizuję zapytania i dokładam ograniczony fan-out (core: „${coreQ}”, max ${AI_SEARCH_MAX_TOOL_CALLS} tool calls).`,
          });
        }

        send("tools", {
          calls: toolCalls.map((t) => ({ name: t.name, arguments: t.arguments })),
          heuristic_fallback: heuristicFallback,
        });

        const toolResults: Array<{ name: string; text: string; isError?: boolean }> = [];

        const runToolBatch = async (batch: LlmToolCall[], label: string) => {
          send("thought", {
            phase: "tool_call",
            message: `${label}: ${batch.map((t) => t.name).join(", ")}`,
          });
          await Promise.all(
            batch.map(async (tc) => {
              const toolStep = pushStep(
                "tool_call",
                `Narzędzie: ${tc.name}`,
                JSON.stringify(tc.arguments).slice(0, 500),
                { name: tc.name, arguments: tc.arguments, batch: label },
              );
              const started = new Date().toISOString();
              try {
                const result = await callMcpTool(env, tc.name, tc.arguments, explicitSources, "router");
                const text = result.content
                  .map((c) => (typeof c.text === "string" ? c.text : JSON.stringify(c)))
                  .join("\n")
                  .slice(0, 80_000);
                const ended = new Date().toISOString();
                const rec: ToolCallRecord = {
                  name: tc.name,
                  arguments: tc.arguments,
                  started_at: started,
                  ended_at: ended,
                  duration_ms: Date.parse(ended) - Date.parse(started),
                  response_text: text,
                  response_chars: text.length,
                  is_error: result.isError,
                };
                audit.tool_calls.push(rec);
                toolResults.push({ name: tc.name, text, isError: result.isError });
                endStep(toolStep, {
                  is_error: result.isError,
                  response_chars: text.length,
                  duration_ms: rec.duration_ms,
                });
                send("tool_result", {
                  name: tc.name,
                  arguments: tc.arguments,
                  is_error: result.isError,
                  response_chars: text.length,
                  preview: text.slice(0, 800),
                  response_text: text,
                  duration_ms: rec.duration_ms,
                });
              } catch (err) {
                const ended = new Date().toISOString();
                const msg = err instanceof Error ? err.message : String(err);
                const rec: ToolCallRecord = {
                  name: tc.name,
                  arguments: tc.arguments,
                  started_at: started,
                  ended_at: ended,
                  duration_ms: Date.parse(ended) - Date.parse(started),
                  response_text: msg,
                  response_chars: msg.length,
                  is_error: true,
                };
                audit.tool_calls.push(rec);
                toolResults.push({ name: tc.name, text: msg, isError: true });
                endStep(toolStep, { is_error: true, error: msg });
                send("tool_result", {
                  name: tc.name,
                  arguments: tc.arguments,
                  is_error: true,
                  response_chars: msg.length,
                  preview: msg.slice(0, 800),
                  response_text: msg,
                  duration_ms: rec.duration_ms,
                });
              }
            }),
          );
        };

        await runToolBatch(toolCalls, "Runda 1 (wyszukiwanie)");

        const resultsLookEmpty = (rows: typeof toolResults) =>
          rows.length === 0 ||
          rows.every(
            (r) =>
              r.isError ||
              r.text.length < 80 ||
              /"items"\s*:\s*\[\s*\]|items":\[\]|noRecordsMatch|brak wyników/i.test(r.text),
          );

        // Second chance: shorter variants when round 1 is empty (keep source lists short)
        if (resultsLookEmpty(toolResults) && normQ.variants.length > 0) {
          const retry: LlmToolCall[] = normQ.variants.slice(0, 2).flatMap((v) =>
            (groups.length ? groups : (["nauka"] as SourceGroup[])).slice(0, 2).map((cat) => ({
              name: "search" as const,
              arguments: {
                query: v,
                sources: AI_SEARCH_CORE_BY_GROUP[cat].slice(0, 3),
                limit_per_source: 8,
              },
            })),
          );
          if (normQ.hints.judgments) {
            retry.push({
              name: "search",
              arguments: {
                query: normQ.variants[0] || coreQ,
                sources: ["saos"],
                limit_per_source: 8,
                ...(normQ.yearFrom
                  ? { filters: { judgment_date_from: normQ.yearFrom } }
                  : {}),
              },
            });
          }
          if (retry.length) {
            send("thought", {
              phase: "plan",
              message: `Runda 1 bez trafień — ponawiam z krótszymi wariantami: ${normQ.variants.slice(0, 2).join(" · ")}`,
            });
            await runToolBatch(retry.slice(0, 3), "Runda 1b (warianty zapytania)");
          }
        }

        const deepenLimitRaw = Number(
          await getAppSetting<number>(env, "deepen_record_limit", AI_SEARCH_DEFAULT_DEEPEN),
        );
        const deepenLimit = Number.isFinite(deepenLimitRaw) && deepenLimitRaw > 0
          ? deepenLimitRaw
          : AI_SEARCH_DEFAULT_DEEPEN;
        // Cap deepen so synthesis LLM fetch still has subrequest headroom
        const deepenCalls = extractRecordTargets(
          toolResults,
          Math.min(6, Math.max(1, deepenLimit)),
        );
        if (deepenCalls.length > 0) {
          send("thought", {
            phase: "deepen",
            message: `Pogłębiam ${deepenCalls.length} rekordów (get_record z pełnym tekstem i danymi liczbowymi) pod pełniejszą odpowiedź badawczą.`,
          });
          send("tools", {
            calls: deepenCalls.map((t) => ({ name: t.name, arguments: t.arguments })),
            heuristic_fallback: false,
            deepen: true,
          });
          await runToolBatch(deepenCalls, "Runda 2 (pełne rekordy)");
        }

        send("sources", {
          items: toolResults.map((r) => ({
            tool: r.name,
            preview: r.text.slice(0, 400),
            isError: r.isError,
          })),
        });

        let prefs: UserPreferences = {
          research_context: "",
          response_style: "detailed",
          memory_notes: "",
        };
        if (user) {
          try {
            prefs = await getUserPreferences(env, user.id);
          } catch {
            /* ignore prefs load failure */
          }
        }

        const styleHint =
          prefs.response_style === "concise"
            ? "Styl: zwięzły (krótsze sekcje, bullet points, bez rozwlekłości)."
            : prefs.response_style === "academic"
              ? "Styl: akademicki (precyzyjna terminologia, ostrożne wnioskowanie, jawne ograniczenia źródeł)."
              : "Styl: szczegółowy (pogłębiony briefing, pełne cytowania, bogate tabele gdy dane na to pozwalają).";

        const prefsBlock = [
          prefs.research_context.trim()
            ? `Prywatny kontekst badacza (uwzględnij w doborze źródeł i tonie):\n${prefs.research_context.trim().slice(0, 2000)}`
            : "",
          prefs.memory_notes.trim()
            ? `Notatki pamięci użytkownika:\n${prefs.memory_notes.trim().slice(0, 2000)}`
            : "",
          styleHint,
        ]
          .filter(Boolean)
          .join("\n\n");

        const synthesisExtra = String(await getAppSetting<string>(env, "synthesis_extra", "") || "").trim();

        const synthesisSystem = `Jesteś asystentem badawczym Polish Academic MCP. Piszesz po polsku, konkretnie, bez marketingu.
Na podstawie wyników narzędzi (wyszukiwania + pełne rekordy / wyciągi PDF, arkusze, XML/HTML) przygotuj **kompletny, pogłębiony briefing badawczy** w jednej odpowiedzi: maksimum użytecznej treści za jedno pytanie, bez odesłań typu "mogę wyszukać więcej".

${prefsBlock ? `${prefsBlock}\n\n` : ""}${synthesisExtra ? `Dodatkowe wytyczne administratora:\n${synthesisExtra.slice(0, 4000)}\n\n` : ""}Struktura odpowiedzi (użyj nagłówków Markdown; wypełnij każdą sekcję treścią ze źródeł lub napisz wprost "brak danych w wynikach"):
1. **Streszczenie** (4-8 zdań) - kim / czym jest temat, zakres źródeł i główne ustalenia.
2. **Kluczowe fakty i wyniki** - wypunktowane, z konkretnymi liczbami, datami, DOI, afiliacjami, identyfikatorami gdy są w źródłach. Preferuj 8-20 punktów gdy materiał na to pozwala.
3. **Źródła i linki do pobrania** - lista z pełnymi URL, DOI, ID rekordów; zaznacz format (PDF, CSV, XML, HTML, API).
4. **Dane tabelaryczne** - gdy są szeregi liczbowe, porównania lub listy publikacji, oddaj jako tabelę Markdown (czytelne kolumny: tytuł, rok, baza, DOI/URL).
5. **Wizualizacja** - gdy dane na to pozwalają, dodaj diagram Mermaid (\`\`\`mermaid): timeline kariery/publikacji, flowchart procesu, pie/bar przez flowchart z podziałem kategorii. Nie wymyślaj liczb. Gdy brak danych liczbowych, narysuj timeline lub mapę relacji ze źródłami zamiast pisać "brak wizualizacji".
6. **Analiza / wnioski** - synteza cross-source, luki, ograniczenia danych, rozbieżności między bazami.
7. **Wytyczne dalszej pracy** - konkretne kolejne kroki (zapytania, bazy, rekordy do weryfikacji).
8. **Pytania dopytujące** - 2-3 naturalne pytania na końcu.

Zasady twarde (anty-halucynacja):
- Jedynym źródłem faktów są wyniki narzędzi poniżej (tool results). Ignoruj prozę modelu planującego i wszelkie „pamięciowe” orzeczenia/publikacje.
- Nie zmyślaj publikacji, aktów, DOI, sygnatur, dat, kwot ani cytatów. Jeśli czegoś nie ma w tool results - nie pisz tego jako faktu.
- Gdy wyniki są puste lub bez trafień: napisz wprost „brak danych w wynikach”, wskaż jakie zapytania były użyte i zaproponuj 2-3 konkretne krótsze frazy (bez nazw baz).
- Gdy wyniki są bogate: maksymalnie je wykorzystaj (tytuły, daty, URL, DOI, sygnatury ze źródeł).
- Cytuj źródła inline. Preferuj pełne URL. Przy kontynuacji rozmowy buduj na historii użytkownika, nie na zmyślonych treściach.`;

        const toolChars = toolResults.reduce((n, r) => n + (r.text?.length || 0), 0);
        const toolsLookEmpty =
          toolResults.length === 0 ||
          toolChars < 120 ||
          toolResults.every((r) =>
            /"items"\s*:\s*\[\s*\]|noRecordsMatch|brak wyników|0 wyników|items":\[\]/i.test(
              r.text || "",
            ),
          );

        const synthesisMessages: ChatMessage[] = [
          ...history.filter((m) => m.role === "user" || m.role === "system"),
          {
            role: "user",
            content:
              (toolsLookEmpty
                ? "UWAGA: wyniki narzędzi wyglądają na puste lub bez trafień. Nie zmyślaj orzeczeń ani aktów. Opisz brak danych i zaproponuj lepsze zapytania.\n\n"
                : "") +
              `Wyniki narzędzi (runda wyszukiwania + pogłębienie):\n` +
              toolResults
                .map((r) => `### ${r.name}${r.isError ? " (błąd)" : ""}\n${r.text.slice(0, 40_000)}`)
                .join("\n\n"),
          },
        ];

        const synStep = pushStep(
          "llm_synthesis",
          "Model syntezuje odpowiedź (LLM #2)",
          "Pełny kontekst wyników narzędzi jest w prompcie i w logu audytu.",
        );
        send("thought", {
          phase: "synthesis",
          message: "Model łączy wyniki narzędzi w odpowiedź z cytowaniami. Brak zmyślania poza źródłami.",
        });

        const synStarted = new Date().toISOString();
        const answer = await callLlm(env, synthesisSystem, synthesisMessages, undefined, {
          phase: "synthesis",
          traceId,
          userId: user?.id ?? null,
          anonKey,
          forceModel: forcedModel,
          onProviderError: (failedAttempt) => {
            send("thought", {
              phase: "synthesis",
              message: `Uwaga: wywołanie ${failedAttempt.provider} (${failedAttempt.resolved_model}) zwróciło błąd (${failedAttempt.http_status ?? "ERR"}) — przełączam na zapasowego providera.`,
            });
          },
        });
        const synEnded = new Date().toISOString();

        const synRecord: LlmCallRecord = {
          id: newStepId(),
          phase: "synthesis",
          provider: answer.provider,
          model: answer.model,
          temperature: answer.temperature,
          max_tokens: answer.max_tokens,
          system_prompt: synthesisSystem,
          messages: synthesisMessages,
          response_text: answer.text,
          tool_calls: answer.toolCalls,
          usage: answer.usage,
          started_at: synStarted,
          ended_at: synEnded,
          duration_ms: Date.parse(synEnded) - Date.parse(synStarted),
          raw_stop_reason: answer.stop_reason,
          cost_usd: answer.cost_usd ?? null,
          edenai_metadata: answer.edenai_metadata ?? null,
          attempts: answer.attempts,
        };
        audit.llm_calls.push(synRecord);
        send("llm", {
          id: synRecord.id,
          phase: synRecord.phase,
          provider: synRecord.provider,
          model: synRecord.model,
          temperature: synRecord.temperature,
          max_tokens: synRecord.max_tokens,
          system_prompt: synRecord.system_prompt,
          messages: synRecord.messages,
          response_text: synRecord.response_text,
          tool_calls: synRecord.tool_calls,
          usage: synRecord.usage,
          duration_ms: synRecord.duration_ms,
          stop_reason: synRecord.raw_stop_reason,
          cost_usd: synRecord.cost_usd,
          edenai_metadata: synRecord.edenai_metadata,
          attempts: synRecord.attempts,
        });

        audit.token_totals = sumUsage(audit.llm_calls.map((c) => c.usage));
        send("tokens", {
          call_id: synRecord.id,
          phase: "synthesis",
          usage: answer.usage,
          cumulative: audit.token_totals,
        });
        endStep(synStep, {
          model: answer.model,
          provider: answer.provider,
          usage: answer.usage,
          attempts: answer.attempts,
        });

        const answerText = answer.text || plan.text || "Brak odpowiedzi modelu.";
        const followups = extractFollowups(answer.text);
        audit.answer = answerText;
        audit.followups = followups;
        audit.completed_at = new Date().toISOString();

        const doneStep = pushStep("complete", "Gotowe", `Trace ${traceId}`);
        endStep(doneStep, { token_totals: audit.token_totals });

        send("answer", {
          text: answerText,
          followups,
          quota,
          authenticated: Boolean(user),
          trace_id: traceId,
          token_totals: audit.token_totals,
        });
        send("audit", audit);
        send("done", { ok: true, trace_id: traceId, token_totals: audit.token_totals });

        const emptyTools =
          audit.tool_calls.length === 0 ||
          audit.tool_calls.every(
            (t) =>
              t.is_error ||
              t.response_chars < 80 ||
              /"items"\s*:\s*\[\s*\]|items":\[\]/i.test(t.response_text || ""),
          );
        const allAttempts = audit.llm_calls.flatMap((c) =>
          (c.attempts ?? []).map((a) => ({
            phase: c.phase,
            provider: a.provider,
            requested_model: a.requested_model,
            resolved_model: a.resolved_model,
            status: a.status,
            http_status: a.http_status ?? null,
            duration_ms: a.duration_ms,
            cost_usd: a.cost_usd ?? null,
            error: a.error ? a.error.slice(0, 240) : null,
          })),
        );
        const edenConfigured = Boolean(env.EDENAI_API_KEY?.trim());
        const edenAllOk =
          edenConfigured &&
          audit.llm_calls.length > 0 &&
          audit.llm_calls.every((c) => c.provider === "edenai");
        const edenErrors = allAttempts.filter((a) => a.provider === "edenai" && a.status === "error");
        const fallbackUsed =
          edenConfigured && audit.llm_calls.some((c) => c.provider !== "edenai");

        await logActivity(env, {
          eventType: "ai_search",
          subjectKind: user ? "user" : "anon",
          userId: user?.id ?? null,
          anonKey: user ? null : anonKey,
          traceId,
          path: "/api/ai-search",
          summary: query.slice(0, 200),
          status:
            edenErrors.length > 0 || audit.tool_calls.some((t) => t.is_error)
              ? "partial"
              : emptyTools
                ? "empty"
                : "ok",
          durationMs: Date.parse(audit.completed_at || "") - Date.parse(audit.created_at),
          meta: {
            groups,
            source_ids: sourceIds.slice(0, 20),
            tool_count: audit.tool_calls.length,
            tool_names: audit.tool_calls.map((t) => t.name).slice(0, 12),
            providers_used: audit.llm_calls.map((c) => c.provider),
            models: audit.llm_calls.map((c) => `${c.provider}/${c.model}`),
            eden_configured: edenConfigured,
            eden_ok: edenAllOk,
            fallback_used: fallbackUsed,
            eden_error_count: edenErrors.length,
            eden_errors: edenErrors.slice(0, 4),
            llm_attempts: allAttempts.slice(0, 8),
            token_totals: audit.token_totals,
            answer_chars: answerText.length,
            empty_tools: emptyTools,
          },
        });
        await purgeExpiredActivityLogs(env);
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const message = withDeveloperContact(
          `Błąd wyszukiwania AI: ${raw}. Jeśli problem się powtarza (np. awaria MCP lub modelu), skontaktuj się z developerem.`,
        );
        audit.error = message;
        audit.completed_at = new Date().toISOString();
        audit.token_totals = sumUsage(audit.llm_calls.map((c) => c.usage));
        pushStep("error", "Błąd wyszukiwania", message);
        send("error", { message, trace_id: traceId });
        send("audit", audit);
        await logActivity(env, {
          eventType: "ai_search",
          subjectKind: user ? "user" : "anon",
          userId: user?.id ?? null,
          anonKey: user ? null : anonKey,
          traceId,
          path: "/api/ai-search",
          summary: query.slice(0, 200),
          status: "error",
          meta: { error: raw.slice(0, 400) },
        });
      } finally {
        controller.close();
      }
    },
  });

  const headers = new Headers({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(stream, { headers });
}

function extractFollowups(text: string): string[] {
  const lines = text.split("\n").map((l) => l.trim());
  const out: string[] = [];
  for (const line of lines) {
    const m = /^[-*]?\s*\d+[.)]\s*(.+\?)\s*$/.exec(line) || /^[-*]\s*(.+\?)\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out.slice(0, 3);
}
