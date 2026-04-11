"""
MCP Evaluator — Python Test Runner
====================================
Connects to MCP server via SSE/Streamable HTTP, executes test cases,
and computes RQ-aligned scores.

Usage:
    python scripts/eval/evaluator.py [--url http://localhost:8787/mcp] [--rq RQ1]
    python scripts/eval/evaluator.py --url http://localhost:8787/mcp
    python scripts/eval/evaluator.py --model claude-3.5-sonnet --rq RQ2

Modes:
    - Direct: Calls MCP tools directly (no LLM)
    - LLM: Uses OpenRouter to send prompts, LLM calls MCP tools autonomously
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Add parent dir to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from test_cases import (
    ALL_TEST_CASES,
    TestCase,
    RQ,
    Domain,
    Complexity,
    get_cases_by_rq,
    get_cases_by_tool,
    export_to_json,
    summary,
)
from metrics import (
    ToolResponse,
    CompositeScore,
    compute_composite_score,
    extract_span_attributes,
)

load_dotenv()


# ─────────────────────────────────────────────────────────────────────────────
# MCP Client (SSE / Streamable HTTP)
# ─────────────────────────────────────────────────────────────────────────────


class McpClient:
    """Minimal MCP client for evaluation."""

    def __init__(self, url: str, jwt: str | None = None):
        self.url = url.rstrip("/")
        self.headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if jwt:
            self.headers["Authorization"] = f"Bearer {jwt}"
        self._client: httpx.AsyncClient | None = None
        self._request_id = 0

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=30.0)
        return self

    async def __aexit__(self, *args):
        if self._client:
            await self._client.aclose()

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    async def _rpc(self, method: str, params: dict | None = None) -> dict:
        """Send JSON-RPC 2.0 request to MCP server."""
        if not self._client:
            raise RuntimeError(
                "Client not initialized. Use 'async with McpClient(...)'"
            )

        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": method,
            "params": params or {},
        }

        resp = await self._client.post(
            self.url,
            json=payload,
            headers=self.headers,
        )

        # Handle SSE response
        content_type = resp.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            # Parse SSE: extract JSON from data: lines
            for line in resp.text.split("\n"):
                if line.startswith("data: "):
                    return json.loads(line[6:])
            return {"error": {"message": "No data in SSE stream"}}

        return resp.json()

    async def initialize(self) -> dict:
        """Initialize MCP session."""
        return await self._rpc(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "polish-academic-evaluator",
                    "version": "2.0.0",
                },
            },
        )

    async def list_tools(self) -> list[str]:
        """List available tool names."""
        result = await self._rpc("tools/list")
        tools = result.get("result", {}).get("tools", [])
        return [t["name"] for t in tools]

    async def list_tool_defs(self) -> list[dict]:
        """List tool definitions (name, description, schema)."""
        result = await self._rpc("tools/list")
        tools = result.get("result", {}).get("tools", [])
        return [
            {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t.get("inputSchema", {}),
            }
            for t in tools
        ]

    async def call_tool(self, name: str, arguments: dict) -> dict:
        """Call an MCP tool."""
        result = await self._rpc(
            "tools/call",
            {
                "name": name,
                "arguments": arguments,
            },
        )
        return result.get("result", result)


# ─────────────────────────────────────────────────────────────────────────────
# LLM-in-the-loop (OpenRouter)
# ─────────────────────────────────────────────────────────────────────────────


async def run_with_llm(
    client: McpClient,
    test_case: TestCase,
    tool_defs: list[dict],
    model: str,
    api_key: str,
) -> tuple[str, float, list[str], Any]:
    """
    Run test case through LLM (OpenRouter).
    LLM decides which tools to call based on the prompt.
    Returns (text, latency_ms, tools_called, raw).
    """
    OR_BASE = "https://openrouter.ai/api/v1/chat/completions"

    tools = [
        {
            "type": "function",
            "function": {
                "name": td["name"],
                "description": td["description"] or td["name"],
                "parameters": td["parameters"] or {"type": "object", "properties": {}},
            },
        }
        for td in tool_defs
    ]

    system_prompt = (
        "You are a research assistant with access to Polish academic database tools. "
        "Use the available tools to answer the user's research query. "
        "Always call at least one tool. Return a concise, factual answer citing the source."
    )

    user_prompt = (
        f"Research task: {test_case.prompt_en}\n\n"
        f"Expected tool: {test_case.mcp_tool}\n"
        f"Required fields: {', '.join(test_case.ground_truth.get('expected_fields', [])) or 'none'}"
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    tools_called: list[str] = []
    last_tool_text = ""
    last_tool_raw = None
    start = time.time()
    MAX_TURNS = 8

    async with httpx.AsyncClient(timeout=60.0) as http:
        for turn in range(MAX_TURNS):
            body = {
                "model": model,
                "messages": messages,
                "tools": tools,
                "tool_choice": "required" if turn == 0 else "auto",
                "max_tokens": 2048,
            }

            resp = await http.post(
                OR_BASE,
                json=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                    "HTTP-Referer": "https://github.com/asterixix/polish-academic-mcp",
                    "X-Title": "polish-academic-mcp-eval",
                },
            )

            if resp.status_code != 200:
                raise RuntimeError(f"OpenRouter error {resp.status_code}: {resp.text}")

            data = resp.json()
            choice = data["choices"][0]
            assistant_msg = choice["message"]

            messages.append(
                {
                    "role": "assistant",
                    "content": assistant_msg.get("content"),
                }
            )

            tool_calls = assistant_msg.get("tool_calls", [])
            if tool_calls:
                # Add tool_calls to assistant message
                messages[-1]["tool_calls"] = tool_calls

                for tc in tool_calls:
                    tool_name = tc["function"]["name"]
                    tools_called.append(tool_name)

                    try:
                        tool_args = json.loads(tc["function"].get("arguments", "{}"))
                    except json.JSONDecodeError:
                        tool_args = {}

                    try:
                        result = await client.call_tool(tool_name, tool_args)
                        content = result.get("content", [])
                        tool_text = _response_to_text(content)
                        last_tool_text = tool_text
                        last_tool_raw = content
                    except Exception as e:
                        tool_text = f"Error: {e}"

                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "name": tool_name,
                            "content": tool_text[:8000],
                        }
                    )
                continue

            break

    latency_ms = (time.time() - start) * 1000
    return last_tool_text, latency_ms, tools_called, last_tool_raw


def _response_to_text(raw: Any) -> str:
    """Convert MCP response content to text."""
    if isinstance(raw, str):
        return raw
    if isinstance(raw, list):
        parts = []
        for item in raw:
            if isinstance(item, dict) and "text" in item:
                parts.append(str(item["text"]))
            else:
                parts.append(json.dumps(item))
        return "\n".join(parts)
    return json.dumps(raw) if raw else ""


# ─────────────────────────────────────────────────────────────────────────────
# Test Case Execution
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class CaseReport:
    id: str
    name: str
    rq: str
    tool: str
    passed: bool
    composite_score: float
    latency_ms: float
    failed_metrics: list[str]
    metric_scores: dict[str, float]
    error: str | None = None
    response_preview: str | None = None


@dataclass
class EvalReport:
    run_at: str
    server_url: str
    rq_filter: str
    total_cases: int
    passed_cases: int
    failed_cases: int
    overall_score: float
    by_rq: dict[str, Any]
    cases: list[CaseReport]


async def run_single_case(
    client: McpClient,
    test_case: TestCase,
    available_tools: list[str],
) -> tuple[ToolResponse, CompositeScore]:
    """Execute a single test case in direct mode."""
    start = time.time()
    raw = None
    status_code = 200
    error = None

    # Select tool
    selected_tool = test_case.mcp_tool
    if selected_tool not in available_tools:
        # Fallback: find by prefix
        prefix = selected_tool.split("_")[0].lower()
        for t in available_tools:
            if prefix in t.lower():
                selected_tool = t
                break

    try:
        result = await client.call_tool(
            selected_tool,
            {
                "query": test_case.prompt_en,
                **(
                    {"prompt": test_case.prompt_en}
                    if "query" not in test_case.mcp_tool
                    else {}
                ),
            },
        )
        raw = result.get("content", result)
        if result.get("isError"):
            status_code = 500
            error = _response_to_text(raw)
    except Exception as e:
        status_code = 500
        error = str(e)
        raw = {"error": error}

    latency_ms = (time.time() - start) * 1000
    span_attributes = extract_span_attributes(raw)
    text = _response_to_text(raw)

    response = ToolResponse(
        raw=raw,
        text=text,
        latency_ms=latency_ms,
        status_code=status_code,
        span_attributes=span_attributes,
        error=error,
    )

    score = compute_composite_score(response, test_case)
    return response, score


async def run_evaluation(
    server_url: str,
    rq_filter: str = "ALL",
    jwt: str | None = None,
    model: str | None = None,
    openrouter_key: str | None = None,
) -> EvalReport:
    """Run full evaluation suite."""
    llm_mode = bool(model and openrouter_key)

    print("🎯 Polish Academic MCP — Research Evaluator (Python)")
    print(f"   Server:    {server_url}")
    print(f"   RQ filter: {rq_filter}")
    print(f"   Mode:      {'LLM-in-the-loop' if llm_mode else 'direct tool calls'}")
    if llm_mode:
        print(f"   Model:     {model}")
    print()

    async with McpClient(server_url, jwt) as client:
        print("🔌 Initializing MCP session...")
        await client.initialize()

        available_tools = await client.list_tools()
        print(
            f"📋 Available tools ({len(available_tools)}): {', '.join(available_tools[:10])}..."
        )
        print()

        tool_defs = await client.list_tool_defs() if llm_mode else []

        # Select test cases
        if rq_filter == "ALL":
            test_cases = ALL_TEST_CASES
        else:
            test_cases = get_cases_by_rq(rq_filter)

        print(f"🧪 Running {len(test_cases)} test cases...\n")

        results: list[tuple[TestCase, ToolResponse, CompositeScore]] = []

        for tc in test_cases:
            sys.stdout.write(f"  {tc.id:<12} {tc.prompt_en[:50]:<52} ")
            sys.stdout.flush()

            if llm_mode:
                try:
                    text, latency, tools_called, raw = await run_with_llm(
                        client, tc, tool_defs, model, openrouter_key
                    )
                    response = ToolResponse(
                        raw=raw,
                        text=text,
                        latency_ms=latency,
                        status_code=200 if text else 500,
                        span_attributes=extract_span_attributes(raw),
                        error=None if text else "LLM produced no tool output",
                    )
                    score = compute_composite_score(response, tc)
                except Exception as e:
                    response = ToolResponse(
                        raw={"error": str(e)},
                        text=f"Error: {e}",
                        latency_ms=0,
                        status_code=500,
                        error=str(e),
                    )
                    score = compute_composite_score(response, tc)
            else:
                response, score = await run_single_case(client, tc, available_tools)

            icon = "✅" if score.passed else "❌"
            pct = f"{score.composite_score * 100:.1f}%"
            print(f"{icon} {pct}  {response.latency_ms:.0f}ms")
            results.append((tc, response, score))

    # Build report
    case_reports = [
        CaseReport(
            id=tc.id,
            name=tc.prompt_en[:60],
            rq=tc.rq.value,
            tool=tc.mcp_tool,
            passed=score.passed,
            composite_score=score.composite_score,
            latency_ms=response.latency_ms,
            failed_metrics=score.failed_metrics,
            metric_scores={m.metric_id: m.score for m in score.metrics},
            error=response.error,
            response_preview=response.text[:240] if response.text else None,
        )
        for tc, response, score in results
    ]

    passed = sum(1 for c in case_reports if c.passed)
    overall = (
        sum(c.composite_score for c in case_reports) / len(case_reports)
        if case_reports
        else 0
    )

    # Group by RQ
    by_rq: dict[str, Any] = {}
    for rq_val in ["RQ1", "RQ2", "RQ3"]:
        rq_cases = [c for c in case_reports if c.rq == rq_val]
        if rq_cases:
            rq_passed = sum(1 for c in rq_cases if c.passed)
            rq_avg = sum(c.composite_score for c in rq_cases) / len(rq_cases)
            by_rq[rq_val] = {
                "total": len(rq_cases),
                "passed": rq_passed,
                "average_score": rq_avg,
            }

    report = EvalReport(
        run_at=datetime.utcnow().isoformat() + "Z",
        server_url=server_url,
        rq_filter=rq_filter,
        total_cases=len(case_reports),
        passed_cases=passed,
        failed_cases=len(case_reports) - passed,
        overall_score=overall,
        by_rq=by_rq,
        cases=case_reports,
    )

    return report


def print_summary(report: EvalReport) -> None:
    """Print formatted evaluation summary."""
    bar = "═" * 60
    print(f"\n{bar}")
    print("  POLISH ACADEMIC MCP — EVALUATION REPORT")
    print(bar)
    print(f"  Run at:        {report.run_at}")
    print(f"  Server:        {report.server_url}")
    print(f"  RQ filter:     {report.rq_filter}")
    print(f"  Total cases:   {report.total_cases}")
    print(
        f"  Passed:        {report.passed_cases} / {report.total_cases} "
        f"({report.passed_cases / report.total_cases * 100:.1f}%)"
        if report.total_cases
        else "  Passed: 0/0"
    )
    print(f"  Overall score: {report.overall_score * 100:.1f}%")
    print(bar)

    for rq, data in sorted(report.by_rq.items()):
        pct = data["passed"] / data["total"] * 100 if data["total"] else 0
        print(
            f"\n  {rq}  —  {data['passed']}/{data['total']} passed  |  "
            f"avg score: {data['average_score'] * 100:.1f}%"
        )

    print(f"\n{bar}")
    print("  CASE DETAILS")
    print(bar)
    for c in report.cases:
        icon = "✅" if c.passed else "❌"
        score = f"{c.composite_score * 100:.1f}%"
        failed = f"  ⚠ {', '.join(c.failed_metrics)}" if c.failed_metrics else ""
        print(f"  {icon} {c.id:<12} {c.name[:45]:<47} {score}{failed}")
    print(bar + "\n")


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Polish Academic MCP — Python Evaluation Runner",
    )
    parser.add_argument(
        "--url",
        default=os.getenv("MCP_SERVER_URL", "http://localhost:8787/mcp"),
        help="MCP server URL (default: localhost:8787/mcp)",
    )
    parser.add_argument(
        "--rq",
        default="ALL",
        choices=["ALL", "RQ1", "RQ2", "RQ3"],
        help="Filter by research question (default: ALL)",
    )
    parser.add_argument(
        "--jwt",
        default=os.getenv("MCP_BEARER_TOKEN", ""),
        help="JWT bearer token for authenticated access",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="OpenRouter model id for LLM-in-the-loop mode (e.g., anthropic/claude-3.5-sonnet)",
    )
    parser.add_argument(
        "--openrouter-key",
        default=os.getenv("OPENROUTER_API_KEY", ""),
        help="OpenRouter API key (or set OPENROUTER_API_KEY env var)",
    )
    parser.add_argument(
        "--out",
        default="./eval-results",
        help="Output directory for results JSON (default: ./eval-results)",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="Print test case summary and exit",
    )
    parser.add_argument(
        "--export-json",
        action="store_true",
        help="Export test cases to JSON and exit",
    )

    args = parser.parse_args()

    if args.summary:
        summary()
        return

    if args.export_json:
        export_to_json()
        return

    report = asyncio.run(
        run_evaluation(
            server_url=args.url,
            rq_filter=args.rq,
            jwt=args.jwt or None,
            model=args.model,
            openrouter_key=args.openrouter_key or None,
        )
    )

    print_summary(report)

    # Save results
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    suffix = f"{args.rq}"
    if args.model:
        suffix += f"-llm-{args.model.replace('/', '_')}"
    out_path = out_dir / f"eval-{suffix}-{int(time.time()) * 1000}.json"

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "run_at": report.run_at,
                "server_url": report.server_url,
                "rq_filter": report.rq_filter,
                "total_cases": report.total_cases,
                "passed_cases": report.passed_cases,
                "failed_cases": report.failed_cases,
                "overall_score": report.overall_score,
                "by_rq": report.by_rq,
                "cases": [
                    {
                        "id": c.id,
                        "name": c.name,
                        "rq": c.rq,
                        "tool": c.tool,
                        "passed": c.passed,
                        "composite_score": c.composite_score,
                        "latency_ms": c.latency_ms,
                        "failed_metrics": c.failed_metrics,
                        "metric_scores": c.metric_scores,
                        "error": c.error,
                        "response_preview": c.response_preview,
                    }
                    for c in report.cases
                ],
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    print(f"💾 Results saved to: {out_path}\n")


if __name__ == "__main__":
    main()
