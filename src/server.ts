/**
 * MCP server factory.
 *
 * A new McpServer instance MUST be created for every request — sharing a
 * global instance causes cross-client data leakage (CVE fixed in SDK 1.26.0).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "./types.js";
import { registerBibliotekaTools } from "./tools/biblioteka-nauki.js";
import { registerRujTools } from "./tools/ruj.js";
import { registerRodbukTools } from "./tools/rodbuk.js";
import { registerRepodTools } from "./tools/repod.js";
import { registerDaneTools } from "./tools/dane.js";

export function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: "Polish Academic MCP",
    version: "1.0.0",
  });

  registerBibliotekaTools(server, env);
  registerRujTools(server, env);
  registerRodbukTools(server, env);
  registerRepodTools(server, env);
  registerDaneTools(server, env);

  return server;
}
