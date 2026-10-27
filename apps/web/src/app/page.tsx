import Link from "next/link";

import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function LandingPage() {
  const auth = await requireAuthenticatedUser();

  return (
    <div>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "2rem",
          marginBottom: "0.5rem",
        }}
      >
        What are you working on?
      </h1>
      <p className="muted" style={{ maxWidth: "36rem" }}>
        HiveForYou helps you organize documents, build an evidence-backed Study,
        and explore reports — calmly and with source provenance.
      </p>
      <p className="muted" style={{ maxWidth: "36rem", fontSize: "0.9375rem" }}>
        Upload whatever you have — old, partial, or out of order is fine. Your
        uploaded files stay private to your account.
      </p>

      <label
        htmlFor="landing-intent"
        style={{ display: "block", marginTop: "1.5rem", fontWeight: 600 }}
      >
        Describe your goal
      </label>
      <input
        id="landing-intent"
        className="hero-input"
        type="text"
        name="intent"
        placeholder="For example: understand these medical bills"
        aria-describedby="landing-intent-help"
        style={{ marginTop: "0.5rem" }}
      />
      <p
        id="landing-intent-help"
        className="muted"
        style={{ fontSize: "0.875rem" }}
      >
        Create or open a Hive to keep your documents and Study together.
      </p>

      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginTop: "1.5rem",
        }}
      >
        {auth.ok ? (
          <Link href="/hives" className="button">
            Open My Hives
          </Link>
        ) : (
          <>
            <Link href="/register" className="button">
              Get started
            </Link>
            <Link href="/login" className="button button-secondary">
              Log in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
