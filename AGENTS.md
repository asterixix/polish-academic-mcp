# AGENTS.md — AI Coding Agent Reference

> This file is written for AI coding agents (GitHub Copilot, Claude, Cursor, etc.).
> It describes the codebase architecture, conventions, and step-by-step instructions
> for extending the server so that agents can work autonomously without guessing.

---

## Project overview

**polish-academic-mcp** is a stateless Remote MCP Server running on Cloudflare Workers
(free tier). It exposes nine tools that let any MCP-compatible LLM (Claude, GPT-4, etc.)
search five Polish academic databases:

| Tool name | Database | Protocol |
|---|---|---|
| `bn_search_articles` | Biblioteka Nauki | OAI-PMH (XML) |
| `bn_get_article` | Biblioteka Nauki | OAI-PMH (XML) |
| `ruj_search` | RUJ (Jagiellonian Univ.) | DSpace 7 REST (HAL+JSON) |
| `ruj_get_item` | RUJ | DSpace 7 REST (HAL+JSON) |
| `rodbuk_search` | RODBuK | Dataverse REST (JSON) |
| `repod_search` | RePOD | Dataverse REST (JSON) |
| `repod_get_dataset` | RePOD | Dataverse REST (JSON) |
| `dane_search` | dane.gov.pl | Custom REST v1.4 (JSON) |
| `dane_get_dataset` | dane.gov.pl | Custom REST v1.4 (JSON) |

All five databases offer **unauthenticated read access** — no external API keys.

---

## File map

```
src/
├── index.ts           Worker entry: rate-limit gate → MCP dispatch
├── types.ts           Env interface (CACHE_KV, RATE_LIMIT_KV KV bindings)
├── cache.ts           cachedFetch(env, key, url, ttl, headers?) + makeCacheKey()
├── ratelimit.ts       sliding-window KV rate limiter: checkRateLimit() + getClientId()
├── server.ts          createServer(env) — registers all tools, returns McpServer
└── tools/
    ├── biblioteka-nauki.ts  → bn_search_articles, bn_get_article
    ├── ruj.ts               → ruj_search, ruj_get_item
    ├── rodbuk.ts            → rodbuk_search
    ├── repod.ts             → repod_search, repod_get_dataset
    └── dane.ts              → dane_search, dane_get_dataset

wrangler.jsonc         Cloudflare Workers config (KV namespace bindings)
tsconfig.json          TypeScript config (strict, module: ES2022, target: ES2022)
package.json           Dependencies pinned: @modelcontextprotocol/sdk@1.26.0
```

---

## Architecture decisions (do not change these without understanding why)

### 1. Stateless — one `McpServer` instance per request

`createServer(env)` in `server.ts` is called **inside** the `fetch` handler so that every
HTTP request gets a fresh `McpServer`. This is mandatory since SDK v1.26.0: reusing a
global instance leaks state across clients.

```typescript
// index.ts — correct pattern
export default {
  async fetch(request, env, ctx) {
    const handler = createMcpHandler(createServer(env));   // fresh each time
    return handler(request, env, ctx);
  },
};
```

### 2. Rate limiting before MCP dispatch

Only `tools/call` JSON-RPC requests are counted. The body is cloned before reading so
the stream is still available for the MCP handler. Rejected requests never write to KV.

Limit: **10 tool calls per hour per client IP** (CF-Connecting-IP header).

### 3. `cachedFetch()` wraps every external API call

Signature:
```typescript
cachedFetch(
  env: Env,
  cacheKey: string,
  url: string,
  ttlSeconds: number,
  fetchOptions?: RequestInit,
): Promise<string>
```

Cache misses execute `fetch()`, store the raw response text in `CACHE_KV` with TTL, and
return the text. Writes are fire-and-forget (`ctx.waitUntil` is **not** available in
tool handlers, so writes are detached with `.catch(() => {})`).

TTL conventions:
- `86_400` (24 h) for academic repositories (RODBuK, RePOD, RUJ, Biblioteka Nauki)
- `3_600` (1 h) for dane.gov.pl (frequently updated government data)

### 4. SDK pinning

`@modelcontextprotocol/sdk` is pinned to **exactly `1.26.0`** in `package.json` to match
the version bundled inside the `agents` package. npm deduplicates to one copy and
eliminates the private-field type conflict. Do **not** bump this without also checking
the `agents` package's bundled SDK version.

