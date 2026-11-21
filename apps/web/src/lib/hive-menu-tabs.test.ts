import { describe, expect, it } from "vitest";

import { hiveMenuNavForHive, hiveMenuTabForSection, HIVE_MENU_NAV } from "./hive-menu-tabs";

describe("hive-menu-tabs", () => {
  it("maps workspace sections to concept data-tab keys", () => {
    expect(hiveMenuTabForSection("board")).toBe("home");
    expect(hiveMenuTabForSection("documents")).toBe("documents");
    expect(hiveMenuTabForSection("findings")).toBe("report");
    expect(hiveMenuTabForSection("reports")).toBe("report");
    expect(hiveMenuTabForSection("audit")).toBe("audit");
    expect(hiveMenuTabForSection("notes")).toBe("notes");
  });

  it("hides Team notes outside firm client hives", () => {
    const staff = hiveMenuNavForHive(true).map((row) => row.tab);
    const own = hiveMenuNavForHive(false).map((row) => row.tab);
    expect(staff).toEqual(["home", "documents", "report", "audit", "notes"]);
    expect(own).toEqual(["home", "documents", "report", "audit"]);
    expect(HIVE_MENU_NAV.find((row) => row.tab === "notes")?.staffOnly).toBe(true);
  });
});
