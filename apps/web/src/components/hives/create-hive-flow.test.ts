import {
  HIVE_NAME_MAX_LENGTH,
  INTENT_AUDIENCE_MAX_LENGTH,
  INTENT_TEXT_MAX_LENGTH,
  type Hive,
} from "@hiveforyou/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HiveClientError } from "@/lib/hives-client";

import {
  provisionalHiveName,
  runCreateHiveFlow,
  validateComposerDraft,
  validateHiveName,
  type CreateHiveFlowDeps,
  type CreateHiveFlowInput,
} from "./create-hive-flow";
import { toSelectedSourceFiles, type SelectedSourceFile } from "./source-file-upload";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const HIVE_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const INTENT_REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const CORRELATION_ID = "44444444-4444-4444-8444-444444444444";

const HIVE: Hive = {
  id: HIVE_ID,
  hiveId: HIVE_ID,
  name: "Prepare for an IEP meeting",
  description: null,
  clientRequestId: HIVE_REQUEST_ID,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

function clientError(errorCode: string, message: string, retryable = true): HiveClientError {
  return new HiveClientError({
    message,
    errorCode,
    retryable,
    correlationId: CORRELATION_ID,
    status: errorCode === "NOT_FOUND" ? 404 : 503,
  });
}

function pdf(name = "notes.pdf"): File {
  return new File(["%PDF-1.7"], name);
}

describe("validateComposerDraft", () => {
  it("requires written intent and at least one document", () => {
    expect(validateComposerDraft({ intentText: "   ", files: [] })).toEqual({
      ok: false,
      intentError: "Describe what you're trying to get done.",
      filesError: "Add at least one document — PDF, PNG, JPG or DOCX, up to 25 MB each.",
    });
  });

  it("rejects intent longer than the contract limit", () => {
    const result = validateComposerDraft({
      intentText: "a".repeat(INTENT_TEXT_MAX_LENGTH + 1),
      files: toSelectedSourceFiles([pdf()]),
    });
    expect(result.ok).toBe(false);
    expect(result.intentError).toBe(`Keep this to ${INTENT_TEXT_MAX_LENGTH} characters or fewer.`);
    expect(result.filesError).toBeNull();
  });

  it("blocks unsupported attachments even when a valid one is present", () => {
    const files = toSelectedSourceFiles([pdf(), new File(["MZ"], "setup.exe")]);
    const result = validateComposerDraft({ intentText: "Reconcile statements", files });
    expect(result).toEqual({
      ok: false,
      intentError: null,
      filesError: "Remove the files that aren't supported.",
    });
  });

  it("accepts intent plus a supported document", () => {
    const files = toSelectedSourceFiles([pdf(), new File(["x"], "scan.docx")]);
    expect(validateComposerDraft({ intentText: " Review my claim ", files }).ok).toBe(true);
  });

  it("accepts an optional audience within the contract limit", () => {
    const files = toSelectedSourceFiles([pdf()]);
    expect(validateComposerDraft({ intentText: "Review my claim", audience: "My adjuster", files }).ok).toBe(true);
    const result = validateComposerDraft({
      intentText: "Review my claim",
      audience: "a".repeat(INTENT_AUDIENCE_MAX_LENGTH + 1),
      files,
    });
    expect(result.ok).toBe(false);
    expect(result.intentError).toBe(`Keep who this is for to ${INTENT_AUDIENCE_MAX_LENGTH} characters or fewer.`);
  });
});

describe("validateHiveName", () => {
  it("requires a non-empty trimmed name within the limit", () => {
    expect(validateHiveName("   ")).toEqual({
      ok: false,
      error: "Give your Hive a name so you can find it later.",
    });
    expect(validateHiveName("March records")).toEqual({ ok: true, value: "March records" });
    expect(validateHiveName("a".repeat(HIVE_NAME_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: `Hive name must be ${HIVE_NAME_MAX_LENGTH} characters or fewer.`,
    });
  });
});

describe("provisionalHiveName", () => {
  it("uses short intent verbatim", () => {
    expect(provisionalHiveName("Prepare for an IEP meeting")).toBe("Prepare for an IEP meeting");
  });

  it("collapses whitespace, strips trailing punctuation and capitalizes the first letter", () => {
    expect(provisionalHiveName("  review   my\ninsurance claim!!  ")).toBe("Review my insurance claim");
  });

  it("takes the first sentence of a longer intent", () => {
    expect(
      provisionalHiveName("Help with my mother's Medicaid file. There are five years of statements."),
    ).toBe("Help with my mother's Medicaid file");
  });

  it("keeps the whole text when the first sentence is too short to name anything", () => {
    expect(provisionalHiveName("Hi. Sort these receipts")).toBe("Hi. Sort these receipts");
  });

  it("truncates long intent at a word boundary with an ellipsis", () => {
    const name = provisionalHiveName(
      "I need to understand five years of bank statements for my mother's Medicaid application and what is missing",
    );
    expect(name).toBe("I need to understand five years of bank statements for my…");
    expect(Array.from(name).length).toBeLessThanOrEqual(61);
  });

  it("never exceeds the Hive name limit, even without spaces", () => {
    const name = provisionalHiveName("x".repeat(INTENT_TEXT_MAX_LENGTH));
    expect(name.length).toBeLessThanOrEqual(HIVE_NAME_MAX_LENGTH);
    expect(name.endsWith("…")).toBe(true);
  });

  it("does not split multi-byte characters and respects the server's code-unit limit", () => {
    const name = provisionalHiveName("😀".repeat(80));
    expect(name).toBe(`${"😀".repeat(49)}…`);
    expect(name.length).toBeLessThanOrEqual(HIVE_NAME_MAX_LENGTH);
  });

  it("falls back to a neutral name when the intent is only punctuation", () => {
    expect(provisionalHiveName("?!...")).toBe("New Hive");
  });
});

describe("runCreateHiveFlow", () => {
  let deps: {
    createHive: ReturnType<typeof vi.fn>;
    createIntentRequest: ReturnType<typeof vi.fn>;
    uploadFiles: ReturnType<typeof vi.fn>;
  };
  let files: SelectedSourceFile[];
  let progressUpdates: unknown[];

  function input(overrides: Partial<CreateHiveFlowInput> = {}): CreateHiveFlowInput {
    return {
      progress: { hive: null, intentSaved: false },
      hiveName: "Prepare for an IEP meeting",
      intentText: "  Prepare for an IEP meeting  ",
      hiveRequestId: HIVE_REQUEST_ID,
      intentRequestId: INTENT_REQUEST_ID,
      files,
      onProgress: (progress) => progressUpdates.push(progress),
      onFileUpdate: () => {},
      ...overrides,
    };
  }

  function registerAll() {
    deps.uploadFiles.mockImplementation(
      async (_hiveId: string, batch: SelectedSourceFile[], onUpdate: (key: string, patch: Partial<SelectedSourceFile>) => void) => {
        for (const item of batch) {
          onUpdate(item.key, { state: "registered", message: null });
        }
        return { allSettled: true };
      },
    );
  }

  beforeEach(() => {
    deps = {
      createHive: vi.fn().mockResolvedValue({ hive: HIVE, created: true }),
      createIntentRequest: vi.fn().mockResolvedValue({ intentRequest: {}, created: true }),
      uploadFiles: vi.fn(),
    };
    files = toSelectedSourceFiles([pdf()]);
    progressUpdates = [];
  });

  it("creates the Hive with a provisional name, saves the trimmed intent, then uploads", async () => {
    registerAll();
    const result = await runCreateHiveFlow(deps as CreateHiveFlowDeps, input());

    expect(result).toEqual({ ok: true, hive: HIVE });
    expect(deps.createHive).toHaveBeenCalledWith({
      name: "Prepare for an IEP meeting",
      clientRequestId: HIVE_REQUEST_ID,
    });
    expect(deps.createIntentRequest).toHaveBeenCalledWith(HIVE_ID, {
      intentText: "Prepare for an IEP meeting",
      clientRequestId: INTENT_REQUEST_ID,
    });
    expect(deps.uploadFiles).toHaveBeenCalledWith(HIVE_ID, files, expect.any(Function));
    expect(progressUpdates).toEqual([
      { hive: HIVE, intentSaved: false },
      { hive: HIVE, intentSaved: true },
    ]);
  });

  it("saves a trimmed audience with the intent when one is given", async () => {
    registerAll();
    await runCreateHiveFlow(deps as CreateHiveFlowDeps, input({ audience: "  The school team " }));
    expect(deps.createIntentRequest).toHaveBeenCalledWith(HIVE_ID, {
      intentText: "Prepare for an IEP meeting",
      clientRequestId: INTENT_REQUEST_ID,
      audience: "The school team",
    });
  });

  it("reports a createHive failure without touching later stages", async () => {
    deps.createHive.mockRejectedValue(
      clientError("PERSISTENCE_FAILED", "Could not create your Hive. Please try again."),
    );
    const result = await runCreateHiveFlow(deps as CreateHiveFlowDeps, input());

    expect(result).toEqual({
      ok: false,
      progress: { hive: null, intentSaved: false },
      failure: {
        stage: "createHive",
        headline: "Your Hive wasn't created.",
        message: "Could not create your Hive. Please try again.",
        errorCode: "PERSISTENCE_FAILED",
        correlationId: CORRELATION_ID,
        retryable: true,
      },
    });
    expect(deps.createIntentRequest).not.toHaveBeenCalled();
    expect(deps.uploadFiles).not.toHaveBeenCalled();
  });

  it("reports a saveIntent failure with the support reference and keeps the created Hive", async () => {
    deps.createIntentRequest.mockRejectedValue(
      clientError("PERSISTENCE_FAILED", "Could not save what you need. Please try again."),
    );
    const result = await runCreateHiveFlow(deps as CreateHiveFlowDeps, input());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.stage).toBe("saveIntent");
    expect(result.failure.headline).toBe("Your Hive was created, but what you need wasn't saved.");
    expect(result.failure.correlationId).toBe(CORRELATION_ID);
    expect(result.progress).toEqual({ hive: HIVE, intentSaved: false });
    expect(deps.uploadFiles).not.toHaveBeenCalled();
  });

  it("uses a safe fallback message for unexpected (non-API) errors", async () => {
    deps.createIntentRequest.mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await runCreateHiveFlow(deps as CreateHiveFlowDeps, input());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      stage: "saveIntent",
      message: "Could not save what you need. Please try again.",
      errorCode: null,
      correlationId: null,
      retryable: true,
    });
  });

  it("reports an upload failure with the failing file's message and reference", async () => {
    deps.uploadFiles.mockImplementation(
      async (_hiveId: string, batch: SelectedSourceFile[], onUpdate: (key: string, patch: Partial<SelectedSourceFile>) => void) => {
        onUpdate(batch[0]!.key, {
          state: "failed",
          message: "Something went wrong with your documents. Please try again.",
          correlationId: CORRELATION_ID,
        });
        return { allSettled: false };
      },
    );
    const result = await runCreateHiveFlow(deps as CreateHiveFlowDeps, input());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      stage: "uploadDocuments",
      message: "Something went wrong with your documents. Please try again.",
      correlationId: CORRELATION_ID,
      retryable: true,
    });
    expect(result.progress).toEqual({ hive: HIVE, intentSaved: true });
  });

  it("does not finish when every document was rejected", async () => {
    deps.uploadFiles.mockImplementation(
      async (_hiveId: string, batch: SelectedSourceFile[], onUpdate: (key: string, patch: Partial<SelectedSourceFile>) => void) => {
        onUpdate(batch[0]!.key, { state: "rejected", message: "This file was not accepted." });
        return { allSettled: true };
      },
    );
    const result = await runCreateHiveFlow(deps as CreateHiveFlowDeps, input());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      stage: "uploadDocuments",
      message: "None of your documents were accepted. Add another document to continue.",
      retryable: false,
    });
  });

  it("reports an upload stage failure when the uploader itself throws", async () => {
    deps.uploadFiles.mockRejectedValue(new Error("boom"));
    const result = await runCreateHiveFlow(deps as CreateHiveFlowDeps, input());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      stage: "uploadDocuments",
      message: "Something went wrong with your documents. Please try again.",
    });
  });

  it("skips completed stages on retry so the Hive and intent are not duplicated", async () => {
    registerAll();
    const result = await runCreateHiveFlow(
      deps as CreateHiveFlowDeps,
      input({ progress: { hive: HIVE, intentSaved: true } }),
    );

    expect(result).toEqual({ ok: true, hive: HIVE });
    expect(deps.createHive).not.toHaveBeenCalled();
    expect(deps.createIntentRequest).not.toHaveBeenCalled();
    expect(deps.uploadFiles).toHaveBeenCalledTimes(1);
  });

  it("counts documents registered on an earlier attempt", async () => {
    const [done, retry] = toSelectedSourceFiles([pdf("a.pdf"), pdf("b.pdf")]);
    deps.uploadFiles.mockImplementation(
      async (_hiveId: string, batch: SelectedSourceFile[], onUpdate: (key: string, patch: Partial<SelectedSourceFile>) => void) => {
        onUpdate(batch[1]!.key, { state: "rejected", message: "This file was not accepted." });
        return { allSettled: true };
      },
    );
    const result = await runCreateHiveFlow(
      deps as CreateHiveFlowDeps,
      input({
        progress: { hive: HIVE, intentSaved: true },
        files: [{ ...done!, state: "registered" }, retry!],
      }),
    );

    expect(result).toEqual({ ok: true, hive: HIVE });
  });
});
