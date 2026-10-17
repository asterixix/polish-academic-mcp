/**
 * Build-time changelog snapshot (no runtime GitHub polling).
 * Regenerated on each `npm run build` / deploy from local git + optional GitHub API.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, "..");
const repoRoot = resolve(webRoot, "../..");
const outDir = resolve(webRoot, "src/generated");
const outFile = resolve(outDir, "changelog.json");

const REPO = "asterixix/polish-academic-mcp";
const GITHUB_URL = `https://github.com/${REPO}`;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function gitLog(limit = 40) {
  try {
    const raw = execSync(
      `git -C "${repoRoot}" log -${limit} --pretty=format:%H%x09%cI%x09%s`,
      { encoding: "utf8" },
    );
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha, date, ...rest] = line.split("\t");
        return {
          sha: sha.slice(0, 7),
          sha_full: sha,
          date,
          message: rest.join("\t"),
          url: `${GITHUB_URL}/commit/${sha}`,
        };
      });
  } catch {
    return [];
  }
}

async function fetchGithubMeta() {
  try {
    const [repoRes, commitsRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${REPO}`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "polish-academic-mcp-build" },
      }),
      fetch(`https://api.github.com/repos/${REPO}/commits?per_page=40`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "polish-academic-mcp-build" },
      }),
    ]);
    if (!repoRes.ok || !commitsRes.ok) return null;
    const repo = await repoRes.json();
    const commits = await commitsRes.json();
    return {
      pushed_at: repo.pushed_at,
      updated_at: repo.updated_at,
      description: repo.description,
      default_branch: repo.default_branch,
      commits: (Array.isArray(commits) ? commits : []).map((c) => ({
        sha: String(c.sha).slice(0, 7),
        sha_full: c.sha,
        date: c.commit?.author?.date || c.commit?.committer?.date,
        message: String(c.commit?.message || "").split("\n")[0],
        url: c.html_url,
      })),
    };
  } catch {
    return null;
  }
}

const pkg = readJson(resolve(repoRoot, "package.json"));
const cloudPkg = readJson(resolve(repoRoot, "cloud/package.json"));
const localCommits = gitLog(40);
const remote = await fetchGithubMeta();

const commits = (remote?.commits?.length ? remote.commits : localCommits).slice(0, 40);
const latest = commits[0] || null;

const snapshot = {
  schema: "polish_academic_mcp_changelog_v1",
  generated_at: new Date().toISOString(),
  repository: GITHUB_URL,
  package_version: pkg.version,
  cloud_version: cloudPkg.version,
  latest_commit: latest,
  github: remote
    ? {
        pushed_at: remote.pushed_at,
        updated_at: remote.updated_at,
        description: remote.description,
        default_branch: remote.default_branch,
      }
    : null,
  source: remote?.commits?.length ? "github_api+local_build" : "local_git",
  commits,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(
  `[changelog] wrote ${outFile} (${commits.length} commits, latest ${latest?.sha ?? "n/a"}, source=${snapshot.source})`,
);
