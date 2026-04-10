"""
CUDA-Accelerated Batch Evaluation
====================================
Standalone script for GPU-accelerated batch evaluation using local LLMs.

Requirements:
    pip install torch --index-url https://download.pytorch.org/whl/cu121
    pip install transformers accelerate

Usage:
    # Single model evaluation
    python scripts/eval/cuda_batch.py --model meta-llama/Llama-3.1-8B-Instruct --rq RQ1

    # Multi-model comparison
    python scripts/eval/cuda_batch.py --models meta-llama/Llama-3.1-8B-Instruct speakleash/Bielik-7B-Instruct-v0.1

    # Batch across all RQs
    python scripts/eval/cuda_batch.py --model meta-llama/Llama-3.1-8B-Instruct --rq ALL --batch-size 8

    # With MCP server for real tool calls
    python scripts/eval/cuda_batch.py --model meta-llama/Llama-3.1-8B-Instruct --mcp-url http://localhost:8787/mcp

This script:
1. Loads a local LLM with CUDA acceleration
2. Sends test case prompts to the model
3. Optionally connects to MCP server for real tool execution
4. Computes RQ-aligned scores in parallel batches
5. Generates comparative reports across models
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any

# Add parent dir to path
sys.path.insert(0, str(Path(__file__).parent))

from test_cases import (
    ALL_TEST_CASES,
    TestCase,
    RQ,
    Domain,
    Complexity,
    get_cases_by_rq,
)
from metrics import (
    ToolResponse,
    CompositeScore,
    compute_composite_score,
    extract_span_attributes,
)

# ─────────────────────────────────────────────────────────────────────────────
# CUDA / PyTorch imports (optional)
# ─────────────────────────────────────────────────────────────────────────────

try:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    CUDA_AVAILABLE = torch.cuda.is_available()
except ImportError:
    CUDA_AVAILABLE = False
    torch = None  # type: ignore

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore


# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class CudaConfig:
    model_id: str
    device: str = "cuda" if CUDA_AVAILABLE else "cpu"
    dtype: str = "float16"
    max_new_tokens: int = 2048
    temperature: float = 0.1
    quantize_4bit: bool = False
    batch_size: int = 4


@dataclass
class BatchResult:
    model_id: str
    test_case_id: str
    rq: str
    prompt: str
    generated_text: str
    latency_ms: float
    tokens_in: int
    tokens_out: int
    score: CompositeScore | None = None
    error: str | None = None


# ─────────────────────────────────────────────────────────────────────────────
# Model Loader
# ─────────────────────────────────────────────────────────────────────────────


class LocalLlm:
    """Wrapper for local LLM inference with CUDA support."""

    def __init__(self, config: CudaConfig):
        if not CUDA_AVAILABLE:
            print("⚠ CUDA not available — falling back to CPU (slow)")
            config.device = "cpu"

        self.config = config
        self.model = None
        self.tokenizer = None

    def load(self):
        """Load model and tokenizer."""
        print(f"📦 Loading model: {self.config.model_id}")
        print(f"   Device: {self.config.device}")
        print(f"   Dtype: {self.config.dtype}")

        dtype_map = {
            "float16": torch.float16 if torch else None,
            "bfloat16": torch.bfloat16 if torch else None,
            "float32": torch.float32 if torch else None,
        }

        model_kwargs: dict[str, Any] = {
            "device_map": "auto" if self.config.device == "cuda" else None,
            "torch_dtype": dtype_map.get(self.config.dtype),
        }

        if self.config.quantize_4bit and CUDA_AVAILABLE:
            model_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=dtype_map.get(self.config.dtype),
                bnb_4bit_use_double_quant=True,
                bnb_4bit_quant_type="nf4",
            )

        self.tokenizer = AutoTokenizer.from_pretrained(
            self.config.model_id,
            trust_remote_code=True,
        )
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        self.model = AutoModelForCausalLM.from_pretrained(
            self.config.model_id,
            **model_kwargs,
        )
        self.model.eval()
        print(f"✅ Model loaded on {self.config.device}")

    def generate(self, prompt: str, system_prompt: str = "") -> tuple[str, int, int]:
        """Generate text from prompt. Returns (text, tokens_in, tokens_out)."""
        if not self.model or not self.tokenizer:
            raise RuntimeError("Model not loaded. Call load() first.")

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        # Apply chat template if available
        if hasattr(self.tokenizer, "apply_chat_template"):
            formatted = self.tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        else:
            formatted = f"{system_prompt}\n\nUser: {prompt}\nAssistant:"

        inputs = self.tokenizer(formatted, return_tensors="pt")
        if self.config.device == "cuda":
            inputs = {k: v.cuda() for k, v in inputs.items()}

        tokens_in = inputs["input_ids"].shape[1]

        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=self.config.max_new_tokens,
                temperature=self.config.temperature,
                do_sample=self.config.temperature > 0,
                pad_token_id=self.tokenizer.pad_token_id,
            )

        # Decode only the generated part
        generated_ids = outputs[0][tokens_in:]
        text = self.tokenizer.decode(generated_ids, skip_special_tokens=True)
        tokens_out = len(generated_ids)

        return text, tokens_in, tokens_out


# ─────────────────────────────────────────────────────────────────────────────
# MCP Tool Execution (optional)
# ─────────────────────────────────────────────────────────────────────────────


class SimpleMcpClient:
    """Minimal sync MCP client for batch evaluation."""

    def __init__(self, url: str):
        self.url = url
        self._id = 0

    def call_tool(self, name: str, arguments: dict) -> str:
        """Call MCP tool and return text result."""
        if not httpx:
            raise RuntimeError("httpx not installed. pip install httpx")

        self._id += 1
        payload = {
            "jsonrpc": "2.0",
            "id": self._id,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }

        with httpx.Client(timeout=30.0) as client:
            resp = client.post(self.url, json=payload)
            data = resp.json()
            result = data.get("result", {})
            content = result.get("content", [])
            if isinstance(content, list):
                return "\n".join(
                    item.get("text", json.dumps(item))
                    for item in content
                    if isinstance(item, dict)
                )
            return str(content)


# ─────────────────────────────────────────────────────────────────────────────
# Batch Evaluation
# ─────────────────────────────────────────────────────────────────────────────


def run_batch_evaluation(
    model: LocalLlm,
    test_cases: list[TestCase],
    mcp_client: SimpleMcpClient | None = None,
    batch_size: int = 4,
) -> list[BatchResult]:
    """Run batch evaluation with local LLM."""
    results: list[BatchResult] = []
    total = len(test_cases)

    system_prompt = (
        "You are a research assistant evaluating Polish academic databases. "
        "Analyze the given query and provide a structured response. "
        "If you have access to MCP tools, use them to fetch real data. "
        "Otherwise, explain what information you would expect to find."
    )

    for i in range(0, total, batch_size):
        batch = test_cases[i : i + batch_size]
        print(
            f"\n📦 Batch {i // batch_size + 1}/{(total + batch_size - 1) // batch_size} "
            f"({len(batch)} cases)"
        )

        for tc in batch:
            prompt = (
                f"Query: {tc.prompt_en}\n\n"
                f"Expected tool: {tc.mcp_tool}\n"
                f"Domain: {tc.domain.value}\n"
                f"Expected fields: {', '.join(tc.ground_truth.get('expected_fields', [])) or 'none'}"
            )

            start = time.time()
            try:
                text, tokens_in, tokens_out = model.generate(prompt, system_prompt)

                # Optionally execute MCP tool
                tool_result = None
                if mcp_client and tc.mcp_tool:
                    try:
                        tool_result = mcp_client.call_tool(
                            tc.mcp_tool,
                            {
                                "query": tc.prompt_en,
                            },
                        )
                    except Exception as e:
                        tool_result = f"Tool error: {e}"

                latency_ms = (time.time() - start) * 1000

                # Combine LLM output with tool result
                combined_text = text
                if tool_result:
                    combined_text = f"{text}\n\n[Tool Result]\n{tool_result}"

                response = ToolResponse(
                    raw={"llm_output": text, "tool_result": tool_result},
                    text=combined_text,
                    latency_ms=latency_ms,
                    status_code=200,
                )

                score = compute_composite_score(response, tc)

                results.append(
                    BatchResult(
                        model_id=model.config.model_id,
                        test_case_id=tc.id,
                        rq=tc.rq.value,
                        prompt=tc.prompt_en[:100],
                        generated_text=text[:500],
                        latency_ms=latency_ms,
                        tokens_in=tokens_in,
                        tokens_out=tokens_out,
                        score=score,
                    )
                )

                icon = "✅" if score.passed else "❌"
                print(
                    f"  {icon} {tc.id}: {score.composite_score * 100:.1f}% ({latency_ms:.0f}ms)"
                )

            except Exception as e:
                results.append(
                    BatchResult(
                        model_id=model.config.model_id,
                        test_case_id=tc.id,
                        rq=tc.rq.value,
                        prompt=tc.prompt_en[:100],
                        generated_text="",
                        latency_ms=0,
                        tokens_in=0,
                        tokens_out=0,
                        error=str(e),
                    )
                )
                print(f"  ❌ {tc.id}: Error — {e}")

    return results


# ─────────────────────────────────────────────────────────────────────────────
# Multi-Model Comparison
# ─────────────────────────────────────────────────────────────────────────────


def compare_models(
    model_ids: list[str],
    test_cases: list[TestCase],
    config_overrides: dict[str, Any] | None = None,
    mcp_url: str | None = None,
) -> dict[str, list[BatchResult]]:
    """Run evaluation across multiple models for comparison."""
    all_results: dict[str, list[BatchResult]] = {}
    mcp_client = SimpleMcpClient(mcp_url) if mcp_url else None

    for model_id in model_ids:
        print(f"\n{'=' * 60}")
        print(f"  MODEL: {model_id}")
        print(f"{'=' * 60}\n")

        config = CudaConfig(model_id=model_id, **(config_overrides or {}))
        llm = LocalLlm(config)
        llm.load()

        results = run_batch_evaluation(llm, test_cases, mcp_client, config.batch_size)
        all_results[model_id] = results

        # Free GPU memory
        del llm.model
        if CUDA_AVAILABLE:
            torch.cuda.empty_cache()

    return all_results


def print_comparison(all_results: dict[str, list[BatchResult]]):
    """Print comparative analysis across models."""
    print("\n" + "═" * 70)
    print("  MULTI-MODEL COMPARISON REPORT")
    print("═" * 70)

    for model_id, results in all_results.items():
        scored = [r for r in results if r.score is not None]
        if not scored:
            print(f"\n  {model_id}: No valid results")
            continue

        avg_score = sum(r.score.composite_score for r in scored) / len(scored)
        passed = sum(1 for r in scored if r.score.passed)
        avg_latency = sum(r.latency_ms for r in results) / len(results)
        total_tokens_in = sum(r.tokens_in for r in results)
        total_tokens_out = sum(r.tokens_out for r in results)

        print(f"\n  Model: {model_id}")
        print(f"  {'─' * 50}")
        print(f"  Cases:    {len(results)} ({passed} passed)")
        print(f"  Avg score: {avg_score * 100:.1f}%")
        print(f"  Avg latency: {avg_latency:.0f}ms")
        print(f"  Tokens:   {total_tokens_in} in / {total_tokens_out} out")

        # Per-RQ breakdown
        for rq in ["RQ1", "RQ2", "RQ3"]:
            rq_results = [r for r in scored if r.rq == rq]
            if rq_results:
                rq_avg = sum(r.score.composite_score for r in rq_results) / len(
                    rq_results
                )
                rq_passed = sum(1 for r in rq_results if r.score.passed)
                print(
                    f"    {rq}: {rq_avg * 100:.1f}% ({rq_passed}/{len(rq_results)} passed)"
                )

    print("\n" + "═" * 70)


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="CUDA-Accelerated Batch Evaluation for Polish Academic MCP",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Single model ID (e.g., meta-llama/Llama-3.1-8B-Instruct)",
    )
    parser.add_argument(
        "--models",
        nargs="+",
        default=None,
        help="Multiple model IDs for comparison",
    )
    parser.add_argument(
        "--rq",
        default="ALL",
        choices=["ALL", "RQ1", "RQ2", "RQ3"],
        help="Filter by research question (default: ALL)",
    )
    parser.add_argument(
        "--mcp-url",
        default=None,
        help="MCP server URL for real tool execution (optional)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=4,
        help="Batch size for evaluation (default: 4)",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=2048,
        help="Max new tokens per generation (default: 2048)",
    )
    parser.add_argument(
        "--quantize-4bit",
        action="store_true",
        help="Use 4-bit quantization (reduces VRAM usage)",
    )
    parser.add_argument(
        "--out",
        default="./eval-results",
        help="Output directory for results (default: ./eval-results)",
    )

    args = parser.parse_args()

    if not CUDA_AVAILABLE:
        print("⚠ PyTorch with CUDA not available.")
        print(
            "  Install: pip install torch --index-url https://download.pytorch.org/whl/cu121"
        )
        print("  Falling back to CPU mode (slow).\n")

    # Select test cases
    if args.rq == "ALL":
        test_cases = ALL_TEST_CASES
    else:
        test_cases = get_cases_by_rq(args.rq)

    print(f"🧪 Test cases: {len(test_cases)} (filter: {args.rq})")

    config_overrides = {
        "batch_size": args.batch_size,
        "max_new_tokens": args.max_tokens,
        "quantize_4bit": args.quantize_4bit,
    }

    model_ids = args.models or ([args.model] if args.model else [])
    if not model_ids:
        print("❌ No model specified. Use --model or --models")
        sys.exit(1)

    if len(model_ids) == 1:
        # Single model evaluation
        config = CudaConfig(model_id=model_ids[0], **config_overrides)
        llm = LocalLlm(config)
        llm.load()

        mcp_client = SimpleMcpClient(args.mcp_url) if args.mcp_url else None
        results = run_batch_evaluation(llm, test_cases, mcp_client, args.batch_size)

        # Save results
        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = (
            out_dir
            / f"eval-cuda-{model_ids[0].replace('/', '_')}-{int(time.time()) * 1000}.json"
        )

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "run_at": datetime.utcnow().isoformat() + "Z",
                    "model_id": model_ids[0],
                    "device": config.device,
                    "total_cases": len(results),
                    "results": [asdict(r) for r in results],
                },
                f,
                ensure_ascii=False,
                indent=2,
                default=str,
            )
        print(f"\n💾 Results saved to: {out_path}")
    else:
        # Multi-model comparison
        all_results = compare_models(
            model_ids, test_cases, config_overrides, args.mcp_url
        )
        print_comparison(all_results)

        # Save comparison
        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"eval-comparison-{int(time.time()) * 1000}.json"

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "run_at": datetime.utcnow().isoformat() + "Z",
                    "models": model_ids,
                    "comparison": {
                        model_id: [asdict(r) for r in results]
                        for model_id, results in all_results.items()
                    },
                },
                f,
                ensure_ascii=False,
                indent=2,
                default=str,
            )
        print(f"\n💾 Comparison saved to: {out_path}")


if __name__ == "__main__":
    main()
