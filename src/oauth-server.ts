import type { Env } from "./types.js";
import { expandKnownMcpRedirectUris } from "./oauth-dcr-known-clients.js";
import { getOauthJwksBody, signOAuthAccessToken, verifyMcpJwtSignature } from "./oauth-jwt.js";
import { checkRateLimit, getClientId } from "./ratelimit.js";
import {
  clampOptionalOauthAccessLimitPerHour,
  clampOptionalOauthAccessTokenTtlSeconds,
  getEffectiveOAuthAccessTokenTtlSeconds,
  resolveRateLimitPolicyFromRequest,
} from "./token-registry.js";

type JsonObject = Record<string, unknown>;

interface OAuthClientRecord {
  client_id: string;
  client_secret: string;
  client_name?: string;
  redirect_uris: string[];
  createdAtMs: number;
  expiresAtMs: number;
  /** Nadpisanie limitu tools/call/h dla access_token tego klienta (z Connect JWT przy /register). */
  accessLimitPerHour?: number;
  accessTokenTtlSeconds?: number;
}

interface AuthorizationCodeRecord {
  code: string;
  client_id: string;
  redirect_uri: string;
  scope?: string;
  resource?: string;
  code_challenge: string;
  code_challenge_method: "S256" | string;
  createdAtMs: number;
  expiresAtMs: number;
  consumedAtMs?: number;
}

interface OAuthRefreshRecord {
  client_id: string;
  resource: string;
  scope: string;
  issuedAtMs: number;
}

const OAUTH_CLIENT_PREFIX = "oauth_client:";
const OAUTH_CODE_PREFIX = "oauth_code:";
const OAUTH_REFRESH_PREFIX = "oauth_refresh:";

const DEFAULT_AUTH_CODE_TTL_SECONDS = 10 * 60; // 10m
const DEFAULT_CLIENT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d

const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d
const MIN_REFRESH_TTL_SECONDS = 60;
const MAX_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 90; // 90d

/** Limit publicznego POST /register (DCR) na godzinę / IP — ochrona KV przed spamem. */
const DCR_REGISTRATIONS_PER_HOUR_PER_IP = 60;

export function oauthSigningConfigured(env: Env): boolean {
  return Boolean(env.OAUTH_RSA_PRIVATE_KEY_PKCS8_PEM?.trim()) || Boolean(env.RATE_LIMIT_BYPASS_JWT_SECRET);
}

function getRefreshTokenTtlSeconds(env: Env): number {
  const raw = env.OAUTH_REFRESH_TOKEN_TTL_SECONDS?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= MIN_REFRESH_TTL_SECONDS && n <= MAX_REFRESH_TTL_SECONDS) {
      return n;
    }
  }
  return DEFAULT_REFRESH_TOKEN_TTL_SECONDS;
}

function resourcesEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

/** RFC 6749 redirect URI: registered value must match request; allow URL-canonical equality (host casing, etc.). */
function normalizeRedirectUri(uri: string): string | null {
  try {
    return new URL(uri.trim()).href;
  } catch {
    return null;
  }
}

function redirectUriRegistered(requested: string, registered: string[]): boolean {
  if (!requested || registered.length === 0) return false;
  if (registered.includes(requested)) return true;
  const reqNorm = normalizeRedirectUri(requested);
  if (!reqNorm) return false;
  for (const r of registered) {
    const rNorm = normalizeRedirectUri(r);
    if (rNorm && rNorm === reqNorm) return true;
  }
  return false;
}

function redirectUrisEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const na = normalizeRedirectUri(a);
  const nb = normalizeRedirectUri(b);
  if (na && nb) return na === nb;
  return false;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function computeTtlSeconds(expiresAtMs: number): number {
  const ttlMs = expiresAtMs - Date.now();
  const ttlSeconds = Math.ceil(ttlMs / 1000);
  return ttlSeconds > 0 ? ttlSeconds : 1;
}

function jsonResponse(body: JsonObject, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
  });
}

function oauthErrorResponse(
  status: number,
  error: string,
  error_description?: string,
  extra?: JsonObject,
): Response {
  return jsonResponse(
    {
      error,
      ...(error_description ? { error_description } : {}),
      ...(extra ?? {}),
    },
    status,
    {
      "Cache-Control": "no-store",
    },
  );
}

