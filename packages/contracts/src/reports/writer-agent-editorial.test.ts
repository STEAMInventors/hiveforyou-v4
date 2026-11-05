import { describe, expect, it } from "vitest";

import { resolveCanonicalFindings } from "../analysis/canonical-finding-resolver";
import {
  StudyAgentLedger,
  type StudyAgentCorpusPage,
  type StudyAgentToolCall,
} from "../analysis/study-agent";
import { studyClaimCatalog, verifyStudyInvestigation } from "../analysis/study-verification";
import {
  L001_INITIAL_IEP_FILE_NAMES,
  L001_INITIAL_IEP_PAGES,
  L001_INITIAL_IEP_PLAN_QUESTION_IDS,
  l001InitialIepStudyAgentTurns,
  MAYA_REVISION_6_PAGES,
  MAYA_REVISION_6_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaRevision6StudyOutput,
} from "../testing/maya-fixture";
import { buildReport } from "./application-view-contracts";
import {
  l001CustomerEditorialPlan,
  l001ProEditorialPlan,
  mayaEditorialPlan,
  revision6CustomerEditorialPlan,
} from "./editorial-plan-fixtures";
import {
  WRITER_EDITORIAL_TOOL_NAMES,
  WRITER_EDITORIAL_TOOLS,
  WriterAgentLedger,
} from "./writer-agent";

const REPORT_RUN_ID = "5a5a5a5a-0000-4000-8000-000000000099";

const L001_CORPUS: StudyAgentCorpusPage[] = Object.entries(L001_INITIAL_IEP_PAGES).map(([key, text]) => {
  const [sourceDocumentId, page] = key.split(":");
  return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
});

function buildVerifiedL001() {
  const ledger = new StudyAgentLedger({
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: [...L001_INITIAL_IEP_PLAN_QUESTION_IDS],
    pages: L001_CORPUS,
  });
  for (const turn of l001InitialIepStudyAgentTurns()) {
    for (const item of turn) {
      const result = ledger.execute(item as StudyAgentToolCall);
      if (!result.ok) throw new Error(result.content);
    }
  }
  const verified = verifyStudyInvestigation(ledger.assemble(), {
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: [...L001_INITIAL_IEP_PLAN_QUESTION_IDS],
    pages: new Map(Object.entries(L001_INITIAL_IEP_PAGES)),
  });
  if (!verified.ok) throw new Error(verified.message);
  const claims = studyClaimCatalog(verified.value);
  const canonicalFindings = resolveCanonicalFindings(verified.value, claims, { asOf: "2026-11-04" });
  return { claims, canonicalFindings };
}

function buildRevision6() {
  const verified = verifyStudyInvestigation(mayaRevision6StudyOutput(), {
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
    pages: new Map(Object.entries(MAYA_REVISION_6_PAGES)),
  });
  if (!verified.ok) throw new Error(verified.message);
  const claims = studyClaimCatalog(verified.value);
  const canonicalFindings = resolveCanonicalFindings(verified.value, claims, { asOf: "2026-11-04" });
  return { claims, canonicalFindings };
}

function exec(
  ledger: WriterAgentLedger,
  name: string,
  args: unknown,
  id?: string,
): Record<string, unknown> & { ok: boolean } {
  const result = ledger.execute({
    id: id ?? `call-${name}`,
    name,
    arguments: typeof args === "string" ? args : JSON.stringify(args),
  });
  return { ...(JSON.parse(result.content) as Record<string, unknown>), ok: result.ok };
}

