import Link from "next/link";

export default function HiveNotFound() {
  return (
    <div className="card">
      <h1 style={{ marginTop: 0, fontSize: "1.25rem" }}>Hive not found</h1>
      <p className="muted">
        This preview only includes demo hives on your device. Unknown hive identifiers are not shown as if they existed.
      </p>
      <Link href="/hives" className="button" style={{ display: "inline-flex", marginTop: "0.75rem" }}>
        Back to My Hives
      </Link>
    </div>
  );
}
