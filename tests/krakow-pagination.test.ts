import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryCacheStore } from "../src/cache.js";
import { fetchAllRows } from "../src/tools/krakow.js";

const base = "https://api.um.krakow.pl/opendata-mieszkancy-pobyt-staly/v1/tabela";

function pageBody(rows: number[], nextAfter: string | null): string {
  return JSON.stringify({
    value: rows.map((lp) => ({ Lp: lp })),
    ...(nextAfter ? { nextLink: `https://srv-app-querona:8091/api/tabela?$after=${nextAfter}` } : {}),
  });
}

test("fetchAllRows podąża za $after i kończy, gdy brak nextLink", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = String(input);
    requested.push(u);
    const body = u.includes("$after=tok2")
      ? pageBody([3, 4], null)
      : pageBody([1, 2], "tok2");
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const env = { CACHE_KV: createMemoryCacheStore() } as never;
    const result = await fetchAllRows(base, env);
    assert.equal(result.complete, true);
    assert.deepEqual(result.rows, [{ Lp: 1 }, { Lp: 2 }, { Lp: 3 }, { Lp: 4 }]);
    assert.equal(requested.length, 2);
    assert.equal(requested[1], `${base}?$after=tok2`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
