/**
 * Cloudflare Worker entry point — stateless MCP server (no Durable Objects).
 *
 * Architecture
 * ─────────────
 * • createMcpHandler() from the Cloudflare Agents SDK wraps an MCP SDK server
 *   in a Streamable HTTP transport compatible with the Workers runtime.
 * • A new McpServer is created per request (required since SDK 1.26.0).
 *
 * KV namespaces (defined in wrangler.jsonc)
 * ─────────────────────────────────────────
 * CACHE_KV      — API response cache (TTL 1–24 h per tool)
 * RATE_LIMIT_KV — sliding-window rate limit counters (TTL ~1 h)
 */

import { createMcpHandler } from "agents/mcp";
import type { Env } from "./types.js";
import { createServer } from "./server.js";
import { checkRateLimit, getClientId } from "./ratelimit.js";
import { uploadEvalToolCallToWebdav, type EvalWebdavToolCallRecord } from "./eval-webdav.js";
import {
  handleOauthAuthorize,
  handleOauthIntrospect,
  handleOauthJwks,
  handleOauthRegister,
  handleOauthToken,
  handleOauthWellKnownAuthorizationServer,
  handleOauthWellKnownProtectedResource,
} from "./oauth-server.js";
import { extractToolResultAndSpan, computeRqEvalForToolCall } from "./eval-rq-scorer.js";
import {
  authorizeAdmin,
  getTokenRecord,
  introspectConnectBearer,
  listTokenRecordsWithUsagePreview,
  mintRateLimitToken,
  parseBearerToken,
  patchRateLimitToken,
  revokeRateLimitToken,
  resolveMcpBearerPolicy,
  resolveRateLimitPolicyFromRequest,
  type RateLimitTokenPolicy,
} from "./token-registry.js";
import { getAdminPanelHtml } from "./admin-panel.js";
import { getConnectPageHtml, getVerifyRedirectTarget, listVerifyProviderIds } from "./connect-page.js";
import {
  SITE_PROJECT_NAME,
  siteBrandingFooterHtml,
  siteBrandingStyles,
  siteBrandingTopBarHtml,
} from "./site-branding.js";

const RATE_LIMIT = 10; // tool calls per hour per IP
const PUBLIC_TOOL_NAMES = new Set<string>([
  "bn_search_publications",
  "bn_search_articles",
  "bn_get_article",
  "ruj_search",
  "ruj_get_item",
  "agh_search",
  "agh_get_item",
  "amu_search",
  "amu_get_item",
  "uafm_search",
  "uafm_get_item",
  "icm_search",
  "icm_get_item",
  "rodbuk_search",
  "repod_search",
  "repod_get_dataset",
  "dane_search",
  "dane_get_dataset",
  "imgw_synop",
  "imgw_hydro",
  "imgw_meteo",
  "imgw_warnings",
  "ludzie_search",
  "ludzie_semantic_search",
  "ludzie_get_scientist",
  "pauart_search",
  "pauart_get_artwork",
  "filmpolski_search",
  "filmpolski_get_item",
  "fototekaslaska_search",
  "fototekaslaska_get_photo",
  "eval_response",
]);

const ADMIN_PANEL_HTML = getAdminPanelHtml(RATE_LIMIT);

type ToolAccessPolicy = {
  hasFullAccess: boolean;
  allowedToolNames: Set<string>;
};

function resolveToolAccessPolicy(policy: RateLimitTokenPolicy | null): ToolAccessPolicy {
  // Legacy bypass secret retains full access.
  if (policy?.kind === "legacy_bypass" || policy?.allowedTools?.includes("*")) {
    return { hasFullAccess: true, allowedToolNames: new Set() };
  }

  const allowed = new Set(PUBLIC_TOOL_NAMES);
  if (
    (policy?.kind === "token" || policy?.kind === "oauth_access" || policy?.kind === "guest") &&
    Array.isArray(policy.allowedTools)
  ) {
    for (const t of policy.allowedTools) {
      if (typeof t === "string" && t.trim().length > 0) allowed.add(t.trim());
    }
  }
  return { hasFullAccess: false, allowedToolNames: allowed };
}

