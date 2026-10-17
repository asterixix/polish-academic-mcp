import { AnswerMarkdown } from "@/components/chat/AnswerMarkdown";
import { AuditTrail } from "@/components/chat/AuditTrail";
import { useChatMeta } from "@/components/chat/RuntimeProvider";
import { ErrorReport } from "@/components/ErrorReport";
import { Button } from "@/components/ui/Button";
import { FEEDBACK_EMAIL, FEEDBACK_GITHUB_ISSUES } from "@/lib/api";
import { errorMailto } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from "@assistant-ui/react";
import { ArrowUp, BookOpen01, Loading02, Trash01, Download01 } from "@untitledui/icons";
import { motion } from "motion/react";

const suggestions = [
  "Co mówią orzeczenia SAOS o kredytach frankowych po 2020?",
  "Artykuły o energii odnawialnej w Bibliotece Nauki z 2024",
  "Bezrobocie w województwie małopolskim według GUS BDL",
  "Ustawy ISAP dotyczące ochrony danych osobowych",
];

const groups = [
  { id: "", label: "Wszystkie" },
  { id: "nauka", label: "Nauka" },
  { id: "prawo", label: "Prawo" },
  { id: "dane", label: "Dane" },
  { id: "normy", label: "Normy" },
  { id: "kultura", label: "Kultura" },
];

function looksLikeError(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("wykorzystano limit") ||
    t.includes("błąd") ||
    t.includes("error") ||
    t.includes("nie udało") ||
    t.includes("wyczerpany") ||
    t.includes("niedostępna")
  );
}

function AssistantBubble() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border-primary bg-white px-4 py-3 shadow-soft"
      role="article"
      aria-label="Odpowiedź asystenta"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-700">
        <BookOpen01 className="size-3.5" aria-hidden />
        Odpowiedź
      </div>
      <div className="text-[15px] leading-relaxed text-fg-primary">
        <MessagePrimitive.Content
          components={{
            Empty: () => (
              <span className="inline-flex items-center gap-2 text-fg-secondary" aria-live="polite">
                <Loading02 className="size-4 animate-spin" aria-hidden /> Zbieram źródła i
                pogłębiam rekordy…
              </span>
            ),
            Text: ({ text }) =>
              looksLikeError(text) ? (
                <ErrorReport title="Komunikat systemu" detail={text} />
              ) : (
                <AnswerMarkdown text={text} />
              ),
          }}
        />
      </div>
    </motion.div>
  );
}

function UserBubble() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="ml-auto max-w-[85%] rounded-2xl bg-brand-700 px-4 py-3 text-[15px] leading-relaxed text-white"
      role="article"
      aria-label="Twoje pytanie"
    >
      <MessagePrimitive.Content />
    </motion.div>
  );
}

