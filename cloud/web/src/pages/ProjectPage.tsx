import { AnswerMarkdown } from "@/components/chat/AnswerMarkdown";
import { useEffect, useState } from "react";

const README_RAW_URL =
  "https://raw.githubusercontent.com/asterixix/polish-academic-mcp/main/README.md";
const REPO_URL = "https://github.com/asterixix/polish-academic-mcp";

interface RepoMeta {
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  updated_at?: string;
  license?: { spdx_id?: string };
}

/** Informacje o projekcie pobierane na żywo z README.md na GitHubie (zawsze aktualne). */
export function ProjectPage() {
  const [readme, setReadme] = useState<string | null>(null);
  const [repo, setRepo] = useState<RepoMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [mdRes, repoRes] = await Promise.all([
          fetch(README_RAW_URL),
          fetch("https://api.github.com/repos/asterixix/polish-academic-mcp", {
            headers: { Accept: "application/vnd.github+json" },
          }),
        ]);
        if (!mdRes.ok) throw new Error(`GitHub zwrócił HTTP ${mdRes.status}`);
        const md = await mdRes.text();
        if (cancelled) return;
        setReadme(md);
        if (repoRes.ok) setRepo((await repoRes.json()) as RepoMeta);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Nie udało się pobrać README z GitHuba");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <p className="mb-2 text-sm font-medium text-brand-700">O projekcie</p>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-brand-700 md:text-4xl">
        Polish Academic MCP — informacje o projekcie
      </h1>
      <p className="mt-3 text-base leading-relaxed text-fg-secondary">
        Poniższa dokumentacja jest pobierana na żywo z pliku{" "}
        <a
          href={`${REPO_URL}/blob/main/README.md`}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-brand-700 underline"
        >
          README.md w repozytorium GitHub
        </a>
        , dzięki czemu zawsze pokazuje aktualne informacje o projekcie: obsługiwane bazy i
        narzędzia, instalację, wybór źródeł, zmienne środowiskowe i rozwiązywanie problemów.
      </p>
      {repo && (
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-fg-secondary">
          {typeof repo.stargazers_count === "number" && (
            <span className="rounded-full bg-brand-50 px-3 py-1.5 text-brand-800">
              ★ {repo.stargazers_count}
            </span>
          )}
          {typeof repo.forks_count === "number" && (
            <span className="rounded-full bg-brand-50 px-3 py-1.5 text-brand-800">
              Forki: {repo.forks_count}
            </span>
          )}
          {repo.license?.spdx_id && (
            <span className="rounded-full bg-brand-50 px-3 py-1.5 text-brand-800">
              Licencja: {repo.license.spdx_id}
            </span>
          )}
          {repo.updated_at && (
            <span className="rounded-full bg-brand-50 px-3 py-1.5 text-brand-800">
              Aktualizacja repozytorium: {new Date(repo.updated_at).toLocaleDateString("pl-PL")}
            </span>
          )}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-brand-700 px-3 py-1.5 text-white hover:bg-brand-800"
          >
            github.com/asterixix/polish-academic-mcp
          </a>
        </div>
      )}
      <div className="mt-6 rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft md:p-7">
        {error ? (
          <p className="text-sm leading-relaxed text-fg-secondary">
            Nie udało się pobrać README.md z GitHuba ({error}). Zobacz dokumentację bezpośrednio:{" "}
            <a
              href={`${REPO_URL}/blob/main/README.md`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-700 underline"
            >
              README.md na GitHubie
            </a>
            .
          </p>
        ) : readme ? (
          <AnswerMarkdown text={readme} />
        ) : (
          <p className="text-sm text-fg-secondary" aria-live="polite">
            Pobieram README.md z GitHuba…
          </p>
        )}
      </div>
    </div>
  );
}
