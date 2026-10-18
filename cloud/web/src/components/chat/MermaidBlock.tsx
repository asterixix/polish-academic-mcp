import { useEffect, useId, useState } from "react";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  mermaidPromise ??= import("mermaid").then((m) => {
    m.default.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
    return m.default;
  });
  return mermaidPromise;
}

export function MermaidBlock({ code }: { code: string }) {
  const id = useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then((mermaid) => mermaid.render(`mmd${id}`, code))
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (failed) {
    return (
      <div className="my-3">
        <p className="mb-1.5 text-xs font-semibold text-warning-700">
          Nie udało się wyrenderować diagramu (niepoprawna składnia Mermaid). Poniżej kod źródłowy.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border-primary bg-bg-primary p-3 font-mono text-[11px] leading-relaxed text-fg-secondary">
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  if (!svg) {
    return (
      <div className="my-3 h-24 animate-pulse rounded-xl border border-border-primary bg-bg-primary" />
    );
  }
  return (
    <div
      className="my-3 overflow-x-auto rounded-xl border border-border-primary bg-bg-primary p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
