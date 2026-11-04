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
import type { EditorialPlan } from "./editorial-plan-contracts";
import { compileEditorialPlan } from "./editorial-plan-compiler";
import {
  l001CustomerEditorialPlan,
  l001ProEditorialPlan,
  mayaEditorialPlan,
  revision6CustomerEditorialPlan,
} from "./editorial-plan-fixtures";

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

describe("V4-004K.1 editorial plan compiler", () => {
  it("compiles L001 Maya Carter 37-DF PRO report with buildReport() validation and measured sizes", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const plan = l001ProEditorialPlan();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const compiled = compileEditorialPlan(plan, {
      reportRunId: REPORT_RUN_ID,
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(compiled.presentationPlan.schema).toBe("hive.writer-presentation-plan/1");
    expect(compiled.writerReport.schema).toBe("hive.writer-report/1");
    expect(compiled.writerReport.audience).toBe("PRO");
    expect(compiled.writerReport.view.map((v) => v.component)).toEqual([
      "Narrative",
      "Metric",
      "Comparison",
      "RecordTable",
      "Timeline",
      "Narrative",
      "EvidencePanel",
    ]);
    expect(compiled.writerReport.summary[0]?.type).toBe("DOCUMENTED");
    expect(compiled.writerReport.sections[0]?.blocks.some((b) => b.type === "INTERPRETATION")).toBe(true);
    expect(compiled.writerReport.sections[0]?.blocks.some((b) => b.type === "UNCERTAINTY")).toBe(true);
    expect(compiled.editorialPlanJsonBytes).toBe(6513);
    expect(compiled.compiledWriterReportJsonBytes).toBe(6311);
    const built = buildReport(compiled.writerReport, {
      audience: "PRO",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // Verify all 5 representative structured A2UI components + Narrative + SourceReferences bind cleanly
    expect(built.value.view.components.map((c) => c.component)).toEqual([
      "Narrative",
      "Metric",
      "Comparison",
      "RecordTable",
      "Timeline",
      "Narrative",
      "EvidencePanel",
      "SourceReferences",
    ]);

    // Verify all 37 DF claims across all 8 required material domains are represented in the compiled report
    const renderedClaimIds = new Set<string>();
    for (const block of compiled.writerReport.summary) for (const ref of block.claimRefs) renderedClaimIds.add(ref);
    for (const section of compiled.writerReport.sections) {
      for (const block of section.blocks) for (const ref of block.claimRefs) renderedClaimIds.add(ref);
    }
    for (const comp of compiled.writerReport.view) {
      const walk = (v: unknown) => {
        if (!v || typeof v !== "object") return;
        if (Array.isArray(v)) {
          v.forEach(walk);
          return;
        }
        const rec = v as Record<string, unknown>;
        if (Array.isArray(rec.claimRefs)) for (const id of rec.claimRefs) if (typeof id === "string") renderedClaimIds.add(id);
        if (Array.isArray(rec.claimIds)) for (const id of rec.claimIds) if (typeof id === "string") renderedClaimIds.add(id);
        for (const child of Object.values(rec)) walk(child);
      };
      walk(comp.props);
    }
    for (let i = 1; i <= 37; i += 1) {
      expect(renderedClaimIds.has(`DF${i}`), `Missing DF${i}`).toBe(true);
    }
    for (const requiredId of ["P2.C0", "P2.C1", "P2.A0", "P6", "P6.U0", "P6.L0", "P6.D0"]) {
      expect(renderedClaimIds.has(requiredId), `Missing ${requiredId}`).toBe(true);
    }
    // Broad ANSWER claims P1..P5 for ANSWERED questions are intentionally excluded when atomic DF1..DF37 facts exist
    for (const broadAnswerId of ["P1", "P2", "P3", "P4", "P5"]) {
      expect(renderedClaimIds.has(broadAnswerId)).toBe(false);
    }

    // Verify quantitative facts are grounded strictly in their supporting claims
    const metricComp = built.value.view.components.find((c) => c.component === "Metric");
    expect(metricComp).toMatchObject({
      component: "Metric",
      label: "Required fluency gain",
      value: "33",
      unit: "WCPM",
      status: "VERIFIED",
    });
    const comparisonComp = built.value.view.components.find((c) => c.component === "Comparison");
    expect(comparisonComp).toMatchObject({
      component: "Comparison",
      items: [
        expect.objectContaining({
          label: "Connected-Text Reading Fluency",
          left: "42 WCPM · 42 WCPM",
          right: "75 WCPM",
        }),
        expect.objectContaining({
          label: "Oral Reading Accuracy",
          left: "86%",
          right: "at least 95% accuracy",
        }),
      ],
    });
  });

  it("supports legacy revision-6 question-scoped P#.F# facts in documented and Comparison layouts", () => {
    const { claims, canonicalFindings } = buildRevision6();
    const fileNames = new Map<string, string>();
    const compiled = compileEditorialPlan(revision6CustomerEditorialPlan(), {
      reportRunId: REPORT_RUN_ID,
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.writerReport.view.some((v) => v.component === "Comparison")).toBe(true);
    expect(compiled.writerReport.summary[0]?.claimRefs).toContain("P1.F0");
    const built = buildReport(compiled.writerReport, {
      audience: "CUSTOMER",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(built.ok).toBe(true);
  });

  it("rejects unknown claim IDs, ungrounded interpretation numbers, and hidden mandatory uncertainties", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const base = l001ProEditorialPlan();

    const unknownClaim = compileEditorialPlan(
      {
        ...base,
        summary: { documentedClaimIds: ["DF1", "P99"] },
      },
      { reportRunId: REPORT_RUN_ID, claims, fileNames, canonicalFindings, asOf: "2026-11-04" },
    );
    expect(unknownClaim.ok).toBe(false);
    if (unknownClaim.ok) return;
    expect(unknownClaim.diagnosticReason).toBe("editorial_plan_claim_unknown");

    const ungroundedInterpretation = compileEditorialPlan(
      {
        ...base,
        sections: [
          {
            ...base.sections[0]!,
            interpretation: {
              text: "Maya will read 999 WCPM by tomorrow.",
              claimRefs: ["P2.A0", "DF19"],
            },
          },
        ],
      },
      { reportRunId: REPORT_RUN_ID, claims, fileNames, canonicalFindings, asOf: "2026-11-04" },
    );
    expect(ungroundedInterpretation.ok).toBe(false);
    if (ungroundedInterpretation.ok) return;
    expect(ungroundedInterpretation.diagnosticReason).toBe("writer_number_ungrounded");

    const hiddenUncertainty = compileEditorialPlan(
      {
        ...base,
        sections: [
          {
            ...base.sections[0]!,
            uncertainty: {
              text: "The record is complete for all post-period questions.",
              claimRefs: ["DF7"],
            },
          },
        ],
      },
      { reportRunId: REPORT_RUN_ID, claims, fileNames, canonicalFindings, asOf: "2026-11-04" },
    );
    expect(hiddenUncertainty.ok).toBe(false);
    if (hiddenUncertainty.ok) return;
    expect(hiddenUncertainty.diagnosticReason).toBe("writer_uncertainty_hidden");

    const temporalOverclaim = compileEditorialPlan(
      {
        ...base,
        sections: [
          {
            ...base.sections[0]!,
            interpretation: {
              text: "This Initial IEP is the current active plan governing services today.",
              claimRefs: ["P2.A0", "DF8"],
            },
          },
        ],
      },
      { reportRunId: REPORT_RUN_ID, claims, fileNames, canonicalFindings, asOf: "2026-11-04" },
    );
    expect(temporalOverclaim.ok).toBe(false);
    if (temporalOverclaim.ok) return;
    expect(temporalOverclaim.diagnosticReason).toBe("writer_temporal_status_invalid");
  });

  it("rejects Timeline events whose dates are not grounded in cited claims", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const base = l001ProEditorialPlan();
    const withTimeline: EditorialPlan = {
      ...base,
      components: [
        ...base.components,
        {
          component: "Timeline",
          claimIds: ["DF7"],
          layout: {
            kind: "Timeline",
            title: "Invalid timeline",
            events: [
              {
                dateClaimIds: ["DF1"],
                textClaimIds: ["DF7"],
              },
            ],
          },
        },
      ],
    };
    const compiled = compileEditorialPlan(withTimeline, {
      reportRunId: REPORT_RUN_ID,
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.diagnosticReason).toBe("writer_number_ungrounded");
  });

  it("compiles L001 Maya Carter 37-DF CUSTOMER report with Metric and Comparison layouts", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const plan = l001CustomerEditorialPlan();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const compiled = compileEditorialPlan(plan, {
      reportRunId: REPORT_RUN_ID,
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.writerReport.audience).toBe("CUSTOMER");
    expect(compiled.writerReport.view.map((v) => v.component)).toEqual([
      "Narrative",
      "Metric",
      "Comparison",
      "Narrative",
    ]);
    const built = buildReport(compiled.writerReport, {
      audience: "CUSTOMER",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(built.ok).toBe(true);
  });

  it("returns explicit editorial_plan_shape errors with component field paths when unsupported A2UI components are requested", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const base = l001ProEditorialPlan();
    const unsupportedCatalogComponent = compileEditorialPlan(
      {
        ...base,
        components: [
          ...base.components,
          {
            component: "Checklist",
            claimIds: ["DF27"],
            layout: { kind: "Narrative" },
          },
        ],
      },
      { reportRunId: REPORT_RUN_ID, claims, fileNames, canonicalFindings, asOf: "2026-11-04" },
    );
    const expectedField = `components[${base.components.length}].component`;
    expect(unsupportedCatalogComponent.ok).toBe(false);
    if (unsupportedCatalogComponent.ok) return;
    expect(unsupportedCatalogComponent.diagnosticReason).toBe("editorial_plan_shape");
    expect(unsupportedCatalogComponent.diagnosticField).toBe(expectedField);
    expect(unsupportedCatalogComponent.message).toContain("Checklist");
    expect(unsupportedCatalogComponent.message).toContain("not supported by the editorial compiler");

    const unknownComponent = compileEditorialPlan(
      {
        ...base,
        components: [
          ...base.components,
          {
            component: "UnknownWidget" as EditorialPlan["components"][number]["component"],
            claimIds: ["DF27"],
            layout: { kind: "Narrative" },
          },
        ],
      },
      { reportRunId: REPORT_RUN_ID, claims, fileNames, canonicalFindings, asOf: "2026-11-04" },
    );
    expect(unknownComponent.ok).toBe(false);
    if (unknownComponent.ok) return;
    expect(unknownComponent.diagnosticReason).toBe("editorial_plan_shape");
    expect(unknownComponent.diagnosticField).toBe(expectedField);
  });

  it("rejects invalid layouts, ungrounded quantitative cross-claim citations, and collapsed conflicting claims deterministically (V4-004K.4)", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const base = l001ProEditorialPlan();

    // 1. Quantitative fact check: 75 WCPM goal cited only against DF19 (42 WCPM baseline) must fail
    const ungrounded75 = compileEditorialPlan(
      {
        ...base,
        sections: [
          {
            ...base.sections[0]!,
            interpretation: {
              text: "Achieving GOAL_READING_FLUENCY requires reaching 75 WCPM.",
              claimRefs: ["DF19"], // DF19 only has 42 WCPM, not 75 WCPM
            },
          },
        ],
      },
      { reportRunId: REPORT_RUN_ID, claims, fileNames, canonicalFindings, asOf: "2026-11-04" },
    );
    expect(ungrounded75.ok).toBe(false);
    if (!ungrounded75.ok) {
      expect(ungrounded75.diagnosticReason).toBe("writer_number_ungrounded");
    }

    // 2. Quantitative fact check: 95% accuracy cited only against DF14 (86% baseline) must fail
    const ungrounded95 = compileEditorialPlan(
      {
        ...base,
        sections: [
          {
            ...base.sections[0]!,
            interpretation: {
              text: "Achieving GOAL_READING_FLUENCY requires 95% accuracy.",
              claimRefs: ["DF14"], // DF14 only has 86%, not 95%
            },
          },
        ],
      },
      { reportRunId: REPORT_RUN_ID, claims, fileNames, canonicalFindings, asOf: "2026-11-04" },
    );
    expect(ungrounded95.ok).toBe(false);
    if (!ungrounded95.ok) {
      expect(ungrounded95.diagnosticReason).toBe("writer_number_ungrounded");
    }

    // 3. Invalid RecordTable layout: row cellClaimIds length !== columns length
    const badTableCols = compileEditorialPlan(
      {
        ...base,
        components: base.components.map((comp) =>
          comp.component === "RecordTable"
            ? {
                ...comp,
                layout: {
                  kind: "RecordTable" as const,
                  title: "Broken Table",
                  columns: ["Col A", "Col B", "Col C"],
                  rows: [{ cellClaimIds: [["DF9"], ["DF1"]] }], // only 2 cells for 3 columns
                },
              }
            : comp,
        ),
      },
      { reportRunId: REPORT_RUN_ID, claims, fileNames, canonicalFindings, asOf: "2026-11-04" },
    );
    expect(badTableCols.ok).toBe(false);
    if (!badTableCols.ok) {
      expect(badTableCols.diagnosticReason).toBe("editorial_plan_shape");
      expect(badTableCols.diagnosticField).toContain("layout.rows[0]");
    }

    // 4. Invalid Metric layout: binding is not a {{calc:...}} token
    const badMetricBinding = compileEditorialPlan(
      {
        ...base,
        components: base.components.map((comp) =>
          comp.component === "Metric"
            ? {
                ...comp,
                layout: {
                  kind: "Metric" as const,
                  label: "Gain",
                  binding: "33 WCPM",
                  claimIds: ["P2.C0"],
                },
              }
            : comp,
        ),
      },
      { reportRunId: REPORT_RUN_ID, claims, fileNames, canonicalFindings, asOf: "2026-11-04" },
    );
    expect(badMetricBinding.ok).toBe(false);
    if (!badMetricBinding.ok) {
      expect(badMetricBinding.diagnosticReason).toBe("editorial_plan_shape");
      expect(badMetricBinding.diagnosticField).toContain("layout.binding");
    }

    // 5. Conflicting claims collapsed in Revision 6 without P1.K0
    const rev6 = buildRevision6();
    const rev6Base = revision6CustomerEditorialPlan();
    const collapsedConflict = compileEditorialPlan(
      {
        ...rev6Base,
        insights: [
          {
            id: "INS1",
            meaning: "Reading fluency goal across 2024 and 2025 plans.",
            claimIds: ["P1.F3", "P2.F1"], // Conflicting 60 wcpm vs 90 wcpm facts without P1.K0
            questionIds: ["P1", "P2"],
            role: "CENTRAL",
          },
        ],
      },
      {
        reportRunId: REPORT_RUN_ID,
        claims: rev6.claims,
        fileNames: new Map(),
        canonicalFindings: rev6.canonicalFindings,
        asOf: "2026-11-04",
      },
    );
    expect(collapsedConflict.ok).toBe(false);
    if (!collapsedConflict.ok) {
      expect(collapsedConflict.diagnosticReason).toBe("writer_conflict_collapsed");
    }

    // 6. Useful and distinct CUSTOMER vs PRO outputs on Maya 8-doc fixture
    const mayaCust = mayaEditorialPlan("CUSTOMER");
    const mayaPro = mayaEditorialPlan("PRO");
    expect(mayaCust.summaryDetailLevel).toBe("CONCISE");
    expect(mayaPro.summaryDetailLevel).toBe("COMPREHENSIVE");
    expect(mayaCust.title).not.toBe(mayaPro.title);
    expect(mayaCust.audienceObjective).not.toBe(mayaPro.audienceObjective);
    expect(mayaCust.components.map((c) => c.component)).not.toEqual(mayaPro.components.map((c) => c.component));
  });
});
