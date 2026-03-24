/**
 * Evaluation framework for Polish Academic MCP Server
 * 
 * Provides metrics for scoring:
 * - Tool selection accuracy
 * - Response latency
 * - Error rates
 * - Query understanding
 * - Token efficiency
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, type ChildProcess } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

interface EvalConfig {
  serverUrl: string;
  testCases: TestCase[];
  metrics: MetricConfig;
  outputPath: string;
}

interface TestCase {
  id: string;
  name: string;
  query: string;
  expectedTools: string[];
  expectedFields?: string[];
  domain: string;
}

interface MetricConfig {
  latencyThreshold: number; // ms
  minSuccessRate: number;   // 0-1
  minToolAccuracy: number;  // 0-1
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EvaluationResult {
  testCaseId: string;
  testCaseName: string;
  success: boolean;
  latency: number;
  toolsCalled: string[];
  toolAccuracy: number;
  errors: string[];
  responseSize: number;
  timestamp: number;
}

export interface EvaluationSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  successRate: number;
  averageLatency: number;
  averageToolAccuracy: number;
  results: EvaluationResult[];
  config: EvalConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Cases for Polish Academic MCP
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_TEST_CASES: TestCase[] = [
  // Biblioteka Nauki tests
  {
    id: "bib-001",
    name: "Search publications by author",
    query: "Find publications by Kowalski from 2020-2024",
    expectedTools: ["search_publications"],
    domain: "biblioteka-nauki",
  },
  {
    id: "bib-002",
    name: "Search by title keyword",
    query: "Search for papers containing 'machine learning'",
    expectedTools: ["search_publications"],
    domain: "biblioteka-nauki",
  },
  
  // RUJ tests
  {
    id: "ruj-001",
    name: "Find researcher by name",
    query: "Find researcher Jan Nowak",
    expectedTools: ["find_researcher"],
    domain: "ruj",
  },
  {
    id: "ruj-002",
    name: "Get researcher publications",
    query: "Get publications for researcher ID 12345",
    expectedTools: ["get_researcher_publications"],
    domain: "ruj",
  },
  
  // RODBUK tests
  {
    id: "rodbuk-001",
    name: "Search library catalog",
    query: "Search library catalog for programming books",
    expectedTools: ["search_catalog"],
    domain: "rodbuk",
  },
  
  // RepOD tests
  {
    id: "repod-001",
    name: "Find datasets",
    query: "Find datasets about climate change",
    expectedTools: ["search_datasets"],
    domain: "repod",
  },
  
  // Dane.gov.pl tests
  {
    id: "dane-001",
    name: "Search public datasets",
    query: "Find datasets about Polish economy",
    expectedTools: ["search_datasets"],
    domain: "dane",
  },
  
  // AMU (Adam Mickiewicz University) tests
  {
    id: "amu-001",
    name: "Find AMU researchers",
    query: "Find researchers at AMU in Poznań",
    expectedTools: ["search_researchers"],
    domain: "amu",
  },
  
  // UAFM tests
  {
    id: "uafm-001",
    name: "Find UAFM resources",
    query: "Find resources at UAFM",
    expectedTools: ["search"],
    domain: "uafm",
  },
  
  // ICM (Interdisciplinary Center for Mathematical and Computational Modelling) tests
  {
    id: "icm-001",
    name: "Find ICM computational resources",
    query: "Find computational resources at ICM",
    expectedTools: ["search_resources"],
    domain: "icm",
  },
  
  // IMGW (Institute of Meteorology and Water Management) tests
  {
    id: "imgw-001",
    name: "Get weather data",
    query: "Get current weather for Warsaw",
    expectedTools: ["get_weather"],
    domain: "imgw",
  },
  {
    id: "imgw-002",
    name: "Get historical data",
    query: "Get historical precipitation for Kraków 2023",
    expectedTools: ["get_historical_data"],
    domain: "imgw",
  },
  
  // AGH (University of Science and Technology) tests
  {
    id: "agh-001",
    name: "Find AGH publications",
    query: "Find publications from AGH University",
    expectedTools: ["search_publications"],
    domain: "agh",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MCP Client for Evaluation
// ─────────────────────────────────────────────────────────────────────────────

export class EvalMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private process: ChildProcess | null = null;

  async connect(serverCommand: string[], serverCwd?: string): Promise<void> {
    this.process = spawn(serverCommand[0], serverCommand.slice(1), {
      cwd: serverCwd || __dirname,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.transport = new StdioClientTransport({
      spawn: async () => this.process!,
    });

    this.client = new Client(
      {
        name: "polish-academic-evaluator",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await this.client.connect(this.transport);
  }

  async connectToUrl(url: string): Promise<void> {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");

    this.client = new Client(
      {
        name: "polish-academic-evaluator",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    const transport = new SSEClientTransport(new URL(url));
    await this.client.connect(transport);
  }

  async listTools(): Promise<string[]> {
    if (!this.client) throw new Error("Client not connected");
    const response = await this.client.request(
      { method: "tools/list" },
      { method: "tools/list", params: {} }
    );
    return (response.tools || []).map((t: any) => t.name);
  }

  async callTool(toolName: string, args: Record<string, any>): Promise<any> {
    if (!this.client) throw new Error("Client not connected");
    const response = await this.client.request(
      { method: "tools/call" },
      {
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      }
    );
    return response;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
    if (this.process) {
      this.process.kill();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluator
// ─────────────────────────────────────────────────────────────────────────────

export class McpEvaluator {
  private client: EvalMcpClient;
  private config: EvalConfig;

  constructor(config: Partial<EvalConfig> = {}) {
    this.client = new EvalMcpClient();
    this.config = {
      serverUrl: config.serverUrl || "http://localhost:8787/mcp",
      testCases: config.testCases || DEFAULT_TEST_CASES,
      metrics: config.metrics || {
        latencyThreshold: 5000,
        minSuccessRate: 0.8,
        minToolAccuracy: 0.7,
      },
      outputPath: config.outputPath || "./eval-results.json",
    };
  }

  async runEvaluation(): Promise<EvaluationSummary> {
    console.log("🔄 Connecting to MCP server...");
    await this.client.connectToUrl(this.config.serverUrl);

    console.log("📋 Available tools:");
    const availableTools = await this.client.listTools();
    availableTools.forEach((t) => console.log(`  - ${t}`));

    console.log(`\n🧪 Running ${this.config.testCases.length} test cases...\n`);

    const results: EvaluationResult[] = [];

    for (const testCase of this.config.testCases) {
      const result = await this.runTestCase(testCase, availableTools);
      results.push(result);
      
      const status = result.success ? "✅" : "❌";
      console.log(`${status} ${testCase.id}: ${testCase.name} (${result.latency}ms)`);
    }

    await this.client.disconnect();

    // Calculate summary
    const summary = this.calculateSummary(results);
    
    console.log("\n" + "=".repeat(50));
    console.log("📊 EVALUATION SUMMARY");
    console.log("=".repeat(50));
    console.log(`Total Tests: ${summary.totalTests}`);
    console.log(`Passed: ${summary.passedTests} | Failed: ${summary.failedTests}`);
    console.log(`Success Rate: ${(summary.successRate * 100).toFixed(1)}%`);
    console.log(`Average Latency: ${summary.averageLatency.toFixed(0)}ms`);
    console.log(`Average Tool Accuracy: ${(summary.averageToolAccuracy * 100).toFixed(1)}%`);
    
    return summary;
  }

  private async runTestCase(
    testCase: TestCase,
    availableTools: string[]
  ): Promise<EvaluationResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let toolsCalled: string[] = [];
    let success = false;

    try {
      // Try to call a relevant tool based on the query
      const relevantTool = this.findRelevantTool(testCase, availableTools);
      
      if (relevantTool) {
        const result = await this.client.callTool(relevantTool, {
          query: testCase.query,
        });
        
        toolsCalled = [relevantTool];
        success = result !== null && result !== undefined;
      } else {
        errors.push("No matching tool found for test case");
      }
    } catch (e: any) {
      errors.push(e.message || String(e));
    }

    const latency = Date.now() - startTime;
    const toolAccuracy = this.calculateToolAccuracy(
      toolsCalled,
      testCase.expectedTools,
      availableTools
    );

    return {
      testCaseId: testCase.id,
      testCaseName: testCase.name,
      success,
      latency,
      toolsCalled,
      toolAccuracy,
      errors,
      responseSize: 0,
      timestamp: Date.now(),
    };
  }

  private findRelevantTool(testCase: TestCase, availableTools: string[]): string | null {
    // Simple keyword matching to find relevant tool
    const query = testCase.query.toLowerCase();
    const domain = testCase.domain.toLowerCase();
    
    // Try to match by domain or keywords in tool name
    for (const tool of availableTools) {
      const toolLower = tool.toLowerCase();
      if (toolLower.includes(domain) || 
          query.some(q => toolLower.includes(q))) {
        return tool;
      }
    }
    
    // Return first tool as fallback
    return availableTools[0] || null;
  }

  private calculateToolAccuracy(
    called: string[],
    expected: string[],
    available: string[]
  ): number {
    if (expected.length === 0) return 1.0;
    if (called.length === 0) return 0.0;

    const matched = expected.filter((e) =>
      called.some((c) => c.toLowerCase().includes(e.toLowerCase()))
    );

    return matched.length / expected.length;
  }

  private calculateSummary(results: EvaluationResult[]): EvaluationSummary {
    const passedTests = results.filter((r) => r.success).length;
    const failedTests = results.filter((r) => !r.success).length;
    const totalTests = results.length;
    const successRate = totalTests > 0 ? passedTests / totalTests : 0;
    const averageLatency =
      results.reduce((a, r) => a + r.latency, 0) / totalTests;
    const averageToolAccuracy =
      results.reduce((a, r) => a + r.toolAccuracy, 0) / totalTests;

    return {
      totalTests,
      passedTests,
      failedTests,
      successRate,
      averageLatency,
      averageToolAccuracy,
      results,
      config: this.config,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const serverUrl = process.env.MCP_SERVER_URL || "http://localhost:8787/mcp";
  
  console.log("🎯 Polish Academic MCP Evaluator");
  console.log("================================\n");
  console.log(`Server URL: ${serverUrl}\n`);

  const evaluator = new McpEvaluator({
    serverUrl,
    testCases: DEFAULT_TEST_CASES,
  });

  const summary = await evaluator.runEvaluation();
  
  // Output JSON results
  console.log("\n📄 JSON Output:");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(console.error);