export function Thread() {
  const {
    status,
    sources,
    groupFilter,
    setGroupFilter,
    isRunning,
    live,
    authenticated,
    threads,
    threadId,
    messages,
    startNewThread,
    openThread,
    removeThread,
    downloadHistory,
  } = useChatMeta();

  const hasMessages = messages.length > 0;
  const reportMail = errorMailto({
    title: status || "Problem w rozmowie",
    detail: messages.filter((m) => m.role === "assistant").at(-1)?.content?.slice(0, 400),
    traceId: live.traceId,
  });

  return (
    <ThreadPrimitive.Root className="flex min-h-[70dvh] flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border-primary bg-white/80 px-3 py-2.5 shadow-soft">
        {authenticated ? (
          <>
            <span className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">
              Rozmowy
            </span>
            <button
              type="button"
              onClick={startNewThread}
              className="min-h-9 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Nowa
            </button>
            <div
              className="flex max-w-full flex-1 gap-1.5 overflow-x-auto"
              role="list"
              aria-label="Historia rozmów"
            >
              {threads.slice(0, 8).map((t) => (
                <div key={t.id} className="flex shrink-0 items-center gap-0.5" role="listitem">
                  <button
                    type="button"
                    onClick={() => void openThread(t.id)}
                    className={cn(
                      "max-w-[10rem] truncate rounded-full border px-2.5 py-1.5 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                      t.id === threadId
                        ? "border-brand-700 bg-brand-700 text-white"
                        : "border-border-primary bg-white text-fg-secondary hover:border-brand-300",
                    )}
                    title={t.title || "Rozmowa"}
                    aria-current={t.id === threadId ? "true" : undefined}
                  >
                    {t.title || "Rozmowa"}
                  </button>
                  {t.id === threadId && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          confirm(
                            "Usunąć tę rozmowę? Historia zniknie z konta (eksportuj wcześniej, jeśli potrzebujesz kopii).",
                          )
                        ) {
                          void removeThread(t.id);
                        }
                      }}
                      className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-full text-fg-secondary hover:bg-red-50 hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                      aria-label={`Usuń rozmowę: ${t.title || "bez tytułu"}`}
                      title="Usuń rozmowę"
                    >
                      <Trash01 className="size-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <span className="text-xs text-fg-secondary">
            Zaloguj się, aby zapisywać historię rozmów na koncie.
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={!hasMessages}
            onClick={() => downloadHistory("md")}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border-primary bg-white px-3 py-1.5 text-xs font-semibold text-fg-secondary hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            aria-label="Pobierz historię rozmowy (Markdown)"
          >
            <Download01 className="size-3.5" aria-hidden />
            MD
          </button>
          <button
            type="button"
            disabled={!hasMessages}
            onClick={() => downloadHistory("json")}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border-primary bg-white px-3 py-1.5 text-xs font-semibold text-fg-secondary hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            aria-label="Pobierz historię i logi (JSON)"
          >
            <Download01 className="size-3.5" aria-hidden />
            JSON
          </button>
        </div>
      </div>

      <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-5">
        <ThreadPrimitive.Empty>
          <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <p className="mb-2 text-sm font-medium text-brand-700">Wyszukiwanie badawcze</p>
              <h1 className="font-display text-3xl font-semibold tracking-tight text-brand-700 md:text-4xl">
                Zapytaj po polsku. Odpowiedź z polskich baz.
              </h1>
              <p className="mt-3 max-w-[42ch] text-base leading-relaxed text-fg-secondary">
                Jedno pytanie uruchamia równoległe przeszukanie repozytoriów, aktów prawnych i
                danych publicznych. Gdy da się, wyciągamy też treść z PDF, arkuszy i XML - a potem
                dostajesz pogłębiony briefing z linkami, tabelami i diagramami.
              </p>
              <div
                className="mt-5 flex flex-wrap gap-2"
                role="group"
                aria-label="Filtr grup źródeł"
              >
                {groups.map((g) => (
                  <button
                    key={g.id || "all"}
                    type="button"
                    onClick={() => setGroupFilter(g.id)}
                    aria-pressed={groupFilter === g.id}
                    className={cn(
                      "min-h-10 rounded-full border px-3 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                      groupFilter === g.id
                        ? "border-brand-700 bg-brand-700 text-white"
                        : "border-border-primary bg-white text-fg-secondary hover:border-brand-300",
                    )}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-border-primary bg-white/90 p-4 shadow-soft">
              <p className="mb-3 text-sm font-semibold text-fg-primary">Przykładowe pytania</p>
              <div className="grid gap-2">
                {suggestions.map((s) => (
                  <ThreadPrimitive.Suggestion
                    key={s}
                    prompt={s}
                    autoSend
                    className="min-h-11 rounded-xl border border-transparent bg-brand-25 px-3 py-2.5 text-left text-sm text-fg-secondary transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    {s}
                  </ThreadPrimitive.Suggestion>
                ))}
              </div>
            </div>
          </div>
        </ThreadPrimitive.Empty>

        <ThreadPrimitive.Messages
          components={{
            UserMessage: UserBubble,
            AssistantMessage: AssistantBubble,
          }}
        />
      </ThreadPrimitive.Viewport>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {status}
      </div>

      <AuditTrail status={status} sources={sources} live={live} running={isRunning} />

      <p className="rounded-xl border border-border-primary/80 bg-white/80 px-3 py-2 text-center text-xs leading-relaxed text-fg-secondary">
        Masz uwagi do odpowiedzi lub błąd w wynikach? Napisz na{" "}
        <a href={`mailto:${FEEDBACK_EMAIL}`} className="font-medium text-brand-700 underline">
          {FEEDBACK_EMAIL}
        </a>
        {" · "}
        <a href={reportMail} className="font-medium text-brand-700 underline">
          zgłoś ten wątek
        </a>
        {" · "}
        <a
          href={FEEDBACK_GITHUB_ISSUES}
          className="font-medium text-brand-700 underline"
          target="_blank"
          rel="noreferrer"
        >
          GitHub Issues
        </a>
        .
      </p>

      <ComposerPrimitive.Root className="sticky bottom-3 z-10 flex items-end gap-2 rounded-full border border-border-primary bg-white p-2 shadow-soft">
        <label htmlFor="chat-composer" className="sr-only">
          Napisz pytanie badawcze
        </label>
        <ComposerPrimitive.Input
          id="chat-composer"
          rows={1}
          placeholder="Napisz pytanie badawcze…"
          aria-label="Napisz pytanie badawcze"
          className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] text-fg-primary outline-none placeholder:text-fg-secondary focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 rounded-full"
        />
        <ComposerPrimitive.Send asChild>
          <Button
            size="md"
            className="min-h-11 min-w-11 shrink-0 !px-4"
            aria-label="Wyślij pytanie"
            isDisabled={isRunning}
          >
            <ArrowUp className="size-4" aria-hidden />
          </Button>
        </ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  );
}
