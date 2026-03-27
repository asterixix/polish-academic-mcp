import type { Env } from "./types.js";

/** Stable kid for JWKS when using RS256. */
export const OAUTH_JWT_KID = "oauth-rs256-1";

let cachedRsaPrivateKey: Promise<CryptoKey | null> | undefined;

function base64urlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecodeToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const b64 = normalized + padding;
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function pemPkcs8ToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

async function importRsaPrivateFromPem(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pemPkcs8ToArrayBuffer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"],
  );
}

export async function getOauthRsaPrivateKey(env: Env): Promise<CryptoKey | null> {
  const pem = env.OAUTH_RSA_PRIVATE_KEY_PKCS8_PEM?.trim();
  if (!pem) return null;
  if (!cachedRsaPrivateKey) {
    cachedRsaPrivateKey = importRsaPrivateFromPem(pem).catch(() => null);
  }
  return cachedRsaPrivateKey;
}

/** Public JWKS document derived from the configured private key (omit if not configured). */
export async function getOauthJwksBody(env: Env): Promise<{ keys: JsonWebKey[] } | null> {
  const rsa = await getOauthRsaPrivateKey(env);
  if (!rsa) return null;
  const jwk = (await crypto.subtle.exportKey("jwk", rsa)) as JsonWebKey;
  if (jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") return null;
  const pub = {
    kty: "RSA",
    n: jwk.n,
    e: jwk.e,
    kid: OAUTH_JWT_KID,
    use: "sig",
    alg: "RS256",
  } as JsonWebKey;
  return { keys: [pub] };
}

async function importRsaPublicVerifyKeyFromPrivate(privateKey: CryptoKey): Promise<CryptoKey> {
  const jwk = (await crypto.subtle.exportKey("jwk", privateKey)) as JsonWebKey;
  const pub: JsonWebKey = {
    kty: "RSA",
    n: jwk.n,
    e: jwk.e,
    alg: "RS256",
  };
  return crypto.subtle.importKey(
    "jwk",
    pub,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function signJwtHs256(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = base64urlEncodeBytes(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = base64urlEncodeBytes(new TextEncoder().encode(JSON.stringify(payload)));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(`${encHeader}.${encPayload}`);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return `${encHeader}.${encPayload}.${base64urlEncodeBytes(new Uint8Array(sig))}`;
}

async function signJwtRs256(
  payload: Record<string, unknown>,
  privateKey: CryptoKey,
  kid: string,
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid };
  const encHeader = base64urlEncodeBytes(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = base64urlEncodeBytes(new TextEncoder().encode(JSON.stringify(payload)));
  const data = new TextEncoder().encode(`${encHeader}.${encPayload}`);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, data);
  return `${encHeader}.${encPayload}.${base64urlEncodeBytes(new Uint8Array(sig))}`;
}

export async function signOAuthAccessToken(env: Env, payload: Record<string, unknown>): Promise<string> {
  const rsa = await getOauthRsaPrivateKey(env);
  if (rsa) {
    return signJwtRs256(payload, rsa, OAUTH_JWT_KID);
  }
  const secret = env.RATE_LIMIT_BYPASS_JWT_SECRET;
  if (!secret) {
    throw new Error("oauth_signing_not_configured");
  }
  return signJwtHs256(payload, secret);
}

async function verifyJwtHs256(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, encSig] = parts;
  const headerBytes = base64urlDecodeToBytes(encHeader);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as { alg?: string };
  if (header.alg !== "HS256") return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${encHeader}.${encPayload}`);
  const ok = await crypto.subtle.verify("HMAC", key, base64urlDecodeToBytes(encSig), data);
  if (!ok) return null;
  return JSON.parse(new TextDecoder().decode(base64urlDecodeToBytes(encPayload))) as Record<string, unknown>;
}

async function verifyJwtRs256(token: string, privateKey: CryptoKey): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, encSig] = parts;
  const headerBytes = base64urlDecodeToBytes(encHeader);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as { alg?: string };
  if (header.alg !== "RS256") return null;

  const pub = await importRsaPublicVerifyKeyFromPrivate(privateKey);
  const data = new TextEncoder().encode(`${encHeader}.${encPayload}`);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    pub,
    base64urlDecodeToBytes(encSig),
    data,
  );
  if (!ok) return null;
  return JSON.parse(new TextDecoder().decode(base64urlDecodeToBytes(encPayload))) as Record<string, unknown>;
}

/**
 * Verify JWT signature for tokens accepted on MCP: OAuth access (RS256 or HS256) or Connect admin JWT (HS256 only).
 */
export async function verifyMcpJwtSignature(token: string, env: Env): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64urlDecodeToBytes(parts[0]))) as { alg?: string };
  } catch {
    return null;
  }
  const alg = header.alg;
  if (alg === "RS256") {
    const rsa = await getOauthRsaPrivateKey(env);
    if (!rsa) return null;
    return verifyJwtRs256(token, rsa);
  }
  if (alg === "HS256") {
    const secret = env.RATE_LIMIT_BYPASS_JWT_SECRET;
    if (!secret) return null;
    return verifyJwtHs256(token, secret);
  }
  return null;
}
