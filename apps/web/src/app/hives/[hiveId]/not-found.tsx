import Link from "next/link";

export default function HiveNotFound() {
  return (
    <div className="card">
      <h1 style={{ marginTop: 0, fontSize: "1.25rem" }}>Hive not found</h1>
      <p className="muted">
        We could not find that Hive in your account. Unknown or unauthorized
        Hive identifiers are not shown.
      </p>
      <Link
        href="/hives"
        className="button"
        style={{ display: "inline-flex", marginTop: "0.75rem" }}
      >
        Back to My Hives
      </Link>
    </div>
  );
}
