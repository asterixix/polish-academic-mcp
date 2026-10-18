import type { CloudEnv } from "./env.js";
import type { ToolInfo } from "./tool-bridge.js";

export const PARALLEL_MAX_CALLS = 5;
export const PARALLEL_TOOL_NAMES = ["web_search", "web_fetch"] as const;

const API_BASE = "https://api.parallel.ai";
const SEARCH_TIMEOUT_MS = 20_000;
const EXTRACT_TIMEOUT_MS = 30_000;
const MAX_CHARS_TOTAL = 20_000;
const SEARCH_MAX_RESULTS = 10;
const EXTRACT_MAX_URLS = 3;

export interface ParallelResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function parallelEnabled(env: CloudEnv): boolean {
  return Boolean(env.PARALLEL_API_KEY?.trim());
}

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export const PARALLEL_TOOL_INFOS: ToolInfo[] = [
  {
    name: "web_search",
    description:
      "Wyszukuje w internecie (poza polskimi bazami) przez Parallel. Używaj, gdy potrzebne są aktualne informacje, wydarzenia lub źródła spoza baz naukowych i publicznych.",
    inputSchema: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          description: "Pełne zdanie opisujące, czego szukasz i po co.",
        },
        search_queries: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 3,
          description: "1–3 krótkie zapytania słowne (3–6 słów każde).",
        },
      },
      required: ["objective", "search_queries"],
    },
    annotations,
  },
  {
    name: "web_fetch",
    description:
      "Pobiera treść wskazanych adresów URL (Parallel Extract) i zwraca fragmenty istotne dla celu. Używaj dla linków z wyników web_search lub podanych przez użytkownika.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: EXTRACT_MAX_URLS,
          description: "Adresy URL (http/https).",
        },
        objective: {
          type: "string",
          description: "Opcjonalnie: czego szukasz na stronie.",
        },
      },
      required: ["urls"],
    },
    annotations,
  },
];

async function postParallel(
  env: CloudEnv,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<ParallelResult> {
  const key = env.PARALLEL_API_KEY?.trim();
  if (!key) return errorResult("Parallel nie jest skonfigurowany (brak PARALLEL_API_KEY).");
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) return errorResult(`Parallel zwrócił HTTP ${res.status}: ${text.slice(0, 500)}`);
    return { content: [{ type: "text", text: text.slice(0, MAX_CHARS_TOTAL * 2) }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(`Błąd wywołania Parallel: ${msg}`);
  }
}

function errorResult(text: string): ParallelResult {
  return { content: [{ type: "text", text }], isError: true };
}

export function parallelSearch(
  env: CloudEnv,
  objective: string,
  searchQueries: string[],
): Promise<ParallelResult> {
  return postParallel(
    env,
    "/v1/search",
    {
      objective,
      search_queries: searchQueries.slice(0, 3),
      mode: "fast",
      max_chars_total: MAX_CHARS_TOTAL,
      advanced_settings: { max_results: SEARCH_MAX_RESULTS },
    },
    SEARCH_TIMEOUT_MS,
  );
}

export function parallelExtract(
  env: CloudEnv,
  urls: string[],
  objective?: string,
): Promise<ParallelResult> {
  return postParallel(
    env,
    "/v1/extract",
    {
      urls: urls.slice(0, EXTRACT_MAX_URLS),
      ...(objective ? { objective } : {}),
      max_chars_total: MAX_CHARS_TOTAL,
    },
    EXTRACT_TIMEOUT_MS,
  );
}
