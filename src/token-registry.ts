import type { Env } from "./types.js";
import { verifyMcpJwtSignature } from "./oauth-jwt.js";
import { getRateLimitStatus } from "./ratelimit.js";

export interface RateLimitTokenRecord {
  jti: string;
  createdAtMs: number;
  createdBy?: string;

  // Administrative policy (dynamic, enforced by KV).
  bypass: boolean;
  limitPerHour: number;

  // Token-level expiry (dynamic; enforced by KV).
  expiresAtMs: number;

  // Optional additional MCP tools beyond the guest/public baseline.
  // Empty/undefined means "public tools only".
  allowedTools?: string[];

  revokedAtMs?: number;
  revokeReason?: string;

  // Optional fields for panel UX.
  label?: string;
  owner?: string;

  /**
   * Przy opcjonalnym `POST /register` z Connect JWT w Bearer: limit tools/call/h
   * dla access_token klientów zarejestrowanych z tym JWT (puste = jak env globalnie).
   */
  oauthAccessLimitPerHour?: number;
  /**
   * Przy rejestracji OAuth: TTL access_token w sekundach (puste = jak env globalnie).
   */
  oauthAccessTokenTtlSeconds?: number;
}

/** Hourly `tools/call` budget for OAuth access_token (third-party MCP client, e.g. Claude). */
export const DEFAULT_OAUTH_ACCESS_LIMIT_PER_HOUR = 60;

const MAX_OAUTH_ACCESS_LIMIT_PER_HOUR = 500_000;
const DEFAULT_OAUTH_ACCESS_TOKEN_TTL_SECONDS = 3600;
const MAX_OAUTH_ACCESS_TOKEN_TTL_SECONDS = 86400 * 7;

export function getOAuthAccessLimitPerHour(env: Env): number {
  const raw = env.OAUTH_ACCESS_LIMIT_PER_HOUR;
  if (raw === undefined || String(raw).trim() === "") return DEFAULT_OAUTH_ACCESS_LIMIT_PER_HOUR;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_OAUTH_ACCESS_LIMIT_PER_HOUR;
  const floored = Math.floor(n);
  if (floored < 1) return DEFAULT_OAUTH_ACCESS_LIMIT_PER_HOUR;
  return Math.min(floored, MAX_OAUTH_ACCESS_LIMIT_PER_HOUR);
}

/** TTL of OAuth access_token JWT (`exp` claim and `expires_in` response). */
export function getOAuthAccessTokenTtlSeconds(env: Env): number {
  const raw = env.OAUTH_ACCESS_TOKEN_TTL_SECONDS;
  if (raw === undefined || String(raw).trim() === "") return DEFAULT_OAUTH_ACCESS_TOKEN_TTL_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_OAUTH_ACCESS_TOKEN_TTL_SECONDS;
  const floored = Math.floor(n);
  if (floored < 60) return DEFAULT_OAUTH_ACCESS_TOKEN_TTL_SECONDS;
  return Math.min(floored, MAX_OAUTH_ACCESS_TOKEN_TTL_SECONDS);
}

/** Nagłówek KV — musi być zgodny z `oauth-server.ts` (`oauth_client:`). */
const OAUTH_CLIENT_KV_PREFIX = "oauth_client:";

export function clampOptionalOauthAccessLimitPerHour(
  n: unknown,
): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  const f = Math.floor(n);
  if (f < 1) return undefined;
  return Math.min(f, MAX_OAUTH_ACCESS_LIMIT_PER_HOUR);
}

export function clampOptionalOauthAccessTokenTtlSeconds(n: unknown): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  const f = Math.floor(n);
  if (f < 60) return undefined;
  return Math.min(f, MAX_OAUTH_ACCESS_TOKEN_TTL_SECONDS);
}

export async function getEffectiveOAuthAccessLimitPerHour(env: Env, clientId: string): Promise<number> {
  const fallback = getOAuthAccessLimitPerHour(env);
  const raw = await env.TOKEN_REGISTRY_KV.get(`${OAUTH_CLIENT_KV_PREFIX}${clientId}`);
  if (!raw) return fallback;
  try {
    const c = JSON.parse(raw) as { accessLimitPerHour?: number };
    const lim = clampOptionalOauthAccessLimitPerHour(c.accessLimitPerHour);
    if (lim !== undefined) return lim;
  } catch {
    // ignore
  }
  return fallback;
}

