/**
 * Separate entry so Vitest can mock this module and return a resolved Promise while production
 * keeps `import("./EvidencePdfPage")` as a separate chunk.
 */
export function loadEvidencePdfPage(): Promise<typeof import("./EvidencePdfPage")> {
  return import("./EvidencePdfPage");
}
