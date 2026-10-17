import type { CloudEnv } from "./env.js";
import { publicOrigin, reviewerDemoCredentials, sessionSecret } from "./env.js";
import { isAdminUser } from "./admin-guard.js";
import {
  clearCookie,
  cookieHeader,
  hashPassword,
  jsonResponse,
  parseCookies,
  randomId,
  randomToken,
  sha256Hex,
  signPayload,
  verifyPassword,
  verifyPayload,
} from "./crypto-util.js";

export const SESSION_COOKIE = "pamcp_session";
export const ANON_COOKIE = "pamcp_anon";

export interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  orcid_id: string | null;
  display_name: string | null;
  created_at: string;
}

interface SessionPayload extends Record<string, unknown> {
  uid: string;
  exp: number;
}

const SESSION_TTL_SEC = 60 * 60 * 24 * 30;

export async function getUserById(env: CloudEnv, id: string): Promise<UserRow | null> {
  return env.DB.prepare(
    `SELECT id, email, password_hash, orcid_id, display_name, created_at FROM users WHERE id = ?`,
  )
    .bind(id)
    .first<UserRow>();
}

export async function getUserByEmail(env: CloudEnv, email: string): Promise<UserRow | null> {
  return env.DB.prepare(
    `SELECT id, email, password_hash, orcid_id, display_name, created_at FROM users WHERE email = ?`,
  )
    .bind(email.toLowerCase())
    .first<UserRow>();
}

export async function createSessionCookie(env: CloudEnv, userId: string): Promise<string> {
  const token = await signPayload(sessionSecret(env), {
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  } satisfies SessionPayload);
  return cookieHeader(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SEC });
}

export async function readSessionUser(env: CloudEnv, request: Request): Promise<UserRow | null> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  const payload = await verifyPayload<SessionPayload>(sessionSecret(env), raw);
  if (!payload?.uid || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return getUserById(env, payload.uid);
}

export async function ensureAnonKey(env: CloudEnv, request: Request): Promise<{
  anonKey: string;
  setCookie?: string;
}> {
  const cookies = parseCookies(request.headers.get("cookie"));
  if (cookies[ANON_COOKIE]?.length) {
    return { anonKey: cookies[ANON_COOKIE] };
  }
  const ip = request.headers.get("cf-connecting-ip") ?? "0.0.0.0";
  const ua = request.headers.get("user-agent") ?? "";
  const anonKey = await sha256Hex(`${ip}|${ua}|${sessionSecret(env)}`);
  return {
    anonKey,
    setCookie: cookieHeader(ANON_COOKIE, anonKey, { maxAge: 60 * 60 * 24 * 90, httpOnly: true }),
  };
}

export async function ensureReviewerDemoUser(env: CloudEnv): Promise<UserRow | null> {
  const demo = reviewerDemoCredentials(env);
  if (!demo) return null;
  const existing = await getUserByEmail(env, demo.email);
  if (existing) return existing;
  const id = "usr_reviewer_demo_01";
  const password_hash = await hashPassword(demo.password);
  const display_name = "Directory Reviewer (Demo)";
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, demo.email, password_hash, display_name)
    .run();
  return getUserById(env, id);
}

function publicUser(user: UserRow, env?: CloudEnv) {
  return {
    id: user.id,
    email: user.email,
    orcid_id: user.orcid_id,
    display_name: user.display_name,
    created_at: user.created_at,
    is_admin: env ? isAdminUser(env, user) : false,
  };
}

