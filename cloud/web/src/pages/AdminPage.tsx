import { Button } from "@/components/ui/Button";
import {
  adminGetSettings,
  adminHealth,
  adminListActivity,
  adminListEvents,
  adminCosts,
  adminListUsers,
  adminPurgeCache,
  type AdminCostsResponse,
  adminSaveSettings,
  adminTestEdenAi,
  adminUpdateQuota,
  fetchMe,
  type PublicUser,
} from "@/lib/api";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

type Tab = "health" | "costs" | "users" | "models" | "events" | "activity";

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const fmtUsd = (n: number | null | undefined) => (n == null ? "n/d" : `$${n.toFixed(4)}`);

export function AdminPage() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [tab, setTab] = useState<Tab>("health");
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Awaited<ReturnType<typeof adminHealth>> | null>(null);
  const [users, setUsers] = useState<Awaited<ReturnType<typeof adminListUsers>> | null>(null);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof adminGetSettings>> | null>(null);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof adminListEvents>> | null>(null);
  const [activity, setActivity] = useState<Awaited<ReturnType<typeof adminListActivity>> | null>(
    null,
  );
  const [activityQ, setActivityQ] = useState("");
  const [costRange, setCostRange] = useState({ from: daysAgoIso(29), to: todayIso() });
  const [costs, setCosts] = useState<AdminCostsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [synthesisExtra, setSynthesisExtra] = useState("");
  const [routerExtra, setRouterExtra] = useState("");
  const [deepenLimit, setDeepenLimit] = useState("4");
  const [maintenance, setMaintenance] = useState("");

  const load = useCallback(async () => {
    setError("");
    const me = await fetchMe();
    setUser(me);
    if (!me?.is_admin) return;
    try {
      if (tab === "health") setHealth(await adminHealth());
      if (tab === "users") setUsers(await adminListUsers());
      if (tab === "models") {
        const s = await adminGetSettings();
        setSettings(s);
        setSynthesisExtra(String(s.settings.synthesis_extra?.value ?? ""));
        setRouterExtra(String(s.settings.router_extra?.value ?? ""));
        setDeepenLimit(String(s.settings.deepen_record_limit?.value ?? 4));
        setMaintenance(String(s.settings.maintenance_message?.value ?? ""));
      }
      if (tab === "events") setEvents(await adminListEvents());
      if (tab === "activity") setActivity(await adminListActivity({ q: activityQ || undefined }));
      if (tab === "costs") setCosts(await adminCosts(costRange));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [tab, activityQ, costRange]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) {
    return (
      <div className="rounded-2xl border border-border-primary bg-bg-secondary p-8 text-center shadow-soft">
        <h1 className="font-display text-2xl font-semibold text-brand-700">Panel admina</h1>
        <p className="mt-2 text-fg-secondary">Zaloguj się kontem z uprawnieniami administratora.</p>
        <div className="mt-5">
          <Link to="/login">
            <Button>Zaloguj</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!user.is_admin) {
    return (
      <div className="rounded-2xl border border-border-primary bg-bg-secondary p-8 text-center shadow-soft">
        <h1 className="font-display text-2xl font-semibold text-brand-700">Brak dostępu</h1>
        <p className="mt-2 text-fg-secondary">
          Ten panel jest dostępny tylko dla określonych UID. Twój UID:{" "}
          <code className="rounded bg-brand-50 px-1.5 py-0.5 text-sm text-brand-800">{user.id}</code>
        </p>
        <div className="mt-5">
          <Link to="/account">
            <Button variant="secondary">Wróć do konta</Button>
          </Link>
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "health", label: "Stan systemu" },
    { id: "costs", label: "Koszty" },
    { id: "users", label: "Użytkownicy" },
    { id: "models", label: "Modele i odpowiedzi" },
    { id: "activity", label: "Aktywność" },
    { id: "events", label: "Zdarzenia" },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-brand-700">Panel administratora</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            UID: <code className="text-brand-800">{user.id}</code>
          </p>
        </div>
        <Button variant="secondary" size="sm" onPress={() => void load()} disabled={busy}>
          Odśwież
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
              tab === t.id
                ? "border-brand-700 bg-brand-700 text-white"
                : "border-border-primary bg-bg-secondary text-fg-secondary hover:border-brand-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {msg && <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800">{msg}</p>}

      {tab === "health" && health && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft">
            <h2 className="font-semibold text-fg-primary">Bindingi i sekrety</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {Object.entries(health.bindings).map(([k, v]) => (
                <li key={k} className="flex justify-between gap-3 border-b border-border-primary/60 py-2">
                  <span className="font-medium">{k}</span>
                  <span className={v.ok ? "text-emerald-700" : "text-red-700"}>
                    {v.ok ? "OK" : "FAIL"} · {v.detail}
                    {v.latency_ms != null ? ` (${v.latency_ms} ms)` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-fg-tertiary">
              Model: {health.model || "n/d"} · Domyślne limity MCP {health.defaults.mcp_monthly}/mies.,
              AI {health.defaults.ai_search_user_weekly}/tyg.
            </p>
            <p className="mt-1 text-xs text-fg-tertiary">
              Użytkownicy: {health.counts?.users ?? 0} · Wątki: {health.counts?.threads ?? 0} ·
              Zdarzenia: {health.counts?.events ?? 0}
            </p>
          </section>

          <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-fg-primary">Eden AI</h2>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onPress={async () => {
                  setBusy(true);
                  setError("");
                  setMsg("");
                  try {
                    const r = await adminTestEdenAi();
                    setMsg(
                      `Eden AI OK: model ${r.resolved_model ?? r.normalized_model}, ${r.duration_ms} ms${
                        typeof r.cost_usd === "number" ? `, koszt $${r.cost_usd.toFixed(6)}` : ""
                      } (odpowiedź: "${r.response_preview ?? ""}")`,
                    );
                    setHealth(await adminHealth());
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Testuj połączenie z Eden AI
              </Button>
            </div>
            <p className="mt-2 text-sm text-fg-secondary">{health.eden_ai.note}</p>
            {health.eden_ai.telemetry && (
              <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-border-primary bg-brand-25/50 p-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
                <div>
                  <span className="block text-fg-tertiary">Wyszukiwania Eden OK</span>
                  <span className="font-mono text-sm font-semibold text-emerald-700">
                    {health.eden_ai.telemetry.eden_ok_count}
                  </span>
                </div>
                <div>
                  <span className="block text-fg-tertiary">Wywołania LLM OK</span>
                  <span className="font-mono text-sm font-semibold text-emerald-700">
                    {health.eden_ai.telemetry.eden_ok_events}
                  </span>
                </div>
                <div>
                  <span className="block text-fg-tertiary">Fallback</span>
                  <span className="font-mono text-sm font-semibold text-amber-800">
                    {health.eden_ai.telemetry.eden_fallback_count}
                  </span>
                </div>
                <div>
                  <span className="block text-fg-tertiary">Błędy Eden AI</span>
                  <span className="font-mono text-sm font-semibold text-red-700">
                    {health.eden_ai.telemetry.eden_error_events}
                  </span>
                </div>
                <div>
                  <span className="block text-fg-tertiary">Limit subrequestów</span>
                  <span className="font-mono text-sm font-semibold text-red-700">
                    {health.eden_ai.telemetry.worker_subrequest_errors}
                  </span>
                </div>
              </div>
            )}
            {health.eden_ai.telemetry?.last_ok && (
              <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900">
                <div className="font-semibold">
                  Ostatnie OK Eden AI ({health.eden_ai.telemetry.last_ok.created_at}):
                </div>
                <div className="mt-0.5 break-words">{health.eden_ai.telemetry.last_ok.message}</div>
              </div>
            )}
            {health.eden_ai.telemetry?.last_error && (
              <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                <div className="font-semibold">
                  Ostatni błąd ({health.eden_ai.telemetry.last_error.created_at}):
                </div>
                <div className="mt-0.5 break-words">{health.eden_ai.telemetry.last_error.message}</div>
              </div>
            )}
            {health.eden_ai.error ? (
              <p className="mt-2 text-sm text-red-700">{String(health.eden_ai.error)}</p>
            ) : null}
            {health.eden_ai.usage && typeof health.eden_ai.usage === "object" ? (
              <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-brand-25 p-3 text-xs">
                {JSON.stringify(health.eden_ai.usage, null, 2)}
              </pre>
            ) : null}
            <p className="mt-3 text-xs text-fg-tertiary">
              Saldo kredytów: tylko w{" "}
              <a
                href="https://app.edenai.run/"
                className="text-brand-700 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                app.edenai.run
              </a>
              . Usage API wymaga sekretu EDENAI_MANAGEMENT_KEY.
            </p>
          </section>

          <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft lg:col-span-2">
            <h2 className="font-semibold text-fg-primary">Cloudflare Workers (24 h)</h2>
            <p className="mt-2 text-sm text-fg-secondary">{health.cloudflare.note}</p>
            {health.cloudflare.error ? (
              <p className="mt-2 text-sm text-red-700">{String(health.cloudflare.error)}</p>
            ) : null}
            {health.cloudflare.metrics ? (
              <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-brand-25 p-3 text-xs">
                {JSON.stringify(health.cloudflare.metrics, null, 2)}
              </pre>
            ) : null}
            <div className="mt-4">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onPress={async () => {
                  setBusy(true);
                  setMsg("");
                  try {
                    const r = await adminPurgeCache();
                    setMsg(r.message);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Zarejestruj żądanie czyszczenia cache
              </Button>
            </div>
          </section>
        </div>
      )}

      {tab === "users" && users && (
        <div className="space-y-3">
          <p className="text-sm text-fg-secondary">
            Okres AI: {users.period.week} · MCP: {users.period.month}
          </p>
          {users.users.map((u) => (
            <UserRowCard
              key={u.id}
              user={u}
              onSaved={async () => {
                setMsg("Zapisano limity.");
                setUsers(await adminListUsers());
              }}
              onError={setError}
            />
          ))}
        </div>
      )}

      {tab === "models" && settings && (
        <section className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-border-primary bg-bg-secondary p-6 shadow-soft">
          <h2 className="font-semibold text-fg-primary">Wytyczne odpowiedzi LLM</h2>
          <p className="text-sm text-fg-secondary">
            Te pola trafiają do promptów routera i syntezy AI Search (bez restartu Workera).
          </p>
          <label className="block text-sm font-medium text-fg-secondary">
            Dodatek do syntezy
            <textarea
              className="mt-1.5 min-h-28 w-full rounded-xl border border-border-primary px-3 py-2 text-sm"
              value={synthesisExtra}
              onChange={(e) => setSynthesisExtra(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium text-fg-secondary">
            Dodatek do routera narzędzi
            <textarea
              className="mt-1.5 min-h-20 w-full rounded-xl border border-border-primary px-3 py-2 text-sm"
              value={routerExtra}
              onChange={(e) => setRouterExtra(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium text-fg-secondary">
            Limit pogłębiania rekordów (1–6; zostawia budżet subrequestów na syntezę Eden AI)
            <input
              className="mt-1.5 w-full rounded-xl border border-border-primary px-3 py-2 text-sm"
              value={deepenLimit}
              onChange={(e) => setDeepenLimit(e.target.value)}
              type="number"
              min={1}
              max={20}
            />
          </label>
          <label className="block text-sm font-medium text-fg-secondary">
            Komunikat maintenance (pusty = wyłączony)
            <textarea
              className="mt-1.5 min-h-16 w-full rounded-xl border border-border-primary px-3 py-2 text-sm"
              value={maintenance}
              onChange={(e) => setMaintenance(e.target.value)}
              placeholder="Gdy ustawiony, /api/ai-search zwraca 503."
            />
          </label>
          <Button
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              setError("");
              setMsg("");
              try {
                await adminSaveSettings({
                  synthesis_extra: synthesisExtra,
                  router_extra: routerExtra,
                  deepen_record_limit: Math.min(6, Math.max(1, Number(deepenLimit) || 4)),
                  maintenance_message: maintenance,
                });
                setMsg("Zapisano ustawienia modeli.");
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Zapisz ustawienia
          </Button>
        </section>
      )}

      {tab === "activity" && activity && (
        <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft">
          <h2 className="font-semibold text-fg-primary">Logi aktywności (AI + MCP)</h2>
          <p className="mt-1 text-xs text-fg-secondary">{activity.note}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={activityQ}
              onChange={(e) => setActivityQ(e.target.value)}
              placeholder="Szukaj: query, trace, user id…"
              className="min-h-10 flex-1 rounded-xl border border-border-primary px-3 text-sm"
              aria-label="Filtr logów aktywności"
            />
            <Button
              variant="secondary"
              size="sm"
              onPress={() => void load()}
            >
              Odśwież
            </Button>
          </div>
          {activity.logs.length === 0 ? (
            <p className="mt-3 text-sm text-fg-secondary">Brak wpisów.</p>
          ) : (
            <ul className="mt-3 max-h-[32rem] divide-y divide-border-primary overflow-y-auto">
              {activity.logs.map((row) => {
                let meta: Record<string, unknown> | null = null;
                if (row.meta_json) {
                  try {
                    meta = JSON.parse(row.meta_json) as Record<string, unknown>;
                  } catch {
                    meta = null;
                  }
                }
                const edenOk = meta?.eden_ok === true;
                const fallbackUsed = meta?.fallback_used === true;
                const models = Array.isArray(meta?.models) ? (meta.models as string[]) : [];
                return (
                  <li key={row.id} className="py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-xs font-semibold uppercase ${
                          row.status === "error"
                            ? "bg-red-100 text-red-800"
                            : row.status === "empty"
                              ? "bg-amber-100 text-amber-900"
                              : row.status === "partial"
                                ? "bg-orange-100 text-orange-900"
                                : "bg-brand-50 text-brand-800"
                        }`}
                      >
                        {row.status}
                      </span>
                      <span className="font-medium text-fg-primary">{row.event_type}</span>
                      {edenOk && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-emerald-800">
                          Eden AI OK
                        </span>
                      )}
                      {fallbackUsed && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-red-800">
                          Fallback z Eden AI
                        </span>
                      )}
                      {models.length > 0 && (
                        <span className="font-mono text-[11px] text-fg-tertiary">
                          {models.join(" → ")}
                        </span>
                      )}
                      <span className="text-xs text-fg-secondary">{row.created_at}</span>
                      <span className="text-xs text-fg-secondary">
                        {row.subject_kind}
                        {row.user_id ? ` · ${row.user_id.slice(0, 8)}…` : ""}
                        {row.subject_hash && !row.user_id
                          ? ` · hash ${row.subject_hash.slice(0, 8)}…`
                          : ""}
                      </span>
                      {row.duration_ms != null && (
                        <span className="text-xs text-fg-secondary">{row.duration_ms} ms</span>
                      )}
                    </div>
                    <p className="mt-1 text-fg-secondary">{row.summary}</p>
                    {row.trace_id && (
                      <p className="mt-0.5 font-mono text-xs text-brand-800">trace: {row.trace_id}</p>
                    )}
                    {meta && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-xs text-fg-tertiary hover:text-brand-700">
                          Szczegóły wywołania (meta JSON)
                        </summary>
                        <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-bg-primary p-2 font-mono text-[11px] text-fg-secondary">
                          {JSON.stringify(meta, null, 2)}
                        </pre>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "costs" && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft">
            <h2 className="font-semibold text-fg-primary">Zakres dat</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { label: "Dziś", days: 1 },
                { label: "7 dni", days: 7 },
                { label: "30 dni", days: 30 },
                { label: "90 dni", days: 90 },
                { label: "180 dni", days: 180 },
              ].map((p) => (
                <Button
                  key={p.days}
                  size="sm"
                  variant="secondary"
                  onPress={() => setCostRange({ from: daysAgoIso(p.days - 1), to: todayIso() })}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-xs font-medium text-fg-secondary">
                Od
                <input
                  type="date"
                  className="mt-1 block rounded-lg border border-border-primary px-2 py-1.5 text-sm"
                  value={costRange.from}
                  min={daysAgoIso(179)}
                  max={costRange.to}
                  onChange={(e) => setCostRange((r) => ({ ...r, from: e.target.value }))}
                />
              </label>
              <label className="text-xs font-medium text-fg-secondary">
                Do
                <input
                  type="date"
                  className="mt-1 block rounded-lg border border-border-primary px-2 py-1.5 text-sm"
                  value={costRange.to}
                  min={costRange.from}
                  max={todayIso()}
                  onChange={(e) => setCostRange((r) => ({ ...r, to: e.target.value }))}
                />
              </label>
              <Button size="sm" onPress={() => void load()} disabled={busy}>
                Pokaż
              </Button>
            </div>
            <p className="mt-2 text-xs text-fg-tertiary">Maksymalnie 180 dni wstecz (zgodnie z retencją logów).</p>
          </section>

          {costs && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft">
                  <h3 className="text-sm font-semibold text-fg-primary">Eden AI</h3>
                  <p className="mt-2 font-mono text-2xl font-semibold text-brand-800">
                    {fmtUsd(costs.providers.eden_ai.logged_cost_usd)}
                  </p>
                  <p className="mt-1 text-xs text-fg-tertiary">
                    z logów (od wdrożenia kosztów) · Management API (~7 dni):{" "}
                    {fmtUsd(costs.providers.eden_ai.management_cost_usd)}
                  </p>
                </section>
                <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft">
                  <h3 className="text-sm font-semibold text-fg-primary">Parallel API</h3>
                  <p className="mt-2 font-mono text-2xl font-semibold text-brand-800">
                    {fmtUsd(costs.providers.parallel.cost_usd)}
                  </p>
                  <p className="mt-1 text-xs text-fg-tertiary">
                    search: {costs.providers.parallel.search_calls} · URL-e extract:{" "}
                    {costs.providers.parallel.extract_urls}
                  </p>
                </section>
                <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft">
                  <h3 className="text-sm font-semibold text-fg-primary">Cloudflare Workers</h3>
                  <p className="mt-2 font-mono text-2xl font-semibold text-brand-800">
                    {fmtUsd(costs.providers.cloudflare.overage_usd_est)}
                  </p>
                  <p className="mt-1 text-xs text-fg-tertiary">
                    szacunek nadwyżki · żądania: {costs.providers.cloudflare.requests ?? "n/d"}
                  </p>
                </section>
                <section className="rounded-2xl border border-brand-300 bg-brand-25 p-5 shadow-soft">
                  <h3 className="text-sm font-semibold text-fg-primary">Razem (szacunek)</h3>
                  <p className="mt-2 font-mono text-2xl font-semibold text-brand-800">
                    {fmtUsd(costs.totals.total_usd_est)}
                  </p>
                  <p className="mt-1 text-xs text-fg-tertiary">wyszukiwań AI: {costs.totals.ai_searches}</p>
                </section>
              </div>

              {costs.providers.cloudflare.error && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                  Cloudflare: {costs.providers.cloudflare.error}
                </p>
              )}
              {costs.providers.eden_ai.management_error && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                  Eden AI Management: {costs.providers.eden_ai.management_error}
                </p>
              )}

              <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft">
                <h2 className="font-semibold text-fg-primary">
                  Szczegóły dzienne ({costs.range.from} – {costs.range.to}, {costs.range.days} dni)
                </h2>
                {costs.daily.length === 0 ? (
                  <p className="mt-3 text-sm text-fg-secondary">Brak wyszukiwań AI w wybranym zakresie.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs text-fg-tertiary">
                        <tr>
                          <th className="py-2 pr-3 font-medium">Dzień</th>
                          <th className="py-2 pr-3 font-medium">Wyszukiwania</th>
                          <th className="py-2 pr-3 font-medium">Eden AI</th>
                          <th className="py-2 pr-3 font-medium">Parallel search</th>
                          <th className="py-2 pr-3 font-medium">Parallel URL-e</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-primary">
                        {costs.daily.map((d) => (
                          <tr key={d.day}>
                            <td className="py-2 pr-3 font-mono text-xs">{d.day}</td>
                            <td className="py-2 pr-3">{d.ai_searches}</td>
                            <td className="py-2 pr-3 font-mono">{fmtUsd(d.eden_cost_usd)}</td>
                            <td className="py-2 pr-3">{d.parallel_search_calls}</td>
                            <td className="py-2 pr-3">{d.parallel_extract_urls}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft">
                <h2 className="font-semibold text-fg-primary">Uwagi o źródłach danych</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-fg-secondary">
                  {costs.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      )}

      {tab === "events" && events && (
        <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft">
          <h2 className="font-semibold text-fg-primary">Ostatnie zdarzenia</h2>
          {events.events.length === 0 ? (
            <p className="mt-3 text-sm text-fg-secondary">Brak zdarzeń.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border-primary">
              {events.events.map((e) => (
                <li key={e.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-xs font-semibold uppercase ${
                        e.level === "error"
                          ? "bg-red-100 text-red-800"
                          : e.level === "warn"
                            ? "bg-amber-100 text-amber-900"
                            : "bg-brand-50 text-brand-800"
                      }`}
                    >
                      {e.level}
                    </span>
                    <span className="font-medium text-fg-primary">{e.source}</span>
                    <span className="text-xs text-fg-secondary">{e.created_at}</span>
                  </div>
                  <p className="mt-1 text-fg-secondary">{e.message}</p>
                  {e.detail_json && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-xs text-fg-tertiary hover:text-brand-700">
                        Szczegóły błędu / zdarzenia (JSON)
                      </summary>
                      <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-bg-primary p-2 font-mono text-[11px] text-fg-secondary">
                        {(() => {
                          try {
                            return JSON.stringify(JSON.parse(e.detail_json), null, 2);
                          } catch {
                            return e.detail_json;
                          }
                        })()}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </motion.div>
  );
}

function UserRowCard({
  user,
  onSaved,
  onError,
}: {
  user: Awaited<ReturnType<typeof adminListUsers>>["users"][number];
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [mcp, setMcp] = useState(
    String(user.override?.mcp_monthly_limit ?? user.quotas.mcp.limit),
  );
  const [ai, setAi] = useState(
    String(user.override?.ai_search_weekly_limit ?? user.quotas.ai_search.limit),
  );
  const [notes, setNotes] = useState(user.override?.notes ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <div className="rounded-2xl border border-border-primary bg-bg-secondary p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-fg-primary">
            {user.display_name || user.email || "Użytkownik"}
            {user.is_admin ? (
              <span className="ml-2 rounded-md bg-brand-50 px-1.5 py-0.5 text-xs text-brand-800">
                admin
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 font-mono text-xs text-fg-tertiary">{user.id}</p>
          <p className="text-xs text-fg-secondary">
            {user.email || "brak email"}
            {user.orcid_id ? ` · ORCID ${user.orcid_id}` : ""}
          </p>
        </div>
        <div className="text-right text-xs text-fg-secondary">
          <div>
            AI: {user.quotas.ai_search.used}/{user.quotas.ai_search.limit}
          </div>
          <div>
            MCP: {user.quotas.mcp.used}/{user.quotas.mcp.limit}
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="text-xs font-medium text-fg-secondary">
          Limit MCP / mies.
          <input
            className="mt-1 w-full rounded-lg border border-border-primary px-2 py-1.5 text-sm"
            value={mcp}
            onChange={(e) => setMcp(e.target.value)}
          />
        </label>
        <label className="text-xs font-medium text-fg-secondary">
          Limit AI / tydz.
          <input
            className="mt-1 w-full rounded-lg border border-border-primary px-2 py-1.5 text-sm"
            value={ai}
            onChange={(e) => setAi(e.target.value)}
          />
        </label>
        <label className="text-xs font-medium text-fg-secondary">
          Notatka
          <input
            className="mt-1 w-full rounded-lg border border-border-primary px-2 py-1.5 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={saving}
          onPress={async () => {
            setSaving(true);
            try {
              await adminUpdateQuota({
                user_id: user.id,
                mcp_monthly_limit: Number(mcp),
                ai_search_weekly_limit: Number(ai),
                notes,
              });
              await onSaved();
            } catch (err) {
              onError(err instanceof Error ? err.message : String(err));
            } finally {
              setSaving(false);
            }
          }}
        >
          Zapisz limity
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={saving}
          onPress={async () => {
            setSaving(true);
            try {
              await adminUpdateQuota({
                user_id: user.id,
                reset_ai_used: true,
                reset_mcp_used: true,
                mcp_monthly_limit: Number(mcp),
                ai_search_weekly_limit: Number(ai),
                notes,
              });
              await onSaved();
            } catch (err) {
              onError(err instanceof Error ? err.message : String(err));
            } finally {
              setSaving(false);
            }
          }}
        >
          Reset zużycia
        </Button>
      </div>
    </div>
  );
}
