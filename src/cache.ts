/**
 * Fetch a URL with cache-backed caching and structured error reporting.
 *
 * Cache writes are fire-and-forget so callers always get fresh data on a miss.
 * On HTTP errors, includes full response headers and body (truncated) for debugging.
 */
export interface CacheError extends Error {
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  responseBody?: string;
}

export interface CacheStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete?(key: string): Promise<void>;
}

interface CacheEntry {
  value: string;
  expiresAtMs?: number;
}

class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>();

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs !== undefined && entry.expiresAtMs <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAtMs =
      typeof options?.expirationTtl === "number" && Number.isFinite(options.expirationTtl)
        ? Date.now() + Math.max(1, Math.floor(options.expirationTtl)) * 1000
        : undefined;
    this.entries.set(key, { value, expiresAtMs });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

export function createMemoryCacheStore(): CacheStore {
  return new MemoryCacheStore();
}

export async function cachedFetch(
  kv: CacheStore,
  cacheKey: string,
  url: string,
  options: RequestInit = {},
  ttlSeconds = 3600,
): Promise<string> {
  const cached = await kv.get(cacheKey);
  if (cached !== null) return cached;

  let response: Response | null = null;
  try {
    response = await fetch(url, options);
  } catch (err) {
    // Network error (connection refused, timeout, DNS failure, etc.)
    const networkErr = err instanceof Error ? err : new Error(String(err));
    const customErr = new Error(`Network error fetching ${url}: ${networkErr.message}`) as unknown as CacheError;
    (customErr as any).status = 0;
    (customErr as any).statusText = "NetworkError";
    (customErr as any).url = url;
    (customErr as any).headers = {};
    throw customErr;
  }

  if (!response.ok) {
    // Collect headers for debugging
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // Collect response body (truncated to 1KB for error reporting)
    let responseBody: string | undefined;
    try {
      responseBody = (await response.text()).slice(0, 1024);
    } catch {
      responseBody = "[unable to read response body]";
    }

    const customErr = new Error(
      `HTTP ${response.status} ${response.statusText} fetching ${url}`,
    ) as unknown as CacheError;
    (customErr as any).status = response.status;
    (customErr as any).statusText = response.statusText;
    (customErr as any).url = url;
    (customErr as any).headers = headers;
    (customErr as any).responseBody = responseBody;

    throw customErr;
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
export function makeCacheKey(prefix: string, params: Record<string, unknown>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  return `${prefix}:${JSON.stringify(Object.fromEntries(entries))}`;
}
