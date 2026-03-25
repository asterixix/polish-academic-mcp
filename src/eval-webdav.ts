import type { Env } from "./types.js";

export interface EvalWebdavToolCallRecord {
  kind: "mcp_tool_call_eval_data";
  at: string; // ISO timestamp
  request: {
    jsonrpc?: string;
    id?: string | number;
    toolName: string;
    arguments: unknown;
  };
  client: {
    clientId: string;
  };
  timing: {
    latencyMs: number;
  };
  response: {
    status: number;
    // JSON-RPC response as a truncated string to keep WebDAV payload bounded.
    jsonText: string;
    jsonLength: number;
    jsonTruncated: boolean;
  };
  /**
   * Computed RQ1–RQ4 report aligned to scripts/eval/metrics.ts.
   * Present only when we can parse JSON-RPC tool output and match it to a test case.
   */
  rqEval?: unknown;
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`,
    truncated: true,
  };
}

function joinWebdavUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${normalizedBase}/${normalizedPath}`;
}

function basicAuthHeader(username: string, password: string): string {
  // CF workers provide global `btoa`.
  return `Basic ${btoa(`${username}:${password}`)}`;
}

export async function uploadEvalToolCallToWebdav(
  env: Env,
  record: EvalWebdavToolCallRecord,
): Promise<void> {
  const enabled = (env.EVAL_WEBDAV_ENABLED ?? "false").toLowerCase() === "true";
  const baseUrl = (env.NEXTCLOUD_WEBDAV_BASE_URL ?? "").trim();
  if (!enabled || !baseUrl) return;

  const username = (env.NEXTCLOUD_WEBDAV_USERNAME ?? "").trim();
  const password = env.NEXTCLOUD_WEBDAV_PASSWORD ?? "";
  const hasAuth = Boolean(username && password);

  const maxBytes = env.EVAL_WEBDAV_MAX_JSON_BYTES
    ? Number(env.EVAL_WEBDAV_MAX_JSON_BYTES)
    : 120_000;
  const maxChars = Math.max(1, Math.floor(maxBytes)); // best-effort; JS chars ~= bytes for ascii

  const bodyText = JSON.stringify(record);
  const truncated = truncateText(bodyText, maxChars);

  const fileNameBase = record.request.toolName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const remotePrefix = (env.NEXTCLOUD_WEBDAV_PATH_PREFIX ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${fileNameBase}-${timestamp}-${crypto.randomUUID()}.json`;
  const path = remotePrefix ? `${remotePrefix}/${fileName}` : fileName;

  const url = joinWebdavUrl(baseUrl, path);

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (hasAuth) headers.Authorization = basicAuthHeader(username, password);

  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: truncated.text,
  });

  // Fail softly: caller typically runs this via ctx.waitUntil().
  if (!res.ok) {
    const msg = await safeReadErrorText(res);
    throw new Error(`WebDAV upload failed: ${res.status} ${res.statusText}${msg ? ` — ${msg}` : ""}`);
  }
}

async function safeReadErrorText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 800);
  } catch {
    return "";
  }
}

