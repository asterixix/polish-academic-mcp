import type { CloudEnv } from "./env.js";
import { appName, publicOrigin } from "./env.js";
import { handleAuthRoutes, readSessionUser } from "./auth.js";
import { handlePasskeyRoutes } from "./webauthn.js";
import { handleOAuthRoutes } from "./oauth.js";
import { handleMcpRoutes } from "./mcp-transport.js";
import { handleAiSearchRoutes } from "./ai-search.js";
import { handleAccountApiRoutes } from "./account-api.js";
import { handleAdminRoutes, logAdminEvent } from "./admin.js";
import { jsonResponse } from "./crypto-util.js";
import { withDeveloperContact } from "./error-contact.js";

export type { CloudEnv };

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  if (!headers.has("x-content-type-options")) headers.set("x-content-type-options", "nosniff");
  if (!headers.has("referrer-policy")) headers.set("referrer-policy", "strict-origin-when-cross-origin");
  if (!headers.has("x-frame-options")) headers.set("x-frame-options", "SAMEORIGIN");
  if (!headers.has("permissions-policy")) {
    headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: CloudEnv, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/api/health") {
        return withSecurityHeaders(
          jsonResponse({
            ok: true,
            name: appName(env),
            version: "1.3.0",
            mcp: `${publicOrigin(request, env)}/mcp`,
          }),
        );
      }

      const authRes = await handleAuthRoutes(request, env, path);
      if (authRes) return withSecurityHeaders(authRes);

      const passkeyRes = await handlePasskeyRoutes(request, env, path);
      if (passkeyRes) return withSecurityHeaders(passkeyRes);

      const oauthRes = await handleOAuthRoutes(request, env, path);
      if (oauthRes) return withSecurityHeaders(oauthRes);

      const mcpRes = await handleMcpRoutes(request, env, path);
      if (mcpRes) return withSecurityHeaders(mcpRes);

      const aiRes = await handleAiSearchRoutes(request, env, path);
      if (aiRes) return withSecurityHeaders(aiRes);

      const accountRes = await handleAccountApiRoutes(request, env, path);
      if (accountRes) return withSecurityHeaders(accountRes);

      const adminRes = await handleAdminRoutes(request, env, path);
      if (adminRes) return withSecurityHeaders(adminRes);

      // SPA handles /login /account /privacy /terms /connectors — only short-circuit logged-in /login
      if (path === "/login") {
        const user = await readSessionUser(env, request);
        const next = url.searchParams.get("next") || "/account";
        if (user) return Response.redirect(new URL(next, url.origin).toString(), 302);
      }

      // Favicon aliases for Claude / ChatGPT / Perplexity crawlers
      if (path === "/favicon.ico" && env.ASSETS) {
        const icon = await env.ASSETS.fetch(new URL("/favicon-32.png", request.url));
        if (icon.ok) {
          return new Response(icon.body, {
            headers: {
              "content-type": "image/png",
              "cache-control": "public, max-age=86400",
            },
          });
        }
      }

      if (env.ASSETS) {
        return withSecurityHeaders(await env.ASSETS.fetch(request));
      }
      return withSecurityHeaders(jsonResponse({ error: "Not found", path }, { status: 404 }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Worker error:", msg);
      try {
        await logAdminEvent(env, "error", "worker.fetch", msg, { path });
      } catch {
        /* ignore */
      }
      return withSecurityHeaders(
        jsonResponse(
          { error: withDeveloperContact(`Błąd serwera: ${msg}`) },
          { status: 500 },
        ),
      );
    }
  },
};
