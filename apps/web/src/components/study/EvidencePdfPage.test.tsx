// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";

import { EvidencePdfPage } from "./EvidencePdfPage";

const pdfMock = vi.hoisted(() => {
  const documentFileSpy = vi.fn();
  let simulateLoadError = false;
  const rendererCalls: unknown[] = [];
  return {
    documentFileSpy,
    rendererCalls,
    getSimulateLoadError: () => simulateLoadError,
    setSimulateLoadError: (value: boolean) => {
      simulateLoadError = value;
    },
  };
});

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" }, version: "5.0.0" },
  Document: (props: {
    file?: unknown;
    onLoadError?: (e: Error) => void;
    onLoadSuccess?: (d: { numPages: number }) => void;
    children?: React.ReactNode;
  }) => {
    const { file, onLoadError, onLoadSuccess, children } = props;
    pdfMock.documentFileSpy(file);
    useEffect(() => {
      if (pdfMock.getSimulateLoadError()) {
        onLoadError?.(new Error("worker 403"));
      } else {
        onLoadSuccess?.({ numPages: 3 });
      }
    }, [file, onLoadError, onLoadSuccess]);
    return <div data-testid="pdf-doc">{children}</div>;
  },
  Page: (props: {
    pageNumber?: number;
    onRenderSuccess?: () => void;
    onGetTextSuccess?: (p: { items: { str: string; hasEOL?: boolean }[] }) => void;
    customTextRenderer?: (args: { itemIndex: number; str: string }) => string;
  }) => {
    const { onRenderSuccess, onGetTextSuccess, customTextRenderer } = props;
    useEffect(() => {
      onGetTextSuccess?.({
        items: [{ str: "The fee is " }, { str: "$10.00" }, { str: " for service." }],
      });
      onRenderSuccess?.();
    }, [onRenderSuccess, onGetTextSuccess]);
    return (
      <div data-testid="pdf-page">
        {customTextRenderer
          ? customTextRenderer({ itemIndex: 1, str: "$10.00" })
          : null}
      </div>
    );
  },
}));

afterEach(() => {
  pdfMock.setSimulateLoadError(false);
  pdfMock.documentFileSpy.mockClear();
  cleanup();
});

const baseProps = {
  pageNumber: 1,
  quote: "The fee is $10.00 for service." as string | undefined,
  pageText: "The fee is $10.00 for service.",
  onHighlightStatus: () => undefined,
};

describe("EvidencePdfPage", () => {
  it("passes react-pdf Document file as { url } for an https signed URL string", () => {
    const signed = "https://storage.example.com/object/foo?token=secret";
    render(<EvidencePdfPage fileUrl={signed} {...baseProps} />);
    expect(pdfMock.documentFileSpy).toHaveBeenCalledWith({ url: signed });
  });

  it("keeps the same Document file object across parent re-renders when signedUrl is unchanged", () => {
    const signed = "https://storage.example.com/object/foo?token=secret";

    function Harness() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTick((n) => n + 1)}>
            rerender {tick}
          </button>
          <EvidencePdfPage fileUrl={signed} {...baseProps} />
        </>
      );
    }

    const view = render(<Harness />);
    fireEvent.click(view.getByRole("button", { name: /rerender/i }));
    fireEvent.click(view.getByRole("button", { name: /rerender/i }));
    fireEvent.click(view.getByRole("button", { name: /rerender/i }));

    expect(pdfMock.documentFileSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
    const files = pdfMock.documentFileSpy.mock.calls.map((call) => call[0]);
    for (let i = 1; i < files.length; i += 1) {
      expect(files[i]).toBe(files[0]);
    }
  });

  it("after a load error, shows fallback with Open the original and does not load again on re-render", async () => {
    pdfMock.setSimulateLoadError(true);
    const signed = "https://storage.example.com/object/foo?token=secret";
    const originalHref = "/api/v1/hives/h1/source-documents/d1/pages/1";

    function Harness() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTick((n) => n + 1)}>
            rerender {tick}
          </button>
          <EvidencePdfPage fileUrl={signed} {...baseProps} originalPageHref={originalHref} />
        </>
      );
    }

    const view = render(<Harness />);
    await waitFor(() => {
      expect(view.getByTestId("evidence-pdf-load-error")).toBeTruthy();
    });
    expect(view.queryByTestId("pdf-doc")).toBeNull();
    const link = view.getByTestId("evidence-pdf-open-original");
    expect(link.getAttribute("href")).toBe(originalHref);

    const callsAfterError = pdfMock.documentFileSpy.mock.calls.length;
    fireEvent.click(view.getByRole("button", { name: /rerender/i }));
    expect(pdfMock.documentFileSpy.mock.calls.length).toBe(callsAfterError);
    expect(view.queryByTestId("pdf-doc")).toBeNull();
  });

  it("emits highlight status after the text layer loads", async () => {
    const statuses: { kind: string }[] = [];
    render(
      <EvidencePdfPage
        fileUrl="https://storage.example.com/x"
        {...baseProps}
        onHighlightStatus={(s) => statuses.push(s)}
      />,
    );
    await waitFor(() => {
      expect(statuses.some((s) => s.kind === "exact")).toBe(true);
    });
  });

  it("customTextRenderer wraps matched text in escaped mark tags", async () => {
    const view = render(<EvidencePdfPage fileUrl="https://storage.example.com/x" {...baseProps} />);
    await waitFor(() => {
      expect(view.getByTestId("pdf-page").innerHTML).toContain("evidence-highlight");
    });
  });
});
