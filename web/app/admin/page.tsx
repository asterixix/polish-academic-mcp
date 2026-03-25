"use client";

import React, { useEffect, useMemo, useState } from "react";

type TokenUsagePreview = {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
};

type TokenRecord = {
  jti: string;
  createdAtMs: number;
  bypass: boolean;
  limitPerHour: number;
  expiresAtMs: number;
  revokedAtMs?: number;
  revokeReason?: string;
  label?: string;
  owner?: string;
  usage: TokenUsagePreview;
};

function msToIso(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toISOString();
  } catch {
    return "—";
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
  }
}

export default function AdminTokensPage() {
  const defaultBaseUrl =
    process.env.NEXT_PUBLIC_WORKER_BASE_URL?.toString() ?? "http://localhost:8788";

  const [workerBaseUrl, setWorkerBaseUrl] = useState<string>(defaultBaseUrl);
  const [adminBearer, setAdminBearer] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [lastMintedToken, setLastMintedToken] = useState<string>("");

  const apiBase = useMemo(() => workerBaseUrl.replace(/\/+$/, ""), [workerBaseUrl]);

  useEffect(() => {
    const LOCAL_KEY = "polish_academic_mcp_admin_bearer";
    // If user already stored token, reuse; otherwise prompt once.
    const maybe = window.localStorage.getItem(LOCAL_KEY);
    if (maybe && typeof maybe === "string") {
      setAdminBearer(maybe);
      return;
    }

    const entered = window.prompt(
      "Enter admin bearer token for this panel.\n\nAuthorization header value should be:\nBearer <token>\n\nPaste only <token>.",
    );
    if (entered === null) return;
    const trimmed = entered.trim();
    if (!trimmed) return;
    window.localStorage.setItem(LOCAL_KEY, trimmed);
    setAdminBearer(trimmed);
  }, []);

  const [mintBypass, setMintBypass] = useState<boolean>(false);
  const [mintLimitPerHour, setMintLimitPerHour] = useState<number>(10);
  const [mintExpiresInDays, setMintExpiresInDays] = useState<number>(30);
  const [mintLabel, setMintLabel] = useState<string>("");
  const [mintOwner, setMintOwner] = useState<string>("");

  async function callAdmin<T>(path: string, init?: RequestInit): Promise<T> {
    if (!adminBearer) throw new Error("Missing admin bearer token");
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${adminBearer}`,
    };
    if (init?.body) headers["Content-Type"] = "application/json";
    const res = await fetch(`${apiBase}${path}`, {
      ...init,
      headers,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    return readJson<T>(res);
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied to clipboard.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
    }
  }

  async function loadTokens() {
    setLoading(true);
    setStatus("");
    try {
      const data = await callAdmin<{ tokens: TokenRecord[] }>("/admin/tokens?limit=200", {
        method: "GET",
      });
      setTokens(data.tokens);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
    } finally {
      setLoading(false);
    }
  }

  async function mintToken() {
    setLoading(true);
    setStatus("");
    setLastMintedToken("");
    try {
      const expiresInSeconds = Math.max(60, Math.floor(mintExpiresInDays * 24 * 60 * 60));
      const data = await callAdmin<{ token: string; record: TokenRecord }>("/admin/tokens", {
        method: "POST",
        body: JSON.stringify({
          bypass: mintBypass,
          limitPerHour: mintLimitPerHour,
          expiresInSeconds,
          label: mintLabel.trim() || undefined,
          owner: mintOwner.trim() || undefined,
        }),
      });

      // Refresh list (and show error if something else fails).
      await loadTokens();

      setStatus("Minted token. Copy it below:");
      setLastMintedToken(data.token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
    } finally {
      setLoading(false);
    }
  }

  async function revokeToken(jti: string, reason?: string) {
    setLoading(true);
    setStatus("");
    try {
      await callAdmin<{ record: TokenRecord }>(`/admin/tokens/${encodeURIComponent(jti)}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason: reason?.trim() || undefined }),
      });
      await loadTokens();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
    } finally {
      setLoading(false);
    }
  }

  async function updateToken(jti: string, patch: Partial<TokenRecord>) {
    setLoading(true);
    setStatus("");
    try {
      await callAdmin(`/admin/tokens/${encodeURIComponent(jti)}`, {
        method: "PATCH",
        body: JSON.stringify({
          bypass: typeof patch.bypass === "boolean" ? patch.bypass : undefined,
          limitPerHour: typeof patch.limitPerHour === "number" ? patch.limitPerHour : undefined,
          label: typeof patch.label === "string" ? patch.label : undefined,
          owner: typeof patch.owner === "string" ? patch.owner : undefined,
          // Update expiry by days: easiest UX.
          expiresInSeconds:
            typeof patch.expiresAtMs === "number" && Number.isFinite(patch.expiresAtMs)
              ? Math.max(60, Math.floor((patch.expiresAtMs - Date.now()) / 1000))
              : undefined,
        }),
      });
      await loadTokens();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <h1 className="mb-2 text-2xl font-semibold">Rate-limit bypass token panel</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Admin calls require <code>Authorization: Bearer</code> token. Regular users will use minted tokens.
      </p>

      <div className="mb-6 rounded-lg border p-4">
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Worker base URL</span>
            <input
              className="rounded border px-3 py-2"
              value={workerBaseUrl}
              onChange={(e) => setWorkerBaseUrl(e.target.value)}
              placeholder="http://localhost:8788"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Admin bearer secret</span>
            <input
              className="rounded border px-3 py-2"
              value={adminBearer}
              onChange={(e) => setAdminBearer(e.target.value)}
              placeholder="paste admin token"
            />
          </label>
        </div>

        <div className="flex gap-2">
          <button
            className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
            onClick={loadTokens}
            disabled={loading}
            type="button"
          >
            {loading ? "Loading..." : "Load tokens"}
          </button>
        </div>

        {status ? <div className="mt-3 text-sm text-red-600">{status}</div> : null}
      </div>

      <div className="mb-6 rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-medium">Mint token</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={mintBypass} onChange={(e) => setMintBypass(e.target.checked)} />
            <span>Bypass rate limit completely</span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Limit per hour</span>
            <input
              type="number"
              className="rounded border px-3 py-2"
              value={mintLimitPerHour}
              min={1}
              step={1}
              onChange={(e) => setMintLimitPerHour(Math.max(1, Number(e.target.value) || 10))}
              disabled={mintBypass}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Expires in days</span>
            <input
              type="number"
              className="rounded border px-3 py-2"
              value={mintExpiresInDays}
              min={1}
              step={1}
              onChange={(e) => setMintExpiresInDays(Math.max(1, Number(e.target.value) || 30))}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Label (optional)</span>
            <input
              className="rounded border px-3 py-2"
              value={mintLabel}
              onChange={(e) => setMintLabel(e.target.value)}
              placeholder="e.g. alice-prod"
            />
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-sm text-muted-foreground">Owner (optional)</span>
            <input
              className="rounded border px-3 py-2"
              value={mintOwner}
              onChange={(e) => setMintOwner(e.target.value)}
              placeholder="e.g. Alice"
            />
          </label>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
            onClick={mintToken}
            disabled={loading}
            type="button"
          >
            {loading ? "Minting..." : "Mint token"}
          </button>
        </div>

        {lastMintedToken ? (
          <div className="mt-4 rounded border p-3">
            <div className="mb-2 text-sm font-medium">Last minted token</div>
            <textarea
              className="h-24 w-full rounded border bg-black/5 p-2 font-mono text-xs"
              readOnly
              value={lastMintedToken}
            />
            <div className="mt-2 flex gap-2">
              <button
                className="rounded bg-black px-3 py-1.5 text-white disabled:opacity-50"
                onClick={() => copyText(lastMintedToken)}
                disabled={loading}
                type="button"
              >
                Copy
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-medium">Tokens</h2>

        {tokens.length === 0 ? <div className="text-sm text-muted-foreground">No tokens yet.</div> : null}

        <div className="space-y-4">
          {tokens.map((t) => (
            <TokenCard token={t} loading={loading} onRevoke={revokeToken} onUpdate={updateToken} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TokenCard(props: {
  token: TokenRecord;
  loading: boolean;
  onRevoke: (jti: string, reason?: string) => Promise<void>;
  onUpdate: (jti: string, patch: Partial<TokenRecord>) => Promise<void>;
}) {
  const { token, loading, onRevoke, onUpdate } = props;

  const [bypass, setBypass] = useState<boolean>(token.bypass);
  const [limitPerHour, setLimitPerHour] = useState<number>(token.limitPerHour);
  const [expiresInDays, setExpiresInDays] = useState<number>(() => {
    const days = Math.ceil((token.expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000));
    return Number.isFinite(days) && days > 0 ? days : 1;
  });
  const [label, setLabel] = useState<string>(token.label ?? "");
  const [owner, setOwner] = useState<string>(token.owner ?? "");
  const [revokeReason, setRevokeReason] = useState<string>("");

  useEffect(() => {
    setBypass(token.bypass);
    setLimitPerHour(token.limitPerHour);
    const days = Math.ceil((token.expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000));
    setExpiresInDays(Number.isFinite(days) && days > 0 ? days : 1);
    setLabel(token.label ?? "");
    setOwner(token.owner ?? "");
    setRevokeReason("");
  }, [token]);

  const revoked = !!token.revokedAtMs;
  const expired = !revoked && Date.now() >= token.expiresAtMs;

  async function apply() {
    const newExpiresAtMs = Date.now() + Math.max(1, Math.floor(expiresInDays)) * 24 * 60 * 60 * 1000;
    await onUpdate(token.jti, {
      bypass,
      limitPerHour: bypass ? token.limitPerHour : limitPerHour,
      expiresAtMs: newExpiresAtMs,
      label: label.trim() || undefined,
      owner: owner.trim() || undefined,
    });
  }

  return (
    <div className="rounded border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[280px]">
          <div className="text-sm font-medium">
            jti: <span className="font-mono">{token.jti}</span>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            label: {token.label || "—"} · owner: {token.owner || "—"}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            bypass: {token.bypass ? "true" : "false"} · limit: {token.bypass ? "∞" : token.limitPerHour}/h
          </div>
          <div className="mt-1 text-sm text-muted-foreground">expiresAt: {msToIso(token.expiresAtMs)}</div>
          {token.revokedAtMs ? (
            <div className="mt-1 text-sm text-red-600">revokedAt: {msToIso(token.revokedAtMs)}</div>
          ) : expired ? (
            <div className="mt-1 text-sm text-muted-foreground">expired</div>
          ) : null}
        </div>

        <div className="min-w-[280px]">
          <div className="text-sm font-medium">usage preview</div>
          <div className="mt-1 text-sm text-muted-foreground">
            remaining: {token.usage.remaining} · resetIn: {token.usage.resetInSeconds}s
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} />
          bypass
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">limitPerHour</span>
          <input
            type="number"
            className="rounded border px-2 py-1"
            value={limitPerHour}
            min={1}
            step={1}
            onChange={(e) => setLimitPerHour(Math.max(1, Number(e.target.value) || 1))}
            disabled={bypass || revoked}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">expiresInDays</span>
          <input
            type="number"
            className="rounded border px-2 py-1"
            value={expiresInDays}
            min={1}
            step={1}
            onChange={(e) => setExpiresInDays(Math.max(1, Number(e.target.value) || 1))}
            disabled={revoked}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">label</span>
          <input
            className="rounded border px-2 py-1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={revoked}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          <span className="text-muted-foreground">owner</span>
          <input
            className="rounded border px-2 py-1"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            disabled={revoked}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="rounded bg-black px-3 py-1.5 text-white disabled:opacity-50"
          onClick={apply}
          disabled={loading || revoked}
          type="button"
        >
          Apply changes
        </button>

        <div className="flex items-center gap-2">
          <input
            className="w-56 rounded border px-2 py-1"
            value={revokeReason}
            onChange={(e) => setRevokeReason(e.target.value)}
            placeholder="Revoke reason (optional)"
            disabled={revoked}
          />
          <button
            className="rounded bg-red-600 px-3 py-1.5 text-white disabled:opacity-50"
            onClick={() => onRevoke(token.jti, revokeReason)}
            disabled={loading || revoked}
            type="button"
          >
            Revoke now
          </button>
        </div>
      </div>
    </div>
  );
}

