import { describe, expect, it } from "vitest";

import {
  MAYA_DOCS,
  MAYA_LIN_VARIANT_IEP_PAGES,
  MAYA_REVISION_6_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaLinVariantDocumentCenteredStudyAgentTurns,
} from "../testing/maya-fixture";
import {
  CANONICAL_FINDINGS_SCHEMA,
  PROPOSED_ATOMIC_FINDING_SCHEMA,
  resolveCanonicalFindings,
  verifyProposedAtomicFindings,
} from "./canonical-finding-resolver";
import { StudyAgentLedger } from "./study-agent";
import { studyClaimCatalog, verifyStudyInvestigation } from "./study-verification";

const PLAN_QUESTION_IDS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"] as const;

const REVISION_6_SYNTHETIC_PAGES: Record<string, string> = {
  [`${MAYA_DOCS.iep2024}:1`]: [
    "Individualized Education Program for Maya.",
    "Effective period: 2024-11-12 to 2025-11-11.",
    "Baseline: 62 words correct per minute.",
    "Goal 1: Maya will read 60 words correct per minute.",
  ].join("\n"),
  [`${MAYA_DOCS.iep2025}:1`]: [
    "Individualized Education Program Amendment for Maya.",
    "Meeting date: March 4, 2025.",
    "Baseline: 62 words correct per minute.",
    "Goal 1: Maya will read 90 words correct per minute by March 2026.",
  ].join("\n"),
  [`${MAYA_DOCS.progressNov}:1`]: [
    "Progress report, November 14, 2025.",
    "Goal 1 reading fluency: 74 words correct per minute.",
  ].join("\n"),
  [`${MAYA_DOCS.progressJan}:1`]: [
    "Progress report, January 15, 2026.",
    "Goal 1 reading fluency: 74 words correct per minute.",
    "Comprehension probe data was not collected in January 2026.",
  ].join("\n"),
  [`${MAYA_DOCS.serviceLog}:1`]: [
    "Speech therapy minutes delivered September to November 2025: 360 minutes.",
    "Minutes required by IEP: 480 minutes.",
  ].join("\n"),
  [`${MAYA_DOCS.evaluation}:1`]: [
    "Psychoeducational evaluation.",
    "The evaluator did not report a reading comprehension score.",
  ].join("\n"),
  [`${MAYA_DOCS.meetingNotice}:1`]: [
    "Notice of IEP meeting.",
    "The annual review meeting is scheduled for March 3, 2026.",
  ].join("\n"),
};

const quote = (sourceDocumentId: string, pageNumber: number, text: string) => ({
  sourceDocumentId,
  pageNumber,
  quote: text,
});