export async function getEffectiveOAuthAccessTokenTtlSeconds(env: Env, clientId: string): Promise<number> {
  const fallback = getOAuthAccessTokenTtlSeconds(env);
  const raw = await env.TOKEN_REGISTRY_KV.get(`${OAUTH_CLIENT_KV_PREFIX}${clientId}`);
  if (!raw) return fallback;
  try {
    const c = JSON.parse(raw) as { accessTokenTtlSeconds?: number };
    const ttl = clampOptionalOauthAccessTokenTtlSeconds(c.accessTokenTtlSeconds);
    if (ttl !== undefined) return ttl;
  } catch {
    // ignore
  }
  return fallback;
}

export interface RateLimitTokenPolicy {
  kind: "token" | "legacy_bypass" | "oauth_access" | "guest";
  identityKey: string; // used as clientId for rate-limiter counters
  bypass: boolean;
  limitPerHour: number;
  allowedTools?: string[];
  record?: RateLimitTokenRecord;
}

const TOKEN_KEY_PREFIX = "rl_tok:";

export function parseBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization") ?? request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

export async function authorizeAdmin(request: Request, env: Env): Promise<boolean> {
  const secret = env.ADMIN_PANEL_BEARER_SECRET;
  if (!secret) return false;
  const token = parseBearerToken(request);
  return token !== null && token === secret;
}

export function nowMs(): number {
  return Date.now();
}

export function computeTtlSeconds(expiresAtMs: number): number {
  const ttlMs = expiresAtMs - nowMs();
  const ttlSeconds = Math.ceil(ttlMs / 1000);
  // KV accepts positive TTL; keep it short for already-expired items.
  return ttlSeconds > 0 ? ttlSeconds : 1;
}

