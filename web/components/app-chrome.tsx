import Link from "next/link";
import {
	SITE_AUTHOR_URL,
	SITE_GITHUB_URL,
	SITE_LICENSE_URL,
	SITE_PROJECT_NAME,
} from "../lib/site-branding";

export function AppChrome({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-screen flex-col">
			<header
				className="border-b border-border bg-card"
				role="banner"
			>
				<div className="mx-auto flex max-w-5xl items-center px-6 py-3">
					<Link
						href="/"
						className="text-base font-semibold tracking-tight text-foreground hover:underline"
					>
						{SITE_PROJECT_NAME}
					</Link>
				</div>
			</header>
			<main className="flex-1" id="main-content">
				{children}
			</main>
			<footer
				className="border-t border-border bg-muted/40 px-6 py-6"
				role="contentinfo"
			>
				<div className="mx-auto max-w-5xl text-sm leading-relaxed text-muted-foreground">
					<p>
						<strong className="font-semibold text-foreground">
							{SITE_PROJECT_NAME}
						</strong>
						{" — "}
						<a
							className="text-primary underline-offset-4 hover:underline"
							href={SITE_AUTHOR_URL}
							rel="noopener noreferrer"
							target="_blank"
						>
							Strona autora projektu
						</a>
						{" — "}
						<a
							className="text-primary underline-offset-4 hover:underline"
							href={SITE_GITHUB_URL}
							rel="noopener noreferrer"
							target="_blank"
						>
							GitHub
						</a>
						{" — Licencja "}
						<a
							className="text-primary underline-offset-4 hover:underline"
							href={SITE_LICENSE_URL}
							rel="noopener noreferrer"
							target="_blank"
						>
							MIT
						</a>
					</p>
				</div>
			</footer>
		</div>
	);
}