const handler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestStartMs = Date.now();

    const url = new URL(request.url);
    const path = url.pathname;
    const corsForAdmin = (init?: { status?: number; headers?: HeadersInit; body?: BodyInit }): Response => {
      const origin = request.headers.get("Origin") ?? "*";
      return new Response(init?.body ?? null, {
        status: init?.status,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
          "Access-Control-Max-Age": "86400",
          ...(init?.headers ?? {}),
        },
      });
    };

    // ── OAuth server support (Perplexity remote MCP) ──────────────────────
    // These endpoints implement a minimal OAuth 2.1 Authorization Server +
    // RFC7591 dynamic client registration so MCP clients can obtain
    // client_id/client_secret automatically.
    if (path === "/.well-known/oauth-protected-resource" && request.method === "GET") {
      return handleOauthWellKnownProtectedResource(request, env);
    }

    if (path === "/.well-known/oauth-authorization-server" && request.method === "GET") {
      return handleOauthWellKnownAuthorizationServer(request, env);
    }

    if (path === "/.well-known/jwks.json" && request.method === "GET") {
      return handleOauthJwks(request, env);
    }

    if ((path === "/" || path === "") && request.method === "GET") {
      return new Response(getRootPageHtml(url), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    if (path === "/health" && request.method === "GET") {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            service: "polish-academic-mcp",
            endpoints: {
              mcp: `${url.origin}/mcp`,
              connect: `${url.origin}/connect`,
              verify: `${url.origin}/verify`,
              verify_redirect: `${url.origin}/verify/redirect?provider=claude`,
              connect_redirect: `${url.origin}/connect/redirect?provider=claude`,
              oauth_authorization_server: `${url.origin}/.well-known/oauth-authorization-server`,
            },
          },
          null,
          2,
        ),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (
      path === "/verify/redirect" ||
      path === "/verify/redirect/" ||
      path === "/connect/redirect" ||
      path === "/connect/redirect/"
    ) {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
      const target = getVerifyRedirectTarget(url.searchParams.get("provider") ?? "");
      if (!target) {
        return new Response(
          JSON.stringify({ error: "unknown_provider", allowed: listVerifyProviderIds() }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          },
        );
      }
      return Response.redirect(target, 302);
    }

    if ((path === "/verify" || path === "/verify/") && request.method === "GET") {
      const u = new URL(request.url);
      if (!u.searchParams.has("verify")) u.searchParams.set("verify", "1");
      const dest = new URL("/connect", url.origin);
      u.searchParams.forEach((v, k) => {
        dest.searchParams.set(k, v);
      });
      return Response.redirect(dest.toString(), 302);
    }

    if ((path === "/connect" || path === "/connect/") && request.method === "GET") {
      return new Response(getConnectPageHtml(url.origin, url.searchParams, env), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    if (path === "/connect/token-status" || path === "/connect/token-status/") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
            "Access-Control-Allow-Headers": "Authorization",
            "Access-Control-Max-Age": "86400",
          },
        });
      }
      if (request.method === "GET") {
        const info = await introspectConnectBearer(request, env);
        const status = info.ok ? 200 : 401;
        return new Response(JSON.stringify(info, null, 2), {
          status,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    if (path === "/register") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204 });
      return handleOauthRegister(request, env);
    }

    if (path === "/oauth/authorize") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204 });
      return handleOauthAuthorize(request, env);
    }

    if (path === "/oauth/token") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204 });
      return handleOauthToken(request, env);
    }

    if (path === "/oauth/introspect") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204 });
      return handleOauthIntrospect(request, env);
    }

    // ── Workflow control plane (Agents Workflows) ──────────────────────────
    if (
      request.method === "GET" &&
      (path === "/admin" ||
        path === "/admin/" ||
        path === "/web/app/admin" ||
        path === "/web/app/admin/")
    ) {
      return new Response(ADMIN_PANEL_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    // ── Admin: rate-limit token registry ──────────────────────────────────
    // Note: Admin endpoints are not rate-limited.
    if (path === "/admin/tokens" || path.startsWith("/admin/tokens/")) {
      if (request.method === "OPTIONS") {
        return corsForAdmin({ status: 204 });
      }

      const ok = await authorizeAdmin(request, env);
      if (!ok) {
        return corsForAdmin({
          status: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "forbidden" }, null, 2),
        });
      }

      const parts = url.pathname.split("/").filter(Boolean);
      // parts: ["admin","tokens"] OR ["admin","tokens",jti] OR ["admin","tokens",jti,"revoke"]
      if (parts.length === 2 && parts[0] === "admin" && parts[1] === "tokens") {
        if (request.method === "GET") {
          const limitParam = url.searchParams.get("limit");
          const limit = limitParam ? Number(limitParam) : undefined;
          const safeLimit = typeof limit === "number" && Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 200;
          const tokens = await listTokenRecordsWithUsagePreview(env, { limit: safeLimit });
          return corsForAdmin({
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tokens }, null, 2),
          });
        }

        if (request.method === "POST") {
          let payload: unknown;
          try {
            payload = await request.json();
          } catch {
            return corsForAdmin({
              status: 400,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ error: "invalid_json" }, null, 2),
            });
          }

          const p = payload as {
            bypass?: boolean;
            limitPerHour?: number;
            expiresAtMs?: number;
            expiresInSeconds?: number;
            expiresAt?: string;
            label?: string;
            owner?: string;
            allowedTools?: string[];
            oauthAccessLimitPerHour?: number;
            oauthAccessTokenTtlSeconds?: number;
          };

          const bypass = typeof p.bypass === "boolean" ? p.bypass : false;
          const limitPerHour = typeof p.limitPerHour === "number" && Number.isFinite(p.limitPerHour) ? p.limitPerHour : RATE_LIMIT;

          const now = nowMsFromIndex();
          let expiresAtMs: number;
          if (typeof p.expiresAtMs === "number" && Number.isFinite(p.expiresAtMs)) {
            expiresAtMs = Math.floor(p.expiresAtMs);
          } else if (typeof p.expiresInSeconds === "number" && Number.isFinite(p.expiresInSeconds)) {
            expiresAtMs = Math.floor(now + p.expiresInSeconds * 1000);
          } else if (typeof p.expiresAt === "string") {
            const d = new Date(p.expiresAt);
            expiresAtMs = Number.isFinite(d.getTime()) ? d.getTime() : now + 30 * 24 * 60 * 60 * 1000;
          } else {
            // Default: 30 days.
            expiresAtMs = now + 30 * 24 * 60 * 60 * 1000;
          }

          try {
            const minted = await mintRateLimitToken(env, {
              bypass,
              limitPerHour,
              expiresAtMs,
              createdBy: "admin",
              label: typeof p.label === "string" ? p.label : undefined,
              owner: typeof p.owner === "string" ? p.owner : undefined,
              allowedTools: Array.isArray(p.allowedTools) ? p.allowedTools : undefined,
              oauthAccessLimitPerHour:
                typeof p.oauthAccessLimitPerHour === "number" ? p.oauthAccessLimitPerHour : undefined,
              oauthAccessTokenTtlSeconds:
                typeof p.oauthAccessTokenTtlSeconds === "number"
                  ? p.oauthAccessTokenTtlSeconds
                  : undefined,
            });
            return corsForAdmin({
              status: 200,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                {
                  token: minted.token,
                  record: minted.record,
                },
                null,
                2,
              ),
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return corsForAdmin({
              status: 400,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ error: "mint_failed", message: msg }, null, 2),
            });
          }
        }
      }

      if (parts.length === 3 && parts[0] === "admin" && parts[1] === "tokens") {
        const jti = parts[2];
        if (request.method === "GET") {
          const record = await getTokenRecord(env, jti);
          if (!record) {
            return corsForAdmin({
              status: 404,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ error: "token_not_found" }, null, 2),
            });
          }
          return corsForAdmin({
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ record }, null, 2),
          });
        }

        if (request.method === "PATCH") {
          let payload: unknown;
          try {
            payload = await request.json();
          } catch {
            return corsForAdmin({
              status: 400,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ error: "invalid_json" }, null, 2),
            });
          }

          const p = payload as {
            bypass?: boolean;
            limitPerHour?: number;
            expiresAtMs?: number;
            expiresInSeconds?: number;
            expiresAt?: string;
            label?: string;
            owner?: string;
            allowedTools?: string[] | null;
            oauthAccessLimitPerHour?: number | null;
            oauthAccessTokenTtlSeconds?: number | null;
          };

          const now = nowMsFromIndex();
          let expiresAtMs: number | undefined;
          if (typeof p.expiresAtMs === "number" && Number.isFinite(p.expiresAtMs)) {
            expiresAtMs = Math.floor(p.expiresAtMs);
          } else if (typeof p.expiresInSeconds === "number" && Number.isFinite(p.expiresInSeconds)) {
            expiresAtMs = Math.floor(now + p.expiresInSeconds * 1000);
          } else if (typeof p.expiresAt === "string") {
            const d = new Date(p.expiresAt);
            expiresAtMs = Number.isFinite(d.getTime()) ? d.getTime() : undefined;
          }

          try {
            const patchPayload: Parameters<typeof patchRateLimitToken>[1] = {
              jti,
              bypass: typeof p.bypass === "boolean" ? p.bypass : undefined,
              limitPerHour: typeof p.limitPerHour === "number" ? p.limitPerHour : undefined,
              expiresAtMs,
              label: typeof p.label === "string" ? p.label : undefined,
              owner: typeof p.owner === "string" ? p.owner : undefined,
              allowedTools: Array.isArray(p.allowedTools) || p.allowedTools === null ? p.allowedTools : undefined,
            };
            if ("oauthAccessLimitPerHour" in p) {
              patchPayload.oauthAccessLimitPerHour = p.oauthAccessLimitPerHour ?? null;
            }
            if ("oauthAccessTokenTtlSeconds" in p) {
              patchPayload.oauthAccessTokenTtlSeconds = p.oauthAccessTokenTtlSeconds ?? null;
            }
            const updated = await patchRateLimitToken(env, patchPayload);
            return corsForAdmin({
              status: 200,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ record: updated }, null, 2),
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return corsForAdmin({
              status: 400,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ error: "patch_failed", message: msg }, null, 2),
            });
          }
        }
      }

      if (
        parts.length === 4 &&
        parts[0] === "admin" &&
        parts[1] === "tokens" &&
        parts[3] === "revoke"
      ) {
        const jti = parts[2];
        if (request.method === "POST") {
          let payload: unknown;
          try {
            payload = await request.json();
          } catch {
            payload = {};
          }
          const p = payload as { reason?: string };
          try {
            const updated = await revokeRateLimitToken(env, { jti, reason: typeof p.reason === "string" ? p.reason : undefined });
            return corsForAdmin({
              status: 200,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ record: updated }, null, 2),
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return corsForAdmin({
              status: 400,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ error: "revoke_failed", message: msg }, null, 2),
            });
          }
        }
      }

      return corsForAdmin({
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "not_found" }, null, 2),
      });
    }

    const isMcpPath = path === "/mcp" || path === "/mcp/";

    let isToolCall = false;
    let isMcpJsonRpcRequest = false;
    let rateLimitPolicy: RateLimitTokenPolicy | null = null;
    let toolCallName: string | undefined;
    let toolCallArguments: unknown = undefined;
    let toolCallId: string | number | undefined;
    let toolCallJsonrpc: string | undefined;

    // ── Rate limiting (only tool/call requests) ─────────────────
    if (request.method === "POST") {
      if (isMcpPath) {
        const bearer = parseBearerToken(request);
        if (bearer) {
          const mcpAuth = await resolveMcpBearerPolicy(request, env);
          if (!mcpAuth) {
            return new Response(
              JSON.stringify({
                error: "unauthorized",
                message:
                  "Invalid Bearer token. Use a valid OAuth access_token from this host’s /oauth/token, a Connect JWT from /admin/tokens, or omit Authorization for anonymous guest (public tools + IP rate limit). Raw API secrets are not accepted as Bearer tokens.",
              }),
              {
                status: 401,
                headers: {
                  "Content-Type": "application/json; charset=utf-8",
                  "Cache-Control": "no-store",
                  "WWW-Authenticate": 'Bearer error="invalid_token"',
                },
              },
            );
          }
          rateLimitPolicy = mcpAuth;
        } else {
          rateLimitPolicy = {
            kind: "guest",
            identityKey: getClientId(request),
            bypass: false,
            limitPerHour: RATE_LIMIT,
            allowedTools: [],
          };
        }
      }

      try {
        // Clone before reading so the body stream is still available for the
        // MCP handler that runs afterwards.
        const body = (await request.clone().json()) as unknown;
        if (body && typeof body === "object") {
          const b = body as Record<string, unknown>;
          const method = typeof b["method"] === "string" ? b["method"] : undefined;
          const jsonrpc = typeof b["jsonrpc"] === "string" ? b["jsonrpc"] : undefined;
          isMcpJsonRpcRequest = Boolean(method && (jsonrpc === "2.0" || jsonrpc === undefined));
          isToolCall = method === "tools/call";
          if (isToolCall) {
            const params = b["params"] as Record<string, unknown> | undefined;
            if (params && typeof params["name"] === "string") {
              toolCallName = params["name"];
            }
            if (params && "arguments" in params) {
              toolCallArguments = params["arguments"];
            }
            if (typeof b["id"] === "string" || typeof b["id"] === "number") toolCallId = b["id"];
            if (typeof b["jsonrpc"] === "string") toolCallJsonrpc = b["jsonrpc"];
          }
        }
      } catch {
        // Malformed JSON — let the MCP handler return a proper error.
      }

      if (isMcpJsonRpcRequest && !isMcpPath) {
        rateLimitPolicy = await resolveRateLimitPolicyFromRequest(request, env);
      }

      if (isToolCall) {
        const toolAccess = resolveToolAccessPolicy(rateLimitPolicy);
        if (
          toolCallName &&
          !toolAccess.hasFullAccess &&
          !toolAccess.allowedToolNames.has(toolCallName)
        ) {
          return new Response(
            JSON.stringify({
              error: "tool_forbidden",
              message: `Tool '${toolCallName}' is not available for this token/profile.`,
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        const limitForRequest = rateLimitPolicy?.bypass
          ? null
          : rateLimitPolicy?.kind === "token" ||
              rateLimitPolicy?.kind === "oauth_access" ||
              rateLimitPolicy?.kind === "guest"
            ? rateLimitPolicy.limitPerHour
            : RATE_LIMIT;

        if (!rateLimitPolicy?.bypass) {
          const clientId =
            rateLimitPolicy?.kind === "token" ||
            rateLimitPolicy?.kind === "oauth_access" ||
            rateLimitPolicy?.kind === "guest"
              ? rateLimitPolicy.identityKey
              : getClientId(request);
          const rl = await checkRateLimit(env.RATE_LIMIT_KV, clientId, limitForRequest ?? RATE_LIMIT);

          if (!rl.allowed) {
            return new Response(
              JSON.stringify({
                error: "rate_limit_exceeded",
                message: `Limit of ${limitForRequest ?? RATE_LIMIT} tool calls per hour reached. Retry in ${rl.resetInSeconds} seconds.`,
                retry_after_seconds: rl.resetInSeconds,
              }),
              {
                status: 429,
                headers: {
                  "Content-Type": "application/json",
                  "Retry-After": String(rl.resetInSeconds),
                  "X-RateLimit-Limit": String(limitForRequest ?? RATE_LIMIT),
                  "X-RateLimit-Remaining": "0",
                  "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + rl.resetInSeconds),
                },
              },
            );
          }
        }
      }
    }

    // ── MCP handler ────────────────────────────────────────────────────────
    // A fresh server instance is mandatory per request — see server.ts.
    const server = createServer(env);
    // Compatibility: some MCP clients enumerate tools only when JSON responses
    // are enabled for list/initialize requests too (not just tools/call).
    const mcpHandler = createMcpHandler(server, { enableJsonResponse: isMcpJsonRpcRequest });
    let response = await mcpHandler(request, env, ctx);

    // tools/list returns the full catalog for every client; tool invocation is
    // still gated below (tools/call) via PUBLIC_TOOL_NAMES + token allowedTools.

    // ── WebDAV eval-data upload ───────────────────────────────────────────
    if (isToolCall && toolCallName) {
      const clientId = getClientId(request);
      const latencyMs = Date.now() - requestStartMs;

      let jsonText = "";
      let jsonLength = 0;
      let jsonTruncated = false;
      let rqEval: unknown = undefined;
      try {
        const payload = await response.clone().json();
        const rawPayloadText = JSON.stringify(payload);
        jsonLength = rawPayloadText.length;
        const maxChars = env.EVAL_WEBDAV_MAX_JSON_BYTES
          ? Math.max(1, Math.floor(Number(env.EVAL_WEBDAV_MAX_JSON_BYTES)))
          : 120_000;
        if (rawPayloadText.length > maxChars) {
          jsonTruncated = true;
          jsonText = `${rawPayloadText.slice(0, maxChars)}\n...[truncated ${rawPayloadText.length - maxChars} chars]`;
        } else {
          jsonText = rawPayloadText;
        }

        const extracted = extractToolResultAndSpan(payload);
        if (extracted.toolResult) {
          rqEval = computeRqEvalForToolCall({
            toolName: toolCallName,
            toolArgs: toolCallArguments,
            toolResult: extracted.toolResult,
            spanAttributes: extracted.spanAttributes,
            latencyMs,
          });
        } else {
          rqEval = undefined;
        }
      } catch {
        // Non-JSON response (or response already consumed). Skip computed eval.
        try {
          const rawText = await response.clone().text();
          jsonLength = rawText.length;
          jsonText = rawText;
          jsonTruncated = false;
        } catch {
          jsonText = "";
          jsonLength = 0;
          jsonTruncated = false;
        }
        rqEval = undefined;
      }

      const record: EvalWebdavToolCallRecord = {
        kind: "mcp_tool_call_eval_data",
        at: new Date().toISOString(),
        request: {
          jsonrpc: toolCallJsonrpc,
          id: toolCallId,
          toolName: toolCallName,
          arguments: toolCallArguments,
        },
        client: { clientId },
        timing: { latencyMs },
        response: {
          status: response.status,
          jsonText,
          jsonLength,
          jsonTruncated,
        },
        rqEval,
      };

      ctx.waitUntil(uploadEvalToolCallToWebdav(env, record).catch(() => {}));
    }

    return response;
  },
} satisfies ExportedHandler<Env>;

function nowMsFromIndex(): number {
  return Date.now();
}

// CF native Workers Logs + Traces (configured in wrangler.jsonc) handle
// observability automatically — no code-level wrapper needed.
export default handler;

function getRootPageHtml(url: URL): string {
  const origin = url.origin;
  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${SITE_PROJECT_NAME}</title>
    <style>
      :root {
        --site-brand-border: #263248;
        --site-brand-bg: #121b2b;
        --site-brand-bg-footer: #0b1220;
        --site-footer-muted: #8b9cb8;
        --site-footer-strong: #e6edf7;
        --site-footer-link: #9ec5ff;
      }
      body { margin: 0; font-family: system-ui, sans-serif; background: #0b1220; color: #e6edf7; }
      .wrap { max-width: 920px; margin: 0 auto; padding: 2rem 16px 3rem; }
      .card { border: 1px solid #263248; border-radius: 12px; background: #121b2b; padding: 20px; }
      h1 { margin-top: 0; }
      a { color: #9ec5ff; text-decoration: none; }
      a:hover { text-decoration: underline; }
      code { background: #1c2940; padding: 2px 6px; border-radius: 6px; }
      ul { line-height: 1.9; }
      ${siteBrandingStyles()}
    </style>
  </head>
  <body>
    ${siteBrandingTopBarHtml(`${origin}/`)}
    <div class="wrap" id="main-content">
      <div class="card">
        <h1>${SITE_PROJECT_NAME}</h1>
        <p>Usługa działa. Wybierz punkt wejścia:</p>
        <ul>
          <li><a href="${origin}/connect">${origin}/connect</a> — podłączenie MCP, JWT, weryfikacja (parametr <span class="mono">?verify=1</span>; stary URL <span class="mono">/verify</span> przekierowuje tutaj)</li>
          <li><code>${origin}/mcp</code> — endpoint serwera MCP</li>
          <li><a href="${origin}/health">${origin}/health</a> — podstawowy JSON stanu usługi</li>
        </ul>
      </div>
    </div>
    ${siteBrandingFooterHtml()}
  </body>
</html>`;
}