function buildRevision6SyntheticStudy() {
  const baselineEv = quote(MAYA_DOCS.iep2024, 1, "Baseline: 62 words correct per minute.");
  const period2024Ev = quote(MAYA_DOCS.iep2024, 1, "Effective period: 2024-11-12 to 2025-11-11.");
  const goal60Ev = quote(MAYA_DOCS.iep2024, 1, "Goal 1: Maya will read 60 words correct per minute.");
  const goal90Ev = quote(MAYA_DOCS.iep2025, 1, "Goal 1: Maya will read 90 words correct per minute by March 2026.");
  const nov74Ev = quote(
    MAYA_DOCS.progressNov,
    1,
    "Progress report, November 14, 2025. Goal 1 reading fluency: 74 words correct per minute.",
  );
  const jan74Ev = quote(
    MAYA_DOCS.progressJan,
    1,
    "Progress report, January 15, 2026. Goal 1 reading fluency: 74 words correct per minute.",
  );
  const janMissingEv = quote(
    MAYA_DOCS.progressJan,
    1,
    "Comprehension probe data was not collected in January 2026.",
  );
  const deliveredEv = quote(
    MAYA_DOCS.serviceLog,
    1,
    "Speech therapy minutes delivered September to November 2025: 360 minutes.",
  );
  const requiredEv = quote(MAYA_DOCS.serviceLog, 1, "Minutes required by IEP: 480 minutes.");
  const evalMissingEv = quote(
    MAYA_DOCS.evaluation,
    1,
    "The evaluator did not report a reading comprehension score.",
  );
  const meetingEv = quote(
    MAYA_DOCS.meetingNotice,
    1,
    "The annual review meeting is scheduled for March 3, 2026.",
  );

  const raw = {
    schema: "hive.study-investigation/1",
    processingRunId: MAYA_RUN_ID,
    answers: [
      {
        planQuestionId: "P1",
        status: "CONFLICTING",
        answer: "Baseline is 62 wcpm; November fluency is 74 wcpm; 2024 and 2025 plans state different targets.",
        facts: [
          // P1.F0: repeated baseline across P1, P2, P7
          {
            statement: "The baseline was 62 words correct per minute.",
            evidence: [baselineEv],
          },
          // P1.F1: broad composite fact in P1 (modeled on revision 6)
          {
            statement:
              "Under the 2024-11-12 to 2025-11-11 IEP, reading fluency rose from 62 to 74 words correct per minute against the 90 words correct per minute goal.",
            evidence: [period2024Ev, baselineEv, nov74Ev, goal90Ev],
          },
          // P1.F2: same-looking assertion #1 (from November 14, 2025 progress report)
          {
            statement: "Goal 1 reading fluency was 74 words correct per minute.",
            evidence: [nov74Ev],
          },
          // P1.F3: conflicting value #1 (60 wcpm goal)
          {
            statement: "The annual reading goal is 60 words correct per minute.",
            evidence: [goal60Ev],
          },
          // P1.F4: temporal 2024-11-12 to 2025-11-11 atomic fact
          {
            statement: "The IEP effective period is 2024-11-12 to 2025-11-11.",
            evidence: [period2024Ev],
          },
        ],
        calculations: [
          {
            description: "Gain since the baseline",
            inputs: [
              { label: "Current", valueAsWritten: "74 words correct per minute", evidence: [nov74Ev] },
              { label: "Baseline", valueAsWritten: "62 words correct per minute", evidence: [baselineEv] },
            ],
            arithmetic: "74 - 62 = 12",
            result: "12 words correct per minute",
            formula: { op: "-", args: [{ input: 0 }, { input: 1 }] },
          },
        ],
        assessments: [
          {
            judgment: "Maya is improving above baseline toward the annual target.",
            criterion: "Compare interim progress probes against the documented baseline.",
            criterionSource: "GENERAL_KNOWLEDGE" as const,
            criterionEvidence: [],
            factIndexes: [0, 2],
            reasoning: "74 wcpm exceeds the 62 wcpm baseline by 12 wcpm.",
            strength: "MODERATE" as const,
            wouldChangeIf: ["Subsequent probes show regression."],
          },
        ],
        // P1.U0: repeated uncertainty across P1 and P6
        uncertainties: ["Comprehension probe data after November 2025 was not available in the record."],
        professionalDeterminations: [
          {
            determination: "Whether reading fluency progress is sufficient for FAPE",
            bearingFacts: [0, 2],
            decidedBy: "The IEP team",
          },
        ],
        evidence: [baselineEv, nov74Ev],
        conflicts: [
          {
            description: "The 2024 plan sets a reading goal of 60 words correct per minute; the 2025 plan sets 90.",
            evidence: [goal60Ev, goal90Ev],
          },
        ],
        limitations: [],
      },
      {
        planQuestionId: "P2",
        status: "ANSWERED",
        answer: "Baseline was 62 wcpm and the 2025 target is 90 wcpm.",
        facts: [
          // P2.F0: repeated baseline across P1, P2, P7 (with minor casing/leading-article variation)
          {
            statement: "baseline: 62 words correct per minute",
            evidence: [baselineEv],
          },
          // P2.F1: conflicting value #2 (90 wcpm goal vs P1.F3's 60 wcpm goal)
          {
            statement: "The annual reading goal is 90 words correct per minute.",
            evidence: [goal90Ev],
          },
        ],
        calculations: [],
        assessments: [],
        uncertainties: [],
        professionalDeterminations: [],
        evidence: [baselineEv, goal90Ev],
        conflicts: [],
        limitations: [],
      },
      {
        planQuestionId: "P3",
        status: "ANSWERED",
        answer: "360 of 480 speech minutes were delivered.",
        facts: [
          {
            statement: "360 speech therapy minutes were delivered between September and November 2025.",
            evidence: [deliveredEv],
          },
          {
            statement: "480 speech therapy minutes are required by the IEP.",
            evidence: [requiredEv],
          },
        ],
        calculations: [
          {
            description: "Share of required speech minutes delivered",
            inputs: [
              { label: "Delivered", valueAsWritten: "360 minutes", evidence: [deliveredEv] },
              { label: "Required", valueAsWritten: "480 minutes", evidence: [requiredEv] },
            ],
            arithmetic: "360 / 480 * 100 = 75",
            result: "75%",
            formula: {
              op: "*",
              args: [{ op: "/", args: [{ input: 0 }, { input: 1 }] }, { value: "100" }],
            },
          },
        ],
        assessments: [],
        uncertainties: [],
        professionalDeterminations: [],
        evidence: [deliveredEv, requiredEv],
        conflicts: [],
        limitations: [],
      },
      {
        planQuestionId: "P4",
        status: "PARTIALLY_ANSWERED",
        answer: "Composite review of reading trajectory, speech minutes, and missing comprehension data.",
        facts: [
          // P4.F0: broad composite fact in P4 (modeled on revision 6)
          {
            statement:
              "Reading fluency rose from 62 to 74 words correct per minute while speech therapy delivered 360 of 480 required minutes, and comprehension probe data was not collected in January 2026.",
            evidence: [baselineEv, nov74Ev, deliveredEv, requiredEv, janMissingEv],
          },
        ],
        calculations: [],
        assessments: [],
        uncertainties: [],
        professionalDeterminations: [],
        evidence: [baselineEv, nov74Ev, deliveredEv, janMissingEv],
        conflicts: [],
        limitations: [],
      },
      {
        planQuestionId: "P5",
        status: "ANSWERED",
        answer: "In January 2026 reading fluency remained 74 words correct per minute.",
        facts: [
          // P5.F0: same-looking assertion #2 (identical statement text to P1.F2, but from January 15, 2026!)
          {
            statement: "Goal 1 reading fluency was 74 words correct per minute.",
            evidence: [jan74Ev],
          },
        ],
        calculations: [],
        assessments: [],
        uncertainties: [],
        professionalDeterminations: [],
        evidence: [jan74Ev],
        conflicts: [],
        limitations: [],
      },
      {
        planQuestionId: "P6",
        status: "MISSING_EVIDENCE",
        answer: "Comprehension score and post-November comprehension probes are missing before the March 3, 2026 meeting.",
        facts: [
          {
            statement: "The psychoeducational evaluation did not report a reading comprehension score.",
            evidence: [evalMissingEv],
          },
          {
            statement: "The annual review meeting is scheduled for March 3, 2026.",
            evidence: [meetingEv],
          },
        ],
        calculations: [],
        assessments: [],
        // P6.U0: repeated uncertainty across P1 and P6
        uncertainties: ["Comprehension probe data after November 2025 was not available in the record"],
        professionalDeterminations: [],
        evidence: [evalMissingEv, meetingEv],
        conflicts: [],
        limitations: ["Comprehension progress cannot be determined from the current record."],
      },
      {
        planQuestionId: "P7",
        status: "ANSWERED",
        answer: "Baseline reading fluency was 62 words correct per minute.",
        facts: [
          // P7.F0: repeated baseline across P1, P2, P7
          {
            statement: "Baseline was 62 words correct per minute.",
            evidence: [baselineEv],
          },
        ],
        calculations: [],
        assessments: [],
        uncertainties: [],
        professionalDeterminations: [],
        evidence: [baselineEv],
        conflicts: [],
        limitations: [],
      },
    ],
    coverageNotes: [],
    instructionsIgnored: [],
  };

  const verified = verifyStudyInvestigation(raw, {
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: PLAN_QUESTION_IDS,
    pages: new Map(Object.entries(REVISION_6_SYNTHETIC_PAGES)),
  });
  if (!verified.ok) {
    throw new Error(`Synthetic revision 6 fixture failed verification: ${verified.message}`);
  }
  return verified.value;
}