---

## How to add a new database tool

### Step 1 — Create `src/tools/my-database.ts`

Follow this template exactly:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { cachedFetch, makeCacheKey } from "../cache.js";

const API_BASE = "https://api.example.com";
const CACHE_TTL = 86_400; // seconds

export function registerMyDatabaseTools(server: McpServer, env: Env): void {
  server.tool(
    "mydb_search",                // snake_case: prefix = short db name
    "One-paragraph description that tells the LLM WHEN to call this tool," +
    " what arguments it expects, and what shape the response has.",
    {
      query: z.string().describe("Search terms"),
      page:  z.number().int().min(1).default(1).describe("Page number (1-based)"),
    },
    async ({ query, page }) => {
      try {
        const url = `${API_BASE}/search?q=${encodeURIComponent(query)}&page=${page}`;
        const key = makeCacheKey("mydb_search", { query, page });
        const text = await cachedFetch(env, key, url, CACHE_TTL);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    },
  );
}
```

Rules:
- Tool name must be globally unique and follow `{prefix}_{action}` naming.
- Every parameter must have a `.describe()` string — this is the LLM's only hint.
- Always return raw API text (JSON or XML) rather than parsing it — saves CPU.
- Always wrap the handler body in `try/catch` returning `isError: true` on failure.
- Use `makeCacheKey(toolName, paramsObject)` to build deterministic cache keys.

### Step 2 — Register in `src/server.ts`

```typescript
// At top of file — add import
import { registerMyDatabaseTools } from "./tools/my-database.js";

// Inside createServer(), after existing register calls
registerMyDatabaseTools(server, env);
```

### Step 3 — Verify TypeScript compiles

```bash
npx tsc --noEmit
```

No other files need changing.

---

## TypeScript conventions

- `strict: true` everywhere — no implicit `any`, no unused variables.
- Import paths always end in `.js` (required for ESM Worker output).
- `Env` interface lives in `types.ts` — add new KV/secret bindings there and in
  `wrangler.jsonc`.
- Zod schemas are defined inline; do not extract them to separate files unless shared
  across two or more tools.
- No classes except where required by the SDK. Prefer plain functions.

---

## Error handling pattern

All tool handlers must use this pattern:

```typescript
async (params) => {
  try {
    // ... business logic ...
    return { content: [{ type: "text", text: responseText }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error calling <tool>: ${msg}` }],
      isError: true,
    };
  }
}
```

Returning `isError: true` inside the result (not throwing) allows the LLM to see and
potentially handle the error message. Throwing from a tool handler causes a JSON-RPC
protocol error that is opaque to the LLM.

---

## `wrangler.jsonc` changes needed for a new KV namespace

If a new tool requires its own KV namespace (rare — prefer reusing `CACHE_KV`):

1. Add it to `wrangler.jsonc` under `kv_namespaces`.
2. Add the binding name to the `Env` interface in `src/types.ts`.
3. Document the one-time `wrangler kv namespace create` command in `README.md`.

---

## Local development

```bash
npm run dev          # wrangler dev — serves at http://localhost:8788/mcp
```

The KV preview IDs in `wrangler.jsonc` point to `"aaa..."` / `"bbb..."` placeholders.
Wrangler's dev mode uses in-memory KV for preview namespaces, so this works locally.

Test with MCP Inspector:
```bash
npx @modelcontextprotocol/inspector@latest
# Open http://localhost:5173, connect to http://localhost:8788/mcp
```

## Deployment

See `README.md` (Polish) or the GitHub Actions workflow at
`.github/workflows/deploy.yml` for full deployment instructions.

Quick reference:
```bash
npx wrangler kv namespace create "CACHE_KV"      # copy ID → wrangler.jsonc
npx wrangler kv namespace create "RATE_LIMIT_KV" # copy ID → wrangler.jsonc
npm run deploy
```

---

## What NOT to do

- Do not add `ctx.waitUntil()` calls — `ExecutionContext` is not forwarded into tool
  handlers in the stateless `createMcpHandler` path.
- Do not parse XML or large JSON in the Worker — return raw text to the LLM.
- Do not share a single `McpServer` instance across requests.
- Do not bump `@modelcontextprotocol/sdk` without checking `agents` compatibility.
- Do not use `console.log` for debugging in production paths — use `wrangler tail` for
  live log streaming, and emit only meaningful warnings/errors.
