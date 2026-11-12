// @vitest-environment jsdom
import { buildMissingDocumentsSummary, CANONICAL_STUDY_SCHEMA, type CanonicalGap } from "@hiveforyou/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { bankruptcyC13Revision4Fixture, BANKRUPTCY_C13_REVISION_4_GAPS } from "./fixtures/bankruptcy-c13";
import { MissingDocumentsBanner } from "./MissingDocumentsBanner";

afterEach(cleanup);

describe("MissingDocumentsBanner", () => {
  it("shows open missing count and dismisses for the session", () => {
    const fixture = bankruptcyC13Revision4Fixture("CUSTOMER");
    const study = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: BANKRUPTCY_C13_REVISION_4_GAPS,
    };
    const summary = buildMissingDocumentsSummary(study);
    expect(summary.uploadSlotCount).toBe(4);
    expect(summary.courtRecordCount).toBe(3);
    expect(summary.futureRecordCount).toBe(2);

    render(<MissingDocumentsBanner hiveId={fixture.hiveId} summary={summary} />);
    expect(screen.getByTestId("missing-documents-banner").textContent).toContain("4 documents missing");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("missing-documents-banner")).toBeNull();
  });

  it("shows rebuild prompt when uploads are pending", () => {
    const gap: CanonicalGap = {
      id: "X1",
      statement: "",
      relatedSpineIds: [],
      kind: "REQUESTABLE_DOCUMENT",
      title: "Tax return",
      why: "",
      holder: "",
      holderType: "ASKER_OR_CLIENT",
      when: null,
      basisType: null,
      relatedFactIds: [],
    };
    const study = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [gap],
    };
    const revisionId = "dddddddd-0000-4000-8000-000000000001";
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
    render(<MissingDocumentsBanner hiveId="hive" summary={summary} onRebuild={() => undefined} />);
    expect(screen.getByTestId("missing-documents-banner").textContent).toContain("New documents added");
  });

  it("keeps a stable banner when summary props are unchanged across rerenders", async () => {
    sessionStorage.removeItem("hive.missing-docs-banner.dismissed:stable-banner-hive");
    const study = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: BANKRUPTCY_C13_REVISION_4_GAPS,
    };
    const summary = buildMissingDocumentsSummary(study);
    const { rerender } = render(<MissingDocumentsBanner hiveId="stable-banner-hive" summary={summary} />);
    expect(await screen.findByTestId("missing-documents-banner")).toBeTruthy();
    rerender(<MissingDocumentsBanner hiveId="stable-banner-hive" summary={summary} />);
    rerender(<MissingDocumentsBanner hiveId="stable-banner-hive" summary={summary} />);
    expect(screen.getAllByTestId("missing-documents-banner")).toHaveLength(1);
  });
});
