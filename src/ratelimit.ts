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

/**
 * Validate an optional JWT that allows bypassing the rate limiter.
 *
 * Expected transport:
 *   Authorization: Bearer <jwt>
 *
 * Expected claims:
 *   - exp (optional, epoch seconds)
 *   - nbf (optional, epoch seconds)
 *   - rl_bypass = true  OR  scope includes "ratelimit:bypass"
 *
 * Signature:
 *   - HS256 using RATE_LIMIT_BYPASS_JWT_SECRET
 */
export async function hasRateLimitBypass(
  request: Request,
  jwtSecret?: string,
): Promise<boolean> {
  if (!jwtSecret) return false;

  const authHeader = request.headers.get("Authorization") ?? request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return false;

  // Backwards-compatible/opaque mode:
  // If the bearer token is exactly the configured secret, allow bypass.
  // This makes it easier to use a pre-shared token without minting a JWT.
  if (token === jwtSecret) return true;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [encodedHeader, encodedPayload, encodedSig] = parts;

  try {
    const header = decodeJwtPart(encodedHeader) as { alg?: string; typ?: string };
    if (header.alg !== "HS256") return false;

    const payload = decodeJwtPart(encodedPayload) as {
      exp?: number;
      nbf?: number;
      rl_bypass?: boolean;
      scope?: string | string[];
    };

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && nowSec >= payload.exp) return false;
    if (typeof payload.nbf === "number" && nowSec < payload.nbf) return false;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const isValidSig = await crypto.subtle.verify(
      "HMAC",
      key,
      base64urlDecode(encodedSig),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
    if (!isValidSig) return false;

    if (payload.rl_bypass === true) return true;

    if (Array.isArray(payload.scope)) {
      return payload.scope.includes("ratelimit:bypass");
    }
    if (typeof payload.scope === "string") {
      return payload.scope.split(/\s+/).includes("ratelimit:bypass");
    }
    return false;
  } catch {
    return false;
  }
}

function decodeJwtPart(part: string): unknown {
  const bytes = base64urlDecode(part);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as unknown;
}

function base64urlDecode(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const b64 = normalized + padding;
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
