/**
 * Głęboki przebieg scenariuszy z scripts/scenario-catalogue.ts.
 *
 *   npx tsx scripts/scenario-all.ts
 *   npx tsx scripts/scenario-all.ts --source bn,isap
 *   npx tsx scripts/scenario-all.ts --group kultura
 *
 * Raport: scripts/out/scenario-report.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fetchAndParseUrl } from "../src/content-fetcher.js";
import { SOURCES } from "../src/sources.js";
import { SCENARIOS, type Scenario, type ScenarioStep, type ScenarioValue } from "./scenario-catalogue.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TIMEOUT_MS = 35_000;

interface StepReport {
  tool: string;
  ok: boolean;
  blocked: boolean;
  durationMs: number;
  error?: string;
  excerpt: string;
  captured: Record<string, string>;
  read?: { ok: boolean; url: string; format?: string; excerpt: string; error?: string };
}

interface ScenarioReport {
  id: string;
  source: string;
  question: string;
  status: "ok" | "partial" | "fail" | "skip";
  durationMs: number;
  steps: StepReport[];
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function selectedScenarios(): Scenario[] {
  const source = argValue("--source");
  const group = argValue("--group");
  const id = argValue("--id");
  let list = SCENARIOS;
  if (id) {
    const ids = new Set(id.split(",").map((s) => s.trim()));
    list = list.filter((s) => ids.has(s.id));
  }
  if (source) {
    const ids = new Set(source.split(",").map((s) => s.trim()));
    list = list.filter((s) => ids.has(s.source));
  }
  if (group) {
    const groups = new Set(group.split(",").map((s) => s.trim()));
    const inGroup = new Set(SOURCES.filter((s) => groups.has(s.group)).map((s) => s.id));
    list = list.filter((s) => inGroup.has(s.source));
  }
  return list;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (item && typeof item === "object" && "text" in item) {
        return String((item as { text?: string }).text ?? "");
      }
      return "";
    })
    .join("\n");
}

function fillString(input: string, bag: Record<string, string>): string | number {
  const only = input.match(/^\$([A-Za-z0-9_]+)(?::number)?$/);
  if (only) {
    const raw = bag[only[1]];
    if (raw === undefined) throw new Error(`brak wartości $${only[1]} z poprzedniego kroku`);
    return input.endsWith(":number") ? Number(raw) : raw;
  }
  if (!input.includes("$")) return input;
  return input.replace(/\$([A-Za-z0-9_]+)/g, (_full, name: string) => {
    const raw = bag[name];
    if (raw === undefined) throw new Error(`brak wartości $${name} z poprzedniego kroku`);
    return raw;
  });
}

function fillValue(value: ScenarioValue, bag: Record<string, string>): unknown {
  if (typeof value === "string") return fillString(value, bag);
  if (Array.isArray(value)) return value.map((item) => fillValue(item, bag));
  return value;
}

function fillArgs(
  args: Record<string, ScenarioValue> | undefined,
  bag: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value === undefined) continue;
    out[key] = fillValue(value, bag);
  }
  return out;
}

function captureFrom(text: string, capture: Record<string, string> | undefined, bag: Record<string, string>): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [name, pattern] of Object.entries(capture ?? {})) {
    const match = text.match(new RegExp(pattern, "i"));
    const group = match?.slice(1).find((value) => value !== undefined && value.length > 0);
    if (group) {
      bag[name] = group.trim();
      found[name] = bag[name];
    }
  }
  return found;
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readDocument(url: string, grep: string | undefined, timeoutMs: number): Promise<StepReport["read"]> {
  try {
    const doc = await withTimeout(
      fetchAndParseUrl(url, { grep, maxChars: 1600 }),
      timeoutMs,
    );
    const failed = /Brak wystąpień wzorca/.test(doc.text) && Boolean(grep);
    return {
      ok: !failed,
      url: doc.url,
      format: doc.detectedFormat,
      excerpt: doc.text.slice(0, 500),
      ...(failed ? { error: "wzorzec nie wystąpił w pobranym pliku" } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      url,
      excerpt: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runStep(
  clientRef: { current: Client },
  step: ScenarioStep,
  bag: Record<string, string>,
): Promise<StepReport> {
  const started = Date.now();
  const timeoutMs = step.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let args: Record<string, unknown>;
  try {
    args = fillArgs(step.args, bag);
  } catch (err) {
    return {
      tool: step.tool,
      ok: false,
      blocked: true,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      excerpt: "",
      captured: {},
    };
  }

  try {
    const result = await withTimeout(
      (async () => {
        try {
          return await clientRef.current.callTool({ name: step.tool, arguments: args });
        } catch (err) {
          if (!isDisconnect(err)) throw err;
          try {
            await clientRef.current.close();
          } catch {
            /* poprzednia sesja już nie żyje */
          }
          clientRef.current = await connectClient();
          return await clientRef.current.callTool({ name: step.tool, arguments: args });
        }
      })(),
      timeoutMs,
    );
    const text = textOf(result.content);
    const toolError = Boolean(result.isError) || /^Error[: ]/i.test(text.trim());
    const captured = captureFrom(text, step.capture, bag);
    const missingCapture = Object.keys(step.capture ?? {}).filter((name) => !(name in captured));
    let read: StepReport["read"];
    if (!toolError && missingCapture.length === 0 && step.read) {
      read = await readDocument(String(fillString(step.read.url, bag)), step.read.grep, timeoutMs);
    } else if (!toolError && step.readFromOutput) {
      const url = text.match(new RegExp(step.readFromOutput.pattern, "i"))?.[1];
      if (url) read = await readDocument(url, step.readFromOutput.grep, timeoutMs);
    }
    const authSkip = /PBN_APP_ID/.test(text);
    const ok = !toolError && !authSkip && (read?.ok ?? true);
    return {
      tool: step.tool,
      ok,
      blocked: false,
      durationMs: Date.now() - started,
      excerpt: text.slice(0, 360).replace(/\s+/g, " "),
      captured,
      ...(authSkip ? { error: "brak kluczy PBN_APP_ID i PBN_APP_TOKEN" } : {}),
      ...(missingCapture.length > 0 && !toolError
        ? { error: `brak identyfikatora (${missingCapture.join(", ")}) do kolejnego kroku` }
        : {}),
      ...(toolError && !authSkip ? { error: text.slice(0, 300).replace(/\s+/g, " ") } : {}),
      ...(read ? { read } : {}),
    };
  } catch (err) {
    return {
      tool: step.tool,
      ok: false,
      blocked: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      excerpt: "",
      captured: {},
    };
  }
}

