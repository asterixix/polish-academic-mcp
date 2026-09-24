/**
 * Command-line helpers for people setting the server up by hand:
 * `setup` / `uninstall` (edit MCP client configs), `doctor` (diagnostics),
 * `--list-sources` and `--help`. Output goes to stdout; these commands never
 * start the MCP transport.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import {
  CLIENTS,
  MANUAL_CLIENTS,
  PACKAGE_NAME,
  SERVER_KEY,
  buildEntry,
  currentHost,
  editClientConfig,
  findClient,
  findConfiguredEntry,
  isAutoClient,
  launchSpec,
  topLevelKey,
  codexTomlBlock,
  type ClientDef,
  type HostContext,
  type LaunchSpec,
} from "./clients.js";
import { createMemoryCacheStore } from "./cache.js";
import { createServer } from "./server.js";
import {
  SOURCE_GROUPS,
  SOURCES,
  SOURCES_ENV,
  parseSourceSelection,
  type SourceGroup,
  type SourceId,
} from "./sources.js";

const print = (line = ""): void => {
  process.stdout.write(`${line}\n`);
};

export function readOption(argv: readonly string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === name) return argv[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

function hasFlag(argv: readonly string[], ...names: string[]): boolean {
  return argv.some((arg) => names.includes(arg));
}

function tilde(ctx: HostContext, path: string): string {
  return path.startsWith(ctx.home) ? `~${path.slice(ctx.home.length)}` : path;
}

// ─── --help ──────────────────────────────────────────────────────────────────

export function helpText(version: string): string {
  return [
    `${PACKAGE_NAME} ${version} — lokalny serwer MCP dla polskich baz naukowych, publicznych i kulturowych`,
    "",
    "Szybka konfiguracja (dla każdego):",
    `  npx -y ${PACKAGE_NAME} setup           kreator: dodaje serwer do zainstalowanych aplikacji AI`,
    "",
    "Użycie:",
    `  ${PACKAGE_NAME}                        uruchamia serwer MCP (stdio); robi to aplikacja AI, nie Ty`,
    `  ${PACKAGE_NAME} setup                  kreator konfiguracji (Claude, Cursor, VS Code, LM Studio…)`,
    "      --client <id,...>                      tylko wybrane aplikacje (lista: setup --list)",
    "      --sources <grupy>                      tylko wybrane bazy, np. nauka,prawo",
    "      --yes                                  bez pytań (np. dla agentów AI)",
    "      --dry-run                              pokaż zmiany bez zapisywania",
    "      --pin                                  przypnij bieżącą wersję pakietu (bez automatycznych aktualizacji)",
    "      --print <id>                           wypisz konfigurację do ręcznego wklejenia",
    "      --list                                 lista obsługiwanych aplikacji i plików konfiguracyjnych",
    `  ${PACKAGE_NAME} uninstall              usuwa serwer z konfiguracji aplikacji (opcje jak w setup)`,
    `  ${PACKAGE_NAME} doctor                 sprawdza Node.js, internet i konfigurację aplikacji`,
    `  ${PACKAGE_NAME} --list-sources         grupy i bazy danych z liczbą narzędzi`,
    `  ${PACKAGE_NAME} --sources=<lista>      serwer tylko z wybranymi bazami (też: ${SOURCES_ENV})`,
    `  ${PACKAGE_NAME} --help                 wyświetla tę pomoc`,
    `  ${PACKAGE_NAME} --version              wyświetla wersję`,
    "",
    "Grupy baz: nauka, dane, prawo, normy, kultura (lub id pojedynczej bazy, np. bn, isap; -saos wyklucza).",
    "Dokumentacja: https://github.com/asterixix/polish-academic-mcp#readme",
    "",
  ].join("\n");
}

// ─── --list-sources ──────────────────────────────────────────────────────────

/** Tool names per source, counted by registering every source on a throwaway server. */
export function toolsBySource(): Map<SourceId, string[]> {
  const bySource = new Map<SourceId, string[]>();
  createServer(
    { CACHE_KV: createMemoryCacheStore() },
    {
      onToolRegistered: (source, name) => {
        bySource.set(source, [...(bySource.get(source) ?? []), name]);
      },
    },
  );
  return bySource;
}

