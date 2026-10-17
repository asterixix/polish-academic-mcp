import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AnswerMarkdown({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="answer-md text-[15px] leading-relaxed text-fg-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 className="mt-4 mb-2 font-display text-xl font-semibold text-brand-800 first:mt-0">
              {children}
            </h2>
          ),
          h2: ({ children }) => (
            <h3 className="mt-4 mb-2 text-base font-semibold text-brand-800 first:mt-0">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-3 mb-1.5 text-sm font-semibold text-fg-primary">{children}</h4>
          ),
          p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-600 underline-offset-2 hover:underline"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-border-primary">
              <table className="min-w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-brand-25 text-brand-800">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-border-primary px-3 py-2 font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border-primary px-3 py-2 align-top text-fg-secondary">
              {children}
            </td>
          ),
          code: ({ className, children }) => {
            const lang = /language-(\w+)/.exec(className || "")?.[1];
            const isBlock = Boolean(lang) || String(children).includes("\n");
            if (!isBlock) {
              return (
                <code className="rounded bg-brand-25 px-1 py-0.5 font-mono text-[0.85em] text-brand-800">
                  {children}
                </code>
              );
            }
            return (
              <pre className="my-3 overflow-x-auto rounded-xl border border-border-primary bg-bg-primary p-3 font-mono text-[11px] leading-relaxed text-fg-secondary">
                {lang && (
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-brand-600">
                    {lang}
                  </div>
                )}
                <code>{children}</code>
              </pre>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-brand-300 pl-3 text-fg-secondary">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border-primary" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
