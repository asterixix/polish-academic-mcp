import type { CloudEnv } from "./env.js";
import { publicOrigin } from "./env.js";
import {
  createSessionCookie,
  getUserById,
  getUserByEmail,
  readSessionUser,
  type UserRow,
} from "./auth.js";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  jsonResponse,
  randomId,
} from "./crypto-util.js";

interface ChallengeRow {
  id: string;
  user_id: string | null;
  challenge: string;
  type: string;
  expires_at: string;
  metadata: string | null;
}

function rpIdFromOrigin(origin: string): string {
  return new URL(origin).hostname;
}

async function storeChallenge(
  env: CloudEnv,
  type: string,
  challenge: string,
  userId: string | null,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const id = randomId(12);
  const expires = new Date(Date.now() + 5 * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO auth_challenges (id, user_id, challenge, type, expires_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, challenge, type, expires, metadata ? JSON.stringify(metadata) : null)
    .run();
  return id;
}

async function takeChallenge(
  env: CloudEnv,
  challenge: string,
  type: string,
): Promise<ChallengeRow | null> {
  const row = await env.DB.prepare(
    `SELECT id, user_id, challenge, type, expires_at, metadata FROM auth_challenges
     WHERE challenge = ? AND type = ?`,
  )
    .bind(challenge, type)
    .first<ChallengeRow>();
  if (!row) return null;
  await env.DB.prepare(`DELETE FROM auth_challenges WHERE id = ?`).bind(row.id).run();
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

function coseToSpki(coseKey: Record<string, unknown>): ArrayBuffer {
  // COSE EC2 P-256: kty=2, crv=1, x=-2, y=-3
  const x = base64UrlToBytes(String(coseKey["-2"] ?? ""));
  const y = base64UrlToBytes(String(coseKey["-3"] ?? ""));
  if (x.length !== 32 || y.length !== 32) {
    throw new Error("Nieprawidłowy klucz publiczny WebAuthn (oczekiwano P-256).");
  }
  // SubjectPublicKeyInfo for uncompressed P-256 point
  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  uncompressed.set(x, 1);
  uncompressed.set(y, 33);
  const spkiPrefix = Uint8Array.from([
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
    0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
  ]);
  const spki = new Uint8Array(spkiPrefix.length + uncompressed.length);
  spki.set(spkiPrefix, 0);
  spki.set(uncompressed, spkiPrefix.length);
  return spki.buffer;
}

async function verifyAssertionSignature(
  publicKeyCoseJson: string,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const cose = JSON.parse(publicKeyCoseJson) as Record<string, unknown>;
  const spki = coseToSpki(cose);
  const key = await crypto.subtle.importKey(
    "spki",
    spki,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON));
  const signed = new Uint8Array(authenticatorData.length + clientHash.length);
  signed.set(authenticatorData, 0);
  signed.set(clientHash, authenticatorData.length);
  // WebAuthn ECDSA signatures are ASN.1 DER; Web Crypto expects IEEE P1363 (r||s).
  const raw = derEcdsaToRaw(signature);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, signed);
}

function derEcdsaToRaw(der: Uint8Array): ArrayBuffer {
  // Minimal DER SEQUENCE { INTEGER r, INTEGER s } → 64-byte r||s
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error("Nieprawidłowy podpis DER");
  const seqLen = der[offset++];
  if (seqLen & 0x80) offset += seqLen & 0x7f; // long-form length — skip length bytes
  if (der[offset++] !== 0x02) throw new Error("Nieprawidłowy podpis DER (r)");
  let rLen = der[offset++];
  let r = der.slice(offset, offset + rLen);
  offset += rLen;
  if (der[offset++] !== 0x02) throw new Error("Nieprawidłowy podpis DER (s)");
  let sLen = der[offset++];
  let s = der.slice(offset, offset + sLen);
  // Strip leading zeros
  while (r.length > 32 && r[0] === 0) r = r.slice(1);
  while (s.length > 32 && s[0] === 0) s = s.slice(1);
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out.buffer;
}

function parseClientData(clientDataJSON: Uint8Array): {
  type: string;
  challenge: string;
  origin: string;
} {
  const json = JSON.parse(new TextDecoder().decode(clientDataJSON)) as {
    type: string;
    challenge: string;
    origin: string;
  };
  return json;
}

function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    orcid_id: user.orcid_id,
    display_name: user.display_name,
    created_at: user.created_at,
  };
}

