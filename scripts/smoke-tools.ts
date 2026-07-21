import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LIVE_SAMPLE_ARGS } from "./live-samples.js";

type ToolDef = {
  name: string;
};

type ToolSmokeResult = {
  tool: string;
  ok: boolean;
  durationMs: number;
  args: Record<string, unknown>;
  error?: string;
  isErrorResult?: boolean;
};

type RunnerArgs = {
  maxTools?: number;
  include?: string[];
  pair?: boolean;
  timeoutMs: number;
  stopAfterFailures?: number;
  quiet: boolean;
};

function parseArgs(): RunnerArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    return v && !v.startsWith("--") ? v : undefined;
  };

  const maxToolsRaw = get("--max-tools");
  const includeRaw = get("--include");
  const timeoutRaw = get("--timeout-ms");
  const stopAfterFailuresRaw = get("--stop-after-failures");
  const pair = argv.includes("--pair");
  const quiet = argv.includes("--quiet");

  const maxTools =
    maxToolsRaw !== undefined && Number.isFinite(Number(maxToolsRaw))
      ? Math.max(1, Math.floor(Number(maxToolsRaw)))
      : undefined;

  const include = includeRaw
    ? includeRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const timeoutMs =
    timeoutRaw !== undefined && Number.isFinite(Number(timeoutRaw))
      ? Math.max(1000, Math.floor(Number(timeoutRaw)))
      : 45000;

  const stopAfterFailures =
    stopAfterFailuresRaw !== undefined && Number.isFinite(Number(stopAfterFailuresRaw))
      ? Math.max(1, Math.floor(Number(stopAfterFailuresRaw)))
      : undefined;

  return {
    maxTools,
    include,
    pair,
    timeoutMs,
    stopAfterFailures,
    quiet,
  };
}

function responseToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (item && typeof item === "object" && "text" in (item as Record<string, unknown>)) {
          return String((item as Record<string, unknown>).text ?? "");
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }
  return JSON.stringify(content ?? "");
}

function buildSampleArgsMap(): Map<string, Record<string, unknown>> {
  const map = new Map(Object.entries(LIVE_SAMPLE_ARGS));

  // Keep these in sync with current tool zod schemas in src/tools/*.ts.
  map.set("rcin_get_record", { record_id: "204728", metadata_format: "oai_dc" });
  map.set("wiedza_search_norms", { title: "bezpieczeństwo informacji", rows_on_page: "20" });
  map.set("wiedza_get_standard", { standard_number: "PN-EN ISO/IEC 27001" });
  map.set("ninateka_search", { keyword: "film dokumentalny", limit: 10, first_result: 0 });
  map.set("ludzie_get_scientist", { profile_id: "jhMVc1vG5Yz" });
  map.set("pauart_get_artwork", { artwork_id: "AN_KIII_150_16476" });
  map.set("fn_repo_browse_kind", { kind: "doc", lang: "pl" });
  map.set("repod_get_dataset", { doi: "10.18150/LII8AM", format: "datacite" });

  return map;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const t = setTimeout(() => rejectPromise(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((v) => {
        clearTimeout(t);
        resolvePromise(v);
      })
      .catch((e: unknown) => {
        clearTimeout(t);
        rejectPromise(e);
      });
  });
}

// Dynamic search → get pairs. Each entry calls search, extracts the first
// usable id, then calls get with that id. Both calls must succeed.
interface SearchGetPair {
  searchTool: string;
  searchArgs: Record<string, unknown>;
  getTool: string;
  getArgs: (id: string) => Record<string, unknown>;
  extractId: (text: string) => string | null;
}

function firstUuid(text: string): string | null {
  const m = text.match(/"uuid"\s*:\s*"([a-f0-9-]{36})"/);
  return m ? m[1] : null;
}

function firstHitId(text: string): string | null {
  const m = text.match(/"id"\s*:\s*"([^"\s,}]+)"/);
  return m ? m[1] : null;
}

function firstPublicationId(text: string): string | null {
  const m = text.match(/"publicationId"\s*:\s*"(\d+)"/);
  return m ? m[1] : null;
}

