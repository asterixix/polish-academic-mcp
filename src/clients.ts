/**
 * MCP client catalogue for `polish-academic-mcp setup` and `doctor`.
 *
 * Everything here is pure: paths, config entries and JSON/TOML edits take a
 * HostContext, so tests can simulate any OS against a temporary home directory.
 * File writes live in src/cli.ts.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, posix, win32 } from "node:path";
import { SOURCES_ENV } from "./sources.js";

export const PACKAGE_NAME = "polish-academic-mcp";
/** Key under which the server is stored in client configs. */
export const SERVER_KEY = "polish-academic";

export interface HostContext {
  platform: NodeJS.Platform;
  home: string;
  env: Record<string, string | undefined>;
  /** Directory of the Node.js binary running setup (dirname(process.execPath)). */
  nodeBinDir: string;
  exists(path: string): boolean;
  listDir(path: string): string[];
}

export function currentHost(): HostContext {
  return {
    platform: process.platform,
    home: homedir(),
    env: process.env,
    nodeBinDir: dirname(process.execPath),
    exists: existsSync,
    listDir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
  };
}

function join(ctx: HostContext, ...parts: string[]): string {
  return ctx.platform === "win32" ? win32.join(...parts) : posix.join(...parts);
}

/** Per-user application data directory (Roaming AppData / Application Support / XDG config). */
function appDataDir(ctx: HostContext): string {
  if (ctx.platform === "win32") return ctx.env.APPDATA || join(ctx, ctx.home, "AppData", "Roaming");
  if (ctx.platform === "darwin") return join(ctx, ctx.home, "Library", "Application Support");
  return xdgConfigDir(ctx);
}

function xdgConfigDir(ctx: HostContext): string {
  return ctx.env.XDG_CONFIG_HOME || join(ctx, ctx.home, ".config");
}

function vscodeUserDir(ctx: HostContext): string {
  return join(ctx, appDataDir(ctx), "Code", "User");
}

function claudeDesktopDir(ctx: HostContext): string {
  if (ctx.platform === "win32") {
    // The Microsoft Store (MSIX) build keeps its own copy of AppData\Roaming.
    const local = ctx.env.LOCALAPPDATA || join(ctx, ctx.home, "AppData", "Local");
    const packages = join(ctx, local, "Packages");
    for (const name of ctx.listDir(packages)) {
      if (!name.startsWith("Claude_")) continue;
      const dir = join(ctx, packages, name, "LocalCache", "Roaming", "Claude");
      if (ctx.exists(dir)) return dir;
    }
  }
  return join(ctx, appDataDir(ctx), "Claude");
}

// ─── Launch command ──────────────────────────────────────────────────────────

export interface LaunchSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// Directories GUI apps normally have on PATH. Node installed elsewhere (nvm, fnm,
// volta, asdf) is invisible to apps started from the Dock / Start menu, which is
// the classic "spawn npx ENOENT" failure.
const SYSTEM_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
const STANDARD_BIN_DIRS = new Set([
  ...SYSTEM_BIN_DIRS,
  "/opt/local/bin",
  "/snap/bin",
  "/home/linuxbrew/.linuxbrew/bin",
]);

/**
 * Command that starts the server. `pinVersion` writes `polish-academic-mcp@<version>`;
 * without it npx checks the registry for a newer release on every start.
 */
export function launchSpec(ctx: HostContext, sources?: string, pinVersion?: string): LaunchSpec {
  const env: Record<string, string> = {};
  if (sources) env[SOURCES_ENV] = sources;
  const npxArgs = ["-y", pinVersion ? `${PACKAGE_NAME}@${pinVersion}` : PACKAGE_NAME];
  const withEnv = (spec: LaunchSpec): LaunchSpec =>
    Object.keys(env).length > 0 ? { ...spec, env: { ...spec.env, ...env } } : spec;

  if (ctx.platform === "win32") {
    // npx is a .cmd script on Windows; several clients cannot spawn it directly.
    return withEnv({ command: "cmd", args: ["/c", "npx", ...npxArgs] });
  }
  const npx = posix.join(ctx.nodeBinDir, "npx");
  if (STANDARD_BIN_DIRS.has(ctx.nodeBinDir) || !ctx.exists(npx)) {
    return withEnv({ command: "npx", args: npxArgs });
  }
  return withEnv({
    command: npx,
    args: npxArgs,
    env: { PATH: [ctx.nodeBinDir, ...SYSTEM_BIN_DIRS].join(":") },
  });
}

