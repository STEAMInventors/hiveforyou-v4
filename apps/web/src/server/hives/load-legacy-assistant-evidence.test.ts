import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { verifyStudyInvestigation } from "@hiveforyou/contracts";
import {
  MAYA_DOCS,
  MAYA_REVISION_6_PAGES,
  MAYA_REVISION_6_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaRevision6StudyOutput,
} from "@hiveforyou/contracts/testing";

import { loadAcceptedLegacyAssistantEvidence } from "./load-legacy-assistant-evidence";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_HIVE_ID = "22222222-2222-4222-8222-222222222222";
const CANONICAL_STUDY_ID = "33333333-3333-4333-8333-333333333333";
const REVISION_V6_ID = "44444444-4444-4444-8444-444444444446";
const REVISION_V7_ID = "44444444-4444-4444-8444-444444444447";

const MAYA_DOC_IDS = [
  MAYA_DOCS.iep2024,
  MAYA_DOCS.iep2025,
  MAYA_DOCS.progressNov,
  MAYA_DOCS.progressJan,
  MAYA_DOCS.serviceLog,
  MAYA_DOCS.evaluation,
  MAYA_DOCS.meetingNotice,
] as const;

function verifiedMayaV6() {
  const result = verifyStudyInvestigation(mayaRevision6StudyOutput(), {
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
    pages: new Map(Object.entries(MAYA_REVISION_6_PAGES)),
  });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

type MockTableResults = {
  canonical_studies?: { data: unknown; error: unknown };
  study_revisions?: { data: unknown; error: unknown };
  processing_runs?: { data: unknown; error: unknown };
};

function mockUserClient(tables: MockTableResults): { client: SupabaseClient; fromSpy: ReturnType<typeof vi.fn> } {
  const fromSpy = vi.fn((table: string) => {
    const result = tables[table as keyof MockTableResults] ?? { data: null, error: null };
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    };
  });
  const client = {
    schema: vi.fn((name: string) => {
      if (name !== "hive") throw new Error(`unexpected schema ${name}`);
      return { from: fromSpy };
    }),
  } as unknown as SupabaseClient;
  return { client, fromSpy };
}

function validMayaTables(): MockTableResults {
  const verified = verifiedMayaV6();
  return {
    canonical_studies: {
      data: { id: CANONICAL_STUDY_ID, hive_id: HIVE_ID, current_revision_id: REVISION_V6_ID },
      error: null,
    },
    study_revisions: {
      data: {
        id: REVISION_V6_ID,
        canonical_study_id: CANONICAL_STUDY_ID,
        hive_id: HIVE_ID,
        revision_number: 6,
        processing_run_id: MAYA_RUN_ID,
        format: "investigation-1",
        investigation: verified.investigation,
        verification: verified.verification,
      },
      error: null,
    },
    processing_runs: {
      data: {
        id: MAYA_RUN_ID,
        hive_id: HIVE_ID,
        status: "SUCCEEDED",
        authorized_source_document_ids: [...MAYA_DOC_IDS],
        source_snapshot: {
          documents: MAYA_DOC_IDS.map((id) => ({
            sourceDocumentId: id,
            totalPhysicalPages: 1,
            missingPageNumbers: [],
            emptyPageNumbers: [],
          })),
        },
      },
      error: null,
    },
  };
}

const EXPECTED_REVISION = {
  id: REVISION_V6_ID,
  canonicalStudyId: CANONICAL_STUDY_ID,
  revisionNumber: 6,
  processingRunId: MAYA_RUN_ID,
  format: "investigation-1" as const,
};

const ACTIVE_ELIGIBLE_DOCS = MAYA_DOC_IDS.map((id) => ({
  sourceDocumentId: id,
  totalPhysicalPages: 1,
}));

