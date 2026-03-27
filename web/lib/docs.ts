import { readFile } from "node:fs/promises";
import path from "node:path";

export const DOC_PAGES = [
	{ slug: "readme", title: "README", fileName: "README.md" },
	{ slug: "evaluation", title: "EVALUATION", fileName: "EVALUATION.md" },
	{ slug: "contributing", title: "CONTRIBUTING", fileName: "CONTRIBUTING.md" },
	{ slug: "license", title: "LICENSE", fileName: "LICENSE" },
	{ slug: "security", title: "SECURITY", fileName: "SECURITY.md" },
	{ slug: "research", title: "RESEARCH", fileName: "RESEARCH.md" },
] as const;

export type DocSlug = (typeof DOC_PAGES)[number]["slug"];

export async function readDocContent(slug: string): Promise<{
	title: string;
	fileName: string;
	content: string;
} | null> {
	const doc = DOC_PAGES.find((item) => item.slug === slug);
	if (!doc) return null;

	const absolutePath = path.resolve(process.cwd(), "..", doc.fileName);

	try {
		const content = await readFile(absolutePath, "utf8");
		return { title: doc.title, fileName: doc.fileName, content };
	} catch {
		return { title: doc.title, fileName: doc.fileName, content: "" };
	}
}
