/**
 * Fetch a URL with KV-backed caching.
 *
 * Cache writes are fire-and-forget to avoid burning the 1,000 writes/day free
 * tier budget on errors. The caller always gets fresh data on a cache miss.
 */
export async function cachedFetch(
  kv: KVNamespace,
  cacheKey: string,
  url: string,
  options: RequestInit = {},
  ttlSeconds = 3600,
): Promise<string> {
  const cached = await kv.get(cacheKey);
  if (cached !== null) return cached;

  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} — ${url}`);
  }

  const text = await response.text();

  // Non-blocking write — don't let a KV failure abort the response.
  kv.put(cacheKey, text, { expirationTtl: ttlSeconds }).catch(() => {});

  return text;
}

/**
 * Build a deterministic, sorted cache key from a prefix and a params object.
 * Undefined / null values are excluded so optional params don't fragment keys.
 */
export function makeCacheKey(
  prefix: string,
  params: Record<string, unknown>,
): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  return `${prefix}:${JSON.stringify(Object.fromEntries(entries))}`;
}
