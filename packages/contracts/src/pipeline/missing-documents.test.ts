import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalGap } from "./canonical-study-contracts";
import {
  buildMissingDocumentsSummary,
  filterActionableGaps,
  gapsSatisfiedInStudy,
  holderTypeLabel,
  parseGapUploadLinks,
  requestableDocumentCount,
} from "./missing-documents";
import { buildDocumentRequestListData } from "./document-request-list-contracts";

const gap = (partial: Partial<CanonicalGap> & Pick<CanonicalGap, "id">): CanonicalGap => ({
  statement: partial.title ?? "",
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
});

describe("holderTypeLabel", () => {
  it("uses bracket holder labels for third parties", () => {
    expect(holderTypeLabel("THIRD_PARTY", "THIRD_PARTY (vendor)", {})).toBe("the vendor");
    expect(holderTypeLabel("THIRD_PARTY", "THIRD_PARTY", { namedOrganization: "Acme Co" })).toBe("Acme Co");
    expect(holderTypeLabel("THIRD_PARTY", "THIRD_PARTY", {})).toBe("the other party");
  });

  it("uses You vs Client for asker slots", () => {
    expect(holderTypeLabel("ASKER_OR_CLIENT", "", { customer: true })).toBe("You");
    expect(holderTypeLabel("ASKER_OR_CLIENT", "", { customer: false })).toBe("Client");
  });
});

describe("missing document counts", () => {
  const gaps = [
    gap({ id: "X1", title: "Tax return", holderType: "ASKER_OR_CLIENT" }),
    gap({ id: "X2", title: "Schedule D", holderType: "ASKER_OR_CLIENT" }),
    gap({ id: "X3", title: "Pay stubs", holderType: "ASKER_OR_CLIENT" }),
    gap({ id: "X4", title: "Bank statements", holderType: "ASKER_OR_CLIENT" }),
    gap({ id: "X5", title: "Cobalt proof of claim", holderType: "COURT_RECORD" }),
    gap({ id: "X6", title: "Harborline proof of claim", holderType: "COURT_RECORD" }),
    gap({ id: "X7", title: "County tax proof of claim", holderType: "COURT_RECORD" }),
    gap({ id: "X8", kind: "FUTURE_RECORD", title: "Confirmation ruling", holderType: null, why: "Later" }),
    gap({ id: "X9", kind: "FUTURE_RECORD", title: "Servicer ruling", holderType: null, why: "Later" }),
  ];

  it("excludes COURT_RECORD from chip and slot counts", () => {
    const study: import("./canonical-study-contracts").CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps,
    };
    const list = buildDocumentRequestListData(study, []);
    expect(requestableDocumentCount(list)).toBe(4);
    expect(list.courtRecordCount).toBe(3);
    const summary = buildMissingDocumentsSummary(study);
    expect(summary.uploadSlotCount).toBe(4);
    expect(summary.courtRecordCount).toBe(3);
    expect(summary.futureRecordCount).toBe(2);
  });
});

describe("gap upload links", () => {
  it("maps registered documents to gap ids", () => {
    const links = parseGapUploadLinks([
      { id: "11111111-1111-4111-8111-111111111111", canonicalGapId: "X1" },
      { id: "22222222-2222-4222-8222-222222222222", canonicalGapId: null },
    ]);
    expect(links).toEqual([{ gapId: "X1", sourceDocumentId: "11111111-1111-4111-8111-111111111111" }]);
  });

  it("ignores gap id only links without revision, title, and post-acceptance registration", () => {
    const study: import("./canonical-study-contracts").CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [gap({ id: "X1", title: "Tax return" })],
    };
    const revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const acceptedAt = "2026-11-02T10:00:00.000Z";
    const summary = buildMissingDocumentsSummary(study, [], {
      acceptedStudyRevisionId: revisionId,
      acceptedStudyRevisionAcceptedAt: acceptedAt,
      gapUploads: [{ gapId: "X1", sourceDocumentId: "11111111-1111-4111-8111-111111111111" }],
    });
    expect(summary.hasPendingUploads).toBe(false);
    expect(summary.uploadSlotCount).toBe(1);
  });

  it("marks slots as added pending rebuild after upload", () => {
    const study: import("./canonical-study-contracts").CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [gap({ id: "X1", title: "Tax return" })],
    };
    const revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const acceptedAt = "2026-11-01T10:00:00.000Z";
    const summary = buildMissingDocumentsSummary(study, [], {
      acceptedStudyRevisionId: revisionId,
      acceptedStudyRevisionAcceptedAt: acceptedAt,
      gapUploads: [
        {
          gapId: "X1",
          sourceDocumentId: "11111111-1111-4111-8111-111111111111",
          studyRevisionId: revisionId,
          gapTitle: "Tax return",
          registeredAt: "2026-11-02T10:00:00.000Z",
        },
      ],
    });
    expect(summary.hasPendingUploads).toBe(true);
    expect(summary.uploadSlotCount).toBe(0);
    expect(summary.slots[0]!.uploadState).toBe("added_pending_rebuild");
  });
});

describe("filterActionableGaps", () => {
  it("drops gaps satisfied in a later accepted revision", () => {
    const prior = [gap({ id: "X1", title: "2025 federal income tax return" })];
    const next: import("./canonical-study-contracts").CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [{ sourceDocumentId: "d1", role: "SUPPORTING" as const, typeInPlainWords: "2025 federal income tax return", date: null, version: null, chainPosition: null }],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [],
    };
    const { gapIds, titles } = gapsSatisfiedInStudy(next, prior);
    const filtered = filterActionableGaps({ gaps: prior, satisfiedGapIds: gapIds, satisfiedTitles: titles });
    expect(filtered).toHaveLength(0);
  });
});
