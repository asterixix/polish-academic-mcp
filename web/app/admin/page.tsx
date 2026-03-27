"use client";

import { useEffect, useMemo, useState } from "react";

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
	oauthAccessLimitPerHour?: number;
	oauthAccessTokenTtlSeconds?: number;
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
		throw new Error(`Odpowiedź nie jest JSON: ${text.slice(0, 200)}`);
	}
}

export default function AdminTokensPage() {
	const defaultBaseUrl =
		process.env.NEXT_PUBLIC_WORKER_BASE_URL?.toString() ??
		"http://localhost:8788";

	const [workerBaseUrl, setWorkerBaseUrl] = useState<string>(defaultBaseUrl);
	const [adminBearer, setAdminBearer] = useState<string>("");
	const [status, setStatus] = useState<string>("");
	const [tokens, setTokens] = useState<TokenRecord[]>([]);
	const [loading, setLoading] = useState<boolean>(false);
	const [lastMintedToken, setLastMintedToken] = useState<string>("");

	const apiBase = useMemo(
		() => workerBaseUrl.replace(/\/+$/, ""),
		[workerBaseUrl],
	);

	useEffect(() => {
		const LOCAL_KEY = "polish_academic_mcp_admin_bearer";
		// If user already stored token, reuse; otherwise prompt once.
		const maybe = window.localStorage.getItem(LOCAL_KEY);
		if (maybe && typeof maybe === "string") {
			setAdminBearer(maybe);
			return;
		}

		const entered = window.prompt(
			"Podaj token administratora (Bearer) dla tego panelu.\n\nNagłówek Authorization:\nBearer <token>\n\nWklej sam <token>.",
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
	const [mintOAuthLimit, setMintOAuthLimit] = useState<string>("");
	const [mintOAuthTtl, setMintOAuthTtl] = useState<string>("");

	async function callAdmin<T>(path: string, init?: RequestInit): Promise<T> {
		if (!adminBearer) throw new Error("Brak tokena administratora (Bearer)");
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
			setStatus("Skopiowano do schowka.");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(msg);
		}
	}

	async function loadTokens() {
		setLoading(true);
		setStatus("");
		try {
			const data = await callAdmin<{ tokens: TokenRecord[] }>(
				"/admin/tokens?limit=200",
				{
					method: "GET",
				},
			);
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
			const expiresInSeconds = Math.max(
				60,
				Math.floor(mintExpiresInDays * 24 * 60 * 60),
			);
			const mintBody: Record<string, unknown> = {
				bypass: mintBypass,
				limitPerHour: mintLimitPerHour,
				expiresInSeconds,
				label: mintLabel.trim() || undefined,
				owner: mintOwner.trim() || undefined,
			};
			if (mintOAuthLimit.trim() !== "") {
				mintBody.oauthAccessLimitPerHour = Math.max(
					1,
					Math.floor(Number(mintOAuthLimit) || 0),
				);
			}
			if (mintOAuthTtl.trim() !== "") {
				mintBody.oauthAccessTokenTtlSeconds = Math.max(
					60,
					Math.floor(Number(mintOAuthTtl) || 0),
				);
			}
			const data = await callAdmin<{ token: string; record: TokenRecord }>(
				"/admin/tokens",
				{
					method: "POST",
					body: JSON.stringify(mintBody),
				},
			);

			// Refresh list (and show error if something else fails).
			await loadTokens();

			setStatus("Utworzono token. Skopiuj poniżej:");
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
			await callAdmin<{ record: TokenRecord }>(
				`/admin/tokens/${encodeURIComponent(jti)}/revoke`,
				{
					method: "POST",
					body: JSON.stringify({ reason: reason?.trim() || undefined }),
				},
			);
			await loadTokens();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(msg);
		} finally {
			setLoading(false);
		}
	}

	async function updateToken(
		jti: string,
		patch: Partial<TokenRecord> & {
			oauthAccessLimitPerHour?: number | null;
			oauthAccessTokenTtlSeconds?: number | null;
		},
	) {
		setLoading(true);
		setStatus("");
		try {
			const patchJson: Record<string, unknown> = {
				bypass: typeof patch.bypass === "boolean" ? patch.bypass : undefined,
				limitPerHour:
					typeof patch.limitPerHour === "number"
						? patch.limitPerHour
						: undefined,
				label: typeof patch.label === "string" ? patch.label : undefined,
				owner: typeof patch.owner === "string" ? patch.owner : undefined,
				expiresInSeconds:
					typeof patch.expiresAtMs === "number" &&
					Number.isFinite(patch.expiresAtMs)
						? Math.max(
								60,
								Math.floor((patch.expiresAtMs - Date.now()) / 1000),
							)
						: undefined,
			};
			if ("oauthAccessLimitPerHour" in patch) {
				patchJson.oauthAccessLimitPerHour =
					patch.oauthAccessLimitPerHour ?? null;
			}
			if ("oauthAccessTokenTtlSeconds" in patch) {
				patchJson.oauthAccessTokenTtlSeconds =
					patch.oauthAccessTokenTtlSeconds ?? null;
			}
			await callAdmin(`/admin/tokens/${encodeURIComponent(jti)}`, {
				method: "PATCH",
				body: JSON.stringify(patchJson),
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
			<h1 className="mb-2 text-2xl font-semibold">
				Panel tokenów i limitów wywołań
			</h1>
			<p className="mb-6 text-sm text-muted-foreground">
				Wywołania admin wymagają nagłówka <code>Authorization: Bearer</code>.
				Użytkownicy korzystają z utworzonych tokenów.
			</p>

			<div className="mb-6 rounded-lg border p-4">
				<div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
					<label className="flex flex-col gap-1">
						<span className="text-sm text-muted-foreground">
							Bazowy URL workera
						</span>
						<input
							className="rounded border px-3 py-2"
							value={workerBaseUrl}
							onChange={(e) => setWorkerBaseUrl(e.target.value)}
							placeholder="http://localhost:8788"
						/>
					</label>

					<label className="flex flex-col gap-1">
						<span className="text-sm text-muted-foreground">
							Sekret Bearer administratora
						</span>
						<input
							className="rounded border px-3 py-2"
							value={adminBearer}
							onChange={(e) => setAdminBearer(e.target.value)}
							placeholder="wklej token admin"
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
						{loading ? "Wczytywanie…" : "Wczytaj tokeny"}
					</button>
				</div>

				{status ? (
					<div className="mt-3 text-sm text-red-600">{status}</div>
				) : null}
			</div>

			<div className="mb-6 rounded-lg border p-4">
				<h2 className="mb-4 text-lg font-medium">Utwórz token</h2>
				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={mintBypass}
							onChange={(e) => setMintBypass(e.target.checked)}
						/>
						<span>Całkowicie pomiń limit (bypass)</span>
					</label>

					<label className="flex flex-col gap-1">
						<span className="text-sm text-muted-foreground">
							Limit na godzinę
						</span>
						<input
							type="number"
							className="rounded border px-3 py-2"
							value={mintLimitPerHour}
							min={1}
							step={1}
							onChange={(e) =>
								setMintLimitPerHour(Math.max(1, Number(e.target.value) || 10))
							}
							disabled={mintBypass}
						/>
					</label>

					<label className="flex flex-col gap-1">
						<span className="text-sm text-muted-foreground">
							Wygasa za (dni)
						</span>
						<input
							type="number"
							className="rounded border px-3 py-2"
							value={mintExpiresInDays}
							min={1}
							step={1}
							onChange={(e) =>
								setMintExpiresInDays(Math.max(1, Number(e.target.value) || 30))
							}
						/>
					</label>

					<label className="flex flex-col gap-1">
						<span className="text-sm text-muted-foreground">
							Etykieta (opcjonalnie)
						</span>
						<input
							className="rounded border px-3 py-2"
							value={mintLabel}
							onChange={(e) => setMintLabel(e.target.value)}
							placeholder="np. alice-prod"
						/>
					</label>

					<label className="flex flex-col gap-1 md:col-span-2">
						<span className="text-sm text-muted-foreground">
							Właściciel (opcjonalnie)
						</span>
						<input
							className="rounded border px-3 py-2"
							value={mintOwner}
							onChange={(e) => setMintOwner(e.target.value)}
							placeholder="np. Alice"
						/>
					</label>

					<label className="flex flex-col gap-1">
						<span className="text-sm text-muted-foreground">
							OAuth limit tools/h (opcjonalnie, /register)
						</span>
						<input
							className="rounded border px-3 py-2"
							value={mintOAuthLimit}
							onChange={(e) => setMintOAuthLimit(e.target.value)}
							placeholder="global workera jeśli puste"
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-sm text-muted-foreground">
							OAuth TTL access_token (s)
						</span>
						<input
							className="rounded border px-3 py-2"
							value={mintOAuthTtl}
							onChange={(e) => setMintOAuthTtl(e.target.value)}
							placeholder="global jeśli puste"
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
						{loading ? "Tworzenie…" : "Utwórz token"}
					</button>
				</div>

				{lastMintedToken ? (
					<div className="mt-4 rounded border p-3">
						<div className="mb-2 text-sm font-medium">Ostatnio utworzony token</div>
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
								Kopiuj
							</button>
						</div>
					</div>
				) : null}
			</div>

			<div className="rounded-lg border p-4">
				<h2 className="mb-4 text-lg font-medium">Tokeny</h2>

				{tokens.length === 0 ? (
					<div className="text-sm text-muted-foreground">Brak tokenów.</div>
				) : null}

				<div className="space-y-4">
					{tokens.map((t) => (
						<TokenCard
							key={t.jti}
							token={t}
							loading={loading}
							onRevoke={revokeToken}
							onUpdate={updateToken}
						/>
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
	onUpdate: (
		jti: string,
		patch: Partial<TokenRecord> & {
			oauthAccessLimitPerHour?: number | null;
			oauthAccessTokenTtlSeconds?: number | null;
		},
	) => Promise<void>;
}) {
	const { token, loading, onRevoke, onUpdate } = props;

	const [bypass, setBypass] = useState<boolean>(token.bypass);
	const [limitPerHour, setLimitPerHour] = useState<number>(token.limitPerHour);
	const [oauthLimitStr, setOauthLimitStr] = useState<string>(() =>
		token.oauthAccessLimitPerHour != null
			? String(token.oauthAccessLimitPerHour)
			: "",
	);
	const [oauthTtlStr, setOauthTtlStr] = useState<string>(() =>
		token.oauthAccessTokenTtlSeconds != null
			? String(token.oauthAccessTokenTtlSeconds)
			: "",
	);
	const [expiresInDays, setExpiresInDays] = useState<number>(() => {
		const days = Math.ceil(
			(token.expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000),
		);
		return Number.isFinite(days) && days > 0 ? days : 1;
	});
	const [label, setLabel] = useState<string>(token.label ?? "");
	const [owner, setOwner] = useState<string>(token.owner ?? "");
	const [revokeReason, setRevokeReason] = useState<string>("");

	useEffect(() => {
		setBypass(token.bypass);
		setLimitPerHour(token.limitPerHour);
		const days = Math.ceil(
			(token.expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000),
		);
		setExpiresInDays(Number.isFinite(days) && days > 0 ? days : 1);
		setLabel(token.label ?? "");
		setOwner(token.owner ?? "");
		setOauthLimitStr(
			token.oauthAccessLimitPerHour != null
				? String(token.oauthAccessLimitPerHour)
				: "",
		);
		setOauthTtlStr(
			token.oauthAccessTokenTtlSeconds != null
				? String(token.oauthAccessTokenTtlSeconds)
				: "",
		);
		setRevokeReason("");
	}, [token]);

	const revoked = !!token.revokedAtMs;
	const expired = !revoked && Date.now() >= token.expiresAtMs;

	async function apply() {
		const newExpiresAtMs =
			Date.now() + Math.max(1, Math.floor(expiresInDays)) * 24 * 60 * 60 * 1000;
		let oauthAccessLimitPerHour: number | null | undefined = undefined;
		if (oauthLimitStr.trim() === "") oauthAccessLimitPerHour = null;
		else {
			const n = Math.floor(Number(oauthLimitStr));
			if (!Number.isFinite(n) || n < 1) {
				return;
			}
			oauthAccessLimitPerHour = n;
		}
		let oauthAccessTokenTtlSeconds: number | null | undefined = undefined;
		if (oauthTtlStr.trim() === "") oauthAccessTokenTtlSeconds = null;
		else {
			const n = Math.floor(Number(oauthTtlStr));
			if (!Number.isFinite(n) || n < 60) {
				return;
			}
			oauthAccessTokenTtlSeconds = n;
		}
		await onUpdate(token.jti, {
			bypass,
			limitPerHour: bypass ? token.limitPerHour : limitPerHour,
			expiresAtMs: newExpiresAtMs,
			label: label.trim() || undefined,
			owner: owner.trim() || undefined,
			oauthAccessLimitPerHour,
			oauthAccessTokenTtlSeconds,
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
						etykieta: {token.label || "—"} · właściciel: {token.owner || "—"}
					</div>
					<div className="mt-1 text-sm text-muted-foreground">
						bypass: {token.bypass ? "tak" : "nie"} · limit:{" "}
						{token.bypass ? "∞" : token.limitPerHour}/h
					</div>
					<div className="mt-1 text-sm text-muted-foreground">
						wygasa: {msToIso(token.expiresAtMs)}
					</div>
					<div className="mt-1 text-sm text-muted-foreground">
						OAuth /register: limit{" "}
						{token.oauthAccessLimitPerHour ?? "—"} / h · TTL access{" "}
						{token.oauthAccessTokenTtlSeconds ?? "—"} s
					</div>
					{token.revokedAtMs ? (
						<div className="mt-1 text-sm text-red-600">
							odwołano: {msToIso(token.revokedAtMs)}
						</div>
					) : expired ? (
						<div className="mt-1 text-sm text-muted-foreground">wygasły</div>
					) : null}
				</div>

				<div className="min-w-[280px]">
					<div className="text-sm font-medium">Podgląd zużycia</div>
					<div className="mt-1 text-sm text-muted-foreground">
						pozostało: {token.usage.remaining} · reset za:{" "}
						{token.usage.resetInSeconds} s
					</div>
				</div>
			</div>

			<div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={bypass}
						onChange={(e) => setBypass(e.target.checked)}
					/>
					pomiń limit
				</label>

				<label className="flex flex-col gap-1 text-sm">
					<span className="text-muted-foreground">limit / godz.</span>
					<input
						type="number"
						className="rounded border px-2 py-1"
						value={limitPerHour}
						min={1}
						step={1}
						onChange={(e) =>
							setLimitPerHour(Math.max(1, Number(e.target.value) || 1))
						}
						disabled={bypass || revoked}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm">
					<span className="text-muted-foreground">wygasa za (dni)</span>
					<input
						type="number"
						className="rounded border px-2 py-1"
						value={expiresInDays}
						min={1}
						step={1}
						onChange={(e) =>
							setExpiresInDays(Math.max(1, Number(e.target.value) || 1))
						}
						disabled={revoked}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm">
					<span className="text-muted-foreground">etykieta</span>
					<input
						className="rounded border px-2 py-1"
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						disabled={revoked}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm md:col-span-2">
					<span className="text-muted-foreground">właściciel</span>
					<input
						className="rounded border px-2 py-1"
						value={owner}
						onChange={(e) => setOwner(e.target.value)}
						disabled={revoked}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm">
					<span className="text-muted-foreground">
						OAuth limit / h (puste = worker)
					</span>
					<input
						className="rounded border px-2 py-1"
						value={oauthLimitStr}
						onChange={(e) => setOauthLimitStr(e.target.value)}
						disabled={revoked}
					/>
				</label>
				<label className="flex flex-col gap-1 text-sm">
					<span className="text-muted-foreground">OAuth TTL (s)</span>
					<input
						className="rounded border px-2 py-1"
						value={oauthTtlStr}
						onChange={(e) => setOauthTtlStr(e.target.value)}
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
					Zastosuj zmiany
				</button>

				<div className="flex items-center gap-2">
					<input
						className="w-56 rounded border px-2 py-1"
						value={revokeReason}
						onChange={(e) => setRevokeReason(e.target.value)}
						placeholder="Powód odwołania (opcjonalnie)"
						disabled={revoked}
					/>
					<button
						className="rounded bg-red-600 px-3 py-1.5 text-white disabled:opacity-50"
						onClick={() => onRevoke(token.jti, revokeReason)}
						disabled={loading || revoked}
						type="button"
					>
						Odwołaj teraz
					</button>
				</div>
			</div>
		</div>
	);
}