describe("WriterAgentLedger editorial plan tools (V4-004K.2)", () => {
  it("defines submit_editorial_plan and patch_editorial_plan with closed object parameter schemas", () => {
    expect(WRITER_EDITORIAL_TOOLS.map((tool) => tool.function.name)).toEqual([...WRITER_EDITORIAL_TOOL_NAMES]);
    for (const tool of WRITER_EDITORIAL_TOOLS) {
      expect(tool.function.parameters).toMatchObject({ type: "object", additionalProperties: false });
    }
  });

  it("completes L001 PRO report in one submit_editorial_plan call", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const ledger = new WriterAgentLedger({
      reportRunId: REPORT_RUN_ID,
      audience: "PRO",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    const plan = l001ProEditorialPlan();
    const res = exec(ledger, "submit_editorial_plan", plan);
    expect(res.ok).toBe(true);
    expect(res.compileFailed).toBe(false);
    expect(ledger.finished).toBe(true);
    const assembled = ledger.assemble();
    expect(assembled.audience).toBe("PRO");
    expect(assembled.view.map((v) => v.component)).toEqual([
      "Narrative",
      "Metric",
      "Comparison",
      "RecordTable",
      "Timeline",
      "Narrative",
      "EvidencePanel",
    ]);
    const built = buildReport(assembled, { audience: "PRO", claims, fileNames, canonicalFindings, asOf: "2026-11-04" });
    expect(built.ok).toBe(true);
  });

  it("supports legacy revision-6 Customer editorial plan submission", () => {
    const { claims, canonicalFindings } = buildRevision6();
    const ledger = new WriterAgentLedger({
      reportRunId: REPORT_RUN_ID,
      audience: "CUSTOMER",
      claims,
      fileNames: new Map(),
      canonicalFindings,
      asOf: "2026-11-04",
    });
    const res = exec(ledger, "submit_editorial_plan", revision6CustomerEditorialPlan());
    expect(res.ok).toBe(true);
    expect(ledger.finished).toBe(true);
    expect(ledger.assemble().view.some((v) => v.component === "Comparison")).toBe(true);
  });

  it("recovers via patch_editorial_plan after an unsupported interpretation number", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const ledger = new WriterAgentLedger({
      reportRunId: REPORT_RUN_ID,
      audience: "PRO",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    const plan = l001ProEditorialPlan();
    const bad = {
      ...plan,
      sections: [
        {
          ...plan.sections[0]!,
          interpretation: {
            text: "Maya will read 999 WCPM by tomorrow.",
            claimRefs: ["P2.A0", "DF19"],
          },
        },
      ],
    };
    const failed = exec(ledger, "submit_editorial_plan", bad);
    expect(failed.ok).toBe(false);
    expect(failed.compileFailed).toBe(true);
    expect(failed.error).toBe("writer_number_ungrounded");
    expect(ledger.finished).toBe(false);

    const patched = exec(ledger, "patch_editorial_plan", {
      sections: [plan.sections[0]!],
    });
    expect(patched.ok).toBe(true);
    expect(ledger.finished).toBe(true);
    expect(ledger.assemble().sections[0]?.blocks.some((b) => b.type === "INTERPRETATION")).toBe(true);
  });

  it("rejects unknown claims and invalid tool arguments without publishing partial reports", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const ledger = new WriterAgentLedger({
      reportRunId: REPORT_RUN_ID,
      audience: "PRO",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    const plan = l001ProEditorialPlan();
    const unknown = exec(ledger, "submit_editorial_plan", {
      ...plan,
      summary: { documentedClaimIds: ["DF1", "P99"] },
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.compileFailed).toBe(true);
    expect(unknown.error).toBe("editorial_plan_claim_unknown");
    expect(ledger.finished).toBe(false);
    expect(() => ledger.assemble()).toThrow();

    const badJson = ledger.execute({ id: "bad-json", name: "submit_editorial_plan", arguments: "not-json" });
    expect(badJson.ok).toBe(false);
    const badPayload = JSON.parse(badJson.content) as Record<string, unknown>;
    expect(badPayload.compileFailed).toBe(false);
    expect(badPayload.error).toBe("invalid_arguments");

    const patchLedger = new WriterAgentLedger({
      reportRunId: `${REPORT_RUN_ID}-patch`,
      audience: "PRO",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    const patchFirst = exec(patchLedger, "patch_editorial_plan", { sections: [plan.sections[0]!] });
    expect(patchFirst.ok).toBe(false);
    expect(patchFirst.error).toBe("editorial_plan_patch_requires_base");
  });

  it("completes L001 CUSTOMER report and recovers from an unsupported A2UI component via patch_editorial_plan", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const ledger = new WriterAgentLedger({
      reportRunId: `${REPORT_RUN_ID}-cust`,
      audience: "CUSTOMER",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    const plan = l001CustomerEditorialPlan();
    const withUnsupported = {
      ...plan,
      components: [
        plan.components[0]!,
        {
          component: "Checklist" as const,
          claimIds: ["DF27"],
          layout: { kind: "Narrative" as const },
        },
        plan.components[2]!,
        plan.components[3]!,
      ],
    };
    const rejected = exec(ledger, "submit_editorial_plan", withUnsupported, "call-submit-bad-comp");
    expect(rejected.ok).toBe(false);
    expect(rejected.compileFailed).toBe(true);
    expect(rejected.error).toBe("editorial_plan_shape");
    expect(rejected.field).toBe("components[1].component");
    expect(ledger.finished).toBe(false);

    const repaired = exec(
      ledger,
      "patch_editorial_plan",
      {
        components: [{ index: 1, ...plan.components[1]! }],
      },
      "call-patch-comp",
    );
    expect(repaired.ok).toBe(true);
    expect(ledger.finished).toBe(true);
    const built = buildReport(ledger.assemble(), {
      audience: "CUSTOMER",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(built.ok).toBe(true);
  });

  it("preserves valid unmentioned sections, insights, scenarios, and component slots during targeted patch_editorial_plan repair without silently dropping unsupported content (V4-004K.4)", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const ledger = new WriterAgentLedger({
      reportRunId: `${REPORT_RUN_ID}-preserve`,
      audience: "PRO",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    const base = l001ProEditorialPlan();
    // Create a 2-section plan where s1 is valid, s2 has an ungrounded number AND component[2] is unsupported Checklist
    const twoSectionDraft = {
      ...base,
      sections: [
        base.sections[0]!,
        {
          id: "s2",
          heading: "Progress Monitoring Schedule",
          priority: "MEDIUM" as const,
          insightIds: ["INS2"],
          documentedClaimIds: ["DF32"],
          interpretation: {
            text: "Progress reports are issued 999 times per year.",
            claimRefs: ["P2.A0", "DF32"],
          },
        },
      ],
      components: [
        ...base.components,
        {
          component: "Narrative" as const,
          sectionId: "s2",
          claimIds: ["DF32", "P2.A0"],
          layout: { kind: "Narrative" as const },
        },
      ],
    };

    const firstAttempt = exec(ledger, "submit_editorial_plan", twoSectionDraft, "call-preserve-1");
    expect(firstAttempt.ok).toBe(false);
    expect(firstAttempt.compileFailed).toBe(true);
    expect(firstAttempt.error).toBe("writer_number_ungrounded");
    expect(ledger.finished).toBe(false);

    // Patch ONLY s2 (omitting s1, insights, summary, and components); s1 and all 8 component slots must remain intact
    const secondAttempt = exec(
      ledger,
      "patch_editorial_plan",
      {
        sections: [
          {
            id: "s2",
            heading: "Progress Monitoring Schedule",
            priority: "MEDIUM",
            insightIds: ["INS2"],
            documentedClaimIds: ["DF25", "DF32"],
          },
        ],
      },
      "call-preserve-2",
    );
    expect(secondAttempt.ok).toBe(true);
    expect(ledger.finished).toBe(true);
    const assembled = ledger.assemble();
    expect(assembled.sections.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(assembled.sections[0]?.blocks.some((b) => b.type === "UNCERTAINTY")).toBe(true);
    expect(assembled.view).toHaveLength(base.components.length + 1);
    expect(ledger.currentPresentationPlan?.insights?.map((i) => i.id)).toEqual(["INS1", "INS2"]);
  });

  it("recovers via patch_editorial_plan when a missing-document request or unsupported conclusion is rejected, preserving unmentioned sections and request identity (V4-004K.5B)", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const ledger = new WriterAgentLedger({
      reportRunId: `${REPORT_RUN_ID}-mdr-patch`,
      audience: "PRO",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    const base = l001ProEditorialPlan();

    // Turn 1: Submit with an unsupported conclusion in s1.uncertainty AND an invented missingDocumentRequest
    const badDraft = {
      ...base,
      sections: [
        {
          ...base.sections[0]!,
          uncertainty: {
            text: "Because no quarterly progress reports are in this corpus, oral-reading-fluency probes were never conducted.",
            claimRefs: ["DF7", "DF8", "DF12", "DF20", "DF21", "P6", "P6.U0", "P6.L0", "P6.D0"],
          },
          missingDocumentRequests: [
            {
              gapClaimIds: ["P6", "P6.U0", "P6.L0"],
              supportingClaimIds: ["DF25", "DF32"],
              text: "Do you have the Functional Behavioral Assessment?",
              blockedAnalysis: "Needed to review behavior.",
            },
          ],
        },
      ],
    };

    const first = exec(ledger, "submit_editorial_plan", badDraft, "call-mdr-1");
    expect(first.ok).toBe(false);
    expect(first.compileFailed).toBe(true);
    expect(first.error).toBe("writer_unsupported_conclusion");
    expect(first.hint).toContain("never occurred");
    expect(ledger.finished).toBe(false);

    // Turn 2: Repair s1 uncertainty, still leaving invented FBA request -> returns editorial_plan_request_ungrounded
    const second = exec(
      ledger,
      "patch_editorial_plan",
      {
        sections: [
          {
            ...base.sections[0]!,
            missingDocumentRequests: [
              {
                gapClaimIds: ["P6", "P6.U0", "P6.L0"],
                supportingClaimIds: ["DF25", "DF32"],
                text: "Do you have the Functional Behavioral Assessment?",
                blockedAnalysis: "Needed to review behavior.",
              },
            ],
          },
        ],
      },
      "call-mdr-2",
    );
    expect(second.ok).toBe(false);
    expect(second.compileFailed).toBe(true);
    expect(second.error).toBe("editorial_plan_request_ungrounded");
    expect(second.field).toBe("sections[0].missingDocumentRequests[0].text");
    expect(ledger.finished).toBe(false);

    // Turn 3: Patch s1 with valid progress-report request -> succeeds and preserves all components & insights
    const third = exec(
      ledger,
      "patch_editorial_plan",
      {
        sections: [
          {
            ...base.sections[0]!,
            missingDocumentRequests: [
              {
                gapClaimIds: ["P6", "P6.U0", "P6.L0"],
                supportingClaimIds: ["DF25", "DF32"],
                text: "Can you share the quarterly oral-reading-fluency progress reports?",
                blockedAnalysis:
                  "Quarterly probe results after 2024-11-12 are needed to evaluate progress toward the 75 WCPM and 95% accuracy goal across three consecutive probes.",
              },
            ],
          },
        ],
      },
      "call-mdr-3",
    );
    expect(third.ok).toBe(true);
    expect(ledger.finished).toBe(true);
    const assembled = ledger.assemble();
    const qBlock = assembled.sections[0]?.blocks.find((b) => b.type === "QUESTION");
    expect(qBlock?.missingDocumentRequest?.requestId).toBe("mdr:p6:progress_reports");
    expect(ledger.currentPresentationPlan?.missingDocumentRequests?.[0]?.requestId).toBe("mdr:p6:progress_reports");
  });
});
