import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const PUBLIC_MCP_URL = "https://polish-academic-mcp.kolpol25.workers.dev/mcp";
const LOCAL_MCP_URL = "http://localhost:8788/mcp";

export const metadata: Metadata = {
	title: "Konfiguracja MCP | Polish Academic MCP",
	description:
		"Jak podłączyć serwer Polish Academic MCP w Claude, ChatGPT, Gemini i lokalnie — instrukcja po polsku.",
};

export default function McpSetupPage() {
	return (
		<main className="mx-auto w-full max-w-3xl px-4 py-10">
			<div className="mb-8 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="font-semibold text-2xl tracking-tight">
						Konfiguracja serwera MCP
					</h1>
					<p className="mt-2 text-muted-foreground text-sm leading-relaxed">
						Krótka instrukcja po polsku, zgodna z{" "}
						<Link
							href="/"
							className="text-primary underline underline-offset-2"
						>
							README.md
						</Link>
						. Adres publiczny możesz zastąpić własnym wdrożeniem Cloudflare
						Workers.
					</p>
				</div>
				<Button asChild variant="outline" size="sm">
					<Link href="/chat">Czat interaktywny</Link>
				</Button>
			</div>

			<section className="space-y-3 border-b pb-8">
				<h2 className="font-medium text-lg">Adresy końcowe</h2>
				<ul className="list-inside list-disc space-y-1 text-muted-foreground text-sm">
					<li>
						<strong className="text-foreground">Lokalnie (development):</strong>{" "}
						<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
							{LOCAL_MCP_URL}
						</code>{" "}
						po{" "}
						<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
							npm run dev
						</code>
					</li>
					<li>
						<strong className="text-foreground">Publiczny przykład:</strong>{" "}
						<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all">
							{PUBLIC_MCP_URL}
						</code>
					</li>
				</ul>
			</section>

			<section className="space-y-3 border-b py-8">
				<h2 className="font-medium text-lg">
					Uruchomienie lokalne i MCP Inspector
				</h2>
				<ol className="list-inside list-decimal space-y-2 text-muted-foreground text-sm leading-relaxed">
					<li>
						W katalogu repozytorium:{" "}
						<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
							npm install
						</code>
						, potem{" "}
						<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
							npm run dev
						</code>
						.
					</li>
					<li>
						Serwer MCP nasłuchuje pod{" "}
						<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
							{LOCAL_MCP_URL}
						</code>
						.
					</li>
					<li>
						Test:{" "}
						<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
							npx @modelcontextprotocol/inspector@latest
						</code>
						, w przeglądarce w polu Server URL wpisz adres lokalny i połącz się.
					</li>
				</ol>
			</section>

			<section className="space-y-3 border-b py-8">
				<h2 className="font-medium text-lg">Claude Desktop</h2>
				<p className="text-muted-foreground text-sm leading-relaxed">
					Dodaj wpis do pliku konfiguracyjnego (np. macOS:{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
						~/Library/Application Support/Claude/claude_desktop_config.json
					</code>
					, Windows:{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
						%APPDATA%\Claude\claude_desktop_config.json
					</code>
					):
				</p>
				<pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
					{`{
  "mcpServers": {
    "polish-academic": {
      "command": "npx",
      "args": ["mcp-remote", "${PUBLIC_MCP_URL}"]
    }
  }
}`}
				</pre>
				<p className="text-muted-foreground text-sm">
					Zamień URL na lokalny, jeśli używasz tylko{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">
						{LOCAL_MCP_URL}
					</code>{" "}
					przez{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">
						mcp-remote
					</code>
					.
				</p>
			</section>

			<section className="space-y-3 border-b py-8">
				<h2 className="font-medium text-lg">Claude.ai (connector)</h2>
				<ol className="list-inside list-decimal space-y-2 text-muted-foreground text-sm leading-relaxed">
					<li>
						<strong className="text-foreground">
							Ustawienia → Connectors → Dodaj własny connector
						</strong>
					</li>
					<li>
						Jako URL serwera wpisz adres końcowy MCP (np. publiczny powyżej).
					</li>
					<li>Zapisz konfigurację.</li>
				</ol>
			</section>

			<section className="space-y-3 border-b py-8">
				<h2 className="font-medium text-lg">ChatGPT (plan Plus / wyżej)</h2>
				<ol className="list-inside list-decimal space-y-2 text-muted-foreground text-sm leading-relaxed">
					<li>Otwórz ChatGPT i zaloguj się.</li>
					<li>
						<strong className="text-foreground">
							Ustawienia → Połączone aplikacje
						</strong>{" "}
						(Connected apps).
					</li>
					<li>
						<strong className="text-foreground">
							Dodaj narzędzia → Serwer MCP
						</strong>{" "}
						i wklej ten sam URL co wyżej.
					</li>
					<li>Nadaj nazwę (np. Polish Academic) i zapisz.</li>
				</ol>
				<p className="text-muted-foreground text-sm">
					Dokładne menu może się różnić w zależności od wersji interfejsu.
				</p>
			</section>

			<section className="space-y-3 border-b py-8">
				<h2 className="font-medium text-lg">Google Gemini (Gemini CLI)</h2>
				<p className="text-muted-foreground text-sm">
					W pliku{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
						~/.gemini/settings.json
					</code>
					:
				</p>
				<pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
					{`{
  "mcpServers": {
    "polish-academic": {
      "httpUrl": "${PUBLIC_MCP_URL}"
    }
  }
}`}
				</pre>
			</section>

			<section className="space-y-3 border-b py-8">
				<h2 className="font-medium text-lg">Ważne: limity i prywatność</h2>
				<ul className="list-inside list-disc space-y-2 text-muted-foreground text-sm leading-relaxed">
					<li>
						<strong className="text-foreground">Rate limit:</strong> ok. 10
						wywołań narzędzi na godzinę na adres IP (żądania inicjalizacji /
						lista narzędzi nie wliczają się).
					</li>
					<li>
						<strong className="text-foreground">Serwer zdalny:</strong> zgodnie
						z README może zbierać anonimowe dane ewaluacyjne; pełną kontrolę
						masz przy uruchomieniu lokalnym.
					</li>
				</ul>
			</section>

			<section className="pt-8">
				<p className="text-muted-foreground text-sm">
					Szczegóły wdrożenia na Cloudflare (KV,{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">
						wrangler.jsonc
					</code>
					), OpenAI Responses API, Python, Google ADK i inne — w{" "}
					<Link href="/" className="text-primary underline underline-offset-2">
						README.md na stronie głównej
					</Link>
					.
				</p>
			</section>
		</main>
	);
}
