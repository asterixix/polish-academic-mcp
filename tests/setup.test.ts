import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CLIENTS,
  SERVER_KEY,
  editCodexToml,
  editJsonConfig,
  launchSpec,
  type HostContext,
} from "../src/clients.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");

function host(platform: NodeJS.Platform, overrides: Partial<HostContext> = {}): HostContext {
  const home =
    platform === "win32" ? "C:\\Users\\ala" : platform === "darwin" ? "/Users/ala" : "/home/ala";
  return {
    platform,
    home,
    env: platform === "win32" ? { APPDATA: "C:\\Users\\ala\\AppData\\Roaming" } : {},
    nodeBinDir: platform === "win32" ? "C:\\Program Files\\nodejs" : "/usr/local/bin",
    exists: () => false,
    listDir: () => [],
    ...overrides,
  };
}

function configPath(id: string, ctx: HostContext): string | null {
  const client = CLIENTS.find((c) => c.id === id);
  assert.ok(client, id);
  return client.configPath(ctx);
}

test("polecenie uruchomienia: Windows przez cmd /c, nvm z pełną ścieżką i PATH", () => {
  assert.deepEqual(launchSpec(host("win32")), {
    command: "cmd",
    args: ["/c", "npx", "-y", "polish-academic-mcp"],
  });
  assert.deepEqual(launchSpec(host("darwin")), {
    command: "npx",
    args: ["-y", "polish-academic-mcp"],
  });

  const nvmBin = "/Users/ala/.nvm/versions/node/v22.11.0/bin";
  const nvm = host("darwin", { nodeBinDir: nvmBin, exists: (p) => p === `${nvmBin}/npx` });
  assert.deepEqual(launchSpec(nvm, "nauka"), {
    command: `${nvmBin}/npx`,
    args: ["-y", "polish-academic-mcp"],
    env: {
      PATH: `${nvmBin}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      POLISH_ACADEMIC_SOURCES: "nauka",
    },
  });
});

test("ścieżki konfiguracji na macOS, Windows (także Microsoft Store) i Linuksie", () => {
  assert.equal(
    configPath("claude-desktop", host("darwin")),
    "/Users/ala/Library/Application Support/Claude/claude_desktop_config.json",
  );
  assert.equal(
    configPath("claude-desktop", host("win32")),
    "C:\\Users\\ala\\AppData\\Roaming\\Claude\\claude_desktop_config.json",
  );
  const store =
    "C:\\Users\\ala\\AppData\\Local\\Packages\\Claude_pzs8sxrjxfjjc\\LocalCache\\Roaming\\Claude";
  const msix = host("win32", {
    listDir: (p) => (p.endsWith("Packages") ? ["Microsoft.Foo_1", "Claude_pzs8sxrjxfjjc"] : []),
    exists: (p) => p === store,
  });
  assert.equal(configPath("claude-desktop", msix), `${store}\\claude_desktop_config.json`);
  assert.equal(
    configPath("claude-desktop", host("linux")),
    "/home/ala/.config/Claude/claude_desktop_config.json",
  );
  assert.equal(configPath("vscode", host("linux")), "/home/ala/.config/Code/User/mcp.json");
  assert.equal(configPath("cursor", host("win32")), "C:\\Users\\ala\\.cursor\\mcp.json");
  assert.equal(
    configPath("codex", host("linux", { env: { CODEX_HOME: "/data/codex" } })),
    "/data/codex/config.toml",
  );
  // An empty variable counts as unset.
  assert.equal(
    configPath("opencode", host("linux", { env: { XDG_CONFIG_HOME: "" } })),
    "/home/ala/.config/opencode/opencode.json",
  );
});

const spec = { command: "npx", args: ["-y", "polish-academic-mcp"] };

test("edycja JSON zachowuje inne serwery, wcięcia, CRLF i jest idempotentna", () => {
  const original =
    '\uFEFF{\r\n    "mcpServers": {\r\n        "other": { "command": "uvx" }\r\n    },\r\n    "theme": "dark"\r\n}\r\n';
  const first = editJsonConfig(original, "mcpServers", spec);
  assert.equal(first.status, "changed");
  if (first.status === "error") return;
  assert.ok(first.text.includes('\r\n    "mcpServers"'), "wcięcie lub CRLF zgubione");
  assert.deepEqual(JSON.parse(first.text), {
    mcpServers: { other: { command: "uvx" }, [SERVER_KEY]: spec },
    theme: "dark",
  });
  assert.equal(editJsonConfig(first.text, "mcpServers", spec).status, "unchanged");

  const removed = editJsonConfig(first.text, "mcpServers", null);
  assert.equal(removed.status, "changed");
  if (removed.status === "error") return;
  assert.deepEqual(JSON.parse(removed.text).mcpServers, { other: { command: "uvx" } });
  assert.equal(editJsonConfig(removed.text, "mcpServers", null).status, "unchanged");
});

test("edycja JSON tworzy plik, usuwa duplikaty pakietu i nie rusza JSONC", () => {
  const created = editJsonConfig(null, "servers", spec);
  assert.equal(created.status, "changed");
  if (created.status !== "error")
    assert.deepEqual(JSON.parse(created.text), { servers: { [SERVER_KEY]: spec } });

  const dup = JSON.stringify({
    mcpServers: {
      "polish-academic-mcp": { command: "npx", args: ["-y", "polish-academic-mcp@1.0.2"] },
      "local-dev": { command: "node", args: ["/src/polish-academic-mcp/dist/index.js"] },
    },
  });
  const deduped = editJsonConfig(dup, "mcpServers", spec);
  assert.equal(deduped.status, "changed");
  if (deduped.status === "error") return;
  assert.deepEqual(Object.keys(JSON.parse(deduped.text).mcpServers), ["local-dev", SERVER_KEY]);
  assert.deepEqual(deduped.notes, ['usunięto zdublowany wpis "polish-academic-mcp"']);

  const jsonc = editJsonConfig('{\n  // komentarz\n  "servers": {},\n}\n', "servers", spec);
  assert.equal(jsonc.status, "error");
  const broken = editJsonConfig('{"servers": ', "servers", spec);
  assert.equal(broken.status, "error");
  assert.equal(editJsonConfig('{"servers": []}', "servers", spec).status, "error");
});

test("edycja config.toml Codeksa: dopisanie, podmiana, usunięcie", () => {
  const original =
    'model = "gpt-5"\n\n[mcp_servers.polish-academic]\ncommand = "old"\n\n[mcp_servers.polish-academic.env]\nX = "1"\n\n[mcp_servers.other]\ncommand = "foo"\n';
  const updated = editCodexToml(original, { ...spec, env: { POLISH_ACADEMIC_SOURCES: "nauka" } });
  assert.equal(updated.status, "changed");
  if (updated.status === "error") return;
  assert.equal(
    updated.text,
    [
      'model = "gpt-5"',
      "",
      "[mcp_servers.other]",
      'command = "foo"',
      "",
      "[mcp_servers.polish-academic]",
      'command = "npx"',
      'args = ["-y", "polish-academic-mcp"]',
      "startup_timeout_sec = 60",
      "tool_timeout_sec = 120",
      "",
      "[mcp_servers.polish-academic.env]",
      'POLISH_ACADEMIC_SOURCES = "nauka"',
      "",
    ].join("\n"),
  );
  assert.equal(
    editCodexToml(updated.text, { ...spec, env: { POLISH_ACADEMIC_SOURCES: "nauka" } }).status,
    "unchanged",
  );

  const removed = editCodexToml(updated.text, null);
  assert.equal(removed.status, "changed");
  if (removed.status !== "error")
    assert.equal(removed.text, 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "foo"\n');
  assert.equal(editCodexToml('model = "x"\n', null).status, "unchanged");
  assert.equal(
    editCodexToml('[mcp_servers]\npolish-academic = { command = "npx" }\n', spec).status,
    "error",
  );
});

function runCli(home: string, args: string[]) {
  return spawnSync(process.execPath, [entry, ...args], {
    encoding: "utf8",
    input: "",
    timeout: 20_000,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, "AppData"),
      XDG_CONFIG_HOME: "",
    },
  });
}

test("setup --client cursor: --dry-run i tryb bez --yes niczego nie zapisują, --yes zapisuje z kopią", () => {
  const home = mkdtempSync(join(tmpdir(), "pam-setup-"));
  try {
    const cursorFile = join(home, ".cursor", "mcp.json");
    mkdirSync(dirname(cursorFile), { recursive: true });
    writeFileSync(cursorFile, JSON.stringify({ mcpServers: { other: { command: "uvx" } } }));

    const dry = runCli(home, ["setup", "--client", "cursor", "--sources", "prawo", "--dry-run"]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /--dry-run/);
    assert.deepEqual(JSON.parse(readFileSync(cursorFile, "utf8")), {
      mcpServers: { other: { command: "uvx" } },
    });

    const noYes = runCli(home, ["setup", "--client", "cursor"]);
    assert.equal(noYes.status, 0, noYes.stderr);
    assert.match(noYes.stdout, /nic nie zapisano/);

    const yes = runCli(home, ["setup", "--client", "cursor", "--sources", "prawo", "--yes"]);
    assert.equal(yes.status, 0, yes.stdout + yes.stderr);
    const written = JSON.parse(readFileSync(cursorFile, "utf8"));
    assert.deepEqual(Object.keys(written.mcpServers), ["other", SERVER_KEY]);
    assert.equal(written.mcpServers[SERVER_KEY].env.POLISH_ACADEMIC_SOURCES, "prawo");
    assert.ok(
      readdirSync(dirname(cursorFile)).some((f) => f.startsWith("mcp.json.bak-")),
      "brak kopii zapasowej",
    );

    const doctor = runCli(home, ["doctor", "--no-network"]);
    assert.match(doctor.stdout, /\[OK\] Cursor: skonfigurowane/);

    const removed = runCli(home, ["uninstall", "--client", "cursor", "--yes"]);
    assert.equal(removed.status, 0, removed.stdout + removed.stderr);
    assert.deepEqual(JSON.parse(readFileSync(cursorFile, "utf8")).mcpServers, {
      other: { command: "uvx" },
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("setup odrzuca nieznane aplikacje i bazy; --print działa dla aplikacji konfigurowanych ręcznie", () => {
  const home = mkdtempSync(join(tmpdir(), "pam-setup-"));
  try {
    assert.equal(runCli(home, ["setup", "--client", "notepad", "--yes"]).status, 1);
    assert.equal(
      runCli(home, ["setup", "--client", "cursor", "--sources", "xyz", "--yes"]).status,
      1,
    );
    assert.equal(existsSync(join(home, ".cursor")), false);

    const zed = runCli(home, ["setup", "--print", "zed"]);
    assert.equal(zed.status, 0);
    assert.match(zed.stdout, /"context_servers"/);
    const webui = runCli(home, ["setup", "--print", "open-webui"]);
    assert.match(webui.stdout, /mcpo/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
