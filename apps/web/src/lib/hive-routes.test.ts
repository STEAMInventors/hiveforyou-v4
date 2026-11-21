import { describe, expect, it } from "vitest";

import {
  FINDINGS_TAB_LABELS,
  HIVE_SECTION_LABELS,
  hiveAuditPath,
  hiveFindingsPath,
  hiveSectionFromPathname,
  hiveSectionPath,
  mapStudyLegacyHash,
  parseFindingsTab,
  preservedQuery,
  type FindingsTab,
  type HiveWorkspaceSection,
} from "./hive-routes";

const HIVE = "11111111-1111-4111-8111-111111111111";

describe("hive section paths and labels", () => {
  it("names the rail in order and builds each path", () => {
    const order: HiveWorkspaceSection[] = ["board", "documents", "findings", "reports", "audit", "notes"];
    expect(order.map((section) => HIVE_SECTION_LABELS[section])).toEqual([
      "Hive board",
      "Documents",
      "Findings",
      "Reports",
      "Audit trail",
      "Team notes",
    ]);
    expect(order.map((section) => hiveSectionPath(HIVE, section))).toEqual([
      `/hives/${HIVE}`,
      `/hives/${HIVE}/documents`,
      `/hives/${HIVE}/findings`,
      `/hives/${HIVE}/reports`,
      `/hives/${HIVE}/audit`,
      `/hives/${HIVE}/notes`,
    ]);
    expect(hiveAuditPath(HIVE)).toBe(`/hives/${HIVE}/audit`);
  });

  it("writes the known findings tab without a query", () => {
    expect(hiveFindingsPath(HIVE)).toBe(`/hives/${HIVE}/findings`);
    expect(hiveFindingsPath(HIVE, "known")).toBe(`/hives/${HIVE}/findings`);
    expect(hiveFindingsPath(HIVE, "gaps")).toBe(`/hives/${HIVE}/findings#open-items`);
    expect(hiveFindingsPath(HIVE, "timeline")).toBe(`/hives/${HIVE}/findings#timeline`);
    expect(hiveFindingsPath(HIVE, "review")).toBe(`/hives/${HIVE}/findings#open-items`);
    expect(FINDINGS_TAB_LABELS).toEqual({
      known: "What we know",
      gaps: "Gaps and conflicts",
      timeline: "Timeline",
      review: "To review",
    });
  });

  it("treats every findings address as the findings section", () => {
    expect(hiveSectionFromPathname(`/hives/${HIVE}/findings`, HIVE)).toBe("findings");
    expect(hiveSectionFromPathname(`/hives/${HIVE}/audit`, HIVE)).toBe("audit");
    for (const tab of ["known", "gaps", "timeline", "review"] as const) {
      const path = hiveFindingsPath(HIVE, tab).split("?")[0] ?? "";
      expect(hiveSectionFromPathname(path, HIVE)).toBe("findings");
    }
  });
});

describe("parseFindingsTab", () => {
  it("returns known for unknown, empty, array and missing values", () => {
    expect(parseFindingsTab(undefined)).toBe("known");
    expect(parseFindingsTab("")).toBe("known");
    expect(parseFindingsTab("nope")).toBe("known");
    expect(parseFindingsTab(["later", "gaps"])).toBe("known");
    expect(parseFindingsTab(["gaps", "timeline"])).toBe("gaps");
    expect(parseFindingsTab(" REVIEW ")).toBe("review");
  });

  it("accepts each tab", () => {
    const tabs: FindingsTab[] = ["known", "gaps", "timeline", "review"];
    for (const tab of tabs) expect(parseFindingsTab(tab)).toBe(tab);
  });
});

describe("mapStudyLegacyHash", () => {
  it("sends every study hash to Home", () => {
    const home = `/hives/${HIVE}#show`;
    expect(mapStudyLegacyHash(HIVE, "missing")).toBe(home);
    expect(mapStudyLegacyHash(HIVE, "#disagree")).toBe(home);
    expect(mapStudyLegacyHash(HIVE, "timeline")).toBe(home);
    expect(mapStudyLegacyHash(HIVE, "establish")).toBe(home);
    expect(mapStudyLegacyHash(HIVE, "")).toBe(home);
  });
});

describe("preservedQuery", () => {
  it("keeps other params and applies overrides", () => {
    expect(preservedQuery({ keep: "1", extra: ["a", "b"], tab: "old" }, { tab: null })).toBe("?keep=1&extra=a&extra=b");
    expect(preservedQuery({ keep: "1" }, { tab: "gaps" })).toBe("?keep=1&tab=gaps");
    expect(preservedQuery({})).toBe("");
  });
});
