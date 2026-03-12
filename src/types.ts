export interface Env {
  CACHE_KV: KVNamespace;
  RATE_LIMIT_KV: KVNamespace;
  /** Honeycomb API key — set via: wrangler secret put HONEYCOMB_API_KEY */
  HONEYCOMB_API_KEY: string;
}
