# AGENTS.md — AI Coding Agent Reference

> This file is written for AI coding agents (GitHub Copilot, Claude, Cursor, etc.).
> It describes the codebase architecture, conventions, and step-by-step instructions
> for extending the server so that agents can work autonomously without guessing.

---

## Project overview

**polish-academic-mcp** is a local MCP server (Model Context Protocol) that exposes
**85 tools** letting any MCP-compatible LLM (Claude, GPT-4, etc.) search Polish
academic, public, and cultural databases. It runs as a local Node.js process
communicating via **stdio**, distributed exclusively through npm as the
`polish-academic-mcp` package. All databases offer **unauthenticated read access**
except for the three PBN tools (require `PBN_APP_ID` + `PBN_APP_TOKEN`).

This file describes the v1.1.0 architecture (npm-only, local stdio). Historical
sections that reference Cloudflare Workers, MCPB bundles, or research evaluation
apparatus are obsolete and have been removed; if you see references to those
in the wild, treat them as out of date.

For the complete tool catalogue (85 entries with Polish descriptions) see
`README.md`. For per-client configuration snippets see `docs/CLIENTS.md`.
For AI agents that need to configure the server themselves see
`docs/AGENT-GUIDE.md`.

---

## File map

```
package.json           npm-only distribution; entry "bin": { "polish-academic-mcp": "dist/index.js" }
                       engines: "node": ">=18"; no MCPB; no eval; no telemetry deps

src/
├── index.ts           Stdio entry: --help, --version, MCP dispatch (creates fresh McpServer per request)
├── server.ts          createServer(env) — registers all 85 tools
├── cache.ts           in-process TTL cache + 30s timeout + single retry on transient errors
├── tool-error-handling.ts   structured error classification without OTel
├── types.ts           Env interface (BDL_CLIENT_ID, PBN_APP_ID, PBN_APP_TOKEN optional)
└── tools/             33 files, one per database / source
    ├── biblioteka-nauki.ts  → bn_search_publications, bn_search_articles, bn_get_article
    ├── ruj.ts               → ruj_search, ruj_get_item
    ├── agh.ts               → agh_search, agh_get_item
    ├── amu.ts               → amu_search, amu_get_item
    ├── uafm.ts              → uafm_search, uafm_get_item   (currently: HTTP 404 from eRIKA)
    ├── icm.ts               → icm_search, icm_get_item
    ├── rodbuk.ts            → rodbuk_search
    ├── repod.ts             → repod_search, repod_get_dataset
    ├── dane.ts              → dane_search, dane_get_dataset
    ├── polon.ts             → polon_search
    ├── pbn.ts               → pbn_search_publications, pbn_search_persons, pbn_get_publication
    ├── bdl.ts               → bdl_search_subjects, bdl_search_variables, bdl_search_units,
    │                          bdl_get_variable, bdl_get_data_by_variable, bdl_get_data_by_unit
    ├── imgw.ts              → imgw_synop, imgw_hydro, imgw_meteo, imgw_warnings
    ├── pkn.ts               → pkn_search
    ├── wiedza.ts            → wiedza_search_norms, wiedza_get_standard
    ├── blz.ts               → blz_search, blz_get_listing, blz_listing_categories
    ├── baztol.ts            → baztol_search, baztol_browse_domain, baztol_get_resource
    ├── nac.ts               → nac_news_rss, nac_site_search, nac_get_post, nac_get_page
    ├── sum.ts               → sum_aleph_find, sum_aleph_present
    ├── ludzie-nauki.ts      → ludzie_search, ludzie_semantic_search, ludzie_get_scientist
    ├── pauart.ts            → pauart_search, pauart_get_artwork
    ├── isap.ts              → isap_search_acts, isap_get_act
    ├── sejm-bs.ts           → bs_sejm_search, bs_sejm_get_item
    ├── saos.ts              → saos_search_judgments, saos_get_judgment, saos_dump_services,
    │                          saos_dump_common_courts, saos_dump_sc_chambers,
    │                          saos_dump_judgments, saos_dump_enrichments
    ├── wolne-lektury.ts     → wolnelektury_list_taxonomy, wolnelektury_filter_books,
    │                          wolnelektury_get_book, wolnelektury_get_collection
    ├── ninateka.ts          → ninateka_search, ninateka_get_vod
    ├── gapla.ts             → gapla_search, gapla_get_poster
    ├── fototeka.ts          → fototeka_search, fototeka_get_photo
    ├── filmpolski.ts        → filmpolski_search, filmpolski_get_record
    ├── fototekaslaska.ts    → fototekaslaska_search, fototekaslaska_get_gallery
    ├── filmoteka-repo.ts    → fn_repo_search, fn_repo_get_node, fn_repo_film_index, fn_repo_browse_kind
    ├── rcin.ts              → rcin_search, rcin_get_record
    └── dokumenty-slaska.ts  → dokumenty_slaska_get_page, dokumenty_slaska_medieval_catalog

tests/
├── package-contract.test.ts   version, --help, --version, npm-only, no MCPB / eval / telemetry
├── mcp-contract.test.ts       85 tool IDs stable, all tool + parameter descriptions in Polish
└── fetch-policy.test.ts       30s timeout, single retry on transient, no retry on 4xx

scripts/
└── smoke-tools.ts             live smoke (82 tools + 5 dynamic search→get pairs)

tsconfig.json          TypeScript config (strict, module: ES2022, target: ES2022)
docs/
├── CLIENTS.md         per-client MCP configuration snippets
├── AGENT-GUIDE.md     prompt for AI agents configuring the server
└── plans/             implementation plans
```

