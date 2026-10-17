/** Shared developer contact strings for MCP + AI error surfaces. */

export const DEVELOPER_EMAIL = "artur@sendyka.dev";
export const DEVELOPER_GITHUB_ISSUES =
  "https://github.com/asterixix/polish-academic-mcp/issues/new";
export const DEVELOPER_SITE = "https://sendyka.dev";

export function supportContactLine(opts?: { includeGithub?: boolean }): string {
  const parts = [`Kontakt do developera: ${DEVELOPER_EMAIL}`];
  if (opts?.includeGithub !== false) {
    parts.push(`zgłoszenia: ${DEVELOPER_GITHUB_ISSUES}`);
  }
  return parts.join(" · ");
}

/** Append support contact to user-facing error text (MCP tools, HTTP JSON). */
export function withDeveloperContact(message: string): string {
  const trimmed = message.trim();
  if (trimmed.includes(DEVELOPER_EMAIL)) return trimmed;
  return `${trimmed}\n\n${supportContactLine()}`;
}

/** Percent-encode mailto fields (never URLSearchParams — spaces become literal "+"). */
export function mailtoBugReport(opts: {
  subject: string;
  body: string;
}): string {
  const subject = encodeURIComponent(opts.subject.slice(0, 120));
  const body = encodeURIComponent(opts.body.slice(0, 3500));
  return `mailto:${DEVELOPER_EMAIL}?subject=${subject}&body=${body}`;
}
