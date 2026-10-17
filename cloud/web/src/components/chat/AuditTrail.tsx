import { Button } from "@/components/ui/Button";
import type { AuditLog, AuditStep, LlmCallEvent, TokenUsage } from "@/lib/api";
import { downloadAuditJson, downloadAuditMarkdown } from "@/lib/audit-export";
import { cn } from "@/lib/utils";
import {
  Activity,
  ChevronDown,
  Clock,
  Code01,
  Download01,
  Eye,
  File01,
} from "@untitledui/icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";

function TokenPill({ usage, label }: { usage?: TokenUsage; label?: string }) {
  if (!usage) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border-primary bg-brand-25 px-2 py-0.5 font-mono text-[11px] text-brand-800">
      {label ? `${label}: ` : ""}
      {usage.input_tokens}+{usage.output_tokens}={usage.total_tokens}
      {usage.estimated ? " ~" : ""}
    </span>
  );
}

function CollapsibleBlock({
  title,
  children,
  defaultOpen = false,
  mono = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  mono?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border-primary pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 py-1 text-left text-xs font-semibold text-fg-secondary hover:text-brand-700"
      >
        <span>{title}</span>
        <ChevronDown className={cn("size-3.5 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div
          className={cn(
            "mt-1 max-h-64 overflow-auto rounded-lg border border-border-primary bg-zinc-50 p-2 text-[11px] leading-relaxed text-fg-primary",
            mono && "font-mono whitespace-pre-wrap",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: AuditStep }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-border-primary last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 py-2.5 text-left"
      >
        <span className="mt-0.5 size-2 shrink-0 rounded-sm bg-brand-600" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-fg-primary">{step.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-fg-tertiary">
            <span className="font-mono">{step.phase}</span>
            {typeof step.duration_ms === "number" && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {step.duration_ms} ms
              </span>
            )}
          </span>
        </span>
        <ChevronDown className={cn("mt-1 size-3.5 shrink-0 text-fg-tertiary transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mb-2 ml-5 space-y-2">
          {step.detail && <p className="text-xs text-fg-secondary">{step.detail}</p>}
          {step.data && (
            <pre className="max-h-40 overflow-auto rounded-lg bg-zinc-50 p-2 font-mono text-[10px] text-fg-secondary">
              {JSON.stringify(step.data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

function LlmBlock({ call }: { call: LlmCallEvent }) {
  return (
    <div className="rounded-xl border border-border-primary bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Code01 className="size-3.5 text-brand-600" />
        <span className="text-sm font-semibold text-fg-primary">
          LLM {call.phase}
        </span>
        <span className="font-mono text-[11px] text-fg-tertiary">
          {call.provider} / {call.model}
        </span>
        <TokenPill usage={call.usage} />
        <span className="inline-flex items-center gap-1 text-[11px] text-fg-tertiary">
          <Clock className="size-3" />
          {call.duration_ms} ms
        </span>
      </div>
      <CollapsibleBlock title="System prompt" mono>
        {call.system_prompt}
      </CollapsibleBlock>
      <CollapsibleBlock title="Messages (pełny kontekst)" mono>
        {JSON.stringify(call.messages, null, 2)}
      </CollapsibleBlock>
      <CollapsibleBlock title="Wygenerowany tekst (tokeny wyjściowe)" mono defaultOpen>
        {call.response_text || "(brak tekstu - tylko tool_use)"}
      </CollapsibleBlock>
      {call.tool_calls?.length > 0 && (
        <CollapsibleBlock title={`Tool calls (${call.tool_calls.length})`} mono>
          {JSON.stringify(call.tool_calls, null, 2)}
        </CollapsibleBlock>
      )}
    </div>
  );
}

export type LiveTrace = {
  traceId: string | null;
  steps: AuditStep[];
  thoughts: Array<{ phase: string; message: string }>;
  llmCalls: LlmCallEvent[];
  tokens: TokenUsage | null;
  audit: AuditLog | null;
};

export function AuditTrail({
  status,
  sources,
  live,
  running,
}: {
  status: string;
  sources: Array<{ tool: string; preview: string; isError?: boolean }>;
  live: LiveTrace;
  running: boolean;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(true);
  const hasContent =
    Boolean(status) ||
    sources.length > 0 ||
    live.steps.length > 0 ||
    live.llmCalls.length > 0 ||
    Boolean(live.audit);

  if (!hasContent) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-2xl border border-border-primary bg-white/95 shadow-soft"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border-primary px-4 py-3">
          <Activity className="size-4 text-brand-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg-primary">Ślad audytu (100% transparentność)</p>
            <p className="text-xs text-fg-tertiary">
              Kroki, myśli, prompty, odpowiedzi LLM i tokeny. Do pobrania na analizy naukowe.
            </p>
          </div>
          {live.tokens && <TokenPill usage={live.tokens} label="suma" />}
          {live.audit && (
            <>
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={() => downloadAuditJson(live.audit!)}
                className="gap-1.5"
              >
                <Download01 className="size-3.5" />
                JSON
              </Button>
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={() => downloadAuditMarkdown(live.audit!)}
                className="gap-1.5"
              >
                <File01 className="size-3.5" />
                MD
              </Button>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-border-primary p-1.5 text-fg-secondary hover:bg-brand-25"
            aria-label={open ? "Zwiń ślad" : "Rozwiń ślad"}
          >
            <Eye className="size-3.5" />
          </button>
        </div>

        {open && (
          <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1.1fr]">
            <div>
              {status && (
                <p className="mb-3 flex items-center gap-2 text-sm text-fg-secondary">
                  <span
                    className={cn(
                      "size-2 rounded-sm bg-brand-500",
                      running && !reduce && "animate-pulse",
                    )}
                  />
                  {status}
                </p>
              )}
              {live.traceId && (
                <p className="mb-3 font-mono text-[10px] text-fg-tertiary">trace: {live.traceId}</p>
              )}
              {live.thoughts.length > 0 && (
                <div className="mb-4 space-y-1.5">
                  {live.thoughts.map((t, i) => (
                    <p key={`${t.phase}-${i}`} className="text-xs leading-relaxed text-fg-secondary">
                      <span className="font-semibold text-brand-700">{t.phase}: </span>
                      {t.message}
                    </p>
                  ))}
                </div>
              )}
              <ol className="divide-y divide-border-primary">
                {live.steps.map((s) => (
                  <StepRow key={`${s.id}-${s.ended_at || "live"}`} step={s} />
                ))}
              </ol>
              {sources.length > 0 && (
                <div className="mt-4 grid gap-2">
                  <p className="text-xs font-semibold text-fg-primary">Podgląd źródeł</p>
                  {sources.map((s) => (
                    <div
                      key={`${s.tool}-${s.preview.slice(0, 24)}`}
                      className="rounded-xl border border-border-primary bg-brand-25/50 p-3"
                    >
                      <div className="text-xs font-semibold text-brand-700">{s.tool}</div>
                      <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-fg-tertiary">
                        {s.preview}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold text-fg-primary">Wywołania modelu (pełne tokeny)</p>
              {live.llmCalls.length === 0 && (
                <p className="text-xs text-fg-tertiary">
                  {running ? "Oczekuję na odpowiedź LLM…" : "Brak wywołań LLM w tej sesji."}
                </p>
              )}
              {live.llmCalls.map((c) => (
                <LlmBlock key={c.id} call={c} />
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
