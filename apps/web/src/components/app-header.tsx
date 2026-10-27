import Link from "next/link";

export function AppHeader() {
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
        }}
      >
        <Link href="/" style={{ fontFamily: "var(--font-display)", fontWeight: 700, textDecoration: "none", color: "var(--color-ink)" }}>
          HiveForYou
        </Link>
        <nav aria-label="Account">
          <span className="muted" style={{ fontSize: "0.875rem" }}>
            Sign-in available in a future update
          </span>
        </nav>
      </div>
    </header>
  );
}
