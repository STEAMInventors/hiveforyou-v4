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
        Preview workspace — not connected to an account yet.
      </p>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "0.25rem" }}>{hiveName}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{hiveDescription}</p>

      <label htmlFor="hive-ask" style={{ display: "block", marginTop: "1.25rem", fontWeight: 600 }}>
        Ask about these documents
      </label>
      <input
        id="hive-ask"
        className="hero-input"
        type="text"
        disabled
        placeholder="Available after sign-in and document upload"
        aria-describedby="hive-ask-help"
        style={{ marginTop: "0.5rem" }}
      />
      <p id="hive-ask-help" className="muted" style={{ fontSize: "0.875rem" }}>
        Questions and analysis are not available in this preview shell.
      </p>

      <HiveTabNav hiveId={hiveId} active={activeTab} />
      {children}
    </div>
  );
}
