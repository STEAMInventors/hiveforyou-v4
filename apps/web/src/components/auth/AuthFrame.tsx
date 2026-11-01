import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";

import { HiveAppLogo } from "@/components/HiveWordmark";
import {
  PRIMARY_BUTTON_CLASS,
  TEXT_LINK_CLASS,
} from "@/components/button-classes";

export function AuthFrame({
  children,
  withLogo = true,
}: {
  children: ReactNode;
  withLogo?: boolean;
}) {
  const frame = (
    <div className="mx-auto flex w-full max-w-[440px] flex-col gap-6 px-4 py-12">
      {withLogo ? (
        <div className="flex justify-center">
          <HiveAppLogo linkHome display="lockup" size="landing" />
        </div>
      ) : null}
      <div className="flex flex-col gap-5 rounded-card border border-line bg-paper px-6 py-8 sm:px-8 sm:py-9">
        {children}
      </div>
    </div>
  );
  return withLogo ? <div className="min-h-dvh bg-paper text-ink">{frame}</div> : frame;
}

export function AuthNotice({
  tone,
  children,
}: {
  tone: "error" | "info";
  children: ReactNode;
}) {
  if (tone === "info") {
    return (
      <p
        role="status"
        className="m-0 rounded-button bg-cell-blue-wash px-3.5 py-2.5 text-sm text-cell-blue-deep"
      >
        {children}
      </p>
    );
  }
  return (
    <p
      role="alert"
      className="m-0 rounded-button bg-coral-wash px-3.5 py-2.5 text-sm text-coral-deep"
    >
      {children}
    </p>
  );
}

export function AuthHeading({ title, lede }: { title: string; lede: string }) {
  return (
    <div>
      <h1 className="m-0 font-brand text-[30px] font-semibold leading-tight text-ink">
        {title}
      </h1>
      <p className="mb-0 mt-1.5 text-[15px] leading-[1.55] text-ink-muted">
        {lede}
      </p>
    </div>
  );
}

type AuthFieldProps = {
  label: string;
  hint?: string;
} & InputHTMLAttributes<HTMLInputElement>;

export function AuthField({ label, hint, ...inputProps }: AuthFieldProps) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-muted">
      {label}
      <input
        {...inputProps}
        className="h-11 rounded-button border border-line bg-paper px-3.5 text-[15px] font-normal text-ink outline-none focus:border-cell-blue"
      />
      {hint ? (
        <span className="text-[12.5px] font-normal text-ink-subtle">{hint}</span>
      ) : null}
    </label>
  );
}

export function AuthSubmit({
  pending,
  label,
  pendingLabel,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
}) {
  return (
    <button type="submit" disabled={pending} className={PRIMARY_BUTTON_CLASS}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export function AuthCrossLinks({
  nextPath,
  showForgot = false,
}: {
  nextPath: string;
  showForgot?: boolean;
}) {
  const next = encodeURIComponent(nextPath);
  return (
    <p className="m-0 text-center text-sm leading-relaxed text-ink-muted">
      <Link href={`/login?next=${next}`} className={TEXT_LINK_CLASS}>
        Log in
      </Link>
      <span aria-hidden> · </span>
      <Link href={`/register?next=${next}`} className={TEXT_LINK_CLASS}>
        Create an account
      </Link>
      {showForgot ? (
        <>
          <span aria-hidden> · </span>
          <Link href={`/forgot-password?next=${next}`} className={TEXT_LINK_CLASS}>
            Forgot password?
          </Link>
        </>
      ) : null}
    </p>
  );
}