export async function handleAuthRoutes(
  request: Request,
  env: CloudEnv,
  path: string,
): Promise<Response | null> {
  if (path === "/api/auth/me" && request.method === "GET") {
    const user = await readSessionUser(env, request);
    return jsonResponse({ user: user ? publicUser(user, env) : null });
  }

  if (path === "/api/auth/logout" && request.method === "POST") {
    return jsonResponse(
      { ok: true },
      { headers: { "set-cookie": clearCookie(SESSION_COOKIE) } },
    );
  }

  if (path === "/api/auth/register" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as {
      email?: string;
      password?: string;
      display_name?: string;
    } | null;
    const email = body?.email?.trim().toLowerCase() ?? "";
    const password = body?.password ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
      return jsonResponse(
        { error: "Podaj poprawny email i hasło (min. 8 znaków)." },
        { status: 400 },
      );
    }
    const existing = await getUserByEmail(env, email);
    if (existing) {
      return jsonResponse({ error: "Konto z tym emailem już istnieje." }, { status: 409 });
    }
    const id = randomId(18);
    const password_hash = await hashPassword(password);
    const display_name = body?.display_name?.trim() || email.split("@")[0];
    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)`,
    )
      .bind(id, email, password_hash, display_name)
      .run();
    const user = await getUserById(env, id);
    const setCookie = await createSessionCookie(env, id);
    return jsonResponse({ user: user ? publicUser(user) : null }, { headers: { "set-cookie": setCookie } });
  }

  if (path === "/api/auth/login" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as {
      email?: string;
      password?: string;
    } | null;
    const email = body?.email?.trim().toLowerCase() ?? "";
    const password = body?.password ?? "";
    const demo = reviewerDemoCredentials(env);
    let user = await getUserByEmail(env, email);
    if (!user && demo && email === demo.email && password === demo.password) {
      user = await ensureReviewerDemoUser(env);
    }
    if (!user?.password_hash || !(await verifyPassword(password, user.password_hash))) {
      return jsonResponse({ error: "Nieprawidłowy email lub hasło." }, { status: 401 });
    }
    const setCookie = await createSessionCookie(env, user.id);
    return jsonResponse({ user: publicUser(user) }, { headers: { "set-cookie": setCookie } });
  }

  if (path === "/api/auth/orcid/start" && request.method === "GET") {
    const clientId = env.ORCID_CLIENT_ID?.trim();
    if (!clientId) {
      return jsonResponse(
        { error: "ORCID nie jest skonfigurowany (ORCID_CLIENT_ID / ORCID_CLIENT_SECRET)." },
        { status: 503 },
      );
    }
    const state = randomToken(24);
    const origin = publicOrigin(request, env);
    const redirectUri = `${origin}/api/auth/orcid/callback`;
    const url = new URL("https://orcid.org/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "/authenticate");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    const headers = new Headers({
      location: url.toString(),
      "set-cookie": cookieHeader("pamcp_orcid_state", state, { maxAge: 600 }),
    });
    const next = new URL(request.url).searchParams.get("next");
    if (next) {
      headers.append(
        "set-cookie",
        cookieHeader("pamcp_orcid_next", next, { maxAge: 600, httpOnly: true }),
      );
    }
    return new Response(null, { status: 302, headers });
  }

  if (path === "/api/auth/orcid/callback" && request.method === "GET") {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = parseCookies(request.headers.get("cookie"));
    if (!code || !state || state !== cookies.pamcp_orcid_state) {
      return jsonResponse({ error: "Nieprawidłowy stan ORCID OAuth." }, { status: 400 });
    }
    const clientId = env.ORCID_CLIENT_ID?.trim();
    const clientSecret = env.ORCID_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      return jsonResponse({ error: "ORCID nie jest skonfigurowany." }, { status: 503 });
    }
    const origin = publicOrigin(request, env);
    const tokenRes = await fetch("https://orcid.org/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${origin}/api/auth/orcid/callback`,
      }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return jsonResponse({ error: `ORCID token error: ${text.slice(0, 300)}` }, { status: 502 });
    }
    const tokenJson = (await tokenRes.json()) as {
      orcid?: string;
      name?: string;
      access_token?: string;
    };
    const orcid = tokenJson.orcid?.trim();
    if (!orcid) {
      return jsonResponse({ error: "ORCID nie zwrócił identyfikatora." }, { status: 502 });
    }
    let user = await env.DB.prepare(
      `SELECT id, email, password_hash, orcid_id, display_name, created_at FROM users WHERE orcid_id = ?`,
    )
      .bind(orcid)
      .first<UserRow>();
    if (!user) {
      const id = randomId(18);
      const display_name = tokenJson.name?.trim() || orcid;
      await env.DB.prepare(`INSERT INTO users (id, orcid_id, display_name) VALUES (?, ?, ?)`)
        .bind(id, orcid, display_name)
        .run();
      user = await getUserById(env, id);
    }
    if (!user) {
      return jsonResponse({ error: "Nie udało się utworzyć konta ORCID." }, { status: 500 });
    }
    const setCookie = await createSessionCookie(env, user.id);
    const next = cookies.pamcp_orcid_next || "/account";
    const headers = new Headers({ location: next });
    headers.append("set-cookie", setCookie);
    headers.append("set-cookie", clearCookie("pamcp_orcid_state"));
    headers.append("set-cookie", clearCookie("pamcp_orcid_next"));
    return new Response(null, { status: 302, headers });
  }

  return null;
}
