import { Button } from "@/components/ui/Button";
import { Link } from "react-router-dom";
import { motion } from "motion/react";

const origin = typeof window !== "undefined" ? window.location.origin : "https://pamcp.pl";

const connectors = [
  {
    name: "Claude (Anthropic Connectors Directory)",
    steps: [
      "W Claude.ai lub Claude Desktop otwórz Settings → Connectors → Add custom connector.",
      `Podaj adres HTTPS serwera MCP: ${origin}/mcp`,
      "Dokończ autoryzację OAuth 2.1 (Dynamic Client Registration + PKCE S256) — zaloguj się przez ORCID, e-mail lub passkey.",
      "Wszystkie narzędzia mają przypisane tytuły (title) oraz adnotacje readOnlyHint: true, destructiveHint: false, openWorldHint: true.",
    ],
  },
  {
    name: "ChatGPT (OpenAI Directory / Connectors)",
    steps: [
      `W ustawieniach Connectors / Deep Research podaj adres serwera MCP: ${origin}/mcp`,
      "Alternatywnie dla Custom GPT Actions użyj specyfikacji OpenAPI 3.1: /openapi.json oraz endpointów /api/search i /api/fetch.",
      "Każde narzędzie ma jawne flagi bezpieczeństwa (readOnlyHint, destructiveHint, openWorldHint) oraz zminimalizowany schemat wejścia/wyjścia.",
    ],
  },
  {
    name: "Perplexity (Connectors & Plugins)",
    steps: [
      `Dodaj Remote MCP Connector wskazujący na adres: ${origin}/mcp`,
      "Autoryzacja odbywa się automatycznie przez OAuth 2.1 + PKCE S256 (RFC 8414 / RFC 9728).",
      "Discovery: /.well-known/oauth-authorization-server oraz /.well-known/oauth-protected-resource.",
    ],
  },
];

const examplePrompts = [
  "Wyszukaj w polskich bazach naukowych (Biblioteka Nauki, RUJ, AGH) publikacje o zastosowaniu sztucznej inteligencji w diagnostyce medycznej po 2023 roku.",
  "Znajdź w bazie ISAP obowiązujące ustawy o odnawialnych źródłach energii oraz sprawdź powiązane wyroki sądowe w SAOS.",
  "Pobierz z Banku Danych Lokalnych GUS (BDL) dane o przeciętnym wynagrodzeniu i bezrobociu w województwach.",
  "Przeszukaj Szukaj w Archiwach, AGAD i Straty.pl pod kątem materiałów archiwalnych dotyczących Warszawy z lat 1939–1945.",
  "Wyszukaj w Wolnych Lekturach utwory Bolesława Prusa i pobierz pełny tekst wybranego dokumentu.",
];

