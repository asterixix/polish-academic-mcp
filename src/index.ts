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
import { checkRateLimit, getClientId, hasRateLimitBypass } from "./ratelimit.js";
import { uploadEvalToolCallToWebdav, type EvalWebdavToolCallRecord } from "./eval-webdav.js";
import { getAgentByName } from "agents";
import { extractToolResultAndSpan, computeRqEvalForToolCall } from "./eval-rq-scorer.js";

// Durable Objects / Workflows must be exported from the Worker entry module
// so Wrangler can wire bindings declared in wrangler.jsonc.
export { PipelineAgent } from "./agents/pipeline-agent.js";
export { CataloguingPipelineWorkflow } from "./workflows/cataloguing-pipeline-workflow.js";

const RATE_LIMIT = 10; // tool calls per hour per IP
const AGENT_INSTANCE_NAME = "pipeline-orchestrator";

const handler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestStartMs = Date.now();

    const url = new URL(request.url);
    const path = url.pathname;

    // ── Workflow control plane (Agents Workflows) ──────────────────────────
    if (request.method === "POST" && path === "/pipeline/start") {
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "invalid_json" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const p = payload as {
        user_id: string;
        institution_query: string;
        topics?: string[];
        language?: "pl" | "en" | "mixed";
        bn_set?: string;
        max_items_per_job?: number;
        require_open_access?: boolean;
        job_id?: string;
      };

      const agent = await getAgentByName(env.PipelineAgent as any, AGENT_INSTANCE_NAME);
      const instanceId = await (agent as any).runWorkflow(
        "CATALOGUING_PIPELINE",
        {
          user_id: p.user_id,
          institution_query: p.institution_query,
          topics: p.topics ?? [],
          language: p.language ?? "mixed",
          bn_set: p.bn_set,
          max_items_per_job: p.max_items_per_job ?? 5,
          require_open_access: p.require_open_access ?? true,
        },
        {
          id: p.job_id ?? undefined,
          metadata: { user_id: p.user_id },
        },
      );

      return new Response(JSON.stringify({ instanceId }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && path === "/pipeline/approval") {
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "invalid_json" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const p = payload as {
        instanceId: string;
        approvedBy: string;
        decision: "approved" | "rejected";
        reason?: string;
      };

      // Reuse the existing JWT bypass secret for approval gating.
      const bypass = await hasRateLimitBypass(request, env.RATE_LIMIT_BYPASS_JWT_SECRET);
      if (!bypass) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const agent = await getAgentByName(env.PipelineAgent as any, AGENT_INSTANCE_NAME);

      if (p.decision === "approved") {
        await (agent as any).approveWorkflow(p.instanceId, {
          reason: p.reason ?? "approved",
          metadata: { approvedBy: p.approvedBy },
        });
      } else {
        await (agent as any).rejectWorkflow(p.instanceId, {
          reason: p.reason ?? "rejected",
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Pipeline status (durable workflow instance) ──────────────────────
    if (request.method === "GET" && path === "/pipeline/status") {
      const instanceId = url.searchParams.get("instanceId");
      if (!instanceId) {
        return new Response(JSON.stringify({ error: "missing_instanceId" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const agent = await getAgentByName(env.PipelineAgent as any, AGENT_INSTANCE_NAME);
      const st = await (agent as any).getWorkflowStatus("CATALOGUING_PIPELINE", instanceId);

      return new Response(
        JSON.stringify(
          {
            instanceId,
            workflowName: "CATALOGUING_PIPELINE",
            // We intentionally forward the SDK status payload for UI/debugging.
            status: st?.status ?? null,
            progress: st?.progress ?? null,
            metadata: st?.metadata ?? null,
            raw: st ?? null,
          },
          null,
          2,
        ),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Pipeline final outreach drafts (completed workflow output) ──
    if (request.method === "GET" && path === "/pipeline/outreach") {
      const instanceId = url.searchParams.get("instanceId");
      if (!instanceId) {
        return new Response(JSON.stringify({ error: "missing_instanceId" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const agent = await getAgentByName(env.PipelineAgent as any, AGENT_INSTANCE_NAME);
      let st: any;
      try {
        st = await (agent as any).getWorkflowStatus("CATALOGUING_PIPELINE", instanceId);
      } catch {
        return new Response(JSON.stringify({ error: "instance_not_found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const out = st?.output ?? null;
      const jobStatus = out?.jobStatus ?? null;
      const outreachDrafts = out?.outreachDrafts ?? null;
      const outreachDraftsCount = out?.outreachDraftsCount ?? null;

      // Only return drafts when workflow completed; otherwise keep payload explicit.
      const isComplete = st?.status === "complete";
      return new Response(
        JSON.stringify(
          {
            instanceId,
            workflowName: "CATALOGUING_PIPELINE",
            status: st?.status ?? null,
            jobStatus,
            outreachDraftsCount: isComplete ? outreachDraftsCount : null,
            outreachDrafts: isComplete ? outreachDrafts : null,
            rawOutput: isComplete ? out : null,
          },
          null,
          2,
        ),
        { headers: { "Content-Type": "application/json" } },
      );
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
        const bypass = await hasRateLimitBypass(request, env.RATE_LIMIT_BYPASS_JWT_SECRET);
        if (!bypass) {
          const clientId = getClientId(request);
          const rl = await checkRateLimit(env.RATE_LIMIT_KV, clientId, RATE_LIMIT);

          if (!rl.allowed) {
            return new Response(
              JSON.stringify({
                error: "rate_limit_exceeded",
                message: `Limit of ${RATE_LIMIT} tool calls per hour reached. Retry in ${rl.resetInSeconds} seconds.`,
                retry_after_seconds: rl.resetInSeconds,
              }),
              {
                status: 429,
                headers: {
                  "Content-Type": "application/json",
                  "Retry-After": String(rl.resetInSeconds),
                  "X-RateLimit-Limit": String(RATE_LIMIT),
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

// CF native Workers Logs + Traces (configured in wrangler.jsonc) handle
// observability automatically — no code-level wrapper needed.
export default handler;
