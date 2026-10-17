import changelog from "@/generated/changelog.json";
import { Link } from "react-router-dom";

type Commit = {
  sha: string;
  sha_full?: string;
  date: string;
  message: string;
  url: string;
};

const data = changelog as {
  generated_at: string;
  repository: string;
  package_version: string;
  cloud_version: string;
  latest_commit: Commit | null;
  github: { pushed_at?: string; updated_at?: string; description?: string } | null;
  source: string;
  commits: Commit[];
};

function formatDate(iso: string | undefined) {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ChangelogPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <p className="text-sm font-medium text-brand-600">Repozytorium</p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-brand-700">
        Changelog i aktualizacje
      </h1>
      <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-fg-secondary">
        Snapshot budowany przy deployu z GitHuba (bez ciągłego odświeżania w przeglądarce). Po każdym
        nowym buildzie widać ostatni commit i historię zmian serwera MCP.
      </p>

      <div className="mt-6 grid gap-3 rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-tertiary">Wersja npm</p>
          <p className="mt-1 font-mono text-sm text-fg-primary">v{data.package_version}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-tertiary">Cloud</p>
          <p className="mt-1 font-mono text-sm text-fg-primary">v{data.cloud_version}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-tertiary">Ostatni commit</p>
          <p className="mt-1 font-mono text-sm text-fg-primary">
            {data.latest_commit?.sha ?? "-"} · {formatDate(data.latest_commit?.date)}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-tertiary">Snapshot build</p>
          <p className="mt-1 font-mono text-sm text-fg-primary">{formatDate(data.generated_at)}</p>
        </div>
      </div>

      {data.github?.description && (
        <p className="mt-4 text-sm text-fg-secondary">{data.github.description}</p>
      )}

      <p className="mt-2 text-xs text-fg-tertiary">
        Źródło: {data.source}
        {data.github?.pushed_at ? ` · GitHub pushed ${formatDate(data.github.pushed_at)}` : ""}
      </p>

      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <a
          href={data.repository}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-brand-600 hover:underline"
        >
          github.com/asterixix/polish-academic-mcp
        </a>
        <Link to="/" className="text-fg-secondary hover:text-brand-700">
          Wróć do wyszukiwania
        </Link>
      </div>

      <ol className="mt-8 divide-y divide-border-primary rounded-2xl border border-border-primary bg-bg-secondary">
        {data.commits.map((c) => (
          <li key={c.sha_full || c.sha} className="px-4 py-3.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs font-semibold text-brand-700 hover:underline"
              >
                {c.sha}
              </a>
              <span className="text-xs text-fg-tertiary">{formatDate(c.date)}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-fg-primary">{c.message}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}
