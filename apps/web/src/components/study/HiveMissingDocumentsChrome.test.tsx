// @vitest-environment jsdom
import { CANONICAL_STUDY_SCHEMA, type CanonicalGap } from "@hiveforyou/contracts";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchSourceDocuments = vi.hoisted(() => vi.fn());

vi.mock("@/lib/source-documents-client", () => ({
  fetchSourceDocuments,
}));

import { HiveMissingDocumentsChrome } from "./HiveMissingDocumentsChrome";

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

afterEach(() => {
  cleanup();
  fetchSourceDocuments.mockReset();
});

describe("HiveMissingDocumentsChrome", () => {
  beforeEach(() => {
    fetchSourceDocuments.mockResolvedValue({ sourceDocuments: [] });
  });

  it("fetches documents once when props are unchanged across rerenders", () => {
    const { rerender } = render(
      <HiveMissingDocumentsChrome hiveId="hive-1" canonicalStudy={study} fetchDocuments />,
    );
    rerender(<HiveMissingDocumentsChrome hiveId="hive-1" canonicalStudy={study} fetchDocuments />);
    rerender(<HiveMissingDocumentsChrome hiveId="hive-1" canonicalStudy={study} fetchDocuments />);
    expect(fetchSourceDocuments).toHaveBeenCalledTimes(1);
    expect(fetchSourceDocuments).toHaveBeenCalledWith("hive-1");
  });
});
