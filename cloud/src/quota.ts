import type { CloudEnv } from "./env.js";
import { intVar } from "./env.js";

export type QuotaBucket = "mcp_monthly" | "ai_search_weekly";

export interface QuotaStatus {
  subjectKey: string;
  bucketType: QuotaBucket;
  periodKey: string;
  used: number;
  limit: number;
  remaining: number;
  allowed: boolean;
}

/** Reset cutoff: 17:00 Europe/Warsaw (AI Search: Sundays; MCP: last day of month). */
const RESET_HOUR = 17;
const WARSAW = "Europe/Warsaw";
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function warsawLocal(date: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: WARSAW,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), dow: DOW[p.weekday] };
}

const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Month key YYYY-MM; window M ends last day of M at 17:00 Warsaw. */
export function monthPeriodKey(date = new Date()): string {
  const l = warsawLocal(date);
  const afterCutoff = l.d === lastDayOf(l.y, l.m) && l.h >= RESET_HOUR;
  const k = afterCutoff ? new Date(Date.UTC(l.y, l.m, 1)) : new Date(Date.UTC(l.y, l.m - 1, 1));
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** AI Search window key: YYYY-MM-DD of the Sunday 17:00 Warsaw that opened the window. */
export function aiPeriodKey(date = new Date()): string {
  const l = warsawLocal(date);
  const back = l.dow === 0 ? (l.h >= RESET_HOUR ? 0 : 7) : l.dow;
  return new Date(Date.UTC(l.y, l.m - 1, l.d - back)).toISOString().slice(0, 10);
}

export function mcpLimit(env: CloudEnv): number {
  return intVar(env.MCP_MONTHLY_LIMIT, 100);
}

export function aiSearchLimit(env: CloudEnv, authenticated: boolean): number {
  return authenticated
    ? intVar(env.AI_SEARCH_USER_WEEKLY_LIMIT, 5)
    : intVar(env.AI_SEARCH_ANON_WEEKLY_LIMIT, 2);
}

export type UserQuotaOverride = {
  mcp_monthly_limit: number | null;
  ai_search_weekly_limit: number | null;
};

export async function getUserQuotaOverride(
  env: CloudEnv,
  userId: string,
): Promise<UserQuotaOverride | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT mcp_monthly_limit, ai_search_weekly_limit FROM user_quota_overrides WHERE user_id = ?`,
    )
      .bind(userId)
      .first<{ mcp_monthly_limit: number | null; ai_search_weekly_limit: number | null }>();
    if (!row) return null;
    return {
      mcp_monthly_limit: row.mcp_monthly_limit,
      ai_search_weekly_limit: row.ai_search_weekly_limit,
    };
  } catch {
    return null;
  }
}

export async function resolveMcpLimit(env: CloudEnv, userId: string): Promise<number> {
  const ov = await getUserQuotaOverride(env, userId);
  if (ov?.mcp_monthly_limit != null && ov.mcp_monthly_limit >= 0) return ov.mcp_monthly_limit;
  return mcpLimit(env);
}

export async function resolveAiSearchLimit(
  env: CloudEnv,
  userId: string | null,
  authenticated: boolean,
): Promise<number> {
  if (userId) {
    const ov = await getUserQuotaOverride(env, userId);
    if (ov?.ai_search_weekly_limit != null && ov.ai_search_weekly_limit >= 0) {
      return ov.ai_search_weekly_limit;
    }
  }
  return aiSearchLimit(env, authenticated);
}

export async function getQuota(
  env: CloudEnv,
  subjectKey: string,
  bucketType: QuotaBucket,
  periodKey: string,
  limit: number,
): Promise<QuotaStatus> {
  const row = await env.DB.prepare(
    `SELECT used_count FROM usage_quotas
     WHERE subject_key = ? AND bucket_type = ? AND period_key = ?`,
  )
    .bind(subjectKey, bucketType, periodKey)
    .first<{ used_count: number }>();
  const used = row?.used_count ?? 0;
  return {
    subjectKey,
    bucketType,
    periodKey,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    allowed: used < limit,
  };
}

/** Atomically consume one unit if under limit. Returns updated status. */
export async function consumeQuota(
  env: CloudEnv,
  subjectKey: string,
  bucketType: QuotaBucket,
  periodKey: string,
  limit: number,
): Promise<QuotaStatus> {
  const current = await getQuota(env, subjectKey, bucketType, periodKey, limit);
  if (!current.allowed) return current;

  await env.DB.prepare(
    `INSERT INTO usage_quotas (subject_key, bucket_type, period_key, used_count, updated_at)
     VALUES (?, ?, ?, 1, datetime('now'))
     ON CONFLICT(subject_key, bucket_type, period_key) DO UPDATE SET
       used_count = used_count + 1,
       updated_at = datetime('now')
     WHERE used_count < ?`,
  )
    .bind(subjectKey, bucketType, periodKey, limit)
    .run();

  return getQuota(env, subjectKey, bucketType, periodKey, limit);
}

export function mcpSubject(userId: string): string {
  return `user:${userId}`;
}

export function aiSubject(userId: string | null, anonKey: string): string {
  return userId ? `user:${userId}` : `anon:${anonKey}`;
}

function formatReset(y: number, m: number, d: number): string {
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y} o ${RESET_HOUR}:00 (czas polski)`;
}

export function nextMonthResetMessage(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  return formatReset(y, m, lastDayOf(y, m));
}

export function nextWeekResetMessage(periodKey: string): string {
  const [y, m, d] = periodKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 7));
  return formatReset(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}
