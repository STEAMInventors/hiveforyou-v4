import {
  CANONICAL_STUDY_SCHEMA,
  type CanonicalGap,
  type CanonicalStudy,
  hiveBoardOpenChecklistCount,
} from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import type { GetStudyPreparationResponse } from "@hiveforyou/contracts";

import { summarizeHive } from "./hive-summary";

function gap(partial: Partial<CanonicalGap> & Pick<CanonicalGap, "id">): CanonicalGap {
  return {
    statement: partial.title ?? "Item",
    relatedSpineIds: [],
    kind: "REQUESTABLE_DOCUMENT",
    title: partial.title ?? "Item",
    why: partial.why ?? "",
    holder: partial.holder ?? "",
    holderType: partial.holderType ?? "ASKER_OR_CLIENT",
    when: null,
    basisType: null,
    relatedFactIds: [],
    ...partial,
  };
}

describe("summarizeHive board missing alignment", () => {
  it("uses the board open checklist count instead of the study request list when an upload is pending rebuild", () => {
    const revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [gap({ id: "G1", title: "Lease" }), gap({ id: "G2", title: "Insurance binder" })],
    };
    const boardOpen = hiveBoardOpenChecklistCount({
      canonicalStudy: study,
      referencedDocuments: [],
      gapUploads: [
        {
          gapId: "G2",
          sourceDocumentId: "upload-1",
          gapTitle: "Insurance binder",
          studyRevisionId: revisionId,
          registeredAt: "2026-11-02T00:00:00.000Z",
        },
      ],
      acceptedStudyRevisionId: revisionId,
      acceptedStudyRevisionAcceptedAt: "2026-11-01T00:00:00.000Z",
      documentsPath: "",
    });
    expect(boardOpen).toBe(2);

    const preparation = {
      eligibility: { documents: [{ sourceDocumentId: "d1", fileName: "a.pdf", totalPhysicalPages: 1 }], excluded: [], activeReadCount: 0 },
      studyRevision: {
        id: revisionId,
        revisionNumber: 1,
        createdAt: "2026-11-01T00:00:00.000Z",
        format: "canonical-study-1",
        coverageGaps: [],
      },
      processingRun: null,
      reportRuns: [],
      staleness: null,
    } as unknown as GetStudyPreparationResponse;

    const summary = summarizeHive(preparation, null, null, study, {
      referencedDocuments: [],
      gapUploads: [
        {
          gapId: "G2",
          sourceDocumentId: "upload-1",
          gapTitle: "Insurance binder",
          studyRevisionId: revisionId,
          registeredAt: "2026-11-02T00:00:00.000Z",
        },
      ],
      acceptedStudyRevisionId: revisionId,
      acceptedStudyRevisionAcceptedAt: "2026-11-01T00:00:00.000Z",
    });

    expect(summary.attention.counts.missing).toBe(2);
    expect(summary.attention.sentence).toBe("2 items are missing.");
  });
});