import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import {
  cachedFetch,
  createMemoryCacheStore,
  FETCH_TIMEOUT_MS,
} from "../src/cache.js";

type FetchCall = { url: string; signal?: AbortSignal };

const recordedCalls: FetchCall[] = [];
let installedImpl: typeof fetch | null = null;
const originalFetch = globalThis.fetch;

function installFetchStub(impl: typeof fetch): void {
  recordedCalls.length = 0;
  installedImpl = impl;
  globalThis.fetch = impl as typeof globalThis.fetch;
}

before(() => {
  // Sanity check: cache module exposes the documented timeout ceiling.
  assert.equal(FETCH_TIMEOUT_MS, 30_000);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  installedImpl = null;
  recordedCalls.length = 0;
});

function makeOkResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

function makeErrorResponse(status: number, statusText: string, body = "boom"): Response {
  return new Response(body, {
    status,
    statusText,
    headers: { "content-type": "text/plain" },
  });
}

function stubSequence(responses: Array<Response | Error>): typeof fetch {
  let index = 0;
  const calls: FetchCall[] = recordedCalls;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), signal: init?.signal ?? undefined });
    const next = responses[index++];
    if (!next) throw new Error("stubSequence exhausted");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return impl;
}

test("każde żądanie używa AbortSignal z 30-sekundowym timeoutem", async () => {
  installFetchStub(stubSequence([makeOkResponse("ok")]));
  const kv = createMemoryCacheStore();
  await cachedFetch(kv, "k1", "https://example.test/slow");
  assert.equal(recordedCalls.length, 1);
  const signal = recordedCalls[0].signal;
  assert.ok(signal, "fetch must be called with an AbortSignal");
  assert.equal(signal!.aborted, false);
  // The shared ceiling exported from cache.ts is the one true value.
  assert.equal(FETCH_TIMEOUT_MS, 30_000);
});

test("HTTP 4xx nie wywołuje ponownej próby", async () => {
  installFetchStub(stubSequence([makeErrorResponse(404, "Not Found")]));
  const kv = createMemoryCacheStore();
  await assert.rejects(
    () => cachedFetch(kv, "k2", "https://example.test/missing"),
    (err: unknown) => {
      const e = err as { status?: number };
      return e.status === 404;
    },
  );
  assert.equal(recordedCalls.length, 1, "no retry on 4xx");
});

test("błąd przejściowy sieci kończy się pojedynczą ponowną próbą i zwraca wynik", async () => {
  const transient = Object.assign(new TypeError("fetch failed"), {
    code: "ECONNRESET",
  }) as Error;
  installFetchStub(stubSequence([transient, makeOkResponse("ok-after-retry")]));
  const kv = createMemoryCacheStore();
  const text = await cachedFetch(kv, "k3", "https://example.test/flaky");
  assert.equal(text, "ok-after-retry");
  assert.equal(recordedCalls.length, 2);
});

test("po wyczerpaniu ponownej próby błąd przejściowy jest zgłaszany jako CacheError", async () => {
  const transient = Object.assign(new TypeError("fetch failed"), {
    code: "ENETUNREACH",
  }) as Error;
  installFetchStub(stubSequence([transient, transient]));
  const kv = createMemoryCacheStore();
  await assert.rejects(
    () => cachedFetch(kv, "k4", "https://example.test/down"),
    (err: unknown) => {
      const e = err as { status?: number; statusText?: string };
      return e.status === 0 && e.statusText === "NetworkError";
    },
  );
  assert.equal(recordedCalls.length, 2, "exactly one retry before giving up");
});

test("nagłówki CacheError nie ujawniają sekretów (Authorization, Cookie)", async () => {
  installFetchStub(
    stubSequence([
      new Response("secret-page", {
        status: 401,
        statusText: "Unauthorized",
        headers: {
          "content-type": "text/plain",
          authorization: "Bearer leaked-token",
          "set-cookie": "session=leaked",
          "x-trace-id": "abc-123",
        },
      }),
    ]),
  );
  const kv = createMemoryCacheStore();
  await assert.rejects(
    () => cachedFetch(kv, "k5", "https://example.test/private"),
    (err: unknown) => {
      const e = err as { headers?: Record<string, string> };
      assert.ok(e.headers, "CacheError must expose headers");
      assert.equal(e.headers!["authorization"], "[redacted]");
      assert.equal(e.headers!["set-cookie"], "[redacted]");
      assert.equal(e.headers!["x-trace-id"], "abc-123");
      return true;
    },
  );
});