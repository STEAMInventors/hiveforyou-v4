import { describe, expect, it } from "vitest";

import { formatWorkspaceActivityDate } from "./format-workspace-activity";

describe("formatWorkspaceActivityDate", () => {
  const now = new Date("2026-11-17T14:00:00");

  it("formats today with time", () => {
    expect(formatWorkspaceActivityDate("2026-11-17T09:42:00", now)).toBe("Today, 9:42 AM");
  });

  it("formats yesterday with time", () => {
    expect(formatWorkspaceActivityDate("2026-11-16T16:15:00", now)).toBe("Yesterday, 4:15 PM");
  });

  it("formats same-year dates without year", () => {
    expect(formatWorkspaceActivityDate("2026-10-27T12:00:00", now)).toBe("Oct 27");
  });

  it("formats prior years with year", () => {
    expect(formatWorkspaceActivityDate("2025-10-27T12:00:00", now)).toBe("Oct 27, 2025");
  });
});