/** "1 narzędzie", "3 narzędzia", "85 narzędzi". */
export function toolsLabel(n: number): string {
  if (n === 1) return "1 narzędzie";
  const last = n % 10;
  const lastTwo = n % 100;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)
    ? `${n} narzędzia`
    : `${n} narzędzi`;
}

function countTools(ids: readonly SourceId[], bySource: Map<SourceId, string[]>): number {
  return ids.reduce((sum, id) => sum + (bySource.get(id)?.length ?? 0), 0);
}

function groupIds(group: SourceGroup): SourceId[] {
  return SOURCES.filter((s) => s.group === group).map((s) => s.id);
}

export function listSourcesText(): string {
  const bySource = toolsBySource();
  const lines = [
    `Grupy i bazy danych. Wybór: --sources=nauka,prawo albo zmienna ${SOURCES_ENV}.`,
    "Można łączyć grupy i bazy (bn,isap) oraz wykluczać (-saos). Domyślnie włączone jest wszystko.",
  ];
  for (const group of Object.keys(SOURCE_GROUPS) as SourceGroup[]) {
    const ids = groupIds(group);
    lines.push("", `${group} — ${SOURCE_GROUPS[group]} (${toolsLabel(countTools(ids, bySource))})`);
    for (const source of SOURCES.filter((s) => s.group === group)) {
      const count = bySource.get(source.id)?.length ?? 0;
      lines.push(`  ${source.id.padEnd(18)} ${source.name} (${count})`);
    }
  }
  const all = SOURCES.map((s) => s.id);
  lines.push("", `Razem: ${toolsLabel(countTools(all, bySource))}.`, "");
  return lines.join("\n");
}

// ─── setup / uninstall ───────────────────────────────────────────────────────

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Atomic write with a timestamped backup of the previous file; keeps file permissions. */
export function writeConfigFile(path: string, text: string): string | null {
  mkdirSync(dirname(path), { recursive: true });
  let backup: string | null = null;
  let mode: number | undefined;
  if (existsSync(path)) {
    backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(path, backup);
    mode = statSync(path).mode;
  }
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    // Create with the original mode so a private file (e.g. ~/.claude.json, 0600) is never
    // briefly world-readable; chmod afterwards restores bits the umask stripped.
    writeFileSync(tmp, text, { encoding: "utf8", ...(mode !== undefined && { mode }) });
    if (mode !== undefined) chmodSync(tmp, mode);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  try {
    renameSync(tmp, path);
  } catch {
    // Windows refuses to replace a file another process holds open; write in place instead.
    writeFileSync(path, text, "utf8");
    rmSync(tmp, { force: true });
  }
  return backup;
}

function isDetected(ctx: HostContext, client: ClientDef): boolean {
  const path = client.detectPath(ctx);
  return path !== null && ctx.exists(path);
}

function parseChoice(answer: string, count: number): number[] | null {
  const parts = answer.split(/[\s,;]+/).filter(Boolean);
  const picked = parts.map(Number);
  if (picked.some((n) => !Number.isInteger(n) || n < 1 || n > count)) return null;
  return [...new Set(picked)].map((n) => n - 1);
}

async function askClients(rl: Interface, detected: ClientDef[]): Promise<ClientDef[]> {
  print("Wykryte aplikacje:");
  detected.forEach((client, i) => print(`  ${i + 1}) ${client.name}`));
  for (;;) {
    const answer = (
      await rl.question("Które skonfigurować? Numery, np. 1,3 [Enter = wszystkie]: ")
    ).trim();
    if (answer === "") return detected;
    const picked = parseChoice(answer, detected.length);
    if (picked) return picked.map((i) => detected[i]);
    print("Nie rozumiem odpowiedzi — podaj numery z listy.");
  }
}

