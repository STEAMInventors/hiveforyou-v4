import Link from "next/link";

import { DEMO_HIVES } from "@/lib/demo-scaffold";

export default function MyHivesPage() {
  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", marginTop: 0 }}>My Hives</h1>
      <p className="muted">
        Account sign-in and saved hives are not available yet. Below is a local preview list only.
      </p>

      <button type="button" className="button" disabled aria-disabled="true" style={{ marginTop: "1rem" }}>
        New Hive (requires sign-in)
      </button>

      <ul style={{ listStyle: "none", padding: 0, marginTop: "1.5rem", display: "grid", gap: "0.75rem" }}>
        {DEMO_HIVES.map((hive) => (
          <li key={hive.id} className="card">
            <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.125rem" }}>{hive.name}</h2>
            <p className="muted" style={{ margin: "0 0 0.75rem" }}>{hive.description}</p>
            <Link href={`/hives/${hive.id}/documents`}>Open hive</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
