import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { registerPolonTools } from "../src/tools/polon.js";

type Handler = (params: Record<string, unknown>) => Promise<unknown>;

function captureSchema(): { schema: Record<string, z.ZodTypeAny>; handler: Handler } {
  let schema: Record<string, z.ZodTypeAny> = {};
  let handler: Handler = async () => ({});
  const fakeServer = {
    tool: (_name: string, _desc: string, s: Record<string, z.ZodTypeAny>, h: Handler) => {
      schema = s;
      handler = h;
    },
  };
  registerPolonTools(fakeServer as never, { CACHE_KV: undefined } as never);
  return { schema, handler };
}

test("polon_search domyślnie używa publications, więc zapytanie bez resource przechodzi walidację", () => {
  const { schema } = captureSchema();
  const parsed = z.object(schema).safeParse({ query: "Babik" });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.resource, "publications");
});
