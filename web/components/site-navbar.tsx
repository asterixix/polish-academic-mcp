import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DOC_PAGES } from "@/lib/docs";

export function SiteNavbar() {
	return (
		<header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
			<div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4">
				<Link href="/" className="font-semibold text-sm">
					Polish Academic MCP
				</Link>

				<nav className="flex flex-wrap items-center gap-1">
					<Button asChild variant="ghost" size="sm">
						<Link href="/chat">Interactive Chat</Link>
					</Button>
					<Button asChild variant="ghost" size="sm">
						<Link href="/mcp">Konfiguracja MCP</Link>
					</Button>
					{DOC_PAGES.map((doc) => (
						<Button key={doc.slug} asChild variant="ghost" size="sm">
							<Link href={`/docs/${doc.slug}`}>{doc.title}</Link>
						</Button>
					))}
					<Button asChild size="sm">
						<Link
							href="https://sendyka.dev"
							target="_blank"
							rel="noopener noreferrer"
						>
							sendyka.dev
						</Link>
					</Button>
				</nav>
			</div>
		</header>
	);
}