describe("resolveCanonicalFindings (V4-004H Gate 1)", () => {
  it("groups repeated baseline facts across P1, P2, and P7 while retaining all original claim IDs and question IDs", () => {
    const study = buildRevision6SyntheticStudy();
    const claims = studyClaimCatalog(study);
    const resolved = resolveCanonicalFindings(study, claims, { asOf: "2026-11-04" });

    expect(resolved.schema).toBe(CANONICAL_FINDINGS_SCHEMA);
    const baselineGroup = resolved.groups.find((group) =>
      group.originalClaimIds.includes("P1.F0"),
    );
    expect(baselineGroup).toBeDefined();
    expect(baselineGroup?.kind).toBe("FACT");
    expect(baselineGroup?.questionIds).toEqual(["P1", "P2", "P7"]);
    expect(baselineGroup?.originalClaimIds).toEqual(["P1.F0", "P2.F0", "P7.F0"]);
    expect(baselineGroup?.originalClaims.map((c) => [c.claimId, c.planQuestionId])).toEqual([
      ["P1.F0", "P1"],
      ["P2.F0", "P2"],
      ["P7.F0", "P7"],
    ]);
    expect(resolved.claimToGroupId["P1.F0"]).toBe(baselineGroup?.id);
    expect(resolved.claimToGroupId["P2.F0"]).toBe(baselineGroup?.id);
    expect(resolved.claimToGroupId["P7.F0"]).toBe(baselineGroup?.id);
    expect(baselineGroup?.atomicity.status).toBe("ATOMIC");
  });

  it("groups repeated uncertainties across P1 and P6 into a single canonical uncertainty group", () => {
    const study = buildRevision6SyntheticStudy();
    const claims = studyClaimCatalog(study);
    const resolved = resolveCanonicalFindings(study, claims, { asOf: "2026-11-04" });

    const uncertaintyGroup = resolved.groups.find((group) =>
      group.originalClaimIds.includes("P1.U0"),
    );
    expect(uncertaintyGroup).toBeDefined();
    expect(uncertaintyGroup?.kind).toBe("UNCERTAINTY");
    expect(uncertaintyGroup?.questionIds).toEqual(["P1", "P6"]);
    expect(uncertaintyGroup?.originalClaimIds).toEqual(["P1.U0", "P6.U0"]);
    expect(uncertaintyGroup?.resolutionStatus).toBe("UNRESOLVED");
    expect(uncertaintyGroup?.unresolvedReasons).toContain("MISSING_EVIDENCE");
  });

  it("keeps two genuinely distinct same-looking assertions from different dates separate and exposes them as ambiguous", () => {
    const study = buildRevision6SyntheticStudy();
    const claims = studyClaimCatalog(study);
    const resolved = resolveCanonicalFindings(study, claims, { asOf: "2026-11-04" });

    const novGroup = resolved.groups.find((group) => group.originalClaimIds.includes("P1.F2"));
    const janGroup = resolved.groups.find((group) => group.originalClaimIds.includes("P5.F0"));

    expect(novGroup).toBeDefined();
    expect(janGroup).toBeDefined();
    expect(novGroup?.id).not.toBe(janGroup?.id);
    expect(novGroup?.originalClaimIds).toEqual(["P1.F2"]);
    expect(janGroup?.originalClaimIds).toEqual(["P5.F0"]);

    expect(novGroup?.ambiguousWithClaimIds).toContain("P5.F0");
    expect(janGroup?.ambiguousWithClaimIds).toContain("P1.F2");
    expect(novGroup?.unresolvedReasons).toContain("AMBIGUOUS_EQUIVALENCE");
    expect(janGroup?.unresolvedReasons).toContain("AMBIGUOUS_EQUIVALENCE");

    expect(resolved.ambiguousPairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          leftGroupId: novGroup?.id,
          rightGroupId: janGroup?.id,
          leftClaimIds: ["P1.F2"],
          rightClaimIds: ["P5.F0"],
          reason: "SAME_ASSERTION_DIFFERENT_PROVENANCE_OR_DATE",
        }),
      ]),
    );
  });

  it("never merges findings using substring, fuzzy, or keyword overlap", () => {
    const study = buildRevision6SyntheticStudy();
    const claims = studyClaimCatalog(study);
    const modifiedClaims = claims.map((claim) =>
      claim.id === "P7.F0"
        ? {
            ...claim,
            text: "Baseline was 62 words correct per minute in grade-level oral reading passages.",
          }
        : claim,
    );
    const resolved = resolveCanonicalFindings(study, modifiedClaims, { asOf: "2026-11-04" });

    const p1p2Group = resolved.groups.find((group) => group.originalClaimIds.includes("P1.F0"));
    const p7Group = resolved.groups.find((group) => group.originalClaimIds.includes("P7.F0"));
    expect(p1p2Group?.originalClaimIds).toEqual(["P1.F0", "P2.F0"]);
    expect(p7Group?.originalClaimIds).toEqual(["P7.F0"]);
    expect(p1p2Group?.id).not.toBe(p7Group?.id);
  });

  it("preserves conflicting values as distinct findings and links conflicting claims without collapsing them", () => {
    const study = buildRevision6SyntheticStudy();
    const claims = studyClaimCatalog(study);
    const resolved = resolveCanonicalFindings(study, claims, { asOf: "2026-11-04" });

    const goal60Group = resolved.groups.find((group) => group.originalClaimIds.includes("P1.F3"));
    const goal90Group = resolved.groups.find((group) => group.originalClaimIds.includes("P2.F1"));
    const conflictGroup = resolved.groups.find((group) => group.originalClaimIds.includes("P1.K0"));

    expect(goal60Group).toBeDefined();
    expect(goal90Group).toBeDefined();
    expect(conflictGroup).toBeDefined();
    expect(goal60Group?.id).not.toBe(goal90Group?.id);

    expect(goal60Group?.unresolvedReasons).toContain("CONFLICTING_VALUES");
    expect(goal90Group?.unresolvedReasons).toContain("CONFLICTING_VALUES");
    expect(goal60Group?.conflictingWithClaimIds).toEqual(expect.arrayContaining(["P1.K0", "P2.F1"]));
    expect(goal90Group?.conflictingWithClaimIds).toEqual(expect.arrayContaining(["P1.F3", "P1.K0"]));

    expect(conflictGroup?.kind).toBe("CONFLICT");
    expect(conflictGroup?.resolutionStatus).toBe("UNRESOLVED");
    expect(conflictGroup?.unresolvedReasons).toContain("CONFLICTING_VALUES");
    expect(conflictGroup?.conflict?.evidence).toHaveLength(2);
  });

  it("flags broad composite P1 and P4 facts as REQUIRES_SEMANTIC_ATOMIZATION rather than splitting them heuristically", () => {
    const study = buildRevision6SyntheticStudy();
    const claims = studyClaimCatalog(study);
    const resolved = resolveCanonicalFindings(study, claims, { asOf: "2026-11-04" });

    const p1Composite = resolved.groups.find((group) => group.originalClaimIds.includes("P1.F1"));
    const p4Composite = resolved.groups.find((group) => group.originalClaimIds.includes("P4.F0"));

    expect(p1Composite).toBeDefined();
    expect(p1Composite?.atomicity.status).toBe("REQUIRES_SEMANTIC_ATOMIZATION");
    expect(p1Composite?.atomicity.canLosslesslySplitWithoutModel).toBe(false);
    expect(p1Composite?.atomicity.reasons).toEqual(
      expect.arrayContaining([
        "MULTI_DOCUMENT_EVIDENCE",
        "MULTI_QUOTE_SYNTHESIS",
        "MULTIPLE_MEASUREMENT_ANCHORS",
      ]),
    );
    expect(p1Composite?.resolutionStatus).toBe("UNRESOLVED");
    expect(p1Composite?.unresolvedReasons).toContain("REQUIRES_SEMANTIC_ATOMIZATION");
    expect(p1Composite?.originalClaimIds).toEqual(["P1.F1"]);

    expect(p4Composite).toBeDefined();
    expect(p4Composite?.atomicity.status).toBe("REQUIRES_SEMANTIC_ATOMIZATION");
    expect(p4Composite?.atomicity.canLosslesslySplitWithoutModel).toBe(false);
    expect(p4Composite?.atomicity.reasons).toEqual(
      expect.arrayContaining([
        "MULTI_DOCUMENT_EVIDENCE",
        "MULTI_QUOTE_SYNTHESIS",
        "MULTIPLE_INDEPENDENT_CLAUSES",
        "MULTIPLE_MEASUREMENT_ANCHORS",
      ]),
    );
    expect(p4Composite?.resolutionStatus).toBe("UNRESOLVED");
    expect(p4Composite?.unresolvedReasons).toContain("REQUIRES_SEMANTIC_ATOMIZATION");
    expect(p4Composite?.originalClaimIds).toEqual(["P4.F0"]);
  });

  it("validates backward-compatible proposed atomic findings and rejects unverified evidence or ungrounded numbers", () => {
    const study = buildRevision6SyntheticStudy();
    const claims = studyClaimCatalog(study);

    const validProposals = {
      schema: PROPOSED_ATOMIC_FINDING_SCHEMA,
      processingRunId: MAYA_RUN_ID,
      proposals: [
        {
          atomicId: "P4.F0.a1",
          parentClaimId: "P4.F0",
          planQuestionId: "P4",
          statement: "The baseline reading fluency was 62 words correct per minute.",
          evidence: [
            {
              sourceDocumentId: MAYA_DOCS.iep2024,
              pageNumber: 1,
              quote: "Baseline: 62 words correct per minute.",
            },
          ],
        },
        {
          atomicId: "P4.F0.a2",
          parentClaimId: "P4.F0",
          planQuestionId: "P4",
          statement: "360 speech therapy minutes were delivered between September and November 2025.",
          evidence: [
            {
              sourceDocumentId: MAYA_DOCS.serviceLog,
              pageNumber: 1,
              quote: "Speech therapy minutes delivered September to November 2025: 360 minutes.",
            },
          ],
        },
      ],
    };

    const verified = verifyProposedAtomicFindings(validProposals, study, claims, {
      asOf: "2026-11-04",
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.value.proposals).toHaveLength(2);
      expect(verified.value.proposals[0]?.atomicity.status).toBe("ATOMIC");
      expect(verified.value.proposals[0]?.parentClaimId).toBe("P4.F0");
    }

    const unverifiedQuoteProposal = {
      ...validProposals,
      proposals: [
        {
          ...validProposals.proposals[0]!,
          evidence: [
            {
              sourceDocumentId: MAYA_DOCS.iep2024,
              pageNumber: 1,
              quote: "Invented quote that was not on parent claim P4.F0.",
            },
          ],
        },
      ],
    };
    expect(verifyProposedAtomicFindings(unverifiedQuoteProposal, study, claims)).toMatchObject({
      ok: false,
      diagnosticReason: "atomic_finding_evidence_unverified",
    });

    const ungroundedNumberProposal = {
      ...validProposals,
      proposals: [
        {
          ...validProposals.proposals[0]!,
          statement: "The baseline reading fluency was 85 words correct per minute.",
        },
      ],
    };
    expect(verifyProposedAtomicFindings(ungroundedNumberProposal, study, claims)).toMatchObject({
      ok: false,
      diagnosticReason: "atomic_finding_number_ungrounded",
    });

    const stillCompoundProposal = {
      ...validProposals,
      proposals: [
        {
          ...validProposals.proposals[0]!,
          statement:
            "Reading fluency rose from 62 to 74 words correct per minute while 360 speech minutes were delivered.",
          evidence: [
            {
              sourceDocumentId: MAYA_DOCS.iep2024,
              pageNumber: 1,
              quote: "Baseline: 62 words correct per minute.",
            },
            {
              sourceDocumentId: MAYA_DOCS.progressNov,
              pageNumber: 1,
              quote: "Progress report, November 14, 2025. Goal 1 reading fluency: 74 words correct per minute.",
            },
            {
              sourceDocumentId: MAYA_DOCS.serviceLog,
              pageNumber: 1,
              quote: "Speech therapy minutes delivered September to November 2025: 360 minutes.",
            },
          ],
        },
      ],
    };
    expect(verifyProposedAtomicFindings(stillCompoundProposal, study, claims)).toMatchObject({
      ok: false,
      diagnosticReason: "atomic_finding_still_compound",
    });
  });

  it("preserves all original claims, evidence quotes/sourceDocumentId/pageNumber, calculation verification, assessments, determinations, and conflicts without mutating inputs", () => {
    const study = buildRevision6SyntheticStudy();
    const claims = studyClaimCatalog(study);
    const studySnapshotBefore = JSON.stringify(study);
    const claimsSnapshotBefore = JSON.stringify(claims);

    const resolved = resolveCanonicalFindings(study, claims, { asOf: "2026-11-04" });

    expect(JSON.stringify(study)).toBe(studySnapshotBefore);
    expect(JSON.stringify(claims)).toBe(claimsSnapshotBefore);

    const allResolvedClaimIds = resolved.groups.flatMap((group) => group.originalClaimIds);
    expect(new Set(allResolvedClaimIds)).toEqual(new Set(claims.map((c) => c.id)));
    expect(allResolvedClaimIds).toHaveLength(claims.length);

    const calcGroup = resolved.groups.find((group) => group.originalClaimIds.includes("P1.C0"));
    expect(calcGroup?.calculation).toMatchObject({
      description: "Gain since the baseline",
      arithmetic: "74 - 62 = 12",
      result: "12 words correct per minute",
      verification: {
        claimId: "P1.C0",
        status: "VERIFIED",
        reason: "RECOMPUTED_MATCH",
        computedValue: "12",
        statedValue: "12",
      },
    });
    expect(calcGroup?.calculation?.inputs[0]?.evidence[0]).toEqual({
      sourceDocumentId: MAYA_DOCS.progressNov,
      pageNumber: 1,
      quote: "Progress report, November 14, 2025. Goal 1 reading fluency: 74 words correct per minute.",
    });

    const assessmentGroup = resolved.groups.find((group) => group.originalClaimIds.includes("P1.A0"));
    expect(assessmentGroup?.assessment).toMatchObject({
      judgment: "Maya is improving above baseline toward the annual target.",
      criterion: "Compare interim progress probes against the documented baseline.",
      criterionSource: "GENERAL_KNOWLEDGE",
      factIndexes: [0, 2],
      supportingFactClaimIds: ["P1.F0", "P1.F2"],
      strength: "MODERATE",
    });

    const determinationGroup = resolved.groups.find((group) => group.originalClaimIds.includes("P1.D0"));
    expect(determinationGroup?.determination).toMatchObject({
      determination: "Whether reading fluency progress is sufficient for FAPE",
      bearingFacts: [0, 2],
      bearingFactClaimIds: ["P1.F0", "P1.F2"],
      decidedBy: "The IEP team",
    });
  });

  it("classifies temporal range 2024-11-12 to 2025-11-11 as HISTORICAL_AS_OF_REPORT_DATE as of 2026-11-04 without inferring replacement or absence of a newer plan", () => {
    const study = buildRevision6SyntheticStudy();
    const claims = studyClaimCatalog(study);
    const resolved = resolveCanonicalFindings(study, claims, { asOf: "2026-11-04" });

    const periodGroup = resolved.groups.find((group) => group.originalClaimIds.includes("P1.F4"));
    expect(periodGroup).toBeDefined();
    expect(periodGroup?.temporal).toMatchObject({
      status: "HISTORICAL_AS_OF_REPORT_DATE",
      asOfDate: "2026-11-04",
      startDate: "2024-11-12",
      endDate: "2025-11-11",
      currentnessResolved: false,
      effectiveReplacementInferred: false,
      newerPlanAbsenceInferred: false,
      unresolvedReason: "PAST_END_DATE_DOES_NOT_ESTABLISH_REPLACEMENT_OR_ABSENCE_OF_NEWER_PLAN",
    });
    expect(periodGroup?.resolutionStatus).toBe("UNRESOLVED");
    expect(periodGroup?.unresolvedReasons).toContain("TEMPORAL_CURRENTNESS_UNRESOLVED");

    // When asOf is omitted, never uses system clock; keeps temporal status UNRESOLVED_CURRENTNESS
    const withoutAsOf = resolveCanonicalFindings(study, claims);
    const periodWithoutAsOf = withoutAsOf.groups.find((group) => group.originalClaimIds.includes("P1.F4"));
    expect(periodWithoutAsOf?.temporal).toMatchObject({
      status: "UNRESOLVED_CURRENTNESS",
      asOfDate: null,
      startDate: "2024-11-12",
      endDate: "2025-11-11",
      currentnessResolved: false,
      effectiveReplacementInferred: false,
      newerPlanAbsenceInferred: false,
      unresolvedReason: "NO_AS_OF_DATE_PROVIDED",
    });
  });

  it("produces identical deterministic group order, stable IDs, questionIds, and originalClaimIds regardless of input claim order", () => {
    const study = buildRevision6SyntheticStudy();
    const claims = studyClaimCatalog(study);
    const reversedClaims = [...claims].reverse();
    const interleavedClaims = [
      ...claims.filter((_, idx) => idx % 2 === 1),
      ...claims.filter((_, idx) => idx % 2 === 0),
    ];

    const baselineRun = resolveCanonicalFindings(study, claims, { asOf: "2026-11-04" });
    const reversedRun = resolveCanonicalFindings(study, reversedClaims, { asOf: "2026-11-04" });
    const interleavedRun = resolveCanonicalFindings(study, interleavedClaims, { asOf: "2026-11-04" });

    expect(reversedRun).toEqual(baselineRun);
    expect(interleavedRun).toEqual(baselineRun);
    expect(baselineRun.groups.map((g) => g.id)).toEqual(
      baselineRun.groups.map((_, idx) => `CF${idx + 1}`),
    );
  });

  it("resolves DF document findings across P1-P7 without inventing placeholder planQuestionIds", () => {
    const pages = Object.entries(MAYA_LIN_VARIANT_IEP_PAGES).map(([key, text]) => {
      const [sourceDocumentId, page] = key.split(":");
      return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
    });
    const ledger = new StudyAgentLedger({
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
      pages,
    });
    for (const turn of mayaLinVariantDocumentCenteredStudyAgentTurns()) {
      for (const call of turn) ledger.execute(call);
    }
    const verified = verifyStudyInvestigation(ledger.assemble(), {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
      pages: new Map(Object.entries(MAYA_LIN_VARIANT_IEP_PAGES)),
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    const claims = studyClaimCatalog(verified.value);
    const resolved = resolveCanonicalFindings(verified.value, claims, { asOf: "2026-11-04" });
    const df14Group = resolved.groups.find((g) => g.originalClaimIds.includes("DF14"))!;
    expect(df14Group.originalClaims[0]?.planQuestionId).toBeNull();
    expect(df14Group.questionIds).toEqual(["P1", "P2", "P4", "P7"]);
    expect(df14Group.atomicity.status).toBe("ATOMIC");

    const df8Group = resolved.groups.find((g) => g.originalClaimIds.includes("DF8"))!;
    expect(df8Group.temporal.status).toBe("HISTORICAL_AS_OF_REPORT_DATE");
    expect(df8Group.questionIds).toEqual(["P1", "P7"]);
  });
});
