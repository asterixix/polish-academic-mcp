import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { registerKrakowStrategiaTools } from "../src/tools/krakow.js";

type Handler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

function captureTool(name: string): { schema: Record<string, z.ZodTypeAny>; handler: Handler } {
  let schema: Record<string, z.ZodTypeAny> = {};
  let handler: Handler = async () => ({ content: [] });
  const fakeServer = {
    tool: (n: string, _d: string, s: Record<string, z.ZodTypeAny>, h: Handler) => {
      if (n === name) {
        schema = s;
        handler = h;
      }
    },
  };
  registerKrakowStrategiaTools(fakeServer as never, { CACHE_KV: undefined } as never);
  return { schema, handler };
}

test("krakow_strategia_get_article domyślnie nie czyta PDF (read_pdf=false)", () => {
  const { schema } = captureTool("krakow_strategia_get_article");
  const parsed = z.object(schema).safeParse({ id: "269787" });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.read_pdf, false);
});