const SEARCH_GET_PAIRS: SearchGetPair[] = [
  // DSpace 7/8 — compact summary uses {items:[{uuid}]}
  {
    searchTool: "agh_search",
    searchArgs: { query: "inżynieria materiałowa", size: 5 },
    getTool: "agh_get_item",
    getArgs: (id) => ({ uuid: id }),
    extractId: firstUuid,
  },
  {
    searchTool: "amu_search",
    searchArgs: { query: "pedagogika", size: 5 },
    getTool: "amu_get_item",
    getArgs: (id) => ({ uuid: id }),
    extractId: firstUuid,
  },
  {
    searchTool: "icm_search",
    searchArgs: { query: "climate change Poland", size: 5 },
    getTool: "icm_get_item",
    getArgs: (id) => ({ uuid: id }),
    extractId: firstUuid,
  },
  {
    searchTool: "ruj_search",
    searchArgs: { query: "uczenie maszynowe", size: 5 },
    getTool: "ruj_get_item",
    getArgs: (id) => ({ uuid: id }),
    extractId: firstUuid,
  },
  // Biblioteka Nauki — JSON {documents:[{publicationId}]}
  {
    searchTool: "bn_search_publications",
    searchArgs: { query: "sztuczna inteligencja", page: 1, page_size: 5 },
    getTool: "bn_get_article",
    getArgs: (id) => ({ article_id: id, metadata_format: "jats" }),
    extractId: firstPublicationId,
  },
];

async function runSingleTools(
  client: Client,
  tools: ToolDef[],
  sampleArgs: Map<string, Record<string, unknown>>,
  runnerArgs: RunnerArgs,
  results: ToolSmokeResult[],
): Promise<void> {
  for (const t of tools) {
    const toolArgs = sampleArgs.get(t.name) ?? {};
    const begin = Date.now();
    try {
      const resp = (await withTimeout(
        client.callTool({ name: t.name, arguments: toolArgs }),
        runnerArgs.timeoutMs,
      )) as { isError?: boolean; content?: unknown };

      const text = responseToText(resp.content ?? "");
      const isErrorResult = Boolean(resp.isError) || /^Error:/i.test(text.trim());

      results.push({
        tool: t.name,
        ok: !isErrorResult,
        durationMs: Date.now() - begin,
        args: toolArgs,
        isErrorResult,
        ...(isErrorResult ? { error: text.slice(0, 500) } : {}),
      });
      if (!runnerArgs.quiet) {
        const status = isErrorResult ? "FAIL" : "OK";
        console.log(`[${status}] ${t.name} (${Date.now() - begin}ms)`);
      }
    } catch (e) {
      results.push({
        tool: t.name,
        ok: false,
        durationMs: Date.now() - begin,
        args: toolArgs,
        error: e instanceof Error ? e.message : String(e),
      });
      if (!runnerArgs.quiet) {
        console.log(`[FAIL] ${t.name} (${Date.now() - begin}ms)`);
      }
    }

    if (runnerArgs.stopAfterFailures !== undefined) {
      const failuresSoFar = results.filter((r) => !r.ok).length;
      if (failuresSoFar >= runnerArgs.stopAfterFailures) {
        if (!runnerArgs.quiet) {
          console.log(`Stopping early after ${failuresSoFar} failure(s).`);
        }
        break;
      }
    }
  }
}

