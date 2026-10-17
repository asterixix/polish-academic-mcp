import type { CloudEnv } from "./env.js";
import { readSessionUser, type UserRow } from "./auth.js";
import { jsonResponse } from "./crypto-util.js";
import {
  getQuota,
  isoWeekPeriodKey,
  monthPeriodKey,
  mcpSubject,
  aiSubject,
  mcpLimit,
  aiSearchLimit,
} from "./quota.js";

export { isAdminUser, adminUidSet, adminEmailSet } from "./admin-guard.js";
import { isAdminUser } from "./admin-guard.js";

export async function requireAdmin(
  env: CloudEnv,
  request: Request,
): Promise<{ user: UserRow } | Response> {
  const user = await readSessionUser(env, request);
  if (!user || !isAdminUser(env, user)) {
    return jsonResponse({ error: "Brak uprawnień administratora." }, { status: 403 });
  }
  return { user };
}

export async function getAppSetting<T = unknown>(
  env: CloudEnv,
  key: string,
  fallback: T,
): Promise<T> {
  const row = await env.DB.prepare(`SELECT value_json FROM app_settings WHERE key = ?`)
    .bind(key)
    .first<{ value_json: string }>();
  if (!row?.value_json) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

export async function setAppSetting(
  env: CloudEnv,
  key: string,
  value: unknown,
  updatedBy: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value_json, updated_at, updated_by)
     VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = datetime('now'),
       updated_by = excluded.updated_by`,
  )
    .bind(key, JSON.stringify(value), updatedBy)
    .run();
}

export async function logAdminEvent(
  env: CloudEnv,
  level: "info" | "warn" | "error",
  source: string,
  message: string,
  detail?: unknown,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO admin_events (id, level, source, message, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(
        crypto.randomUUID(),
        level,
        source.slice(0, 80),
        message.slice(0, 500),
        detail ? JSON.stringify(detail).slice(0, 8000) : null,
      )
      .run();
  } catch {
    /* best-effort */
  }
}

async function probeBindings(env: CloudEnv) {
  const checks: Record<
    string,
    { ok: boolean; detail: string; latency_ms?: number }
  > = {};

  {
    const t0 = Date.now();
    try {
      await env.DB.prepare(`SELECT 1 AS ok`).first();
      checks.d1 = { ok: true, detail: "SELECT 1 OK", latency_ms: Date.now() - t0 };
    } catch (err) {
      checks.d1 = {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
        latency_ms: Date.now() - t0,
      };
    }
  }

  {
    const t0 = Date.now();
    const key = `admin:health:${crypto.randomUUID()}`;
    try {
      await env.CACHE_KV.put(key, "1", { expirationTtl: 60 });
      const v = await env.CACHE_KV.get(key);
      await env.CACHE_KV.delete(key);
      checks.kv = {
        ok: v === "1",
        detail: v === "1" ? "put/get/delete OK" : "get mismatch",
        latency_ms: Date.now() - t0,
      };
    } catch (err) {
      checks.kv = {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
        latency_ms: Date.now() - t0,
      };
    }
  }

  checks.workers_ai = {
    ok: Boolean(env.AI),
    detail: env.AI ? "binding present" : "missing AI binding",
  };

  checks.secrets = {
    ok: Boolean(env.SESSION_SECRET),
    detail: [
      env.SESSION_SECRET ? "SESSION_SECRET" : null,
      env.EDENAI_API_KEY ? "EDENAI_API_KEY" : null,
      env.EDENAI_MANAGEMENT_KEY ? "EDENAI_MANAGEMENT_KEY" : null,
      env.CF_API_TOKEN ? "CF_API_TOKEN" : null,
      env.ORCID_CLIENT_ID ? "ORCID" : null,
    ]
      .filter(Boolean)
      .join(", ") || "brak kluczowych sekretów",
  };

  return checks;
}

async function fetchEdenUsage(env: CloudEnv) {
  if (!env.EDENAI_MANAGEMENT_KEY) {
    return {
      configured: false,
      note: "Ustaw sekret EDENAI_MANAGEMENT_KEY (mgmt-eden-…) z uprawnieniem manage:read. Saldo kredytów jest tylko w dashboardzie Eden AI.",
      usage: null as unknown,
      error: null as string | null,
    };
  }
  try {
    const url = new URL("https://api.edenai.run/v3/manage/usage/");
    url.searchParams.set("step", "1");
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${env.EDENAI_MANAGEMENT_KEY}` },
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        configured: true,
        note: "Management API: błąd. Saldo kredytów nadal tylko w https://app.edenai.run/",
        usage: null,
        error: `${res.status}: ${text.slice(0, 400)}`,
      };
    }
    const json = JSON.parse(text) as { usage?: unknown[] };
    let totalCost = 0;
    let totalCalls = 0;
    for (const entry of json.usage ?? []) {
      const e = entry as { data?: Record<string, Record<string, { total_cost?: number; details?: number }>> };
      for (const day of Object.values(e.data ?? {})) {
        for (const feat of Object.values(day)) {
          totalCost += Number(feat.total_cost ?? 0);
          totalCalls += Number(feat.details ?? 0);
        }
      }
    }
    return {
      configured: true,
      note: "Zużycie z ostatnich ~7 dni (Management API). Saldo kredytów: dashboard Eden AI.",
      usage: { keys: json.usage?.length ?? 0, total_cost_usd: totalCost, total_calls: totalCalls, raw: json.usage },
      error: null,
    };
  } catch (err) {
    return {
      configured: true,
      note: "Nie udało się pobrać usage.",
      usage: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchCloudflareWorkersMetrics(env: CloudEnv) {
  const accountId = (env.CF_ACCOUNT_ID ?? "").trim();
  const token = (env.CF_API_TOKEN ?? "").trim();
  if (!accountId || !token) {
    return {
      configured: false,
      note: "Opcjonalnie: CF_ACCOUNT_ID + CF_API_TOKEN (Analytics Read) dla GraphQL workersInvocationsAdaptive.",
      metrics: null as unknown,
      error: null as string | null,
    };
  }
  const scriptName = (env.CF_WORKER_SCRIPT_NAME ?? "polish-academic-mcp").trim();
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const query = `query {
    viewer {
      accounts(filter: {accountTag: "${accountId}"}) {
        workersInvocationsAdaptive(
          limit: 50,
          filter: {
            scriptName: "${scriptName}",
            datetime_geq: "${start.toISOString()}",
            datetime_leq: "${end.toISOString()}"
          }
        ) {
          sum { requests errors subrequests }
          quantiles { cpuTimeP50 cpuTimeP99 }
          dimensions { status }
        }
      }
    }
  }`;
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ query }),
    });
    const json = (await res.json()) as {
      data?: { viewer?: { accounts?: Array<{ workersInvocationsAdaptive?: unknown[] }> } };
      errors?: unknown;
    };
    if (!res.ok || json.errors) {
      return {
        configured: true,
        note: "GraphQL analytics (ostatnie 24 h).",
        metrics: null,
        error: JSON.stringify(json.errors ?? { status: res.status }).slice(0, 500),
      };
    }
    const rows = json.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
    let requests = 0;
    let errors = 0;
    for (const row of rows as Array<{ sum?: { requests?: number; errors?: number } }>) {
      requests += Number(row.sum?.requests ?? 0);
      errors += Number(row.sum?.errors ?? 0);
    }
    return {
      configured: true,
      note: `Worker ${scriptName}, ostatnie 24 h.`,
      metrics: { requests, errors, rows: rows.length, sample: rows.slice(0, 5) },
      error: null,
    };
  } catch (err) {
    return {
      configured: true,
      note: "Błąd GraphQL.",
      metrics: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function handleAdminRoutes(
  request: Request,
  env: CloudEnv,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith("/api/admin")) return null;

  const gate = await requireAdmin(env, request);
  if (gate instanceof Response) return gate;
  const { user } = gate;

  if (path === "/api/admin/me" && request.method === "GET") {
    return jsonResponse({
      ok: true,
      admin: true,
      user: { id: user.id, email: user.email, display_name: user.display_name },
    });
  }

  if (path === "/api/admin/health" && request.method === "GET") {
    const [bindings, eden, cf] = await Promise.all([
      probeBindings(env),
      fetchEdenUsage(env),
      fetchCloudflareWorkersMetrics(env),
    ]);
    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM search_threads WHERE COALESCE(status,'active') != 'deleted') AS threads,
         (SELECT COUNT(*) FROM usage_quotas) AS quota_rows,
         (SELECT COUNT(*) FROM admin_events) AS events`,
    ).first<{ users: number; threads: number; quota_rows: number; events: number }>();

    return jsonResponse({
      ok: Object.values(bindings).every((c) => c.ok),
      app: env.APP_NAME ?? "Polish Academic MCP",
      model: env.AI_MODEL ?? null,
      fallback_model: env.AI_FALLBACK_MODEL ?? null,
      defaults: {
        mcp_monthly: mcpLimit(env),
        ai_search_user_weekly: aiSearchLimit(env, true),
        ai_search_anon_weekly: aiSearchLimit(env, false),
      },
      bindings,
      counts,
      eden_ai: eden,
      cloudflare: cf,
      checked_at: new Date().toISOString(),
    });
  }

  if (path === "/api/admin/users" && request.method === "GET") {
    const week = isoWeekPeriodKey();
    const month = monthPeriodKey();
    const users = await env.DB.prepare(
      `SELECT id, email, orcid_id, display_name, created_at FROM users ORDER BY created_at DESC LIMIT 200`,
    ).all<{
      id: string;
      email: string | null;
      orcid_id: string | null;
      display_name: string | null;
      created_at: string;
    }>();

    const overrides = await env.DB.prepare(
      `SELECT user_id, mcp_monthly_limit, ai_search_weekly_limit, notes FROM user_quota_overrides`,
    ).all<{
      user_id: string;
      mcp_monthly_limit: number | null;
      ai_search_weekly_limit: number | null;
      notes: string;
    }>();
    const ovMap = new Map((overrides.results ?? []).map((o) => [o.user_id, o]));

    const enriched = await Promise.all(
      (users.results ?? []).map(async (u) => {
        const ov = ovMap.get(u.id);
        const mcpLim = ov?.mcp_monthly_limit ?? mcpLimit(env);
        const aiLim = ov?.ai_search_weekly_limit ?? aiSearchLimit(env, true);
        const mcp = await getQuota(env, mcpSubject(u.id), "mcp_monthly", month, mcpLim);
        const ai = await getQuota(env, aiSubject(u.id, ""), "ai_search_weekly", week, aiLim);
        return {
          ...u,
          is_admin: isAdminUser(env, u as UserRow),
          override: ov
            ? {
                mcp_monthly_limit: ov.mcp_monthly_limit,
                ai_search_weekly_limit: ov.ai_search_weekly_limit,
                notes: ov.notes,
              }
            : null,
          quotas: {
            mcp: { used: mcp.used, limit: mcp.limit, period: month },
            ai_search: { used: ai.used, limit: ai.limit, period: week },
          },
        };
      }),
    );

    return jsonResponse({ users: enriched, period: { week, month } });
  }

  if (path === "/api/admin/users/quota" && request.method === "PUT") {
    const body = (await request.json().catch(() => ({}))) as {
      user_id?: string;
      mcp_monthly_limit?: number | null;
      ai_search_weekly_limit?: number | null;
      notes?: string;
      reset_mcp_used?: boolean;
      reset_ai_used?: boolean;
    };
    const userId = body.user_id?.trim();
    if (!userId) return jsonResponse({ error: "Podaj user_id." }, { status: 400 });

    const exists = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
    if (!exists) return jsonResponse({ error: "Nie znaleziono użytkownika." }, { status: 404 });

    const mcpLim =
      body.mcp_monthly_limit === null || body.mcp_monthly_limit === undefined
        ? null
        : Math.max(0, Math.floor(Number(body.mcp_monthly_limit)));
    const aiLim =
      body.ai_search_weekly_limit === null || body.ai_search_weekly_limit === undefined
        ? null
        : Math.max(0, Math.floor(Number(body.ai_search_weekly_limit)));

    if (mcpLim === null && aiLim === null && !body.notes) {
      await env.DB.prepare(`DELETE FROM user_quota_overrides WHERE user_id = ?`).bind(userId).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO user_quota_overrides (user_id, mcp_monthly_limit, ai_search_weekly_limit, notes, updated_at, updated_by)
         VALUES (?, ?, ?, ?, datetime('now'), ?)
         ON CONFLICT(user_id) DO UPDATE SET
           mcp_monthly_limit = excluded.mcp_monthly_limit,
           ai_search_weekly_limit = excluded.ai_search_weekly_limit,
           notes = excluded.notes,
           updated_at = datetime('now'),
           updated_by = excluded.updated_by`,
      )
        .bind(userId, mcpLim, aiLim, String(body.notes ?? "").slice(0, 500), user.id)
        .run();
    }

    if (body.reset_mcp_used) {
      await env.DB.prepare(
        `UPDATE usage_quotas SET used_count = 0, updated_at = datetime('now')
         WHERE subject_key = ? AND bucket_type = 'mcp_monthly' AND period_key = ?`,
      )
        .bind(mcpSubject(userId), monthPeriodKey())
        .run();
    }
    if (body.reset_ai_used) {
      await env.DB.prepare(
        `UPDATE usage_quotas SET used_count = 0, updated_at = datetime('now')
         WHERE subject_key = ? AND bucket_type = 'ai_search_weekly' AND period_key = ?`,
      )
        .bind(aiSubject(userId, ""), isoWeekPeriodKey())
        .run();
    }

    await logAdminEvent(env, "info", "admin.quota", `Zaktualizowano limity ${userId}`, body);
    return jsonResponse({ ok: true });
  }

  if (path === "/api/admin/settings" && request.method === "GET") {
    const keys = [
      "synthesis_extra",
      "deepen_record_limit",
      "router_extra",
      "maintenance_message",
      "force_model",
    ];
    const settings: Record<string, unknown> = {};
    for (const key of keys) {
      const row = await env.DB.prepare(
        `SELECT value_json, updated_at, updated_by FROM app_settings WHERE key = ?`,
      )
        .bind(key)
        .first<{ value_json: string; updated_at: string; updated_by: string | null }>();
      settings[key] = row
        ? { value: JSON.parse(row.value_json), updated_at: row.updated_at, updated_by: row.updated_by }
        : { value: null, updated_at: null, updated_by: null };
    }
    return jsonResponse({
      settings,
      defaults: {
        deepen_record_limit: 10,
        synthesis_extra: "",
        router_extra: "",
        maintenance_message: "",
        force_model: null,
      },
    });
  }

  if (path === "/api/admin/settings" && request.method === "PUT") {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const allowed = new Set([
      "synthesis_extra",
      "deepen_record_limit",
      "router_extra",
      "maintenance_message",
      "force_model",
    ]);
    for (const [key, value] of Object.entries(body)) {
      if (!allowed.has(key)) continue;
      await setAppSetting(env, key, value, user.id);
    }
    await logAdminEvent(env, "info", "admin.settings", "Zapisano ustawienia modelu", body);
    return jsonResponse({ ok: true });
  }

  if (path === "/api/admin/events" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT id, level, source, message, detail_json, created_at
       FROM admin_events ORDER BY created_at DESC LIMIT 100`,
    ).all();
    return jsonResponse({ events: rows.results ?? [] });
  }

  if (path === "/api/admin/activity" && request.method === "GET") {
    const { listActivityLogs, purgeExpiredActivityLogs } = await import("./activity-log.js");
    const purged = await purgeExpiredActivityLogs(env);
    const url = new URL(request.url);
    const logs = await listActivityLogs(env, {
      limit: Number(url.searchParams.get("limit") || 80),
      eventType: url.searchParams.get("type") || undefined,
      status: url.searchParams.get("status") || undefined,
      q: url.searchParams.get("q") || undefined,
    });
    return jsonResponse({
      logs,
      purged,
      note:
        "Logi RODO: anonimowi = subject_hash (SHA-256 skrót), bez IP i e-maila. Retencja: 30 dni (anon) / 180 dni (konto).",
    });
  }

  if (path === "/api/admin/events" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      level?: "info" | "warn" | "error";
      source?: string;
      message?: string;
      detail?: unknown;
    };
    await logAdminEvent(
      env,
      body.level || "info",
      body.source || "admin",
      body.message || "manual",
      body.detail,
    );
    return jsonResponse({ ok: true });
  }

  if (path === "/api/admin/cache/purge" && request.method === "POST") {
    // KV has no list-all in Workers without prefix scan; document that tool cache uses TTL.
    await logAdminEvent(env, "info", "admin.cache", "Purge requested (TTL-based cache; no full scan)");
    return jsonResponse({
      ok: true,
      message:
        "Cache narzędzi opiera się na TTL KV. Pełne wyczyszczenie namespace wymaga dashboardu Cloudflare KV. Zapisano zdarzenie.",
    });
  }

  return jsonResponse({ error: "Nieznany endpoint admin." }, { status: 404 });
}