/**
 * For apps that accept only a command line (no env fields): the source selection
 * becomes `--sources=…` and other variables (PATH for nvm installs) go through
 * /usr/bin/env. PATH is only ever set on macOS/Linux, where /usr/bin/env exists.
 */
export function inlineEnv(spec: LaunchSpec): LaunchSpec {
  const { [SOURCES_ENV]: sources, ...rest } = spec.env ?? {};
  const args = sources ? [...spec.args, `--sources=${sources}`] : spec.args;
  const vars = Object.entries(rest).map(([k, v]) => `${k}=${v}`);
  if (vars.length === 0) return { command: spec.command, args };
  return { command: "/usr/bin/env", args: [...vars, spec.command, ...args] };
}

/** Human-readable one-line command, e.g. for GUI forms. */
export function commandLine(spec: LaunchSpec): string {
  return [spec.command, ...spec.args]
    .map((part) => (/\s/.test(part) ? `"${part}"` : part))
    .join(" ");
}

// ─── Client catalogue ────────────────────────────────────────────────────────

export type ConfigFormat =
  | "mcpServers"
  | "claude-code"
  | "vscode"
  | "cline"
  | "opencode"
  | "copilot"
  | "codex";

export interface ClientDef {
  id: string;
  name: string;
  format: ConfigFormat;
  /** Config file on this host, or null when the client is not available on this OS. */
  configPath(ctx: HostContext): string | null;
  /** Path whose existence means the client is installed (or has been run once). */
  detectPath(ctx: HostContext): string | null;
  /** Polish hint shown after the config was written. */
  restart: string;
  /** Tool cap enforced (Windsurf, VS Code) or warned about (Cursor) by the client. */
  toolLimit?: number;
}

const RESTART_GUI =
  "zamknij aplikację całkowicie (także z zasobnika/paska menu) i uruchom ponownie";

