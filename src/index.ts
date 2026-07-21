#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMemoryCacheStore } from "./cache.js";
import { createServer } from "./server.js";
import type { Env } from "./types.js";

// Single source of truth for the package version: the published package.json.
function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/index.js → ../package.json (after build). src/index.ts → ../package.json in dev.
  const pkgPath = resolve(here, "..", "package.json");
  const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  return typeof raw.version === "string" ? raw.version : "0.0.0";
}

// Minimal stdio CLI: detect --help/--version before any MCP setup so flags are
// honored even when stdin is empty (e.g. `npx -y polish-academic-mcp --help`).
function handleCli(argv: readonly string[], version: string): boolean {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        `${process.argv[1] ? "polish-academic-mcp" : "polish-academic-mcp"} — lokalny serwer MCP dla polskich zasobów akademickich`,
        "",
        "Użycie:",
        "  polish-academic-mcp            uruchamia serwer MCP (stdio JSON-RPC)",
        "  polish-academic-mcp --help     wyświetla tę pomoc i kończy działanie (kod 0)",
        "  polish-academic-mcp --version  wyświetla wersję pakietu i kończy działanie (kod 0)",
        "",
        "Konfiguracja klienta: dodaj polecenie `npx -y polish-academic-mcp` jako transport stdio.",
        `Aktualna wersja: ${version}`,
        "",
      ].join("\n"),
    );
    return true;
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write(`${version}\n`);
    return true;
  }
  return false;
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
    WEB3FORMS_ACCESS_KEY: process.env.WEB3FORMS_ACCESS_KEY,
    PBN_APP_ID: process.env.PBN_APP_ID,
    PBN_APP_TOKEN: process.env.PBN_APP_TOKEN,
    PBN_USER_TOKEN: process.env.PBN_USER_TOKEN,
  };
}

async function main(): Promise<void> {
  const version = readPackageVersion();
  if (handleCli(process.argv.slice(2), version)) {
    process.exit(0);
  }

  installProcessDiagnostics();

  const server = createServer(buildEnv());
  const transport = new StdioServerTransport();

  process.on("SIGINT", () => {
    void server.close().finally(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    void server.close().finally(() => process.exit(0));
  });

  await server.connect(transport);
  console.error("Polish Academic MCP running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting Polish Academic MCP:", error);
  process.exit(1);
});