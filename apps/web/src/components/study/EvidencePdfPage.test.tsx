// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvidencePdfPage } from "./EvidencePdfPage";

afterEach(cleanup);

const documentFileSpy = vi.fn();

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" }, version: "5.0.0" },
  Document: (props: { file?: unknown }) => {
    documentFileSpy(props.file);
    return <div data-testid="pdf-doc" />;
  },
  Page: () => null,
}));

describe("EvidencePdfPage", () => {
  it("passes react-pdf Document file as { url } for an https signed URL string", () => {
    const signed = "https://storage.example.com/object/foo?token=secret";
    render(
      <EvidencePdfPage
        fileUrl={signed}
        pageNumber={1}
        quote="x"
        pageText="x"
        onHighlightStatus={() => undefined}
      />,
    );
    expect(documentFileSpy).toHaveBeenCalledWith({ url: signed });
  });
});
