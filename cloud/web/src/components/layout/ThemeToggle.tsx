import { applyTheme, readThemeChoice, storeTheme, type ThemeChoice } from "@/lib/theme";
import { useEffect, useState } from "react";

const ORDER: ThemeChoice[] = ["system", "dark", "light"];

const LABEL: Record<ThemeChoice, string> = {
  system: "System",
  dark: "Ciemny",
  light: "Jasny",
};

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    const initial = readThemeChoice();
    setChoice(initial);
    applyTheme(initial);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readThemeChoice() === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return (
    <button
      type="button"
      className="inline-flex h-9 min-w-16 items-center justify-center rounded-full border border-border-primary bg-bg-secondary px-3 text-xs font-semibold text-fg-primary transition hover:border-brand-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.98]"
      aria-label={`Motyw: ${LABEL[choice]}. Kliknij, aby zmienić.`}
      onClick={() => {
        const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length] ?? "system";
        setChoice(next);
        storeTheme(next);
      }}
    >
      {LABEL[choice]}
    </button>
  );
}
