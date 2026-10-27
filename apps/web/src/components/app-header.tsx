import Link from "next/link";

import { signOutAction } from "@/server/auth/auth-actions";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export async function AppHeader() {
  const auth = await requireAuthenticatedUser();

  return (
    <header
      style={{
        borderBottom: "1px solid #e1e4e8",
        background: "var(--color-paper)",
        padding: "0.75rem 1rem",
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            textDecoration: "none",
            color: "var(--color-ink)",
          }}
        >
          HiveForYou
        </Link>
        <nav
          aria-label="Account"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          {auth.ok ? (
            <>
              <Link href="/hives" className="button button-secondary">
                My Hives
              </Link>
              <Link
                href="/account/password"
                style={{ fontSize: "0.875rem", textDecoration: "none" }}
              >
                Change password
              </Link>
              <form action={signOutAction} style={{ margin: 0 }}>
                <button type="submit" className="button button-secondary">
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="button button-secondary">
                Log in
              </Link>
              <Link href="/register" className="button">
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
