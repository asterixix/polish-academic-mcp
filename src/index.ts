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
  handleOauthRegister,
  handleOauthToken,
  handleOauthWellKnownAuthorizationServer,
  handleOauthWellKnownProtectedResource,
} from "./oauth-server.js";
import { extractToolResultAndSpan, computeRqEvalForToolCall } from "./eval-rq-scorer.js";
import {
  authorizeAdmin,
  listTokenRecordsWithUsagePreview,
  mintRateLimitToken,
  patchRateLimitToken,
  revokeRateLimitToken,
  resolveRateLimitPolicyFromRequest,
} from "./token-registry.js";

const RATE_LIMIT = 10; // tool calls per hour per IP

const ADMIN_PANEL_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rate-limit bypass admin</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #0b0d14;
        --panel: rgba(255,255,255,0.06);
        --text: rgba(255,255,255,0.92);
        --muted: rgba(255,255,255,0.65);
        --border: rgba(255,255,255,0.14);
        --danger: #ff4d4d;
        --ok: #32d583;
      }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        background: radial-gradient(1200px circle at 10% 0%, rgba(120, 88, 255, 0.22), transparent 55%),
                    radial-gradient(1000px circle at 100% 30%, rgba(0, 210, 255, 0.18), transparent 60%),
                    var(--bg);
        color: var(--text);
      }
      .wrap { max-width: 1100px; margin: 0 auto; padding: 22px; }
      h1 { margin: 0 0 8px; font-size: 20px; }
      .sub { margin: 0 0 18px; color: var(--muted); font-size: 13px; line-height: 1.4; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
      @media (min-width: 980px) { .grid { grid-template-columns: 420px 1fr; } }
      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 14px;
      }
      label { display: block; font-size: 12px; color: var(--muted); margin: 10px 0 6px; }
      input, textarea, select, button {
        font: inherit;
        border-radius: 10px;
      }
      input[type="text"], input[type="number"] {
        width: 100%;
        background: rgba(0,0,0,0.18);
        border: 1px solid var(--border);
        color: var(--text);
        padding: 9px 10px;
        outline: none;
      }
      input[type="checkbox"] { transform: translateY(1px); }
      .row { display: flex; gap: 10px; align-items: center; }
      button {
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.06);
        color: var(--text);
        padding: 9px 12px;
        cursor: pointer;
      }
      button.primary { background: rgba(120, 88, 255, 0.28); border-color: rgba(120, 88, 255, 0.55); }
      button.danger { background: rgba(255, 77, 77, 0.18); border-color: rgba(255, 77, 77, 0.55); }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      .status { margin-top: 10px; font-size: 13px; color: var(--muted); white-space: pre-wrap; }
      .status.err { color: var(--danger); }
      .tokenList { display: grid; gap: 10px; }
      .token {
        padding: 12px;
        border: 1px solid var(--border);
        background: rgba(0,0,0,0.12);
        border-radius: 12px;
      }
      .tokenTop { display: flex; justify-content: space-between; gap: 10px; }
      .tokenMeta { color: var(--muted); font-size: 12px; margin-top: 6px; line-height: 1.4; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      .tokenActions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .muted { color: var(--muted); }
      textarea {
        width: 100%;
        background: rgba(0,0,0,0.18);
        border: 1px solid var(--border);
        color: var(--text);
        border-radius: 10px;
        padding: 10px;
        min-height: 80px;
        resize: vertical;
      }
      .pill {
        display: inline-block;
        font-size: 11px;
        padding: 3px 8px;
        border: 1px solid var(--border);
        border-radius: 999px;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Rate-limit bypass admin</h1>
      <div class="sub">
        This panel manages rate-limit bypass tokens. You must provide panel auth token:
        <span class="mono">Authorization: Bearer &lt;ADMIN_PANEL_BEARER_SECRET&gt;</span>.
        It is stored in <span class="mono">localStorage</span> for convenience.
      </div>

      <div class="grid">
        <div class="card">
          <h2 style="margin:0 0 6px; font-size:15px;">Mint token</h2>
          <label>
            <span style="display:flex;align-items:center;gap:10px;">
              <input id="mintBypass" type="checkbox" />
              <span>Bypass rate limit completely</span>
            </span>
          </label>

          <label for="mintLimit">Limit per hour (used when bypass = false)</label>
          <input id="mintLimit" type="number" min="1" step="1" value="${RATE_LIMIT}" />

          <label for="mintExpiresInDays">Expires in days</label>
          <input id="mintExpiresInDays" type="number" min="1" step="1" value="30" />

          <label for="mintLabel">Label (optional)</label>
          <input id="mintLabel" type="text" placeholder="e.g. alice-prod" />

          <label for="mintOwner">Owner (optional)</label>
          <input id="mintOwner" type="text" placeholder="e.g. Alice" />

          <div style="margin-top: 12px;" class="row">
            <button id="btnMint" class="primary" type="button">Mint</button>
            <button id="btnReload" type="button">Reload</button>
          </div>

          <div id="status" class="status"></div>

          <div style="margin-top: 12px;">
            <label>Minted token (copy now)</label>
            <textarea id="mintedToken" class="mono" readonly></textarea>
            <div class="row" style="margin-top:10px;">
              <button id="btnCopy" type="button" disabled>Copy</button>
            </div>
          </div>
        </div>

        <div class="card">
          <h2 style="margin:0 0 10px; font-size:15px;">Tokens</h2>
          <div id="tokenList" class="tokenList">Loading…</div>
        </div>
      </div>
    </div>

    <script>
      const LOCAL_KEY = "polish_academic_mcp_admin_bearer";

      function setStatus(msg, isErr) {
        const el = document.getElementById("status");
        el.className = isErr ? "status err" : "status";
        el.textContent = msg || "";
      }

      function nowIso(ms) {
        try { return new Date(ms).toISOString(); } catch { return "—"; }
      }

      function escapeJtiInText(s) {
        // we set via textContent, so this is just a noop helper
        return s ?? "";
      }

      function getAdminBearer() {
        const saved = window.localStorage.getItem(LOCAL_KEY);
        if (saved && typeof saved === "string" && saved.trim()) return saved.trim();
        const entered = window.prompt(
          "Enter admin bearer token for this panel.\\n\\nAuthorization header value should be:\\nBearer <token>\\n\\nPaste only <token>."
        );
        if (entered === null) return "";
        const token = entered.trim();
        if (!token) return "";
        window.localStorage.setItem(LOCAL_KEY, token);
        return token;
      }

      const adminBearer = getAdminBearer();
      if (!adminBearer) {
        setStatus("Admin token missing. Reload and enter a bearer token.", true);
      }

      async function callAdmin(path, init) {
        const headers = Object.assign({}, (init && init.headers) || {}, { Authorization: "Bearer " + adminBearer });
        const res = await fetch(path, Object.assign({}, init || {}, { headers }));
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error("HTTP " + res.status + ": " + text.slice(0, 300));
        }
        return res.json();
      }

      async function loadTokens() {
        const list = document.getElementById("tokenList");
        list.textContent = "Loading…";
        try {
          const data = await callAdmin("/admin/tokens?limit=200", { method: "GET" });
          const tokens = data.tokens || [];
          if (!tokens.length) {
            list.textContent = "No tokens yet.";
            return;
          }

          list.innerHTML = "";
          for (const t of tokens) {
            const el = document.createElement("div");
            el.className = "token";

            const revoked = !!t.revokedAtMs;
            const expired = !revoked && t.expiresAtMs && Date.now() >= t.expiresAtMs;

            el.innerHTML = \`
              <div class="tokenTop">
                <div>
                  <div class="mono">jti: \${escapeJtiInText(t.jti)}</div>
                  <div class="tokenMeta">
                    label: \${t.label || "—"} · owner: \${t.owner || "—"}<br/>
                    bypass: \${t.bypass ? "true" : "false"} · limit: \${t.bypass ? "∞" : t.limitPerHour}/h<br/>
                    expiresAt: \${t.expiresAtMs ? nowIso(t.expiresAtMs) : "—"}
                    \${revoked ? "<br/><span style='color:#ff4d4d'>revokedAt: " + nowIso(t.revokedAtMs) + "</span>" : ""}
                    \${expired ? "<br/><span class='muted'>expired</span>" : ""}
                  </div>
                </div>
              </div>
              <div style="margin-top:10px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <span class="pill">remaining: \${t.usage?.remaining ?? 0} · resetIn: \${t.usage?.resetInSeconds ?? 0}s</span>
              </div>
              <div class="tokenActions">
                <button class="danger" type="button" \${revoked ? "disabled" : ""} data-action="revoke">Revoke</button>
                <button type="button" \${revoked ? "disabled" : ""} data-action="update">Update</button>
              </div>
            \`;

            el.querySelector('[data-action="revoke"]').addEventListener("click", async () => {
              const reason = window.prompt("Revoke reason (optional):") || "";
              try {
                await callAdmin("/admin/tokens/" + encodeURIComponent(t.jti) + "/revoke", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ reason: reason.trim() || undefined }),
                });
                await loadTokens();
              } catch (e) {
                setStatus(String(e && e.message ? e.message : e), true);
              }
            });

            el.querySelector('[data-action="update"]').addEventListener("click", async () => {
              const bypass = window.confirm("Toggle bypass for this token?\\n\\nOK = set bypass = " + (!t.bypass ? "true" : "false"));
              if (!bypass) return;
              const newDaysStr = window.prompt("Set new expiry in days:", "30");
              const days = Math.max(1, Math.floor(Number(newDaysStr) || 30));
              const limitStr = window.prompt("Set limitPerHour (only when bypass=false):", String(t.limitPerHour || ${RATE_LIMIT}));
              const limit = Math.max(1, Math.floor(Number(limitStr) || ${RATE_LIMIT}));
              const newExpiresAtMs = Date.now() + days * 24 * 60 * 60 * 1000;

              try {
                await callAdmin("/admin/tokens/" + encodeURIComponent(t.jti), {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    bypass: !t.bypass,
                    limitPerHour: !t.bypass ? limit : limit, // backend keeps limit; bypass=true ignores enforcement
                    expiresAtMs: newExpiresAtMs,
                  }),
                });
                await loadTokens();
              } catch (e) {
                setStatus(String(e && e.message ? e.message : e), true);
              }
            });

            list.appendChild(el);
          }
        } catch (e) {
          list.textContent = "Failed to load tokens.";
          setStatus(String(e && e.message ? e.message : e), true);
        }
      }

      document.getElementById("btnReload").addEventListener("click", loadTokens);

      document.getElementById("btnMint").addEventListener("click", async () => {
        if (!adminBearer) return;
        const bypass = document.getElementById("mintBypass").checked;
        const limitPerHour = Math.max(1, Math.floor(Number(document.getElementById("mintLimit").value) || ${RATE_LIMIT}));
        const expiresInDays = Math.max(1, Math.floor(Number(document.getElementById("mintExpiresInDays").value) || 30));
        const label = document.getElementById("mintLabel").value.trim() || undefined;
        const owner = document.getElementById("mintOwner").value.trim() || undefined;
        const expiresAtMs = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;

        try {
          setStatus("Minting…");
          const data = await callAdmin("/admin/tokens", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bypass,
              limitPerHour,
              expiresAtMs,
              label,
              owner
            }),
          });

          const token = data.token || "";
          document.getElementById("mintedToken").value = token;
          document.getElementById("btnCopy").disabled = !token;
          setStatus("Minted. Copy the token below.");
        } catch (e) {
          setStatus(String(e && e.message ? e.message : e), true);
        }
      });

      document.getElementById("btnCopy").addEventListener("click", async () => {
        const token = document.getElementById("mintedToken").value;
        if (!token) return;
        try {
          await navigator.clipboard.writeText(token);
          setStatus("Copied to clipboard.");
        } catch (e) {
          setStatus("Copy failed: " + String(e && e.message ? e.message : e), true);
        }
      });

      document.getElementById("mintBypass").addEventListener("change", (e) => {
        const disabled = e.target.checked;
        document.getElementById("mintLimit").disabled = disabled;
      });

      // Initial load
      loadTokens();
    </script>
  </body>
</html>`;

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
