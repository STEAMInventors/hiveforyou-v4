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
    expect(compiled.compiledWriterReportJsonBytes).toBe(6335);
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
          left: "42 WCPM",
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

  it("attaches historical framing to DF8 before P2.C0 (33 WCPM) calculation bindings and not at the end of the block (V4-004K.5A)", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const base = l001ProEditorialPlan();

    const planWithFocusedSummary: EditorialPlan = {
      ...base,
      summary: {
        documentedClaimIds: ["DF8", "DF19", "DF20"],
        calculationBindings: [{ calcId: "P2.C0", suffix: " WCPM increase" }],
      },
      components: base.components.map((comp) =>
        comp.component === "Narrative" && comp.sectionId === "summary"
          ? { ...comp, claimIds: ["DF8", "DF19", "DF20", "P2.C0"] }
          : comp,
      ),
    };

    const compiled = compileEditorialPlan(planWithFocusedSummary, {
      reportRunId: REPORT_RUN_ID,
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const summaryText = compiled.writerReport.summary[0]!.text;
    expect(summaryText).toBe(
      "IEP Period is 2024-11-12 through 2025-11-11. This documented period ended before the report date; whether a newer plan exists is not established in the record. GOAL_READING_FLUENCY baseline is 42 WCPM. GOAL_READING_FLUENCY target is 75 WCPM. ({{calc:P2.C0}} WCPM increase)",
    );
    expect(summaryText.endsWith("({{calc:P2.C0}} WCPM increase)")).toBe(true);

    // Also verify section s1 documented block attaches framing to DF8 rather than at the end of DF37
    const s1DocText = compiled.writerReport.sections[0]!.blocks[0]!.text;
    expect(s1DocText.startsWith(
      "IEP Period is 2024-11-12 through 2025-11-11. This documented period ended before the report date; whether a newer plan exists is not established in the record. ",
    )).toBe(true);
    expect(s1DocText.endsWith("across three consecutive probes by 2025-11-11.")).toBe(true);

    const built = buildReport(compiled.writerReport, {
      audience: "PRO",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const summaryNarrative = built.value.view.components.find(
      (c) => c.component === "Narrative" && c.heading === null,
    );
    expect(summaryNarrative).toBeDefined();
    if (summaryNarrative?.component === "Narrative") {
      expect(summaryNarrative.blocks[0]?.text).toBe(
        "IEP Period is 2024-11-12 through 2025-11-11. This documented period ended before the report date; whether a newer plan exists is not established in the record. GOAL_READING_FLUENCY baseline is 42 WCPM. GOAL_READING_FLUENCY target is 75 WCPM. (33 WCPM increase)",
      );
      expect(summaryNarrative.blocks[0]?.claimIds).toEqual(["DF8", "DF19", "DF20", "P2.C0"]);
    }
  });

  it("ensures sentence punctuation, preserves original order, and conservatively deduplicates exact documented text while keeping all claimRefs intact (V4-004K.5A)", () => {
    const { claims, canonicalFindings } = buildRevision6();
    const fileNames = new Map<string, string>();
    const base = revision6CustomerEditorialPlan();

    // P2.F0 has no trailing period ("baseline: 62 words correct per minute")
    // P1.F2 and P5.F0 have identical text ("Goal 1 reading fluency was 74 words correct per minute.")
    // P1.U0 and P6.U0 have identical text except P6.U0 lacks a trailing period
    const plan: EditorialPlan = {
      ...base,
      summary: {
        documentedClaimIds: ["P2.F0", "P1.F2", "P5.F0", "P1.F0"],
        calculationBindings: [{ calcId: "P1.C0", suffix: " words gained" }],
      },
      sections: [
        {
          ...base.sections[0]!,
          documentedClaimIds: ["P1.F0", "P1.F2", "P5.F0", "P1.F3", "P2.F1", "P1.K0", "P1"],
          uncertainty: {
            mode: "compiled",
            claimIds: ["P1.U0", "P6.U0", "P6", "P6.F0", "P6.F1"],
          },
        },
      ],
      components: [
        {
          component: "Narrative",
          sectionId: "summary",
          claimIds: ["P2.F0", "P1.F2", "P5.F0", "P1.F0", "P1.C0"],
          layout: { kind: "Narrative" },
        },
        base.components[1]!,
        {
          component: "Narrative",
          sectionId: "s1",
          claimIds: ["P1.U0", "P6.U0", "P6", "P6.F0", "P6.F1"],
          layout: { kind: "Narrative" },
        },
      ],
    };

    const compiled = compileEditorialPlan(plan, {
      reportRunId: REPORT_RUN_ID,
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    // P2.F0 receives trailing period; P1.F2 & P5.F0 exact duplicate text appears once; non-identical P1.F0 is retained in order
    expect(compiled.writerReport.summary[0]?.text).toBe(
      "baseline: 62 words correct per minute. Goal 1 reading fluency was 74 words correct per minute. The baseline was 62 words correct per minute. ({{calc:P1.C0}} words gained)",
    );
    expect(compiled.writerReport.summary[0]?.claimRefs).toEqual(["P2.F0", "P1.F2", "P5.F0", "P1.F0", "P1.C0"]);

    // Section s1 documented block deduplicates P1.F2 / P5.F0 prose while keeping both claimRefs
    const s1DocBlock = compiled.writerReport.sections[0]!.blocks[0]!;
    expect(
      s1DocBlock.text.split("Goal 1 reading fluency was 74 words correct per minute.").length - 1,
    ).toBe(1);
    expect(s1DocBlock.claimRefs).toEqual(["P1.F0", "P1.F2", "P5.F0", "P1.F3", "P2.F1", "P1.K0", "P1"]);

    // Compiled uncertainty block punctuates P6.U0 and deduplicates it against P1.U0 while keeping all claimRefs
    const s1UncBlock = compiled.writerReport.sections[0]!.blocks[1]!;
    expect(
      s1UncBlock.text.split("Comprehension probe data after November 2025 was not available in the record.").length - 1,
    ).toBe(1);
    expect(s1UncBlock.claimRefs).toEqual(["P1.U0", "P6.U0", "P6", "P6.F0", "P6.F1"]);
  });

  it("deduplicates 42 WCPM multi-page values within a cell while preserving all claimRefs, source pages, distinct attributes, and nonduplicate values (V4-004K.5A)", () => {
    const { claims, canonicalFindings } = buildVerifiedL001();
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));
    const base = l001ProEditorialPlan();

    // Verify DF13 (page 1, reading_fluency_baseline) and DF19 (page 2, baseline) remain distinct in catalog
    const df13 = claims.find((c) => c.id === "DF13")!;
    const df19 = claims.find((c) => c.id === "DF19")!;
    expect(df13.documentFinding?.attribute).toBe("reading_fluency_baseline");
    expect(df19.documentFinding?.attribute).toBe("baseline");
    expect(df13.refs.map((r) => r.pageNumber)).toEqual([1]);
    expect(df19.refs.map((r) => r.pageNumber)).toEqual([2]);

    // Build a plan where a RecordTable row has ONLY page-1 DF13 and page-2 DF19 in one cell and page-2 DF27 in another
    const planWithMultiPageCell: EditorialPlan = {
      ...base,
      components: base.components.map((comp) =>
        comp.component === "RecordTable"
          ? {
              ...comp,
              layout: {
                kind: "RecordTable" as const,
                title: "Initial IEP Key Provisions",
                columns: ["Section", "Subject", "Documented Provision"],
                rows: [
                  ...(comp.layout.kind === "RecordTable" ? comp.layout.rows : []),
                  {
                    cellClaimIds: [
                      ["DF13", "DF19"], // Both have valueAsWritten "42 WCPM" (page 1 and page 2)
                      ["DF1", "DF3"], // Nonduplicate values ("Maya Carter" and "2")
                      ["DF19", "DF20"], // Nonduplicate values ("42 WCPM" and "75 WCPM")
                    ],
                  },
                ],
              },
            }
          : comp,
      ),
    };

    const compiled = compileEditorialPlan(planWithMultiPageCell, {
      reportRunId: REPORT_RUN_ID,
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const comparisonProps = compiled.writerReport.view.find((v) => v.component === "Comparison")?.props as {
      items: { label: string; left: string; right: string; claimRefs: string[] }[];
    };
    expect(comparisonProps.items[0]).toEqual({
      label: "Connected-Text Reading Fluency",
      left: "42 WCPM",
      right: "75 WCPM",
      claimRefs: ["DF13", "DF19", "DF20"],
    });

    const tableProps = compiled.writerReport.view.find((v) => v.component === "RecordTable")?.props as {
      rows: { cells: string[]; claimRefs: string[] }[];
    };
    const addedRow = tableProps.rows[tableProps.rows.length - 1]!;
    expect(addedRow.cells).toEqual([
      "42 WCPM",
      "Maya Carter · 2",
      "42 WCPM · 75 WCPM",
    ]);
    expect(addedRow.claimRefs).toEqual(["DF13", "DF19", "DF1", "DF3", "DF20"]);

    const built = buildReport(compiled.writerReport, {
      audience: "PRO",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const boundComparison = built.value.view.components.find((c) => c.component === "Comparison");
    expect(boundComparison?.component).toBe("Comparison");
    if (boundComparison?.component === "Comparison") {
      expect(boundComparison.items[0]?.left).toBe("42 WCPM");
      expect(boundComparison.items[0]?.refs.map((r) => r.pageNumber)).toEqual([1, 2]);
    }

    const boundTable = built.value.view.components.find((c) => c.component === "RecordTable");
    expect(boundTable?.component).toBe("RecordTable");
    if (boundTable?.component === "RecordTable") {
      const boundRow = boundTable.rows[boundTable.rows.length - 1]!;
      expect(boundRow.cells).toEqual(["42 WCPM", "Maya Carter · 2", "42 WCPM · 75 WCPM"]);
      expect(boundRow.refs.map((r) => r.pageNumber)).toEqual([1, 2]);
    }
  });

  it("frames a second historical period when another claim is already framed, frames historical claims when coexisting with active claims, and never attaches duplicate-claim framing to an unrelated sentence (V4-004K.5A)", () => {
    const { claims } = buildRevision6();
    const base = revision6CustomerEditorialPlan();

    // Derive minimal synthetic variations from existing Revision 6 claims:
    // - P2.F0 adjusted to represent an already-framed prior historical period (2023-11-12 to 2024-11-11)
    // - P1.F4 is the unframed historical period (2024-11-12 to 2025-11-11: "The IEP effective period is 2024-11-12 to 2025-11-11.")
    // - P3.F0 adjusted with an active date range (2025-11-12 to 2026-11-15) as of 2026-11-04
    // - P5.F0 has identical text to P1.F2 ("Goal 1 reading fluency was 74 words correct per minute."), with historical evidence on P5.F0 only
    const customClaims = claims.map((claim) => {
      if (claim.id === "P2.F0") {
        return {
          ...claim,
          text: "The 2023-11-12 to 2024-11-11 period ended before the report date with a baseline of 62 words correct per minute.",
          quotes: ["Effective period: 2023-11-12 to 2024-11-11. Baseline: 62 words correct per minute."],
        };
      }
      if (claim.id === "P3.F0") {
        return {
          ...claim,
          text: "360 speech therapy minutes were delivered during 2025-11-12 to 2026-11-15.",
          quotes: ["Service period: 2025-11-12 to 2026-11-15. Delivered: 360 minutes."],
        };
      }
      if (claim.id === "P5.F0") {
        return {
          ...claim,
          quotes: ["Effective period: 2024-01-01 to 2024-06-01. Goal 1 reading fluency: 74 words correct per minute."],
        };
      }
      return claim;
    });

    const plan: EditorialPlan = {
      ...base,
      // Case 1 & 2 in summary: already-framed historical P2.F0 (2023..2024) + unframed historical P1.F4 (2024..2025) + active P3.F0 (2025..2026)
      summary: {
        documentedClaimIds: ["P2.F0", "P1.F4", "P3.F0"],
        calculationBindings: [{ calcId: "P1.C0", suffix: " words gained" }],
      },
      sections: [
        {
          ...base.sections[0]!,
          // Case 3 in section s1: non-historical P1.F2 ("Goal 1 reading fluency was 74 words correct per minute."),
          // followed by unrelated P1.F0 ("The baseline was 62 words correct per minute."),
          // followed by duplicate-text historical P5.F0 ("Goal 1 reading fluency was 74 words correct per minute.")
          documentedClaimIds: ["P1.F2", "P1.F0", "P5.F0", "P1.F3", "P2.F1", "P1.K0", "P1"],
        },
      ],
      components: [
        {
          component: "Narrative",
          sectionId: "summary",
          claimIds: ["P2.F0", "P1.F4", "P3.F0", "P1.C0"],
          layout: { kind: "Narrative" },
        },
        base.components[1]!,
        base.components[2]!,
      ],
    };

    const compiled = compileEditorialPlan(plan, {
      reportRunId: REPORT_RUN_ID,
      claims: customClaims,
      fileNames: new Map(),
      canonicalFindings: null,
      asOf: "2026-11-04",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    // 1 & 2: P2.F0 is not double-framed; P1.F4 (second historical period) IS framed even though P2.F0 is already framed and P3.F0 is active
    expect(compiled.writerReport.summary[0]?.text).toBe(
      "The 2023-11-12 to 2024-11-11 period ended before the report date with a baseline of 62 words correct per minute. The IEP effective period is 2024-11-12 to 2025-11-11. This documented period ended before the report date; whether a newer plan exists is not established in the record. 360 speech therapy minutes were delivered during 2025-11-12 to 2026-11-15. ({{calc:P1.C0}} words gained)",
    );

    // 3: Duplicate historical P5.F0 attaches framing to the deduplicated "Goal 1 reading fluency was 74 words correct per minute." sentence,
    // NOT after the unrelated "The baseline was 62 words correct per minute." sentence
    const s1DocText = compiled.writerReport.sections[0]!.blocks[0]!.text;
    expect(
      s1DocText.startsWith(
        "Goal 1 reading fluency was 74 words correct per minute. This documented period ended before the report date; whether a newer plan exists is not established in the record. The baseline was 62 words correct per minute.",
      ),
    ).toBe(true);
    expect(
      s1DocText.includes(
        "The baseline was 62 words correct per minute. This documented period ended before the report date",
      ),
    ).toBe(false);
  });
});
