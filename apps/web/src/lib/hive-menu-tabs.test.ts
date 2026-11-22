import { describe, expect, it } from "vitest";

import { hiveSectionPath } from "./hive-routes";
import { hiveMenuNavForHive, hiveMenuTabForSection, HIVE_MENU_NAV } from "./hive-menu-tabs";

const HIVE = "11111111-1111-4111-8111-111111111111";

describe("hive-menu-tabs", () => {
  it("maps workspace sections to concept data-tab keys", () => {
    expect(hiveMenuTabForSection("board")).toBe("home");
    expect(hiveMenuTabForSection("documents")).toBe("documents");
    expect(hiveMenuTabForSection("timeline")).toBe("timeline");
    expect(hiveMenuTabForSection("findings")).toBe("home");
    expect(hiveMenuTabForSection("reports")).toBe("report");
    expect(hiveMenuTabForSection("audit")).toBe("audit");
    expect(hiveMenuTabForSection("notes")).toBe("notes");
  });

  it("each menu item href matches its page route", () => {
    for (const item of HIVE_MENU_NAV) {
      expect(hiveSectionPath(HIVE, item.section)).toMatch(new RegExp(`/hives/${HIVE}(/|$)`));
    }
    expect(hiveSectionPath(HIVE, "reports")).toBe(`/hives/${HIVE}/reports`);
    expect(hiveSectionPath(HIVE, "timeline")).toBe(`/hives/${HIVE}/timeline`);
    expect(HIVE_MENU_NAV.find((row) => row.tab === "report")?.section).toBe("reports");
  });

  it("hides Team notes outside firm client hives", () => {
    const staff = hiveMenuNavForHive(true).map((row) => row.tab);
    const own = hiveMenuNavForHive(false).map((row) => row.tab);
    expect(staff).toEqual(["home", "documents", "timeline", "report", "audit", "notes"]);
    expect(own).toEqual(["home", "documents", "timeline", "report", "audit"]);
    expect(HIVE_MENU_NAV.find((row) => row.tab === "notes")?.staffOnly).toBe(true);
  });
});
