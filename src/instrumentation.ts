/**
 * OTel instrumentation bootstrap for the Cloudflare Workers runtime.
 * Uses @microlabs/otel-cf-workers — the only OTel SDK that works in V8 isolates.
 *
 * Approach B from the observability spec:
 *   - Sends OTLP traces to Honeycomb via the otel-cf-workers auto-wrapper.
 *   - Every fetch() call becomes the root span; tool spans are children.
 *   - HONEYCOMB_API_KEY must be stored as a Wrangler secret (never hardcoded).
 */

import { instrument, type ResolveConfigFn } from "@microlabs/otel-cf-workers";
import type { Env } from "./types.js";

/**
 * OTel configuration factory.
 * Called once per Worker startup — receives env bindings so secrets are available.
 */
export const resolveConfig: ResolveConfigFn = (env: Env) => ({
  exporter: {
    url: "https://api.honeycomb.io/v1/traces",
    headers: {
      "x-honeycomb-team": env.HONEYCOMB_API_KEY,
      "x-honeycomb-dataset": "polish-academic-mcp",
    },
  },
  service: {
    name: "polish-academic-mcp",
    version: "1.0.0",
  },
  // Include W3C trace context in outgoing fetch() calls for distributed tracing
  fetch: {
    includeTraceContext: true,
  },
});

/**
 * Wrap a handler object with OTel auto-instrumentation.
 * Every incoming request becomes a root span; tool spans nest beneath it.
 *
 * Usage (in index.ts):
 *   export default wrapWithOtel(handler);
 */
export function wrapWithOtel<H>(handler: H): H {
  return instrument(handler as never, resolveConfig) as H;
}