function base64urlEncodeBytes(bytes: Uint8Array): string {
  // btoa expects Latin-1 string.
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signJwtHs256(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64urlEncodeBytes(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64urlEncodeBytes(new TextEncoder().encode(JSON.stringify(payload)));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  const sigBytes = new Uint8Array(sig);
  const encodedSig = base64urlEncodeBytes(sigBytes);

  return `${encodedHeader}.${encodedPayload}.${encodedSig}`;
}

function tokenKey(jti: string): string {
  return `${TOKEN_KEY_PREFIX}${jti}`;
}

function normalizeAllowedTools(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    // Keep validation permissive but avoid storing malformed names.
    if (!/^[a-z0-9_]+$/i.test(name)) continue;
    out.add(name);
  }
  return [...out].sort();
}

export async function getTokenRecord(env: Env, jti: string): Promise<RateLimitTokenRecord | null> {
  const raw = await env.TOKEN_REGISTRY_KV.get(tokenKey(jti));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RateLimitTokenRecord;
    if (parsed.jti !== jti) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function listTokenRecords(env: Env, opts?: { limit?: number }): Promise<RateLimitTokenRecord[]> {
  const limit = opts?.limit ?? 200;
  const out: RateLimitTokenRecord[] = [];
  const prefix = TOKEN_KEY_PREFIX;
  let cursor: string | undefined = undefined;

  while (out.length < limit) {
    const res = (await env.TOKEN_REGISTRY_KV.list({
      prefix,
      limit: Math.min(250, limit - out.length),
      cursor,
    })) as {
      keys: Array<{ name: string }>;
      cursor?: string;
      list_complete?: boolean;
    };

    for (const item of res.keys) {
      const raw = await env.TOKEN_REGISTRY_KV.get(item.name);
      if (!raw) continue;
      try {
        const rec = JSON.parse(raw) as RateLimitTokenRecord;
        if (rec && typeof rec.jti === "string") out.push(rec);
      } catch {
        // ignore
      }
      if (out.length >= limit) break;
    }
    if (!res.list_complete) break;
    cursor = res.cursor;
    if (!cursor) break;
  }

  // Sort newest first for UX.
  out.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  return out;
}

export async function mintRateLimitToken(
  env: Env,
  params: {
    bypass: boolean;
    limitPerHour: number;
    expiresAtMs: number;
    createdBy?: string;
    label?: string;
    owner?: string;
    allowedTools?: string[];
    oauthAccessLimitPerHour?: number;
    oauthAccessTokenTtlSeconds?: number;
  },
): Promise<{ token: string; record: RateLimitTokenRecord }> {
  const secret = env.RATE_LIMIT_BYPASS_JWT_SECRET;
  if (!secret) {
    throw new Error("RATE_LIMIT_BYPASS_JWT_SECRET is not configured");
  }
  if (!params.expiresAtMs || !Number.isFinite(params.expiresAtMs)) {
    throw new Error("expiresAtMs is required");
  }
  if (params.limitPerHour < 1 || !Number.isFinite(params.limitPerHour)) {
    throw new Error("limitPerHour must be >= 1");
  }

  const jti = crypto.randomUUID();
  const oauthLim = clampOptionalOauthAccessLimitPerHour(params.oauthAccessLimitPerHour);
  const oauthTtl = clampOptionalOauthAccessTokenTtlSeconds(params.oauthAccessTokenTtlSeconds);

  const record: RateLimitTokenRecord = {
    jti,
    createdAtMs: nowMs(),
    createdBy: params.createdBy,
    bypass: params.bypass,
    limitPerHour: Math.floor(params.limitPerHour),
    expiresAtMs: Math.floor(params.expiresAtMs),
    label: params.label,
    owner: params.owner,
    allowedTools: normalizeAllowedTools(params.allowedTools),
    ...(oauthLim !== undefined ? { oauthAccessLimitPerHour: oauthLim } : {}),
    ...(oauthTtl !== undefined ? { oauthAccessTokenTtlSeconds: oauthTtl } : {}),
  };

  const payload = {
    iss: "polish-academic-mcp",
    jti,
    // We still include exp for standard JWT tooling, but enforcement is KV-based.
    exp: Math.floor(record.expiresAtMs / 1000),
    iat: Math.floor(record.createdAtMs / 1000),
    rl_bypass: record.bypass,
  };

  const token = await signJwtHs256(payload, secret);
  await env.TOKEN_REGISTRY_KV.put(tokenKey(jti), JSON.stringify(record), {
    expirationTtl: computeTtlSeconds(record.expiresAtMs),
  });

  // Fail loudly if the write is not observable immediately in this execution.
  const written = await getTokenRecord(env, jti);
  if (!written) {
    throw new Error("storage_write_verification_failed");
  }

  return { token, record };
}

export async function revokeRateLimitToken(
  env: Env,
  params: { jti: string; reason?: string },
): Promise<RateLimitTokenRecord> {
  const record = await getTokenRecord(env, params.jti);
  if (!record) throw new Error("token_not_found");
  if (record.revokedAtMs) return record;

  const updated: RateLimitTokenRecord = {
    ...record,
    revokedAtMs: nowMs(),
    revokeReason: params.reason,
  };

  await env.TOKEN_REGISTRY_KV.put(tokenKey(params.jti), JSON.stringify(updated), {
    // Keep it around briefly for observability/consistency.
    expirationTtl: 60 * 60,
  });
  return updated;
}

export async function patchRateLimitToken(
  env: Env,
  params: {
    jti: string;
    bypass?: boolean;
    limitPerHour?: number;
    expiresAtMs?: number;
    label?: string;
    owner?: string;
    allowedTools?: string[] | null;
    oauthAccessLimitPerHour?: number | null;
    oauthAccessTokenTtlSeconds?: number | null;
  },
): Promise<RateLimitTokenRecord> {
  const record = await getTokenRecord(env, params.jti);
  if (!record) throw new Error("token_not_found");
  if (record.revokedAtMs) throw new Error("token_revoked");

  let oauthAccessLimitPerHour = record.oauthAccessLimitPerHour;
  if ("oauthAccessLimitPerHour" in params) {
    if (params.oauthAccessLimitPerHour === null) {
      oauthAccessLimitPerHour = undefined;
    } else {
      const c = clampOptionalOauthAccessLimitPerHour(params.oauthAccessLimitPerHour);
      oauthAccessLimitPerHour = c !== undefined ? c : undefined;
    }
  }

  let oauthAccessTokenTtlSeconds = record.oauthAccessTokenTtlSeconds;
  if ("oauthAccessTokenTtlSeconds" in params) {
    if (params.oauthAccessTokenTtlSeconds === null) {
      oauthAccessTokenTtlSeconds = undefined;
    } else {
      const c = clampOptionalOauthAccessTokenTtlSeconds(params.oauthAccessTokenTtlSeconds);
      oauthAccessTokenTtlSeconds = c !== undefined ? c : undefined;
    }
  }

  const updated: RateLimitTokenRecord = {
    ...record,
    bypass: typeof params.bypass === "boolean" ? params.bypass : record.bypass,
    limitPerHour:
      typeof params.limitPerHour === "number" && Number.isFinite(params.limitPerHour) && params.limitPerHour >= 1
        ? Math.floor(params.limitPerHour)
        : record.limitPerHour,
    expiresAtMs:
      typeof params.expiresAtMs === "number" && Number.isFinite(params.expiresAtMs) && params.expiresAtMs > 0
        ? Math.floor(params.expiresAtMs)
        : record.expiresAtMs,
    label: typeof params.label === "string" ? params.label : record.label,
    owner: typeof params.owner === "string" ? params.owner : record.owner,
    allowedTools:
      params.allowedTools === null
        ? []
        : Array.isArray(params.allowedTools)
          ? normalizeAllowedTools(params.allowedTools)
          : normalizeAllowedTools(record.allowedTools),
    oauthAccessLimitPerHour,
    oauthAccessTokenTtlSeconds,
  };

  await env.TOKEN_REGISTRY_KV.put(tokenKey(params.jti), JSON.stringify(updated), {
    expirationTtl: computeTtlSeconds(updated.expiresAtMs),
  });
  return updated;
}

/** Response for GET /connect/token-status — safe to expose to token holder (no admin secrets). */
export type ConnectTokenIntrospection =
  | { ok: false; error: "missing_bearer" | "invalid_signature" | "missing_jti" | "unsupported_token" }
  | {
      ok: true;
      kind: "legacy_bypass";
      bypass: true;
      full_access_tools: true;
      rate_limit_per_hour: null;
      remaining: null;
      revoked: false;
    }
  | {
      ok: true;
      kind: "oauth_access";
      sub: string;
      expired: boolean;
      expires_at_ms: number;
      rate_limit_per_hour: number;
      /** Same sliding-window counter key as MCP tools/call for this token. */
      identity_key: string;
    }
  | {
      ok: true;
      kind: "token";
      jti: string;
      label?: string;
      bypass: boolean;
      revoked: boolean;
      revoked_at_ms?: number;
      expired: boolean;
      expires_at_ms: number;
      rate_limit_per_hour: number | null;
      remaining: number | null;
      reset_in_seconds: number;
      allowed: boolean;
      allowed_tools: string[];
      /** Polityka OAuth przy rejestracji klientów z tym Connect JWT (null = globalny worker). */
      oauth_access_limit_per_hour_for_registered_clients: number | null;
      oauth_access_token_ttl_seconds_for_registered_clients: number | null;
    };

/**
 * Introspect Bearer JWT for the /connect page: limits, bypass, revoke, expiry.
 * Unlike resolveRateLimitPolicyFromRequest, returns details for revoked/expired tokens when KV still has the record.
 */
export async function introspectConnectBearer(request: Request, env: Env): Promise<ConnectTokenIntrospection> {
  const jwtSecret = env.RATE_LIMIT_BYPASS_JWT_SECRET;
  const hasJwtMaterial =
    Boolean(jwtSecret) || Boolean(env.OAUTH_RSA_PRIVATE_KEY_PKCS8_PEM?.trim());
  if (!hasJwtMaterial) {
    return { ok: false, error: "missing_bearer" };
  }

  const token = parseBearerToken(request);
  if (!token) {
    return { ok: false, error: "missing_bearer" };
  }

  if (jwtSecret && token === jwtSecret) {
    return {
      ok: true,
      kind: "legacy_bypass",
      bypass: true,
      full_access_tools: true,
      rate_limit_per_hour: null,
      remaining: null,
      revoked: false,
    };
  }

  const payload = await verifyMcpJwtSignature(token, env);
  if (!payload) {
    return { ok: false, error: "invalid_signature" };
  }

  const jti = typeof payload.jti === "string" ? payload.jti : null;
  const issRaw = payload["iss"];
  const iss = typeof issRaw === "string" ? issRaw : null;
  const origin = new URL(request.url).origin;
  const resourceAud = `${origin}/mcp`;
  const subRaw = payload["sub"];
  const audRaw = payload["aud"];

  if (
    iss === origin &&
    typeof audRaw === "string" &&
    audRaw === resourceAud &&
    typeof subRaw === "string" &&
    subRaw.length > 0
  ) {
    const expSec = typeof payload.exp === "number" && Number.isFinite(payload.exp) ? Math.floor(payload.exp) : 0;
    const expiresAtMs = expSec * 1000;
    const expired = Math.floor(Date.now() / 1000) >= expSec;
    return {
      ok: true,
      kind: "oauth_access",
      sub: subRaw,
      expired,
      expires_at_ms: expiresAtMs,
      rate_limit_per_hour: await getEffectiveOAuthAccessLimitPerHour(env, subRaw),
      identity_key: `oauth:${subRaw}`,
    };
  }

  if (!jti || iss !== "polish-academic-mcp") {
    return { ok: false, error: "unsupported_token" };
  }

  const record = await getTokenRecord(env, jti);
  const allowedTools = record ? normalizeAllowedTools(record.allowedTools) : [];

  if (!record) {
    const expSec = typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : null;
    const expiresAtMs = expSec !== null ? Math.floor(expSec * 1000) : 0;
    return {
      ok: true,
      kind: "token",
      jti,
      bypass: false,
      revoked: false,
      expired: true,
      expires_at_ms: expiresAtMs,
      rate_limit_per_hour: null,
      remaining: null,
      reset_in_seconds: 0,
      allowed: false,
      allowed_tools: allowedTools,
      oauth_access_limit_per_hour_for_registered_clients: null,
      oauth_access_token_ttl_seconds_for_registered_clients: null,
    };
  }

  const now = nowMs();
  const revoked = Boolean(record.revokedAtMs);
  const expired = now >= record.expiresAtMs;

  if (revoked) {
    return {
      ok: true,
      kind: "token",
      jti: record.jti,
      label: record.label,
      bypass: record.bypass,
      revoked: true,
      revoked_at_ms: record.revokedAtMs,
      expired: false,
      expires_at_ms: record.expiresAtMs,
      rate_limit_per_hour: record.bypass ? null : record.limitPerHour,
      remaining: null,
      reset_in_seconds: 0,
      allowed: false,
      allowed_tools: allowedTools,
      oauth_access_limit_per_hour_for_registered_clients:
        record.oauthAccessLimitPerHour ?? null,
      oauth_access_token_ttl_seconds_for_registered_clients:
        record.oauthAccessTokenTtlSeconds ?? null,
    };
  }

  if (expired) {
    return {
      ok: true,
      kind: "token",
      jti: record.jti,
      label: record.label,
      bypass: record.bypass,
      revoked: false,
      expired: true,
      expires_at_ms: record.expiresAtMs,
      rate_limit_per_hour: record.bypass ? null : record.limitPerHour,
      remaining: null,
      reset_in_seconds: 0,
      allowed: false,
      allowed_tools: allowedTools,
      oauth_access_limit_per_hour_for_registered_clients:
        record.oauthAccessLimitPerHour ?? null,
      oauth_access_token_ttl_seconds_for_registered_clients:
        record.oauthAccessTokenTtlSeconds ?? null,
    };
  }

  if (record.bypass) {
    return {
      ok: true,
      kind: "token",
      jti: record.jti,
      label: record.label,
      bypass: true,
      revoked: false,
      expired: false,
      expires_at_ms: record.expiresAtMs,
      rate_limit_per_hour: null,
      remaining: null,
      reset_in_seconds: 0,
      allowed: true,
      allowed_tools: allowedTools,
      oauth_access_limit_per_hour_for_registered_clients:
        record.oauthAccessLimitPerHour ?? null,
      oauth_access_token_ttl_seconds_for_registered_clients:
        record.oauthAccessTokenTtlSeconds ?? null,
    };
  }

  const usage = await getRateLimitStatus(env.RATE_LIMIT_KV, record.jti, record.limitPerHour);
  return {
    ok: true,
    kind: "token",
    jti: record.jti,
    label: record.label,
    bypass: false,
    revoked: false,
    expired: false,
    expires_at_ms: record.expiresAtMs,
    rate_limit_per_hour: record.limitPerHour,
    remaining: usage.remaining,
    reset_in_seconds: usage.resetInSeconds,
    allowed: usage.allowed,
    allowed_tools: allowedTools,
    oauth_access_limit_per_hour_for_registered_clients:
      record.oauthAccessLimitPerHour ?? null,
    oauth_access_token_ttl_seconds_for_registered_clients:
      record.oauthAccessTokenTtlSeconds ?? null,
  };
}

export async function resolveRateLimitPolicyFromRequest(request: Request, env: Env): Promise<RateLimitTokenPolicy | null> {
  const jwtSecret = env.RATE_LIMIT_BYPASS_JWT_SECRET;
  const canVerify =
    Boolean(jwtSecret) || Boolean(env.OAUTH_RSA_PRIVATE_KEY_PKCS8_PEM?.trim());
  if (!canVerify) return null;

  const token = parseBearerToken(request);
  if (!token) return null;

  // Legacy/opaque bypass: bearer token equals secret.
  if (jwtSecret && token === jwtSecret) {
    return {
      kind: "legacy_bypass",
      identityKey: `legacy:${jwtSecret}`,
      bypass: true,
      limitPerHour: Number.POSITIVE_INFINITY,
      allowedTools: ["*"],
    };
  }

  const payload = await verifyMcpJwtSignature(token, env);
  if (!payload) return null;

  const jti = typeof payload.jti === "string" ? payload.jti : null;
  if (!jti) return null;

  const record = await getTokenRecord(env, jti);
  if (!record) return null;

  if (record.revokedAtMs) return null;
  if (nowMs() >= record.expiresAtMs) return null;

  return {
    kind: "token",
    identityKey: jti,
    bypass: record.bypass,
    limitPerHour: record.limitPerHour,
    allowedTools: normalizeAllowedTools(record.allowedTools),
    record,
  };
}

/**
 * Policy for MCP HTTP endpoint: Bearer must be either (a) OAuth access_token from /oauth/token
 * or (b) Connect JWT minted via /admin/tokens. Raw shared secret is rejected.
 */
export async function resolveMcpBearerPolicy(request: Request, env: Env): Promise<RateLimitTokenPolicy | null> {
  const canVerify =
    Boolean(env.RATE_LIMIT_BYPASS_JWT_SECRET) || Boolean(env.OAUTH_RSA_PRIVATE_KEY_PKCS8_PEM?.trim());
  if (!canVerify) return null;

  const token = parseBearerToken(request);
  if (!token) return null;

  const jwtSecret = env.RATE_LIMIT_BYPASS_JWT_SECRET;
  if (jwtSecret && token === jwtSecret) return null;

  const payload = await verifyMcpJwtSignature(token, env);
  if (!payload) return null;

  const origin = new URL(request.url).origin;
  const resourceAud = `${origin}/mcp`;
  const issRaw = payload["iss"];
  const iss = typeof issRaw === "string" ? issRaw : null;
  const jti = typeof payload.jti === "string" ? payload.jti : null;
  const subRaw = payload["sub"];
  const audRaw = payload["aud"];

  if (
    iss === origin &&
    typeof audRaw === "string" &&
    audRaw === resourceAud &&
    typeof subRaw === "string" &&
    subRaw.length > 0
  ) {
    const expSec = typeof payload.exp === "number" && Number.isFinite(payload.exp) ? Math.floor(payload.exp) : 0;
    if (Math.floor(Date.now() / 1000) >= expSec) return null;
    return {
      kind: "oauth_access",
      identityKey: `oauth:${subRaw}`,
      bypass: false,
      limitPerHour: await getEffectiveOAuthAccessLimitPerHour(env, subRaw),
      allowedTools: [],
    };
  }

  if (!jti || iss !== "polish-academic-mcp") return null;

  const record = await getTokenRecord(env, jti);
  if (!record || record.revokedAtMs || nowMs() >= record.expiresAtMs) return null;

  return {
    kind: "token",
    identityKey: jti,
    bypass: record.bypass,
    limitPerHour: record.limitPerHour,
    allowedTools: normalizeAllowedTools(record.allowedTools),
    record,
  };
}

export async function getTokenRecordWithUsagePreview(
  env: Env,
  jti: string,
): Promise<{ record: RateLimitTokenRecord; usage: Awaited<ReturnType<typeof getRateLimitStatus>> } | null> {
  const record = await getTokenRecord(env, jti);
  if (!record) return null;
  if (record.revokedAtMs || nowMs() >= record.expiresAtMs) {
    // Still return record; preview usage doesn't matter.
    return { record, usage: { allowed: false, remaining: 0, resetInSeconds: 0 } };
  }
  const usage = await getRateLimitStatus(env.RATE_LIMIT_KV, jti, record.limitPerHour);
  return { record, usage };
}

export async function listTokenRecordsWithUsagePreview(
  env: Env,
  opts?: { limit?: number },
): Promise<Array<RateLimitTokenRecord & { usage: Awaited<ReturnType<typeof getRateLimitStatus>> }>> {
  const records = await listTokenRecords(env, opts);
  const out: Array<RateLimitTokenRecord & { usage: Awaited<ReturnType<typeof getRateLimitStatus>> }> = [];
  for (const record of records) {
    if (record.revokedAtMs || nowMs() >= record.expiresAtMs) {
      out.push({ ...record, usage: { allowed: false, remaining: 0, resetInSeconds: 0 } });
      continue;
    }
    const usage = await getRateLimitStatus(env.RATE_LIMIT_KV, record.jti, record.limitPerHour);
    out.push({ ...record, usage });
  }
  return out;
}

