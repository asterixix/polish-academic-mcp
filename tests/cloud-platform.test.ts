import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("cloud/ zawiera konfigurację Workers, migrację D1 i logo", () => {
  const required = [
    "cloud/package.json",
    "cloud/wrangler.jsonc",
    "cloud/tsconfig.json",
    "cloud/migrations/0001_init.sql",
    "cloud/web/public/logo.jpg",
    "cloud/web/package.json",
    "cloud/web/src/App.tsx",
    "cloud/web/src/components/chat/Thread.tsx",
    "cloud/src/index.ts",
    "cloud/src/auth.ts",
    "cloud/src/webauthn.ts",
    "cloud/src/oauth.ts",
    "cloud/src/quota.ts",
    "cloud/src/mcp-transport.ts",
    "cloud/src/ai-search.ts",
    "cloud/src/ui.ts",
    "docs/CLOUDFLARE.md",
  ];
  for (const path of required) {
    assert.ok(existsSync(resolve(root, path)), `brak pliku: ${path}`);
  }
  const sql = readFileSync(resolve(root, "cloud/migrations/0001_init.sql"), "utf8");
  for (const table of [
    "users",
    "webauthn_credentials",
    "oauth_clients",
    "oauth_codes",
    "oauth_tokens",
    "usage_quotas",
    "search_threads",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.ok(readFileSync(resolve(root, "cloud/public/logo.jpg")).byteLength > 1000);
});

test("src/server.ts ma fallback wersji dla Workers", () => {
  const source = readFileSync(resolve(root, "src/server.ts"), "utf8");
  assert.match(source, /PACKAGE_VERSION_FALLBACK/);
  assert.match(source, /catch\s*\{/);
});

test("PBKDF2 hash/verify i HMAC sesji działają w Web Crypto", async () => {
  const { hashPassword, verifyPassword, signPayload, verifyPayload, sha256Base64Url } =
    await import("../cloud/src/crypto-util.js");
  const encoded = await hashPassword("sekretne-haslo-123");
  assert.match(encoded, /^pbkdf2\$100000\$/);
  assert.equal(await verifyPassword("sekretne-haslo-123", encoded), true);
  assert.equal(await verifyPassword("zle", encoded), false);

  const token = await signPayload("test-secret", { uid: "u1", exp: 9_999_999_999 });
  const payload = await verifyPayload<{ uid: string }>("test-secret", token);
  assert.equal(payload?.uid, "u1");
  assert.equal(await verifyPayload("other", token), null);

  const challenge = await sha256Base64Url("verifier-abc");
  assert.ok(challenge.length > 20);
});

test("klucze okresów limitów: miesiąc i tydzień ISO", async () => {
  const { monthPeriodKey, isoWeekPeriodKey, aiSearchLimit, mcpLimit } = await import(
    "../cloud/src/quota.js"
  );
  assert.match(monthPeriodKey(new Date("2026-10-17T12:00:00Z")), /^2026-10$/);
  assert.match(isoWeekPeriodKey(new Date("2026-10-17T12:00:00Z")), /^2026-W\d{2}$/);
  const env = {
    MCP_MONTHLY_LIMIT: "100",
    AI_SEARCH_ANON_WEEKLY_LIMIT: "2",
    AI_SEARCH_USER_WEEKLY_LIMIT: "5",
  } as import("../cloud/src/env.js").CloudEnv;
  assert.equal(mcpLimit(env), 100);
  assert.equal(aiSearchLimit(env, false), 2);
  assert.equal(aiSearchLimit(env, true), 5);
});

test("quota D1: blokada po limicie MCP 100 i AI anon 2", async () => {
  const { MemoryD1 } = await import("../cloud/src/db-memory.js");
  const { consumeQuota, getQuota, mcpSubject, aiSubject, monthPeriodKey, isoWeekPeriodKey } =
    await import("../cloud/src/quota.js");

  const db = new MemoryD1();
  const env = { DB: db as unknown as D1Database } as import("../cloud/src/env.js").CloudEnv;
  const period = monthPeriodKey();
  const subject = mcpSubject("user-1");

  for (let i = 0; i < 100; i += 1) {
    const status = await consumeQuota(env, subject, "mcp_monthly", period, 100);
    assert.ok(status.used <= 100);
  }
  const full = await getQuota(env, subject, "mcp_monthly", period, 100);
  assert.equal(full.used, 100);
  assert.equal(full.allowed, false);
  const blocked = await consumeQuota(env, subject, "mcp_monthly", period, 100);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.used, 100);

  const week = isoWeekPeriodKey();
  const anon = aiSubject(null, "anon-abc");
  assert.equal((await consumeQuota(env, anon, "ai_search_weekly", week, 2)).allowed, true);
  assert.equal((await consumeQuota(env, anon, "ai_search_weekly", week, 2)).used, 2);
  assert.equal((await getQuota(env, anon, "ai_search_weekly", week, 2)).allowed, false);

  const userAi = aiSubject("user-1", "anon-abc");
  for (let i = 0; i < 5; i += 1) {
    await consumeQuota(env, userAi, "ai_search_weekly", week, 5);
  }
  assert.equal((await getQuota(env, userAi, "ai_search_weekly", week, 5)).allowed, false);
});

test("rejestracja i logowanie email+hasło ustawiają sesję", async () => {
  const { MemoryD1, memoryKv } = await import("../cloud/src/db-memory.js");
  const { handleAuthRoutes } = await import("../cloud/src/auth.js");
  const db = new MemoryD1();
  const env = {
    DB: db as unknown as D1Database,
    CACHE_KV: memoryKv(),
    AI: {} as Ai,
    SESSION_SECRET: "unit-test-secret",
  } as import("../cloud/src/env.js").CloudEnv;

  const register = await handleAuthRoutes(
    new Request("https://example.com/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "badacz@example.com",
        password: "haslo-testowe-9",
        display_name: "Badacz",
      }),
    }),
    env,
    "/api/auth/register",
  );
  assert.ok(register);
  assert.equal(register!.status, 200);
  const setCookie = register!.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /pamcp_session=/);
  const regJson = (await register!.json()) as { user: { email: string } };
  assert.equal(regJson.user.email, "badacz@example.com");

  const login = await handleAuthRoutes(
    new Request("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "badacz@example.com", password: "haslo-testowe-9" }),
    }),
    env,
    "/api/auth/login",
  );
  assert.equal(login!.status, 200);

  const bad = await handleAuthRoutes(
    new Request("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "badacz@example.com", password: "zle" }),
    }),
    env,
    "/api/auth/login",
  );
  assert.equal(bad!.status, 401);
});

