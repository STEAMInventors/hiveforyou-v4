import { vi } from "vitest";

/**
 * pdf.js (via react-pdf) expects browser globals when test files import components that load it.
 */
if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {
      /* minimal stub for pdf.js side-effect imports in Vitest */
    }
  } as unknown as typeof DOMMatrix;
}

/** Side-effect CSS imports from react-pdf — Vite/Vitest otherwise blocks lazy-loaded EvidencePdfPage in jsdom. */
vi.mock("react-pdf/dist/Page/AnnotationLayer.css", () => ({}));
vi.mock("react-pdf/dist/Page/TextLayer.css", () => ({}));

/**
 * Dynamic `import("./EvidencePdfPage")` from the viewer does not settle in Vitest/jsdom; preload once and reuse.
 */
vi.mock("@/components/study/load-evidence-pdf-page", async () => {
  const { EvidencePdfPage } = await import("@/components/study/EvidencePdfPage");
  return {
    loadEvidencePdfPage: () => Promise.resolve({ EvidencePdfPage }),
  };
});
