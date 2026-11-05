import type {
  EditorialAuthoredUncertaintyUnit,
  EditorialCompiledUncertaintyUnit,
  EditorialComponentPlan,
  EditorialPlan,
  EditorialSectionPlan,
  EditorialSummaryPlan,
  EditorialUncertaintyUnit,
} from "./editorial-plan-contracts";
import type { WriterEditorialInsight, WriterPriorityFinding, WriterSummaryDetailLevel } from "./writer-agent";
import type { ScenarioDefinition } from "./writer-report-contracts";

/** Partial editorial plan update for `patch_editorial_plan` (V4-004K.2). */
export type EditorialPlanPatch = {
  readonly audienceObjective?: string;
  readonly title?: string;
  readonly summaryDetailLevel?: WriterSummaryDetailLevel;
  readonly insights?: readonly WriterEditorialInsight[];
  readonly priorityFindings?: readonly WriterPriorityFinding[];
  readonly summary?: EditorialSummaryPlan;
  readonly sections?: readonly EditorialSectionPlan[];
  readonly components?: readonly (EditorialComponentPlan & { readonly index: number })[];
  readonly scenarios?: readonly ScenarioDefinition[];
};

function cloneUncertaintyUnit(unit: EditorialUncertaintyUnit): EditorialUncertaintyUnit {
  if ("mode" in unit && unit.mode === "compiled") {
    const compiled = unit as EditorialCompiledUncertaintyUnit;
    return { mode: "compiled", claimIds: [...(compiled.claimIds ?? [])] };
  }
  const authored = unit as EditorialAuthoredUncertaintyUnit;
  return { text: authored.text, claimRefs: [...(authored.claimRefs ?? [])] };
}

function cloneSectionPlan(section: EditorialSectionPlan): EditorialSectionPlan {
  return {
    ...section,
    ...(section.insightIds ? { insightIds: [...section.insightIds] } : {}),
    ...(section.documentedClaimIds ? { documentedClaimIds: [...section.documentedClaimIds] } : {}),
    ...(section.interpretation
      ? {
          interpretation: {
            text: section.interpretation.text,
            claimRefs: [...(section.interpretation.claimRefs ?? [])],
          },
        }
      : {}),
    ...(section.uncertainty ? { uncertainty: cloneUncertaintyUnit(section.uncertainty) } : {}),
    ...(section.missingDocumentRequests
      ? {
          missingDocumentRequests: section.missingDocumentRequests.map((req) => ({
            gapClaimIds: [...req.gapClaimIds],
            supportingClaimIds: [...req.supportingClaimIds],
            text: req.text,
            ...(req.blockedAnalysis !== undefined ? { blockedAnalysis: req.blockedAnalysis } : {}),
          })),
        }
      : {}),
  };
}

function mergeSections(
  base: readonly EditorialSectionPlan[],
  patches: readonly EditorialSectionPlan[],
): EditorialSectionPlan[] {
  const byId = new Map(base.map((section) => [section.id, cloneSectionPlan(section)]));
  for (const patch of patches) {
    byId.set(patch.id, cloneSectionPlan(patch));
  }
  const order = base.map((section) => section.id);
  for (const patch of patches) {
    if (!order.includes(patch.id)) order.push(patch.id);
  }
  return order.map((id) => byId.get(id)!);
}

function mergeInsights(
  base: readonly WriterEditorialInsight[] | undefined,
  patches: readonly WriterEditorialInsight[] | undefined,
): WriterEditorialInsight[] | undefined {
  if (!patches || patches.length === 0) return base ? [...base] : undefined;
  const byId = new Map((base ?? []).map((insight) => [insight.id, insight]));
  for (const patch of patches) {
    byId.set(patch.id, patch);
  }
  return [...byId.values()];
}

function mergeComponents(
  base: readonly EditorialComponentPlan[],
  patches: readonly (EditorialComponentPlan & { readonly index: number })[],
): EditorialComponentPlan[] {
  const merged = base.map((component) => ({ ...component }));
  for (const patch of patches) {
    const { index, ...component } = patch;
    if (!Number.isInteger(index) || index < 0 || index >= merged.length) {
      throw new Error(`editorial_plan_patch_component_index:${index}`);
    }
    merged[index] = { ...component };
  }
  return merged;
}

/**
 * Merges a focused patch into a base editorial plan without dropping unmentioned sections,
 * interpretations, uncertainties, insights, or component slots.
 */
export function mergeEditorialPlan(base: EditorialPlan, patch: EditorialPlanPatch): EditorialPlan {
  if (patch.components?.some((entry) => !Number.isInteger(entry.index) || entry.index < 0 || entry.index >= base.components.length)) {
    throw new Error("editorial_plan_patch_component_index");
  }
  return {
    ...(base.schema !== undefined ? { schema: base.schema } : {}),
    audience: base.audience,
    title: patch.title ?? base.title,
    audienceObjective: patch.audienceObjective ?? base.audienceObjective,
    summaryDetailLevel: patch.summaryDetailLevel ?? base.summaryDetailLevel,
    ...(mergeInsights(base.insights, patch.insights) !== undefined
      ? { insights: mergeInsights(base.insights, patch.insights)! }
      : base.insights !== undefined
        ? { insights: [...base.insights] }
        : {}),
    priorityFindings: patch.priorityFindings ? patch.priorityFindings.map((entry) => ({ ...entry })) : [...base.priorityFindings],
    summary: patch.summary ?? { ...base.summary, documentedClaimIds: [...(base.summary.documentedClaimIds ?? [])] },
    sections: patch.sections ? mergeSections(base.sections, patch.sections) : base.sections.map((section) => cloneSectionPlan(section)),
    components: patch.components ? mergeComponents(base.components, patch.components) : base.components.map((component) => ({ ...component })),
    scenarios:
      patch.scenarios !== undefined
        ? patch.scenarios.map((scenario) => ({ ...scenario }))
        : base.scenarios !== undefined
          ? base.scenarios.map((scenario) => ({ ...scenario }))
          : undefined,
  };
}
