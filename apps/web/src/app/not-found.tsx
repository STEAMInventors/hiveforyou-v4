import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card">
      <h1 style={{ marginTop: 0, fontSize: "1.25rem" }}>Page not found</h1>
      <p className="muted">That address is not part of this preview application.</p>
      <Link href="/" className="button" style={{ display: "inline-flex", marginTop: "0.75rem" }}>
        Back to home
      </Link>
    </div>
  );
}