function scenarioStatus(steps: StepReport[]): ScenarioReport["status"] {
  const authOnly = steps.every((step) => step.ok || /PBN_APP_ID|brak kluczy PBN/.test(step.error ?? ""));
  if (authOnly && steps.some((step) => /brak kluczy PBN/.test(step.error ?? ""))) return "skip";
  if (steps.every((step) => step.ok)) return "ok";
  if (steps.some((step) => step.ok)) return "partial";
  return "fail";
}

async function connectClient(): Promise<Client> {
  const client = new Client({ name: "scenario-all", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts", "--mode=granular"],
    cwd: root,
    stderr: "pipe",
  });
  await client.connect(transport);
  return client;
}

function isDisconnect(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Not connected|Connection closed|-32000/.test(msg);
}

async function main(): Promise<void> {
  const scenarios = selectedScenarios();
  if (scenarios.length === 0) {
    console.error("Brak scenariuszy dla podanego filtra.");
    process.exit(1);
  }

  const clientRef = { current: await connectClient() };

  const reports: ScenarioReport[] = [];
  console.log(`Scenariusze: ${scenarios.length}`);
  for (const scenario of scenarios) {
    const started = Date.now();
    const bag: Record<string, string> = {};
    const steps: StepReport[] = [];
    for (const step of scenario.steps) {
      const report = await runStep(clientRef, step, bag);
      steps.push(report);
      const mark = report.ok ? "OK" : report.blocked ? "BLOK" : "FAIL";
      const extra = report.read ? ` | plik ${report.read.ok ? "OK" : "FAIL"} ${report.read.format ?? ""}` : "";
      console.log(
        `  [${mark}] ${scenario.source}/${report.tool} ${report.durationMs}ms${extra}${report.error ? ` — ${report.error.slice(0, 140)}` : ""}`,
      );
    }
    const status = scenarioStatus(steps);
    reports.push({
      id: scenario.id,
      source: scenario.source,
      question: scenario.question,
      status,
      durationMs: Date.now() - started,
      steps,
    });
    console.log(`[${status.toUpperCase()}] ${scenario.id} — ${scenario.question}`);
  }

  await clientRef.current.close();

  const outDir = resolve(root, "scripts", "out");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, "scenario-report.json");
  writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2));

  const ok = reports.filter((r) => r.status === "ok").length;
  const partial = reports.filter((r) => r.status === "partial").length;
  const fail = reports.filter((r) => r.status === "fail").length;
  const skip = reports.filter((r) => r.status === "skip").length;
  console.log(`\nRazem: ${reports.length} | ok ${ok} | częściowe ${partial} | błąd ${fail} | pominięte ${skip}`);
  console.log(`Raport: ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
