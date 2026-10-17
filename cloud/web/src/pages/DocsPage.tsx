import docsData from "@/generated/mcp-docs.json";
import { Button } from "@/components/ui/Button";
import { Link, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState, type ReactNode } from "react";

type Param = {
  name: string;
  type: string;
  required: boolean;
  default?: unknown;
  enum?: unknown[];
  description: string;
};

type Tool = {
  name: string;
  title: string;
  description: string;
  parameters: Param[];
  sourceId?: string;
  sourceName?: string;
  group?: string;
};

type Source = {
  id: string;
  group: string;
  name: string;
  requiresAuth: boolean;
  portalUrl: string;
  apiUrl: string;
  protocol: string;
  notes: string;
  primarySearch: string | null;
  primaryGet: string | null;
  operations: string[];
};

type ClientConfig = {
  id: string;
  name: string;
  auto: boolean;
  format: string;
  paths: { macos: string; windows: string; linux: string } | null;
  restartHint: string;
  snippetUnix: string;
  snippetWindows: string;
};

type DocsData = {
  version: string;
  stats: {
    sourcesCount: number;
    groupsCount: number;
    routerToolsCount: number;
    granularToolsCount: number;
    clientsCount: number;
    autoClientsCount: number;
    manualClientsCount: number;
  };
  groups: { id: string; label: string }[];
  routerTools: Tool[];
  resourceTemplates: { uriTemplate?: string; name?: string; description?: string }[];
  sources: Source[];
  granularTools: Tool[];
  clients: ClientConfig[];
};

const data = docsData as DocsData;
const origin = typeof window !== "undefined" ? window.location.origin : "https://pamcp.pl";

const GROUP_TITLES: Record<string, string> = {
  nauka: "Nauka i repozytoria",
  dane: "Dane publiczne i statystyka",
  prawo: "Prawo i orzecznictwo",
  normy: "Normy i standardy",
  kultura: "Kultura, film i archiwa",
};

const TOC = [
  ["start", "Start"],
  ["architektura", "Architektura"],
  ["zdalny", "Konektor zdalny"],
  ["lokalny", "Instalacja lokalna"],
  ["narzedzia", "Narzędzia routera"],
  ["katalog", "Katalog baz"],
  ["operacje", "Operacje natywne"],
  ["klienci", "Aplikacje AI"],
  ["srodowisko", "Zmienne środowiskowe"],
  ["endpointy", "Endpointy i OAuth"],
  ["diagnostyka", "Diagnostyka"],
  ["rozwoj", "Dla programistów"],
] as const;

const EXAMPLE_PROMPTS = [
  "Wyszukaj w polskich bazach naukowych publikacje o zastosowaniu sztucznej inteligencji w diagnostyce medycznej po 2023 roku i pobierz pełny tekst najlepszego trafienia.",
  "Znajdź w ISAP obowiązujące ustawy o odnawialnych źródłach energii, a następnie powiązane orzeczenia w SAOS.",
  "Pobierz z Banku Danych Lokalnych GUS dane o bezrobociu rejestrowanym w województwach za ostatnie 5 lat.",
  "Przeszukaj Szukaj w Archiwach, AGAD i Straty.pl pod kątem Warszawy z lat 1939–1945.",
  "Znajdź w Wolnych Lekturach utwory Bolesława Prusa i wskaż linki do pełnych tekstów EPUB i PDF.",
  "Przeszukaj Jagiellońską Bibliotekę Cyfrową pod kątem XIX-wiecznych czasopism krakowskich; jeśli skan nie ma warstwy tekstowej, użyj OCR/HTR.",
];

function CopyButton({ text, label = "Kopiuj" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onPress={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? "Skopiowano ✓" : label}
    </Button>
  );
}

function CodeBlock({ code, title }: { code: string; title?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-primary bg-[#1a0f24] text-white">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
        <span className="truncate font-mono text-xs text-white/70">{title ?? "kod"}</span>
        <button
          type="button"
          className="shrink-0 rounded-full bg-bg-secondary/10 px-3 py-1 text-xs font-semibold hover:bg-bg-secondary/20"
          onClick={() => navigator.clipboard.writeText(code).catch(() => undefined)}
        >
          Kopiuj
        </button>
      </div>
      <pre className="max-h-[520px] overflow-auto p-4 text-[13px] leading-relaxed"><code>{code}</code></pre>
    </div>
  );
}

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">{eyebrow}</p>
      <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-brand-700 md:text-3xl">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft ${className}`}>{children}</div>;
}

