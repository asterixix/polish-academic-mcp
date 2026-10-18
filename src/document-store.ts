import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export function defaultDocsDir(): string {
  return join(process.env.LOCALAPPDATA ?? homedir(), "polish-academic-mcp", "docs");
}

export async function saveDocument(
  buf: Buffer,
  name: string,
  dir = defaultDocsDir(),
): Promise<{ path: string; bytes: number }> {
  await mkdir(dir, { recursive: true });
  const safe = basename(name).replace(/[^\w.-]/g, "_") || "document";
  const path = join(dir, safe);
  await writeFile(path, buf);
  return { path, bytes: buf.length };
}