test("OAuth 2.1: discovery, DCR, PKCE authorize+token", async () => {
  const { MemoryD1, memoryKv } = await import("../cloud/src/db-memory.js");
  const { handleOAuthRoutes, authorizationServerMetadata, protectedResourceMetadata } =
    await import("../cloud/src/oauth.js");
  const { handleAuthRoutes, SESSION_COOKIE } = await import("../cloud/src/auth.js");
  const { signPayload } = await import("../cloud/src/crypto-util.js");
  const { sha256Base64Url } = await import("../cloud/src/crypto-util.js");

  const meta = authorizationServerMetadata("https://pamcp.example");
  assert.equal(meta.authorization_endpoint, "https://pamcp.example/oauth/authorize");
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  assert.equal(protectedResourceMetadata("https://pamcp.example").resource, "https://pamcp.example/mcp");

  const db = new MemoryD1();
  const env = {
    DB: db as unknown as D1Database,
    CACHE_KV: memoryKv(),
    AI: {} as Ai,
    SESSION_SECRET: "unit-test-secret",
    APP_NAME: "Polish Academic MCP",
    PUBLIC_BASE_URL: "https://pamcp.example",
  } as import("../cloud/src/env.js").CloudEnv;

  // Create user + session cookie
  await handleAuthRoutes(
    new Request("https://pamcp.example/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "oauth@example.com", password: "haslo-testowe-9" }),
    }),
    env,
    "/api/auth/register",
  );
  const userId = db.users[0].id as string;
  const session = await signPayload("unit-test-secret", {
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const discovery = await handleOAuthRoutes(
    new Request("https://pamcp.example/.well-known/oauth-authorization-server"),
    env,
    "/.well-known/oauth-authorization-server",
  );
  assert.equal(discovery!.status, 200);

  const reg = await handleOAuthRoutes(
    new Request("https://pamcp.example/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
      }),
    }),
    env,
    "/oauth/register",
  );
  assert.equal(reg!.status, 201);
  const client = (await reg!.json()) as { client_id: string };
  assert.match(client.client_id, /^pamcp_/);

  const verifier = "test-code-verifier-0123456789abcdef";
  const challenge = await sha256Base64Url(verifier);
  const authorizeUrl = new URL("https://pamcp.example/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", client.client_id);
  authorizeUrl.searchParams.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", "mcp");
  authorizeUrl.searchParams.set("state", "xyz");
  authorizeUrl.searchParams.set("consent", "1");

  const authz = await handleOAuthRoutes(
    new Request(authorizeUrl, {
      method: "GET",
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    }),
    env,
    "/oauth/authorize",
  );
  assert.equal(authz!.status, 302);
  const location = authz!.headers.get("location") ?? "";
  assert.match(location, /code=/);
  const code = new URL(location).searchParams.get("code");
  assert.ok(code);

  const tokenRes = await handleOAuthRoutes(
    new Request("https://pamcp.example/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        client_id: client.client_id,
        code_verifier: verifier,
      }),
    }),
    env,
    "/oauth/token",
  );
  assert.equal(tokenRes!.status, 200);
  const tokens = (await tokenRes!.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
  };
  assert.equal(tokens.token_type, "Bearer");
  assert.ok(tokens.access_token.length > 10);
  assert.ok(tokens.refresh_token.length > 10);
});

