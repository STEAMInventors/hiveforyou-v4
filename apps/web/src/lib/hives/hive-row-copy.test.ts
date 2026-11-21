import type { Hive } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { formatHiveUpdated, hiveRowSubline } from "./hive-row-copy";

const VIEWER = "11111111-1111-4111-8111-111111111111";

function hive(overrides: Partial<Hive> = {}): Hive {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    hiveId: "550e8400-e29b-41d4-a716-446655440000",
    name: "Alex Carter",
    description: "Benefits application",
    kind: "client",
    clientRequestId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("hiveRowSubline", () => {
  it("names the assignee's first name for a firm hive", () => {
    const line = hiveRowSubline(
      hive({ firmId: "f", assigneeUserId: "22222222-2222-4222-8222-222222222223", assigneeDisplayName: "Priya Shah" }),
      VIEWER,
    );
    expect(line).toBe("Benefits application · with Priya");
  });

  it("says you when the viewer is the assignee", () => {
    expect(hiveRowSubline(hive({ firmId: "f", assigneeUserId: VIEWER, assigneeDisplayName: "Priya Shah" }), VIEWER)).toBe(
      "Benefits application · with you",
    );
  });

  it("says unassigned when a firm hive has nobody on it", () => {
    expect(hiveRowSubline(hive({ firmId: "f", assigneeUserId: null }), VIEWER)).toBe(
      "Benefits application · unassigned",
    );
  });

  it("shows only the purpose without a firm", () => {
    expect(hiveRowSubline(hive({ firmId: null, kind: "own" }), VIEWER)).toBe("Benefits application");
  });

  it("falls back to the kicker and returns null when there is nothing to say", () => {
    expect(hiveRowSubline(hive({ description: null, homeKicker: "Intake · for Alex" }), VIEWER)).toBe("Intake");
    expect(hiveRowSubline(hive({ description: null }), VIEWER)).toBeNull();
  });
});

describe("formatHiveUpdated", () => {
  const now = new Date(2026, 10, 20, 15, 0, 0);

  it("reads just now, minutes and hours", () => {
    expect(formatHiveUpdated(new Date(2026, 10, 20, 14, 59, 40).toISOString(), now)).toBe("Updated just now");
    expect(formatHiveUpdated(new Date(2026, 10, 20, 14, 59, 0).toISOString(), now)).toBe("Updated 1 minute ago");
    expect(formatHiveUpdated(new Date(2026, 10, 20, 14, 30, 0).toISOString(), now)).toBe("Updated 30 minutes ago");
    expect(formatHiveUpdated(new Date(2026, 10, 20, 13, 0, 0).toISOString(), now)).toBe("Updated 2 hours ago");
  });

  it("reads yesterday, a weekday and a date", () => {
    expect(formatHiveUpdated(new Date(2026, 10, 19, 9, 0, 0).toISOString(), now)).toBe("Updated yesterday");
    expect(formatHiveUpdated(new Date(2026, 10, 16, 9, 0, 0).toISOString(), now)).toBe("Updated Monday");
    expect(formatHiveUpdated(new Date(2026, 10, 6, 9, 0, 0).toISOString(), now)).toBe("Updated Nov 6");
    expect(formatHiveUpdated(new Date(2025, 10, 6, 9, 0, 0).toISOString(), now)).toBe("Updated Nov 6, 2025");
  });

  it("returns null for a bad timestamp", () => {
    expect(formatHiveUpdated("not a date", now)).toBeNull();
  });
});
