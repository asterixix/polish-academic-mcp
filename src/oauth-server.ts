import type { Env } from "./types.js";

type JsonObject = Record<string, unknown>;

interface OAuthClientRecord {
  client_id: string;
  client_secret: string;
  client_name?: string;
  redirect_uris: string[];
  createdAtMs: number;
  expiresAtMs: number;
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

const OAUTH_CLIENT_PREFIX = "oauth_client:";
const OAUTH_CODE_PREFIX = "oauth_code:";

const DEFAULT_AUTH_CODE_TTL_SECONDS = 10 * 60; // 10m
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h
const DEFAULT_CLIENT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa expects a Latin-1 string.
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
    };
  }

  // Default: x-www-form-urlencoded
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
  };
}

async function signJwtHs256(payload: JsonObject, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(`${encHeader}.${encPayload}`);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  const sigBytes = new Uint8Array(sig);
  const encSig = base64urlEncode(sigBytes);
  return `${encHeader}.${encPayload}.${encSig}`;
}

async function computePkceS256(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return base64urlEncode(new Uint8Array(digest));
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

export async function handleOauthWellKnownAuthorizationServer(request: Request, _env: Env): Promise<Response> {
  const origin = getRequestOrigin(request);
  const issuer = origin;

  return jsonResponse({
    issuer,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp"],
  });
}

export async function handleOauthRegister(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return oauthErrorResponse(405, "invalid_request", "Method not allowed");
  }

  let body: JsonObject;
  try {
    body = (await request.json()) as JsonObject;
  } catch {
    return oauthErrorResponse(400, "invalid_request", "Expected JSON body");
  }

  const client_name = typeof body.client_name === "string" ? body.client_name : undefined;
  const redirect_uris =
    Array.isArray(body.redirect_uris) && body.redirect_uris.every((x) => typeof x === "string")
      ? (body.redirect_uris as string[])
      : [];

  if (redirect_uris.length === 0) {
    return oauthErrorResponse(400, "invalid_redirect_uris", "redirect_uris is required");
  }

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

  await env.TOKEN_REGISTRY_KV.put(clientKey(client_id), JSON.stringify(record), {
    expirationTtl: computeTtlSeconds(expiresAtMs),
  });

  return jsonResponse(
    {
      client_id,
      client_secret,
      client_secret_expires_at: Math.floor(expiresAtMs / 1000),
      token_endpoint_auth_method: "client_secret_basic",
      redirect_uris,
      grant_types: ["authorization_code"],
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

  if (!client || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirect_uri)) {
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

  const record: AuthorizationCodeRecord = {
    code,
    client_id,
    redirect_uri,
    scope,
    resource: effectiveResource,
    code_challenge,
    code_challenge_method: code_challenge_method,
    createdAtMs: Date.now(),
    expiresAtMs,
  };

  await env.TOKEN_REGISTRY_KV.put(codeKey(code), JSON.stringify(record), {
    expirationTtl: computeTtlSeconds(expiresAtMs),
  });

  const target = new URL(redirect_uri);
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

  const jwtSecret = env.RATE_LIMIT_BYPASS_JWT_SECRET;
  if (!jwtSecret) {
    return oauthErrorResponse(500, "server_error", "OAuth signing secret not configured");
  }

  const body = await parseTokenRequestBody(request);
  const grant_type = body.grant_type ?? undefined;
  if (grant_type !== "authorization_code") {
    return oauthErrorResponse(400, "unsupported_grant_type", "Only authorization_code supported");
  }

  const code = body.code;
  const redirect_uri = body.redirect_uri;
  const code_verifier = body.code_verifier;
  if (!code) return oauthErrorResponse(400, "invalid_request", "Missing code");
  if (!redirect_uri) return oauthErrorResponse(400, "invalid_request", "Missing redirect_uri");
  if (!code_verifier) return oauthErrorResponse(400, "invalid_request", "Missing code_verifier");

  const basic = parseBasicAuth(request);
  const client_id = basic?.client_id ?? body.client_id;
  const client_secret = basic?.client_secret ?? body.client_secret;
  if (!client_id || !client_secret) {
    return oauthErrorResponse(401, "invalid_client", "Missing client credentials");
  }

  const rawClient = await env.TOKEN_REGISTRY_KV.get(clientKey(client_id));
  if (!rawClient) return oauthErrorResponse(401, "invalid_client", "Unknown client_id");

  let client: OAuthClientRecord | null = null;
  try {
    client = JSON.parse(rawClient) as OAuthClientRecord;
  } catch {
    client = null;
  }

  if (!client || client.client_secret !== client_secret || Date.now() >= client.expiresAtMs) {
    return oauthErrorResponse(401, "invalid_client", "Invalid client credentials");
  }

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
    codeRecord.client_id !== client_id ||
    codeRecord.redirect_uri !== redirect_uri ||
    Date.now() >= codeRecord.expiresAtMs ||
    codeRecord.consumedAtMs
  ) {
    return oauthErrorResponse(400, "invalid_grant", "Expired/invalid authorization code");
  }

  // Mark code as consumed (best-effort; if races happen, it's still short-lived).
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

  const origin = getRequestOrigin(request);
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + DEFAULT_ACCESS_TOKEN_TTL_SECONDS;

  const resource = body.resource ?? codeRecord.resource ?? `${origin}/mcp`;
  const scope = codeRecord.scope ?? body.scope ?? "mcp";

  const tokenPayload: JsonObject = {
    iss: origin,
    sub: client_id,
    aud: resource,
    iat: nowSec,
    exp: expSec,
    scope,
  };

  const access_token = await signJwtHs256(tokenPayload, jwtSecret);

  return jsonResponse(
    {
      access_token,
      token_type: "Bearer",
      expires_in: DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
      scope,
    },
    200,
    {
      "Cache-Control": "no-store",
    },
  );
}

