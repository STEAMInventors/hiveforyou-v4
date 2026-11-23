import { describe, expect, it } from "vitest";

import { EMPTY_OMNI_CATALOG, type OmniCatalog } from "@/lib/omni-catalog-model";
import { omniHits } from "@/lib/omni-catalog-search";

import {
  omniDocumentsFromLibraryRows,
  omniDocumentsFromWorkspace,
  omniOpenItemsFromChecklist,
  omniStatementsFromLegacyHomeTopics,
  omniStatementsFromTimeline,
  omniStatementsFromTopics,
  mergeOmniCatalog,
} from "./omni-catalog-build";

describe("omni-catalog-build", () => {
  it("indexes checklist gaps as open items", () => {
    const items = omniOpenItemsFromChecklist([
      {
        gapId: "g1",
        title: "Checking statements Apr–Jun 2023",
        status: "not_in",
        statusText: "Not in yet",
        action: { kind: "link", label: "Add it", href: "#" },
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Checking statements Apr–Jun 2023");
  });

  it("lets the box find home statements without a model call", () => {
    const catalog: OmniCatalog = mergeOmniCatalog({
      statements: omniStatementsFromTopics([
        {
          id: "t1",
          title: "Premiums",
          uncertain: false,
          statements: [
            {
              id: "s1",
              text: "The monthly premium for 2023 was $142.",
              values: [
                {
                  factId: "f1",
                  valueAsWritten: "$142",
                  sourceRef: { sourceDocumentId: "d1", pageNumber: 2, quote: "142" },
                },
              ],
            },
          ],
          openItems: [],
        },
      ]),
    });
    const hits = omniHits(catalog, "2023");
    expect(hits.some((hit) => hit.kind === "statement" && hit.statement.text.includes("2023"))).toBe(true);
    expect(EMPTY_OMNI_CATALOG.suggestions).toEqual([]);
  });

  it("indexes document file names (raw and underscore/hyphen-normalized) for legacy and canonical library rows", () => {
    const docs = omniDocumentsFromLibraryRows([
      {
        sourceDocumentId: "doc-legacy",
        fileName: "maya_annual_plan_2025.pdf",
        titleLine: "Document",
        typeLine: null,
        periodLabel: "—",
        pageCount: 6,
      },
      {
        sourceDocumentId: "doc-canonical",
        fileName: "Progress-Report-Nov2025.pdf",
        titleLine: "Annual progress report",
        typeLine: "Progress report",
        periodLabel: "Nov 2025",
        pageCount: 4,
      },
    ]);
    const catalog = mergeOmniCatalog({ documents: docs });

    expect(docs[0]!.role).toBe("maya annual plan 2025");
    expect(omniHits(catalog, "maya_annual_plan")).toHaveLength(1);
    expect(omniHits(catalog, "annual plan 2025")).toHaveLength(1);
    expect(omniHits(catalog, "Progress-Report-Nov2025")).toHaveLength(1);
    expect(omniHits(catalog, "progress report")).toHaveLength(1);
  });

  it("indexes authorized workspace documents, legacy Home statements, and timeline rows client-side", () => {
    const docs = omniDocumentsFromWorkspace({
      workspaceDocuments: [
        { sourceDocumentId: "d1", fileName: "maya_2024_w2.pdf" },
        { sourceDocumentId: "d2", fileName: "maya_2024_1040.pdf" },
      ],
      studyDocumentRows: [
        {
          id: "d1",
          typeInPlainWords: "Form W-2",
          status: "SUPPORTED",
          date: "2024",
          values: [],
        },
      ],
      documentPages: { d1: 2, d2: 5 },
    });
    const legacyStatements = omniStatementsFromLegacyHomeTopics([
      {
        id: "t1",
        title: "Income",
        uncertain: false,
        statements: [
          {
            id: "s1",
            text: "Gross wages totaled $142,500.",
            refs: [{ sourceDocumentId: "d1", pageNumber: 1, fileName: "maya_2024_w2.pdf", factId: "f1", quote: "" }],
          },
        ],
      },
    ]);
    const timelineStatements = omniStatementsFromTimeline([
      {
        id: "tl-1",
        date: "2025-03-04",
        statement: "Annual review meeting completed.",
        values: [
          {
            factId: "AV-T0-E0:r0",
            valueAsWritten: "maya_2024_1040.pdf",
            sourceRef: { sourceDocumentId: "d2", pageNumber: 2, quote: "" },
          },
        ],
      },
    ]);
    const catalog = mergeOmniCatalog({
      documents: docs,
      statements: [...legacyStatements, ...timelineStatements],
    });

    expect(omniHits(catalog, "maya_2024_w2").some((h) => h.kind === "document" && h.document.id === "d1")).toBe(true);
    expect(omniHits(catalog, "Form W-2").some((h) => h.kind === "document" && h.document.id === "d1")).toBe(true);
    expect(omniHits(catalog, "2024 1040").some((h) => h.kind === "document" && h.document.id === "d2")).toBe(true);
    expect(omniHits(catalog, "142,500").some((h) => h.kind === "statement")).toBe(true);
    expect(omniHits(catalog, "review meeting").some((h) => h.kind === "statement" && h.statement.pageLabel === "p.2")).toBe(true);
  });
});