import { describe, expect, it } from "vitest";

import { hiveListBackLink } from "./hive-list-back";

describe("hiveListBackLink", () => {
  it("labels breadcrumbs for client professionals", () => {
    expect(hiveListBackLink("clients", "client")).toEqual({
      label: "All clients",
      href: "/hives?queue=all",
    });
    expect(hiveListBackLink("clients", "own")).toEqual({
      label: "My own matters",
      href: "/hives?queue=own",
    });
  });

  it("labels breadcrumbs for individual starting view", () => {
    expect(hiveListBackLink("own", "client")).toEqual({ label: "Your hives", href: "/hives" });
    expect(hiveListBackLink("own", "own")).toEqual({ label: "Your hives", href: "/hives" });
  });
});