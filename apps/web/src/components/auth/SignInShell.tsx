import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";

import { HiveBrandMark } from "@/components/HiveWordmark";

import { AuthSplitLayout } from "./AuthSplitLayout";

export function SignInShell({
  children,
  splitPage = true,
}: {
  children: ReactNode;
  splitPage?: boolean;
}) {
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

  if (!splitPage) {
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
  lede: string;
  titleLevel?: 1 | 2;
}) {
  const TitleTag = titleLevel === 2 ? "h2" : "h1";
  return (
    <div className="flex flex-col gap-1.5">
      <TitleTag className="m-0 font-brand text-[32px] font-semibold leading-[1.15] text-ink">
        {title}
      </TitleTag>
      <p className="m-0 text-base leading-[1.55] text-ink-2">{lede}</p>
    </div>
  );
}

export function SignInFieldError({ message }: { message: string }) {
  return (
    <p role="alert" className="m-0 text-sm text-coral-deep">
      {message}
    </p>
  );
}

type SignInFieldProps = {
  label: string;
  error?: string | null;
  id: string;
} & InputHTMLAttributes<HTMLInputElement>;

export function SignInField({ label, error, id, ...inputProps }: SignInFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        {...inputProps}
        id={id}
        aria-invalid={error ? true : undefined}
        className="h-[52px] rounded-button border border-line-strong bg-paper px-4 text-[17px] font-normal text-ink outline-none focus:border-blue"
      />
      {error ? <SignInFieldError message={error} /> : null}
    </div>
  );
}