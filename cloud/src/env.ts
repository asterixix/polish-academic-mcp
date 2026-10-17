import type { CacheStore } from "../../src/cache.js";
import type { Env as CoreEnv } from "../../src/types.js";

/** Cloudflare Worker bindings and secrets for the cloud platform. */
export interface CloudEnv {
  DB: D1Database;
  CACHE_KV: KVNamespace;
  AI: Ai;
  ASSETS?: Fetcher;

  APP_NAME?: string;
  PUBLIC_BASE_URL?: string;
  SESSION_SECRET?: string;

  /** Comma-separated user IDs with /admin access */
  ADMIN_UIDS?: string;
  /** Comma-separated emails with /admin access (fallback) */
  ADMIN_EMAILS?: string;

  MCP_MONTHLY_LIMIT?: string;
  AI_SEARCH_ANON_WEEKLY_LIMIT?: string;
  AI_SEARCH_USER_WEEKLY_LIMIT?: string;

  AI_MODEL?: string;
  AI_FALLBACK_MODEL?: string;
  AI_GATEWAY_URL?: string;
  /** Eden AI (OpenAI-compatible): https://api.edenai.run/v3/chat/completions */
  EDENAI_API_KEY?: string;
  EDENAI_API_BASE?: string;
  /** Eden AI Management API key (mgmt-eden-…) for usage monitoring */
  EDENAI_MANAGEMENT_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  CF_AIG_TOKEN?: string;
  /** Optional Cloudflare Analytics GraphQL */
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_WORKER_SCRIPT_NAME?: string;

  ORCID_CLIENT_ID?: string;
  ORCID_CLIENT_SECRET?: string;

  REVIEWER_DEMO_EMAIL?: string;
  REVIEWER_DEMO_PASSWORD?: string;

  BDL_CLIENT_ID?: string;
  PBN_APP_ID?: string;
  PBN_APP_TOKEN?: string;
  PBN_USER_TOKEN?: string;
}

export function wrapKv(ns: KVNamespace): CacheStore {
  return {
    async get(key: string): Promise<string | null> {
      return ns.get(key);
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
      await ns.put(key, value, {
        expirationTtl:
          typeof options?.expirationTtl === "number" && options.expirationTtl >= 60
            ? Math.floor(options.expirationTtl)
            : undefined,
      });
    },
    async delete(key: string): Promise<void> {
      await ns.delete(key);
    },
  };
}

export function toCoreEnv(env: CloudEnv): CoreEnv {
  return {
    CACHE_KV: wrapKv(env.CACHE_KV),
    BDL_CLIENT_ID: env.BDL_CLIENT_ID,
    PBN_APP_ID: env.PBN_APP_ID,
    PBN_APP_TOKEN: env.PBN_APP_TOKEN,
    PBN_USER_TOKEN: env.PBN_USER_TOKEN,
  };
}

export function sessionSecret(env: CloudEnv): string {
  return (env.SESSION_SECRET ?? "dev-only-change-me-polish-academic-mcp").trim();
}

export function intVar(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function appName(env: CloudEnv): string {
  return (env.APP_NAME ?? "Polish Academic").trim() || "Polish Academic";
}

/**
 * Reviewer demo account — only from secrets / .dev.vars.
 * No hardcoded password in source (safe for public GitHub).
 */
export function reviewerDemoCredentials(env: CloudEnv): { email: string; password: string } | null {
  const email = (env.REVIEWER_DEMO_EMAIL ?? "").trim().toLowerCase();
  const password = (env.REVIEWER_DEMO_PASSWORD ?? "").trim();
  if (!email || !password) return null;
  return { email, password };
}

export function publicOrigin(request: Request, env: CloudEnv): string {
  if (env.PUBLIC_BASE_URL?.trim()) {
    return env.PUBLIC_BASE_URL.trim().replace(/\/$/, "");
  }
  const url = new URL(request.url);
  return url.origin;
}
