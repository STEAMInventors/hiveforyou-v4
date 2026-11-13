import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "./canonical-study-contracts";
import { primarySubjectFirstName } from "./primary-subject";
import type { WriteFactRecord } from "./study-view-contracts";

const study = (documents: CanonicalStudy["documents"]): CanonicalStudy => ({
  schema: CANONICAL_STUDY_SCHEMA,
  domainLabel: "case",
  spineSource: "ANCHOR",
  documents,
  spine: [],
  outsideSpine: [],
  conflicts: [],
  timeline: [],
  gaps: [],
});

describe("primarySubjectFirstName", () => {
  const anchor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const supporting = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

  it("uses the anchor document subject, not referral or document type words", () => {
    const canonical = study([
      {
        sourceDocumentId: supporting,
        role: "SUPPORTING",
        typeInPlainWords: "Initial referral",
        date: null,
        version: null,
        chainPosition: null,
      },
      {
        sourceDocumentId: anchor,
        role: "ANCHOR",
        typeInPlainWords: "Initial individualized education program",
        date: "2024-11-12",
        version: null,
        chainPosition: 1,
      },
    ]);
    const facts: WriteFactRecord[] = [
      {
        id: "F1",
        sourceDocumentId: supporting,
        pageNumber: 1,
        quote: "q",
        valueAsWritten: "x",
        subject: "Referral",
        attribute: "concern",
      },
      {
        id: "F2",
        sourceDocumentId: anchor,
        pageNumber: 1,
        quote: "q",
        valueAsWritten: "x",
        subject: "Maya Carter",
        attribute: "goal",
      },
      {
        id: "F3",
        sourceDocumentId: anchor,
        pageNumber: 2,
        quote: "q",
        valueAsWritten: "x",
        subject: "Maya",
        attribute: "service",
      },
    ];
    expect(primarySubjectFirstName(canonical, facts)).toBe("Maya");
  });

  it("returns null when the anchor names no person", () => {
    const canonical = study([
      {
        sourceDocumentId: anchor,
        role: "ANCHOR",
        typeInPlainWords: "Plan",
        date: null,
        version: null,
        chainPosition: null,
      },
    ]);
    const facts: WriteFactRecord[] = [
      {
        id: "F1",
        sourceDocumentId: anchor,
        pageNumber: 1,
        quote: "q",
        valueAsWritten: "x",
        subject: "Fee",
        attribute: "amount",
      },
    ];
    expect(primarySubjectFirstName(canonical, facts)).toBeNull();
  });
});
