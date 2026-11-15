import { describe, expect, it } from "vitest";

import { hiveListBackLink } from "./hive-list-back";

describe("hiveListBackLink", () => {
  it("returns All clients for a client hive when starting view is clients", () => {
    expect(hiveListBackLink("clients", "client")).toEqual({ label: "All clients", href: "/hives?view=all" });
  });

  it("returns My own matters for an own hive when starting view is clients", () => {
    expect(hiveListBackLink("clients", "own")).toEqual({ label: "My own matters", href: "/hives?view=own" });
  });

  it("returns Your hives when starting view is own", () => {
    expect(hiveListBackLink("own", "client")).toEqual({ label: "Your hives", href: "/hives" });
    expect(hiveListBackLink("own", "own")).toEqual({ label: "Your hives", href: "/hives" });
  });
});