describe("loadAcceptedLegacyAssistantEvidence", () => {
  it("loads accepted Maya Study v6 investigation and verification through authenticated userClient", async () => {
    const { client, fromSpy } = mockUserClient(validMayaTables());
    const result = await loadAcceptedLegacyAssistantEvidence(client, {
      hiveId: HIVE_ID,
      expectedRevision: EXPECTED_REVISION,
      activeEligibleDocuments: ACTIVE_ELIGIBLE_DOCS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.briefingFacts.length).toBeGreaterThanOrEqual(14);
    expect(result.evidence.factsById.get("P3.F0")?.sourceDocumentId).toBe(MAYA_DOCS.serviceLog);
    expect(fromSpy.mock.calls.map(([table]) => table)).toEqual([
      "canonical_studies",
      "study_revisions",
      "processing_runs",
    ]);
  });

  it("refuses canonical-study-1 revisions without querying the database", async () => {
    const { client, fromSpy } = mockUserClient(validMayaTables());
    const result = await loadAcceptedLegacyAssistantEvidence(client, {
      hiveId: HIVE_ID,
      expectedRevision: { ...EXPECTED_REVISION, format: "canonical-study-1" },
      activeEligibleDocuments: ACTIVE_ELIGIBLE_DOCS,
    });

    expect(result).toEqual({ ok: false, reason: "canonical_format" });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("rejects older or superseded revisions when canonical_studies.current_revision_id differs", async () => {
    const tables = validMayaTables();
    tables.canonical_studies = {
      data: { id: CANONICAL_STUDY_ID, hive_id: HIVE_ID, current_revision_id: REVISION_V7_ID },
      error: null,
    };
    const { client } = mockUserClient(tables);

    const result = await loadAcceptedLegacyAssistantEvidence(client, {
      hiveId: HIVE_ID,
      expectedRevision: EXPECTED_REVISION,
      activeEligibleDocuments: ACTIVE_ELIGIBLE_DOCS,
    });

    expect(result).toEqual({ ok: false, reason: "revision_not_current" });
  });

  it("rejects failed or non-SUCCEEDED processing runs", async () => {
    const tables = validMayaTables();
    tables.processing_runs = {
      data: { ...(tables.processing_runs?.data as Record<string, unknown>), status: "FAILED" },
      error: null,
    };
    const { client } = mockUserClient(tables);

    const result = await loadAcceptedLegacyAssistantEvidence(client, {
      hiveId: HIVE_ID,
      expectedRevision: EXPECTED_REVISION,
      activeEligibleDocuments: ACTIVE_ELIGIBLE_DOCS,
    });

    expect(result).toEqual({ ok: false, reason: "processing_run_not_succeeded" });
  });

  it("rejects cross-Hive revision ownership mismatches", async () => {
    const tables = validMayaTables();
    tables.study_revisions = {
      data: { ...(tables.study_revisions?.data as Record<string, unknown>), hive_id: OTHER_HIVE_ID },
      error: null,
    };
    const { client } = mockUserClient(tables);

    const result = await loadAcceptedLegacyAssistantEvidence(client, {
      hiveId: HIVE_ID,
      expectedRevision: EXPECTED_REVISION,
      activeEligibleDocuments: ACTIVE_ELIGIBLE_DOCS,
    });

    expect(result).toEqual({ ok: false, reason: "revision_identity_mismatch" });
  });

  it("fails closed when verification is missing or tampered", async () => {
    const tables = validMayaTables();
    tables.study_revisions = {
      data: { ...(tables.study_revisions?.data as Record<string, unknown>), verification: null },
      error: null,
    };
    const { client } = mockUserClient(tables);

    const result = await loadAcceptedLegacyAssistantEvidence(client, {
      hiveId: HIVE_ID,
      expectedRevision: EXPECTED_REVISION,
      activeEligibleDocuments: ACTIVE_ELIGIBLE_DOCS,
    });

    expect(result).toEqual({ ok: false, reason: "verification_invalid" });
  });

  it("excludes documents outside the frozen snapshot or removed from active hive documents", async () => {
    const tables = validMayaTables();
    // Simulate serviceLog being deleted after Study v6 was accepted
    const activeWithoutServiceLog = ACTIVE_ELIGIBLE_DOCS.filter(
      (doc) => doc.sourceDocumentId !== MAYA_DOCS.serviceLog,
    );
    const { client } = mockUserClient(tables);

    const result = await loadAcceptedLegacyAssistantEvidence(client, {
      hiveId: HIVE_ID,
      expectedRevision: EXPECTED_REVISION,
      activeEligibleDocuments: activeWithoutServiceLog,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.factsById.has("P3.F0")).toBe(false);
    expect(result.evidence.factsById.has("P3.F1")).toBe(false);
    expect(result.evidence.factsById.has("P1.F0")).toBe(true);
  });
});
