import { describe, expect, it } from "vitest";

import { StudyAgentLedger } from "../analysis/study-agent";
import { studyClaimCatalog, verifyStudyInvestigation } from "../analysis/study-verification";
import {
  MAYA_DOCS,
  MAYA_FILE_NAMES,
  MAYA_PAGES,
  MAYA_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaStudyAgentTurns,
  mayaWriterOutput,
} from "../testing/maya-fixture";
import { A2UI_COMPONENTS, buildReport } from "./application-view-contracts";
import { validateWriterReport } from "./writer-report-contracts";

/** Agent-built Study → verifier → claim catalog: the same path an accepted revision takes to the Writer. */
function agenticClaims() {
  const pages = Object.entries(MAYA_PAGES).map(([key, text]) => {
    const [sourceDocumentId, page] = key.split(":");
    return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
  });
  const ledger = new StudyAgentLedger({ processingRunId: MAYA_RUN_ID, planQuestionIds: MAYA_PLAN_QUESTION_IDS, pages });
  for (const turn of mayaStudyAgentTurns()) for (const call of turn) ledger.execute(call);
  const verified = verifyStudyInvestigation(ledger.assemble(), {
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: [...MAYA_PLAN_QUESTION_IDS],
    pages: new Map(Object.entries(MAYA_PAGES)),
  });
  if (!verified.ok) throw new Error(verified.diagnosticReason);
  return studyClaimCatalog(verified.value);
}

function writerDraft(audience: "CUSTOMER" | "PRO" = "CUSTOMER") {
  const output = mayaWriterOutput(audience);
  output.sections[0]!.blocks[2] = {
    type: "UNCERTAINTY",
    text: "Only one progress measurement was available after the baseline.",
    claimRefs: ["P1.U0"],
  };
  output.sections[0]!.blocks.push({
    type: "UNCERTAINTY",
    text: "The 2024 plan set a goal of 60 words correct per minute; the 2025 plan sets 90.",
    claimRefs: ["P1.K0"],
  });
  output.view.push(
    { component: "Metric", props: { label: "Remaining gap", binding: "{{calc:P1.C1}}", unit: "words per minute" } },
    { component: "EvidencePanel", props: { title: "How we got here", claimIds: ["P1.A0", "P1.D0", "P1.K0", "P1.C1"] } },
    {
      component: "IssueList",
      props: {
        title: "Points to raise",
        issues: [{ text: "The 2024 and 2025 plans set different reading goals.", severity: "MEDIUM", claimRefs: ["P1.K0"] }],
      },
    } as never,
    {
      component: "QuestionList",
      props: { title: "Questions for the team", questions: [{ text: "Is Maya's progress sufficient?", claimRefs: ["P1.D0"] }] },
    } as never,
  );
  return output;
}

const fileNames = new Map(Object.entries(MAYA_FILE_NAMES));

describe("agentic Canonical Study through the Writer and A2UI", () => {
  const claims = agenticClaims();

  it("exposes assessment, determination, conflict, uncertainty, limitation and verified calculations as claims", () => {
    const byId = new Map(claims.map((claim) => [claim.id, claim]));
    expect(byId.get("P1.A0")?.kind).toBe("ASSESSMENT");
    expect(byId.get("P1.D0")).toMatchObject({ kind: "DETERMINATION", text: "Whether progress is sufficient (decided by The IEP team)" });
    expect(byId.get("P1.K0")?.kind).toBe("CONFLICT");
    expect(byId.get("P1.U0")?.kind).toBe("UNCERTAINTY");
    expect(byId.get("P3.L0")?.kind).toBe("LIMITATION");
    expect(byId.get("P1.C0")).toMatchObject({ numericStatus: "VERIFIED", computedValue: "12" });
    expect(byId.get("P1.C1")).toMatchObject({ numericStatus: "VERIFIED", computedValue: "16" });
    expect(byId.get("P2.C0")).toMatchObject({ numericStatus: "VERIFIED", computedValue: "75" });
    expect(byId.get("P3")).toMatchObject({ kind: "ANSWER", answerStatus: "MISSING_EVIDENCE" });
  });

  it("does not let the Writer hide the conflict the investigation found", () => {
    expect(validateWriterReport(mayaWriterOutput(), { audience: "CUSTOMER", claims })).toMatchObject({
      ok: false,
      diagnosticReason: "writer_uncertainty_hidden",
    });
  });

  it.each(["CUSTOMER", "PRO"] as const)("binds a %s hive-application-view/1 from the catalog components only", (audience) => {
    const built = buildReport(writerDraft(audience), { audience, claims, fileNames });
    if (!built.ok) throw new Error(`${built.diagnosticReason} ${built.diagnosticField ?? ""}`);
    const view = built.value.view;
    expect(view).toMatchObject({ schema: "hive-application-view/1", audience, layout: "PROPOSED" });
    for (const component of view.components) expect(A2UI_COMPONENTS).toContain(component.component);

    expect(view.components.find((c) => c.component === "Metric" && c.label === "Reading gain")).toMatchObject({ value: "12", status: "VERIFIED" });
    expect(view.components.find((c) => c.component === "Metric" && c.label === "Remaining gap")).toMatchObject({ value: "16", status: "VERIFIED" });

    const panel = view.components.find((c) => c.component === "EvidencePanel");
    expect(panel && panel.component === "EvidencePanel" && panel.claims.map((claim) => [claim.kind, claim.numericStatus])).toEqual([
      ["ASSESSMENT", null],
      ["DETERMINATION", null],
      ["CONFLICT", null],
      ["CALCULATION", "VERIFIED"],
    ]);
    const conflict = panel && panel.component === "EvidencePanel" ? panel.claims[2]! : null;
    expect(conflict?.refs.map((ref) => ref.fileName)).toEqual(["Maya IEP 2024.pdf", "Maya IEP 2025.pdf"]);

    const narrative = JSON.stringify(view.components.filter((c) => c.component === "Narrative"));
    expect(narrative).toContain("a gain of 12 words");
    expect(narrative).toContain('"type":"UNCERTAINTY"');
    expect(view.components.find((c) => c.component === "IssueList")).toMatchObject({
      issues: [{ severity: "MEDIUM", refs: [{ sourceDocumentId: MAYA_DOCS.iep2024, pageNumber: 1, fileName: "Maya IEP 2024.pdf" }, expect.anything()] }],
    });
    expect(view.components.find((c) => c.component === "QuestionList")).toMatchObject({ questions: [{ refs: [expect.anything(), expect.anything()] }] });

    const sources = view.components.at(-1);
    expect(sources?.component).toBe("SourceReferences");
    const files = sources && sources.component === "SourceReferences" ? sources.sources.map((source) => source.fileName) : [];
    expect(files).toEqual(expect.arrayContaining(["Maya IEP 2025.pdf", "Maya IEP 2024.pdf", "Progress report Nov 2025.pdf", "Speech service log.xlsx"]));
  });
});
