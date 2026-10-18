import assert from "node:assert/strict";
import test from "node:test";
import {
  cfRequestOverageUsd,
  parallelCostUsd,
  parallelUsageFromToolCalls,
  parseCostRange,
} from "../cloud/src/costs.ts";

const NOW = new Date("2026-10-18T12:00:00Z");

test("parseCostRange: domyślnie 30 dni do dziś", () => {
  assert.deepEqual(parseCostRange(null, null, NOW), { from: "2026-09-19", to: "2026-10-18" });
});

test("parseCostRange: odrzuca zły format i odwrócony zakres", () => {
  assert.ok("error" in parseCostRange("2026-13-01", null, NOW));
  assert.ok("error" in parseCostRange("2026-10-10", "2026-10-01", NOW));
});

test("parseCostRange: przycina do 180 dni i do dziś", () => {
  const r = parseCostRange("2000-01-01", "2099-01-01", NOW);
  assert.ok(!("error" in r));
  assert.equal(r.to, "2026-10-18");
  assert.equal(r.from, "2026-04-22");
});

test("parallelCostUsd: $0.001 za wyszukiwanie i za URL", () => {
  assert.equal(parallelCostUsd(3, 2), 0.005);
});

test("parallelUsageFromToolCalls: pomija błędy i liczy URL-e", () => {
  const usage = parallelUsageFromToolCalls([
    { name: "web_search", arguments: {} },
    { name: "web_search", arguments: {}, is_error: true },
    { name: "web_fetch", arguments: { urls: ["https://a", "https://b"] } },
    { name: "mcp_tool", arguments: {} },
  ]);
  assert.deepEqual(usage, { search_calls: 1, extract_urls: 2 });
});

test("cfRequestOverageUsd: tylko nadwyżka ponad 10M", () => {
  assert.equal(cfRequestOverageUsd(9_000_000), 0);
  assert.equal(cfRequestOverageUsd(20_000_000), 3);
});
