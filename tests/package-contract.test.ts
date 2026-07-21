import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const entry = resolve(root, packageJson.bin[packageJson.name]);
const targetVersion = "1.1.0";

function runCli(flag: string) {
  const result = spawnSync(process.execPath, [entry, flag], {
    cwd: root,
    encoding: "utf8",
    input: "",
    timeout: 5_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

test("--help wyświetla pomoc CLI zamiast uruchamiać serwer MCP", () => {
  const { stdout, stderr } = runCli("--help");
  assert.match(stdout, /polish-academic-mcp/i);
  assert.match(stdout, /--help/);
  assert.match(stdout, /--version/);
  assert.equal(stderr, "");
});

test("--version zwraca wersję docelową", () => {
  const { stdout, stderr } = runCli("--version");
  assert.equal(stdout.trim(), targetVersion);
  assert.equal(stderr, "");
});

test("metadane pakietu i lockfile wskazują tę samą wersję 1.1.0", () => {
  assert.equal(packageJson.version, targetVersion);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
});

test("pakiet deklaruje minimalny Node 18+", () => {
  const engines = packageJson.engines ?? {};
  assert.match(String(engines.node ?? ""), />=18/);
});

test("pakiet nie zawiera MCPB, badań, ewaluacji ani telemetrii", () => {
  const scripts = packageJson.scripts ?? {};
  const forbiddenScripts = Object.entries(scripts)
    .filter(
      ([name, command]) =>
        /mcpb|(?:^|:)eval(?::|$)/i.test(name) ||
        /mcpb|scripts\/eval|scripts\/evaluate/i.test(String(command)),
    )
    .map(([name]) => name);
  const forbiddenFiles = [
    "manifest.json",
    ".mcpbignore",
    "RESEARCH.md",
    "eval.config.ts",
    "test_cases.json",
    "scripts/evaluate.ts",
    "scripts/eval",
    "src/tracing.ts",
  ].filter((path) => existsSync(resolve(root, path)));
  const deps = packageJson.dependencies ?? {};
  const devDeps = packageJson.devDependencies ?? {};
  const lockRoot = packageLock.packages?.[""] ?? {};
  const forbiddenDependencies = [
    "@anthropic-ai/sdk",
    "@openrouter/ai-sdk-provider",
    "@opentelemetry/api",
    "cross-env",
    "dotenv",
  ].filter(
    (name) =>
      deps[name] !== undefined ||
      devDeps[name] !== undefined ||
      lockRoot.dependencies?.[name] !== undefined ||
      lockRoot.devDependencies?.[name] !== undefined,
  );
  const releaseScript = readFileSync(resolve(root, "scripts/release.mjs"), "utf8");
  const forbiddenReleaseReferences =
    releaseScript.match(/manifest\.json|mcpb|createBundle|skip-bundle/gi) ?? [];
  const toolPaths = Array.from(
    readFileSync(resolve(root, "src/server.ts"), "utf8").matchAll(/from "(\.\/tools\/[^"]+\.js)"/g),
    ([, path]) => resolve(root, "src", path.replace(/\.js$/, ".ts")),
  );
  const sourceFiles = [resolve(root, "src/tool-error-handling.ts"), ...toolPaths];
  const forbiddenSourceReferences = sourceFiles.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return (
      source.match(
        /tracing\.js|@opentelemetry|withToolExecutionSpan|recordErrorToSpan|span\.setAttribute/g,
      ) ?? []
    );
  });

  assert.deepEqual(
    {
      forbiddenScripts,
      forbiddenFiles,
      forbiddenDependencies,
      forbiddenReleaseReferences,
      forbiddenSourceReferences,
    },
    {
      forbiddenScripts: [],
      forbiddenFiles: [],
      forbiddenDependencies: [],
      forbiddenReleaseReferences: [],
      forbiddenSourceReferences: [],
    },
  );
});
