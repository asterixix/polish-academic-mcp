import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ALL_TEST_CASES } from "./eval/test-cases.js";

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
  const map = new Map<string, Record<string, unknown>>();
  for (const tc of ALL_TEST_CASES) {
    if (!map.has(tc.tool)) {
      map.set(tc.tool, tc.toolArgs ?? {});
    }
  }

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

async function main(): Promise<void> {
  const runnerArgs = parseArgs();
  const serverCommand = process.platform === "win32" ? ["node.exe", "dist/index.js"] : ["node", "dist/index.js"];
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

    const listResp = (await client.listTools()) as { tools?: ToolDef[] };

    let tools = listResp.tools ?? [];
    if (tools.length === 0) {
      throw new Error("No tools discovered from tools/list");
    }

    if (runnerArgs.include && runnerArgs.include.length > 0) {
      const wanted = new Set(runnerArgs.include);
      tools = tools.filter((t) => wanted.has(t.name));
    }

    if (runnerArgs.maxTools !== undefined) {
      tools = tools.slice(0, runnerArgs.maxTools);
    }

    if (!runnerArgs.quiet) {
      console.log(`Running smoke test for ${tools.length} tool(s)...`);
    }

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
  console.error(e);
  process.exitCode = 1;
});
