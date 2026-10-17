import { BetaBanner } from "@/components/layout/BetaBanner";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Button } from "@/components/ui/Button";
import {
  FEEDBACK_EMAIL,
  FEEDBACK_GITHUB_ISSUES,
  fetchMe,
  fetchQuota,
  logout,
  type PublicUser,
  type QuotaResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

const nav = [
  { to: "/", label: "Szukaj", end: true },
  { to: "/connectors", label: "Konektory" },
  { to: "/docs", label: "Dokumentacja" },
  { to: "/projekt", label: "Projekt" },
  { to: "/account", label: "Konto" },
];

export function AppShell() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    void (async () => {
      const [me, q] = await Promise.all([fetchMe(), fetchQuota()]);
      setUser(me);
      setQuota(q);
    })();
  }, []);

  return (
    <div className="min-h-[100dvh]">
      <a href="#main-content" className="skip-link">
        Przejdź do treści
      </a>
      <BetaBanner />
      <header className="border-b border-border-primary/80 bg-bg-primary/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 md:px-6">
          <Link
            to="/"
            className="flex min-w-0 flex-1 items-center gap-3 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 rounded-lg"
          >
            <img
              src="/logo.jpg"
              alt="Polish Academic MCP"
              className="size-10 rounded-xl"
              width={40}
              height={40}
            />
            <div className="min-w-0 leading-tight">
              <div className="truncate font-display text-sm font-semibold text-brand-700 md:text-base">
                Polish Academic MCP
              </div>
              <div className="hidden text-xs text-fg-secondary sm:block">
                Polskie bazy w jednym oknie rozmowy
              </div>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Główna nawigacja">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "min-h-10 rounded-full px-3.5 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                    isActive ? "bg-brand-50 text-brand-800" : "text-fg-secondary hover:bg-brand-50/70",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
            {user?.is_admin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  cn(
                    "min-h-10 rounded-full px-3.5 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                    isActive ? "bg-brand-50 text-brand-800" : "text-fg-secondary hover:bg-brand-50/70",
                  )
                }
              >
                Admin
              </NavLink>
            )}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            {quota?.ai_search && (
              <span
                className="hidden rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 sm:inline"
                aria-label={`Wykorzystanie AI: ${quota.ai_search.used} z ${quota.ai_search.limit}`}
              >
                AI {quota.ai_search.used}/{quota.ai_search.limit}
              </span>
            )}
            {user ? (
              <Button
                variant="secondary"
                size="sm"
                onPress={async () => {
                  await logout();
                  setUser(null);
                  navigate("/");
                  location.reload();
                }}
              >
                Wyloguj
              </Button>
            ) : (
              <Button size="sm" onPress={() => navigate("/login")}>
                Zaloguj
              </Button>
            )}
          </div>
        </div>

        <nav
          className="flex gap-1 overflow-x-auto border-t border-border-primary/60 px-4 py-2 md:hidden"
          aria-label="Nawigacja mobilna"
        >
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "min-h-10 shrink-0 rounded-full px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                  isActive ? "bg-brand-50 text-brand-800" : "text-fg-secondary",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
          {user?.is_admin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                cn(
                  "min-h-10 shrink-0 rounded-full px-3 py-2 text-sm font-medium",
                  isActive ? "bg-brand-50 text-brand-800" : "text-fg-secondary",
                )
              }
            >
              Admin
            </NavLink>
          )}
        </nav>
      </header>

      <motion.main
        id="main-content"
        tabIndex={-1}
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10 outline-none"
      >
        <Outlet context={{ user, quota, setQuota, refreshUser: async () => setUser(await fetchMe()) }} />
      </motion.main>

      <footer className="border-t border-border-primary bg-bg-secondary/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-fg-secondary md:flex-row md:items-start md:justify-between md:px-6">
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
              Autor aplikacji
            </p>
            <p className="font-semibold text-fg-primary">Artur Sendyka</p>
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              <a
                href="https://sendyka.dev"
                className="min-h-9 inline-flex items-center text-brand-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                sendyka.dev
              </a>
              <a
                href="https://github.com/asterixix/polish-academic-mcp"
                className="min-h-9 inline-flex items-center text-brand-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
              <a
                href={`mailto:${FEEDBACK_EMAIL}`}
                className="min-h-9 inline-flex items-center text-brand-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                {FEEDBACK_EMAIL}
              </a>
            </p>
            <p className="text-xs text-fg-secondary">
              Ostatnia aktualizacja MCP:{" "}
              <Link
                to="/changelog"
                className="font-medium text-brand-700 underline-offset-2 hover:underline"
              >
                changelog
              </Link>
            </p>
            <p className="pt-1 text-xs text-fg-secondary">
              Zgłaszanie błędów (UI, MCP, limity):{" "}
              <a href={`mailto:${FEEDBACK_EMAIL}`} className="text-brand-700 underline">
                {FEEDBACK_EMAIL}
              </a>
              {" · "}
              <a
                href={FEEDBACK_GITHUB_ISSUES}
                className="text-brand-700 underline"
                target="_blank"
                rel="noreferrer"
              >
                GitHub Issues
              </a>
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link
              to="/changelog"
              className="min-h-9 inline-flex items-center hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Changelog
            </Link>
            <Link
              to="/privacy"
              className="min-h-9 inline-flex items-center hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Polityka prywatności
            </Link>
            <Link
              to="/terms"
              className="min-h-9 inline-flex items-center hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Regulamin
            </Link>
            <Link
              to="/connectors"
              className="min-h-9 inline-flex items-center hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Konektory MCP
            </Link>
            <Link
              to="/docs"
              className="min-h-9 inline-flex items-center hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Dokumentacja MCP
            </Link>
            {user?.is_admin && (
              <Link
                to="/admin"
                className="min-h-9 inline-flex items-center font-medium text-brand-700 underline-offset-2 hover:underline"
              >
                Admin
              </Link>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
