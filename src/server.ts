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
import { registerAmuTools } from "./tools/amu.js";
import { registerUafmTools } from "./tools/uafm.js";
import { registerIcmTools } from "./tools/icm.js";
import { registerImgwTools } from "./tools/imgw.js";
import { registerAghTools } from "./tools/agh.js";
import { registerRcinTools } from "./tools/rcin.js";
import { registerPknTools } from "./tools/pkn.js";
import { registerPolonTools } from "./tools/polon.js";
import { registerPbnTools } from "./tools/pbn.js";
import { registerBdlTools } from "./tools/bdl.js";
import { registerBaztolTools } from "./tools/baztol.js";
import { registerNacTools } from "./tools/nac.js";
import { registerSumTools } from "./tools/sum.js";
import { registerIsapTools } from "./tools/isap.js";
import { registerSejmBsTools } from "./tools/sejm-bs.js";
import { registerSaosTools } from "./tools/saos.js";
import { registerWolneLekturyTools } from "./tools/wolne-lektury.js";
import { registerNinatekaTools } from "./tools/ninateka.js";
import { registerGaplaTools } from "./tools/gapla.js";
import { registerLudzieNaukiTools } from "./tools/ludzie-nauki.js";
import { registerPauartTools } from "./tools/pauart.js";
import { registerWiedzaTools } from "./tools/wiedza.js";
import { registerBlzTools } from "./tools/blz.js";
import { registerFototekaTools } from "./tools/fototeka.js";
import { registerFilmpolskiTools } from "./tools/filmpolski.js";
import { registerFototekaslaskaTools } from "./tools/fototekaslaska.js";
import { registerFilmotekaRepoTools } from "./tools/filmoteka-repo.js";
import { registerDokumentySlaskaTools } from "./tools/dokumenty-slaska.js";

export function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: "Polish Academic MCP",
    version: "1.0.1",
  });

  registerBibliotekaTools(server, env);
  registerRujTools(server, env);
  registerRodbukTools(server, env);
  registerRepodTools(server, env);
  registerDaneTools(server, env);
  registerAmuTools(server, env);
  registerUafmTools(server, env);
  registerIcmTools(server, env);
  registerImgwTools(server, env);
  registerAghTools(server, env);
  registerRcinTools(server, env);
  registerPknTools(server, env);
  registerWiedzaTools(server, env);
  registerBlzTools(server, env);
  registerPolonTools(server, env);
  registerPbnTools(server, env);
  registerBdlTools(server, env);
  registerBaztolTools(server, env);
  registerNacTools(server, env);
  registerSumTools(server, env);
  registerIsapTools(server, env);
  registerSejmBsTools(server, env);
  registerSaosTools(server, env);
  registerWolneLekturyTools(server, env);
  registerNinatekaTools(server, env);
  registerGaplaTools(server, env);
  registerLudzieNaukiTools(server, env);
  registerPauartTools(server, env);
  registerFototekaTools(server, env);
  registerFilmpolskiTools(server, env);
  registerFototekaslaskaTools(server, env);
  registerFilmotekaRepoTools(server, env);
  registerDokumentySlaskaTools(server, env);

  return server;
}
