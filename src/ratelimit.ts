/**
 * Sliding-window rate limiter backed by Cloudflare KV.
 *
 * Each client IP gets a KV entry containing an array of Unix-millisecond
 * timestamps for tool calls made within the last hour.  On every request we:
 *   1. Read the current array.
 *   2. Drop timestamps older than 1 hour.
 *   3. Reject if the remaining count >= limit.
 *   4. Append the current timestamp and write back (TTL = window + 60 s).
 *
 * KV write budget: 1 write per allowed tool call.
 * Rejected requests never write, so they don't consume the daily budget.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const WINDOW_SECONDS = 3600;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the oldest request in the window expires. */
  resetInSeconds: number;
}

export async function checkRateLimit(
  kv: KVNamespace,
  clientId: string,
  limit = 10,
): Promise<RateLimitResult> {
  const key = `rl:${clientId}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const stored = await kv.get(key);
  let timestamps: number[] = stored ? (JSON.parse(stored) as number[]) : [];

  // Evict timestamps outside the rolling window.
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= limit) {
    const oldest = Math.min(...timestamps);
    const resetInSeconds = Math.ceil((oldest + WINDOW_MS - now) / 1000);
    return { allowed: false, remaining: 0, resetInSeconds };
  }

  timestamps.push(now);
  await kv.put(key, JSON.stringify(timestamps), {
    expirationTtl: WINDOW_SECONDS + 60,
  });

  return {
    allowed: true,
    remaining: limit - timestamps.length,
    resetInSeconds: WINDOW_SECONDS,
  };
}

/**
 * Resolve a stable client identifier from the incoming request.
 * CF-Connecting-IP is injected by Cloudflare and cannot be spoofed by clients.
 */
export function getClientId(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ??
    "unknown"
  );
}
