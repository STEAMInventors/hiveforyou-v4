import Link from "next/link";
import type { ReactNode } from "react";

import { HiveTabNav } from "./hive-tab-nav";

type HiveWorkspaceLayoutProps = {
  hiveId: string;
  hiveName: string;
  hiveDescription: string;
  activeTab: "documents" | "study" | "reports";
  children: ReactNode;
};

export function HiveWorkspaceLayout({
  hiveId,
  hiveName,
  hiveDescription,
  activeTab,
  children,
}: HiveWorkspaceLayoutProps) {
  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: "0.875rem" }}>
        <Link href="/hives" style={{ textDecoration: "none" }}>
          My Hives
        </Link>{" "}
        / {hiveName}
      </p>
      <h1
        style={{ fontFamily: "var(--font-display)", marginBottom: "0.25rem" }}
      >
        {hiveName}
      </h1>
      {hiveDescription ? (
        <p className="muted" style={{ marginTop: 0 }}>
          {hiveDescription}
        </p>
      ) : null}

      <label
        htmlFor="hive-ask"
        style={{ display: "block", marginTop: "1.25rem", fontWeight: 600 }}
      >
        Ask about these documents
      </label>
      <input
        id="hive-ask"
        className="hero-input"
        type="text"
        disabled
        placeholder="Available after document upload"
        aria-describedby="hive-ask-help"
        style={{ marginTop: "0.5rem" }}
      />
      <p
        id="hive-ask-help"
        className="muted"
        style={{ fontSize: "0.875rem" }}
      >
        Upload and register documents in a future update to start Study
        processing.
      </p>

      <HiveTabNav hiveId={hiveId} active={activeTab} />
      {children}
    </div>
  );
}
