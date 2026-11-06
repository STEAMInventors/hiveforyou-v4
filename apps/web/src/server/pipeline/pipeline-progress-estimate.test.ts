import { describe, expect, it } from "vitest";

import { defaultPipelineThroughput } from "@hiveforyou/contracts";

import {
  buildProgressEstimate,
  buildReportRunProgressEstimate,
  computeProgressEstimateMs,
} from "./pipeline-progress-estimate";

describe("buildProgressEstimate", () => {
  const throughputs = {
    extract: defaultPipelineThroughput("extract"),
    canonicalize: defaultPipelineThroughput("canonicalize"),
    write: defaultPipelineThroughput("write"),
  };

  it("returns an estimate when history-backed work remains", () => {
    const nowMs = Date.now();
    const pages = [{ pageNumber: 1, text: "x".repeat(8000) }];
    const estimate = buildProgressEstimate({
      nowMs,
      run: { status: "EXTRACTING" },
      snapshot: {
        documents: [
          {
            sourceDocumentId: "aaaaaaaa-0000-4000-8000-000000000001",
            fileName: "a.pdf",
            mimeType: "application/pdf",
            sha256: "sha256:" + "a".repeat(64),
            readId: "bbbbbbbb-0000-4000-8000-000000000002",
            readStatus: "SUCCEEDED",
            readFingerprint: "fp",
            pageSetDigest: "sha256:" + "b".repeat(64),
            totalPhysicalPages: 1,
            verifiedPageCount: 1,
            missingPageNumbers: [],
            emptyPageNumbers: [],
            createdAt: "2026-11-05T00:00:00.000Z",
          },
        ],
        excluded: [],
        coverageComplete: true,
      },
      extractedDocumentIds: new Set(),
      savedRangeKeysByDocument: new Map(),
      pagesByDocument: new Map([["aaaaaaaa-0000-4000-8000-000000000001", pages]]),
      extractThroughput: throughputs.extract,
      canonicalizeThroughput: throughputs.canonicalize,
      writeThroughput: throughputs.write,
    });
    expect(estimate).not.toBeNull();
    expect(Date.parse(estimate!.estimatedCompletionAt)).toBeGreaterThan(nowMs);
  });

  it("returns null when everything finishes in seconds", () => {
    const nowMs = Date.now();
    expect(
      buildProgressEstimate({
        nowMs,
        run: { status: "SUCCEEDED" },
        snapshot: null,
        extractedDocumentIds: new Set(),
        savedRangeKeysByDocument: new Map(),
        pagesByDocument: new Map(),
        extractThroughput: throughputs.extract,
        canonicalizeThroughput: throughputs.canonicalize,
        writeThroughput: throughputs.write,
      }),
    ).toBeNull();
  });

  it("uses default throughput when no samples exist", () => {
    const remaining = computeProgressEstimateMs({
      nowMs: Date.now(),
      run: { status: "CANONICALIZING" },
      snapshot: {
        documents: [],
        excluded: [],
        coverageComplete: true,
      },
      extractedDocumentIds: new Set(["aaaaaaaa-0000-4000-8000-000000000001"]),
      savedRangeKeysByDocument: new Map(),
      pagesByDocument: new Map(),
      extractThroughput: throughputs.extract,
      canonicalizeThroughput: throughputs.canonicalize,
      writeThroughput: throughputs.write,
    });
    expect(remaining).toBeGreaterThan(0);
  });

  it("builds a report-run estimate while writing and omits it for quick finishes", () => {
    const nowMs = Date.now();
    const estimate = buildReportRunProgressEstimate({
      nowMs,
      status: "WRITING",
      writeThroughput: throughputs.write,
    });
    expect(estimate).not.toBeNull();
    expect(buildReportRunProgressEstimate({ nowMs, status: "SUCCEEDED", writeThroughput: throughputs.write })).toBeNull();
  });
});