function clientKey(clientId: string): string {
  return `${OAUTH_CLIENT_PREFIX}${clientId}`;
}

function codeKey(code: string): string {
  return `${OAUTH_CODE_PREFIX}${code}`;
}

function refreshKey(token: string): string {
  return `${OAUTH_REFRESH_PREFIX}${token}`;
}

function getRequestOrigin(request: Request): string {
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

function parseBasicAuth(request: Request): { client_id: string; client_secret: string } | null {
  const header = request.headers.get("Authorization") ?? request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return null;
  const b64 = header.slice("Basic ".length).trim();
  if (!b64) return null;
  try {
    const decoded = atob(b64);
    const idx = decoded.indexOf(":");
    if (idx <= 0) return null;
    const client_id = decoded.slice(0, idx);
    const client_secret = decoded.slice(idx + 1);
    if (!client_id || !client_secret) return null;
    return { client_id, client_secret };
  } catch {
    return null;
  }
}

async function parseTokenRequestBody(request: Request): Promise<{
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
  scope?: string;
  resource?: string;
  refresh_token?: string;
}> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as JsonObject;
    return {
      grant_type: typeof body.grant_type === "string" ? body.grant_type : undefined,
      code: typeof body.code === "string" ? body.code : undefined,
      redirect_uri: typeof body.redirect_uri === "string" ? body.redirect_uri : undefined,
      client_id: typeof body.client_id === "string" ? body.client_id : undefined,
      client_secret: typeof body.client_secret === "string" ? body.client_secret : undefined,
      code_verifier: typeof body.code_verifier === "string" ? body.code_verifier : undefined,
      scope: typeof body.scope === "string" ? body.scope : undefined,
      resource: typeof body.resource === "string" ? body.resource : undefined,
      refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    };
  }

  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const get = (k: string) => {
    const v = params.get(k);
    return v && v.length > 0 ? v : undefined;
  };
  return {
    grant_type: get("grant_type"),
    code: get("code"),
    redirect_uri: get("redirect_uri"),
    client_id: get("client_id"),
    client_secret: get("client_secret"),
    code_verifier: get("code_verifier"),
    scope: get("scope"),
    resource: get("resource"),
    refresh_token: get("refresh_token"),
  };
}

async function parseIntrospectBody(request: Request): Promise<{
  token?: string;
  token_type_hint?: string;
  client_id?: string;
  client_secret?: string;
}> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as JsonObject;
    return {
      token: typeof body.token === "string" ? body.token : undefined,
      token_type_hint:
        typeof body.token_type_hint === "string" ? body.token_type_hint : undefined,
      client_id: typeof body.client_id === "string" ? body.client_id : undefined,
      client_secret: typeof body.client_secret === "string" ? body.client_secret : undefined,
    };
  }
  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const t = params.get("token");
  const h = params.get("token_type_hint");
  const cid = params.get("client_id");
  const csec = params.get("client_secret");
  return {
    token: t && t.length > 0 ? t : undefined,
    token_type_hint: h && h.length > 0 ? h : undefined,
    client_id: cid && cid.length > 0 ? cid : undefined,
    client_secret: csec && csec.length > 0 ? csec : undefined,
  };
}

async function authenticateOAuthClient(
  request: Request,
  body: { client_id?: string; client_secret?: string },
  env: Env,
): Promise<
  | { ok: true; client: OAuthClientRecord; client_id: string }
  | { ok: false; response: Response }
> {
  const basic = parseBasicAuth(request);
  const client_id = basic?.client_id ?? body.client_id;
  const client_secret = basic?.client_secret ?? body.client_secret;
  if (!client_id || !client_secret) {
    return { ok: false, response: oauthErrorResponse(401, "invalid_client", "Missing client credentials") };
  }

  const rawClient = await env.TOKEN_REGISTRY_KV.get(clientKey(client_id));
  if (!rawClient) {
    return { ok: false, response: oauthErrorResponse(401, "invalid_client", "Unknown client_id") };
  }

  let client: OAuthClientRecord | null = null;
  try {
    client = JSON.parse(rawClient) as OAuthClientRecord;
  } catch {
    client = null;
  }

  if (!client || client.client_secret !== client_secret || Date.now() >= client.expiresAtMs) {
    return { ok: false, response: oauthErrorResponse(401, "invalid_client", "Invalid client credentials") };
  }

  return { ok: true, client, client_id };
}

