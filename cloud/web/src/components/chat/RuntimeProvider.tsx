import type { LiveTrace } from "@/components/chat/AuditTrail";
import {
  deleteThread as apiDeleteThread,
  fetchMe,
  listThreads,
  loadThread,
  saveThread,
  streamAiSearch,
  type AuditLog,
  type AuditStep,
  type LlmCallEvent,
  type ThreadSummary,
  type TokenUsage,
} from "@/lib/api";
import { copyConversationMarkdown, downloadConversation } from "@/lib/audit-export";
import { withFeedbackHint } from "@/lib/feedback";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** "working" | "error" | undefined (ok) */
  status?: string;
  sources?: Array<{ tool: string; preview: string; isError?: boolean }>;
  followups?: string[];
};

type ChatMeta = {
  status: string;
  sources: Array<{ tool: string; preview: string; isError?: boolean }>;
  groupFilter: string;
  setGroupFilter: (v: string) => void;
  isRunning: boolean;
  live: LiveTrace;
  threadId: string | null;
  threads: ThreadSummary[];
  authenticated: boolean;
  messages: ChatMessage[];
  startNewThread: () => void;
  openThread: (id: string) => Promise<void>;
  removeThread: (id: string) => Promise<void>;
  downloadHistory: (format: "json") => void;
  copyHistory: () => Promise<boolean>;
  /** Re-run the user prompt that led to the last (or given) system-error assistant turn. */
  retryFailedPrompt: (assistantMessageId?: string) => Promise<void>;
};

const emptyLive = (): LiveTrace => ({
  traceId: null,
  steps: [],
  thoughts: [],
  llmCalls: [],
  tokens: null,
  audit: null,
});

const ChatMetaContext = createContext<ChatMeta>({
  status: "",
  sources: [],
  groupFilter: "",
  setGroupFilter: () => {},
  isRunning: false,
  live: emptyLive(),
  threadId: null,
  threads: [],
  authenticated: false,
  messages: [],
  startNewThread: () => {},
  openThread: async () => {},
  removeThread: async () => {},
  downloadHistory: () => {},
  copyHistory: async () => false,
  retryFailedPrompt: async () => {},
});

export function useChatMeta() {
  return useContext(ChatMetaContext);
}

const convertMessage = (message: ChatMessage): ThreadMessageLike => ({
  role: message.role,
  id: message.id,
  content: [{ type: "text", text: message.content }],
});

function upsertStep(steps: AuditStep[], step: AuditStep): AuditStep[] {
  const idx = steps.findIndex((s) => s.id === step.id);
  if (idx === -1) return [...steps, step];
  const next = steps.slice();
  next[idx] = step;
  return next;
}

