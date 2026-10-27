import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="auth-container">
      <div className="card form-stack">{children}</div>
    </div>
  );
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
      <p role="status" className="notice-info">
        {children}
      </p>
    );
  }
  return (
    <p role="alert" className="notice-error">
      {children}
    </p>
  );
}

export function AuthHeading({ title, lede }: { title: string; lede: string }) {
  return (
    <div>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.625rem",
          margin: 0,
        }}
      >
        {title}
      </h1>
      <p className="muted" style={{ margin: "0.25rem 0 0" }}>
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
    <label className="form-field">
      {label}
      <input {...inputProps} className="form-input" />
      {hint ? <span className="field-hint">{hint}</span> : null}
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
    <button type="submit" disabled={pending} className="button">
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
    <p
      className="muted"
      style={{ margin: 0, textAlign: "center", fontSize: "0.875rem" }}
    >
      <Link href={`/login?next=${next}`}>Log in</Link>
      <span aria-hidden> · </span>
      <Link href={`/register?next=${next}`}>Create an account</Link>
      {showForgot ? (
        <>
          <span aria-hidden> · </span>
          <Link href={`/forgot-password?next=${next}`}>Forgot password?</Link>
        </>
      ) : null}
    </p>
  );
}
