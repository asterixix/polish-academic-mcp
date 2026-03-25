import type { Env } from "./types.js";
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

  revokedAtMs?: number;
  revokeReason?: string;

  // Optional fields for panel UX.
  label?: string;
  owner?: string;
}

export interface RateLimitTokenPolicy {
  kind: "token" | "legacy_bypass";
  identityKey: string; // used as clientId for rate-limiter counters
  bypass: boolean;
  limitPerHour: number;
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

function base64urlDecodeToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const b64 = normalized + padding;
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
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

async function verifyJwtHs256(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSig] = parts;

  const headerBytes = base64urlDecodeToBytes(encodedHeader);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as { alg?: string };
  if (header.alg !== "HS256") return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const sigBytes = base64urlDecodeToBytes(encodedSig);
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, data);
  if (!ok) return null;

  const payloadBytes = base64urlDecodeToBytes(encodedPayload);
  return JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
}

function tokenKey(jti: string): string {
  return `${TOKEN_KEY_PREFIX}${jti}`;
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
  const record: RateLimitTokenRecord = {
    jti,
    createdAtMs: nowMs(),
    createdBy: params.createdBy,
    bypass: params.bypass,
    limitPerHour: Math.floor(params.limitPerHour),
    expiresAtMs: Math.floor(params.expiresAtMs),
    label: params.label,
    owner: params.owner,
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
  },
): Promise<RateLimitTokenRecord> {
  const record = await getTokenRecord(env, params.jti);
  if (!record) throw new Error("token_not_found");
  if (record.revokedAtMs) throw new Error("token_revoked");

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
  };

  await env.TOKEN_REGISTRY_KV.put(tokenKey(params.jti), JSON.stringify(updated), {
    expirationTtl: computeTtlSeconds(updated.expiresAtMs),
  });
  return updated;
}

export async function resolveRateLimitPolicyFromRequest(request: Request, env: Env): Promise<RateLimitTokenPolicy | null> {
  const jwtSecret = env.RATE_LIMIT_BYPASS_JWT_SECRET;
  if (!jwtSecret) return null;

  const token = parseBearerToken(request);
  if (!token) return null;

  // Legacy/opaque bypass: bearer token equals secret.
  if (token === jwtSecret) {
    return {
      kind: "legacy_bypass",
      identityKey: `legacy:${jwtSecret}`,
      bypass: true,
      limitPerHour: Number.POSITIVE_INFINITY,
    };
  }

  const payload = await verifyJwtHs256(token, jwtSecret);
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

