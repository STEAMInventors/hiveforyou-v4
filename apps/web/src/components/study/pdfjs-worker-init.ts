"use client";

import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs";
import { pdfjs } from "react-pdf";

/**
 * Vitest aliases the worker to a stub path and mocks `react-pdf`; do not override `workerSrc` there
 * or pdf.js may try to fetch a non-existent worker and block the dynamic import.
 */
if (typeof window !== "undefined" && !String(workerUrl).includes("/_vitest_/")) {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
}
