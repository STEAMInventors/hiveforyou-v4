// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvidenceViewerProvider } from "./EvidenceViewer";
import { dedupeChipRefs, shortDocumentLabels, shortTypeChipLabels, shortTypeLabel, SourceChips } from "./SourceChip";

afterEach(cleanup);

export const pdfDocumentFileCalls: unknown[] = [];

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" }, version: "5.0.0" },
  Document: ({
    children,
    file,
    onLoadSuccess,
  }: {
    children?: ReactNode;
    file?: unknown;
    onLoadSuccess?: (d: { numPages: number }) => void;
  }) => {
    pdfDocumentFileCalls.push(file);
    queueMicrotask(() => onLoadSuccess?.({ numPages: 5 }));
    return <div data-testid="pdf-doc">{children}</div>;
  },
  Page: ({
    pageNumber = 1,
    onRenderSuccess,
    onGetTextSuccess,
    customTextRenderer,
  }: {
    pageNumber?: number;
    onRenderSuccess?: () => void;
    onGetTextSuccess?: (payload: { items: { str: string; hasEOL?: boolean }[] }) => void;
    customTextRenderer?: (args: { itemIndex: number; str: string }) => string;
  }) => {
    const items =
      pageNumber !== 2
        ? [
            { str: "The fee is " },
            { str: "$10.00", hasEOL: true as const },
            { str: " for service." },
          ]
        : [
            { str: "Speech-Language Therapy" },
            { str: "60 min/week" },
            { str: "Therapy room" },
          ];
    useEffect(() => {
      queueMicrotask(() => {
        onGetTextSuccess?.({ items });
        onRenderSuccess?.();
      });
    }, [onRenderSuccess, onGetTextSuccess, pageNumber]);
    return (
      <div className="react-pdf__Page">
        <div className="react-pdf__Page__textContent">
          {items.map((item, itemIndex) => (
            <span
              key={itemIndex}
              dangerouslySetInnerHTML={{
                __html: customTextRenderer?.({ itemIndex, str: item.str }) ?? item.str,
              }}
            />
          ))}
        </div>
      </div>
    );
  },
}));

const HIVE = "11111111-1111-4111-8111-111111111111";
const DOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function mockFetchSequence(steps: Array<Response | (() => Response)>) {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const step = steps[i];
      if (i < steps.length) {
        i += 1;
        return typeof step === "function" ? step() : step;
      }
      /* react-pdf may fetch the signed PDF URL after our API calls; a resolved empty body avoids hanging. */
      return new Response(new Uint8Array([]), { status: 200, headers: { "Content-Type": "application/pdf" } });
    }),
  );
}

beforeEach(() => {
  pdfDocumentFileCalls.length = 0;
  vi.unstubAllGlobals();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  if (typeof Element !== "undefined") {
    Element.prototype.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 200,
        height: 16,
        right: 200,
        bottom: 16,
        x: 0,
        y: 0,
        toJSON: () => "",
      }) as DOMRect;
  }
});

describe("shortTypeLabel", () => {
  it.each([
    ["Repayment plan", "Repayment plan"],
    ["Repayment plan, first amended", "Repayment plan (amended)"],
    ["The water bill", "Water bill"],
    ["Plan dated April 10, 2026", "Plan"],
    ["March 2026 statement", "Statement"],
    ["Statement for July 2026", "Statement"],
    ["Petition and supporting schedules", "Petition"],
    ["Trustee's objection to the plan", "Trustee's objection"],
    ["Renters insurance renewal notice", "Insurance renewal notice"],
    ["Notice of hearing", "Notice of hearing"],
    ["meeting summary (draft)", "Meeting summary"],
    ["", ""],
    ["The", ""],
  ])("%j -> %j", (input, expected) => {
    expect(shortTypeLabel(input)).toBe(expected);
  });

  it("never returns more than three words", () => {
    expect(shortTypeLabel("Quarterly utility usage summary report").split(" ")).toHaveLength(3);
  });
});

describe("shortTypeChipLabels", () => {
  it("uses short type only and numbers when two share the same type", () => {
    const labels = shortTypeChipLabels([
      { sourceDocumentId: "a", typeInPlainWords: "March 2026 statement", date: null },
      { sourceDocumentId: "b", typeInPlainWords: "July 2026 statement", date: null },
    ]);
    expect([...labels.values()]).toEqual(["Statement · 1", "Statement · 2"]);
  });
});

describe("shortDocumentLabels", () => {
  it("adds month and year when two documents share a label, and falls back to Document", () => {
    const labels = shortDocumentLabels([
      { sourceDocumentId: "a", typeInPlainWords: "Plan", date: "2026-03-02" },
      { sourceDocumentId: "b", typeInPlainWords: "Plan, amended", date: "2026-04-28" },
      { sourceDocumentId: "c", typeInPlainWords: "Letter", date: null },
      { sourceDocumentId: "d", typeInPlainWords: "", date: null },
    ]);
    expect([...labels.values()]).toEqual(["Plan", "Plan (amended)", "Letter", "Document"]);
  });

  it("numbers documents that still share a label after the date is added", () => {
    const labels = shortDocumentLabels([
      { sourceDocumentId: "a", typeInPlainWords: "Invoice", date: "2026-08-01" },
      { sourceDocumentId: "b", typeInPlainWords: "Invoice", date: "2026-08-20" },
      { sourceDocumentId: "c", typeInPlainWords: "Invoice", date: null },
      { sourceDocumentId: "d", typeInPlainWords: "Invoice", date: null },
    ]);
    expect([...labels.values()]).toEqual(["Invoice · Aug 2026 · 1", "Invoice · Aug 2026 · 2", "Invoice · 1", "Invoice · 2"]);
  });
});

