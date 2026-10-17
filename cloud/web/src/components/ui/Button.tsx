import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-600 border-transparent shadow-soft",
  secondary: "bg-bg-secondary text-fg-primary border-border-primary hover:bg-brand-50",
  ghost: "bg-transparent text-fg-secondary border-transparent hover:bg-brand-50 hover:text-brand-700",
  danger: "bg-danger text-white border-transparent",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
  isDisabled?: boolean;
  onPress?: () => void;
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  children,
  disabled,
  isDisabled,
  onPress,
  onClick,
  type = "button",
  ...props
}: Props) {
  return (
    <button
      type={type}
      disabled={disabled || isDisabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full border font-semibold transition duration-200",
        "outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
        "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      onClick={(e) => {
        onClick?.(e);
        onPress?.();
      }}
      {...props}
    >
      {children}
    </button>
  );
}