async function computePkceS256(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return base64urlEncode(new Uint8Array(digest));
}

async function mintRefreshAndStore(
  env: Env,
  client: OAuthClientRecord,
  resource: string,
  scope: string,
): Promise<{ refresh_token: string; refresh_expires_in: number }> {
  const refreshTtl = getRefreshTokenTtlSeconds(env);
  const refreshBytes = new Uint8Array(32);
  crypto.getRandomValues(refreshBytes);
  const refresh_token = base64urlEncode(refreshBytes);
  const rec: OAuthRefreshRecord = {
    client_id: client.client_id,
    resource,
    scope,
    issuedAtMs: Date.now(),
  };
  await env.TOKEN_REGISTRY_KV.put(refreshKey(refresh_token), JSON.stringify(rec), {
    expirationTtl: refreshTtl,
  });
  return { refresh_token, refresh_expires_in: refreshTtl };
}

async function issueAccessAndRefresh(
  env: Env,
  request: Request,
  client: OAuthClientRecord,
  resource: string,
  scope: string,
): Promise<{
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  scope: string;
}> {
  const origin = getRequestOrigin(request);
  const nowSec = Math.floor(Date.now() / 1000);
  const accessTtlSec = await getEffectiveOAuthAccessTokenTtlSeconds(env, client.client_id);
  const expSec = nowSec + accessTtlSec;

  const tokenPayload: JsonObject = {
    iss: origin,
    sub: client.client_id,
    aud: resource,
    iat: nowSec,
    exp: expSec,
    scope,
  };

  let access_token: string;
  try {
    access_token = await signOAuthAccessToken(env, tokenPayload);
  } catch {
    throw new Error("oauth_sign_failed");
  }

  const { refresh_token, refresh_expires_in } = await mintRefreshAndStore(env, client, resource, scope);

  return {
    access_token,
    expires_in: accessTtlSec,
    refresh_token,
    refresh_expires_in,
    scope,
  };
}

