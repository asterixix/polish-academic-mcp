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

export function monthPeriodKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** ISO week key: YYYY-Www (UTC). */
export function isoWeekPeriodKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
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

export function nextMonthResetMessage(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  return next.toISOString().slice(0, 10);
}

export function nextWeekResetMessage(periodKey: string): string {
  // Approximate: Monday of next ISO week
  const match = /^(\d{4})-W(\d{2})$/.exec(periodKey);
  if (!match) return periodKey;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7 + 7);
  return monday.toISOString().slice(0, 10);
}
