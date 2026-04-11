#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMemoryCacheStore } from "./cache.js";
import { createServer } from "./server.js";
import type { Env } from "./types.js";

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
