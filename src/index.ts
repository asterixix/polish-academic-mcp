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
import { createOpenAI } from "@ai-sdk/openai";
import { experimental_createMCPClient as createMCPClient } from "@ai-sdk/mcp";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import type { Env } from "./types.js";
import { createServer } from "./server.js";
import { checkRateLimit, getClientId } from "./ratelimit.js";
import { uploadEvalToolCallToWebdav, type EvalWebdavToolCallRecord } from "./eval-webdav.js";
import {
  handleOauthAuthorize,
  handleOauthRegister,
  handleOauthToken,
  handleOauthWellKnownAuthorizationServer,
  handleOauthWellKnownProtectedResource,
} from "./oauth-server.js";
import { extractToolResultAndSpan, computeRqEvalForToolCall } from "./eval-rq-scorer.js";
import {
  authorizeAdmin,
  getTokenRecord,
  listTokenRecordsWithUsagePreview,
  mintRateLimitToken,
  patchRateLimitToken,
  revokeRateLimitToken,
  resolveRateLimitPolicyFromRequest,
} from "./token-registry.js";
import { getAdminPanelHtml } from "./admin-panel.js";

const RATE_LIMIT = 10; // tool calls per hour per IP

const ADMIN_PANEL_HTML = getAdminPanelHtml(RATE_LIMIT);
type ModelProfile = "cheapest" | "balanced" | "quality";

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

    if (request.method === "POST" && path === "/chat") {
      return handleChatRequest(request, env, url);
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
            const updated = await patchRateLimitToken(env, {
              jti,
              bypass: typeof p.bypass === "boolean" ? p.bypass : undefined,
              limitPerHour: typeof p.limitPerHour === "number" ? p.limitPerHour : undefined,
              expiresAtMs,
              label: typeof p.label === "string" ? p.label : undefined,
              owner: typeof p.owner === "string" ? p.owner : undefined,
            });
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

    let isToolCall = false;
    let toolCallName: string | undefined;
    let toolCallArguments: unknown = undefined;
    let toolCallId: string | number | undefined;
    let toolCallJsonrpc: string | undefined;

    // ── Rate limiting (only tool/call requests) ─────────────────
    if (request.method === "POST") {
      try {
        // Clone before reading so the body stream is still available for the
        // MCP handler that runs afterwards.
        const body = (await request.clone().json()) as unknown;
        if (body && typeof body === "object") {
          const b = body as Record<string, unknown>;
          const method = typeof b["method"] === "string" ? b["method"] : undefined;
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

      if (isToolCall) {
        const policy = await resolveRateLimitPolicyFromRequest(request, env);
        const limitForRequest = policy?.bypass
          ? null
          : policy?.kind === "token"
            ? policy.limitPerHour
            : RATE_LIMIT;

        if (!policy?.bypass) {
          const clientId = policy?.kind === "token" ? policy.identityKey : getClientId(request);
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
    const mcpHandler = createMcpHandler(server, { enableJsonResponse: isToolCall });
    const response = await mcpHandler(request, env, ctx);

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

type ChatRequestBody = {
  messages: UIMessage[];
  system?: string;
  config?: {
    modelProfile?: ModelProfile;
  };
};

function resolveChatModelAlias(env: Env, profile: ModelProfile): string {
  switch (profile) {
    case "balanced":
      return env.CF_AIG_MODEL_BALANCED ?? "dynamic/academic-balanced";
    case "quality":
      return env.CF_AIG_MODEL_QUALITY ?? "dynamic/academic-quality";
    default:
      return env.CF_AIG_MODEL_CHEAPEST ?? "dynamic/academic-cheapest";
  }
}

async function handleChatRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.CF_ACCOUNT_ID || !env.CF_GATEWAY_ID || !env.CF_AIG_TOKEN) {
    return new Response(
      JSON.stringify(
        {
          error: "missing_ai_gateway_config",
          message:
            "Missing required vars: CF_ACCOUNT_ID, CF_GATEWAY_ID, CF_AIG_TOKEN",
        },
        null,
        2,
      ),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const modelProfile = body.config?.modelProfile ?? "cheapest";
  const modelAlias = resolveChatModelAlias(env, modelProfile);
  const mcpUrl = env.MCP_SERVER_URL ?? `${url.origin}/mcp`;

  const mcpClient = await createMCPClient({
    transport: {
      type: "http",
      url: mcpUrl,
      headers: request.headers.get("authorization")
        ? { Authorization: request.headers.get("authorization") ?? "" }
        : undefined,
    },
  });

  try {
    const mcpTools = await mcpClient.tools();
    const gateway = createOpenAI({
      apiKey: env.CF_AIG_TOKEN,
      baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat`,
    });

    const result = streamText({
      model: gateway(modelAlias),
      messages: await convertToModelMessages(body.messages ?? []),
      system: body.system,
      tools: mcpTools,
      onFinish: async () => {
        await mcpClient.close();
      },
    });

    return result.toUIMessageStreamResponse({
      sendReasoning: true,
    });
  } catch (err) {
    await mcpClient.close().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: "chat_failed", message: msg }, null, 2), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