test("MCP JSON-RPC initialize i tools/list zwracają kontrakt", async () => {
  const { handleMcpJsonRpc } = await import("../cloud/src/tool-bridge.js");
  const { createMemoryCacheStore } = await import("../src/cache.js");
  // Minimal env: tool-bridge uses toCoreEnv which needs CACHE_KV as KVNamespace.
  // For list via createServer we need a CacheStore-compatible binding through wrapKv —
  // call handleMcpJsonRpc initialize which does not hit tools.
  const init = await handleMcpJsonRpc(
    {
      DB: {} as D1Database,
      CACHE_KV: {
        async get() {
          return null;
        },
        async put() {},
        async delete() {},
        async list() {
          return { keys: [], list_complete: true, cacheStatus: null };
        },
        async getWithMetadata() {
          return { value: null, metadata: null, cacheStatus: null };
        },
      } as unknown as KVNamespace,
      AI: {} as Ai,
    },
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  );
  assert.equal(
    init?.result && (init.result as { serverInfo: { name: string } }).serverInfo.name,
    "Polish Academic MCP",
  );

  // Smoke: createMemoryCacheStore still works for local CLI path
  const store = createMemoryCacheStore();
  await store.put("k", "v", { expirationTtl: 60 });
  assert.equal(await store.get("k"), "v");
});

test("zgodność z katalogami Claude, ChatGPT i Perplexity: adnotacje narzędzi, konto recenzenckie, /api/directory-metadata i ai-plugin.json", async () => {
  const { MemoryD1, memoryKv } = await import("../cloud/src/db-memory.js");
  const { handleAuthRoutes } = await import("../cloud/src/auth.js");
  const { handleMcpRoutes } = await import("../cloud/src/mcp-transport.js");
  const { handleMcpJsonRpc } = await import("../cloud/src/tool-bridge.js");
  const { reviewerDemoCredentials } = await import("../cloud/src/env.js");

  const db = new MemoryD1();
  const env = {
    DB: db as unknown as D1Database,
    CACHE_KV: memoryKv(),
    AI: {} as Ai,
    SESSION_SECRET: "unit-test-secret",
    PUBLIC_BASE_URL: "https://pamcp.example",
  } as import("../cloud/src/env.js").CloudEnv;

  // 1) Reviewer demo account auto-provisions on login without manual sign-up or 2FA
  const demo = reviewerDemoCredentials(env);
  const demoLogin = await handleAuthRoutes(
    new Request("https://pamcp.example/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: demo.email, password: demo.password }),
    }),
    env,
    "/api/auth/login",
  );
  assert.ok(demoLogin);
  assert.equal(demoLogin!.status, 200);
  const demoUser = (await demoLogin!.json()) as { user: { email: string; display_name: string } };
  assert.equal(demoUser.user.email, demo.email);

  // 2) MCP tools/list returns title + readOnlyHint/destructiveHint/openWorldHint booleans
  const listRes = await handleMcpJsonRpc(
    env,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    undefined,
    "router",
  );
  const listedTools = (
    listRes?.result as {
      tools: Array<{
        name: string;
        title?: string;
        annotations?: {
          title?: string;
          readOnlyHint?: boolean;
          destructiveHint?: boolean;
          openWorldHint?: boolean;
        };
      }>;
    }
  ).tools;
  assert.equal(listedTools.length, 3);
  for (const t of listedTools) {
    assert.ok(t.title && t.title.length > 0, `brak title w ${t.name}`);
    assert.ok(t.annotations?.title && t.annotations.title.length > 0, `brak annotations.title w ${t.name}`);
    assert.equal(t.annotations?.readOnlyHint, true);
    assert.equal(t.annotations?.destructiveHint, false);
    assert.equal(t.annotations?.openWorldHint, true);
  }

  // 2b) /.well-known/mcp.json returns single unified MCP Server Card with 3 tools
  const mcpCardRes = await handleMcpRoutes(
    new Request("https://pamcp.example/.well-known/mcp.json"),
    env,
    "/.well-known/mcp.json",
  );
  assert.equal(mcpCardRes?.status, 200);
  const mcpCard = (await mcpCardRes!.json()) as {
    remotes: Array<{ url: string }>;
    tools: Array<{ name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }>;
  };
  assert.equal(mcpCard.remotes.length, 1);
  assert.equal(mcpCard.remotes[0].url, "https://pamcp.example/mcp");
  assert.equal(mcpCard.tools.length, 3);

  // 3) /.well-known/ai-plugin.json and /api/directory-metadata comply with naming & contact rules
  const pluginRes = await handleMcpRoutes(
    new Request("https://pamcp.example/.well-known/ai-plugin.json"),
    env,
    "/.well-known/ai-plugin.json",
  );
  assert.equal(pluginRes?.status, 200);
  const pluginJson = (await pluginRes!.json()) as {
    name_for_human: string;
    name_for_model: string;
    contact_email: string;
  };
  assert.equal(pluginJson.name_for_human, "Polish Academic");
  assert.equal(pluginJson.name_for_model, "polish_academic");
  assert.equal(pluginJson.contact_email, "artur@sendyka.dev");

  const metaRes = await handleMcpRoutes(
    new Request("https://pamcp.example/api/directory-metadata"),
    env,
    "/api/directory-metadata",
  );
  assert.equal(metaRes?.status, 200);
  const metaJson = (await metaRes!.json()) as {
    name: string;
    slug: string;
    website_url: string;
    repository_url: string;
    example_prompts: string[];
    annotations_summary: { router_tool_count: number; granular_tool_count: number };
  };
  assert.equal(metaJson.name, "Polish Academic MCP");
  assert.equal(metaJson.slug, "polish-academic-mcp");
  assert.equal(metaJson.website_url, "https://pamcp.pl");
  assert.equal(metaJson.repository_url, "https://github.com/asterixix/polish-academic-mcp");
  assert.ok(metaJson.example_prompts.length >= 4);
  assert.equal(metaJson.annotations_summary.router_tool_count, 3);
  assert.equal(metaJson.annotations_summary.granular_tool_count, 116);
});