export const CLIENTS: readonly ClientDef[] = [
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    format: "mcpServers",
    configPath: (ctx) => join(ctx, claudeDesktopDir(ctx), "claude_desktop_config.json"),
    detectPath: (ctx) => claudeDesktopDir(ctx),
    restart: RESTART_GUI,
  },
  {
    id: "claude-code",
    name: "Claude Code",
    format: "claude-code",
    configPath: (ctx) => join(ctx, ctx.env.CLAUDE_CONFIG_DIR || ctx.home, ".claude.json"),
    detectPath: (ctx) => join(ctx, ctx.env.CLAUDE_CONFIG_DIR || ctx.home, ".claude.json"),
    restart: "uruchom nową sesję `claude` i sprawdź `/mcp`",
  },
  {
    id: "cursor",
    name: "Cursor",
    format: "mcpServers",
    configPath: (ctx) => join(ctx, ctx.home, ".cursor", "mcp.json"),
    detectPath: (ctx) => join(ctx, ctx.home, ".cursor"),
    restart:
      "otwórz Settings → MCP i sprawdź, czy serwer ma zielony status (lub uruchom Cursor ponownie)",
    toolLimit: 40,
  },
  {
    id: "vscode",
    name: "VS Code (GitHub Copilot)",
    format: "vscode",
    configPath: (ctx) => join(ctx, vscodeUserDir(ctx), "mcp.json"),
    detectPath: (ctx) => vscodeUserDir(ctx),
    restart: "w VS Code uruchom polecenie „MCP: List Servers” i włącz polish-academic",
    toolLimit: 128,
  },
  {
    id: "windsurf",
    name: "Windsurf",
    format: "mcpServers",
    configPath: (ctx) => join(ctx, ctx.home, ".codeium", "windsurf", "mcp_config.json"),
    detectPath: (ctx) => join(ctx, ctx.home, ".codeium", "windsurf"),
    restart: "w panelu Cascade kliknij ikonę MCP → Refresh (lub uruchom Windsurf ponownie)",
    toolLimit: 100,
  },
  {
    id: "cline",
    name: "Cline (VS Code)",
    format: "cline",
    configPath: (ctx) =>
      join(
        ctx,
        vscodeUserDir(ctx),
        "globalStorage",
        "saoudrizwan.claude-dev",
        "settings",
        "cline_mcp_settings.json",
      ),
    detectPath: (ctx) => join(ctx, vscodeUserDir(ctx), "globalStorage", "saoudrizwan.claude-dev"),
    restart: "otwórz panel Cline → MCP Servers; serwer uruchomi się automatycznie",
  },
  {
    id: "roo-code",
    name: "Roo Code (VS Code)",
    format: "cline",
    configPath: (ctx) =>
      join(
        ctx,
        vscodeUserDir(ctx),
        "globalStorage",
        "rooveterinaryinc.roo-cline",
        "settings",
        "mcp_settings.json",
      ),
    detectPath: (ctx) =>
      join(ctx, vscodeUserDir(ctx), "globalStorage", "rooveterinaryinc.roo-cline"),
    restart: "otwórz panel Roo Code → MCP Servers; serwer uruchomi się automatycznie",
  },
  {
    id: "lm-studio",
    name: "LM Studio",
    format: "mcpServers",
    configPath: (ctx) => join(ctx, ctx.home, ".lmstudio", "mcp.json"),
    detectPath: (ctx) => join(ctx, ctx.home, ".lmstudio"),
    restart:
      "w czacie włącz narzędzie mcp/polish-academic (ikona wtyczki); przy małych modelach wybierz 1–2 grupy baz",
  },
  {
    id: "anythingllm",
    name: "AnythingLLM Desktop",
    format: "mcpServers",
    configPath: (ctx) =>
      join(
        ctx,
        appDataDir(ctx),
        "anythingllm-desktop",
        "storage",
        "plugins",
        "anythingllm_mcp_servers.json",
      ),
    detectPath: (ctx) => join(ctx, appDataDir(ctx), "anythingllm-desktop"),
    restart:
      "otwórz Agent Skills → MCP Servers i kliknij Refresh; narzędzia działają w trybie @agent",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    format: "mcpServers",
    configPath: (ctx) => join(ctx, ctx.home, ".gemini", "settings.json"),
    detectPath: (ctx) => join(ctx, ctx.home, ".gemini"),
    restart: "uruchom `gemini` ponownie i sprawdź `/mcp`",
  },
  {
    id: "codex",
    name: "OpenAI Codex CLI",
    format: "codex",
    configPath: (ctx) =>
      join(ctx, ctx.env.CODEX_HOME || join(ctx, ctx.home, ".codex"), "config.toml"),
    detectPath: (ctx) => ctx.env.CODEX_HOME || join(ctx, ctx.home, ".codex"),
    restart: "uruchom `codex` ponownie i sprawdź `/mcp`",
  },
  {
    id: "opencode",
    name: "opencode",
    format: "opencode",
    configPath: (ctx) => {
      const dir = join(ctx, xdgConfigDir(ctx), "opencode");
      const jsonc = join(ctx, dir, "opencode.jsonc");
      const json = join(ctx, dir, "opencode.json");
      return !ctx.exists(json) && ctx.exists(jsonc) ? jsonc : json;
    },
    detectPath: (ctx) => join(ctx, xdgConfigDir(ctx), "opencode"),
    restart: "uruchom `opencode` ponownie",
  },
  {
    id: "copilot-cli",
    name: "GitHub Copilot CLI",
    format: "copilot",
    configPath: (ctx) => join(ctx, ctx.home, ".copilot", "mcp-config.json"),
    detectPath: (ctx) => join(ctx, ctx.home, ".copilot"),
    restart: "uruchom `copilot` ponownie i sprawdź `/mcp show`",
  },
];

/** Clients configured through a GUI or a non-JSON format: setup prints instructions. */
export interface ManualClientDef {
  id: string;
  name: string;
  instructions(spec: LaunchSpec): string;
}

function yamlList(values: string[]): string {
  return `[${values.map((v) => JSON.stringify(v)).join(", ")}]`;
}

function yamlEnv(spec: LaunchSpec, indent: string, key = "env"): string {
  if (!spec.env) return "";
  const lines = Object.entries(spec.env).map(([k, v]) => `${indent}  ${k}: ${JSON.stringify(v)}`);
  return `\n${indent}${key}:\n${lines.join("\n")}`;
}

