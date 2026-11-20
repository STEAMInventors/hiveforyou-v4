import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "text";
export type ButtonSize = "default" | "small";

const BASE =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-[7px] whitespace-nowrap rounded-button border text-[13.5px] font-semibold no-underline transition-colors h-[34px] px-[13px] max-[759px]:h-11 disabled:cursor-not-allowed disabled:opacity-50";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "border-blue-deep bg-blue-deep text-paper hover:bg-blue-press",
  secondary: "border-line-strong bg-paper text-ink hover:bg-hover",
  quiet: "border-transparent bg-transparent text-ink-2 hover:bg-hover",
  text: "border-transparent bg-transparent px-1.5 text-blue-deep hover:bg-blue-wash",
};

const SIZE: Record<ButtonSize, string> = {
  default: "",
  small: "!h-8 !px-2.5 !text-meta max-[759px]:!h-10",
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
