export interface PublicUser {
  id: string;
  email: string | null;
  orcid_id: string | null;
  display_name: string | null;
  created_at: string;
  is_admin?: boolean;
}

export const FEEDBACK_EMAIL = "artur@sendyka.dev";
export const FEEDBACK_GITHUB_ISSUES =
  "https://github.com/asterixix/polish-academic-mcp/issues/new";

export interface QuotaBucket {
  used: number;
  limit: number;
  remaining: number;
  periodKey: string;
  allowed: boolean;
}

export interface QuotaResponse {
  ai_search: QuotaBucket;
  mcp: QuotaBucket | null;
  authenticated: boolean;
}

export async function fetchMe(): Promise<PublicUser | null> {
  const res = await fetch("/api/auth/me");
  const data = (await res.json()) as { user: PublicUser | null };
  return data.user;
}

export async function fetchQuota(): Promise<QuotaResponse> {
  const res = await fetch("/api/quota");
  return (await res.json()) as QuotaResponse;
}

export async function loginEmail(email: string, password: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error || "Nie udało się zalogować.");
  return data;
}

export async function registerEmail(email: string, password: string, display_name?: string) {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, display_name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error || "Nie udało się zarejestrować.");
  return data;
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
}

export type UserPreferences = {
  research_context: string;
  response_style: "concise" | "detailed" | "academic";
  memory_notes: string;
  updated_at?: string;
};

export type ThreadSummary = {
  id: string;
  title: string | null;
  updated_at: string;
  created_at: string;
  preview?: string;
};

export async function fetchPreferences(): Promise<UserPreferences | null> {
  const res = await fetch("/api/account/preferences");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Nie udało się pobrać preferencji.");
  const data = (await res.json()) as { preferences: UserPreferences };
  return data.preferences;
}

export async function savePreferences(prefs: Partial<UserPreferences>): Promise<UserPreferences> {
  const res = await fetch("/api/account/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(prefs),
  });
  const data = (await res.json()) as { preferences?: UserPreferences; error?: string };
  if (!res.ok) throw new Error(data.error || "Nie udało się zapisać preferencji.");
  return data.preferences!;
}

