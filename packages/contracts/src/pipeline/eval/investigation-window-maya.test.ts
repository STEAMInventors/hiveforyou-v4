/**
 * Synthetic Maya L001 windows from the 0.5.1 profile.
 * No model call. Missing records stay on the plan.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STUDY_AGENT_BUDGET } from "../../analysis/study-agent";
import { compileEffectiveDomainPack } from "../effective-domain-pack";
import type { SupplementalArtifacts } from "../domain-investigation-plan";
import { prepareInvestigationStudy } from "../investigation-study-engine";
import {
  allocateWindowBudgets,
  completeInvestigationWindow,
  planInvestigationWindows,
  presentDocumentKindIds,
  recordWindowTurn,
  resumeWindowProgress,
  selectNextInvestigationWindow,
  startWindowProgress,
} from "../investigation-window-plan";
import type { DomainPackSource } from "../domain-pack-source";

const ROOT = join(import.meta.dirname, "../../../../../");
const V051 = join(ROOT, "packs/drafts/iep-us-federal/v0.5.1");
const V050 = join(ROOT, "packs/drafts/iep-us-federal/v0.5.0");

const PRESENT = [
  "document:referral-or-request-for-evaluation",
  "document:signed-consent-to-evaluate",
  "document:evaluation-report",
  "document:eligibility-determination",
  "document:iep",
];

function load(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;
}

function artifacts(): SupplementalArtifacts {
  return {
    ontology: load(V051, "iep-domain-ontology-spec.json"),
    authorityRegister: load(V050, "iep-domain-authority-register.json"),
    conflictPatterns: load(V050, "iep-domain-conflict-patterns.v1.json"),
    stateOverlays: load(V050, "iep-domain-state-overlays.v1.json"),
    factClasses: load(V050, "iep-domain-fact-classes.v1.json"),
    workflowCoverage: load(V050, "iep-domain-workflow-coverage.v1.json"),
    unsupportedOperators: load(V050, "iep-domain-unsupported-operators.v1.json"),
  };
}

const source = load(V051, "iep-domain-pack-source.v0.5.1.json") as DomainPackSource;
const prepared = prepareInvestigationStudy({ packSource: source, artifacts: artifacts() });
if (!prepared.ok) throw new Error(prepared.code);

const labels = [
  "01 initial referral",
  "02 evaluation plan",
  "03 parent evaluation consent",
  "04 psychoeducational evaluation",
  "05 academic evaluation",
  "06 speech language evaluation",
  "07 eligibility determination",
  "08 initial iep",
];

describe("Maya L001 investigation windows", () => {
  const plan = planInvestigationWindows({
    intent: "What is written, and which records are missing?",
    plan: prepared.prepared.plan,
    presentDocumentIds: PRESENT,
    verifiedEvidence: [{ recordDigest: "a".repeat(64), documentKindId: "document:iep" }],
  });

  it("covers customer and professional objectives without dropping a missing record", () => {
    const obligations = plan.windows.flatMap((window) => window.obligations);
    expect(obligations).toHaveLength(25);
    expect(new Set(obligations.map((item) => item.audience))).toEqual(new Set(["customer", "professional"]));
    expect(obligations.filter((item) => item.audience === "customer")).toHaveLength(11);
    expect(obligations.filter((item) => item.audience === "professional")).toHaveLength(14);
    const prior = obligations.find((item) => item.objectiveId === "objective:customer:prior-iep-changes");
    expect(prior?.disposition).toBe("NOT_APPLICABLE");
    expect(prior?.missingDocumentIds).toEqual([]);
    expect(prior?.questionIds).toEqual([]);
    expect(plan.windows.some((window) => window.obligations.some((item) => item.objectiveId === prior?.objectiveId))).toBe(true);
    const progress = obligations.find((item) => item.objectiveId === "objective:professional:progress-implementation");
    expect(progress?.disposition).toBe("REVIEW_REQUIRED");
    expect(progress?.definitionIds).toContain("check:G4");
    expect(progress?.definitionIds).not.toContain("calculation:C13");
    expect(progress?.missingDocumentIds).not.toContain("document:progress-reports");
    expect(progress?.missingDocumentIds).not.toContain("document:service-logs");
    const progressEvidence = obligations.find((item) => item.objectiveId === "objective:customer:progress-evidence");
    expect(progressEvidence?.disposition).toBe("REVIEW_REQUIRED");
    expect(progressEvidence?.missingDocumentIds).toEqual(expect.arrayContaining(["document:progress-reports", "document:progress-monitoring-data"]));
    const matched = presentDocumentKindIds(prepared.prepared.pack.definitions, labels);
    expect(matched).toContain("document:iep");
    expect(matched).not.toContain("document:prior-iep");
    expect(matched).not.toContain("document:service-logs");
  });

  it("keeps evidence references on the window that names that record", () => {
    const iepWindows = plan.windows.filter((window) => window.obligations.some((item) => item.documentIds.includes("document:iep")));
    expect(iepWindows.length).toBeGreaterThan(0);
    for (const window of iepWindows) expect(window.evidenceRecordDigests).toContain("a".repeat(64));
    const unrelated = plan.windows.find((window) => window.obligations.every((item) => !item.documentIds.includes("document:iep") && item.documentIds.length > 0));
    if (unrelated) expect(unrelated.evidenceRecordDigests).not.toContain("a".repeat(64));
  });

  it("gives every executable window a share below the investigation ceiling", () => {
    const executable = plan.windows.filter((window) => window.executable);
    expect(executable.length).toBeGreaterThan(1);
    const grant = allocateWindowBudgets(executable.length);
    expect(grant.rounds).toBeLessThan(STUDY_AGENT_BUDGET.maxRounds);
    expect(grant.toolCalls).toBeLessThan(STUDY_AGENT_BUDGET.maxToolCalls);
    expect(grant.rounds * executable.length).toBeLessThanOrEqual(STUDY_AGENT_BUDGET.maxRounds - 1);
    for (const window of executable) expect(window.budget).toEqual(grant);
    expect(plan.dependencyCycle).toBe(false);
    const effective = compileEffectiveDomainPack({ base: prepared.prepared.pack });
    expect(effective.ok).toBe(true);
  });

  it("resumes without selecting a completed window", () => {
    const progress = startWindowProgress(plan);
    const first = selectNextInvestigationWindow(plan, progress);
    expect(first?.executable).toBe(true);
    if (!first) return;
    const completed = completeInvestigationWindow(progress, first.windowId, { factIds: ["fact:kept"], questionIds: first.questionIds });
    const second = selectNextInvestigationWindow(plan, completed);
    expect(second?.windowId).not.toBe(first.windowId);
    if (!second) return;
    let paused = recordWindowTurn(completed, second.windowId, {
      inputTokens: 1,
      outputTokens: 1,
      toolCalls: second.budget?.toolCalls ?? 1,
      invalidCalls: 0,
      calls: [{ id: "call-1", name: "search_case", arguments: "{\"query\":\"record\"}" }],
    });
    expect(paused.windows.find((window) => window.windowId === second.windowId)?.status).toBe("paused");
    expect(selectNextInvestigationWindow(plan, paused)?.windowId).not.toBe(second.windowId);
    const resumed = resumeWindowProgress(plan, paused);
    expect(resumed.windows.find((window) => window.windowId === first.windowId)?.status).toBe("complete");
    expect(selectNextInvestigationWindow(plan, resumed)?.windowId).not.toBe(first.windowId);
    expect(resumed.windows.find((window) => window.windowId === first.windowId)?.replay).toEqual([]);
    expect(resumed.windows.find((window) => window.windowId === second.windowId)?.replay).toHaveLength(1);
  });
});
