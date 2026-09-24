/**
 * MCP server factory.
 *
 * A new McpServer instance MUST be created for every request — sharing a
 * global instance causes cross-client data leakage (CVE fixed in SDK 1.26.0).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "./types.js";
import { SOURCE_GROUPS, SOURCES, groupsOf, type SourceId } from "./sources.js";

// Mirror src/index.ts: read the version from package.json so the handshake
// value cannot drift from the published package.
function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "package.json");
  const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  return typeof raw.version === "string" ? raw.version : "0.0.0";
}
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

type RegisterFn = (server: McpServer, env: Env) => void;

// Record over SourceId: adding a source to src/sources.ts without mapping it here fails to compile.
const REGISTER: Record<SourceId, RegisterFn> = {
  bn: registerBibliotekaTools,
  rcin: registerRcinTools,
  ruj: registerRujTools,
  agh: registerAghTools,
  amu: registerAmuTools,
  uafm: registerUafmTools,
  icm: registerIcmTools,
  rodbuk: registerRodbukTools,
  repod: registerRepodTools,
  polon: registerPolonTools,
  pbn: registerPbnTools,
  ludzie: registerLudzieNaukiTools,
  baztol: registerBaztolTools,
  sum: registerSumTools,
  dane: registerDaneTools,
  bdl: registerBdlTools,
  imgw: registerImgwTools,
  isap: registerIsapTools,
  saos: registerSaosTools,
  bs_sejm: registerSejmBsTools,
  pkn: registerPknTools,
  wiedza: registerWiedzaTools,
  wolnelektury: registerWolneLekturyTools,
  ninateka: registerNinatekaTools,
  gapla: registerGaplaTools,
  fototeka: registerFototekaTools,
  filmpolski: registerFilmpolskiTools,
  fototekaslaska: registerFototekaslaskaTools,
  fn_repo: registerFilmotekaRepoTools,
  nac: registerNacTools,
  pauart: registerPauartTools,
  blz: registerBlzTools,
  dokumenty_slaska: registerDokumentySlaskaTools,
};

export interface ServerOptions {
  /** Sources to register. Defaults to every source (the stable 85-tool list). */
  sources?: readonly SourceId[];
  /** Called for every registered tool; used by `--list-sources` to count tools. */
  onToolRegistered?: (source: SourceId, toolName: string) => void;
}

function buildInstructions(ids: readonly SourceId[]): string {
  const groups = groupsOf(ids)
    .map((group) => `${group} (${SOURCE_GROUPS[group]})`)
    .join("; ");
  return [
    "Narzędzia przeszukują polskie bazy naukowe, publiczne i kulturowe. Prefiks nazwy wskazuje bazę (np. bn_ = Biblioteka Nauki, isap_ = akty prawne, bdl_ = GUS).",
    "Zwykle najpierw wywołaj narzędzie *_search, a potem *_get_* z identyfikatorem z wyników, aby pobrać szczegóły.",
    "Odpowiedzi to surowe dane ze źródła (JSON, XML lub HTML): wybierz z nich potrzebne informacje i podawaj linki do źródeł.",
    "Frazy wyszukiwania podawaj po polsku; użytkownikowi odpowiadaj w jego języku.",
    "Gdy baza zwróci błąd lub jest niedostępna, powiedz o tym i spróbuj innej bazy z tej samej grupy.",
    ...(ids.includes("pbn")
      ? ["Narzędzia pbn_* działają tylko po ustawieniu PBN_APP_ID i PBN_APP_TOKEN."]
      : []),
    `Włączone grupy: ${groups}.`,
  ].join("\n");
}

// Every tool only reads public data from external services.
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: true } as const;

export function createServer(env: Env, options: ServerOptions = {}): McpServer {
  const ids = options.sources ?? SOURCES.map((s) => s.id);
  const server = new McpServer(
    { name: "Polish Academic MCP", version: readPackageVersion() },
    { instructions: buildInstructions(ids) },
  );

  // Wrap tool registration once instead of editing all 33 tool modules: tag each
  // tool read-only (fewer confirmation prompts in clients that honor the hint)
  // and report which source registered it.
  let current: SourceId = ids[0];
  const register = server.tool.bind(server) as (...args: unknown[]) => RegisteredTool;
  server.tool = ((...args: unknown[]) => {
    const tool = register(...args);
    tool.update({ annotations: { ...READ_ONLY_ANNOTATIONS, ...tool.annotations } });
    options.onToolRegistered?.(current, String(args[0]));
    return tool;
  }) as McpServer["tool"];

  const enabled = new Set(ids);
  for (const { id } of SOURCES) {
    if (!enabled.has(id)) continue;
    current = id;
    REGISTER[id](server, env);
  }

  return server;
}
