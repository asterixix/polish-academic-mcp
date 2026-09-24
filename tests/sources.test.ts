import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { toolsBySource } from "../src/cli.js";
import { SOURCE_GROUPS, SOURCES, parseSourceSelection } from "../src/sources.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allIds = SOURCES.map((s) => s.id);

test("brak wyboru baz włącza wszystkie źródła", () => {
  assert.deepEqual(parseSourceSelection(undefined), { ids: allIds, unknown: [] });
  assert.deepEqual(parseSourceSelection("  "), { ids: allIds, unknown: [] });
});

test("grupy, pojedyncze bazy i wykluczenia", () => {
  assert.deepEqual(parseSourceSelection("prawo").ids, ["isap", "saos", "bs_sejm"]);
  assert.deepEqual(parseSourceSelection("isap, bn").ids, ["bn", "isap"]);
  assert.deepEqual(parseSourceSelection("normy;kultura -blz").ids, [
    "pkn",
    "wiedza",
    "wolnelektury",
    "ninateka",
    "gapla",
    "fototeka",
    "filmpolski",
    "fototekaslaska",
    "fn_repo",
    "nac",
    "pauart",
    "dokumenty_slaska",
  ]);
  assert.deepEqual(
    parseSourceSelection("-pbn").ids,
    allIds.filter((id) => id !== "pbn"),
  );
  assert.deepEqual(
    parseSourceSelection("all,!saos").ids,
    allIds.filter((id) => id !== "saos"),
  );
  assert.deepEqual(parseSourceSelection("FN-Repo").ids, ["fn_repo"]);
});

test("nieznane nazwy są zgłaszane, a nie przerywają działania", () => {
  assert.deepEqual(parseSourceSelection("prawo,foo"), {
    ids: ["isap", "saos", "bs_sejm"],
    unknown: ["foo"],
  });
  assert.deepEqual(parseSourceSelection("foo").ids, allIds);
});

test("katalog źródeł pokrywa wszystkie 85 narzędzi, a prefiksy nazw zgadzają się z id", () => {
  assert.equal(new Set(allIds).size, allIds.length, "zdublowane id źródła");
  for (const group of Object.keys(SOURCE_GROUPS)) {
    assert.ok(
      SOURCES.some((s) => s.group === group),
      `pusta grupa ${group}`,
    );
  }
  const bySource = toolsBySource();
  let total = 0;
  for (const id of allIds) {
    const tools = bySource.get(id) ?? [];
    assert.ok(tools.length > 0, `źródło ${id} nie rejestruje narzędzi`);
    for (const name of tools)
      assert.ok(name.startsWith(`${id}_`), `${name} nie ma prefiksu ${id}_`);
    total += tools.length;
  }
  assert.equal(total, 85);
});

test("--list-sources wypisuje grupy z liczbą narzędzi", () => {
  const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "--list-sources"], {
    encoding: "utf8",
    input: "",
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /prawo — .*\(11 narzędzi\)/);
  assert.match(result.stdout, /normy — .*\(3 narzędzia\)/);
  assert.match(result.stdout, /Razem: 85 narzędzi\./);
});

test("serwer z --sources udostępnia tylko wybrane narzędzia, oznaczone jako tylko do odczytu", async () => {
  const client = new Client({ name: "sources-test", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts", "--sources=prawo"],
    cwd: root,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "bs_sejm_get_item",
      "bs_sejm_search",
      "isap_get_act",
      "isap_search_acts",
      "saos_dump_common_courts",
      "saos_dump_enrichments",
      "saos_dump_judgments",
      "saos_dump_sc_chambers",
      "saos_dump_services",
      "saos_get_judgment",
      "saos_search_judgments",
    ]);
    for (const tool of tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} bez readOnlyHint`);
      assert.equal(tool.annotations?.openWorldHint, true, `${tool.name} bez openWorldHint`);
    }
    const instructions = client.getInstructions() ?? "";
    assert.match(instructions, /Włączone grupy: prawo/);
    assert.doesNotMatch(instructions, /pbn_/);
  } finally {
    await client.close();
  }
});
