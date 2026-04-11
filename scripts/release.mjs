import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function parseArgs() {
  const argv = process.argv.slice(2);
  const has = (flag) => argv.includes(flag);
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    if (index < 0) return undefined;
    const candidate = argv[index + 1];
    return candidate && !candidate.startsWith("--") ? candidate : undefined;
  };

  const bumpArg = valueAfter("--bump");
  const bump = bumpArg === "patch" || bumpArg === "minor" || bumpArg === "major" ? bumpArg : null;

  return {
    dryRun: has("--dry-run"),
    bump,
    publishNpm: !has("--skip-npm-publish"),
    pushGit: !has("--skip-git-push"),
    commitGit: !has("--skip-git-commit"),
    createBundle: !has("--skip-bundle"),
    runSmoke: !has("--skip-smoke"),
    runFullSmoke: has("--full-smoke"),
  };
}

function commandForTool(base) {
  if (process.platform === "win32" && (base === "npm" || base === "npx")) {
    return `${base}.cmd`;
  }
  return base;
}

function runCommandLine(commandLine, description) {
  console.log(`\n> ${description}`);
  const result = spawnSync(
    process.platform === "win32" ? "cmd" : "sh",
    process.platform === "win32" ? ["/d", "/s", "/c", commandLine] : ["-lc", commandLine],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.status !== 0) {
    throw new Error(`${description} failed with exit code ${result.status ?? 1}`);
  }
}

function run(command, args, description) {
  console.log(`\n> ${description}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${description} failed with exit code ${result.status ?? 1}`);
  }
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function updateManifestVersion(version) {
  const manifestPath = resolve(process.cwd(), "manifest.json");
  const manifest = readJsonFile(manifestPath);
  manifest.version = version;
  writeJsonFile(manifestPath, manifest);
}

function getPackageVersion() {
  const pkg = readJsonFile(resolve(process.cwd(), "package.json"));
  return pkg.version;
}

function setPackageVersion(bump) {
  runCommandLine(`npm version ${bump} --no-git-tag-version --force`, `Bump package version (${bump})`);
  return getPackageVersion();
}

function ensureBundleDirectory() {
  run(process.execPath, ["-e", "require('fs').mkdirSync('release',{recursive:true})"], "Create release directory");
}

function maybeRunSmoke(fullSmoke) {
  if (fullSmoke) {
    runCommandLine("npm run smoke:tools", "Run full smoke suite");
    return;
  }
  runCommandLine("npm run smoke:tools:quick", "Run quick smoke suite");
}

function gitStatus() {
  const result = spawnSync("git", ["status", "--short"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error("git status failed");
  }
  return result.stdout.trim();
}

async function main() {
  const options = parseArgs();

  if (options.bump) {
    const nextVersion = setPackageVersion(options.bump);
    updateManifestVersion(nextVersion);
    console.log(`Version set to ${nextVersion}`);
  }

  if (!options.dryRun) {
    runCommandLine("npm run build", "Build TypeScript output");
    runCommandLine("npx -y @anthropic-ai/mcpb validate manifest.json", "Validate MCPB manifest");
    if (options.runSmoke) {
      maybeRunSmoke(options.runFullSmoke);
    }
    if (options.createBundle) {
      ensureBundleDirectory();
      runCommandLine("npm run bundle:mcpb", "Build MCPB bundle");
    }
  }

  const version = getPackageVersion();
  const commitMessage = `chore(release): v${version}`;

  console.log(`\nGit status before release:`);
  console.log(gitStatus() || "clean");

  if (options.commitGit && !options.dryRun) {
    run("git", ["add", "-A"], "Stage release changes");
    run("git", ["commit", "-m", commitMessage], "Create release commit");
  }

  if (options.pushGit && !options.dryRun) {
    run("git", ["push", "origin", "HEAD"], "Push release commit to origin");
  }

  if (options.publishNpm && !options.dryRun) {
    runCommandLine("npm publish", "Publish npm package");
  }

  if (options.dryRun) {
    console.log("Dry run complete. No files were changed.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});