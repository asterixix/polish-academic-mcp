import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Input";
import {
  b64urlToBuf,
  bufToB64url,
  loginEmail,
  registerEmail,
} from "@/lib/api";
import { Key01, Passcode, User01 } from "@untitledui/icons";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

async function coseFromCredential(cred: PublicKeyCredential) {
  const response = cred.response as AuthenticatorAttestationResponse;
  if (!response.getPublicKey) {
    throw new Error("Przeglądarka nie udostępnia klucza publicznego passkey.");
  }
  const keyBuf = response.getPublicKey();
  if (!keyBuf) {
    throw new Error("Pusty klucz publiczny passkey.");
  }
  const spki = new Uint8Array(keyBuf);
  if (spki.length < 91 || spki[26] !== 0x04) {
    throw new Error("Nieobsługiwany format klucza passkey.");
  }
  return {
    "1": 2,
    "3": -7,
    "-1": 1,
    "-2": bufToB64url(spki.slice(27, 59)),
    "-3": bufToB64url(spki.slice(59, 91)),
  };
}

export function LoginPage() {
  const [params] = useSearchParams();
  const next = params.get("next") || "/account";
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const orcidHref = useMemo(() => {
    const q = next ? `?next=${encodeURIComponent(next)}` : "";
    return `/api/auth/orcid/start${q}`;
  }, [next]);

  const afterAuth = () => {
    if (next.startsWith("http") || next.startsWith("/oauth")) {
      window.location.href = next;
    } else {
      navigate(next);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md"
    >
      <div className="rounded-3xl border border-border-primary bg-bg-secondary p-6 shadow-soft md:p-8">
        <img src="/logo.jpg" alt="" className="mx-auto mb-4 size-16 rounded-2xl" />
        <h1 className="text-center font-display text-2xl font-semibold text-brand-700">
          Wejdź do konta
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-fg-secondary">
          ORCID dla badaczy, e-mail z hasłem albo passkey. To samo konto łączy AI Search i konektory
          Claude, ChatGPT oraz Perplexity.
        </p>

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <a
          href={orcidHref}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#A6CE39] font-semibold text-[#1a1a1a] transition hover:brightness-95"
        >
          Zaloguj przez ORCID iD
        </a>

        <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-fg-tertiary">
          <div className="h-px flex-1 bg-border-primary" />
          albo e-mail
          <div className="h-px flex-1 bg-border-primary" />
        </div>

        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await loginEmail(email, password);
              afterAuth();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label="E-mail"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Field
            label="Hasło"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          <div className="mt-1 flex gap-2">
            <Button type="submit" className="flex-1" disabled={busy}>
              <User01 className="size-4" /> Zaloguj
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              isDisabled={busy}
              onPress={async () => {
                setBusy(true);
                setError("");
                try {
                  await registerEmail(email, password);
                  afterAuth();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Załóż konto
            </Button>
          </div>
        </form>

        <div className="mt-4 grid gap-2">
          <Button
            variant="ghost"
            isDisabled={busy}
            onPress={async () => {
              setBusy(true);
              setError("");
              try {
                const optRes = await fetch("/api/auth/passkey/login-options", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ email: email || undefined }),
                });
                const optData = await optRes.json();
                if (!optRes.ok) throw new Error(optData.error || "Błąd passkey");
                const o = optData.options;
                o.challenge = b64urlToBuf(o.challenge);
                if (o.allowCredentials) {
                  o.allowCredentials = o.allowCredentials.map(
                    (c: { id: string; type: string }) => ({
                      ...c,
                      id: b64urlToBuf(c.id),
                    }),
                  );
                }
                const cred = (await navigator.credentials.get({
                  publicKey: o,
                })) as PublicKeyCredential;
                const assert = cred.response as AuthenticatorAssertionResponse;
                const verify = await fetch("/api/auth/passkey/login-verify", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    id: cred.id,
                    response: {
                      clientDataJSON: bufToB64url(assert.clientDataJSON),
                      authenticatorData: bufToB64url(assert.authenticatorData),
                      signature: bufToB64url(assert.signature),
                      userHandle: assert.userHandle
                        ? bufToB64url(assert.userHandle)
                        : undefined,
                    },
                  }),
                });
                const v = await verify.json();
                if (!verify.ok) throw new Error(v.error || "Weryfikacja nieudana");
                afterAuth();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Passcode className="size-4" /> Zaloguj passkey
          </Button>
          <Button
            variant="ghost"
            isDisabled={busy}
            onPress={async () => {
              setBusy(true);
              setError("");
              try {
                const optRes = await fetch("/api/auth/passkey/register-options", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ email }),
                });
                const optData = await optRes.json();
                if (!optRes.ok) throw new Error(optData.error || "Błąd rejestracji passkey");
                const o = optData.options;
                o.challenge = b64urlToBuf(o.challenge);
                o.user.id = b64urlToBuf(o.user.id);
                if (o.excludeCredentials) {
                  o.excludeCredentials = o.excludeCredentials.map(
                    (c: { id: string; type: string }) => ({
                      ...c,
                      id: b64urlToBuf(c.id),
                    }),
                  );
                }
                const cred = (await navigator.credentials.create({
                  publicKey: o,
                })) as PublicKeyCredential;
                const att = cred.response as AuthenticatorAttestationResponse;
                const cosePublicKey = await coseFromCredential(cred);
                const verify = await fetch("/api/auth/passkey/register-verify", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    user_id: optData.user_id,
                    id: cred.id,
                    rawId: bufToB64url(cred.rawId),
                    response: {
                      clientDataJSON: bufToB64url(att.clientDataJSON),
                      attestationObject: bufToB64url(att.attestationObject),
                      transports: att.getTransports?.() ?? [],
                    },
                    cosePublicKey,
                  }),
                });
                const v = await verify.json();
                if (!verify.ok) throw new Error(v.error || "Weryfikacja nieudana");
                afterAuth();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Key01 className="size-4" /> Zarejestruj passkey
          </Button>
        </div>

        <p className="mt-6 text-center text-sm text-fg-tertiary">
          <Link to="/" className="text-brand-600 hover:underline">
            Wróć do wyszukiwania
          </Link>
        </p>
      </div>
    </motion.div>
  );
}
