import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalGap } from "./canonical-study-contracts";
import { assignCanonicalGapHolderTypes, inferGapHolderType } from "./canonical-gap-holders";

const gap = (partial: Partial<CanonicalGap> & Pick<CanonicalGap, "id" | "statement">): CanonicalGap => ({
  relatedSpineIds: [],
  kind: "REQUESTABLE_DOCUMENT",
  title: "",
  why: "",
  holder: "",
  holderType: null,
  when: null,
  basisType: null,
  relatedFactIds: [],
  ...partial,
});

describe("inferGapHolderType", () => {
  it("classifies proofs of claim as COURT_RECORD", () => {
    expect(
      inferGapHolderType(
        gap({
          id: "X1",
          statement: "Proof of claim missing",
          title: "Cobalt Ridge proof of claim",
          holder: "Claims register",
        }),
      ),
    ).toBe("COURT_RECORD");
  });

  it("classifies client-held tax records as ASKER_OR_CLIENT", () => {
    expect(
      inferGapHolderType(
        gap({
          id: "X2",
          statement: "Tax return",
          title: "2025 federal income tax return",
          holder: "Client or tax preparer",
        }),
      ),
    ).toBe("ASKER_OR_CLIENT");
  });
});

describe("assignCanonicalGapHolderTypes", () => {
  it("assigns holder types on every requestable gap", () => {
    const study = assignCanonicalGapHolderTypes({
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [
        gap({ id: "X1", statement: "Proof of claim on register", title: "Harborline proof of claim", holder: "" }),
        gap({ id: "X2", statement: "Tax return", title: "2025 return", holder: "Client" }),
      ],
    });
    expect(study.gaps[0]!.holderType).toBe("COURT_RECORD");
    expect(study.gaps[1]!.holderType).toBe("ASKER_OR_CLIENT");
  });
});
