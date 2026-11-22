import { buildStudyViewSources } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { buildHiveEvidenceViewerModel } from "./hive-evidence-model";

const DOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("buildHiveEvidenceViewerModel", () => {
  it("uses studyViewSources.documents when the view has no documents block (legacy pinned reports)", () => {
    const view = {
      schema: "hive.study-view/1" as const,
      sections: [
        {
          title: "Reading",
          paragraphs: [{ sentences: [{ text: "Maya read 74 wcpm.", factIds: ["f1"] }] }],
        },
      ],
      blocks: [],
      components: [],
    };
    const sources = {
      documents: {
        [DOC_A]: {
          fileName: "Progress report Nov 2025.pdf",
          typeInPlainWords: "IEP progress report, November 2025",
        },
      },
      facts: {
        f1: { sourceDocumentId: DOC_A, pageNumber: 1, quote: "74 words correct per minute" },
      },
    };
    const model = buildHiveEvidenceViewerModel({ view, sources, canonicalStudy: null, documentPages: {} });
    expect(model).not.toBeNull();
    const label = model!.labels.get(DOC_A.toLowerCase()) ?? model!.labels.get(DOC_A);
    expect(label).toMatch(/progress report/i);
    expect(label).not.toBe("Document");
  });

  it("builds citation context when source document ids differ only by case", () => {
    const view = {
      schema: "hive.study-view/1" as const,
      sections: [
        {
          title: "Summary",
          paragraphs: [
            {
              sentences: [{ text: "Maya read 74 words per minute.", factIds: ["f1"] }],
            },
          ],
        },
      ],
      blocks: [],
      components: [],
    };
    const sources = {
      documents: {
        [DOC_A]: { fileName: "Progress report Nov 2025.pdf", typeInPlainWords: "IEP progress report" },
      },
      facts: {
        f1: {
          sourceDocumentId: DOC_A.toUpperCase(),
          pageNumber: 1,
          quote: "74 words correct per minute",
        },
      },
    };
    const model = buildHiveEvidenceViewerModel({ view, sources, canonicalStudy: null });
    expect(model).not.toBeNull();
    const key = `${DOC_A.toLowerCase()}:1`;
    expect(model!.citationContexts.get(key)?.length).toBeGreaterThan(0);
  });

  it("returns null when view is absent", () => {
    expect(buildHiveEvidenceViewerModel({ view: null, sources: null, canonicalStudy: null })).toBeNull();
  });

  it("includes fact-only document ids in label numbering", () => {
    const sources = buildStudyViewSources(
      {
        schema: "hive.study-view/1",
        sections: [{ title: "S", paragraphs: [{ sentences: [{ text: "A", factIds: ["f1"] }] }] }],
        blocks: [],
      },
      [
        {
          id: "f1",
          subject: "a",
          attribute: "x",
          valueAsWritten: "a",
          sourceDocumentId: DOC_A,
          pageNumber: 1,
          quote: "quote a",
        },
        {
          id: "f2",
          subject: "b",
          attribute: "x",
          valueAsWritten: "b",
          sourceDocumentId: DOC_B,
          pageNumber: 1,
          quote: "quote b",
        },
      ],
      new Map(),
    );
    const view = {
      schema: "hive.study-view/1" as const,
      sections: [
        {
          title: "S",
          paragraphs: [
            {
              sentences: [
                { text: "First", factIds: ["f1"] },
                { text: "Second", factIds: ["f2"] },
              ],
            },
          ],
        },
      ],
      blocks: [],
    };
    const model = buildHiveEvidenceViewerModel({
      view,
      sources: { ...sources, documents: {} },
      canonicalStudy: null,
    });
    expect(model!.chipLabels.get(DOC_A.toLowerCase()) ?? model!.chipLabels.get(DOC_A)).toMatch(/Document/);
  });
});