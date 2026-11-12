import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalGap } from "./canonical-study-contracts";
import {
  dropGapsFilledByUpload,
  filledGapTitles,
  gapUploadMatchesSlot,
  normalizeGapTitle,
  parseGapFillLinks,
} from "./gap-fill";
import { buildMissingDocumentsSummary, parseGapUploadLinks } from "./missing-documents";

const REV4 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REV5 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAY_STUBS_DOC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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

describe("normalizeGapTitle", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalizeGapTitle("  Pay   Stubs  ")).toBe("pay stubs");
  });
});

describe("dropGapsFilledByUpload", () => {
  const filledTitle = "Pay stubs (March–April 2026)";
  const links = parseGapFillLinks([
    {
      id: PAY_STUBS_DOC,
      canonicalGapId: "X3",
      canonicalGapStudyRevisionId: REV4,
      canonicalGapTitle: filledTitle,
    },
  ]);

  it("rev 4 gap X3 filled by upload; rev 5 renumbers gaps — filled gap drops, others remain", () => {
    const study = {
      schema: "hive.canonical-study/1" as const,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [
        gap({ id: "X1", title: "Tax return" }),
        gap({ id: "X2", title: "Schedule D" }),
        gap({ id: "X5", title: filledTitle }),
        gap({ id: "X6", title: "Bank statements (plan payments)" }),
      ],
    };
    const next = dropGapsFilledByUpload(study, filledGapTitles(links));
    expect(next.gaps.map((g) => g.id)).toEqual(["X1", "X2", "X6"]);
  });

  it("does not drop gaps that merely share an old id with the upload link", () => {
    const study = {
      schema: "hive.canonical-study/1" as const,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [
        gap({ id: "X3", title: "Unrelated document" }),
        gap({ id: "X4", title: filledTitle }),
      ],
    };
    const next = dropGapsFilledByUpload(study, filledGapTitles(links));
    expect(next.gaps.map((g) => g.id)).toEqual(["X3"]);
  });
});

describe("gapUploadMatchesSlot", () => {
  const slot = { gapId: "X5", title: "Pay stubs (March–April 2026)" };
  const link = parseGapUploadLinks([
    {
      id: PAY_STUBS_DOC,
      canonicalGapId: "X3",
      canonicalGapStudyRevisionId: REV4,
      canonicalGapTitle: "Pay stubs (March–April 2026)",
    },
  ])[0]!;

  it("matches by title after revision renumber", () => {
    expect(gapUploadMatchesSlot(link, slot, REV5)).toBe(true);
  });

  it("matches by id only on the same accepted revision", () => {
    const sameRevSlot = { gapId: "X3", title: "Pay stubs (March–April 2026)" };
    expect(gapUploadMatchesSlot(link, sameRevSlot, REV4)).toBe(true);
    expect(gapUploadMatchesSlot(link, { gapId: "X3", title: "Different title" }, REV5)).toBe(false);
  });
});

describe("missing documents summary with stable gap links", () => {
  it("marks the renumbered slot as added pending rebuild via title", () => {
    const study = {
      schema: "hive.canonical-study/1" as const,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [gap({ id: "X5", title: "Pay stubs (March–April 2026)" })],
    };
    const summary = buildMissingDocumentsSummary(study, [], {
      acceptedStudyRevisionId: REV5,
      gapUploads: parseGapUploadLinks([
        {
          id: PAY_STUBS_DOC,
          canonicalGapId: "X3",
          canonicalGapStudyRevisionId: REV4,
          canonicalGapTitle: "Pay stubs (March–April 2026)",
        },
      ]),
    });
    expect(summary.hasPendingUploads).toBe(true);
    expect(summary.slots[0]?.uploadState).toBe("added_pending_rebuild");
    expect(summary.slots[0]?.gapId).toBe("X5");
  });
});
