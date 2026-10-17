import assert from "node:assert/strict";
import { test } from "node:test";
import { toolsBySource } from "../src/cli.js";
import { SOURCES } from "../src/sources.js";
import { SCENARIOS, toolsUsedByScenarios } from "../scripts/scenario-catalogue.js";

test("każda baza i każde narzędzie ma scenariusz wyszukania lub pobrania", () => {
  const used = toolsUsedByScenarios();
  const registered = [...toolsBySource().values()].flat();
  const missingTools = registered.filter((name) => !used.has(name)).sort();
  const extraTools = [...used].filter((name) => !registered.includes(name)).sort();
  const coveredSources = new Set(SCENARIOS.map((scenario) => scenario.source));
  const missingSources = SOURCES.map((source) => source.id).filter((id) => !coveredSources.has(id));

  assert.deepEqual(missingTools, [], `brak scenariusza dla: ${missingTools.join(", ")}`);
  assert.deepEqual(extraTools, [], `scenariusz woła nieznane narzędzie: ${extraTools.join(", ")}`);
  assert.deepEqual(missingSources, [], `brak scenariusza dla bazy: ${missingSources.join(", ")}`);
  assert.ok(SCENARIOS.every((scenario) => scenario.question.length > 20 && scenario.steps.length > 0));
});
