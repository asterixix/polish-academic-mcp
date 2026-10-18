import { Button } from "@/components/ui/Button";
import {
  deleteAccount,
  fetchMe,
  fetchPreferences,
  fetchQuota,
  listThreads,
  logout,
  savePreferences,
  type PublicUser,
  type QuotaResponse,
  type ThreadSummary,
  type UserPreferences,
} from "@/lib/api";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

function Meter({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div>
      <div className="mb-2 flex justify-between text-sm">
        <span className="font-medium text-fg-primary">{label}</span>
        <span className="text-fg-secondary">
          {used} / {limit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-brand-100">
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const STYLE_OPTIONS: Array<{ id: UserPreferences["response_style"]; label: string; help: string }> = [
  { id: "concise", label: "Zwięzły", help: "Krótsze sekcje, bullet points." },
  { id: "detailed", label: "Szczegółowy", help: "Pełny briefing badawczy (domyślny)." },
  { id: "academic", label: "Akademicki", help: "Precyzyjna terminologia i ostrożne wnioski." },
];

const GROUP_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "nauka", label: "Nauka" },
  { id: "dane", label: "Dane" },
  { id: "prawo", label: "Prawo" },
  { id: "normy", label: "Normy" },
  { id: "kultura", label: "Kultura" },
];

function QuotaWarning({ used, limit, reset }: { used: number; limit: number; reset: string }) {
  if (used < limit * 0.8) return null;
  const full = used >= limit;
  return (
    <p role="status" className={`mt-2 text-sm ${full ? "text-red-800" : "text-brand-800"}`}>
      {full
        ? `Wykorzystano cały limit (${limit}). Odnowienie: ${reset}.`
        : `Wykorzystano ${used} z ${limit}. Odnowienie: ${reset}.`}
    </p>
  );
}

export function AccountPage() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [prefs, setPrefs] = useState<UserPreferences>({
    research_context: "",
    response_style: "detailed",
    memory_notes: "",
    default_groups: [],
    default_per_source: 8,
  });
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    void (async () => {
      const me = await fetchMe();
      setUser(me);
      setQuota(await fetchQuota());
      if (me) {
        const p = await fetchPreferences();
        if (p) setPrefs(p);
        setThreads(await listThreads());
      }
    })();
  }, []);

  if (!user) {
    return (
      <div className="rounded-2xl border border-border-primary bg-bg-secondary p-8 text-center shadow-soft">
        <h1 className="font-display text-2xl font-semibold text-brand-700">Konto</h1>
        <p className="mt-2 text-fg-secondary">
          Zaloguj się, żeby zobaczyć limity, prywatny kontekst badacza i historię rozmów.
        </p>
        <div className="mt-5">
          <Link to="/login">
            <Button>Przejdź do logowania</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <div className="rounded-2xl border border-border-primary bg-bg-secondary p-6 shadow-soft">
        <h1 className="font-display text-2xl font-semibold text-brand-700">
          Cześć, {user.display_name || user.email || "badaczu"}
        </h1>
        <p className="mt-2 text-sm text-fg-secondary">
          {user.email && <>E-mail: {user.email}</>}
          {user.email && user.orcid_id && " · "}
          {user.orcid_id && <>ORCID: {user.orcid_id}</>}
        </p>
        <p className="mt-2 text-sm text-fg-secondary">
          UID:{" "}
          <code className="rounded-md bg-brand-50 px-1.5 py-0.5 font-mono text-xs text-brand-800">
            {user.id}
          </code>
          <button
            type="button"
            className="ml-2 text-xs font-medium text-brand-700 hover:underline"
            onClick={() => void navigator.clipboard.writeText(user.id)}
          >
            Kopiuj
          </button>
        </p>
        {user.is_admin && (
          <p className="mt-3">
            <Link to="/admin" className="text-sm font-semibold text-brand-700 hover:underline">
              Panel administratora →
            </Link>
          </p>
        )}

        <div className="mt-6 space-y-5">
          {quota?.ai_search && (
            <div>
              <Meter
                used={quota.ai_search.used}
                limit={quota.ai_search.limit}
                label="AI Search (ten tydzień)"
              />
              <QuotaWarning
                used={quota.ai_search.used}
                limit={quota.ai_search.limit}
                reset={quota.resets.ai_search}
              />
            </div>
          )}
          {quota?.mcp && (
            <div>
              <Meter used={quota.mcp.used} limit={quota.mcp.limit} label="MCP OAuth (ten miesiąc)" />
              {quota.resets.mcp && (
                <QuotaWarning
                  used={quota.mcp.used}
                  limit={quota.mcp.limit}
                  reset={quota.resets.mcp}
                />
              )}
            </div>
          )}
        </div>

        <p className="mt-5 text-sm leading-relaxed text-fg-tertiary">
          Przydziały zapytań odnawiają się automatycznie. W fazie rozwojowej limity są niskie.
        </p>
      </div>

      <div className="rounded-2xl border border-border-primary bg-bg-secondary p-6 shadow-soft">
        <h2 className="font-display text-lg font-semibold text-brand-700">Prywatny kontekst badacza</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Dyscyplina, instytucja, język publikacji, preferowane bazy. Trafia tylko do Twoich
          syntez AI Search.
        </p>
        <label className="mt-4 block text-sm font-medium text-fg-secondary">
          Kontekst
          <textarea
            className="mt-1.5 min-h-28 w-full rounded-xl border border-border-primary bg-bg-secondary px-3 py-2.5 text-sm text-fg-primary outline-none focus:border-brand-400"
            value={prefs.research_context}
            onChange={(e) => setPrefs((p) => ({ ...p, research_context: e.target.value }))}
            maxLength={4000}
            placeholder="Np. historia nauki / UJ / preferuję RUJ, Bibliotekę Nauki, ISAP…"
          />
        </label>

        <h3 className="mt-6 text-sm font-semibold text-fg-primary">Styl odpowiedzi</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setPrefs((p) => ({ ...p, response_style: opt.id }))}
              className={`rounded-xl border px-3 py-3 text-left transition ${
                prefs.response_style === opt.id
                  ? "border-brand-700 bg-brand-50 text-brand-800"
                  : "border-border-primary bg-bg-secondary text-fg-secondary hover:border-brand-200"
              }`}
            >
              <div className="text-sm font-semibold">{opt.label}</div>
              <div className="mt-1 text-xs opacity-80">{opt.help}</div>
            </button>
          ))}
        </div>

        <h3 className="mt-6 text-sm font-semibold text-fg-primary">Domyślne kategorie źródeł</h3>
        <p className="mt-1 text-xs text-fg-tertiary">
          Dodawane do wyszukiwań AI Search (maks. 3 kategorie łącznie z tymi wykrytymi w pytaniu).
          Zaznaczenie żadnej = automatyczny dobór.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {GROUP_OPTIONS.map((g) => {
            const on = prefs.default_groups.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setPrefs((p) => ({
                    ...p,
                    default_groups: on
                      ? p.default_groups.filter((x) => x !== g.id)
                      : [...p.default_groups, g.id],
                  }))
                }
                className={`rounded-full border px-3 py-1 text-sm transition ${
                  on
                    ? "border-brand-700 bg-brand-50 text-brand-800"
                    : "border-border-primary text-fg-secondary hover:border-brand-200"
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>

        <label className="mt-6 block text-sm font-medium text-fg-secondary">
          Wyników na źródło: {prefs.default_per_source}
          <input
            type="range"
            min={1}
            max={10}
            value={prefs.default_per_source}
            onChange={(e) => setPrefs((p) => ({ ...p, default_per_source: Number(e.target.value) }))}
            className="mt-2 block w-full"
          />
        </label>

        <label className="mt-6 block text-sm font-medium text-fg-secondary">
          Memory (notatki trwałe)
          <textarea
            className="mt-1.5 min-h-24 w-full rounded-xl border border-border-primary bg-bg-secondary px-3 py-2.5 text-sm text-fg-primary outline-none focus:border-brand-400"
            value={prefs.memory_notes}
            onChange={(e) => setPrefs((p) => ({ ...p, memory_notes: e.target.value }))}
            maxLength={4000}
            placeholder="Fakty, których asystent ma pamiętać między rozmowami (projekty, skróty, ograniczenia)."
          />
        </label>

        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        {saveMsg && <p className="mt-3 text-sm text-brand-700">{saveMsg}</p>}

        <div className="mt-4">
          <Button
            disabled={saving}
            onPress={async () => {
              setSaving(true);
              setError("");
              setSaveMsg("");
              try {
                const saved = await savePreferences(prefs);
                setPrefs(saved);
                setSaveMsg("Zapisano preferencje.");
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Zapisuję…" : "Zapisz preferencje"}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border-primary bg-bg-secondary p-6 shadow-soft">
        <h2 className="font-display text-lg font-semibold text-brand-700">Historia rozmów</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Zapisane wątki AI Search. Możesz wrócić do rozmowy następnego dnia.
        </p>
        {threads.length === 0 ? (
          <p className="mt-4 text-sm text-fg-tertiary">Brak zapisanych rozmów.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border-primary">
            {threads.slice(0, 12).map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link
                    to={`/?thread=${encodeURIComponent(t.id)}`}
                    className="block truncate text-sm font-medium text-brand-700 hover:underline"
                  >
                    {t.title || "Rozmowa"}
                  </Link>
                  <p className="truncate text-xs text-fg-tertiary">
                    {t.preview || t.updated_at}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-fg-tertiary">
                  {new Date(t.updated_at).toLocaleDateString("pl-PL")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">
            Otwórz wyszukiwanie →
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-brand-200 bg-brand-25/60 p-6">
        <h2 className="font-display text-lg font-semibold text-brand-700">Pakiety dostępu</h2>
        <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
          Wkrótce: płatne pakiety z wyższymi limitami AI Search i MCP (dla laboratoriów,
          bibliotek i zespołów badawczych). Miejsce na zakup pojawi się tutaj.
        </p>
        <p className="mt-3 text-xs text-fg-tertiary">Obecnie: faza rozwojowa, bez sprzedaży w aplikacji.</p>
      </div>

      <div className="rounded-2xl border border-border-primary bg-bg-secondary p-6 shadow-soft">
        <div className="flex flex-wrap gap-2">
          <Link to="/connectors">
            <Button>Instrukcje konektorów</Button>
          </Link>
          <Button
            variant="secondary"
            onPress={async () => {
              await logout();
              navigate("/");
              location.reload();
            }}
          >
            Wyloguj
          </Button>
        </div>

        <div className="mt-8 border-t border-border-primary pt-6">
          <h2 className="text-sm font-semibold text-red-800">Strefa niebezpieczna</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            Usunięcie konta kasuje preferencje, historię rozmów i tokeny OAuth. Operacja jest
            nieodwracalna.
          </p>
          <div className="mt-3">
            <Button
              variant="secondary"
              onPress={async () => {
                const ok = window.confirm(
                  "Na pewno usunąć konto i całą historię rozmów? Tej operacji nie da się cofnąć.",
                );
                if (!ok) return;
                try {
                  await deleteAccount();
                  navigate("/");
                  location.reload();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              Usuń konto
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