async function runPairs(
  client: Client,
  runnerArgs: RunnerArgs,
  results: ToolSmokeResult[],
): Promise<void> {
  for (const pair of SEARCH_GET_PAIRS) {
    const begin = Date.now();
    try {
      const searchResp = (await withTimeout(
        client.callTool({ name: pair.searchTool, arguments: pair.searchArgs }),
        runnerArgs.timeoutMs,
      )) as { isError?: boolean; content?: unknown };
      const searchText = responseToText(searchResp.content ?? "");
      const searchFailed = Boolean(searchResp.isError) || /^Error:/i.test(searchText.trim());
      if (searchFailed) {
        results.push({
          tool: pair.searchTool,
          ok: false,
          durationMs: Date.now() - begin,
          args: pair.searchArgs,
          error: `search failed: ${searchText.slice(0, 200)}`,
        });
        if (!runnerArgs.quiet)
          console.log(`[FAIL] ${pair.searchTool}→${pair.getTool} (search)`);
        continue;
      }
      const id = pair.extractId(searchText);
      if (!id) {
        results.push({
          tool: pair.searchTool,
          ok: false,
          durationMs: Date.now() - begin,
          args: pair.searchArgs,
          error: "could not extract id from search response",
        });
        if (!runnerArgs.quiet)
          console.log(`[FAIL] ${pair.searchTool}→${pair.getTool} (no id)`);
        continue;
      }
      const getArgs = pair.getArgs(id);
      const getResp = (await withTimeout(
        client.callTool({ name: pair.getTool, arguments: getArgs }),
        runnerArgs.timeoutMs,
      )) as { isError?: boolean; content?: unknown };
      const getText = responseToText(getResp.content ?? "");
      const getFailed =
        Boolean(getResp.isError) || /^Error:/i.test(getText.trim()) || getText.length < 10;
      results.push({
        tool: `${pair.searchTool}→${pair.getTool}`,
        ok: !getFailed,
        durationMs: Date.now() - begin,
        args: { search: pair.searchArgs, get: getArgs },
        isErrorResult: getFailed,
        ...(getFailed ? { error: getText.slice(0, 500) } : {}),
      });
      if (!runnerArgs.quiet)
        console.log(
          `[${getFailed ? "FAIL" : "OK"}] ${pair.searchTool}→${pair.getTool} (id=${id})`,
        );
    } catch (e) {
      results.push({
        tool: `${pair.searchTool}→${pair.getTool}`,
        ok: false,
        durationMs: Date.now() - begin,
        args: pair.searchArgs,
        error: e instanceof Error ? e.message : String(e),
      });
      if (!runnerArgs.quiet)
        console.log(`[FAIL] ${pair.searchTool}→${pair.getTool}`);
    }
  }
}

async function main(): Promise<void> {
  const runnerArgs = parseArgs();
  const serverCommand =
    process.platform === "win32" ? ["node.exe", "dist/index.js"] : ["node", "dist/index.js"];
  const sampleArgs = buildSampleArgsMap();

  const transport = new StdioClientTransport({
    command: serverCommand[0],
    args: serverCommand.slice(1),
    cwd: process.cwd(),
  });

  const client = new Client(
    {
      name: "tool-smoke-runner",
      version: "1.0.0",
    },
    { capabilities: {} },
  );

  const startedAt = new Date().toISOString();
  const results: ToolSmokeResult[] = [];

  try {
    await client.connect(transport);

    if (runnerArgs.pair) {
      if (!runnerArgs.quiet) console.log(`Running ${SEARCH_GET_PAIRS.length} search→get pair(s)...`);
      await runPairs(client, runnerArgs, results);
    } else {
      const listResp = (await client.listTools()) as { tools?: ToolDef[] };
      let tools = listResp.tools ?? [];
      if (tools.length === 0) throw new Error("No tools discovered from tools/list");
      if (runnerArgs.include && runnerArgs.include.length > 0) {
        const wanted = new Set(runnerArgs.include);
        tools = tools.filter((t) => wanted.has(t.name));
      }
      if (runnerArgs.maxTools !== undefined) {
        tools = tools.slice(0, runnerArgs.maxTools);
      }
      if (!runnerArgs.quiet) console.log(`Running smoke test for ${tools.length} tool(s)...`);
      await runSingleTools(client, tools, sampleArgs, runnerArgs, results);
    }
  } finally {
    try {
      await client.close();
    } catch {
      // ignore close errors
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    totalTools: results.length,
    passed,
    failed,
    results,
  };

  const outDir = resolve(process.cwd(), "eval-results");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `tool-smoke-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");

  console.log(`Tools tested: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Report: ${outPath}`);

  if (failed > 0) {
    console.log("Failed tools:");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`- ${r.tool}: ${r.error ?? "isError result"}`);
    }
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error("Smoke runner fatal error:", e);
  process.exit(1);
});