export async function handlePasskeyRoutes(
  request: Request,
  env: CloudEnv,
  path: string,
): Promise<Response | null> {
  const origin = publicOrigin(request, env);
  const rpId = rpIdFromOrigin(origin);

  if (path === "/api/auth/passkey/register-options" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      display_name?: string;
    };
    let user = await readSessionUser(env, request);
    if (!user) {
      const email = body.email?.trim().toLowerCase() ?? "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return jsonResponse(
          { error: "Zaloguj się albo podaj email, aby zarejestrować passkey." },
          { status: 400 },
        );
      }
      user = await getUserByEmail(env, email);
      if (!user) {
        const id = randomId(18);
        const display_name = body.display_name?.trim() || email.split("@")[0];
        await env.DB.prepare(`INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)`)
          .bind(id, email, display_name)
          .run();
        user = await getUserById(env, id);
      }
    }
    if (!user) return jsonResponse({ error: "Nie udało się utworzyć użytkownika." }, { status: 500 });

    const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
    const challenge = bytesToBase64Url(challengeBytes);
    await storeChallenge(env, "webauthn-register", challenge, user.id, { email: user.email });

    const existing = await env.DB.prepare(
      `SELECT id FROM webauthn_credentials WHERE user_id = ?`,
    )
      .bind(user.id)
      .all<{ id: string }>();

    return jsonResponse({
      options: {
        challenge,
        rp: { name: "Polish Academic MCP", id: rpId },
        user: {
          id: bytesToBase64Url(new TextEncoder().encode(user.id)),
          name: user.email || user.orcid_id || user.id,
          displayName: user.display_name || user.email || "Użytkownik",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        timeout: 60_000,
        attestation: "none",
        excludeCredentials: (existing.results ?? []).map((c) => ({
          type: "public-key",
          id: c.id,
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      },
      user_id: user.id,
    });
  }

  if (path === "/api/auth/passkey/register-verify" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as {
      user_id?: string;
      id?: string;
      rawId?: string;
      response?: {
        clientDataJSON?: string;
        attestationObject?: string;
        publicKey?: string;
        transports?: string[];
      };
      // Simplified: client also sends COSE key JSON extracted via WebAuthn getPublicKey if available
      cosePublicKey?: Record<string, unknown>;
    } | null;
    if (!body?.id || !body.response?.clientDataJSON || !body.cosePublicKey) {
      return jsonResponse(
        {
          error:
            "Brak danych rejestracji passkey. Prześlij id, clientDataJSON oraz cosePublicKey (mapę COSE).",
        },
        { status: 400 },
      );
    }
    const clientData = parseClientData(base64UrlToBytes(body.response.clientDataJSON));
    if (clientData.type !== "webauthn.create" || clientData.origin !== origin) {
      return jsonResponse({ error: "Nieprawidłowe clientDataJSON." }, { status: 400 });
    }
    const challengeRow = await takeChallenge(env, clientData.challenge, "webauthn-register");
    if (!challengeRow?.user_id) {
      return jsonResponse({ error: "Wygasłe lub nieznane wyzwanie WebAuthn." }, { status: 400 });
    }
    const userId = body.user_id || challengeRow.user_id;
    await env.DB.prepare(
      `INSERT INTO webauthn_credentials (id, user_id, public_key, counter, transports)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET public_key = excluded.public_key, transports = excluded.transports`,
    )
      .bind(
        body.id,
        userId,
        JSON.stringify(body.cosePublicKey),
        JSON.stringify(body.response.transports ?? []),
      )
      .run();
    const user = await getUserById(env, userId);
    if (!user) return jsonResponse({ error: "Użytkownik nie istnieje." }, { status: 404 });
    const setCookie = await createSessionCookie(env, user.id);
    return jsonResponse(
      { user: publicUser(user) },
      { headers: { "set-cookie": setCookie } },
    );
  }

  if (path === "/api/auth/passkey/login-options" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { email?: string };
    let allowCredentials: Array<{ type: string; id: string }> = [];
    let userId: string | null = null;
    if (body.email) {
      const user = await getUserByEmail(env, body.email.trim().toLowerCase());
      if (user) {
        userId = user.id;
        const creds = await env.DB.prepare(
          `SELECT id FROM webauthn_credentials WHERE user_id = ?`,
        )
          .bind(user.id)
          .all<{ id: string }>();
        allowCredentials = (creds.results ?? []).map((c) => ({ type: "public-key", id: c.id }));
      }
    }
    const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
    const challenge = bytesToBase64Url(challengeBytes);
    await storeChallenge(env, "webauthn-login", challenge, userId);
    return jsonResponse({
      options: {
        challenge,
        timeout: 60_000,
        rpId,
        userVerification: "preferred",
        allowCredentials: allowCredentials.length ? allowCredentials : undefined,
      },
    });
  }

  if (path === "/api/auth/passkey/login-verify" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as {
      id?: string;
      response?: {
        clientDataJSON?: string;
        authenticatorData?: string;
        signature?: string;
        userHandle?: string;
      };
    } | null;
    if (
      !body?.id ||
      !body.response?.clientDataJSON ||
      !body.response.authenticatorData ||
      !body.response.signature
    ) {
      return jsonResponse({ error: "Brak danych asercji passkey." }, { status: 400 });
    }
    const clientData = parseClientData(base64UrlToBytes(body.response.clientDataJSON));
    if (clientData.type !== "webauthn.get" || clientData.origin !== origin) {
      return jsonResponse({ error: "Nieprawidłowe clientDataJSON." }, { status: 400 });
    }
    const challengeRow = await takeChallenge(env, clientData.challenge, "webauthn-login");
    if (!challengeRow) {
      return jsonResponse({ error: "Wygasłe lub nieznane wyzwanie WebAuthn." }, { status: 400 });
    }
    const cred = await env.DB.prepare(
      `SELECT id, user_id, public_key, counter FROM webauthn_credentials WHERE id = ?`,
    )
      .bind(body.id)
      .first<{ id: string; user_id: string; public_key: string; counter: number }>();
    if (!cred) return jsonResponse({ error: "Nieznany passkey." }, { status: 404 });

    const ok = await verifyAssertionSignature(
      cred.public_key,
      base64UrlToBytes(body.response.authenticatorData),
      base64UrlToBytes(body.response.clientDataJSON),
      base64UrlToBytes(body.response.signature),
    );
    if (!ok) return jsonResponse({ error: "Weryfikacja podpisu passkey nie powiodła się." }, { status: 401 });

    await env.DB.prepare(`UPDATE webauthn_credentials SET counter = counter + 1 WHERE id = ?`)
      .bind(cred.id)
      .run();
    const user = await getUserById(env, cred.user_id);
    if (!user) return jsonResponse({ error: "Użytkownik nie istnieje." }, { status: 404 });
    const setCookie = await createSessionCookie(env, user.id);
    return jsonResponse(
      { user: publicUser(user) },
      { headers: { "set-cookie": setCookie } },
    );
  }

  return null;
}
