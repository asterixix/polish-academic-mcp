import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";

export function Field({
  label,
  className,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const inputId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <label className={cn("flex flex-col gap-1.5 text-left", className)} htmlFor={inputId}>
      <span className="text-sm font-medium text-fg-secondary">{label}</span>
      <input
        id={inputId}
        className={cn(
          "h-11 w-full rounded-xl border border-border-primary bg-bg-secondary px-3.5 text-fg-primary",
          "outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100",
          "placeholder:text-fg-tertiary",
        )}
        {...props}
      />
    </label>
  );
}