async function askSources(
  rl: Interface,
  bySource: Map<SourceId, string[]>,
): Promise<string | undefined> {
  const groups = Object.keys(SOURCE_GROUPS) as SourceGroup[];
  const total = countTools(
    SOURCES.map((s) => s.id),
    bySource,
  );
  print("");
  print("Które bazy włączyć? Mniej narzędzi = szybsze i trafniejsze odpowiedzi,");
  print("szczególnie w Cursorze (limit ~40) i przy małych modelach lokalnych (LM Studio, Ollama).");
  print(`  0) wszystkie (${toolsLabel(total)})`);
  groups.forEach((group, i) =>
    print(
      `  ${i + 1}) ${group.padEnd(8)} ${SOURCE_GROUPS[group]} (${countTools(groupIds(group), bySource)})`,
    ),
  );
  for (;;) {
    const answer = (await rl.question("Numery grup, np. 1,3 [Enter = wszystkie]: ")).trim();
    if (answer === "" || answer === "0") return undefined;
    const picked = parseChoice(answer, groups.length);
    if (picked) return picked.map((i) => groups[i]).join(",");
    print("Nie rozumiem odpowiedzi — podaj numery grup (1–5) lub 0.");
  }
}

function isYes(answer: string): boolean {
  return ["", "t", "tak", "y", "yes"].includes(answer.trim().toLowerCase());
}

function printManual(client: (typeof MANUAL_CLIENTS)[number], spec: LaunchSpec): void {
  print(`${client.name}:`);
  print(client.instructions(spec).replace(/^/gm, "  "));
}

/** Print a paste-ready snippet for one client (auto or manual). */
function printSnippet(ctx: HostContext, id: string, spec: LaunchSpec): number {
  const client = findClient(id);
  if (!client) {
    print(`Nieznana aplikacja: ${id}. Lista: ${PACKAGE_NAME} setup --list`);
    return 1;
  }
  if (!isAutoClient(client)) {
    printManual(client, spec);
    return 0;
  }
  const path = client.configPath(ctx);
  print(`${client.name} — plik: ${path ? tilde(ctx, path) : "(niedostępne w tym systemie)"}`);
  print(entrySnippet(client, spec));
  return 0;
}

/** The server's entry as it appears in a client's config file. */
function entrySnippet(client: ClientDef, spec: LaunchSpec): string {
  return client.format === "codex"
    ? codexTomlBlock(spec)
    : JSON.stringify(
        { [topLevelKey(client.format)]: { [SERVER_KEY]: buildEntry(client.format, spec) } },
        null,
        2,
      );
}

function printClientList(ctx: HostContext): void {
  print("Aplikacje konfigurowane automatycznie (setup --client <id>):");
  for (const client of CLIENTS) {
    const path = client.configPath(ctx);
    const state = isDetected(ctx, client) ? "wykryto" : "nie wykryto";
    print(
      `  ${client.id.padEnd(15)} ${client.name.padEnd(26)} ${state.padEnd(12)} ${path ? tilde(ctx, path) : "-"}`,
    );
  }
  print("");
  print("Aplikacje z instrukcją do wykonania ręcznie (setup --print <id>):");
  for (const client of MANUAL_CLIENTS) print(`  ${client.id.padEnd(15)} ${client.name}`);
}

interface Planned {
  client: ClientDef;
  path: string;
  status: "changed" | "unchanged" | "error";
  text?: string;
  notes: string[];
  reason?: string;
}

function plan(ctx: HostContext, clients: ClientDef[], spec: LaunchSpec | null): Planned[] {
  return clients.flatMap((client): Planned[] => {
    const path = client.configPath(ctx);
    if (!path) return [];
    const result = editClientConfig(client, readText(path), spec);
    if (result.status === "error")
      return [{ client, path, status: "error", notes: [], reason: result.reason }];
    return [{ client, path, status: result.status, text: result.text, notes: result.notes }];
  });
}

