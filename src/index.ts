#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMemoryCacheStore } from "./cache.js";
import { createServer } from "./server.js";
import type { Env } from "./types.js";

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
