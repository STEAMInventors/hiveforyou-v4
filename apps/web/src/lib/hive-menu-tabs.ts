import type { HiveWorkspaceSection } from "@/lib/hive-routes";

/** Concept v5 `data-tab` keys for the hive left menu and tabs. */
export type HiveMenuTab = "home" | "documents" | "timeline" | "report" | "audit" | "notes";

export type HiveMenuNavItem = {
  tab: HiveMenuTab;
  section: HiveWorkspaceSection;
  label: string;
  staffOnly?: boolean;
};

export const HIVE_MENU_NAV: readonly HiveMenuNavItem[] = [
  { tab: "home", section: "board", label: "Home" },
  { tab: "documents", section: "documents", label: "Documents" },
  { tab: "timeline", section: "timeline", label: "Timeline" },
  { tab: "report", section: "reports", label: "Report" },
  { tab: "audit", section: "audit", label: "Audit trail" },
  { tab: "notes", section: "notes", label: "Team notes", staffOnly: true },
];

export function hiveMenuTabForSection(section: HiveWorkspaceSection): HiveMenuTab {
  const row = HIVE_MENU_NAV.find((item) => item.section === section);
  return row?.tab ?? "home";
}

export function hiveMenuNavForHive(staffClientHive: boolean): readonly HiveMenuNavItem[] {
  return HIVE_MENU_NAV.filter((item) => !item.staffOnly || staffClientHive);
}
