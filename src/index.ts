#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMemoryCacheStore } from "./cache.js";
import { helpText, listSourcesText, readOption, runDoctor, runSetup } from "./cli.js";
import { createServer } from "./server.js";
import { SOURCES, SOURCES_ENV, parseSourceSelection, type SourceId } from "./sources.js";
import type { Env } from "./types.js";

// Single source of truth for the package version: the published package.json.
function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/index.js → ../package.json (after build). src/index.ts → ../package.json in dev.
  const pkgPath = resolve(here, "..", "package.json");
  const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  return typeof raw.version === "string" ? raw.version : "0.0.0";
}

// Commands and flags that must not start the MCP transport. Handled before any
// MCP setup so they work even when stdin is empty (e.g. `npx -y polish-academic-mcp --help`).
// Returns an exit code, or null to start the server.
async function handleCli(argv: readonly string[], version: string): Promise<number | null> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(helpText(version));
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write(`${version}\n`);
    return 0;
  }
  if (argv.includes("--list-sources")) {
    process.stdout.write(listSourcesText());
    return 0;
  }
  switch (argv[0]) {
    case "setup":
    case "install":
      return runSetup(argv.slice(1));
    case "uninstall":
    case "remove":
      return runSetup(argv.slice(1), true);
    case "doctor":
      return runDoctor(argv.slice(1));
    default:
      return null;
  }
}

// --sources wins over the env var; an unusable selection falls back to all sources
// so a typo in a client config never leaves the user with a dead server.
function selectSources(argv: readonly string[]): SourceId[] {
  const spec = readOption(argv, "--sources") ?? process.env[SOURCES_ENV];
  const { ids, unknown } = parseSourceSelection(spec);
  if (unknown.length > 0) {
    console.error(`Ignoring unknown sources: ${unknown.join(", ")} (see --list-sources)`);
  }
  if (ids.length === 0) {
    console.error("Source selection is empty; enabling all sources.");
    return SOURCES.map((s) => s.id);
  }
  return ids;
}

function installProcessDiagnostics(): void {
  const onStreamError = (label: string) => (error: unknown) => {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "EPIPE" || err?.code === "ERR_STREAM_DESTROYED") {
      // Broken stdout pipe means the MCP parent is gone; terminate gracefully.
      if (label === "stdout") {
        process.exit(0);
      }
      // Stderr can be detached by some hosts; do not terminate the server for that.
      return;
    }
    console.error(`${label} stream error:`, err);
  };

  process.stdin.on("end", () => {
    console.error("stdin end");
  });
  process.stdin.on("close", () => {
    console.error("stdin close");
  });
  process.stdin.on("error", (error) => {
    console.error("stdin stream error:", error);
  });

  process.stdout.on("error", onStreamError("stdout"));
  process.stderr.on("error", onStreamError("stderr"));

  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception in MCP runtime:", error);
    process.exitCode = 1;
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection in MCP runtime:", reason);
    process.exitCode = 1;
  });
}

function buildEnv(): Env {
  return {
    CACHE_KV: createMemoryCacheStore(),
    BDL_CLIENT_ID: process.env.BDL_CLIENT_ID,
    PBN_APP_ID: process.env.PBN_APP_ID,
    PBN_APP_TOKEN: process.env.PBN_APP_TOKEN,
    PBN_USER_TOKEN: process.env.PBN_USER_TOKEN,
  };
}

async function main(): Promise<void> {
  const version = readPackageVersion();
  const argv = process.argv.slice(2);
  const exitCode = await handleCli(argv, version);
  if (exitCode !== null) {
    // Exit only after stdout is flushed: writes to a pipe are asynchronous on macOS,
    // and an immediate exit could cut off output captured by scripts or AI agents.
    process.stdout.write("", () => process.exit(exitCode));
    return;
  }

  installProcessDiagnostics();

  const sources = selectSources(argv);
  const server = createServer(buildEnv(), { sources });
  const transport = new StdioServerTransport();

  process.on("SIGINT", () => {
    void server.close().finally(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    void server.close().finally(() => process.exit(0));
  });

  await server.connect(transport);
  console.error(
    `Polish Academic MCP ${version} running on stdio (${sources.length}/${SOURCES.length} sources)`,
  );
  if (process.stdin.isTTY) {
    // Started by hand in a terminal: explain instead of silently waiting for JSON-RPC.
    console.error(
      [
        "",
        "To jest serwer MCP — uruchamia go aplikacja AI (Claude, Cursor, VS Code, LM Studio…), nie człowiek.",
        "Aby dodać go do swoich aplikacji, zamknij go (Ctrl+C) i uruchom kreator:",
        "  npx -y polish-academic-mcp setup",
        "",
      ].join("\n"),
    );
  }
}

main().catch((error) => {
  console.error("Fatal error starting Polish Academic MCP:", error);
  process.exit(1);
});
