import type { AuditLog, TokenUsage } from "@/lib/api";

function fmtTokens(u: TokenUsage | undefined): string {
  if (!u) return "n/a";
  const note = u.estimated ? " (szacowane)" : "";
  return `in ${u.input_tokens} + out ${u.output_tokens} = ${u.total_tokens}${note}`;
}

export function auditToMarkdown(log: AuditLog): string {
  const lines: string[] = [
    `# Log audytu AI - Polish Academic MCP`,
    ``,
    `- Schema: \`${log.schema}\``,
    `- Trace ID: \`${log.trace_id}\``,
    `- Utworzono: ${log.created_at}`,
    `- Zakończono: ${log.completed_at ?? "niedokończone"}`,
    `- Zalogowany: ${log.authenticated ? "tak" : "nie"}`,
    `- User ID: ${log.user_id ?? "anon"}`,
    `- Query: ${log.query}`,
    `- Grupy: ${(log.groups || []).join(", ") || "-"}`,
    `- Źródła (${log.source_ids?.length ?? 0}): ${(log.source_ids || []).join(", ") || "-"}`,
    `- Tokeny łącznie: ${fmtTokens(log.token_totals)}`,
    ``,
  ];

  if (log.error) {
    lines.push(`## Błąd`, ``, log.error, ``);
  }

  lines.push(`## Kroki`, ``);
  for (const step of log.steps || []) {
    lines.push(
      `### ${step.title}`,
      `- Phase: \`${step.phase}\``,
      `- Start: ${step.started_at}`,
      `- End: ${step.ended_at ?? "-"}`,
      `- Czas: ${step.duration_ms ?? "-"} ms`,
    );
    if (step.detail) lines.push(`- Detail: ${step.detail}`);
    if (step.data) lines.push(``, "```json", JSON.stringify(step.data, null, 2), "```");
    lines.push(``);
  }

  lines.push(`## Wywołania LLM`, ``);
  for (const call of log.llm_calls || []) {
    lines.push(
      `### ${call.phase} (${call.provider} / ${call.model})`,
      `- Tokeny: ${fmtTokens(call.usage)}`,
      `- Czas: ${call.duration_ms} ms`,
      `- max_tokens: ${call.max_tokens}`,
      `- temperature: ${call.temperature ?? "default"}`,
      `- stop_reason: ${call.stop_reason ?? "-"}`,
      ``,
      `#### System prompt`,
      ``,
      "```",
      call.system_prompt,
      "```",
      ``,
      `#### Messages`,
      ``,
      "```json",
      JSON.stringify(call.messages, null, 2),
      "```",
      ``,
      `#### Response`,
      ``,
      "```",
      call.response_text || "(puste)",
      "```",
      ``,
    );
    if (call.tool_calls?.length) {
      lines.push(`#### Tool calls`, ``, "```json", JSON.stringify(call.tool_calls, null, 2), "```", ``);
    }
  }

  lines.push(`## Wywołania narzędzi`, ``);
  for (const tc of log.tool_calls || []) {
    lines.push(
      `### ${tc.name}${tc.is_error ? " (błąd)" : ""}`,
      `- Czas: ${tc.duration_ms} ms`,
      `- Znaki odpowiedzi: ${tc.response_chars}`,
      ``,
      `#### Arguments`,
      ``,
      "```json",
      JSON.stringify(tc.arguments, null, 2),
      "```",
      ``,
      `#### Response`,
      ``,
      "```",
      tc.response_text,
      "```",
      ``,
    );
  }

  if (log.answer) {
    lines.push(`## Odpowiedź końcowa`, ``, log.answer, ``);
  }
  if (log.followups?.length) {
    lines.push(`## Pytania dopytujące`, ``, ...log.followups.map((f) => `- ${f}`), ``);
  }

  return lines.join("\n");
}

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadAuditJson(log: AuditLog) {
  downloadText(
    `ai-audit-${log.trace_id}.json`,
    JSON.stringify(log, null, 2),
    "application/json;charset=utf-8",
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function copyAuditMarkdown(log: AuditLog) {
  return copyText(auditToMarkdown(log));
}

export type ConversationExportMessage = {
  role: string;
  content: string;
};

export function conversationToMarkdown(opts: {
  title?: string;
  threadId?: string | null;
  messages: ConversationExportMessage[];
  audits?: AuditLog[];
}): string {
  const lines: string[] = [
    `# Historia rozmowy - Polish Academic MCP`,
    ``,
    `- Tytuł: ${opts.title || "Rozmowa"}`,
    `- Thread ID: \`${opts.threadId || "n/d"}\``,
    `- Eksport: ${new Date().toISOString()}`,
    `- Liczba wiadomości: ${opts.messages.length}`,
    ``,
    `## Wiadomości`,
    ``,
  ];
  for (const m of opts.messages) {
    const who = m.role === "user" ? "Użytkownik" : m.role === "assistant" ? "Asystent" : m.role;
    lines.push(`### ${who}`, ``, m.content || "(puste)", ``);
  }
  if (opts.audits?.length) {
    lines.push(`## Logi audytu`, ``);
    for (const log of opts.audits) {
      lines.push(auditToMarkdown(log), ``, `---`, ``);
    }
  }
  return lines.join("\n");
}

export function copyConversationMarkdown(opts: {
  title?: string;
  threadId?: string | null;
  messages: ConversationExportMessage[];
  audits?: AuditLog[];
}) {
  return copyText(conversationToMarkdown(opts));
}

export function downloadConversation(opts: {
  title?: string;
  threadId?: string | null;
  messages: ConversationExportMessage[];
  audits?: AuditLog[];
  format: "json";
}) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const base = `pamcp-rozmowa-${stamp}`;
  downloadText(
    `${base}.json`,
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        thread_id: opts.threadId,
        title: opts.title,
        messages: opts.messages,
        audits: opts.audits ?? [],
      },
      null,
      2,
    ),
    "application/json;charset=utf-8",
  );
}