type ConversationAudit = {
  turns: AuditLog[];
};

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [sources, setSources] = useState<ChatMeta["sources"]>([]);
  const [groupFilter, setGroupFilter] = useState("");
  const [live, setLive] = useState<LiveTrace>(emptyLive);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const conversationAuditRef = useRef<ConversationAudit>({ turns: [] });
  const messagesRef = useRef<ChatMessage[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const refreshThreadList = useCallback(async () => {
    const list = await listThreads();
    setThreads(list);
  }, []);

  const openThread = useCallback(
    async (id: string) => {
      const thread = await loadThread(id);
      if (!thread) return;
      const loaded = (thread.messages as ChatMessage[]) || [];
      setMessages(loaded);
      messagesRef.current = loaded;
      setThreadId(thread.id);
      setSources([]);
      setStatus("");
      const auditBag = thread.audit as ConversationAudit | AuditLog | null;
      if (auditBag && typeof auditBag === "object" && "turns" in auditBag && Array.isArray(auditBag.turns)) {
        conversationAuditRef.current = auditBag;
        const last = auditBag.turns[auditBag.turns.length - 1];
        if (last) {
          setLive({
            traceId: last.trace_id,
            steps: last.steps || [],
            thoughts: [],
            llmCalls: (last.llm_calls as LlmCallEvent[]) || [],
            tokens: last.token_totals || null,
            audit: last,
          });
        } else {
          setLive(emptyLive());
        }
      } else if (auditBag && typeof auditBag === "object" && "trace_id" in auditBag) {
        const single = auditBag as AuditLog;
        conversationAuditRef.current = { turns: [single] };
        setLive({
          traceId: single.trace_id,
          steps: single.steps || [],
          thoughts: [],
          llmCalls: (single.llm_calls as LlmCallEvent[]) || [],
          tokens: single.token_totals || null,
          audit: single,
        });
      } else {
        conversationAuditRef.current = { turns: [] };
        setLive(emptyLive());
      }
      setSearchParams({ thread: id }, { replace: true });
    },
    [setSearchParams],
  );

  const startNewThread = useCallback(() => {
    setMessages([]);
    messagesRef.current = [];
    setThreadId(crypto.randomUUID());
    setSources([]);
    setStatus("");
    setLive(emptyLive());
    conversationAuditRef.current = { turns: [] };
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const removeThread = useCallback(
    async (id: string) => {
      try {
        await apiDeleteThread(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(withFeedbackHint(msg));
        return;
      }
      await refreshThreadList();
      if (threadId === id) {
        startNewThread();
      }
    },
    [refreshThreadList, startNewThread, threadId],
  );

  const conversationExport = useCallback(() => {
    const title =
      messagesRef.current.find((m) => m.role === "user")?.content.slice(0, 80) || "Rozmowa";
    return {
      title,
      threadId,
      messages: messagesRef.current.map((m) => ({ role: m.role, content: m.content })),
      audits: conversationAuditRef.current.turns,
    };
  }, [threadId]);

  const downloadHistory = useCallback(
    (format: "json") => downloadConversation({ ...conversationExport(), format }),
    [conversationExport],
  );

  const copyHistory = useCallback(
    () => copyConversationMarkdown(conversationExport()),
    [conversationExport],
  );

  useEffect(() => {
    void (async () => {
      const me = await fetchMe();
      setAuthenticated(Boolean(me));
      if (me) {
        await refreshThreadList();
        const fromUrl = searchParams.get("thread");
        if (fromUrl) {
          await openThread(fromUrl);
        } else if (!threadId) {
          setThreadId(crypto.randomUUID());
        }
      } else if (!threadId) {
        setThreadId(crypto.randomUUID());
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once on mount
  }, []);

  const persistConversation = useCallback(
    async (nextMessages: ChatMessage[], auditTurn?: AuditLog | null) => {
      if (!authenticated) return;
      const id = threadId || crypto.randomUUID();
      if (!threadId) setThreadId(id);
      if (auditTurn) {
        conversationAuditRef.current = {
          turns: [...conversationAuditRef.current.turns, auditTurn],
        };
      }
      const title =
        nextMessages.find((m) => m.role === "user")?.content.slice(0, 80) || "Rozmowa";
      try {
        await saveThread({
          id,
          title,
          messages: nextMessages,
          audit: conversationAuditRef.current,
        });
        await refreshThreadList();
      } catch {
        /* persistence is best-effort */
      }
    },
    [authenticated, threadId, refreshThreadList],
  );

  const runSearch = useCallback(
    async (input: string, priorMessages: ChatMessage[]) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: input,
      };
      const base = [...priorMessages, userMsg];
      setMessages(base);
      messagesRef.current = base;
      setIsRunning(true);
      setStatus("Szukam w polskich bazach…");
      setSources([]);
      setLive((prev) => ({
        ...emptyLive(),
        tokens: prev.tokens,
      }));

      const assistantId = crypto.randomUUID();
      const withAssistant: ChatMessage[] = [
        ...base,
        { id: assistantId, role: "assistant", content: "", status: "working" },
      ];
      setMessages(withAssistant);
      messagesRef.current = withAssistant;

      const history = base.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let answer = "";
      let followups: string[] = [];
      let finalAudit: AuditLog | null = null;
      let sawSystemError = false;

      try {
        for await (const ev of streamAiSearch(input, {
          sources: groupFilter || undefined,
          messages: history,
        })) {
          if (ev.event === "audit_meta") {
            setLive((prev) => ({ ...prev, traceId: ev.data.trace_id }));
          }
          if (ev.event === "status") {
            setStatus(ev.data.message || "Przetwarzam…");
          }
          if (ev.event === "step") {
            setLive((prev) => ({
              ...prev,
              steps: upsertStep(prev.steps, ev.data),
            }));
            if (!ev.data.ended_at) setStatus(ev.data.title);
          }
          if (ev.event === "thought") {
            setLive((prev) => ({
              ...prev,
              thoughts: [...prev.thoughts, { phase: ev.data.phase, message: ev.data.message }],
            }));
          }
          if (ev.event === "llm") {
            const call = ev.data as LlmCallEvent;
            setLive((prev) => ({
              ...prev,
              llmCalls: [...prev.llmCalls.filter((c) => c.id !== call.id), call],
            }));
          }
          if (ev.event === "tokens") {
            setLive((prev) => ({
              ...prev,
              tokens: ev.data.cumulative as TokenUsage,
            }));
          }
          if (ev.event === "tools") {
            const names = (ev.data.calls || []).map((c) => c.name).join(", ");
            setStatus(names ? `Odpytuję: ${names}` : "Dobieram narzędzia…");
          }
          if (ev.event === "sources") {
            setSources(ev.data.items || []);
          }
          if (ev.event === "audit") {
            const auditPayload = ev.data as AuditLog;
            finalAudit = auditPayload;
            setLive((prev) => ({
              ...prev,
              audit: auditPayload,
              traceId: auditPayload.trace_id,
              tokens: auditPayload.token_totals,
              steps: auditPayload.steps?.length ? auditPayload.steps : prev.steps,
              llmCalls: auditPayload.llm_calls?.length
                ? (auditPayload.llm_calls as LlmCallEvent[])
                : prev.llmCalls,
            }));
          }
          if (ev.event === "token") {
            answer += ev.data.text;
            const next = messagesRef.current.map((m) =>
              m.id === assistantId ? { ...m, content: answer } : m,
            );
            setMessages(next);
            messagesRef.current = next;
          }
          if (ev.event === "answer") {
            answer = ev.data.text || "";
            followups = ev.data.followups || [];
            const next = messagesRef.current.map((m) =>
              m.id === assistantId
                ? { ...m, content: answer, followups, status: undefined }
                : m,
            );
            setMessages(next);
            messagesRef.current = next;
            setStatus("Gotowe");
            if (ev.data.token_totals) {
              setLive((prev) => ({
                ...prev,
                tokens: ev.data.token_totals!,
                traceId: ev.data.trace_id || prev.traceId,
              }));
            }
          }
          if (ev.event === "error") {
            sawSystemError = true;
            answer = withFeedbackHint(ev.data.message || "Coś poszło nie tak.");
            const next = messagesRef.current.map((m) =>
              m.id === assistantId ? { ...m, content: answer, status: "error" } : m,
            );
            setMessages(next);
            messagesRef.current = next;
            setStatus("");
            if (ev.data.trace_id) {
              setLive((prev) => ({ ...prev, traceId: ev.data.trace_id || prev.traceId }));
            }
          }
        }

        if (!answer) {
          sawSystemError = true;
          const fallback = withFeedbackHint(
            "Nie udało się zbudować odpowiedzi. Spróbuj ponownie albo zawęź grupę baz.",
          );
          const next = messagesRef.current.map((m) =>
            m.id === assistantId ? { ...m, content: fallback, status: "error" } : m,
          );
          setMessages(next);
          messagesRef.current = next;
        } else if (sawSystemError) {
          // Keep status: "error" from the error event even if partial answer arrived earlier
          const next = messagesRef.current.map((m) =>
            m.id === assistantId && m.status !== "error"
              ? { ...m, status: "error" as const }
              : m,
          );
          setMessages(next);
          messagesRef.current = next;
        }

        await persistConversation(messagesRef.current, finalAudit);
      } catch (err) {
        const msg = withFeedbackHint(
          err instanceof Error ? err.message : "Nieoczekiwany błąd połączenia.",
        );
        const next = messagesRef.current.map((m) =>
          m.id === assistantId ? { ...m, content: msg, status: "error" } : m,
        );
        setMessages(next);
        messagesRef.current = next;
        setStatus("");
      } finally {
        setIsRunning(false);
      }
    },
    [groupFilter, persistConversation],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const textPart = message.content.find((c) => c.type === "text");
      if (!textPart || textPart.type !== "text") return;
      const input = textPart.text.trim();
      if (!input) return;
      await runSearch(input, messagesRef.current);
    },
    [runSearch],
  );

  const retryFailedPrompt = useCallback(
    async (assistantMessageId?: string) => {
      if (isRunning) return;
      const looksFailed = (m: ChatMessage) => m.role === "assistant" && m.status === "error";

      const msgs = messagesRef.current;
      let assistantIdx = -1;
      if (assistantMessageId) {
        assistantIdx = msgs.findIndex((m) => m.id === assistantMessageId && looksFailed(m));
      } else {
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (looksFailed(msgs[i])) {
            assistantIdx = i;
            break;
          }
        }
      }
      if (assistantIdx < 0) return;

      let userIdx = assistantIdx - 1;
      while (userIdx >= 0 && msgs[userIdx].role !== "user") userIdx--;
      if (userIdx < 0) return;

      const prompt = msgs[userIdx].content.trim();
      if (!prompt) return;

      // Drop the failed turn (user + error assistant) and anything after, then re-run.
      const prior = msgs.slice(0, userIdx);
      setMessages(prior);
      messagesRef.current = prior;
      setStatus("Ponawiam wyszukiwanie…");
      await runSearch(prompt, prior);
    },
    [isRunning, runSearch],
  );

  const runtime = useExternalStoreRuntime({
    isRunning,
    messages,
    convertMessage,
    onNew,
  });

  const meta = useMemo(
    () => ({
      status,
      sources,
      groupFilter,
      setGroupFilter,
      isRunning,
      live,
      threadId,
      threads,
      authenticated,
      messages,
      startNewThread,
      openThread,
      removeThread,
      downloadHistory,
      copyHistory,
      retryFailedPrompt,
    }),
    [
      status,
      sources,
      groupFilter,
      isRunning,
      live,
      threadId,
      threads,
      authenticated,
      messages,
      startNewThread,
      openThread,
      removeThread,
      downloadHistory,
      copyHistory,
      retryFailedPrompt,
    ],
  );

  return (
    <ChatMetaContext.Provider value={meta}>
      <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
    </ChatMetaContext.Provider>
  );
}
