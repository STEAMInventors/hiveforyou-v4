import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";

import { HiveBrandMark } from "@/components/HiveWordmark";
import { SignedOutBar } from "@/components/SignedOutBar";

import { AuthSplitLayout } from "./AuthSplitLayout";

/**
 * `column` is the Concept v5 sign-in: signed-out bar and one 400px column.
 * `split` (welcome) and `plain` (sign-in help) keep their earlier layouts.
 */
export type SignInShellLayout = "column" | "split" | "plain";

export function SignInShell({
  children,
  layout = "column",
}: {
  children: ReactNode;
  layout?: SignInShellLayout;
}) {
  if (layout === "column") {
    return (
      <div className="flex min-h-dvh flex-col bg-paper text-ink">
        <SignedOutBar />
        <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col gap-5 px-5 pb-24 pt-[72px]">
          <HiveBrandMark variant="signIn" />
          {children}
        </main>
      </div>
    );
  }

  const column = (
    <div className="flex w-full max-w-[420px] flex-col gap-5">
      <Link
        href="/"
        aria-label="HiveForYou home"
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center self-start rounded-control"
      >
        <HiveBrandMark variant="signIn" />
      </Link>
      {children}
    </div>
  );

  if (layout === "plain") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper px-5 py-10 text-ink">
        {column}
      </div>
    );
  }

  return <AuthSplitLayout>{column}</AuthSplitLayout>;
}

export function SignInHeading({
  title,
  lede,
  titleLevel = 1,
}: {
  title: string;
  lede: ReactNode;
  titleLevel?: 1 | 2;
}) {
  const TitleTag = titleLevel === 2 ? "h2" : "h1";
  return (
    <div className="flex flex-col gap-2">
      <TitleTag className="m-0 font-brand text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">
        {title}
      </TitleTag>
      <p className="m-0 text-[15px] leading-[1.55] text-ink-2">{lede}</p>
    </div>
  );
}

export function SignInFieldError({ message }: { message: string }) {
  return (
    <p role="alert" className="m-0 text-[13px] text-coral-deep">
      {message}
    </p>
  );
}

type SignInFieldProps = {
  label: string;
  error?: string | null;
  id: string;
  /** Extra classes for the input (for example letter spacing on a code). */
  inputClassName?: string;
} & InputHTMLAttributes<HTMLInputElement>;

export function SignInField({ label, error, id, inputClassName = "", ...inputProps }: SignInFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13.5px] font-semibold text-ink">
        {label}
      </label>
      <input
        {...inputProps}
        id={id}
        aria-invalid={error ? true : undefined}
        className={`h-11 rounded-[10px] border border-line-strong bg-paper px-3.5 text-[16px] font-normal text-ink outline-none focus:border-blue focus:shadow-focus ${inputClassName}`.trim()}
      />
      {error ? <SignInFieldError message={error} /> : null}
    </div>
  );
}
