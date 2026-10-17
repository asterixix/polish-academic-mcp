import { Button } from "@/components/ui/Button";
import { FEEDBACK_EMAIL, FEEDBACK_GITHUB_ISSUES, errorMailto } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { RefreshCcw01 } from "@untitledui/icons";

export function ErrorReport({
  title,
  detail,
  traceId,
  className,
  onRetry,
  retryDisabled,
}: {
  title: string;
  detail?: string;
  traceId?: string | null;
  className?: string;
  /** Ponów to samo zapytanie (błąd systemu / połączenia). */
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  const mail = errorMailto({ title, detail, traceId });
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900",
        className,
      )}
    >
      <p className="font-semibold">{title}</p>
      {detail ? <p className="mt-1 whitespace-pre-wrap text-red-800/90">{detail}</p> : null}
      {traceId ? (
        <p className="mt-1 font-mono text-xs text-red-800/80">Trace: {traceId}</p>
      ) : null}
      {onRetry ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="!border-red-200 !bg-white !text-red-900 hover:!bg-red-100"
            isDisabled={retryDisabled}
            onPress={onRetry}
            aria-label="Ponów wyszukiwanie tego samego pytania"
          >
            <RefreshCcw01 className="size-3.5" aria-hidden />
            Ponów wyszukiwanie
          </Button>
        </div>
      ) : null}
      <p className="mt-2 text-xs leading-relaxed text-red-900/90">
        Zgłoś developerowi:{" "}
        <a className="font-semibold underline" href={mail}>
          {FEEDBACK_EMAIL}
        </a>
        {" · "}
        <a
          className="font-semibold underline"
          href={FEEDBACK_GITHUB_ISSUES}
          target="_blank"
          rel="noreferrer"
        >
          GitHub Issues
        </a>
      </p>
    </div>
  );
}
