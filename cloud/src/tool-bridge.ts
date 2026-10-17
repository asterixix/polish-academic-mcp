import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type ServerMode } from "../../src/server.js";
import { parseSourceSelection, type SourceId } from "../../src/sources.js";
import type { CloudEnv } from "./env.js";
import { toCoreEnv } from "./env.js";
import { withDeveloperContact } from "./error-contact.js";


/**
 * Public Cloud MCP uses a single unified Meta-Router environment (3 tools:
 * `list_sources`, `search`, `get_record` routing across all 52 Polish databases
 * and 126 operations) for Claude, ChatGPT, Perplexity, and MCP directories.
 */
export function modeFromRequest(_request: Request): ServerMode {
  return "router";
}

export interface ToolAnnotationsInfo {
  title?: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotationsInfo;
}

export interface ToolCallResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
  structuredContent?: unknown;
}

export function sourcesFromRequest(request: Request): SourceId[] | undefined {
  const url = new URL(request.url);
  const spec = url.searchParams.get("sources") ?? undefined;
  if (!spec) return undefined;
  const { ids } = parseSourceSelection(spec);
  return ids.length > 0 ? ids : undefined;
}

export async function withMcpClient<T>(
  env: CloudEnv,
  sources: readonly SourceId[] | undefined,
  fn: (client: Client) => Promise<T>,
  mode: ServerMode = "router",
): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(toCoreEnv(env), {
    ...(sources ? { sources } : {}),
    mode,
  });
  await server.connect(serverTransport);
  const client = new Client({ name: "polish-academic-bridge", version: "1.3.0" });
  await client.connect(clientTransport);
  try {
    return await fn(client);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

export async function listMcpTools(
  env: CloudEnv,
  sources?: readonly SourceId[],
  mode: ServerMode = "router",
): Promise<ToolInfo[]> {
  return withMcpClient(
    env,
    sources,
    async (client) => {
      const result = await client.listTools();
      return (result.tools ?? []).map((t) => ({
        name: t.name,
        title: t.title ?? t.annotations?.title ?? t.name,
        description: t.description,
        inputSchema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<
          string,
          unknown
        >,
        annotations: {
          title: t.title ?? t.annotations?.title ?? t.name,
          readOnlyHint: t.annotations?.readOnlyHint ?? true,
          destructiveHint: t.annotations?.destructiveHint ?? false,
          idempotentHint: t.annotations?.idempotentHint ?? true,
          openWorldHint: t.annotations?.openWorldHint ?? true,
        },
      }));
    },
    mode,
  );
}

export async function callMcpTool(
  env: CloudEnv,
  name: string,
  args: Record<string, unknown>,
  sources?: readonly SourceId[],
  mode: ServerMode = "router",
): Promise<ToolCallResult> {
  return withMcpClient(
    env,
    sources,
    async (client) => {
      const result = await client.callTool({ name, arguments: args });
      return {
        content: (result.content ?? []) as ToolCallResult["content"],
        isError: Boolean(result.isError),
        structuredContent: result.structuredContent,
      };
    },
    mode,
  );
}

/** Handle a single JSON-RPC request against a fresh MCP server instance. */
export async function handleMcpJsonRpc(
  env: CloudEnv,
  message: Record<string, unknown>,
  sources?: readonly SourceId[],
  mode: ServerMode = "router",
): Promise<Record<string, unknown> | null> {
  const method = String(message.method ?? "");
  const id = message.id;
  const params = (message.params ?? {}) as Record<string, unknown>;

  // Notifications have no id and need no response body.
  if (id === undefined || id === null) {
    return null;
  }

  if (method === "initialize") {
    const requestedVersion =
      typeof params.protocolVersion === "string" && params.protocolVersion.trim()
        ? params.protocolVersion.trim()
        : "2025-03-26";
    const supportedVersions = new Set(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
    const protocolVersion = supportedVersions.has(requestedVersion)
      ? requestedVersion
      : "2025-03-26";
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
        },
        serverInfo: {
          name: "Polish Academic MCP",
          title: "Polish Academic MCP",
          version: "1.3.0",
          websiteUrl: "https://pamcp.pl",
          icons: [
            {
              src: "https://pamcp.pl/icon-512.png",
              mimeType: "image/png",
              sizes: ["512x512"],
            },
            {
              src: "https://pamcp.pl/apple-touch-icon.png",
              mimeType: "image/png",
              sizes: ["180x180"],
            },
            {
              src: "https://pamcp.pl/favicon-32.png",
              mimeType: "image/png",
              sizes: ["32x32"],
            },
          ],
        },
        instructions:
          mode === "router"
            ? "Serwer udostępnia 3 skonsolidowane narzędzia (list_sources, search, get_record) do przeszukiwania 55 polskich baz naukowych, prawnych, statystycznych, normalizacyjnych i archiwalnych (126 operacji natywnych). Wszystkie narzędzia działają wyłącznie w trybie do odczytu (read-only). Dokumentacja API: https://pamcp.pl/connectors"
            : "Narzędzia przeszukują 55 polskich baz naukowe, publiczne i kulturowe (126 operacji). Prefiks nazwy wskazuje bazę.",
      },
    };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    const tools = await listMcpTools(env, sources, mode);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        })),
      },
    };
  }

  if (method === "tools/call") {
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await callMcpTool(env, name, args, sources, mode);
      const content = result.isError
        ? result.content.map((c) => {
            if (c.type === "text" && typeof c.text === "string") {
              return { ...c, text: withDeveloperContact(c.text) };
            }
            return c;
          })
        : result.content;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content,
          isError: result.isError,
          structuredContent: result.structuredContent,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: withDeveloperContact(
                `Błąd wywołania narzędzia ${name}: ${msg}. Serwer MCP może być niedostępny lub źródło zewnętrzne nie odpowiada.`,
              ),
            },
          ],
          isError: true,
        },
      };
    }
  }

  if (method === "resources/list") {
    return { jsonrpc: "2.0", id, result: { resources: [] } };
  }

  if (method === "resources/templates/list") {
    return withMcpClient(
      env,
      sources,
      async (client) => {
        const res = await client.listResourceTemplates().catch(() => ({ resourceTemplates: [] }));
        return {
          jsonrpc: "2.0",
          id,
          result: { resourceTemplates: res.resourceTemplates ?? [] },
        };
      },
      mode,
    );
  }

  if (method === "resources/read") {
    const uri = String(params.uri ?? "");
    if (!uri) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "Missing resource URI" },
      };
    }
    return withMcpClient(
      env,
      sources,
      async (client) => {
        const res = await client.readResource({ uri });
        return {
          jsonrpc: "2.0",
          id,
          result: { contents: res.contents ?? [] },
        };
      },
      mode,
    );
  }

  if (method === "prompts/list") {
    return { jsonrpc: "2.0", id, result: { prompts: [] } };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}
