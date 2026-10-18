import { applyTheme, readThemeChoice, storeTheme, type ThemeChoice } from "@/lib/theme";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const ORDER: ThemeChoice[] = ["system", "dark", "light"];

const LABEL: Record<ThemeChoice, string> = {
  system: "Systemowy",
  dark: "Ciemny",
  light: "Jasny",
};

const ICON: Record<ThemeChoice, typeof Sun> = {
  system: Monitor,
  dark: Moon,
  light: Sun,
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

  const Icon = ICON[choice];

  return (
    <button
      type="button"
      className="inline-flex size-10 items-center justify-center rounded-full border border-border-primary bg-bg-secondary text-fg-primary transition hover:border-brand-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.98]"
      aria-label={`Motyw: ${LABEL[choice]}. Kliknij, aby zmienić.`}
      title={`Motyw: ${LABEL[choice]}`}
      onClick={() => {
        const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length] ?? "system";
        setChoice(next);
        storeTheme(next);
      }}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
