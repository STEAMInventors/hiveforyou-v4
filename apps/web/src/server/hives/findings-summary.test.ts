import type { GetStudyPreparationResponse, StudyView } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { documentsReadCount, documentsReadLabel, findingsItemCount, findingsToReviewCount } from "./findings-summary";

function preparation(duplicateCount?: number): GetStudyPreparationResponse {
  return {
    eligibility: {
      documents: [
        { sourceDocumentId: "a", totalPhysicalPages: 2 },
        { sourceDocumentId: "b", totalPhysicalPages: 4 },
      ],
      excluded: [{ sourceDocumentId: "c" }],
      ...(duplicateCount === undefined ? {} : { duplicateCount }),
    },
  } as GetStudyPreparationResponse;
}

describe("findings summary numbers", () => {
  it("counts documents read and omits a duplicate count that is not in the data", () => {
    const count = documentsReadCount(preparation());
    expect(count).toEqual({ read: 2, total: 3, duplicateCount: null });
    expect(documentsReadLabel(count)).toBe("2 of 3");
  });

  it("appends a duplicate count only when the preparation already has one", () => {
    const count = documentsReadCount(preparation(1));
    expect(count.duplicateCount).toBe(1);
    expect(documentsReadLabel(count)).toBe("2 of 3 · 1 duplicate");
  });

  it("counts study-view rows and items to review", () => {
    const view = {
      blocks: [{ rows: [{ id: "1" }, { id: "2" }] }, { rows: [{ id: "3" }] }],
    } as Pick<StudyView, "blocks">;
    expect(findingsItemCount(view)).toBe(3);
    expect(findingsToReviewCount({ needs: 2, changed: 1 })).toBe(3);
    expect(findingsToReviewCount({ needs: 0, changed: 0 })).toBe(0);
    expect(findingsToReviewCount(null)).toBe(0);
  });
});