export async function handleOauthJwks(_request: Request, env: Env): Promise<Response> {
  const body = await getOauthJwksBody(env);
  if (!body) {
    return jsonResponse({ error: "jwks_not_configured" }, 404, { "Cache-Control": "no-store" });
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function handleOauthWellKnownProtectedResource(request: Request, _env: Env): Promise<Response> {
  const origin = getRequestOrigin(request);
  const resource = `${origin}/mcp`;

  return jsonResponse({
    resource,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  });
}

export async function handleOauthWellKnownAuthorizationServer(request: Request, env: Env): Promise<Response> {
  const origin = getRequestOrigin(request);
  const issuer = origin;

  const jwks = await getOauthJwksBody(env);

  return jsonResponse({
    issuer,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    introspection_endpoint: `${origin}/oauth/introspect`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    ...(jwks ? { jwks_uri: `${origin}/.well-known/jwks.json` } : {}),
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp"],
    // RFC 7591 / RFC 8414: anonimowa DCR; opcjonalny Bearer (Connect JWT) tylko dla nadpisań limitów przy rejestracji.
    registration_endpoint_auth_methods_supported: ["none"],
  });
}

export async function handleOauthRegister(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return oauthErrorResponse(405, "invalid_request", "Method not allowed");
  }

  const dcrRl = await checkRateLimit(
    env.RATE_LIMIT_KV,
    `dcr_reg:${getClientId(request)}`,
    DCR_REGISTRATIONS_PER_HOUR_PER_IP,
  );
  if (!dcrRl.allowed) {
    return oauthErrorResponse(
      429,
      "slow_down",
      `Too many client registrations from this network; retry after ${dcrRl.resetInSeconds} seconds`,
    );
  }

  let body: JsonObject;
  try {
    body = (await request.json()) as JsonObject;
  } catch {
    return oauthErrorResponse(400, "invalid_request", "Expected JSON body");
  }

  const client_name = typeof body.client_name === "string" ? body.client_name : undefined;
  const software_id = typeof body.software_id === "string" ? body.software_id : undefined;
  const rawRedirectUris =
    Array.isArray(body.redirect_uris) && body.redirect_uris.every((x) => typeof x === "string")
      ? (body.redirect_uris as string[])
      : [];

  const { redirect_uris: expandedUris } = expandKnownMcpRedirectUris({
    client_name,
    software_id,
    redirect_uris: rawRedirectUris,
  });

  if (expandedUris.length === 0) {
    return oauthErrorResponse(
      400,
      "invalid_redirect_uris",
      "redirect_uris is required (or provide client_name / software_id recognized for known MCP clients)",
    );
  }

  const redirect_uris = expandedUris;

  const registrationAuth = await resolveRateLimitPolicyFromRequest(request, env);

  const expiresAtMs = Date.now() + DEFAULT_CLIENT_TTL_SECONDS * 1000;
  const client_id = `mcp_${crypto.randomUUID()}`;
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const client_secret = base64urlEncode(secretBytes);

  const record: OAuthClientRecord = {
    client_id,
    client_secret,
    client_name,
    redirect_uris,
    createdAtMs: Date.now(),
    expiresAtMs,
  };

  if (registrationAuth?.kind === "token" && registrationAuth.record) {
    const r = registrationAuth.record;
    const lim = clampOptionalOauthAccessLimitPerHour(r.oauthAccessLimitPerHour);
    if (lim !== undefined) record.accessLimitPerHour = lim;
    const ttl = clampOptionalOauthAccessTokenTtlSeconds(r.oauthAccessTokenTtlSeconds);
    if (ttl !== undefined) record.accessTokenTtlSeconds = ttl;
  }

  await env.TOKEN_REGISTRY_KV.put(clientKey(client_id), JSON.stringify(record), {
    expirationTtl: computeTtlSeconds(expiresAtMs),
  });

  return jsonResponse(
    {
      client_id,
      client_secret,
      client_secret_expires_at: Math.floor(expiresAtMs / 1000),
      token_endpoint_auth_method: "client_secret_post",
      redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

export async function handleOauthAuthorize(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return oauthErrorResponse(405, "invalid_request", "Method not allowed");
  }

  const url = new URL(request.url);
  const response_type = url.searchParams.get("response_type") ?? undefined;
  const client_id = url.searchParams.get("client_id") ?? undefined;
  const redirect_uri = url.searchParams.get("redirect_uri") ?? undefined;
  const scope = url.searchParams.get("scope") ?? undefined;
  const state = url.searchParams.get("state") ?? undefined;
  const code_challenge = url.searchParams.get("code_challenge") ?? undefined;
  const code_challenge_method = url.searchParams.get("code_challenge_method") ?? undefined;
  const resource = url.searchParams.get("resource") ?? undefined;

  if (response_type !== "code") return oauthErrorResponse(400, "invalid_request", "Unsupported response_type");
  if (!client_id) return oauthErrorResponse(400, "invalid_request", "Missing client_id");
  if (!redirect_uri) return oauthErrorResponse(400, "invalid_request", "Missing redirect_uri");
  if (!code_challenge) return oauthErrorResponse(400, "invalid_request", "Missing code_challenge");
  if (!code_challenge_method) return oauthErrorResponse(400, "invalid_request", "Missing code_challenge_method");

  const raw = await env.TOKEN_REGISTRY_KV.get(clientKey(client_id));
  if (!raw) return oauthErrorResponse(400, "invalid_client", "Unknown client_id");

  let client: OAuthClientRecord | null = null;
  try {
    client = JSON.parse(raw) as OAuthClientRecord;
  } catch {
    client = null;
  }

  if (!client || !Array.isArray(client.redirect_uris) || !redirectUriRegistered(redirect_uri, client.redirect_uris)) {
    return oauthErrorResponse(400, "invalid_request", "redirect_uri not registered for this client");
  }
  if (Date.now() >= client.expiresAtMs) {
    return oauthErrorResponse(400, "invalid_client", "Client registration expired");
  }

  const origin = getRequestOrigin(request);
  const effectiveResource = resource ?? `${origin}/mcp`;

  const expiresAtMs = Date.now() + DEFAULT_AUTH_CODE_TTL_SECONDS * 1000;
  const codeBytes = new Uint8Array(32);
  crypto.getRandomValues(codeBytes);
  const code = base64urlEncode(codeBytes);

  const storedRedirectUri = normalizeRedirectUri(redirect_uri) ?? redirect_uri.trim();

  const rec: AuthorizationCodeRecord = {
    code,
    client_id,
    redirect_uri: storedRedirectUri,
    scope,
    resource: effectiveResource,
    code_challenge,
    code_challenge_method: code_challenge_method,
    createdAtMs: Date.now(),
    expiresAtMs,
  };

  await env.TOKEN_REGISTRY_KV.put(codeKey(code), JSON.stringify(rec), {
    expirationTtl: computeTtlSeconds(expiresAtMs),
  });

  const target = new URL(storedRedirectUri);
  target.searchParams.set("code", code);
  if (state) target.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Cache-Control": "no-store",
    },
  });
}

