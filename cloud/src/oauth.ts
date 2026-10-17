import type { CloudEnv } from "./env.js";
import { appName, publicOrigin } from "./env.js";
import { readSessionUser, type UserRow } from "./auth.js";
import {
  bytesToBase64Url,
  htmlResponse,
  jsonResponse,
  randomId,
  randomToken,
  sha256Base64Url,
} from "./crypto-util.js";
import { renderAuthorizePage } from "./ui.js";

export interface OAuthClientRow {
  client_id: string;
  client_secret: string | null;
  client_name: string;
  redirect_uris: string;
  grant_types: string;
  token_endpoint_auth_method: string;
}

export interface TokenRow {
  token_hash: string;
  refresh_token_hash: string | null;
  client_id: string;
  user_id: string;
  scope: string;
  expires_at: string;
}

const ACCESS_TTL_SEC = 60 * 60 * 24 * 30;
const REFRESH_TTL_SEC = 60 * 60 * 24 * 90;
const CODE_TTL_SEC = 60 * 10;

function parseRedirectUris(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* fall through */
  }
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    scopes_supported: ["mcp", "openid", "profile", "email"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    client_id_metadata_document_supported: true,
    service_documentation: `${origin}/connectors`,
    op_policy_uri: `${origin}/privacy`,
    op_tos_uri: `${origin}/terms`,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/connectors`,
  };
}

async function getClient(env: CloudEnv, clientId: string, redirectUriHint?: string): Promise<OAuthClientRow | null> {
  const existing = await env.DB.prepare(
    `SELECT client_id, client_secret, client_name, redirect_uris, grant_types, token_endpoint_auth_method
     FROM oauth_clients WHERE client_id = ?`,
  )
    .bind(clientId)
    .first<OAuthClientRow>();
  if (existing) return existing;

  // Support Client ID Metadata Documents (https:// URL as client_id) and well-known public connectors
  if (
    /^https:\/\//i.test(clientId) ||
    /^(claude|chatgpt|openai|perplexity)/i.test(clientId)
  ) {
    const allowedDefaults = [
      ...(redirectUriHint ? [redirectUriHint] : []),
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
      "https://chatgpt.com/connector_platform_oauth_redirect",
      "https://chat.openai.com/aip/oauth/callback",
      "https://www.perplexity.ai/api/mcp/oauth/callback",
      "https://perplexity.ai/api/mcp/oauth/callback",
    ];
    let clientName = "MCP Connector Client";
    let redirectUris = Array.from(new Set(allowedDefaults));

    if (/^https:\/\//i.test(clientId)) {
      try {
        const metaRes = await fetch(clientId, {
          headers: { accept: "application/json" },
        });
        if (metaRes.ok) {
          const meta = (await metaRes.json()) as {
            client_name?: string;
            redirect_uris?: string[];
          };
          if (meta.client_name) clientName = meta.client_name;
          if (Array.isArray(meta.redirect_uris) && meta.redirect_uris.length > 0) {
            redirectUris = Array.from(new Set([...meta.redirect_uris, ...redirectUris]));
          }
        }
      } catch {
        /* fallback to default redirect URIs */
      }
    }

    await env.DB.prepare(
      `INSERT INTO oauth_clients (client_id, client_secret, client_name, redirect_uris, grant_types, token_endpoint_auth_method)
       VALUES (?, NULL, ?, ?, 'authorization_code,refresh_token', 'none')`,
    )
      .bind(clientId, clientName, JSON.stringify(redirectUris))
      .run();

    return {
      client_id: clientId,
      client_secret: null,
      client_name: clientName,
      redirect_uris: JSON.stringify(redirectUris),
      grant_types: "authorization_code,refresh_token",
      token_endpoint_auth_method: "none",
    };
  }

  return null;
}

async function hashToken(token: string): Promise<string> {
  return sha256Base64Url(token);
}

export async function resolveBearerUser(
  env: CloudEnv,
  request: Request,
): Promise<{ user: UserRow; scope: string; clientId: string } | null> {
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) return null;
  const tokenHash = await hashToken(match[1].trim());
  const row = await env.DB.prepare(
    `SELECT token_hash, refresh_token_hash, client_id, user_id, scope, expires_at
     FROM oauth_tokens WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .first<TokenRow>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  const user = await env.DB.prepare(
    `SELECT id, email, password_hash, orcid_id, display_name, created_at FROM users WHERE id = ?`,
  )
    .bind(row.user_id)
    .first<UserRow>();
  if (!user) return null;
  return { user, scope: row.scope, clientId: row.client_id };
}

function formDataToObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