function jsonBlock(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export const MANUAL_CLIENTS: readonly ManualClientDef[] = [
  {
    id: "zed",
    name: "Zed",
    instructions: (spec) =>
      [
        "Otwórz Zed → Settings → Open Settings (settings.json) i dopisz w obiekcie głównym:",
        jsonBlock({
          context_servers: {
            [SERVER_KEY]: {
              source: "custom",
              command: spec.command,
              args: spec.args,
              env: spec.env ?? {},
            },
          },
        }),
        "Status serwera zobaczysz w Agent Panel → Settings (zielona kropka = działa).",
      ].join("\n"),
  },
  {
    id: "continue",
    name: "Continue (VS Code / JetBrains)",
    instructions: (spec) =>
      [
        "Dopisz do ~/.continue/config.yaml (sekcja mcpServers):",
        [
          "mcpServers:",
          `  - name: ${SERVER_KEY}`,
          "    type: stdio",
          `    command: ${JSON.stringify(spec.command)}`,
          `    args: ${yamlList(spec.args)}${yamlEnv(spec, "    ")}`,
        ].join("\n"),
        "Narzędzia MCP działają w trybie Agent.",
      ].join("\n"),
  },
  {
    id: "goose",
    name: "Goose",
    instructions: (spec) =>
      [
        "Uruchom `goose configure` → Add Extension → Command-line Extension i podaj polecenie:",
        `  ${commandLine(inlineEnv(spec))}`,
        "albo dopisz do ~/.config/goose/config.yaml:",
        [
          "extensions:",
          `  ${SERVER_KEY}:`,
          `    name: ${SERVER_KEY}`,
          "    type: stdio",
          `    cmd: ${JSON.stringify(spec.command)}`,
          `    args: ${yamlList(spec.args)}`,
          "    enabled: true",
          `    timeout: 300${yamlEnv(spec, "    ", "envs")}`,
        ].join("\n"),
      ].join("\n"),
  },
  {
    id: "hermes",
    name: "Hermes Agent",
    instructions: (spec) =>
      [
        "Dopisz do ~/.hermes/config.yaml (sekcja mcp_servers) i uruchom Hermes ponownie:",
        [
          "mcp_servers:",
          `  ${SERVER_KEY}:`,
          `    command: ${JSON.stringify(spec.command)}`,
          `    args: ${yamlList(spec.args)}${yamlEnv(spec, "    ")}`,
        ].join("\n"),
      ].join("\n"),
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    instructions: (spec) =>
      [
        "W terminalu uruchom:",
        `  openclaw mcp set ${SERVER_KEY} '${JSON.stringify({ command: spec.command, args: spec.args, ...(spec.env && { env: spec.env }) })}'`,
        "i uruchom OpenClaw ponownie.",
      ].join("\n"),
  },
  {
    id: "jan",
    name: "Jan",
    instructions: (spec) =>
      [
        "Settings → MCP Servers → „+ Add MCP Server”, a następnie wpisz:",
        `  Name: ${SERVER_KEY}`,
        `  Command: ${spec.command}`,
        `  Arguments: ${spec.args.join(" ")}`,
        ...(spec.env ? Object.entries(spec.env).map(([k, v]) => `  Env: ${k}=${v}`) : []),
      ].join("\n"),
  },
  {
    id: "perplexity",
    name: "Perplexity (macOS)",
    instructions: (spec) =>
      [
        "Settings → Connectors → zainstaluj pomocnika PerplexityXPC → Add Connector → zakładka Simple:",
        `  Server Name: ${SERVER_KEY}`,
        `  Command: ${commandLine(inlineEnv(spec))}`,
        "Poczekaj, aż status zmieni się na Running.",
      ].join("\n"),
  },
  {
    id: "open-webui",
    name: "Open WebUI",
    instructions: (spec) =>
      [
        "Open WebUI obsługuje natywnie tylko MCP po HTTP. Uruchom lokalny most mcpo (wymaga uv):",
        `  uvx mcpo --port 8000 -- ${commandLine(inlineEnv(spec))}`,
        "Następnie w Open WebUI: Settings → Tools → „+” i adres http://localhost:8000",
        "(z kontenera Docker: http://host.docker.internal:8000).",
      ].join("\n"),
  },
  {
    id: "generic",
    name: "Inna aplikacja (Msty, Cherry Studio, 5ire, Kiro…)",
    instructions: (spec) => {
      const form = inlineEnv(spec);
      return [
        "Większość aplikacji przyjmuje wpis w formacie mcpServers (JSON):",
        jsonBlock({ mcpServers: { [SERVER_KEY]: buildEntry("mcpServers", spec) } }),
        `Jeśli aplikacja ma tylko formularz: polecenie „${form.command}”, argumenty „${form.args.join(" ")}”.`,
      ].join("\n");
    },
  },
];

export function findClient(id: string): ClientDef | ManualClientDef | undefined {
  return CLIENTS.find((c) => c.id === id) ?? MANUAL_CLIENTS.find((c) => c.id === id);
}

export function isAutoClient(client: ClientDef | ManualClientDef): client is ClientDef {
  return "format" in client;
}

// ─── Config entries ──────────────────────────────────────────────────────────

export function topLevelKey(format: ConfigFormat): string {
  if (format === "vscode") return "servers";
  if (format === "opencode") return "mcp";
  return "mcpServers";
}

export function buildEntry(format: ConfigFormat, spec: LaunchSpec): Record<string, unknown> {
  const { command, args } = spec;
  const env = spec.env && Object.keys(spec.env).length > 0 ? spec.env : undefined;
  switch (format) {
    case "claude-code":
      return { type: "stdio", command, args, env: env ?? {} };
    case "vscode":
      return { type: "stdio", command, args, ...(env && { env }) };
    case "cline":
      return { command, args, ...(env && { env }), disabled: false };
    case "opencode":
      return {
        type: "local",
        command: [command, ...args],
        enabled: true,
        ...(env && { environment: env }),
      };
    case "copilot":
      return { type: "local", command, args, ...(env && { env }), tools: ["*"] };
    case "mcpServers":
    case "codex":
      return { command, args, ...(env && { env }) };
  }
}

/** True when a config entry launches this package via npx (under any key). */
export function launchesPackage(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const { command, args } = entry as { command?: unknown; args?: unknown };
  const parts = [command, args].flatMap((v) => (Array.isArray(v) ? v : [v]));
  return parts.some(
    (p) => typeof p === "string" && (p === PACKAGE_NAME || p.startsWith(`${PACKAGE_NAME}@`)),
  );
}

// ─── Config file edits ───────────────────────────────────────────────────────

/** Env variables setup owns. Anything else a user added (PBN keys, proxy settings) is kept. */
const MANAGED_ENV = new Set(["PATH", SOURCES_ENV]);
const ENV_FIELDS = ["env", "environment"];

/**
 * New entry = previous entries (the current one last, so it wins) + generated fields.
 * Env objects are merged key by key: setup-managed variables come only from the
 * generated entry, every other variable survives a re-run.
 */
function mergeEntry(
  previous: Record<string, unknown>[],
  generated: Record<string, unknown>,
): { entry: Record<string, unknown>; kept: string[] } {
  const entry: Record<string, unknown> = Object.assign({}, ...previous, generated);
  const kept = new Set<string>();
  for (const field of ENV_FIELDS) {
    const env: Record<string, unknown> = {};
    for (const prev of previous) {
      const prevEnv = prev[field];
      if (!isPlainObject(prevEnv)) continue;
      for (const [k, v] of Object.entries(prevEnv)) {
        if (MANAGED_ENV.has(k)) continue;
        env[k] = v;
        kept.add(k);
      }
    }
    const generatedEnv = generated[field];
    Object.assign(env, isPlainObject(generatedEnv) ? generatedEnv : {});
    if (Object.keys(env).length > 0 || field in generated) entry[field] = env;
    else delete entry[field];
  }
  return { entry, kept: [...kept] };
}

export type EditResult =
  | { status: "changed" | "unchanged"; text: string; notes: string[] }
  | { status: "error"; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripJsonc(text: string): string {
  // Remove // and /* */ comments outside strings, then trailing commas.
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
    } else {
      out += ch;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    isPlainObject(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/**
 * Add, replace (entry) or remove (entry === null) this server in a JSON config.
 * Keeps every other key, the file's indentation and line endings. Other entries
 * that launch this package under a different name are removed, so the tools are
 * never registered twice. Files with comments (JSONC) are left untouched.
 */
export function editJsonConfig(
  original: string | null,
  topKey: string,
  entry: Record<string, unknown> | null,
): EditResult {
  const text = (original ?? "").replace(/^\uFEFF/, "");
  let data: unknown = {};
  if (text.trim() !== "") {
    try {
      data = JSON.parse(text);
    } catch (err) {
      try {
        JSON.parse(stripJsonc(text));
        return {
          status: "error",
          reason:
            "plik zawiera komentarze lub końcowe przecinki (JSONC); aby ich nie utracić, zmień go ręcznie",
        };
      } catch {
        return {
          status: "error",
          reason: `plik nie jest poprawnym JSON-em (${err instanceof Error ? err.message : String(err)}); popraw go lub usuń`,
        };
      }
    }
  }
  if (!isPlainObject(data)) {
    return { status: "error", reason: "główny element pliku nie jest obiektem JSON" };
  }
  const section = data[topKey];
  if (section !== undefined && !isPlainObject(section)) {
    return { status: "error", reason: `pole "${topKey}" nie jest obiektem JSON` };
  }

  const notes: string[] = [];
  const servers: Record<string, unknown> = { ...section };
  const previous: Record<string, unknown>[] = [];
  for (const [key, value] of Object.entries(servers)) {
    if (key !== SERVER_KEY && launchesPackage(value)) {
      if (isPlainObject(value)) previous.push(value);
      delete servers[key];
      notes.push(`usunięto zdublowany wpis "${key}"`);
    }
  }
  const current = servers[SERVER_KEY];
  if (isPlainObject(current)) previous.push(current);
  let kept: string[] = [];
  if (entry === null) {
    if (SERVER_KEY in servers) delete servers[SERVER_KEY];
  } else {
    const merged = mergeEntry(previous, entry);
    servers[SERVER_KEY] = merged.entry;
    kept = merged.kept;
  }

  const before = stableStringify(section ?? {});
  if (stableStringify(servers) === before) return { status: "unchanged", text, notes };
  if (kept.length > 0) notes.push(`zachowano Twoje zmienne: ${kept.join(", ")}`);

  const next = { ...data, [topKey]: servers };
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
  let out = `${JSON.stringify(next, null, indent)}\n`;
  if (text.includes("\r\n")) out = out.replace(/\n/g, "\r\n");
  return { status: "changed", text: out, notes };
}

// Group 1 is the sub-table path after the server name: "" (main table), ".env", ….
const TOML_OUR_HEADER = new RegExp(
  String.raw`^\s*\[\s*mcp_servers\s*\.\s*(?:"${SERVER_KEY}"|'${SERVER_KEY}'|${SERVER_KEY})\s*((?:\.[^\]]*)?)\]\s*(?:#.*)?$`,
);

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

/** Lines of an existing Codex entry that setup does not generate and must keep. */
interface TomlKept {
  main: string[];
  env: string[];
  /** Other sub-tables of the entry, verbatim (header included). */
  other: string[];
}

const TOML_KEY = /^\s*("[^"]*"|'[^']*'|[A-Za-z0-9_-]+)\s*=/;

function tomlKeyName(line: string): string | undefined {
  return TOML_KEY.exec(line)?.[1].replace(/^["']|["']$/g, "");
}

/**
 * TOML block for Codex. Timeouts are raised because the first npx run downloads the
 * package; values the user set (timeouts, PBN keys, other settings) are kept.
 */
export function codexTomlBlock(
  spec: LaunchSpec,
  kept: TomlKept = { main: [], env: [], other: [] },
): string {
  const userKeys = new Set(kept.main.map(tomlKeyName));
  const lines = [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${JSON.stringify(spec.command)}`,
    `args = [${spec.args.map((a) => JSON.stringify(a)).join(", ")}]`,
    ...(userKeys.has("startup_timeout_sec") ? [] : ["startup_timeout_sec = 60"]),
    ...(userKeys.has("tool_timeout_sec") ? [] : ["tool_timeout_sec = 120"]),
    ...kept.main,
  ];
  const env = Object.entries(spec.env ?? {});
  if (env.length > 0 || kept.env.length > 0) {
    lines.push("", `[mcp_servers.${SERVER_KEY}.env]`);
    for (const [k, v] of env) lines.push(`${tomlKey(k)} = ${JSON.stringify(v)}`);
    lines.push(...kept.env);
  }
  if (kept.other.length > 0) lines.push("", ...kept.other);
  return lines.join("\n");
}

/** Add, replace (spec) or remove (spec === null) this server in Codex's config.toml. */
export function editCodexToml(original: string | null, spec: LaunchSpec | null): EditResult {
  const text = (original ?? "").replace(/^\uFEFF/, "");
  const normalized = text.replace(/\r\n/g, "\n");
  const kept: string[] = [];
  const userLines: TomlKept = { main: [], env: [], other: [] };
  let table: keyof TomlKept | null = null;
  let keepValue = true;
  let found = false;
  for (const line of normalized.split("\n")) {
    const header = TOML_OUR_HEADER.exec(line);
    if (header) {
      found = true;
      const sub = header[1].replace(/\s/g, "");
      table = sub === "" ? "main" : sub === ".env" ? "env" : "other";
      keepValue = true;
      if (table === "other") userLines.other.push(line);
      continue;
    }
    if (table && /^\s*\[/.test(line)) table = null;
    if (!table) {
      kept.push(line);
      continue;
    }
    if (table === "other") {
      userLines.other.push(line);
      continue;
    }
    if (line.trim() === "") continue;
    // Continuation lines (multi-line arrays, comments) follow the key they belong to.
    const key = tomlKeyName(line);
    if (key !== undefined) {
      keepValue = table === "main" ? key !== "command" && key !== "args" : !MANAGED_ENV.has(key);
    }
    if (keepValue) userLines[table].push(line);
  }
  while (userLines.other.length > 0 && userLines.other[userLines.other.length - 1].trim() === "") {
    userLines.other.pop();
  }
  const rest = kept.join("\n").trimEnd();
  if (new RegExp(String.raw`^\s*["']?${SERVER_KEY}["']?\s*=`, "m").test(rest)) {
    return {
      status: "error",
      reason: `wpis ${SERVER_KEY} ma nietypowy format (tabela inline); zmień go ręcznie`,
    };
  }

  if (!spec && !found) return { status: "unchanged", text, notes: [] };
  let out = spec ? `${rest ? `${rest}\n\n` : ""}${codexTomlBlock(spec, userLines)}` : rest;
  out = out ? `${out}\n` : "";
  if (out === normalized) return { status: "unchanged", text, notes: [] };
  if (text.includes("\r\n")) out = out.replace(/\n/g, "\r\n");
  return { status: "changed", text: out, notes: [] };
}

/** Apply the right editor for a client. `spec === null` removes the server. */
export function editClientConfig(
  client: ClientDef,
  original: string | null,
  spec: LaunchSpec | null,
): EditResult {
  if (client.format === "codex") return editCodexToml(original, spec);
  const key = topLevelKey(client.format);
  const entry = spec ? buildEntry(client.format, spec) : null;
  const result = editJsonConfig(original, key, entry);
  // New opencode configs get the schema reference for editor autocompletion.
  if (client.format === "opencode" && result.status === "changed" && !original?.trim()) {
    const data = JSON.parse(result.text) as Record<string, unknown>;
    return {
      ...result,
      text: `${JSON.stringify({ $schema: "https://opencode.ai/config.json", ...data }, null, 2)}\n`,
    };
  }
  return result;
}

/** Whether a config text already contains this server (used by `doctor`). */
export function findConfiguredEntry(client: ClientDef, text: string): unknown {
  if (client.format === "codex") {
    return text.split(/\r?\n/).some((line) => TOML_OUR_HEADER.test(line)) ? {} : undefined;
  }
  try {
    const clean = text.replace(/^\uFEFF/, "");
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(clean) as Record<string, unknown>;
    } catch {
      // doctor/uninstall must see entries in JSONC files too (setup only refuses to rewrite them).
      data = JSON.parse(stripJsonc(clean)) as Record<string, unknown>;
    }
    const section = data[topLevelKey(client.format)];
    if (!isPlainObject(section)) return undefined;
    return section[SERVER_KEY] ?? Object.values(section).find(launchesPackage);
  } catch {
    return undefined;
  }
}