export async function handleOauthToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return oauthErrorResponse(405, "invalid_request", "Method not allowed");
  }

  if (!oauthSigningConfigured(env)) {
    return oauthErrorResponse(500, "server_error", "OAuth signing not configured");
  }

  const body = await parseTokenRequestBody(request);
  const grant_type = body.grant_type ?? undefined;

  const auth = await authenticateOAuthClient(request, body, env);
  if (!auth.ok) return auth.response;
  const { client } = auth;

  const origin = getRequestOrigin(request);

  if (grant_type === "refresh_token") {
    const refresh_token = body.refresh_token;
    if (!refresh_token) {
      return oauthErrorResponse(400, "invalid_request", "Missing refresh_token");
    }

    const rawRef = await env.TOKEN_REGISTRY_KV.get(refreshKey(refresh_token));
    if (!rawRef) {
      return oauthErrorResponse(400, "invalid_grant", "Invalid refresh token");
    }

    let refRec: OAuthRefreshRecord | null = null;
    try {
      refRec = JSON.parse(rawRef) as OAuthRefreshRecord;
    } catch {
      refRec = null;
    }
    if (!refRec || refRec.client_id !== client.client_id) {
      return oauthErrorResponse(400, "invalid_grant", "Invalid refresh token");
    }

    const canonicalResource = refRec.resource;
    if (body.resource !== undefined && !resourcesEquivalent(body.resource, canonicalResource)) {
      return oauthErrorResponse(
        400,
        "invalid_grant",
        "resource does not match the refresh token (RFC 8707)",
      );
    }

    await env.TOKEN_REGISTRY_KV.delete(refreshKey(refresh_token));

    let issued: Awaited<ReturnType<typeof issueAccessAndRefresh>>;
    try {
      issued = await issueAccessAndRefresh(env, request, client, canonicalResource, refRec.scope);
    } catch {
      return oauthErrorResponse(500, "server_error", "OAuth signing failed");
    }

    return jsonResponse(
      {
        access_token: issued.access_token,
        token_type: "Bearer",
        expires_in: issued.expires_in,
        refresh_token: issued.refresh_token,
        refresh_expires_in: issued.refresh_expires_in,
        scope: issued.scope,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  }

  if (grant_type !== "authorization_code") {
    return oauthErrorResponse(400, "unsupported_grant_type", "Unsupported grant_type");
  }

  const code = body.code;
  const redirect_uri = body.redirect_uri;
  const code_verifier = body.code_verifier;
  if (!code) return oauthErrorResponse(400, "invalid_request", "Missing code");
  if (!redirect_uri) return oauthErrorResponse(400, "invalid_request", "Missing redirect_uri");
  if (!code_verifier) return oauthErrorResponse(400, "invalid_request", "Missing code_verifier");

  const rawCode = await env.TOKEN_REGISTRY_KV.get(codeKey(code));
  if (!rawCode) return oauthErrorResponse(400, "invalid_grant", "Invalid authorization code");

  let codeRecord: AuthorizationCodeRecord | null = null;
  try {
    codeRecord = JSON.parse(rawCode) as AuthorizationCodeRecord;
  } catch {
    codeRecord = null;
  }

  if (
    !codeRecord ||
    codeRecord.client_id !== client.client_id ||
    !redirectUrisEqual(codeRecord.redirect_uri, redirect_uri) ||
    Date.now() >= codeRecord.expiresAtMs ||
    codeRecord.consumedAtMs
  ) {
    return oauthErrorResponse(400, "invalid_grant", "Expired/invalid authorization code");
  }

  await env.TOKEN_REGISTRY_KV.put(
    codeKey(code),
    JSON.stringify({ ...codeRecord, consumedAtMs: Date.now() }),
    { expirationTtl: computeTtlSeconds(codeRecord.expiresAtMs) },
  );

  if (codeRecord.code_challenge_method !== "S256") {
    return oauthErrorResponse(400, "invalid_grant", "Only S256 PKCE supported");
  }

  const computed = await computePkceS256(code_verifier);
  if (computed !== codeRecord.code_challenge) {
    return oauthErrorResponse(400, "invalid_grant", "PKCE code_verifier mismatch");
  }

  const canonicalResource =
    codeRecord.resource ?? `${origin}/mcp`;
  if (body.resource !== undefined && !resourcesEquivalent(body.resource, canonicalResource)) {
    return oauthErrorResponse(
      400,
      "invalid_grant",
      "resource does not match authorization request (RFC 8707)",
    );
  }

  const scope = codeRecord.scope ?? body.scope ?? "mcp";

  let issuedCode: Awaited<ReturnType<typeof issueAccessAndRefresh>>;
  try {
    issuedCode = await issueAccessAndRefresh(env, request, client, canonicalResource, scope);
  } catch {
    return oauthErrorResponse(500, "server_error", "OAuth signing failed");
  }

  return jsonResponse(
    {
      access_token: issuedCode.access_token,
      token_type: "Bearer",
      expires_in: issuedCode.expires_in,
      refresh_token: issuedCode.refresh_token,
      refresh_expires_in: issuedCode.refresh_expires_in,
      scope: issuedCode.scope,
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

/**
 * RFC 7662 — authenticated with the same client credentials as the token endpoint.
 */
export async function handleOauthIntrospect(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return oauthErrorResponse(405, "invalid_request", "Method not allowed");
  }

  const body = await parseIntrospectBody(request);
  const auth = await authenticateOAuthClient(request, body, env);
  if (!auth.ok) return auth.response;

  if (!body.token) {
    return jsonResponse({ active: false }, 200, { "Cache-Control": "no-store" });
  }

  const payload = await verifyMcpJwtSignature(body.token, env);
  if (!payload) {
    return jsonResponse({ active: false }, 200, { "Cache-Control": "no-store" });
  }

  const origin = getRequestOrigin(request);
  const issRaw = payload["iss"];
  const iss = typeof issRaw === "string" ? issRaw : null;
  const subRaw = payload["sub"];
  const audRaw = payload["aud"];
  const expRaw = payload["exp"];
  const scopeRaw = payload["scope"];
  const iatRaw = payload["iat"];

  if (
    iss !== origin ||
    typeof audRaw !== "string" ||
    typeof subRaw !== "string" ||
    subRaw.length === 0
  ) {
    return jsonResponse({ active: false }, 200, { "Cache-Control": "no-store" });
  }

  const expSec = typeof expRaw === "number" && Number.isFinite(expRaw) ? Math.floor(expRaw) : 0;
  if (Math.floor(Date.now() / 1000) >= expSec) {
    return jsonResponse({ active: false }, 200, { "Cache-Control": "no-store" });
  }

  const scope = typeof scopeRaw === "string" ? scopeRaw : undefined;
  const iat = typeof iatRaw === "number" && Number.isFinite(iatRaw) ? iatRaw : undefined;

  return jsonResponse(
    {
      active: true,
      iss,
      sub: subRaw,
      aud: audRaw,
      exp: expSec,
      ...(iat !== undefined ? { iat } : {}),
      token_type: "Bearer",
      client_id: subRaw,
      ...(scope ? { scope } : {}),
    },
    200,
    { "Cache-Control": "no-store" },
  );
}