export async function runSetup(
  argv: readonly string[],
  remove = false,
  version?: string,
): Promise<number> {
  const ctx = currentHost();
  const verb = remove ? "uninstall" : "setup";

  if (hasFlag(argv, "--list")) {
    printClientList(ctx);
    return 0;
  }

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 18) {
    print(
      `Node.js ${process.versions.node} jest za stary. Zainstaluj wersję LTS z https://nodejs.org i spróbuj ponownie.`,
    );
    return 1;
  }

  let sources = readOption(argv, "--sources");
  if (sources !== undefined) {
    const { ids, unknown } = parseSourceSelection(sources);
    if (unknown.length > 0 || ids.length === 0) {
      print(
        `Nieznane grupy/bazy: ${unknown.join(", ") || sources}. Lista: ${PACKAGE_NAME} --list-sources`,
      );
      return 1;
    }
  }

  // --pin writes polish-academic-mcp@<this version>; to update, run a newer version's setup --pin.
  const pin = hasFlag(argv, "--pin") ? version : undefined;
  const printId = readOption(argv, "--print");
  if (printId !== undefined) return printSnippet(ctx, printId, launchSpec(ctx, sources, pin));

  const dryRun = hasFlag(argv, "--dry-run");
  const assumeYes = hasFlag(argv, "--yes", "-y");
  const interactive = !assumeYes && !dryRun && Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  rl?.on("SIGINT", () => {
    print("\nAnulowano, nic nie zapisano.");
    process.exit(130);
  });

  try {
    // Which clients?
    const requested = readOption(argv, "--client");
    let targets: ClientDef[];
    if (requested !== undefined) {
      targets = [];
      for (const id of requested.split(/[\s,;]+/).filter(Boolean)) {
        const client = findClient(id);
        if (!client) {
          print(`Nieznana aplikacja: ${id}. Lista: ${PACKAGE_NAME} setup --list`);
          return 1;
        }
        if (isAutoClient(client)) targets.push(client);
        else if (!remove) printManual(client, launchSpec(ctx, sources, pin));
        else print(`${client.name}: usuń wpis ${SERVER_KEY} ręcznie w ustawieniach aplikacji.`);
      }
      if (targets.length === 0) return 0;
    } else {
      const detected = CLIENTS.filter((client) => isDetected(ctx, client));
      const candidates = remove
        ? detected.filter((client) => {
            const text = readText(client.configPath(ctx) ?? "");
            return text !== null && findConfiguredEntry(client, text) !== undefined;
          })
        : detected;
      if (candidates.length === 0) {
        print(
          remove
            ? "Żadna wykryta aplikacja nie ma skonfigurowanego serwera."
            : "Nie wykryto obsługiwanych aplikacji. Zainstaluj i uruchom raz aplikację AI albo skonfiguruj ją ręcznie:",
        );
        if (!remove) {
          print(`  ${PACKAGE_NAME} setup --list        lista aplikacji`);
          print(`  ${PACKAGE_NAME} setup --print <id>  konfiguracja do wklejenia`);
        }
        return remove ? 0 : 1;
      }
      targets = rl ? await askClients(rl, candidates) : candidates;
    }

    // Which sources?
    const bySource = toolsBySource();
    if (!remove && sources === undefined && rl) sources = await askSources(rl, bySource);
    const spec = remove ? null : launchSpec(ctx, sources, pin);
    const toolCount = countTools(parseSourceSelection(sources).ids, bySource);

    const planned = plan(ctx, targets, spec);
    print("");
    print(dryRun ? "Plan zmian (--dry-run, nic nie zapisuję):" : "Plan zmian:");
    for (const item of planned) {
      const where = tilde(ctx, item.path);
      if (item.status === "error") {
        print(`  [!] ${item.client.name}: pomijam — ${item.reason} (${where})`);
        print(
          remove
            ? `      usuń ręcznie wpis "${SERVER_KEY}" z tego pliku`
            : `      wpis do wklejenia: npx -y ${PACKAGE_NAME} setup --print ${item.client.id}`,
        );
      } else if (item.status === "unchanged")
        print(`  [=] ${item.client.name}: bez zmian (${where})`);
      else print(`  [+] ${item.client.name}: ${remove ? "usunę wpis" : "zapiszę wpis"} → ${where}`);
      for (const note of item.notes) print(`      ${note}`);
    }
    const toWrite = planned.filter((item) => item.status === "changed");
    if (toWrite.length === 0) {
      print("");
      print(remove ? "Nic do usunięcia." : "Wszystko już skonfigurowane.");
      return planned.some((item) => item.status === "error") ? 1 : 0;
    }
    if (spec?.env?.PATH) {
      print("");
      print(
        "Node.js jest zainstalowany poza standardową ścieżką (np. nvm, fnm, volta), więc zapisuję pełną",
      );
      print("ścieżkę do npx. Po zmianie wersji Node.js uruchom setup ponownie.");
    }
    for (const item of remove ? [] : toWrite) {
      const limit = item.client.toolLimit;
      if (limit && toolCount > limit) {
        print("");
        print(
          `Uwaga: ${item.client.name} obsługuje maks. ${limit} narzędzi łącznie ze wszystkich serwerów, ` +
            `a wybrano ${toolsLabel(toolCount)}. Rozważ mniejszy wybór, np. --sources=nauka.`,
        );
      }
    }
    if (dryRun) {
      print("");
      for (const item of toWrite) {
        print(`--- ${tilde(ctx, item.path)} ---`);
        print(spec ? entrySnippet(item.client, spec) : `(usunięcie wpisu ${SERVER_KEY})`);
      }
      return 0;
    }
    if (!rl && !assumeYes) {
      print("");
      print(`Tryb nieinteraktywny: nic nie zapisano. Aby zapisać, dodaj --yes, np.:`);
      print(
        `  npx -y ${PACKAGE_NAME} ${verb} --client ${toWrite.map((i) => i.client.id).join(",")} --yes`,
      );
      return 0;
    }
    if (rl) {
      print("");
      print(
        "Przed zapisem zamknij całkowicie wybrane aplikacje (część z nich nadpisuje plik przy zamykaniu).",
      );
      if (!isYes(await rl.question("Zapisać zmiany? [T/n]: "))) {
        print("Anulowano, nic nie zapisano.");
        return 0;
      }
    }

    print("");
    let failed = false;
    for (const item of toWrite) {
      try {
        const backup = writeConfigFile(item.path, item.text ?? "");
        print(`[OK] ${item.client.name}: zapisano ${tilde(ctx, item.path)}`);
        if (backup) print(`     kopia poprzedniej wersji: ${tilde(ctx, backup)}`);
        if (!remove) print(`     dalej: ${item.client.restart}`);
      } catch (err) {
        failed = true;
        print(
          `[X] ${item.client.name}: nie udało się zapisać (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }
    if (!remove && !failed) {
      print("");
      print("Gotowe! Po ponownym uruchomieniu aplikacji zapytaj np.:");
      print(
        "  „Wyszukaj w Bibliotece Nauki artykuły o odnawialnych źródłach energii z 2024 roku.”",
      );
      print(`Problem? Uruchom: npx -y ${PACKAGE_NAME} doctor`);
    }
    return failed ? 1 : 0;
  } catch (err) {
    // Ctrl+D at a prompt rejects the pending question with an AbortError.
    if (err instanceof Error && err.name === "AbortError") {
      print("\nAnulowano, nic nie zapisano.");
      return 130;
    }
    throw err;
  } finally {
    rl?.close();
  }
}

// ─── doctor ──────────────────────────────────────────────────────────────────

const PROBE_URLS = [
  "https://bibliotekanauki.pl/",
  "https://api.sejm.gov.pl/eli/acts",
  "https://danepubliczne.imgw.pl/api/data/synop",
];

async function probe(url: string): Promise<string | null> {
  const started = Date.now();
  try {
    // Any HTTP answer (even 4xx) proves the host is reachable.
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    return `${new URL(url).host} (${res.status}, ${Date.now() - started} ms)`;
  } catch {
    return null;
  }
}

function entryCommandPath(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const command = (entry as { command?: unknown }).command;
  const first = Array.isArray(command) ? command[0] : command;
  return typeof first === "string" ? first : undefined;
}

export async function runDoctor(argv: readonly string[]): Promise<number> {
  const ctx = currentHost();
  let problems = 0;
  const ok = (msg: string) => print(`[OK] ${msg}`);
  const warn = (msg: string) => print(`[!]  ${msg}`);
  const fail = (msg: string) => {
    problems += 1;
    print(`[X]  ${msg}`);
  };

  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 18 || (major === 18 && minor < 17)) {
    fail(
      `Node.js ${process.versions.node} — wymagany 18.17 lub nowszy. Zainstaluj LTS z https://nodejs.org`,
    );
  } else if (major < 20) {
    warn(
      `Node.js ${process.versions.node} działa, ale nie ma już poprawek bezpieczeństwa. Zalecany LTS z https://nodejs.org`,
    );
  } else {
    ok(`Node.js ${process.versions.node} (${process.execPath})`);
  }

  const npx = ctx.platform === "win32" ? `${ctx.nodeBinDir}\\npx.cmd` : `${ctx.nodeBinDir}/npx`;
  if (ctx.exists(npx)) ok(`npx: ${npx}`);
  else warn(`nie znaleziono npx obok Node.js (${npx}) — aplikacje uruchamiają serwer przez npx`);

  if (hasFlag(argv, "--no-network")) {
    print("[--] Test połączenia pominięty (--no-network).");
  } else {
    const results = await Promise.all(PROBE_URLS.map(probe));
    const reachable = results.filter((r): r is string => r !== null);
    if (reachable.length === PROBE_URLS.length) ok(`Internet: ${reachable.join(", ")}`);
    else if (reachable.length > 0)
      warn(`Część baz nie odpowiada; działające: ${reachable.join(", ")}`);
    else {
      fail(
        "Brak połączenia z bazami (bibliotekanauki.pl, api.sejm.gov.pl, imgw.pl). Sprawdź internet/zaporę.",
      );
      if (ctx.env.HTTPS_PROXY || ctx.env.https_proxy) {
        print(
          "     Wykryto HTTPS_PROXY: wbudowany fetch Node.js domyślnie ignoruje proxy. W aktualnych",
        );
        print(
          "     wersjach Node.js 22/24 dodaj NODE_USE_ENV_PROXY=1 (oraz HTTPS_PROXY) do sekcji env serwera.",
        );
      }
    }
  }

  const selection = ctx.env[SOURCES_ENV];
  if (selection) {
    const { ids, unknown } = parseSourceSelection(selection);
    if (unknown.length > 0) warn(`${SOURCES_ENV}: nieznane wartości ${unknown.join(", ")}`);
    ok(`${SOURCES_ENV}=${selection} → ${ids.length} baz`);
  }
  if (ctx.env.PBN_APP_ID && ctx.env.PBN_APP_TOKEN) ok("PBN: ustawiono PBN_APP_ID i PBN_APP_TOKEN");
  else print("[--] PBN: brak kluczy (opcjonalne; bez nich 3 narzędzia pbn_* zwracają instrukcję)");

  print("");
  print("Aplikacje:");
  let configured = 0;
  for (const client of CLIENTS) {
    if (!isDetected(ctx, client)) continue;
    const path = client.configPath(ctx);
    if (!path) continue;
    const text = readText(path);
    const entry = text === null ? undefined : findConfiguredEntry(client, text);
    if (entry === undefined) {
      print(
        `  [--] ${client.name}: nieskonfigurowane → npx -y ${PACKAGE_NAME} setup --client ${client.id}`,
      );
      continue;
    }
    configured += 1;
    const command = entryCommandPath(entry);
    if (command && /[\\/]/.test(command) && !ctx.exists(command)) {
      problems += 1;
      print(
        `  [X]  ${client.name}: polecenie ${command} nie istnieje (zmiana wersji Node.js?) → uruchom setup ponownie`,
      );
    } else {
      print(`  [OK] ${client.name}: skonfigurowane (${tilde(ctx, path)})`);
    }
  }
  if (configured === 0) {
    print(`  Brak skonfigurowanych aplikacji. Uruchom: npx -y ${PACKAGE_NAME} setup`);
  }
  print("");
  print(problems === 0 ? "Nie wykryto problemów." : `Wykryte problemy: ${problems}.`);
  return problems === 0 ? 0 : 1;
}