test("UI zawiera strony privacy/terms/connectors i logo w markupie", async () => {
  const { privacyPageHtml, termsPageHtml, connectorsPageHtml, renderAuthorizePage } = await import(
    "../cloud/src/ui.js"
  );
  assert.match(privacyPageHtml(), /Polityka prywatności/);
  assert.match(termsPageHtml(), /100 wywołań/);
  assert.match(connectorsPageHtml("https://pamcp.example"), /Claude/);
  assert.match(connectorsPageHtml("https://pamcp.example"), /ChatGPT/);
  assert.match(connectorsPageHtml("https://pamcp.example"), /Perplexity/);
  assert.match(
    renderAuthorizePage({
      appName: "Polish Academic MCP",
      clientName: "Claude",
      userName: "Ada",
      scope: "mcp",
      actionUrl: "https://pamcp.example/oauth/authorize?x=1",
      denyUrl: "https://claude.ai/denied",
    }),
    /icon-512\.png|logo\.jpg/,
  );
});

test("AI Search orchestrator eksportuje handler i domyślny model Haiku", () => {
  const source = readFileSync(resolve(root, "cloud/src/ai-search.ts"), "utf8");
  assert.match(source, /anthropic\/claude-haiku-5\.5/);
  assert.match(source, /handleAiSearchRoutes/);
  assert.match(source, /AI_SEARCH_ANON|aiSearchLimit/);
  assert.match(source, /callEdenAi|EDENAI_API_KEY|api\.edenai\.run/);
  assert.match(source, /extractRecordTargets|get_record/);
  const wrangler = readFileSync(resolve(root, "cloud/wrangler.jsonc"), "utf8");
  assert.match(wrangler, /PUBLIC_BASE_URL": "https:\/\/pamcp\.pl"/);
  assert.match(wrangler, /claude-haiku-5\.5/);
  assert.match(wrangler, /MCP_MONTHLY_LIMIT": "100"/);
  assert.match(wrangler, /AI_SEARCH_ANON_WEEKLY_LIMIT": "2"/);
  assert.match(wrangler, /AI_SEARCH_USER_WEEKLY_LIMIT": "5"/);
  assert.match(wrangler, /EDENAI_API_KEY/);
});