export async function deleteAccount(): Promise<void> {
  const res = await fetch("/api/account", { method: "DELETE" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Nie udało się usunąć konta.");
  }
}

export async function listThreads(): Promise<ThreadSummary[]> {
  const res = await fetch("/api/threads");
  if (res.status === 401) return [];
  if (!res.ok) return [];
  const data = (await res.json()) as { threads: ThreadSummary[] };
  return data.threads ?? [];
}

export async function saveThread(payload: {
  id: string;
  title?: string;
  messages: unknown[];
  audit?: unknown;
}): Promise<{ id: string }> {
  const res = await fetch("/api/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { id?: string; error?: string };
  if (!res.ok) throw new Error(data.error || "Nie udało się zapisać rozmowy.");
  return { id: data.id || payload.id };
}

export async function loadThread(id: string): Promise<{
  id: string;
  title: string | null;
  messages: unknown[];
  audit: unknown;
} | null> {
  const res = await fetch(`/api/threads/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    thread: { id: string; title: string | null; messages: unknown[]; audit: unknown };
  };
  return data.thread;
}

export async function deleteThread(id: string): Promise<void> {
  const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Nie udało się usunąć rozmowy.");
  }
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Błąd admin (${res.status})`);
  return data;
}

export async function adminHealth() {
  return adminFetch<{
    ok: boolean;
    app: string;
    model: string | null;
    defaults: Record<string, number>;
    bindings: Record<string, { ok: boolean; detail: string; latency_ms?: number }>;
    counts: Record<string, number>;
    eden_ai: {
      configured: boolean;
      api_key_configured?: boolean;
      note: string;
      usage: unknown;
      error: string | null;
      telemetry?: {
        eden_ok_count: number;
        eden_fallback_count: number;
        eden_error_events: number;
        eden_ok_events: number;
        worker_subrequest_errors: number;
        last_error: { message: string; created_at: string; detail_json: string | null } | null;
        last_ok: { message: string; created_at: string; detail_json: string | null } | null;
        last_search_at: string | null;
      } | null;
    };
    cloudflare: { configured: boolean; note: string; metrics: unknown; error: string | null };
    checked_at: string;
  }>("/api/admin/health");
}

export async function adminTestEdenAi() {
  return adminFetch<{
    ok: boolean;
    configured: boolean;
    requested_model: string;
    normalized_model: string;
    fallbacks: string[];
    resolved_model?: string;
    http_status?: number;
    duration_ms: number;
    cost_usd?: number | null;
    response_preview?: string;
    edenai_metadata?: Record<string, unknown> | null;
    error?: string;
    error_body?: unknown;
  }>("/api/admin/eden-test", {
    method: "POST",
    body: "{}",
  });
}

export async function adminListUsers() {
  return adminFetch<{
    users: Array<{
      id: string;
      email: string | null;
      orcid_id: string | null;
      display_name: string | null;
      is_admin: boolean;
      override: {
        mcp_monthly_limit: number | null;
        ai_search_weekly_limit: number | null;
        notes: string;
      } | null;
      quotas: {
        mcp: { used: number; limit: number; period: string };
        ai_search: { used: number; limit: number; period: string };
      };
    }>;
    period: { week: string; month: string };
  }>("/api/admin/users");
}

export async function adminUpdateQuota(payload: {
  user_id: string;
  mcp_monthly_limit?: number | null;
  ai_search_weekly_limit?: number | null;
  notes?: string;
  reset_mcp_used?: boolean;
  reset_ai_used?: boolean;
}) {
  return adminFetch<{ ok: boolean }>("/api/admin/users/quota", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function adminGetSettings() {
  return adminFetch<{
    settings: Record<string, { value: unknown; updated_at: string | null; updated_by: string | null }>;
    defaults: Record<string, unknown>;
  }>("/api/admin/settings");
}

export async function adminSaveSettings(body: Record<string, unknown>) {
  return adminFetch<{ ok: boolean }>("/api/admin/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function adminListEvents() {
  return adminFetch<{
    events: Array<{
      id: string;
      level: string;
      source: string;
      message: string;
      detail_json: string | null;
      created_at: string;
    }>;
  }>("/api/admin/events");
}

export async function adminListActivity(params?: {
  type?: string;
  status?: string;
  q?: string;
  limit?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.type) sp.set("type", params.type);
  if (params?.status) sp.set("status", params.status);
  if (params?.q) sp.set("q", params.q);
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  return adminFetch<{
    logs: Array<{
      id: string;
      created_at: string;
      event_type: string;
      subject_kind: string;
      user_id: string | null;
      subject_hash: string | null;
      trace_id: string | null;
      path: string | null;
      summary: string;
      status: string;
      duration_ms: number | null;
      meta_json: string | null;
      retain_until: string;
    }>;
    purged: number;
    note: string;
  }>(`/api/admin/activity${qs ? `?${qs}` : ""}`);
}

export async function adminPurgeCache() {
  return adminFetch<{ ok: boolean; message: string }>("/api/admin/cache/purge", {
    method: "POST",
    body: "{}",
  });
}

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated: boolean;
};

export type AuditStep = {
  id: string;
  phase: string;
  title: string;
  detail?: string;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  data?: Record<string, unknown>;
};

export type LlmAttemptRecord = {
  provider: string;
  requested_model: string;
  resolved_model: string;
  fallbacks?: string[];
  status: "ok" | "error";
  http_status?: number;
  duration_ms: number;
  cost_usd?: number | null;
  edenai_metadata?: Record<string, unknown> | null;
  error?: string;
  error_body?: unknown;
};

export type LlmCallEvent = {
  id: string;
  phase: string;
  provider: string;
  model: string;
  temperature: number | null;
  max_tokens: number;
  system_prompt: string;
  messages: Array<{ role: string; content: string }>;
  tools_offered?: Array<{ name: string; description?: string }>;
  response_text: string;
  tool_calls: Array<{ name: string; arguments: Record<string, unknown> }>;
  usage: TokenUsage;
  duration_ms: number;
  stop_reason?: string;
  cost_usd?: number | null;
  edenai_metadata?: Record<string, unknown> | null;
  attempts?: LlmAttemptRecord[];
};

export type ToolResultEvent = {
  name: string;
  arguments: Record<string, unknown>;
  is_error?: boolean;
  response_chars: number;
  preview: string;
  response_text: string;
  duration_ms: number;
};

export type AuditLog = {
  schema: string;
  trace_id: string;
  created_at: string;
  completed_at?: string;
  query: string;
  authenticated: boolean;
  user_id: string | null;
  groups: string[];
  source_ids: string[];
  quota: unknown;
  steps: AuditStep[];
  llm_calls: LlmCallEvent[];
  tool_calls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    started_at: string;
    ended_at: string;
    duration_ms: number;
    response_text: string;
    response_chars: number;
    is_error?: boolean;
  }>;
  token_totals: TokenUsage;
  answer?: string;
  followups?: string[];
  error?: string;
};

export type SearchEvent =
  | { event: "status"; data: { message?: string; groups?: string[]; tool?: string; quota?: QuotaBucket; phase?: string } }
  | { event: "tools"; data: { calls?: Array<{ name: string; arguments: Record<string, unknown> }>; heuristic_fallback?: boolean } }
  | { event: "sources"; data: { items?: Array<{ tool: string; preview: string; isError?: boolean }> } }
  | {
      event: "answer";
      data: {
        text?: string;
        followups?: string[];
        quota?: QuotaBucket;
        authenticated?: boolean;
        trace_id?: string;
        token_totals?: TokenUsage;
      };
    }
  | { event: "token"; data: { text: string } }
  | { event: "error"; data: { message?: string; trace_id?: string } }
  | { event: "done"; data: { ok?: boolean; trace_id?: string; token_totals?: TokenUsage } }
  | { event: "audit_meta"; data: { trace_id: string; schema: string; created_at: string; query: string; authenticated: boolean } }
  | { event: "step"; data: AuditStep }
  | { event: "thought"; data: { phase: string; message: string } }
  | { event: "llm"; data: LlmCallEvent }
  | { event: "tokens"; data: { call_id: string; phase: string; usage: TokenUsage; cumulative: TokenUsage } }
  | { event: "tool_result"; data: ToolResultEvent }
  | { event: "audit"; data: AuditLog };

export async function* streamAiSearch(
  query: string,
  options: { sources?: string; messages?: Array<{ role: string; content: string }> } = {},
): AsyncGenerator<SearchEvent> {
  const res = await fetch("/api/ai-search", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({
      query,
      sources: options.sources || undefined,
      messages: options.messages,
    }),
  });

  if (res.status === 429) {
    const data = (await res.json()) as { message?: string; login_required?: boolean };
    const base =
      data.message ||
      (data.login_required
        ? "Limit bez logowania wyczerpany. Zaloguj się, aby kontynuować."
        : "Limit wyszukiwań wyczerpany.");
    yield {
      event: "error",
      data: {
        message: base.includes(FEEDBACK_EMAIL)
          ? base
          : `${base}\n\nPytania o limity: ${FEEDBACK_EMAIL}`,
      },
    };
    return;
  }

  if (!res.ok || !res.body) {
    let detail = `Błąd serwera (${res.status}).`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      detail = data.message || data.error || detail;
    } catch {
      /* ignore */
    }
    yield {
      event: "error",
      data: {
        message: detail.includes(FEEDBACK_EMAIL)
          ? detail
          : `${detail}\n\nZgłoś problem: ${FEEDBACK_EMAIL} lub ${FEEDBACK_GITHUB_ISSUES}`,
      },
    };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const lines = part.split("\n");
      let event = "message";
      let raw = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) raw += line.slice(5).trim();
      }
      if (!raw) continue;
      try {
        yield { event, data: JSON.parse(raw) } as SearchEvent;
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
}

export function b64urlToBuf(s: string): ArrayBuffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export function bufToB64url(buf: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
