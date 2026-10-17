/**
 * Follow-up live checks after fixing dLibra GraphQL and Biblioteka Nauki PDF links.
 * Usage: npx tsx scripts/scenario-live.ts
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const client = new Client({ name: "scenario-live", version: "1.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "src/index.ts", "--mode=router"],
  cwd: root,
  stderr: "pipe",
});

function clip(text: string, n = 1200): string {
  return text.length > n ? `${text.slice(0, n)}\n…[${text.length} znaków]` : text;
}

async function call(name: string, args: Record<string, unknown>, timeoutMs = 70_000): Promise<string> {
  const started = Date.now();
  const label = `${name} ${JSON.stringify(args).slice(0, 240)}`;
  try {
    const result = await Promise.race([
      client.callTool({ name, arguments: args }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    const text = (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
    console.log(`\n===== ${result.isError ? "BŁĄD" : "OK"} ${Date.now() - started}ms :: ${label}`);
    console.log(clip(text));
    return text;
  } catch (err) {
    console.log(`\n===== FAIL ${Date.now() - started}ms :: ${label}\n${err instanceof Error ? err.message : err}`);
    return "";
  }
}

async function main(): Promise<void> {
  await client.connect(transport);

  const bn = await call("search", {
    operation: "bn_search_publications",
    query: "\"Wiesław Babik\"",
    limit_per_source: 5,
    max_chars: 7000,
  });
  const docs = [...bn.matchAll(/"publicationId"\s*:\s*"(\d+)"[\s\S]{0,900}?"contributors"\s*:\s*\[([^\]]*)\]/g)];
  const babik = docs.find((m) => /Babik/i.test(m[2]));
  console.log("BN dopasowanie autora Babik:", babik ? `${babik[1]} ${babik[2].slice(0, 120)}` : "brak");
  if (babik) {
    await call("get_record", {
      url: `https://bibliotekanauki.pl/articles/${babik[1]}.pdf`,
      grep: "Babik",
      max_chars: 3500,
    }, 90_000);
  }

  await call("get_record", { id: "ludzie:FjvWgg26fj8", max_chars: 3500 });

  const jbc = await call("search", {
    operation: "jbc_search",
    query: "Chopin etiudy",
    limit_per_source: 2,
    max_chars: 4000,
  });
  const elementId = jbc.match(/"elementId"\s*:\s*"(\d+)"/)?.[1];
  console.log("JBC elementId:", elementId ?? "brak");
  if (elementId) {
    const card = await call("get_record", { id: `jbc:${elementId}`, max_chars: 2500 });
    const pdf = card.match(/https?:\/\/[^"\s]+handler=pdf[^"\s]*/)?.[0];
    console.log("JBC content:", pdf ?? "brak content_url");
    if (pdf) {
      await call("get_record", { url: pdf, grep: "Chopin", max_chars: 2500 }, 90_000);
    }
  }

  const fbc = await call("search", {
    operation: "fbc_search",
    query: "Chopin mazurki",
    limit_per_source: 2,
    max_chars: 2500,
  });
  console.log("FBC ma wyniki:", /totalResultsCount":\s*[1-9]/.test(fbc));

  const acts = await call("search", {
    operation: "isap_search_acts",
    query: "podatku",
    filters: { year: 2026, publisher: "DU" },
    limit_per_source: 3,
    max_chars: 3500,
  });
  const actParts = acts.match(
    /"pos"\s*:\s*(\d+)[\s\S]{0,500}?"publisher"\s*:\s*"DU"[\s\S]{0,1200}?"year"\s*:\s*(2026)/,
  );
  const eli = actParts ? `DU/${actParts[2]}/${actParts[1]}` : "DU/2026/1289";
  console.log("ISAP ELI:", eli);
  await call("get_record", {
    id: `isap:${eli}`,
    include_fulltext: true,
    grep: "podatk",
    max_chars: 4000,
  }, 90_000);

  await call("get_record", {
    id: "saos:540753",
    grep: "podatk",
    max_chars: 3000,
  });

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
