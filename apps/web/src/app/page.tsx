import Link from "next/link";

import { DEMO_HIVE_ID } from "@/lib/demo-scaffold";

export default function LandingPage() {
  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2rem", marginBottom: "0.5rem" }}>
        What are you working on?
      </h1>
      <p className="muted" style={{ maxWidth: "36rem" }}>
        HiveForYou helps you organize documents, build an evidence-backed Study, and explore reports — calmly and with source provenance.
      </p>

      <label htmlFor="landing-intent" style={{ display: "block", marginTop: "1.5rem", fontWeight: 600 }}>
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
      <p id="landing-intent-help" className="muted" style={{ fontSize: "0.875rem" }}>
        This preview shell does not save your input or start processing.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1.5rem" }}>
        <button type="button" className="button" disabled aria-disabled="true">
          Sign in (coming soon)
        </button>
        <Link href="/hives" className="button button-secondary">
          Preview My Hives
        </Link>
        <Link href={`/hives/${DEMO_HIVE_ID}/documents`} className="button button-secondary">
          Open preview hive
        </Link>
      </div>
    </div>
  );
}
