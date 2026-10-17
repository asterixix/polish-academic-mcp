import { Button } from "@/components/ui/Button";
import { FEEDBACK_EMAIL, FEEDBACK_GITHUB_ISSUES, errorMailto } from "@/lib/feedback";
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI crash:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const err = this.state.error;
    const mail = errorMailto({
      title: err.message || "Błąd UI",
      detail: err.stack?.slice(0, 800),
    });

    return (
      <div
        role="alert"
        className="mx-auto max-w-lg px-4 py-16 text-center"
      >
        <h1 className="font-display text-2xl font-semibold text-brand-700">
          Coś poszło nie tak
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-secondary">
          Wystąpił nieoczekiwany błąd aplikacji. Możesz odświeżyć stronę albo zgłosić
          problem developerowi.
        </p>
        <p className="mt-2 break-words rounded-xl bg-brand-50 px-3 py-2 font-mono text-xs text-brand-900">
          {err.message}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onPress={() => location.reload()}>Odśwież stronę</Button>
          <a href={mail}>
            <Button variant="secondary">Zgłoś e-mailem</Button>
          </a>
          <a href={FEEDBACK_GITHUB_ISSUES} target="_blank" rel="noreferrer">
            <Button variant="secondary">GitHub Issues</Button>
          </a>
        </div>
        <p className="mt-4 text-xs text-fg-secondary">
          Kontakt:{" "}
          <a href={`mailto:${FEEDBACK_EMAIL}`} className="text-brand-700 underline">
            {FEEDBACK_EMAIL}
          </a>
        </p>
      </div>
    );
  }
}
