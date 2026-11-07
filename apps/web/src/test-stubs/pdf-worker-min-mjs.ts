/** Vitest resolves `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` without bundler worker assets. */
const vitestPdfWorkerStubUrl = "/_vitest_/pdf.worker.min.mjs";
export default vitestPdfWorkerStubUrl;
