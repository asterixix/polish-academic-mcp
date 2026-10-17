import type { CloudEnv } from "./env.js";

/** Retention (days). Anonymous = shorter; authenticated = longer for support. */
export const ACTIVITY_RETENTION_ANON_DAYS = 30;
export const ACTIVITY_RETENTION_USER_DAYS = 180;

export type ActivityEventType =
  | "ai_search"
  | "mcp_tools_call"
  | "mcp_request"
  | "page_feedback"
  | "error";

export type ActivityStatus = "ok" | "error" | "quota" | "empty" | "partial";

function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** One-way subject key for anonymous visitors (no PII). */
export async function hashSubject(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 32);
}

/** Redact emails / long tokens from free text before persistence. */
export function redactSummary(text: string, max = 480): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export async function logActivity(
  env: CloudEnv,
  opts: {
    eventType: ActivityEventType;
    subjectKind: "user" | "anon";
    userId?: string | null;
    anonKey?: string | null;
    traceId?: string | null;
    path?: string | null;
    summary: string;
    status?: ActivityStatus;
    durationMs?: number | null;
    meta?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    const subjectHash =
      opts.subjectKind === "anon" && opts.anonKey
        ? await hashSubject(opts.anonKey)
        : opts.subjectKind === "user" && opts.userId
          ? await hashSubject(`user:${opts.userId}`)
          : null;
    const retainDays =
      opts.subjectKind === "user" ? ACTIVITY_RETENTION_USER_DAYS : ACTIVITY_RETENTION_ANON_DAYS;
    const id = crypto.randomUUID();
    const metaJson = opts.meta ? JSON.stringify(opts.meta).slice(0, 8_000) : null;
    await env.DB.prepare(
      `INSERT INTO activity_logs
        (id, created_at, event_type, subject_kind, user_id, subject_hash, trace_id, path, summary, status, duration_ms, meta_json, retain_until)
       VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        opts.eventType,
        opts.subjectKind,
        opts.userId ?? null,
        subjectHash,
        opts.traceId ?? null,
        opts.path ?? null,
        redactSummary(opts.summary),
        opts.status ?? "ok",
        opts.durationMs ?? null,
        metaJson,
        daysFromNow(retainDays),
      )
      .run();
  } catch (err) {
    console.error("activity log failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Delete rows past retain_until. Safe to call opportunistically. */
export async function purgeExpiredActivityLogs(env: CloudEnv): Promise<number> {
  try {
    const res = await env.DB.prepare(
      `DELETE FROM activity_logs WHERE retain_until < datetime('now')`,
    ).run();
    return res.meta?.changes ?? 0;
  } catch {
    return 0;
  }
}

export async function listActivityLogs(
  env: CloudEnv,
  opts?: { limit?: number; eventType?: string; status?: string; q?: string },
): Promise<
  Array<{
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
  }>
> {
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 80));
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (opts?.eventType) {
    clauses.push("event_type = ?");
    binds.push(opts.eventType);
  }
  if (opts?.status) {
    clauses.push("status = ?");
    binds.push(opts.status);
  }
  if (opts?.q?.trim()) {
    clauses.push("(summary LIKE ? OR trace_id LIKE ? OR user_id LIKE ?)");
    const like = `%${opts.q.trim().slice(0, 80)}%`;
    binds.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await env.DB.prepare(
    `SELECT id, created_at, event_type, subject_kind, user_id, subject_hash, trace_id, path,
            summary, status, duration_ms, meta_json, retain_until
     FROM activity_logs ${where}
     ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all();
  return (rows.results ?? []) as Array<{
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
}