function ParamTable({ params }: { params: Param[] }) {
  if (params.length === 0) return <p className="text-sm text-fg-secondary">Brak parametrów wejściowych.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border-primary text-xs uppercase tracking-wide text-fg-tertiary">
            <th className="px-3 py-2">Parametr</th>
            <th className="px-3 py-2">Typ</th>
            <th className="px-3 py-2">Wymagany</th>
            <th className="px-3 py-2">Domyślnie / wartości</th>
            <th className="px-3 py-2">Opis</th>
          </tr>
        </thead>
        <tbody>
          {params.map((p) => (
            <tr key={p.name} className="border-b border-border-primary/60 align-top">
              <td className="px-3 py-2 font-mono text-[13px] font-semibold text-brand-800">{p.name}</td>
              <td className="px-3 py-2 font-mono text-[13px]">{p.type}</td>
              <td className="px-3 py-2">{p.required ? "tak" : "nie"}</td>
              <td className="px-3 py-2 font-mono text-xs">
                {p.default !== undefined ? String(p.default) : ""}
                {p.enum ? <span className="block break-all">{p.enum.map(String).join(" | ")}</span> : null}
              </td>
              <td className="max-w-xl px-3 py-2 leading-relaxed text-fg-secondary">{p.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ToolDetails({ tool, defaultOpen = false }: { tool: Tool; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-border-primary/80 bg-bg-secondary">
      <summary className="cursor-pointer list-none px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span>
            <code className="font-mono text-sm font-bold text-brand-800">{tool.name}</code>
            <span className="ml-2 text-sm font-medium text-fg-primary">{tool.title}</span>
          </span>
          <span className="text-xs font-semibold text-brand-600 group-open:hidden">Rozwiń parametry ↓</span>
          <span className="hidden text-xs font-semibold text-brand-600 group-open:inline">Zwiń ↑</span>
        </span>
      </summary>
      <div className="space-y-3 border-t border-border-primary/70 px-4 py-4">
        <p className="whitespace-pre-line text-sm leading-relaxed text-fg-secondary">{tool.description}</p>
        <p className="text-xs text-fg-tertiary">
          Adnotacje MCP: <code>readOnlyHint: true</code>, <code>destructiveHint: false</code>,{" "}
          <code>idempotentHint: true</code>, <code>openWorldHint: true</code>
          {tool.sourceName ? <> · Źródło: <strong>{tool.sourceName}</strong> (<code>{tool.sourceId}</code>)</> : null}
        </p>
        <ParamTable params={tool.parameters} />
      </div>
    </details>
  );
}

export function DocsPage() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [location.hash]);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceGroup, setSourceGroup] = useState("all");
  const [toolQuery, setToolQuery] = useState("");
  const [toolGroup, setToolGroup] = useState("all");
  const [toolSource, setToolSource] = useState("all");
  const [clientQuery, setClientQuery] = useState("");
  const [os, setOs] = useState<"unix" | "windows">("unix");

  const filteredSources = useMemo(() => {
    const q = sourceQuery.trim().toLowerCase();
    return data.sources.filter((s) => {
      if (sourceGroup !== "all" && s.group !== sourceGroup) return false;
      if (!q) return true;
      return [s.id, s.name, s.protocol, s.notes, ...s.operations].join(" ").toLowerCase().includes(q);
    });
  }, [sourceQuery, sourceGroup]);

  const toolSources = useMemo(
    () => data.sources.filter((s) => toolGroup === "all" || s.group === toolGroup),
    [toolGroup],
  );

  const filteredTools = useMemo(() => {
    const q = toolQuery.trim().toLowerCase();
    return data.granularTools.filter((t) => {
      if (toolGroup !== "all" && t.group !== toolGroup) return false;
      if (toolSource !== "all" && t.sourceId !== toolSource) return false;
      if (!q) return true;
      return [t.name, t.title, t.description, t.sourceId, t.sourceName].join(" ").toLowerCase().includes(q);
    });
  }, [toolQuery, toolGroup, toolSource]);

  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return data.clients;
    return data.clients.filter((c) => [c.id, c.name, c.format].join(" ").toLowerCase().includes(q));
  }, [clientQuery]);

  const inputClass =
    "min-h-11 w-full rounded-xl border border-border-primary bg-bg-secondary px-3.5 py-2 text-sm text-fg-primary shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

  return (
    <div className="space-y-12">
      {/* HERO */}
      <header id="start" className="scroll-mt-28">
        <p className="text-sm font-semibold text-brand-600">Polish Academic MCP · wersja {data.version} · dokumentacja serwera</p>
        <h1 className="mt-2 max-w-4xl font-display text-4xl font-semibold tracking-tight text-brand-700 md:text-5xl">
          Cała dokumentacja serwera MCP w jednym miejscu
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-fg-secondary md:text-lg">
          Zdalny konektor <strong className="text-fg-primary">{origin}/mcp</strong> oraz lokalny serwer{" "}
          <code className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[0.9em]">npx -y polish-academic-mcp</code>{" "}
          udostępniają {data.stats.sourcesCount} polskich baz w {data.stats.groupsCount} kategoriach tematycznych.
          W chmurze działają 3 narzędzia Meta-Routera, lokalnie możesz też włączyć wszystkie{" "}
          {data.stats.granularToolsCount} operacje natywne. Wszystkie operacje są wyłącznie do odczytu.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <CopyButton text={`${origin}/mcp`} label="Kopiuj URL MCP" />
          <CopyButton text="npx -y polish-academic-mcp setup" label="Kopiuj komendę instalacji" />
          <Link to="/connectors"><Button variant="secondary">Przejdź do konektorów →</Button></Link>
          <a href="https://github.com/asterixix/polish-academic-mcp" target="_blank" rel="noreferrer"><Button variant="ghost">GitHub ↗</Button></a>
        </div>
        <dl className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            [String(data.stats.sourcesCount), "baz danych"],
            [String(data.stats.granularToolsCount), "operacji natywnych"],
            [String(data.stats.routerToolsCount), "narzędzia Meta-Routera"],
            [String(data.stats.clientsCount), "aplikacji AI (13 auto + 9 ręcznych)"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-2xl border border-border-primary bg-bg-secondary p-4 shadow-soft">
              <dt className="order-2 mt-1 block text-xs text-fg-secondary">{label}</dt>
              <dd className="font-display text-3xl font-semibold text-brand-700">{value}</dd>
            </div>
          ))}
        </dl>
        <nav aria-label="Spis treści dokumentacji" className="sticky top-2 z-20 mt-6 flex gap-1.5 overflow-x-auto rounded-full border border-border-primary bg-bg-secondary/90 p-1.5 shadow-soft backdrop-blur">
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium text-fg-secondary hover:bg-brand-50 hover:text-brand-800">
              {label}
            </a>
          ))}
        </nav>
      </header>

      {/* ARCHITEKTURA */}
      <Section id="architektura" eyebrow="1 · Podstawy" title="Architektura: chmura czy lokalnie?">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <h3 className="font-semibold text-brand-700">Zdalny konektor chmurowy — {origin}/mcp</h3>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-secondary">
              <li>Transport Streamable HTTP + SSE, autoryzacja OAuth 2.1 (Dynamic Client Registration, PKCE S256).</li>
              <li>Domyślnie tryb <strong>Meta-Router</strong>: tylko 3 narzędzia — idealny dla Claude.ai, ChatGPT i Perplexity oraz małych okien kontekstu.</li>
              <li>Limit konta: 100 wywołań narzędzi / miesiąc; logowanie przez ORCID, e-mail lub passkey.</li>
              <li>Tryb pełny: <code>{origin}/mcp?mode=granular</code> — wszystkie {data.stats.granularToolsCount} operacje natywne (uwaga na limity narzędzi klienta).</li>
              <li>Bez instalacji i bez Node.js — wystarczy URL i logowanie.</li>
            </ul>
          </Card>
          <Card>
            <h3 className="font-semibold text-brand-700">Lokalny serwer CLI — stdio</h3>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-secondary">
              <li>Uruchamiany przez <code>npx -y polish-academic-mcp</code> (Node.js ≥ 18.17), komunikacja stdio.</li>
              <li>Domyślnie tryb <strong>granularny</strong>: {data.stats.granularToolsCount} narzędzi natywnych; przełącznik <code>--mode=router</code> daje 3 narzędzia routera.</li>
              <li>Brak konta i limitów chmurowych; zapytania idą z Twojego komputera bezpośrednio do baz źródłowych.</li>
              <li>Kreator <code>setup</code> konfiguruje {data.stats.autoClientsCount} aplikacji automatycznie i wypisuje instrukcje dla {data.stats.manualClientsCount} kolejnych.</li>
              <li>Wybór baz: <code>--sources=nauka,prawo</code> lub <code>POLISH_ACADEMIC_SOURCES</code>.</li>
            </ul>
          </Card>
        </div>
        <Card>
          <h3 className="font-semibold text-brand-700">Bezpieczeństwo i adnotacje MCP</h3>
          <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
            Każde narzędzie (router i natywne) nosi adnotacje <code>readOnlyHint: true</code>,{" "}
            <code>destructiveHint: false</code>, <code>idempotentHint: true</code>, <code>openWorldHint: true</code>{" "}
            oraz polski tytuł (<code>title</code>). Serwer nigdy nie zapisuje, nie usuwa i nie modyfikuje danych w bazach
            źródłowych. Jedyny wyjątek konfiguracyjny: trzy narzędzia <code>pbn_*</code> wymagają własnych kluczy{" "}
            <code>PBN_APP_ID</code> + <code>PBN_APP_TOKEN</code> (patrz sekcja „Zmienne środowiskowe”).
          </p>
        </Card>
      </Section>

      {/* ZDALNY */}
      <Section id="zdalny" eyebrow="2 · Konektory" title="Konektor zdalny krok po kroku">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <h3 className="font-semibold text-brand-700">Claude.ai / Claude Desktop</h3>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-fg-secondary">
              <li>Settings → Connectors → <em>Add custom connector</em>.</li>
              <li>URL: <code>{origin}/mcp</code></li>
              <li>Dokończ OAuth 2.1: zaloguj się przez ORCID, e-mail lub passkey i zatwierdź zakres <code>mcp</code>.</li>
              <li>W czacie włącz konektor <strong>Polish Academic</strong> i zadaj pytanie testowe z listy poniżej.</li>
            </ol>
          </Card>
          <Card>
            <h3 className="font-semibold text-brand-700">ChatGPT</h3>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-fg-secondary">
              <li>Tryb deweloperski / Connectors → dodaj serwer MCP: <code>{origin}/mcp</code>.</li>
              <li>Deep Research: te same narzędzia są osiągalne przez aliasy <code>/api/search</code> i <code>/api/fetch</code>.</li>
              <li>Custom GPT Actions: zaimportuj <code>{origin}/openapi.json</code> (OpenAPI 3.1).</li>
              <li>Autoryzacja OAuth 2.1 + PKCE — jak w Claude.</li>
            </ol>
          </Card>
          <Card>
            <h3 className="font-semibold text-brand-700">Perplexity i inni klienci HTTP</h3>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-fg-secondary">
              <li>Dodaj <em>Remote MCP Connector</em> z adresem <code>{origin}/mcp</code>.</li>
              <li>Discovery: <code>/.well-known/oauth-authorization-server</code> i <code>/.well-known/oauth-protected-resource</code>.</li>
              <li>Własny klient: wyślij JSON-RPC <code>initialize</code> → <code>tools/list</code> → <code>tools/call</code> z nagłówkiem <code>Authorization: Bearer …</code>.</li>
              <li>Legacy SSE: <code>/sse</code> + <code>/messages</code>.</li>
            </ol>
          </Card>
        </div>
        <Card>
          <h3 className="font-semibold text-brand-700">Przykładowe prompty (kliknij, aby skopiować)</h3>
          <ul className="mt-3 space-y-2">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <li key={prompt} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border-primary/70 bg-brand-50/40 px-4 py-2.5 text-sm">
                <span className="max-w-3xl">„{prompt}”</span>
                <CopyButton text={prompt} label="Kopiuj prompt" />
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      {/* LOKALNY */}
      <Section id="lokalny" eyebrow="3 · Instalacja lokalna" title="CLI, kreator setup i tryby pracy">
        <Card>
          <h3 className="font-semibold text-brand-700">Wymagania i szybki start</h3>
          <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
            Node.js <strong>18.17+</strong> (zalecany LTS). Nie instaluj pakietu globalnie — klienci MCP uruchamiają go przez{" "}
            <code>npx -y polish-academic-mcp</code>, dzięki czemu zawsze startuje aktualna wersja.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <CodeBlock title="Kreator (zalecane)" code={"npx -y polish-academic-mcp setup\nnpx -y polish-academic-mcp doctor"} />
            <CodeBlock title="Ręczne uruchomienie / weryfikacja" code={"npx -y polish-academic-mcp --version\nnpx -y polish-academic-mcp --list-sources\nnpx -y polish-academic-mcp --mode=router --sources=nauka,prawo"} />
          </div>
        </Card>
        <div className="overflow-x-auto rounded-2xl border border-border-primary bg-bg-secondary shadow-soft">
          <table className="min-w-full text-left text-sm">
            <thead><tr className="border-b border-border-primary text-xs uppercase tracking-wide text-fg-tertiary"><th className="px-4 py-3">Polecenie / flaga</th><th className="px-4 py-3">Działanie</th></tr></thead>
            <tbody className="[&_td]:px-4 [&_td]:py-2.5 [&_tr]:border-b [&_tr]:border-border-primary/60 [&_td:first-child]:font-mono [&_td:first-child]:text-[13px]">
              <tr><td>setup</td><td>Interaktywny kreator: wykrywa aplikacje AI i dopisuje wpis <code>polish-academic</code> do ich konfiguracji.</td></tr>
              <tr><td>setup --client cursor</td><td>Konfiguruje tylko wskazaną aplikację (id z sekcji „Aplikacje AI”).</td></tr>
              <tr><td>setup --sources=nauka,prawo</td><td>Ogranicza zestaw narzędzi do grup lub pojedynczych baz (mniejszy kontekst, limity klientów).</td></tr>
              <tr><td>setup --yes</td><td>Tryb nieinteraktywny — dla skryptów i agentów AI konfigurujących środowisko.</td></tr>
              <tr><td>setup --dry-run / --print &lt;klient&gt;</td><td>Podgląd zmian bez zapisu / wypisanie gotowego snippetu do wklejenia ręcznie.</td></tr>
              <tr><td>setup --pin</td><td>Przypina wersję pakietu (<code>polish-academic-mcp@x.y.z</code>) zamiast zawsze najnowszej.</td></tr>
              <tr><td>setup --list</td><td>Lista obsługiwanych aplikacji i status ich konfiguracji.</td></tr>
              <tr><td>uninstall [--client …]</td><td>Usuwa wpis serwera z konfiguracji aplikacji (pozostałe wpisy i Twoje zmienne zostają).</td></tr>
              <tr><td>doctor [--no-network]</td><td>Diagnostyka: Node, npx, zmienne PBN/BDL, skonfigurowane aplikacje, łączność z bazami.</td></tr>
              <tr><td>--list-sources</td><td>Wypisuje wszystkie bazy ({data.stats.sourcesCount}) w {data.stats.groupsCount} grupach wraz z liczbą operacji.</td></tr>
              <tr><td>--sources=… / POLISH_ACADEMIC_SOURCES</td><td>Wybór grup (<code>nauka,dane,prawo,normy,kultura</code>) lub id baz; prefiks <code>-</code> wyklucza, np. <code>all,-saos</code>.</td></tr>
              <tr><td>--mode=router|granular / POLISH_ACADEMIC_MODE</td><td>3 narzędzia Meta-Routera albo {data.stats.granularToolsCount} operacji natywnych.</td></tr>
              <tr><td>--help / --version</td><td>Pomoc i numer wersji.</td></tr>
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <h3 className="font-semibold text-brand-700">Windows</h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
              <code>npx</code> to skrypt <code>.cmd</code> — część aplikacji zgłasza <code>spawn npx ENOENT</code>. Pewny wariant to{" "}
              <code>cmd /c npx -y polish-academic-mcp</code>. Kreator zapisuje go automatycznie; w katalogu klientów poniżej
              przełącz system na <strong>Windows</strong>, aby zobaczyć właściwe snippety.
            </p>
          </Card>
          <Card>
            <h3 className="font-semibold text-brand-700">macOS / Linux z nvm, fnm, volta</h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
              Aplikacje z Docka/menu nie widzą Node z menedżerów wersji. Podaj pełną ścieżkę z <code>which npx</code> i uzupełnij{" "}
              <code>PATH</code> w <code>env</code>. Kreator wykrywa tę sytuację sam. Dla agentów AI:{" "}
              <code>npx -y polish-academic-mcp setup --yes</code>.
            </p>
          </Card>
        </div>
      </Section>

      {/* NARZĘDZIA ROUTERA */}
      <Section id="narzedzia" eyebrow="4 · Meta-Router" title="3 narzędzia routera i zasoby MCP">
        <p className="max-w-3xl text-sm leading-relaxed text-fg-secondary">
          Tryb routera ukrywa {data.stats.granularToolsCount} operacji za trzema narzędziami — model najpierw przegląda katalog,
          potem wyszukuje, a na końcu pobiera pełny rekord. Zapytania są automatycznie normalizowane pod konkretną bazę
          (diakrytyki, format dat, identyfikatory), a odpowiedzi HTML/XML są kompaktowane do czytelnego tekstu.
        </p>
        <div className="space-y-3">
          {data.routerTools.map((tool, i) => <ToolDetails key={tool.name} tool={tool} defaultOpen={i === 1} />)}
        </div>
        <Card>
          <h3 className="font-semibold text-brand-700">Ekstrakcja pełnego tekstu w <code>get_record</code></h3>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-secondary">
            <li><strong>PDF</strong> z warstwą tekstową — ekstrakcja stronicowana (<code>offset</code>, <code>max_chars</code>).</li>
            <li><strong>PDF skanowany / rękopis</strong> — hybrydowy OCR/HTR: rendering stron do PNG i rozpoznawanie druku oraz pisma odręcznego (m.in. JBC, dLibra).</li>
            <li><strong>XLSX, CSV, TSV</strong> — tabele do tekstu z nazwami kolumn; <strong>XML/OAI-PMH</strong> — metadane i pełne rekordy.</li>
            <li><strong>HTML i JSON</strong> — treść główna bez nawigacji i skryptów.</li>
            <li>Parametr <code>grep</code> filtruje długi tekst do fragmentów zawierających frazę — oszczędza kontekst.</li>
            <li>Identyfikatory mają formę <code>źródło:id</code>, np. <code>isap:DU/2023/123</code>, <code>ruj:207985</code>, <code>saos:12345</code>; alternatywnie podaj bezpośredni <code>url</code>.</li>
          </ul>
          {data.resourceTemplates.length > 0 && (
            <p className="mt-3 text-sm text-fg-secondary">
              Szablon zasobu MCP:{" "}
              {data.resourceTemplates.map((r) => <code key={r.uriTemplate ?? r.name} className="mr-2">{r.uriTemplate ?? r.name}</code>)}
              — rekord można też czytać jako zasób, np. <code>polish-academic://record/isap/DU/2023/123</code>.
            </p>
          )}
        </Card>
        <CodeBlock
          title="Przykład wywołania (JSON-RPC tools/call)"
          code={JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "sztuczna inteligencja w medycynie", category: "nauka", limit: 10 } } }, null, 2)}
        />
      </Section>

      {/* KATALOG */}
      <Section id="katalog" eyebrow="5 · Katalog baz" title={`Katalog ${data.stats.sourcesCount} baz danych`}>
        <div className="flex flex-wrap gap-2">
          {data.groups.map((g) => (
            <span key={g.id} className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-800">
              <strong>{g.id}</strong> — {GROUP_TITLES[g.id] ?? g.id}: {g.label}
            </span>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
          <input className={inputClass} value={sourceQuery} onChange={(e) => setSourceQuery(e.target.value)} placeholder="Szukaj bazy, protokołu lub operacji… (np. OAI, dLibra, orzeczenia)" aria-label="Szukaj w katalogu baz" />
          <select className={inputClass} value={sourceGroup} onChange={(e) => setSourceGroup(e.target.value)} aria-label="Filtr kategorii baz">
            <option value="all">Wszystkie kategorie</option>
            {data.groups.map((g) => <option key={g.id} value={g.id}>{g.id} — {GROUP_TITLES[g.id]}</option>)}
          </select>
        </div>
        <p className="text-sm text-fg-secondary">Widocznych baz: <strong>{filteredSources.length}</strong> z {data.stats.sourcesCount}. Kliknij bazę, aby zobaczyć jej operacje natywne.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          {filteredSources.map((s) => (
            <details key={s.id} className="group rounded-2xl border border-border-primary bg-bg-secondary shadow-soft">
              <summary className="cursor-pointer list-none p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
                <span className="flex flex-wrap items-start justify-between gap-2">
                  <span className="font-semibold text-brand-700">{s.name}</span>
                  <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-700">{s.group}</span>
                </span>
                <span className="mt-1 block font-mono text-xs text-fg-tertiary">id: {s.id} · {s.operations.length} operacji{s.requiresAuth ? " · wymaga kluczy API" : ""}</span>
                <span className="mt-2 block text-sm leading-relaxed text-fg-secondary">{s.notes}</span>
                <span className="mt-2 block text-xs font-semibold text-brand-600 group-open:hidden">Pokaż operacje i API ↓</span>
                <span className="mt-2 hidden text-xs font-semibold text-brand-600 group-open:block">Zwiń ↑</span>
              </summary>
              <div className="space-y-2 border-t border-border-primary/70 px-5 py-4 text-sm text-fg-secondary">
                <p><strong className="text-fg-primary">Protokół:</strong> {s.protocol}</p>
                <p><strong className="text-fg-primary">Wyszukiwanie:</strong> <code>{s.primarySearch ?? "—"}</code> · <strong className="text-fg-primary">Pobieranie:</strong> <code>{s.primaryGet ?? "—"}</code></p>
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                  {s.portalUrl && <a className="font-medium text-brand-600 hover:underline" href={s.portalUrl} target="_blank" rel="noreferrer">Portal ↗</a>}
                  {s.apiUrl && <a className="font-medium text-brand-600 hover:underline" href={s.apiUrl} target="_blank" rel="noreferrer">Target API ↗</a>}
                </p>
                <p className="font-mono text-xs leading-relaxed">{s.operations.join(" · ")}</p>
              </div>
            </details>
          ))}
        </div>
        {filteredSources.length === 0 && <p className="text-sm text-fg-secondary">Brak baz dla podanych kryteriów — wyczyść wyszukiwanie lub wybierz inną kategorię.</p>}
      </Section>

      {/* OPERACJE */}
      <Section id="operacje" eyebrow="6 · Tryb granularny" title={`${data.stats.granularToolsCount} operacji natywnych — pełne schematy`}>
        <p className="max-w-3xl text-sm leading-relaxed text-fg-secondary">
          Te same operacje wywołuje router przez parametr <code>operation</code> + <code>filters</code>. Lokalnie (
          <code>--mode=granular</code>) są zarejestrowane jako osobne narzędzia MCP z polskimi tytułami i opisami parametrów.
          Rozwiń operację, aby zobaczyć pełny schemat wejścia.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <input className={inputClass} value={toolQuery} onChange={(e) => setToolQuery(e.target.value)} placeholder="Szukaj operacji… (np. bdl_get_data)" aria-label="Szukaj operacji natywnych" />
          <select className={inputClass} value={toolGroup} onChange={(e) => { setToolGroup(e.target.value); setToolSource("all"); }} aria-label="Kategoria operacji">
            <option value="all">Wszystkie kategorie</option>
            {data.groups.map((g) => <option key={g.id} value={g.id}>{g.id} — {GROUP_TITLES[g.id]}</option>)}
          </select>
          <select className={inputClass} value={toolSource} onChange={(e) => setToolSource(e.target.value)} aria-label="Baza operacji">
            <option value="all">Wszystkie bazy</option>
            {toolSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <p className="text-sm text-fg-secondary">Widocznych operacji: <strong>{filteredTools.length}</strong> z {data.stats.granularToolsCount}.</p>
        <div className="space-y-2">
          {filteredTools.slice(0, 200).map((tool) => <ToolDetails key={tool.name} tool={tool} />)}
        </div>
        {filteredTools.length === 0 && <p className="text-sm text-fg-secondary">Brak operacji dla podanych kryteriów.</p>}
      </Section>

      {/* KLIENCI */}
      <Section id="klienci" eyebrow="7 · Aplikacje AI" title={`${data.stats.clientsCount} aplikacji: konfiguracja automatyczna i ręczna`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full border border-border-primary bg-bg-secondary p-1" role="group" aria-label="System operacyjny snippetów">
            <button type="button" className={`rounded-full px-4 py-2 text-sm font-semibold ${os === "unix" ? "bg-brand-700 text-white" : "text-fg-secondary"}`} onClick={() => setOs("unix")}>macOS / Linux</button>
            <button type="button" className={`rounded-full px-4 py-2 text-sm font-semibold ${os === "windows" ? "bg-brand-700 text-white" : "text-fg-secondary"}`} onClick={() => setOs("windows")}>Windows</button>
          </div>
          <input className={`${inputClass} max-w-xs`} value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Szukaj aplikacji… (np. Cursor)" aria-label="Szukaj aplikacji AI" />
          <span className="text-sm text-fg-secondary">{filteredClients.length} aplikacji · snippety dla: {os === "windows" ? "Windows (cmd /c)" : "macOS / Linux"}</span>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-fg-secondary">
          Aplikacje oznaczone <strong>setup automatyczny</strong> skonfigurujesz jedną komendą{" "}
          <code>npx -y polish-academic-mcp setup --client &lt;id&gt;</code>. Pozostałe mają gotową instrukcję ze snippetem
          do wklejenia (<code>setup --print &lt;id&gt;</code>). Limity narzędzi klientów (Cursor ~40, Windsurf 100, VS Code 128)
          obejdziesz wyborem grup: <code>--sources=nauka</code>.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {filteredClients.map((c) => (
            <Card key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-semibold text-brand-700">{c.name}</h3>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${c.auto ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  {c.auto ? "setup automatyczny" : "konfiguracja ręczna"}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-fg-tertiary">id: {c.id} · format: {c.format}</p>
              {c.auto && <p className="mt-2 break-all font-mono text-xs text-fg-secondary">macOS: {c.paths?.macos}<br />Windows: {c.paths?.windows}<br />Linux: {c.paths?.linux}</p>}
              {c.auto && <p className="mt-2 font-mono text-xs text-brand-800">npx -y polish-academic-mcp setup --client {c.id}</p>}
              {!c.auto && <p className="mt-2 font-mono text-xs text-brand-800">npx -y polish-academic-mcp setup --print {c.id}</p>}
              <div className="mt-3"><CodeBlock title={`${c.name} — ${os === "windows" ? "Windows" : "macOS / Linux"}`} code={os === "windows" ? c.snippetWindows : c.snippetUnix} /></div>
              <p className="mt-3 text-xs leading-relaxed text-fg-tertiary">Po konfiguracji: {c.restartHint}</p>
            </Card>
          ))}
        </div>
        <Card>
          <h3 className="font-semibold text-brand-700">Przyciski instalacji jednym kliknięciem i most HTTP</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-secondary">
            <li><strong>Cursor / VS Code / VS Code Insiders:</strong> przyciski „Add to…” w README repozytorium generują ten sam wpis <code>mcpServers</code>/<code>servers</code>.</li>
            <li><strong>Open WebUI</strong> (tylko HTTP): most <code>uvx mcpo --port 8000 -- npx -y polish-academic-mcp</code>, potem Settings → Tools → <code>http://localhost:8000</code>.</li>
            <li><strong>Dowolna aplikacja z formularzem:</strong> polecenie <code>npx</code>, argumenty <code>-y polish-academic-mcp</code> (Windows: <code>cmd</code> + <code>/c npx -y polish-academic-mcp</code>).</li>
          </ul>
        </Card>
      </Section>

      {/* ŚRODOWISKO */}
      <Section id="srodowisko" eyebrow="8 · Konfiguracja" title="Zmienne środowiskowe i klucze API">
        <div className="overflow-x-auto rounded-2xl border border-border-primary bg-bg-secondary shadow-soft">
          <table className="min-w-full text-left text-sm">
            <thead><tr className="border-b border-border-primary text-xs uppercase tracking-wide text-fg-tertiary"><th className="px-4 py-3">Zmienna</th><th className="px-4 py-3">Wymagana</th><th className="px-4 py-3">Opis</th></tr></thead>
            <tbody className="[&_td]:px-4 [&_td]:py-2.5 [&_tr]:border-b [&_tr]:border-border-primary/60 [&_td:first-child]:font-mono [&_td:first-child]:text-[13px]">
              <tr><td>POLISH_ACADEMIC_SOURCES</td><td>nie</td><td>Wybór grup/baz, gdy brak flagi <code>--sources</code>, np. <code>nauka,prawo</code> albo <code>all,-saos</code>.</td></tr>
              <tr><td>POLISH_ACADEMIC_MODE</td><td>nie</td><td><code>router</code> (3 narzędzia) lub <code>granular</code> ({data.stats.granularToolsCount} operacji); flaga <code>--mode</code> ma pierwszeństwo.</td></tr>
              <tr><td>PBN_APP_ID + PBN_APP_TOKEN</td><td>tylko dla <code>pbn_*</code></td><td>Klucze aplikacji PBN (nagłówki X-App-Id / X-App-Token). Bez nich tylko narzędzia PBN zwracają instrukcję uzyskania dostępu.</td></tr>
              <tr><td>PBN_USER_TOKEN</td><td>nie</td><td>Opcjonalny token użytkownika PBN dla zakresów wymagających kontekstu osoby.</td></tr>
              <tr><td>BDL_CLIENT_ID</td><td>nie</td><td>Opcjonalny identyfikator klienta API GUS BDL (wyższe limity); bez niego działa limit anonimowy.</td></tr>
              <tr><td>POLISH_ACADEMIC_DEBUG</td><td>nie</td><td><code>1</code> — log każdego zapytania HTTP (adres bez sekretów, status, czas) na stderr / do logu klienta MCP.</td></tr>
            </tbody>
          </table>
        </div>
        <CodeBlock title="Przykład env w konfiguracji klienta (JSON)" code={JSON.stringify({ mcpServers: { "polish-academic": { command: "npx", args: ["-y", "polish-academic-mcp"], env: { POLISH_ACADEMIC_SOURCES: "nauka,prawo", PBN_APP_ID: "…", PBN_APP_TOKEN: "…" } } } }, null, 2)} />
        <p className="text-sm text-fg-secondary">Nigdy nie commituj kluczy do repozytorium. Ponowny <code>setup</code> zachowuje ręcznie dopisane zmienne w konfiguracjach klientów.</p>
      </Section>

      {/* ENDPOINTY */}
      <Section id="endpointy" eyebrow="9 · Chmura pamcp.pl" title="Endpointy HTTP, OAuth 2.1 i discovery">
        <div className="overflow-x-auto rounded-2xl border border-border-primary bg-bg-secondary shadow-soft">
          <table className="min-w-full text-left text-sm">
            <thead><tr className="border-b border-border-primary text-xs uppercase tracking-wide text-fg-tertiary"><th className="px-4 py-3">Endpoint</th><th className="px-4 py-3">Przeznaczenie</th></tr></thead>
            <tbody className="[&_td]:px-4 [&_td]:py-2.5 [&_tr]:border-b [&_tr]:border-border-primary/60 [&_td:first-child]:font-mono [&_td:first-child]:text-[13px]">
              <tr><td>POST/GET {origin}/mcp</td><td>Główny transport MCP (Streamable HTTP); <code>?mode=granular</code> włącza pełny zestaw operacji.</td></tr>
              <tr><td>GET /sse · POST /messages</td><td>Starszy transport SSE dla klientów bez Streamable HTTP.</td></tr>
              <tr><td>/oauth/*</td><td>Authorization Server: authorize, token, rejestracja klienta (DCR), revocation; PKCE S256.</td></tr>
              <tr><td>/.well-known/oauth-authorization-server</td><td>Metadane AS (RFC 8414).</td></tr>
              <tr><td>/.well-known/oauth-protected-resource</td><td>Metadane zasobu chronionego (RFC 9728).</td></tr>
              <tr><td>/.well-known/mcp.json · /server.json</td><td>MCP Server Card / rejestr serwerów (nazwa, wersja, narzędzia, transporty).</td></tr>
              <tr><td>/.well-known/ai-plugin.json</td><td>Manifest wtyczki (nazwa, opis, logo, kontakt) dla katalogów AI.</td></tr>
              <tr><td>/openapi.json</td><td>OpenAPI 3.1 dla Custom GPT Actions (operacje search/fetch).</td></tr>
              <tr><td>POST /api/search · POST /api/fetch</td><td>Aliasy Deep Research: wyszukiwanie i pobieranie pełnego tekstu poza protokołem MCP.</td></tr>
              <tr><td>GET /api/tools · /api/directory-metadata</td><td>Lista narzędzi oraz metadane do katalogów konektorów (nazwa, slug, polityki, prompty).</td></tr>
              <tr><td>GET /api/health · /api/quota</td><td>Status usługi oraz wykorzystanie limitu zalogowanego konta (100 wywołań/mies.).</td></tr>
            </tbody>
          </table>
        </div>
        <CodeBlock title="Minimalny klient MCP (curl)" code={`# 1) initialize (po uzyskaniu tokenu OAuth)\ncurl -X POST ${origin}/mcp \\\n  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'\n\n# 2) lista narzędzi\ncurl -X POST ${origin}/mcp -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'`} />
      </Section>

      {/* DIAGNOSTYKA */}
      <Section id="diagnostyka" eyebrow="10 · Pomoc" title="Rozwiązywanie problemów">
        <div className="overflow-x-auto rounded-2xl border border-border-primary bg-bg-secondary shadow-soft">
          <table className="min-w-full text-left text-sm">
            <thead><tr className="border-b border-border-primary text-xs uppercase tracking-wide text-fg-tertiary"><th className="px-4 py-3">Objaw</th><th className="px-4 py-3">Przyczyna i rozwiązanie</th></tr></thead>
            <tbody className="[&_td]:px-4 [&_td]:py-2.5 [&_tr]:border-b [&_tr]:border-border-primary/60 [&_td]:align-top">
              <tr><td><code>spawn npx ENOENT</code> (Windows)</td><td>Użyj <code>cmd /c npx …</code> albo uruchom ponownie <code>setup</code> — zapisze właściwy wariant.</td></tr>
              <tr><td>Serwer nie startuje w aplikacji z Docka (macOS)</td><td>Node z nvm/fnm/volta niewidoczny w GUI: podaj pełną ścieżkę <code>which npx</code> i <code>PATH</code> w <code>env</code>.</td></tr>
              <tr><td>Timeout przy pierwszym uruchomieniu</td><td>Pierwszy <code>npx</code> pobiera pakiet. Zwiększ timeout klienta (Codex: kreator ustawia 60 s / 120 s) i spróbuj ponownie.</td></tr>
              <tr><td>Za dużo narzędzi / model się gubi</td><td>Ogranicz bazy: <code>--sources=nauka</code> lub tryb <code>--mode=router</code> (3 narzędzia zamiast {data.stats.granularToolsCount}).</td></tr>
              <tr><td>Narzędzia <code>pbn_*</code> zwracają błąd kluczy</td><td>Dodaj <code>PBN_APP_ID</code> i <code>PBN_APP_TOKEN</code> do <code>env</code>; pozostałe bazy działają bez kluczy.</td></tr>
              <tr><td>Baza źródłowa zwraca 404 / pustą listę</td><td>Część portali zmienia API (np. Vaadin, dLibra PoW). Sprawdź tę samą frazę w portalu bazy z katalogu powyżej i zgłoś regresję na GitHub Issues.</td></tr>
              <tr><td>OAuth wraca na /login, token wygasł</td><td>Access token żyje 1 h (refresh 30 dni). Usuń konektor i dodaj ponownie; sprawdź, czy klient obsługuje PKCE S256 i DCR.</td></tr>
              <tr><td>Limit 100/mies. wyczerpany (chmura)</td><td>Sprawdź <code>/api/quota</code> na koncie albo przejdź na serwer lokalny przez stdio (bez limitu chmury).</td></tr>
              <tr><td>Nie wiesz, co się dzieje</td><td><code>npx -y polish-academic-mcp doctor</code>, potem <code>POLISH_ACADEMIC_DEBUG=1</code> i log klienta; ręczne testy: <code>npx @modelcontextprotocol/inspector npx -y polish-academic-mcp</code>.</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ROZWÓJ */}
      <Section id="rozwoj" eyebrow="11 · Programiści" title="Rozwój, testy i dodawanie baz">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <h3 className="font-semibold text-brand-700">Lokalny rozwój</h3>
            <div className="mt-3"><CodeBlock title="terminal" code={"npm run build        # tsc → dist/\nnpm test             # kontrakty MCP, źródeł i routera\nnpm run dev          # serwer stdio z src/\nnpx @modelcontextprotocol/inspector npx -y polish-academic-mcp"} /></div>
            <p className="mt-3 text-sm leading-relaxed text-fg-secondary">
              Nigdy nie pisz na stdout poza transportem (stdout niesie protokół MCP) — logi tylko na stderr.
              Dokumentacja tej strony jest generowana przy buildzie z prawdziwego serwera (
              <code>cloud/web/scripts/generate-mcp-docs.mjs</code>), więc katalog i schematy nie rozjeżdżają się z kodem.
            </p>
          </Card>
          <Card>
            <h3 className="font-semibold text-brand-700">Dodanie nowej bazy (3 kroki)</h3>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-fg-secondary">
              <li>Utwórz <code>src/tools/&lt;baza&gt;.ts</code> z funkcją <code>register…Tools(server, env)</code>; każde narzędzie: polski <code>title</code>, opis i <code>.describe()</code> przy parametrach, obsługa błędów przez <code>isError: true</code>.</li>
              <li>Dodaj wpis do katalogu <code>SOURCES</code> w <code>src/sources.ts</code> (id = prefiks narzędzi, jedna z 5 grup) i mapowanie w <code>src/server.ts</code> — kompilator wymusi kompletność.</li>
              <li>Zaktualizuj listę narzędzi w <code>tests/mcp-contract.test.ts</code>, liczniki w README oraz metadane w generatorze docs; zweryfikuj <code>npx tsc --noEmit &amp;&amp; npm test</code>.</li>
            </ol>
          </Card>
        </div>
        <Card>
          <p className="text-sm leading-relaxed text-fg-secondary">
            Kod źródłowy (MIT):{" "}
            <a className="font-medium text-brand-600 hover:underline" href="https://github.com/asterixix/polish-academic-mcp" target="_blank" rel="noreferrer">github.com/asterixix/polish-academic-mcp</a>{" "}
            · Pakiet npm: <code>polish-academic-mcp</code> · Zgłoszenia: GitHub Issues lub{" "}
            <a className="font-medium text-brand-600 hover:underline" href="mailto:artur@sendyka.dev">artur@sendyka.dev</a>{" "}
            · Zobacz też: <Link className="font-medium text-brand-600 hover:underline" to="/connectors">stronę konektorów</Link>,{" "}
            <Link className="font-medium text-brand-600 hover:underline" to="/changelog">changelog</Link> i{" "}
            <Link className="font-medium text-brand-600 hover:underline" to="/projekt">opis projektu</Link>.
          </p>
        </Card>
      </Section>
    </div>
  );
}