---

## Architecture decisions (HISTORICAL — see v1.1.0 note at top)

> **These sections describe the pre-v1.1.0 Cloudflare Workers / MCPB / eval-pipeline
> architecture that no longer ships with `polish-academic-mcp`. They are kept as a
> historical reference only. Do not change the codebase to match them.**

### 1. Stateless — one `McpServer` instance per request

`createServer(env)` in `server.ts` is called **inside** the `fetch` handler so that every
HTTP request gets a fresh `McpServer`. This is mandatory since SDK v1.26.0: reusing a
global instance leaks state across clients.

```typescript
// index.ts — correct pattern
export default {
  async fetch(request, env, ctx) {
    const handler = createMcpHandler(createServer(env)); // fresh each time
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

### 5. RQ3/RQ4 hardening: normalized fields + optional PII minimization

Recent tool updates add two important behaviors used by the evaluation harness:

- **Normalized Dataverse search output** in `rodbuk_search` and `repod_search`.
  Both tools now return a normalized item shape containing stable keys used by
  evaluation (`title`, `author`, `date`, `doi`) while preserving source fields
  in `source_raw`.
- **Optional privacy mode** for sensitive use cases:
  - `ruj_search` supports `minimize_pii: boolean` (default `false`) and removes
    direct personal fields (`authors`, `affiliation`) plus redacts common PII patterns.
  - `bn_search_articles` supports `minimize_pii: boolean` (default `false`) and
    redacts common PII patterns in XML (`ORCID`, email, PESEL-like, phone-like).
- **Robust retrieval fallback** in `bn_search_articles`: when a restrictive OAI set
  returns `noRecordsMatch`, the tool retries once without `set` (same date range and
  metadata format) to improve practical recall in evaluation scenarios.

---

## Eval export to Nextcloud WebDAV

When `EVAL_WEBDAV_ENABLED=true`, the Worker uploads one JSON file for every
incoming MCP JSON-RPC request with `method: "tools/call"`.

Uploaded record includes:
- `request.toolName` and `request.arguments`
- raw MCP response body (truncated to `EVAL_WEBDAV_MAX_JSON_BYTES`)
- `_span` span attributes (attached by `src/tracing.ts` wrappers)
- `rqEval` — computed RQ1–RQ4 scores/report when the tool call arguments match
  an eval test case from `scripts/eval/test-cases.ts`

Configuration is done via `wrangler.jsonc` vars:
`NEXTCLOUD_WEBDAV_BASE_URL`, `NEXTCLOUD_WEBDAV_USERNAME`, `NEXTCLOUD_WEBDAV_PASSWORD`,
`NEXTCLOUD_WEBDAV_PATH_PREFIX`, and `EVAL_WEBDAV_MAX_JSON_BYTES`.

RQ metrics are computed server-side using the same metric functions as the
local evaluator (`scripts/eval/metrics.ts`).

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
    "mydb_search", // snake_case: prefix = short db name
    "One-paragraph description that tells the LLM WHEN to call this tool," +
      " what arguments it expects, and what shape the response has.",
    {
      query: z.string().describe("Search terms"),
      page: z.number().int().min(1).default(1).describe("Page number (1-based)"),
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
};
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
npm run dev          # starts the stdio MCP server from src/index.ts
```

The package uses an in-memory cache store in local development, so the server runs without Cloudflare bindings.

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest
# Connect the inspector to the local `npm run dev` process
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

## What NOT to do (CURRENT for v1.1.0)

- Do not parse XML or large JSON inside tool handlers — return raw text from the
  source API to the LLM and let the model interpret it.
- Do not share a single `McpServer` instance across requests — `createServer(env)`
  is called per-request in `src/index.ts`; SDK v1.26+ leaks state otherwise.
- Do not bump `@modelcontextprotocol/sdk` without checking the bundled SDK version
  in `agents` (npm deduplicates; private-field type conflicts are otherwise
  invisible until CI breaks).
- Do not `npm install -g polish-academic-mcp` or recommend global install — this
  package is designed to be invoked through `npx -y polish-academic-mcp` so each
  MCP client can pin its own version.
- Do not re-introduce Cloudflare / MCPB / research-evaluation / telemetry
  dependencies. v1.1.0 is local stdio + npm-only by design.
- Do not commit secrets. The only optional secrets are `PBN_APP_ID`,
  `PBN_APP_TOKEN`, `BDL_CLIENT_ID`; they live in the user's environment, never in
  the repo.
