import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DOC_PAGES, readDocContent } from "@/lib/docs";

export async function generateMetadata(): Promise<Metadata> {
	const doc = await readDocContent("readme");
	return {
		title: doc ? `${doc.title} | Polish Academic MCP` : "Polish Academic MCP",
		description: doc
			? doc.content.slice(0, 160).replace(/\s+/g, " ").trim()
			: "Polish Academic MCP",
	};
}

export default async function Home() {
	const readme = await readDocContent("readme");
	const otherDocs = DOC_PAGES.filter((d) => d.slug !== "readme");

	return (
		<main className="mx-auto w-full max-w-5xl px-4 py-10">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="font-semibold text-2xl">README</h1>
					<p className="mt-1 text-muted-foreground text-sm">README.md</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button asChild size="sm">
						<Link href="/chat">Interactive Chat</Link>
					</Button>
					<Button asChild variant="outline" size="sm">
						<Link
							href="https://sendyka.dev"
							target="_blank"
							rel="noopener noreferrer"
						>
							sendyka.dev
						</Link>
					</Button>
				</div>
			</div>

			<div className="rounded-lg border bg-card p-5">
				<pre className="whitespace-pre-wrap font-sans text-sm leading-6">
					{readme?.content || "README.md could not be loaded."}
				</pre>
			</div>

			<section className="mt-10">
				<h2 className="mb-4 font-medium text-xl">More project pages</h2>
				<div className="grid gap-3 sm:grid-cols-2">
					{otherDocs.map((doc) => (
						<Link
							key={doc.slug}
							href={`/docs/${doc.slug}`}
							className="rounded-lg border p-4 transition-colors hover:bg-accent"
						>
							<p className="font-medium">{doc.title}</p>
							<p className="text-muted-foreground text-sm">{doc.fileName}</p>
						</Link>
					))}
				</div>
			</section>
		</main>
	);
}
