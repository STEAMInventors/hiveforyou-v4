import { describe, expect, it } from "vitest";

import { buildHiveBoardChecklistFromRequests } from "./hive-board-requests";
import type { RequestItem } from "./hive-request-contracts";

const base = (partial: Partial<RequestItem>): RequestItem => ({
  id: "req-1",
  hiveId: "hive-1",
  source: "pack",
  packRowKey: "pay stubs",
  title: "Pay stubs",
  detail: null,
  position: 1,
  state: "WAITING",
  stateNote: null,
  acceptedBy: null,
  createdAt: "2026-11-17T00:00:00.000Z",
  updatedAt: "2026-11-17T00:00:00.000Z",
  documents: [],
  latestCheck: null,
  ...partial,
});

describe("buildHiveBoardChecklistFromRequests", () => {
  it("shows waiting items from list_requests", () => {
    const built = buildHiveBoardChecklistFromRequests([base({})], "/hives/h/documents");
    expect(built.checklist[0]?.statusText).toBe("Waiting");
    expect(built.progress?.total).toBe(1);
  });
});