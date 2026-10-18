import type { CloudEnv } from "./env.js";
import { readSessionUser } from "./auth.js";
import { jsonResponse } from "./crypto-util.js";

export const SEARCH_GROUPS = ["nauka", "dane", "prawo", "normy", "kultura"] as const;

export type UserPreferences = {
  research_context: string;
  response_style: "concise" | "detailed" | "academic";
  memory_notes: string;
  default_groups: string[];
  default_per_source: number;
  updated_at?: string;
};

export type ThreadSummary = {
  id: string;
  title: string | null;
  updated_at: string;
  created_at: string;
  preview?: string;
};

const STYLE_SET = new Set(["concise", "detailed", "academic"]);
const GROUP_SET = new Set<string>(SEARCH_GROUPS);

const DEFAULT_PREFS: UserPreferences = {
  research_context: "",
  response_style: "detailed",
  memory_notes: "",
  default_groups: [],
  default_per_source: 8,
};

export function parseDefaultGroups(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  return [...new Set(items.map((s) => String(s).trim()).filter((s) => GROUP_SET.has(s)))];
}

export function clampPerSource(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 8;
}

export async function getUserPreferences(env: CloudEnv, userId: string): Promise<UserPreferences> {
  const row = await env.DB.prepare(
    `SELECT research_context, response_style, memory_notes, default_groups, default_per_source, updated_at
     FROM user_preferences WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{
      research_context: string;
      response_style: string;
      memory_notes: string;
      default_groups: string;
      default_per_source: number;
      updated_at: string;
    }>();
  if (!row) return { ...DEFAULT_PREFS, default_groups: [] };
  const style = STYLE_SET.has(row.response_style)
    ? (row.response_style as UserPreferences["response_style"])
    : "detailed";
  return {
    research_context: row.research_context || "",
    response_style: style,
    memory_notes: row.memory_notes || "",
    default_groups: parseDefaultGroups(row.default_groups),
    default_per_source: clampPerSource(row.default_per_source),
    updated_at: row.updated_at,
  };
}

export async function handleAccountApiRoutes(
  request: Request,
  env: CloudEnv,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith("/api/account") && !path.startsWith("/api/threads")) return null;

  const user = await readSessionUser(env, request);
  if (!user) {
    return jsonResponse({ error: "Wymagane logowanie." }, { status: 401 });
  }

  if (path === "/api/account/preferences" && request.method === "GET") {
    const prefs = await getUserPreferences(env, user.id);
    return jsonResponse({ preferences: prefs });
  }

  if (path === "/api/account/preferences" && request.method === "PUT") {
    const body = (await request.json().catch(() => ({}))) as Partial<UserPreferences>;
    const research_context = String(body.research_context ?? "").slice(0, 4000);
    const memory_notes = String(body.memory_notes ?? "").slice(0, 4000);
    const response_style = STYLE_SET.has(String(body.response_style))
      ? String(body.response_style)
      : "detailed";
    const default_groups = parseDefaultGroups(body.default_groups).join(",");
    const default_per_source = clampPerSource(body.default_per_source);
    await env.DB.prepare(
      `INSERT INTO user_preferences (user_id, research_context, response_style, memory_notes, default_groups, default_per_source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         research_context = excluded.research_context,
         response_style = excluded.response_style,
         memory_notes = excluded.memory_notes,
         default_groups = excluded.default_groups,
         default_per_source = excluded.default_per_source,
         updated_at = datetime('now')`,
    )
      .bind(user.id, research_context, response_style, memory_notes, default_groups, default_per_source)
      .run();
    return jsonResponse({
      ok: true,
      preferences: {
        research_context,
        response_style,
        memory_notes,
        default_groups: default_groups ? default_groups.split(",") : [],
        default_per_source,
      },
    });
  }

  if (path === "/api/account" && request.method === "DELETE") {
    await env.DB.prepare(`DELETE FROM search_threads WHERE user_id = ?`).bind(user.id).run();
    await env.DB.prepare(`DELETE FROM user_preferences WHERE user_id = ?`).bind(user.id).run();
    await env.DB.prepare(`DELETE FROM oauth_tokens WHERE user_id = ?`).bind(user.id).run().catch(() => {});
    await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(user.id).run();
    const headers = new Headers({ "content-type": "application/json" });
    headers.append(
      "set-cookie",
      "pam_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    );
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (path === "/api/threads" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT id, title, created_at, updated_at, messages_json
       FROM search_threads WHERE user_id = ? AND COALESCE(status,'active') != 'deleted'
       ORDER BY updated_at DESC LIMIT 50`,
    )
      .bind(user.id)
      .all<{
        id: string;
        title: string | null;
        created_at: string;
        updated_at: string;
        messages_json: string;
      }>();
    const threads: ThreadSummary[] = (rows.results ?? []).map((r) => {
      let preview = "";
      try {
        const msgs = JSON.parse(r.messages_json || "[]") as Array<{ content?: string }>;
        preview = String(msgs[0]?.content || "").slice(0, 120);
      } catch {
        preview = "";
      }
      return {
        id: r.id,
        title: r.title,
        created_at: r.created_at,
        updated_at: r.updated_at,
        preview,
      };
    });
    return jsonResponse({ threads });
  }

  if (path === "/api/threads" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      title?: string;
      messages?: unknown;
      audit?: unknown;
    };
    const id = body.id?.trim() || crypto.randomUUID();
    const messagesJson = JSON.stringify(body.messages ?? []);
    const auditJson = body.audit ? JSON.stringify(body.audit) : null;
    const title =
      body.title?.trim() ||
      (Array.isArray(body.messages) &&
      typeof (body.messages as Array<{ content?: string }>)[0]?.content === "string"
        ? String((body.messages as Array<{ content?: string }>)[0].content).slice(0, 80)
        : "Rozmowa");

    const existing = await env.DB.prepare(`SELECT id FROM search_threads WHERE id = ? AND user_id = ?`)
      .bind(id, user.id)
      .first();
    if (existing) {
      await env.DB.prepare(
        `UPDATE search_threads SET title = ?, messages_json = ?, audit_json = COALESCE(?, audit_json),
         updated_at = datetime('now'), status = 'active' WHERE id = ? AND user_id = ?`,
      )
        .bind(title, messagesJson, auditJson, id, user.id)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO search_threads (id, user_id, title, messages_json, audit_json, created_at, updated_at, status)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'active')`,
      )
        .bind(id, user.id, title, messagesJson, auditJson)
        .run();
    }
    return jsonResponse({ ok: true, id, title });
  }

  const threadMatch = /^\/api\/threads\/([^/]+)$/.exec(path);
  if (threadMatch && request.method === "GET") {
    const id = decodeURIComponent(threadMatch[1]);
    const row = await env.DB.prepare(
      `SELECT id, title, messages_json, audit_json, created_at, updated_at
       FROM search_threads WHERE id = ? AND user_id = ? AND COALESCE(status,'active') != 'deleted'`,
    )
      .bind(id, user.id)
      .first<{
        id: string;
        title: string | null;
        messages_json: string;
        audit_json: string | null;
        created_at: string;
        updated_at: string;
      }>();
    if (!row) return jsonResponse({ error: "Nie znaleziono rozmowy." }, { status: 404 });
    let messages: unknown[] = [];
    let audit: unknown = null;
    try {
      messages = JSON.parse(row.messages_json || "[]") as unknown[];
    } catch {
      messages = [];
    }
    try {
      audit = row.audit_json ? JSON.parse(row.audit_json) : null;
    } catch {
      audit = null;
    }
    return jsonResponse({
      thread: {
        id: row.id,
        title: row.title,
        messages,
        audit,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  }

  if (threadMatch && request.method === "DELETE") {
    const id = decodeURIComponent(threadMatch[1]);
    await env.DB.prepare(
      `UPDATE search_threads SET status = 'deleted', updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    )
      .bind(id, user.id)
      .run();
    return jsonResponse({ ok: true });
  }

  return null;
}
