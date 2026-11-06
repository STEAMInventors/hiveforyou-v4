/** Vitest resolves `import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs"` without webpack asset rules. */
const vitestPdfWorkerStubUrl = "/_vitest_/pdf.worker.min.mjs";
export default vitestPdfWorkerStubUrl;