describe("dedupeChipRefs", () => {
  it("keeps one chip per document and page, merging distinct quotes and fact ids, and drops invalid pages", () => {
    expect(
      dedupeChipRefs([
        { sourceDocumentId: "a", pageNumber: 2, quote: "first", factIds: ["F1"] },
        { sourceDocumentId: "b", pageNumber: 2 },
        { sourceDocumentId: "a", pageNumber: 2, quote: "second", factIds: ["F2"] },
        { sourceDocumentId: "a", pageNumber: 2, quote: "first" },
        { sourceDocumentId: "a", pageNumber: 0 },
      ]),
    ).toEqual([
      { sourceDocumentId: "a", pageNumber: 2, quote: "first\nsecond", factIds: ["F1", "F2"] },
      { sourceDocumentId: "b", pageNumber: 2 },
    ]);
  });
});

describe("SourceChips + evidence viewer", () => {
  it("opens the in-app drawer, requests text before signed URL, Esc returns focus; highlights when quote matches page text", async () => {
    const signed = "https://storage.example.com/signed";
    mockFetchSequence([
      Response.json({
        pageText: "The fee is $10.00 for service.",
        mimeType: "application/pdf",
        pageCount: 3,
        extractionMethod: "pdf_native",
        pageNumber: 3,
      }),
      Response.json({ signedUrl: signed, mimeType: "application/pdf" }),
    ]);
    render(
      <EvidenceViewerProvider hiveId={HIVE} labels={new Map([[DOC, "Plan · Mar 2026"]])} pageCountFor={() => 3} citationContexts={new Map()}>
        <p>
          A sentence.{" "}
          <SourceChips
            refs={[
              { sourceDocumentId: DOC, pageNumber: 3, quote: "The fee is $10.00 for service." },
            ]}
          />
        </p>
      </EvidenceViewerProvider>,
    );
    const chips = screen.getAllByTestId("source-chip");
    expect(chips[0]!.tagName).toBe("BUTTON");
    expect(within(chips[0]!).getByTestId("hive-mark")).toBeTruthy();
    expect(screen.queryByText(/02_plan\.pdf/)).toBeNull();

    fireEvent.click(chips[0]!);

    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const calls = vi.mocked(fetch).mock.calls as [string, RequestInit | undefined][];
    expect(calls[0]![0]).toContain(`/api/v1/hives/${HIVE}/source-documents/${DOC}/pages/3/text`);
    expect(calls[1]![0]).toContain(`/api/v1/hives/${HIVE}/source-documents/${DOC}/viewer-open`);
    expect(calls[1]![1]?.method).toBe("POST");
    expect(JSON.parse((calls[1]![1]?.body as string) ?? "{}")).toEqual({ pageNumber: 3 });

    const viewer = screen.getByTestId("evidence-viewer");
    const original = within(viewer).getByRole("link", { name: /Open the original/i });
    expect(original.getAttribute("href")).toBe(`/api/v1/hives/${HIVE}/source-documents/${DOC}/pages/3`);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-doc")).toBeTruthy();
    });
    expect(pdfDocumentFileCalls.some((f) => f && typeof f === "object" && (f as { url?: string }).url === signed)).toBe(true);
    await waitFor(() => {
      expect(document.querySelectorAll(".evidence-highlight").length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId("evidence-highlight-status").textContent).toMatch(/Highlighted on page 3/);
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/Highlighted on page 3/);
    });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("evidence-viewer")).toBeNull();
    expect(document.activeElement).toBe(chips[0]);
  });

  it("shows not-found status for PDF when quote does not match persisted text", async () => {
    mockFetchSequence([
      Response.json({
        pageText: "Different text on the page.",
        mimeType: "application/pdf",
        pageCount: 1,
        extractionMethod: "pdf_native",
        pageNumber: 1,
      }),
      Response.json({ signedUrl: "https://x/s", mimeType: "application/pdf" }),
    ]);
    render(
      <EvidenceViewerProvider hiveId={HIVE} labels={new Map([[DOC, "Doc"]])} citationContexts={new Map()}>
        <SourceChips refs={[{ sourceDocumentId: DOC, pageNumber: 1, quote: "Not on page" }]} />
      </EvidenceViewerProvider>,
    );
    fireEvent.click(screen.getByTestId("source-chip"));
    await waitFor(() => {
      expect(screen.getByTestId("evidence-highlight-status").textContent).toMatch(/Couldn't find this passage/);
    });
  });

  it("table-row quote with | highlights each cell when all cells appear in page text", async () => {
    mockFetchSequence([
      Response.json({
        pageText: "Service        Amount          Location\nSpeech-Language Therapy   60 min/week   Therapy room",
        mimeType: "application/pdf",
        pageCount: 2,
        extractionMethod: "pdf_native",
        pageNumber: 2,
      }),
      Response.json({ signedUrl: "https://x/s", mimeType: "application/pdf" }),
    ]);
    render(
      <EvidenceViewerProvider hiveId={HIVE} labels={new Map([[DOC, "Doc"]])} citationContexts={new Map()}>
        <SourceChips
          refs={[{ sourceDocumentId: DOC, pageNumber: 2, quote: "Speech-Language Therapy | 60 min/week | Therapy room" }]}
        />
      </EvidenceViewerProvider>,
    );
    fireEvent.click(screen.getByTestId("source-chip"));
    await waitFor(() => {
      expect(document.querySelectorAll(".evidence-highlight").length).toBeGreaterThan(0);
    });
  });
});
