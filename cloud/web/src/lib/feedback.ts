export const FEEDBACK_EMAIL = "artur@sendyka.dev";
export const FEEDBACK_GITHUB_ISSUES =
  "https://github.com/asterixix/polish-academic-mcp/issues/new";

/**
 * Build a mailto: URL with proper percent-encoding.
 * Do NOT use URLSearchParams — it encodes spaces as "+" (form-urlencoded),
 * which many mail clients display literally instead of as spaces.
 */
export function mailtoFeedback(opts: {
  subject: string;
  body: string;
}): string {
  const subject = encodeURIComponent(opts.subject.slice(0, 120));
  const body = encodeURIComponent(opts.body.slice(0, 3500));
  return `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
}

export function errorMailto(opts: {
  title: string;
  detail?: string;
  traceId?: string | null;
  path?: string;
}): string {
  const detail = (opts.detail || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  const lines = [
    "Zgłoszenie problemu — Polish Academic MCP",
    "",
    `Opis: ${opts.title}`,
    detail ? `Szczegóły: ${detail}` : null,
    "",
    `Trace ID: ${opts.traceId || "n/d"}`,
    `URL: ${opts.path || (typeof location !== "undefined" ? location.href : "https://pamcp.pl")}`,
    `Czas (UTC): ${new Date().toISOString()}`,
    `Przeglądarka: ${typeof navigator !== "undefined" ? navigator.userAgent : "n/d"}`,
    "",
    "Proszę opisać oczekiwane vs faktyczne zachowanie poniżej:",
    "",
  ].filter((l) => l !== null) as string[];
  return mailtoFeedback({
    subject: `[PAMCP] Błąd: ${opts.title}`.slice(0, 120),
    body: lines.join("\n"),
  });
}

export function withFeedbackHint(message: string): string {
  if (message.includes(FEEDBACK_EMAIL)) return message;
  return `${message.trim()}\n\nJeśli problem się powtarza, napisz na ${FEEDBACK_EMAIL} lub zgłoś issue: ${FEEDBACK_GITHUB_ISSUES}`;
}
