import { describe, expect, it } from "vitest";

import type { GetStudyPreparationResponse } from "@hiveforyou/contracts";

import { hiveIntakeCounts } from "./hive-summary";

const basePrep = {
  eligibility: {
    documents: [{ sourceDocumentId: "a", fileName: "a.pdf", totalPhysicalPages: 1 }],
    excluded: [],
    activeReadCount: 0,
  },
} as unknown as GetStudyPreparationResponse;

describe("hiveIntakeCounts", () => {
  it("returns zeros when there are no documents", () => {
    expect(
      hiveIntakeCounts(
        { ...basePrep, eligibility: { documents: [], excluded: [], activeReadCount: 0 } } as GetStudyPreparationResponse,
        null,
        {
          documentCount: 0,
          openMissing: 0,
          documentsNotReadCount: 0,
        } as never,
      ),
    ).toEqual({ total: 0, received: 0 });
  });

  it("uses document read progress when no request list exists", () => {
    expect(
      hiveIntakeCounts(basePrep, null, {
        documentCount: 2,
        openMissing: 0,
        documentsNotReadCount: 1,
      } as never),
    ).toEqual({ total: 2, received: 1 });
  });
});