export function ConnectorsPage() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      <div className="max-w-3xl">
        <h1 className="font-display text-3xl font-semibold text-brand-700">
          Konektor Polish Academic (Claude, ChatGPT, Perplexity)
        </h1>
        <p className="mt-3 text-base leading-relaxed text-fg-secondary">
          Zdalny serwer MCP udostępniający jedno ujednolicone środowisko z 3 narzędziami (
          <code>list_sources</code>, <code>search</code>, <code>get_record</code>) obsługującymi{" "}
          <strong>wszystkich polskich baz naukowych, medycznych, prawnych, statystycznych, normalizacyjnych i kulturowych</strong>{" "}
          (pełny zestaw operacji natywnych; aktualne liczby w dokumentacji). Wszystkie operacje działają wyłącznie w trybie odczytu (
          <code>readOnlyHint: true</code>, <code>destructiveHint: false</code>,{" "}
          <code>idempotentHint: true</code>, <code>openWorldHint: true</code>).
        </p>
        <div className="mt-4 rounded-2xl border border-border-primary bg-bg-secondary p-4 font-mono text-sm text-brand-800">
          {origin}/mcp
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onPress={() => navigator.clipboard.writeText(`${origin}/mcp`)}
          >
            Kopiuj URL MCP
          </Button>
          <Link to="/login">
            <Button>Zaloguj przed podłączeniem</Button>
          </Link>
          <Link to="/docs">
            <Button variant="secondary">Pełna dokumentacja MCP →</Button>
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-brand-200 bg-brand-50/70 p-6 shadow-soft">
        <h2 className="font-display text-xl font-semibold text-brand-700">
          Dokumentacja serwera MCP — /docs
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-secondary">
          Na stronie <Link to="/docs" className="font-semibold text-brand-700 underline underline-offset-2">pamcp.pl/docs</Link>{" "}
          (także pod <Link to="/connectors/docs" className="font-semibold text-brand-700 underline underline-offset-2">/connectors/docs</Link>)
          znajdziesz kompletną dokumentację: architekturę chmura vs. lokalne stdio, instrukcje dla Claude, ChatGPT
          i Perplexity, instalację CLI dla 22 aplikacji AI ze snippetami dla Windows i macOS/Linux, pełne schematy
          3 narzędzi Meta-Routera oraz interaktywny katalog wszystkich baz i operacji natywnych
          z parametrami, zmienne środowiskowe, endpointy OAuth/discovery i diagnostykę.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/docs"><Button>Otwórz dokumentację</Button></Link>
          <Link to="/docs#katalog"><Button variant="secondary">Katalog baz</Button></Link>
          <Link to="/docs#operacje"><Button variant="secondary">Schematy operacji</Button></Link>
          <Link to="/docs#klienci"><Button variant="secondary">Konfiguracja aplikacji AI</Button></Link>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {connectors.map((c) => (
          <article
            key={c.name}
            className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-soft"
          >
            <h2 className="font-semibold text-brand-700">{c.name}</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm leading-relaxed text-fg-secondary">
              {c.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </article>
        ))}
      </div>

      <section className="rounded-2xl border border-border-primary bg-bg-secondary p-6 shadow-soft">
        <h2 className="font-display text-xl font-semibold text-brand-700">
          Przykładowe zapytania startowe (Example Prompts)
        </h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Gotowe prompty do przetestowania konektora po połączeniu w Claude, ChatGPT lub Perplexity:
        </p>
        <ul className="mt-4 space-y-2 text-sm text-fg-primary">
          {examplePrompts.map((prompt) => (
            <li
              key={prompt}
              className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border-primary/70 bg-brand-50/40 px-4 py-2.5"
            >
              <span className="max-w-3xl">„{prompt}”</span>
              <Button variant="secondary" size="sm" onPress={() => navigator.clipboard.writeText(prompt)}>
                Kopiuj prompt
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-border-primary bg-bg-secondary p-6 shadow-soft">
        <h2 className="font-display text-xl font-semibold text-brand-700">
          Specyfikacja narzędzi MCP i docelowych API (Target API Docs)
        </h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Serwer udostępnia 3 ujednolicone narzędzia w trybie tylko do odczytu (read-only) z pełnymi
          adnotacjami MCP:
        </p>
        <div className="mt-4 space-y-3 text-sm text-fg-secondary">
          <div className="rounded-xl border border-border-primary/70 p-4">
            <strong className="text-fg-primary">
              1. <code>list_sources</code> — Katalog źródeł i operacji — Polish Academic
            </strong>
            <p className="mt-1">
              Zwraca listę wszystkich baz w 5 kategoriach (<code>nauka</code>, <code>dane</code>,{" "}
              <code>prawo</code>, <code>normy</code>, <code>kultura</code>) oraz pełne schematy
              parametrów wszystkich operacji natywnych (<code>include_operations=true</code>). Adnotacje:{" "}
              <code>readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true</code>.
            </p>
          </div>
          <div className="rounded-xl border border-border-primary/70 p-4">
            <strong className="text-fg-primary">
              2. <code>search</code> — Wyszukiwanie w polskich bazach — Polish Academic
            </strong>
            <p className="mt-1">
              Równoległe wyszukiwanie pełnotekstowe w całej kategorii (<code>category</code>), we
              wskazanych bazach (<code>sources</code>) lub wywołanie operacji natywnej (
              <code>operation</code> + <code>filters</code>). Adnotacje:{" "}
              <code>readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true</code>.
            </p>
          </div>
          <div className="rounded-xl border border-border-primary/70 p-4">
            <strong className="text-fg-primary">
              3. <code>get_record</code> — Pobranie rekordu i pełnego tekstu — Polish Academic
            </strong>
            <p className="mt-1">
              Pobiera metadane i pełną treść dokumentu (PDF z warstwą tekstową lub OCR/HTR, XLSX,
              CSV, TSV, XML/OAI-PMH, HTML, JSON) po identyfikatorze <code>źródło:id</code> (np.{" "}
              <code>isap:DU/2023/123</code>, <code>ruj:207985</code>, <code>saos:12345</code>) lub
              adresie <code>url</code>. Adnotacje:{" "}
              <code>readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true</code>.
            </p>
          </div>
        </div>
        <h3 className="mt-5 font-semibold text-brand-700">
          Dokumentacja wybranych docelowych API źródłowych (Target API Documentation)
        </h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-secondary">
          <li>
            ISAP / Sejm ELI API:{" "}
            <a className="text-brand-600 hover:underline" href="https://api.sejm.gov.pl/eli/openapi/ui" target="_blank" rel="noreferrer">
              https://api.sejm.gov.pl/eli/openapi/ui
            </a>
          </li>
          <li>
            SAOS (System Analizy Orzeczeń Sądowych API):{" "}
            <a className="text-brand-600 hover:underline" href="https://www.saos.org.pl/help/index.php/dokumentacja-api" target="_blank" rel="noreferrer">
              https://www.saos.org.pl/help/index.php/dokumentacja-api
            </a>
          </li>
          <li>
            GUS Bank Danych Lokalnych (BDL API):{" "}
            <a className="text-brand-600 hover:underline" href="https://bdl.stat.gov.pl/api/v1/" target="_blank" rel="noreferrer">
              https://bdl.stat.gov.pl/api/v1/
            </a>
          </li>
          <li>
            Otwarte Dane (Dane.gov.pl API):{" "}
            <a className="text-brand-600 hover:underline" href="https://api.dane.gov.pl/doc" target="_blank" rel="noreferrer">
              https://api.dane.gov.pl/doc
            </a>
          </li>
          <li>
            RAD-on / POL-on OpenData API:{" "}
            <a className="text-brand-600 hover:underline" href="https://radon.nauka.gov.pl/opendata/" target="_blank" rel="noreferrer">
              https://radon.nauka.gov.pl/opendata/
            </a>
          </li>
          <li>
            Biblioteka Nauki (OAI-PMH) & Wolne Lektury REST API:{" "}
            <a className="text-brand-600 hover:underline" href="https://wolnelektury.pl/api/" target="_blank" rel="noreferrer">
              https://wolnelektury.pl/api/
            </a>
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-border-primary bg-bg-secondary p-6 shadow-soft">
        <h2 className="font-display text-xl font-semibold text-brand-700">
          Metadane techniczne i weryfikacyjne (Directory Review)
        </h2>
        <div className="mt-3 grid gap-3 text-sm text-fg-secondary sm:grid-cols-2">
          <div>
            <strong className="text-fg-primary">Nazwa w katalogu:</strong> Polish Academic
          </div>
          <div>
            <strong className="text-fg-primary">Slug:</strong> <code>polish-academic</code>
          </div>
          <div>
            <strong className="text-fg-primary">Uwierzytelnianie:</strong> OAuth 2.1 (PKCE S256 + DCR)
          </div>
          <div>
            <strong className="text-fg-primary">Adnotacje narzędzi:</strong>{" "}
            <code>readOnlyHint: true</code>, <code>destructiveHint: false</code>,{" "}
            <code>openWorldHint: true</code>
          </div>
          <div>
            <strong className="text-fg-primary">Polityka prywatności:</strong>{" "}
            <Link to="/privacy" className="text-brand-600 hover:underline">
              {origin}/privacy
            </Link>
          </div>
          <div>
            <strong className="text-fg-primary">Regulamin usługi:</strong>{" "}
            <Link to="/terms" className="text-brand-600 hover:underline">
              {origin}/terms
            </Link>
          </div>
          <div>
            <strong className="text-fg-primary">Dokumentacja MCP:</strong>{" "}
            <Link to="/docs" className="text-brand-600 hover:underline">
              {origin}/docs
            </Link>
          </div>
          <div>
            <strong className="text-fg-primary">Metadane JSON:</strong>{" "}
            <a href="/api/directory-metadata" className="text-brand-600 hover:underline">
              {origin}/api/directory-metadata
            </a>
          </div>
          <div>
            <strong className="text-fg-primary">Strona główna usługi:</strong>{" "}
            <a href="https://pamcp.pl" className="text-brand-600 hover:underline">
              https://pamcp.pl
            </a>
          </div>
          <div>
            <strong className="text-fg-primary">Kod źródłowy (GitHub):</strong>{" "}
            <a
              href="https://github.com/asterixix/polish-academic-mcp"
              className="text-brand-600 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              github.com/asterixix/polish-academic-mcp
            </a>
          </div>
          <div>
            <strong className="text-fg-primary">Wsparcie i kontakt:</strong>{" "}
            <a className="text-brand-600 hover:underline" href="mailto:artur@sendyka.dev">
              artur@sendyka.dev
            </a>
          </div>
        </div>
      </section>
    </motion.div>
  );
}
