import type { SourceDocument } from "@hiveforyou/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HiveClientError } from "@/lib/hives-client";

const client = vi.hoisted(() => ({
  uploadSourceDocument: vi.fn(),
}));

vi.mock("@/lib/source-documents-client", () => client);

import {
  hasUploadableFiles,
  MAX_FILES_PER_BATCH,
  toSelectedSourceFiles,
  uploadSelectedSourceFiles,
  type SelectedSourceFile,
} from "./source-file-upload";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

function sourceDocument(overrides: Partial<SourceDocument>): SourceDocument {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    hiveId: HIVE_ID,
    fileName: "notes.pdf",
    mimeType: "application/pdf",
    byteSize: 4,
    status: "REGISTERED",
    failureReason: null,
    scanStatus: "UNKNOWN_TO_SCANNER",
    readStatus: "PENDING",
    registeredAt: "2026-10-30T00:00:00.000Z",
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
    ...overrides,
  } as SourceDocument;
}

function clientError(errorCode: string): HiveClientError {
  return new HiveClientError({
    message: "Safe message.",
    errorCode,
    retryable: errorCode !== "QUOTA_EXCEEDED",
    correlationId: "33333333-3333-4333-8333-333333333333",
    status: errorCode === "QUOTA_EXCEEDED" ? 409 : 503,
  });
}

async function run(files: SelectedSourceFile[]) {
  const states = new Map<string, string>();
  const result = await uploadSelectedSourceFiles(HIVE_ID, files, (key, patch) => {
    if (patch.state) states.set(key, patch.state);
  });
  return { ...result, states };
}

describe("source file upload batch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("caps each client batch independently of the monthly upload quota", () => {
    expect(MAX_FILES_PER_BATCH).toBe(25);
  });

  it("blocks submission when any selected file is invalid", () => {
    const files = toSelectedSourceFiles([
      new File(["%PDF"], "notes.pdf"),
      new File(["x"], "script.exe"),
    ]);
    expect(files.map((item) => item.state)).toEqual(["ready", "invalid"]);
    expect(hasUploadableFiles(files)).toBe(false);
    expect(hasUploadableFiles([])).toBe(false);
  });

  it("settles when every file is registered or definitively rejected", async () => {
    client.uploadSourceDocument
      .mockResolvedValueOnce({ sourceDocument: sourceDocument({ status: "REGISTERED" }) })
      .mockResolvedValueOnce({
        sourceDocument: sourceDocument({ status: "REJECTED", failureReason: "TYPE_MISMATCH" }),
      });
    const files = toSelectedSourceFiles([
      new File(["%PDF"], "a.pdf"),
      new File(["%PDF"], "b.pdf"),
    ]);

    const { allSettled, states } = await run(files);

    expect(allSettled).toBe(true);
    expect(files.map((item) => states.get(item.key))).toEqual(["registered", "rejected"]);
    expect(client.uploadSourceDocument).toHaveBeenCalledTimes(2);
  });

  it("treats quota exhaustion as settled but transient failures as retryable", async () => {
    client.uploadSourceDocument.mockRejectedValueOnce(clientError("QUOTA_EXCEEDED"));
    const quotaFiles = toSelectedSourceFiles([new File(["%PDF"], "a.pdf")]);
    const quota = await run(quotaFiles);
    expect(quota.allSettled).toBe(true);
    expect(quota.states.get(quotaFiles[0]!.key)).toBe("rejected");

    client.uploadSourceDocument.mockRejectedValueOnce(clientError("SERVICE_UNAVAILABLE"));
    const transientFiles = toSelectedSourceFiles([new File(["%PDF"], "b.pdf")]);
    const transient = await run(transientFiles);
    expect(transient.allSettled).toBe(false);
    expect(transient.states.get(transientFiles[0]!.key)).toBe("failed");
  });

  it("skips files that already settled on a retry", async () => {
    const [done] = toSelectedSourceFiles([new File(["%PDF"], "a.pdf")]);
    const { allSettled } = await run([{ ...done!, state: "registered" }]);
    expect(allSettled).toBe(true);
    expect(client.uploadSourceDocument).not.toHaveBeenCalled();
  });
});
