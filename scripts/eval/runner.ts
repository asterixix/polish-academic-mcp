/**
 * Evaluation Runner
 * =================
 * Connects to the MCP server via SSE, executes each test case,
 * collects span attributes, and computes RQ-aligned scores.
 *
 * Usage:
 *   npx tsx scripts/eval/runner.ts [--rq RQ1] [--url http://localhost:8787/mcp] [--jwt "$MCP_BEARER_TOKEN"]  # omit --jwt for guest
 *   npx tsx scripts/eval/runner.ts --transport sse   # legacy MCP servers (SSE-only)
 *
 * The deployed Cloudflare Worker uses Streamable HTTP (POST + SSE); use default transport.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import {
  ALL_TEST_CASES,
  getCasesByRQ,
  type EvalTestCase,
  type ResearchQuestion,
} from "./test-cases.js";
import {
  computeCompositeScore,
  type ToolResponse,
  type CompositeScore,
} from "./metrics.js";

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────

type McpTransportName = "streamable" | "sse";

function parseArgs(): {
  url: string;
  rq: ResearchQuestion | "ALL";
  outputDir: string;
  transport: McpTransportName;
  jwt?: string;
} {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };
  const transportRaw = get("--transport", "streamable").toLowerCase();
  const transport: McpTransportName =
    transportRaw === "sse" ? "sse" : "streamable";
  return {
    url: get("--url", process.env["MCP_SERVER_URL"] ?? "http://localhost:8787/mcp"),
    rq: get("--rq", "ALL") as ResearchQuestion | "ALL",
    outputDir: get("--out", "./eval-results"),
    transport,
    jwt: get("--jwt", process.env["MCP_BEARER_TOKEN"] ?? process.env["MCP_BYPASS_JWT"] ?? ""),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Client wrapper
// ─────────────────────────────────────────────────────────────────────────────

class EvalClient {
  private client: Client;
  private connected = false;

  constructor() {
    this.client = new Client(
      { name: "polish-academic-evaluator", version: "1.0.0" },
      { capabilities: {} },
    );
  }

  async connect(url: string, transportName: McpTransportName, jwt?: string): Promise<void> {
    const endpoint = new URL(url);
    const authHeader = jwt ? { Authorization: `Bearer ${jwt}` } : undefined;
    const transport =
      transportName === "sse"
        ? new SSEClientTransport(endpoint, {
            requestInit: authHeader ? { headers: authHeader } : undefined,
          })
        : new StreamableHTTPClientTransport(endpoint, {
            requestInit: authHeader ? { headers: authHeader } : undefined,
          });
    await this.client.connect(transport);
    this.connected = true;
  }

  async listTools(): Promise<string[]> {
    const res = await this.client.listTools();
    return res.tools.map((t) => t.name);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: unknown; isError?: boolean }> {
    return this.client.callTool({ name, arguments: args }) as Promise<{
      content: unknown;
      isError?: boolean;
    }>;
  }

  async close(): Promise<void> {
    if (this.connected) await this.client.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Span attribute collector
// Reads OTel attributes injected into the response by the server's tracing.ts
// ─────────────────────────────────────────────────────────────────────────────

function extractSpanAttributes(raw: unknown): Record<string, unknown> {
  // The server embeds span attributes in a `_span` envelope when
  // EVAL_MODE=true is set (see index.ts). Fall back to empty object.
  if (
    raw &&
    typeof raw === "object" &&
    "_span" in (raw as Record<string, unknown>)
  ) {
    return (raw as Record<string, unknown>)["_span"] as Record<string, unknown>;
  }
  return {};
}

function responseToText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((item) =>
        typeof item === "object" && item !== null && "text" in item
          ? String((item as Record<string, unknown>)["text"])
          : JSON.stringify(item),
      )
      .join("\n");
  }
  return JSON.stringify(raw ?? "");
}

function safeParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractFirstUuidFromSummary(text: string): string | undefined {
  const parsed = safeParseJson(text) as
    | { items?: Array<{ uuid?: string }>; _embedded?: { searchResult?: { _embedded?: { objects?: Array<{ _embedded?: { indexableObject?: { uuid?: string } } }> } } } }
    | null;
  if (!parsed) return undefined;
  const fromItems = parsed.items?.find((i) => typeof i.uuid === "string")?.uuid;
  if (fromItems) return fromItems;
  const fromHal =
    parsed._embedded?.searchResult?._embedded?.objects
      ?.find((o) => typeof o?._embedded?.indexableObject?.uuid === "string")
      ?._embedded?.indexableObject?.uuid;
  return fromHal;
}

function extractFirstDoi(text: string): string | undefined {
  const parsed = safeParseJson(text) as
    | { data?: { items?: Array<{ global_id?: string; globalId?: string }> } }
    | null;
  const doiFromJson =
    parsed?.data?.items?.find((i) => typeof i.global_id === "string" || typeof i.globalId === "string");
  const doi = doiFromJson?.global_id ?? doiFromJson?.globalId;
  if (doi?.startsWith("doi:")) return doi.slice(4);
  if (doi) return doi;

  const m = text.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return m?.[0];
}

async function resolveDynamicToolArgs(
  client: EvalClient,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = { ...args };

  const maybeUuid = String(next["uuid"] ?? "");
  const isPlaceholderUuid =
    maybeUuid === "test-uuid" || maybeUuid === "00000000-0000-0000-0000-000000000000";

  if (isPlaceholderUuid && tool.endsWith("_get_item")) {
    const pairMap: Record<string, { searchTool: string; searchArgs: Record<string, unknown> }> = {
      ruj_get_item: { searchTool: "ruj_search", searchArgs: { query: "machine learning", size: 1, page: 0 } },
      amu_get_item: { searchTool: "amu_search", searchArgs: { query: "education", size: 1, page: 0 } },
      uafm_get_item: { searchTool: "uafm_search", searchArgs: { query: "education", size: 1, page: 0 } },
      icm_get_item: { searchTool: "icm_search", searchArgs: { query: "climate", size: 1, page: 0 } },
      agh_get_item: { searchTool: "agh_search", searchArgs: { query: "engineering", size: 1, page: 0 } },
    };
    const pair = pairMap[tool];
    if (pair) {
      try {
        const search = await client.callTool(pair.searchTool, pair.searchArgs);
        const searchText = responseToText(search.content);
        const uuid = extractFirstUuidFromSummary(searchText);
        if (uuid) next["uuid"] = uuid;
      } catch {
        // Keep original args if dynamic resolution fails.
      }
    }
  }

  if (tool === "repod_get_dataset") {
    const maybeDoi = String(next["doi"] ?? "");
    if (!/^10\.\d{4,9}\//i.test(maybeDoi) || /ABCDEF/i.test(maybeDoi)) {
      try {
        const search = await client.callTool("repod_search", {
          query: "climate",
          type: "dataset",
          per_page: 1,
          start: 0,
        });
        const doi = extractFirstDoi(responseToText(search.content));
        if (doi) next["doi"] = doi;
      } catch {
        // Keep original args if dynamic resolution fails.
      }
    }
  }

  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// Single test case execution
// ─────────────────────────────────────────────────────────────────────────────

async function runTestCase(
  client: EvalClient,
  testCase: EvalTestCase,
  availableTools: string[],
): Promise<{ response: ToolResponse; score: CompositeScore }> {
  if (testCase.scenario) {
    return await runScenarioTestCase(client, testCase, availableTools);
  }

  const start = Date.now();
  let raw: unknown = null;
  let statusCode = 200;
  let error: string | undefined;

  // Determine which tool to actually call
  const selectedTool = availableTools.includes(testCase.tool)
    ? testCase.tool
    : availableTools.find((t) =>
        t.toLowerCase().includes(testCase.tool.split("_")[0].toLowerCase()),
      ) ?? availableTools[0] ?? testCase.tool;

  try {
    const resolvedArgs = await resolveDynamicToolArgs(client, selectedTool, testCase.toolArgs);
    const result = await client.callTool(selectedTool, resolvedArgs);
    raw = result.content;
    if (result.isError) {
      statusCode = 500;
      error = responseToText(raw);
    }
  } catch (e: unknown) {
    statusCode = 500;
    error = e instanceof Error ? e.message : String(e);
    raw = { error };
  }

  const latencyMs = Date.now() - start;
  const spanAttributes = extractSpanAttributes(raw);
  const text = responseToText(raw);

  const response: ToolResponse = {
    raw,
    text,
    latencyMs,
    statusCode,
    spanAttributes,
    error,
  };

  const score = computeCompositeScore(response, testCase, selectedTool);

  return { response, score };
}

type StepContext = Record<
  string,
  {
    response: ToolResponse;
    raw: unknown;
    text: string;
  }
>;

function isRefObject(v: unknown): v is { $ref: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o["$ref"] === "string" && Object.keys(o).length === 1;
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function deepResolveRefs(value: unknown, context: StepContext): unknown {
  if (isRefObject(value)) {
    const targetPath = value.$ref;
    // Examples:
    // - "outreach.response.text"
    // - "discover.response.raw"
    const [stepId] = targetPath.split(".");
    if (!stepId || !context[stepId]) return undefined;
    return getByPath(context, targetPath);
  }

  if (Array.isArray(value)) return value.map((v) => deepResolveRefs(v, context));

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = deepResolveRefs(v, context);
    }
    return out;
  }

  return value;
}

async function runScenarioTestCase(
  client: EvalClient,
  testCase: EvalTestCase,
  availableTools: string[],
): Promise<{ response: ToolResponse; score: CompositeScore }> {
  if (!testCase.scenario) {
    throw new Error("runScenarioTestCase called without testCase.scenario");
  }

  const scenario = testCase.scenario;
  const stepResponses: Record<string, ToolResponse> = {};

  for (const step of scenario.steps) {
    // Build context lazily for refs in this step.
    const context: StepContext = Object.fromEntries(
      Object.entries(stepResponses).map(([id, tr]) => [
        id,
        { response: tr, raw: tr.raw, text: tr.text },
      ]),
    );

    const resolvedArgs = deepResolveRefs(step.toolArgs, context) as Record<string, unknown>;
    const start = Date.now();

    let raw: unknown = null;
    let statusCode = 200;
    let error: string | undefined;

    try {
      const result = await client.callTool(step.tool, resolvedArgs);
      raw = result.content;
      if (result.isError) {
        statusCode = 500;
        error = responseToText(raw);
      }
    } catch (e: unknown) {
      statusCode = 500;
      error = e instanceof Error ? e.message : String(e);
      raw = { error };
    }

    const latencyMs = Date.now() - start;
    const spanAttributes = extractSpanAttributes(raw);
    const text = responseToText(raw);

    const response: ToolResponse = {
      raw,
      text,
      latencyMs,
      statusCode,
      spanAttributes,
      error,
    };

    stepResponses[step.id] = response;
  }

  const finalStepId =
    scenario.scoreFromStepId ?? scenario.steps[scenario.steps.length - 1]?.id;
  if (!finalStepId) {
    throw new Error(`Invalid scenario for test case ${testCase.id}: missing scoreFromStepId and steps[].id`);
  }

  const finalStep = scenario.steps.find((s) => s.id === finalStepId);
  if (!finalStep) {
    throw new Error(`Scenario for ${testCase.id} references unknown scoreFromStepId=${finalStepId}`);
  }

  const finalResponse = stepResponses[finalStepId];
  const selectedTool = finalStep.tool;

  // For RQ1-M3 tool-selection metric, we rely on testCase.tool matching selectedTool.
  const score = computeCompositeScore(finalResponse, testCase, selectedTool);
  return { response: finalResponse, score };
}

// ─────────────────────────────────────────────────────────────────────────────
// Report generation
// ─────────────────────────────────────────────────────────────────────────────

interface EvalReport {
  runAt: string;
  serverUrl: string;
  rqFilter: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  overallScore: number;
  byRQ: Record<string, RQSummary>;
  cases: CaseReport[];
  toolCoverage: ToolCoverage[];
  untestedTools: string[];
}

interface RQSummary {
  rq: string;
  totalCases: number;
  passedCases: number;
  averageScore: number;
  metricAverages: Record<string, number>;
  topFailures: string[];
}

interface CaseReport {
  id: string;
  name: string;
  rq: string[];
  tool: string;
  selectedTool: string;
  passed: boolean;
  compositeScore: number;
  latencyMs: number;
  failedMetrics: string[];
  metricScores: Record<string, number>;
  error?: string;
  responsePreview?: string;
}

interface ToolCoverage {
  tool: string;
  hasTestCase: boolean;
  executedCases: number;
  passedCases: number;
  passRate: number;
  coreSuccessRate: number;
}

function buildReport(
  results: Array<{ testCase: EvalTestCase; response: ToolResponse; score: CompositeScore }>,
  serverUrl: string,
  rqFilter: string,
  availableTools: string[],
): EvalReport {
  const cases: CaseReport[] = results.map(({ testCase, response, score }) => ({
    id: testCase.id,
    name: testCase.name,
    rq: testCase.rq,
    tool: testCase.tool,
    selectedTool: score.metrics.find((m) => m.metricId === "RQ1-M3")
      ?.evidence["selectedTool"] as string ?? testCase.tool,
    passed: score.passed,
    compositeScore: score.compositeScore,
    latencyMs: response.latencyMs,
    failedMetrics: score.failedMetrics,
    metricScores: Object.fromEntries(score.metrics.map((m) => [m.metricId, m.score])),
    error: response.error,
    responsePreview: response.text.slice(0, 240),
  }));

  const passedCases = cases.filter((c) => c.passed).length;
  const overallScore = cases.reduce((s, c) => s + c.compositeScore, 0) / cases.length;

  // Group by RQ
  const rqGroups: Record<string, CaseReport[]> = {};
  for (const c of cases) {
    for (const rq of c.rq) {
      if (!rqGroups[rq]) rqGroups[rq] = [];
      rqGroups[rq].push(c);
    }
  }

  const byRQ: Record<string, RQSummary> = {};
  for (const [rq, group] of Object.entries(rqGroups)) {
    const avgScore = group.reduce((s, c) => s + c.compositeScore, 0) / group.length;
    const allMetricIds = [...new Set(group.flatMap((c) => Object.keys(c.metricScores)))];
    const metricAverages: Record<string, number> = {};
    for (const mid of allMetricIds) {
      const vals = group.map((c) => c.metricScores[mid] ?? 0);
      metricAverages[mid] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    const failureCounts: Record<string, number> = {};
    for (const c of group) {
      for (const f of c.failedMetrics) {
        failureCounts[f] = (failureCounts[f] ?? 0) + 1;
      }
    }
    const topFailures = Object.entries(failureCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => `${id} (${count}x)`);

    byRQ[rq] = {
      rq,
      totalCases: group.length,
      passedCases: group.filter((c) => c.passed).length,
      averageScore: avgScore,
      metricAverages,
      topFailures,
    };
  }

  const casesByTool: Record<string, CaseReport[]> = {};
  for (const c of cases) {
    if (!casesByTool[c.selectedTool]) casesByTool[c.selectedTool] = [];
    casesByTool[c.selectedTool].push(c);
  }

  const toolCoverage: ToolCoverage[] = availableTools
    .map((tool) => {
      const toolCases = casesByTool[tool] ?? [];
      const passed = toolCases.filter((c) => c.passed).length;
      const corePassed = toolCases.filter((c) => (c.metricScores["CORE-M1"] ?? 0) >= 1).length;
      return {
        tool,
        hasTestCase: toolCases.length > 0,
        executedCases: toolCases.length,
        passedCases: passed,
        passRate: toolCases.length > 0 ? passed / toolCases.length : 0,
        coreSuccessRate: toolCases.length > 0 ? corePassed / toolCases.length : 0,
      };
    })
    .sort((a, b) => a.tool.localeCompare(b.tool));

  const untestedTools = toolCoverage.filter((t) => !t.hasTestCase).map((t) => t.tool);

  return {
    runAt: new Date().toISOString(),
    serverUrl,
    rqFilter,
    totalCases: cases.length,
    passedCases,
    failedCases: cases.length - passedCases,
    overallScore,
    byRQ,
    cases,
    toolCoverage,
    untestedTools,
  };
}

function printSummary(report: EvalReport): void {
  const bar = "═".repeat(60);
  console.log(`\n${bar}`);
  console.log("  POLISH ACADEMIC MCP — EVALUATION REPORT");
  console.log(bar);
  console.log(`  Run at:       ${report.runAt}`);
  console.log(`  Server:       ${report.serverUrl}`);
  console.log(`  RQ filter:    ${report.rqFilter}`);
  console.log(`  Total cases:  ${report.totalCases}`);
  console.log(
    `  Passed:       ${report.passedCases} / ${report.totalCases}` +
    ` (${((report.passedCases / report.totalCases) * 100).toFixed(1)}%)`,
  );
  console.log(`  Overall score: ${(report.overallScore * 100).toFixed(1)}%`);
  console.log(bar);

  for (const [rq, summary] of Object.entries(report.byRQ).sort()) {
    const pct = ((summary.passedCases / summary.totalCases) * 100).toFixed(1);
    const scorePct = (summary.averageScore * 100).toFixed(1);
    console.log(`\n  ${rq}  —  ${summary.passedCases}/${summary.totalCases} passed  |  avg score: ${scorePct}%`);
    if (summary.topFailures.length > 0) {
      console.log(`    Top failures: ${summary.topFailures.join(", ")}`);
    }
    // Print worst metric averages
    const worstMetrics = Object.entries(summary.metricAverages)
      .filter(([, v]) => v < 0.7)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3);
    if (worstMetrics.length > 0) {
      console.log(
        `    Weak metrics: ${worstMetrics.map(([id, v]) => `${id}=${(v * 100).toFixed(0)}%`).join(", ")}`,
      );
    }
  }

  console.log(`\n${bar}`);
  console.log("  TOOL COVERAGE");
  console.log(bar);
  for (const t of report.toolCoverage) {
    const tested = t.hasTestCase ? "tested" : "UNTESTED";
    const passPct = (t.passRate * 100).toFixed(0);
    const corePct = (t.coreSuccessRate * 100).toFixed(0);
    console.log(
      `  ${t.tool.padEnd(20)} ${tested.padEnd(8)} cases=${String(t.executedCases).padEnd(3)} pass=${passPct}% core=${corePct}%`,
    );
  }
  if (report.untestedTools.length > 0) {
    console.log(`\n  ⚠ Untested tools: ${report.untestedTools.join(", ")}`);
  }

  console.log(`\n${bar}`);
  console.log("  CASE DETAILS");
  console.log(bar);
  for (const c of report.cases) {
    const icon = c.passed ? "✅" : "❌";
    const score = (c.compositeScore * 100).toFixed(1);
    const failed = c.failedMetrics.length > 0 ? `  ⚠ ${c.failedMetrics.join(", ")}` : "";
    console.log(`  ${icon} ${c.id.padEnd(12)} ${c.name.slice(0, 40).padEnd(42)} ${score}%${failed}`);
  }
  console.log(bar + "\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { url, rq, outputDir, transport, jwt } = parseArgs();

  console.log("🎯 Polish Academic MCP — Research Evaluator");
  console.log(`   Server: ${url}`);
  console.log(`   Transport: ${transport}`);
  console.log(`   Bearer: ${jwt?.trim() ? `set (${jwt.slice(0, 12)}…)` : "guest (no header)"}`);
  console.log(`   RQ filter: ${rq}\n`);

  const client = new EvalClient();

  console.log("🔌 Connecting to MCP server...");
  await client.connect(url, transport, jwt);

  const availableTools = await client.listTools();
  console.log(`📋 Available tools (${availableTools.length}): ${availableTools.join(", ")}\n`);

  const testCases: EvalTestCase[] =
    rq === "ALL"
      ? ALL_TEST_CASES
      : getCasesByRQ(rq as ResearchQuestion);

  console.log(`🧪 Running ${testCases.length} test cases (filter: ${rq})...\n`);

  const results: Array<{
    testCase: EvalTestCase;
    response: ToolResponse;
    score: CompositeScore;
  }> = [];

  for (const testCase of testCases) {
    process.stdout.write(`  ${testCase.id.padEnd(12)} ${testCase.name.slice(0, 45).padEnd(47)} `);
    const { response, score } = await runTestCase(client, testCase, availableTools);
    const icon = score.passed ? "✅" : "❌";
    const pct = (score.compositeScore * 100).toFixed(1);
    console.log(`${icon} ${pct}%  ${response.latencyMs}ms`);
    results.push({ testCase, response, score });
  }

  await client.close();

  const report = buildReport(results, url, rq, availableTools);
  printSummary(report);

  // Save results
  mkdirSync(outputDir, { recursive: true });
  const outPath = resolve(outputDir, `eval-${rq}-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`💾 Results saved to: ${outPath}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
