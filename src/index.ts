/**
 * Cloudflare Worker entry point — stateless MCP server (no Durable Objects).
 *
 * Architecture
 * ─────────────
 * • createMcpHandler() from the Cloudflare Agents SDK wraps an MCP SDK server
 *   in a Streamable HTTP transport compatible with the Workers runtime.
 * • A new McpServer is created per request (required since SDK 1.26.0).
 *
 * Rate limiting
 * ─────────────
 * DISABLED — rate limiting is commented out below.
 * To re-enable: uncomment the import, the RATE_LIMIT constant, and the
 * "Rate limiting" block inside the fetch handler.
 *
 * KV namespaces (defined in wrangler.jsonc)
 * ─────────────────────────────────────────
 * CACHE_KV      — API response cache (TTL 1–24 h per tool)
 * RATE_LIMIT_KV — sliding-window rate limit counters (TTL ~1 h)
 */

import { createMcpHandler } from "agents/mcp";
import type { Env } from "./types.js";
import { createServer } from "./server.js";
// import { checkRateLimit, getClientId } from "./ratelimit.js";

// const RATE_LIMIT = 10; // tool calls per hour per IP

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // ── Rate limiting (only tool/call requests) — DISABLED ─────────────────
    // if (request.method === "POST") {
    //   let isToolCall = false;
    //   try {
    //     // Clone before reading so the body stream is still available for the
    //     // MCP handler that runs afterwards.
    //     const body = (await request.clone().json()) as { method?: string };
    //     isToolCall = body.method === "tools/call";
    //   } catch {
    //     // Malformed JSON — let the MCP handler return a proper error.
    //   }
    //
    //   if (isToolCall) {
    //     const clientId = getClientId(request);
    //     const rl = await checkRateLimit(env.RATE_LIMIT_KV, clientId, RATE_LIMIT);
    //
    //     if (!rl.allowed) {
    //       return new Response(
    //         JSON.stringify({
    //           error: "rate_limit_exceeded",
    //           message: `Limit of ${RATE_LIMIT} tool calls per hour reached. Retry in ${rl.resetInSeconds} seconds.`,
    //           retry_after_seconds: rl.resetInSeconds,
    //         }),
    //         {
    //           status: 429,
    //           headers: {
    //             "Content-Type": "application/json",
    //             "Retry-After": String(rl.resetInSeconds),
    //             "X-RateLimit-Limit": String(RATE_LIMIT),
    //             "X-RateLimit-Remaining": "0",
    //             "X-RateLimit-Reset": String(
    //               Math.floor(Date.now() / 1000) + rl.resetInSeconds,
    //             ),
    //           },
    //         },
    //       );
    //     }
    //   }
    // }

    // ── MCP handler ────────────────────────────────────────────────────────
    // A fresh server instance is mandatory per request — see server.ts.
    const server = createServer(env);
    return createMcpHandler(server)(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
