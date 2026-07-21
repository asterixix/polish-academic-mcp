/**
 * Fetch a URL with cache-backed caching and structured error reporting.
 *
 * Cache writes are fire-and-forget so callers always get fresh data on a miss.
 * On HTTP errors, includes full response headers (credentials redacted) and a
 * truncated body for debugging.
 *
 * Network policy (applies to every outbound request):
 *   - Hard timeout of 30 seconds via AbortSignal.
 *   - Single automatic retry on transient network errors only
 *     (ENETUNREACH, ECONNRESET, fetch TypeError, our own timeout AbortError).
 *   - HTTP 4xx is never retried.
 *   - HTTP 5xx is never retried by the transport layer (it is the upstream's
 *     contract; callers decide whether to fall back to cached data).
 *   - Cache misses always hit the network; transient errors surface to callers
 *     with a typed CacheError so tool code can decide what to do.
 *
 * Headers exposed via CacheError are redacted (Authorization,
 * Proxy-Authorization, Cookie, Set-Cookie) so credentials never leak into
 * tool responses or logs.
 */

export interface CacheError extends Error {
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  responseBody?: string;
}

// Headers that must never appear in tool-facing error context.
const REDACTED_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
]);

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  for (const key of Object.keys(headers)) {
    if (REDACTED_HEADERS.has(key.toLowerCase())) {
      headers[key] = "[redacted]";
    }
  }
  return headers;
}

// Network errors that mean "the wire glitched, try once more".
const TRANSIENT_NET_ERROR_CODES = new Set(["ENETUNREACH", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"]);

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Our own 30s timeout AbortError, propagated by globalThis.fetch.
  if (err.name === "AbortError" && err.message.toLowerCase().includes("abort")) return true;
  const code = (err as NodeJS.ErrnoException).code;
  if (typeof code === "string" && TRANSIENT_NET_ERROR_CODES.has(code)) return true;
  // globalThis.fetch wraps low-level failures in a TypeError.
  if (err instanceof TypeError) return true;
  return false;
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

// ponytail: 30s hard cap is a single shared constant. Bump when the slowest
// public tool (today: PBN search ~12s) outgrows it; raise-and-retry is the
// standard mitigation.
export const FETCH_TIMEOUT_MS = 30_000;
const FETCH_MAX_ATTEMPTS = 2;

function buildTimeoutSignal(existing: AbortSignal | null | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  if (!existing) return timeout;
  // Combine: either signal aborts the request.
  return AbortSignal.any([timeout, existing]);
}

function buildNetworkError(url: string, networkErr: Error): CacheError {
  const customErr = new Error(`Network error fetching ${url}: ${networkErr.message}`) as CacheError;
  customErr.status = 0;
  customErr.statusText = "NetworkError";
  customErr.url = url;
  customErr.headers = {};
  return customErr;
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
  let lastTransient: Error | null = null;

  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt += 1) {
    const signal = buildTimeoutSignal(options.signal ?? null);
    const attemptOptions = { ...options, signal };
    try {
      response = await fetch(url, attemptOptions);
      lastTransient = null;
      break;
    } catch (err) {
      const networkErr = err instanceof Error ? err : new Error(String(err));
      if (isTransientNetworkError(networkErr) && attempt < FETCH_MAX_ATTEMPTS) {
        lastTransient = networkErr;
        continue;
      }
      // Non-transient, or retries exhausted: surface the typed error.
      throw buildNetworkError(url, lastTransient ?? networkErr);
    }
  }

  if (!response) {
    // Defensive: the loop above must either resolve or throw.
    throw buildNetworkError(url, lastTransient ?? new Error("fetch returned no response"));
  }

  if (!response.ok) {
    // Collect headers for debugging (credentials redacted).
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    redactHeaders(headers);

    // Collect response body (truncated to 1KB for error reporting)
    let responseBody: string | undefined;
    try {
      responseBody = (await response.text()).slice(0, 1024);
    } catch {
      responseBody = "[unable to read response body]";
    }

    const customErr = new Error(
      `HTTP ${response.status} ${response.statusText} fetching ${url}`,
    ) as CacheError;
    customErr.status = response.status;
    customErr.statusText = response.statusText;
    customErr.url = url;
    customErr.headers = headers;
    customErr.responseBody = responseBody;

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