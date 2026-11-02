import { describe, expect, it } from "vitest";

import {
  EXECUTION_MANIFEST_SCHEMA,
  SOURCE_PAGES_FORMAT,
  SOURCE_PAGES_PLACEHOLDER,
  STUDY_INVESTIGATION_SCHEMA,
  validateExecutionManifest,
} from "./execution-manifest-contracts";

const D = (c: string) => `sha256:${c.repeat(64)}`;

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema: EXECUTION_MANIFEST_SCHEMA,
    prompt: {
      id: "hive-study-preview/1",
      version: "1",
      templateDigest: D("1"),
      promptDigest: D("2"),
      componentPrompts: [{ id: "hive-plan/1", digest: D("3") }],
    },
    outputContract: { id: STUDY_INVESTIGATION_SCHEMA, schemaDigest: D("4") },
    processingRunId: "55555555-5555-4555-8555-555555555555",
    requiredInputs: {
      intentRequests: { intentRequestIds: ["11111111-1111-4111-8111-111111111111"], intentSnapshotDigest: D("5") },
      sourceDocuments: {
        sourceSnapshotDigest: D("6"),
        documents: [
          {
            sourceDocumentId: "33333333-3333-4333-8333-333333333333",
            fileName: "lease.pdf",
            sha256: "b".repeat(64),
            readFingerprint: "reader-document-read@1:x",
            pageSetDigest: D("7"),
            readStatus: "SUCCEEDED",
            totalPhysicalPages: 2,
            authorizedPageNumbers: [1, 2],
          },
        ],
      },
      investigationPlan: { schema: "hive.investigation-plan/1", planDigest: D("8"), questionIds: ["P1"] },
    },
    bindings: [
      { placeholder: SOURCE_PAGES_PLACEHOLDER, input: "sourceDocuments", format: SOURCE_PAGES_FORMAT, rule: "x" },
    ],
    coverage: { complete: true, coverageDigest: D("9"), excludedDocuments: [], missingPages: [], emptyPages: [] },
    limits: { authorizedPageCount: 2, maxOutputTokensAdvisory: 8000 },
    ...overrides,
  };
}

describe("validateExecutionManifest", () => {
  it("accepts a complete manifest", () => {
    expect(validateExecutionManifest(manifest()).ok).toBe(true);
  });

  it("rejects a manifest without the source pages binding or source documents", () => {
    expect(validateExecutionManifest(manifest({ bindings: [] }))).toMatchObject({
      ok: false,
      diagnosticReason: "manifest_bindings",
    });
    const base = manifest();
    expect(
      validateExecutionManifest({
        ...base,
        requiredInputs: { ...base.requiredInputs, sourceDocuments: { sourceSnapshotDigest: D("6"), documents: [] } },
      }),
    ).toMatchObject({ ok: false, diagnosticReason: "manifest_required_inputs" });
  });

  it("rejects an unknown output contract", () => {
    expect(
      validateExecutionManifest(manifest({ outputContract: { id: "hive.doc-extraction/1", schemaDigest: D("4") } })),
    ).toMatchObject({ ok: false, diagnosticReason: "manifest_output_contract" });
  });
});
