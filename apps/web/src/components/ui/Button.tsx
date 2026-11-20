import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "text";
export type ButtonSize = "default" | "small";

const BASE =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-control text-[15px] no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-45";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "border-0 bg-blue-deep font-semibold text-paper hover:bg-cell-blue-hover min-h-11 min-[900px]:min-h-9 px-[18px] py-2",
  secondary:
    "border border-line-strong bg-paper font-medium text-ink hover:border-line hover:bg-hover min-h-11 min-[900px]:min-h-9 px-4 py-2",
  quiet:
    "border-0 bg-transparent font-medium text-ink-2 hover:bg-hover hover:text-ink min-h-11 min-[900px]:min-h-9 px-3 py-2",
  text: "border-0 bg-transparent p-0 font-medium text-blue-deep hover:underline min-h-11 min-[900px]:min-h-auto",
};

const SIZE: Record<ButtonSize, string> = {
  default: "",
  small: "!min-h-9 !px-3 !py-1.5 !text-[13px] min-[900px]:!min-h-8",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

export function Button({ variant = "primary", size = "default", className = "", children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}