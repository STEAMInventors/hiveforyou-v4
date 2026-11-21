import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/study-preparation/study-preparation", () => ({
  getStudyPreparation: vi.fn(),
  getStudyTabView: vi.fn(),
}));

vi.mock("@/server/reports/reports", () => ({
  getHiveReports: vi.fn(),
}));

vi.mock("@/server/pipeline/pack-loader", () => ({
  loadPackById: vi.fn(() => null),
  logPinnedPackNotFound: vi.fn(),
}));

vi.mock("@/server/observability/logger", () => ({
  emitStructuredEvent: vi.fn(),
}));

import { getStudyPreparation, getStudyTabView } from "@/server/study-preparation/study-preparation";
import { emitStructuredEvent } from "@/server/observability/logger";
import { loadHiveOverview } from "./hive-summary";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const CORR = "2eb8421a-b784-4bf8-ac2b-540299b61d13";

describe("loadHiveOverview study tab failures", () => {
  it("logs hive.study_tab.failed and returns studyLoadError when getStudyTabView throws", async () => {
    vi.mocked(getStudyPreparation).mockResolvedValue({
      eligibility: { documents: [{ sourceDocumentId: "d", fileName: "a.pdf", totalPhysicalPages: 1 }], excluded: [], activeReadCount: 0 },
      studyRevision: {
        id: "rev",
        revisionNumber: 1,
        createdAt: "2026-11-01T00:00:00.000Z",
        format: "canonical-study-1",
        coverageGaps: [],
      },
      processingRun: null,
      reportRuns: [],
      staleness: null,
    } as never);
    vi.mocked(getStudyTabView).mockRejectedValue(new Error("rpc_down"));

    const overview = await loadHiveOverview({} as never, { hiveId: HIVE_ID, correlationId: CORR });

    expect(overview.studyTab).toBeNull();
    expect(overview.studyLoadError).toEqual({
      message: "We couldn't load the study for this hive.",
      correlationId: CORR,
      retryable: true,
    });
    expect(emitStructuredEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "hive.study_tab.failed", hiveId: HIVE_ID, correlationId: CORR }),
    );
  });
});
