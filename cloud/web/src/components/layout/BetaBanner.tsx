import { AlertCircle } from "@untitledui/icons";
import { motion, useReducedMotion } from "motion/react";

export function BetaBanner() {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      role="status"
      initial={reduceMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="border-b border-brand-200 bg-brand-50"
    >
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-3 text-sm text-brand-900 md:px-6">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
        <p className="text-balance leading-relaxed">
          <strong className="font-semibold">Informacja o przydziałach zasobów.</strong> Dostęp
          obejmuje bezpłatny przydział zapytań (AI Search: 2 wyszukiwania/tydzień bez konta, 5 po
          zalogowaniu; konektory MCP: 100 wywołań narzędzi/miesiąc). Wszystkie narzędzia działają w
          trybie tylko do odczytu (read-only) na publicznych bazach naukowych, prawnych i
          archiwalnych. Błędy MCP lub limity:{" "}
          <a href="mailto:artur@sendyka.dev" className="font-semibold underline">
            artur@sendyka.dev
          </a>
          .
        </p>
      </div>
    </motion.div>
  );
}