async function issueTokens(
  env: CloudEnv,
  clientId: string,
  userId: string,
  scope: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}> {
  const access_token = randomToken(32);
  const refresh_token = randomToken(32);
  const accessHash = await hashToken(access_token);
  const refreshHash = await hashToken(refresh_token);
  const expiresAt = new Date(Date.now() + ACCESS_TTL_SEC * 1000).toISOString();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO oauth_tokens (token_hash, refresh_token_hash, client_id, user_id, scope, expires_at, refresh_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(accessHash, refreshHash, clientId, userId, scope, expiresAt, refreshExpiresAt)
    .run();
  return {
    access_token,
    refresh_token,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SEC,
    scope,
  };
}

export async function handleOAuthRoutes(
  request: Request,
  env: CloudEnv,
  path: string,
): Promise<Response | null> {
  const origin = publicOrigin(request, env);

  if (
    path === "/.well-known/oauth-authorization-server" ||
    path.startsWith("/.well-known/oauth-authorization-server/") ||
    path === "/.well-known/openid-configuration" ||
    path.startsWith("/.well-known/openid-configuration/")
  ) {
    return jsonResponse(authorizationServerMetadata(origin));
  }

  if (
    path === "/.well-known/oauth-protected-resource" ||
    path.startsWith("/.well-known/oauth-protected-resource/")
  ) {
    return jsonResponse(protectedResourceMetadata(origin));
  }

  if (path === "/oauth/register" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as {
      client_name?: string;
      redirect_uris?: string[];
      grant_types?: string[];
      token_endpoint_auth_method?: string;
    } | null;
    const redirect_uris = body?.redirect_uris?.filter(Boolean) ?? [];
    if (redirect_uris.length === 0) {
      return jsonResponse({ error: "invalid_client_metadata", error_description: "redirect_uris required" }, { status: 400 });
    }
    const client_id = `pamcp_${randomId(18)}`;
    const authMethod = body?.token_endpoint_auth_method ?? "none";
    const client_secret = authMethod === "none" ? null : randomToken(24);
    const client_name = body?.client_name?.trim() || "MCP Client";
    const grant_types = (body?.grant_types ?? ["authorization_code", "refresh_token"]).join(",");
    await env.DB.prepare(
      `INSERT INTO oauth_clients (client_id, client_secret, client_name, redirect_uris, grant_types, token_endpoint_auth_method)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(client_id, client_secret, client_name, JSON.stringify(redirect_uris), grant_types, authMethod)
      .run();
    return jsonResponse(
      {
        client_id,
        client_secret: client_secret ?? undefined,
        client_name,
        redirect_uris,
        grant_types: grant_types.split(","),
        token_endpoint_auth_method: authMethod,
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      { status: 201 },
    );
  }

  if (path === "/oauth/authorize" && (request.method === "GET" || request.method === "POST")) {
    const url = new URL(request.url);
    let params = Object.fromEntries(url.searchParams.entries());
    if (request.method === "POST") {
      const form = formDataToObject(await request.formData());
      params = { ...params, ...form };
    }

    const clientId = params.client_id ?? "";
    const redirectUri = params.redirect_uri ?? "";
    const responseType = params.response_type ?? "";
    const codeChallenge = params.code_challenge ?? "";
    const codeChallengeMethod = params.code_challenge_method ?? "S256";
    const scope = params.scope ?? "mcp";
    const state = params.state ?? "";

    const client = await getClient(env, clientId, redirectUri);
    if (!client) {
      return jsonResponse({ error: "invalid_client" }, { status: 400 });
    }
    const allowed = parseRedirectUris(client.redirect_uris);
    if (!allowed.includes(redirectUri)) {
      return jsonResponse({ error: "invalid_request", error_description: "redirect_uri mismatch" }, { status: 400 });
    }
    if (responseType !== "code") {
      return redirectOAuthError(redirectUri, "unsupported_response_type", state);
    }
    if (!codeChallenge || codeChallengeMethod !== "S256") {
      return redirectOAuthError(redirectUri, "invalid_request", state, "PKCE S256 required");
    }

    const user = await readSessionUser(env, request);
    if (!user) {
      const loginUrl = new URL("/login", origin);
      loginUrl.searchParams.set("next", request.url);
      return Response.redirect(loginUrl.toString(), 302);
    }

    if (request.method === "GET" && params.consent !== "1") {
      return htmlResponse(
        renderAuthorizePage({
          appName: appName(env),
          clientName: client.client_name,
          userName: user.display_name || user.email || user.orcid_id || user.id,
          scope,
          actionUrl: request.url,
          denyUrl: redirectOAuthErrorUrl(redirectUri, "access_denied", state),
        }),
      );
    }

    if (params.consent === "deny") {
      return redirectOAuthError(redirectUri, "access_denied", state);
    }

    const code = randomToken(24);
    const expiresAt = new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(code, clientId, user.id, redirectUri, codeChallenge, codeChallengeMethod, scope, expiresAt)
      .run();

    const dest = new URL(redirectUri);
    dest.searchParams.set("code", code);
    if (state) dest.searchParams.set("state", state);
    return Response.redirect(dest.toString(), 302);
  }

  if (path === "/oauth/token" && request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    let body: Record<string, string> = {};
    if (contentType.includes("application/json")) {
      body = (await request.json().catch(() => ({}))) as Record<string, string>;
    } else {
      body = formDataToObject(await request.formData());
    }

    // Optional Basic auth for confidential clients
    const basic = request.headers.get("authorization");
    if (basic?.startsWith("Basic ")) {
      try {
        const decoded = atob(basic.slice(6));
        const [id, secret] = decoded.split(":");
        body.client_id = body.client_id || id;
        body.client_secret = body.client_secret || secret;
      } catch {
        /* ignore */
      }
    }

    const grantType = body.grant_type ?? "";
    const clientId = body.client_id ?? "";
    const client = await getClient(env, clientId);
    if (!client) {
      return jsonResponse({ error: "invalid_client" }, { status: 401 });
    }
    if (client.client_secret && client.client_secret !== body.client_secret) {
      return jsonResponse({ error: "invalid_client" }, { status: 401 });
    }

    if (grantType === "authorization_code") {
      const code = body.code ?? "";
      const redirectUri = body.redirect_uri ?? "";
      const codeVerifier = body.code_verifier ?? "";
      const row = await env.DB.prepare(
        `SELECT code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at, used
         FROM oauth_codes WHERE code = ?`,
      )
        .bind(code)
        .first<{
          code: string;
          client_id: string;
          user_id: string;
          redirect_uri: string;
          code_challenge: string;
          code_challenge_method: string;
          scope: string;
          expires_at: string;
          used: number;
        }>();
      if (!row || row.used || row.client_id !== clientId || row.redirect_uri !== redirectUri) {
        return jsonResponse({ error: "invalid_grant" }, { status: 400 });
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return jsonResponse({ error: "invalid_grant", error_description: "code expired" }, { status: 400 });
      }
      const expected = await sha256Base64Url(codeVerifier);
      // Some clients use standard base64; normalize
      const expectedStd = bytesToBase64Url(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier)),
      );
      if (row.code_challenge !== expected && row.code_challenge !== expectedStd) {
        return jsonResponse({ error: "invalid_grant", error_description: "PKCE verification failed" }, { status: 400 });
      }
      await env.DB.prepare(`UPDATE oauth_codes SET used = 1 WHERE code = ?`).bind(code).run();
      const tokens = await issueTokens(env, clientId, row.user_id, row.scope);
      return jsonResponse(tokens);
    }

    if (grantType === "refresh_token") {
      const refresh = body.refresh_token ?? "";
      const refreshHash = await hashToken(refresh);
      const row = await env.DB.prepare(
        `SELECT token_hash, refresh_token_hash, client_id, user_id, scope, expires_at, refresh_expires_at
         FROM oauth_tokens WHERE refresh_token_hash = ?`,
      )
        .bind(refreshHash)
        .first<{
          token_hash: string;
          refresh_token_hash: string;
          client_id: string;
          user_id: string;
          scope: string;
          refresh_expires_at: string | null;
        }>();
      if (!row || row.client_id !== clientId) {
        return jsonResponse({ error: "invalid_grant" }, { status: 400 });
      }
      if (row.refresh_expires_at && new Date(row.refresh_expires_at).getTime() < Date.now()) {
        return jsonResponse({ error: "invalid_grant", error_description: "refresh expired" }, { status: 400 });
      }
      await env.DB.prepare(`DELETE FROM oauth_tokens WHERE refresh_token_hash = ?`)
        .bind(refreshHash)
        .run();
      const tokens = await issueTokens(env, clientId, row.user_id, row.scope);
      return jsonResponse(tokens);
    }

    return jsonResponse({ error: "unsupported_grant_type" }, { status: 400 });
  }

  return null;
}

function redirectOAuthErrorUrl(
  redirectUri: string,
  error: string,
  state: string,
  description?: string,
): string {
  const dest = new URL(redirectUri);
  dest.searchParams.set("error", error);
  if (description) dest.searchParams.set("error_description", description);
  if (state) dest.searchParams.set("state", state);
  return dest.toString();
}

function redirectOAuthError(
  redirectUri: string,
  error: string,
  state: string,
  description?: string,
): Response {
  return Response.redirect(redirectOAuthErrorUrl(redirectUri, error, state, description), 302);
}

/** WWW-Authenticate challenge for unauthenticated MCP requests. */
export function mcpUnauthorized(origin: string): Response {
  const resourceMeta = `${origin}/.well-known/oauth-protected-resource`;
  return new Response(
    JSON.stringify({
      error: "unauthorized",
      error_description: "Bearer access token required. Complete OAuth 2.1 authorization.",
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer realm="mcp", resource_metadata="${resourceMeta}"`,
        "cache-control": "no-store",
      },
    },
  );
}
