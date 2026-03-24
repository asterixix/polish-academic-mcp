/**
 * Evaluation Runner
 * =================
 * Connects to the MCP server via SSE, executes each test case,
 * collects span attributes, and computes RQ-aligned scores.
 *
 * Usage:
 *   npx tsx scripts/eval/runner.ts [--rq RQ1] [--url http://localhost:8787/mcp]
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
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

function parseArgs(): { url: string; rq: ResearchQuestion | "ALL"; outputDir: string } {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };
  return {
    url: get("--url", process.env["MCP_SERVER_URL"] ?? "http://localhost:8787/mcp"),
    rq: (get("--rq", "ALL") as ResearchQuestion | "ALL"),
    outputDir: get("--out", "./eval-results"),
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

  async connect(url: string): Promise<void> {
    const transport = new SSEClientTransport(new URL(url));
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

// ─────────────────────────────────────────────────────────────────────────────
// Single test case execution
// ─────────────────────────────────────────────────────────────────────────────

async function runTestCase(
  client: EvalClient,
  testCase: EvalTestCase,
  availableTools: string[],
): Promise<{ response: ToolResponse; score: CompositeScore }> {
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
    const result = await client.callTool(selectedTool, testCase.toolArgs);
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
}

function buildReport(
  results: Array<{ testCase: EvalTestCase; response: ToolResponse; score: CompositeScore }>,
  serverUrl: string,
  rqFilter: string,
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
  const { url, rq, outputDir } = parseArgs();

  console.log("🎯 Polish Academic MCP — Research Evaluator");
  console.log(`   Server: ${url}`);
  console.log(`   RQ filter: ${rq}\n`);

  const client = new EvalClient();

  console.log("🔌 Connecting to MCP server...");
  await client.connect(url);

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

  const report = buildReport(results, url, rq);
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
