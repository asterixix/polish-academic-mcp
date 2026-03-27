import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readDocContent } from "@/lib/docs";

type Props = {
	params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { slug } = await params;
	const doc = await readDocContent(slug);

	if (!doc) {
		return { title: "Document Not Found | Polish Academic MCP" };
	}

	return {
		title: `${doc.title} | Polish Academic MCP`,
		description: `Project document: ${doc.fileName}`,
	};
}

export default async function DocPage({ params }: Props) {
	const { slug } = await params;
	const doc = await readDocContent(slug);

	if (!doc) notFound();

	return (
		<main className="mx-auto w-full max-w-5xl px-4 py-10">
			<h1 className="font-semibold text-2xl">{doc.title}</h1>
			<p className="mt-1 text-muted-foreground text-sm">{doc.fileName}</p>
			<div className="mt-6 rounded-lg border bg-card p-5">
				<pre className="whitespace-pre-wrap text-sm leading-6">
					{doc.content || "This document is currently empty."}
				</pre>
			</div>
		</main>
	);
}
