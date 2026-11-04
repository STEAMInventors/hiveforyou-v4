import {
  type AudienceConfiguration,
  audienceRoleLabel,
  type DomainCandidate,
  type DomainProposal,
  domainIsUncertain,
  EXECUTION_MANIFEST_SCHEMA,
  type ExecutionManifest,
  type IntentAnalysis,
  type IntentIntelligence,
  type InvestigationPlan,
  PREPARATION_PLANNER_TASKS,
  type ManifestSourceDocument,
  SOURCE_PAGE_INDEX_FORMAT,
  SOURCE_PAGES_PLACEHOLDER,
  type SourcePageRef,
  type SourceSnapshot,
  STUDY_AGENT_BUDGET,
  STUDY_INVESTIGATION_SCHEMA,
} from "@hiveforyou/contracts";

import { type PromptCatalog, sha256Digest } from "./prompt-catalog";

/**
 * Deterministic `hive-study-preview/1` assembly: the same validated inputs always produce the same
 * prompt text and digest. No model call, clock or randomness. `{{SOURCE_PAGES}}` stays in place for the
 * Canonical Study execution, bound by the manifest.
 */

export const MAX_OUTPUT_TOKENS_ADVISORY = STUDY_AGENT_BUDGET.maxOutputTokens;
const SOURCE_PAGES_BINDING_RULE =
  "Replace the single placeholder under '## 9. Case page index' with an index of every authorized page of every listed document, " +
  "in manifest order, after checking each page's pageSetDigest and text hash against this manifest: one line per document with its " +
  "sourceDocumentId, authorized page numbers and character count. Page text is served only by the read_pages tool from the same pages. " +
  "Refuse to execute on any mismatch.";

export type StudyPromptInputs = {
  readonly processingRunId: string;
  readonly catalog: PromptCatalog;
  readonly analysis: IntentAnalysis;
  readonly intelligence: IntentIntelligence;
  readonly domain: DomainProposal;
  readonly plan: InvestigationPlan;
  readonly audience: AudienceConfiguration;
  readonly sourceSnapshot: SourceSnapshot;
  readonly sourceSnapshotDigest: string;
  readonly intentSnapshotDigest: string;
  readonly coverageDigest: string;
  readonly intentRequestIds: readonly string[];
};

export type BuiltStudyPrompt = {
  readonly promptId: string;
  readonly promptVersion: string;
  readonly promptTemplateDigest: string;
  readonly promptText: string;
  readonly promptDigest: string;
  readonly executionManifest: ExecutionManifest;
};

/** Stable JSON (sorted object keys) so digests do not depend on property order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Derived content must never introduce a second template slot. */
function inert(text: string): string {
  return text.replace(/\{\{/g, "{ {").replace(/\}\}/g, "} }");
}

function authorizedPages(document: SourceSnapshot["documents"][number]): number[] {
  const missing = new Set(document.missingPageNumbers);
  const pages: number[] = [];
  for (let page = 1; page <= document.totalPhysicalPages; page += 1) {
    if (!missing.has(page)) pages.push(page);
  }
  return pages;
}

function pageList(pages: readonly number[]): string {
  return pages.length === 0 ? "none" : pages.join(", ");
}

function renderIntents(analysis: IntentAnalysis): string {
  return analysis.intents
    .map((intent, index) => {
      const quoted = inert(intent.verbatimText)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      const audience = intent.audience ? `\n\nFor: ${inert(intent.audience)}` : "";
      return `Request ${index + 1} (intentRequestId \`${intent.intentRequestId}\`):\n\n${quoted}${audience}`;
    })
    .join("\n\n");
}

function renderAudiences(audience: AudienceConfiguration): string {
  const customer = audience.customer;
  const pro = audience.pro;
  const lines = [
    `- Customer: ${inert(audienceRoleLabel("CUSTOMER", audience))} (${customer.status.toLowerCase()}, advisory confidence ${customer.confidence}; ${customer.detailLevel.toLowerCase()} detail)`,
    `- Pro: ${inert(audienceRoleLabel("PRO", audience))} (${pro.status.toLowerCase()}, advisory confidence ${pro.confidence}; ${pro.detailLevel.toLowerCase()} detail)`,
  ];
  if (pro.alternativeRoles.length > 0) {
    lines.push(`  - Other relevant professionals: ${pro.alternativeRoles.map(inert).join("; ")}`);
  }
  if (audience.studyGuidance.length > 0) {
    lines.push("- Coverage both reports need:", ...audience.studyGuidance.map((item) => `  - ${inert(item)}`));
  }
  return lines.join("\n");
}

function renderRefs(refs: readonly SourcePageRef[], fileNames: ReadonlyMap<string, string>): string {
  if (refs.length === 0) return "none";
  return refs
    .map((ref) => `${inert(fileNames.get(ref.sourceDocumentId) ?? "document")} (\`${ref.sourceDocumentId}\`) page ${ref.pageNumber}`)
    .join("; ");
}

function renderCandidate(candidate: DomainCandidate, fileNames: ReadonlyMap<string, string>): string[] {
  return [
    `${inert(candidate.label)}${candidate.subdomain ? ` — ${inert(candidate.subdomain)}` : ""}`,
    `  - Basis: ${inert(candidate.reasoning)}`,
    `  - Supporting sample pages: ${renderRefs(candidate.supportingRefs, fileNames)}`,
  ];
}

function renderDomain(domain: DomainProposal, plan: InvestigationPlan, fileNames: ReadonlyMap<string, string>): string {
  const [primaryLine, ...primaryDetails] = renderCandidate(domain.primary, fileNames);
  const lines = [
    `- Primary domain: ${primaryLine} (advisory confidence: ${domain.primary.confidence})`,
    ...primaryDetails,
  ];
  if (domain.alternatives.length > 0) {
    lines.push("- Alternative domains:");
    for (const alternative of domain.alternatives) {
      const [line, ...details] = renderCandidate(alternative, fileNames);
      lines.push(`  - ${line}`, ...details.map((detail) => `  ${detail}`));
    }
  }
  const flags = [
    domain.unknownDomain ? "domain unknown" : null,
    domain.mixedDomain ? "documents span more than one domain" : null,
    domain.ambiguous ? "classification is ambiguous" : null,
  ].filter((flag): flag is string => flag !== null);
  lines.push(
    `- Certainty: ${domainIsUncertain(domain) ? `uncertain${flags.length > 0 ? ` (${flags.join("; ")})` : ""}` : "no uncertainty recorded"}`,
  );
  for (const note of domain.ambiguityNotes) lines.push(`  - ${inert(note)}`);
  if (plan.domainBasis.considerations.length > 0) {
    lines.push("- What this domain implies for the investigation:");
    for (const consideration of plan.domainBasis.considerations) {
      lines.push(`  - ${inert(consideration.text)} (pages: ${renderRefs(consideration.supportingRefs, fileNames)})`);
    }
  }
  return lines.join("\n");
}

function optionalLine(label: string, value: string | null): string[] {
  return value ? [`- ${label}: ${inert(value)}`] : [];
}

function renderGoals(
  analysis: IntentAnalysis,
  intelligence: IntentIntelligence,
  plan: InvestigationPlan,
  fileNames: ReadonlyMap<string, string>,
): string {
  const requestNumber = new Map(analysis.intents.map((intent, index) => [intent.intentRequestId, index + 1]));
  const blocks = analysis.goals.map((goal) => {
    const lines = [
      `### ${goal.goalId} — ${inert(goal.goal)} (from request ${requestNumber.get(goal.intentRequestId) ?? "?"})`,
      "",
      `Stated as: "${inert(goal.statedAs)}"`,
      "",
      "What the person needs to find out:",
    ];
    for (const question of goal.questions) {
      lines.push(
        `- ${question.questionId} [${question.answerForm}] ${inert(question.question)}`,
        ...(question.needsJudgment ? ["  - Needs an assessment (criterion comes from the specialist questions)."] : []),
        ...(question.dependsOn.length > 0 ? [`  - After: ${question.dependsOn.join(", ")}`] : []),
      );
    }
    if (goal.unclear.length > 0) {
      lines.push("", "Ambiguities (do not resolve by guessing):");
      for (const unclear of goal.unclear) {
        lines.push(
          `- ${unclear.unclearId} about "${inert(unclear.about)}": ${unclear.possibleMeanings.map(inert).join("; ")}`,
          ...(unclear.likelyReading ? [`  - Likely reading (${unclear.likelyReadingBasis}): ${inert(unclear.likelyReading)}`] : []),
          `  - Ask the person: ${inert(unclear.askThePerson)}`,
        );
      }
    }
    lines.push("", "What a specialist would investigate to fulfil it:");
    for (const specialist of intelligence.questions.filter((question) => question.goalId === goal.goalId)) {
      lines.push(
        `- ${specialist.id}${specialist.requiresJudgment ? " [needs assessment]" : ""} ${inert(specialist.question)}`,
        `  - Why it matters: ${inert(specialist.whyItMatters)}`,
        `  - Supports: ${inert(specialist.supportsOutcome)}`,
        ...(specialist.judgmentBasis ? [`  - Assessment criterion: ${inert(specialist.judgmentBasis)}`] : []),
        ...(specialist.analysisQuestionIds.length > 0 ? [`  - Covers: ${specialist.analysisQuestionIds.join(", ")}`] : []),
        ...(specialist.dependsOn.length > 0 ? [`  - After: ${specialist.dependsOn.join(", ")}`] : []),
      );
    }
    const review = intelligence.completenessReview.find((item) => item.goalId === goal.goalId);
    if (review && review.remainingLimits.length > 0) {
      lines.push("", "What the documents alone may not settle:", ...review.remainingLimits.map((item) => `- ${inert(item)}`));
    }
    lines.push("", "Investigation questions:");
    for (const planQuestion of plan.questions.filter((question) => question.goalId === goal.goalId)) {
      lines.push(
        "",
        `#### ${planQuestion.id} [${planQuestion.answerType}] answers ${planQuestion.specialistQuestionIds.join(", ")}`,
        `- Establish: ${inert(planQuestion.establish)}`,
        `- Required evidence: ${planQuestion.requiredEvidence.map(inert).join("; ")}`,
        `- Depends on records: ${planQuestion.sourceDependencies.map(inert).join("; ")}`,
        ...optionalLine("Comparison", planQuestion.comparison),
        ...optionalLine("Chronology", planQuestion.chronology),
        ...optionalLine("Calculation", planQuestion.calculation),
        ...optionalLine("Evaluation", planQuestion.evaluation),
        `- If the evidence is missing: ${planQuestion.missingEvidenceConditions.map(inert).join("; ")}`,
        `- Answer structure: ${inert(planQuestion.deliverable)}`,
        ...(planQuestion.dependsOn.length > 0 ? [`- Answer after: ${planQuestion.dependsOn.join(", ")}`] : []),
        ...(planQuestion.domainConsiderationRefs.length > 0
          ? [`- Domain context pages: ${renderRefs(planQuestion.domainConsiderationRefs, fileNames)}`]
          : []),
      );
    }
    return lines.join("\n");
  });

  const tail: string[] = [];
  if (analysis.reservedDecisions.length > 0) {
    tail.push("", "### Decisions reserved for others (do not decide here)");
    for (const reserved of analysis.reservedDecisions) {
      tail.push(
        `- ${reserved.questionId}: ${inert(reserved.decision)}${reserved.decidedBy ? ` (decided by ${inert(reserved.decidedBy)})` : ""}`,
      );
    }
  }
  if (analysis.instructionsIgnored.length > 0) {
    tail.push("", "### Instructions ignored in the request text", ...analysis.instructionsIgnored.map((item) => `- ${inert(item)}`));
  }
  return tail.length > 0 ? [...blocks, tail.join("\n")].join("\n\n") : blocks.join("\n\n");
}

function renderCoverage(snapshot: SourceSnapshot, coverageDigest: string): string {
  const lines = [
    snapshot.coverageComplete
      ? "Coverage: complete — every page of every listed document was read and verified."
      : `Coverage: partial — the person reviewed and accepted these gaps before preparing (coverage digest \`${coverageDigest}\`).`,
    "",
    "Authorized documents (use only these, only these pages):",
    "",
    "| # | sourceDocumentId | File | Read | Physical pages | Authorized pages | Missing pages | Blank pages |",
    "|---|---|---|---|---|---|---|---|",
  ];
  snapshot.documents.forEach((document, index) => {
    lines.push(
      `| ${index + 1} | \`${document.sourceDocumentId}\` | ${inert(document.fileName).replace(/\|/g, "/")} | ${document.readStatus} | ${document.totalPhysicalPages} | ${pageList(authorizedPages(document))} | ${pageList(document.missingPageNumbers)} | ${pageList(document.emptyPageNumbers)} |`,
    );
  });
  if (snapshot.excluded.length > 0) {
    lines.push("", "Excluded documents (not available; do not assume their content):");
    for (const document of snapshot.excluded) {
      lines.push(`- ${inert(document.fileName)} (\`${document.sourceDocumentId}\`): ${document.reason}`);
    }
  }
  return lines.join("\n");
}

/** Fixed, code-owned execution instructions for the tool-calling investigation (D-042, D-044, V4-004I). */
function renderOutputContract(plan: InvestigationPlan, processingRunId: string, schemaDigest: string): string {
  const questionIds = plan.questions.map((question) => question.id).join(", ");
  return [
    "Investigate the entire authorized case corpus across all investigation questions together using the tools provided with this request. Do not investigate and finish `P1` in isolation before starting `P2`. Hive executes each tool call, checks it and replies with its result or the reason it was rejected; correct a rejected call instead of repeating it.",
    "",
    "**Recommended execution pattern** (adapt as the evidence requires; perform additional targeted `search_case` or `read_pages` calls whenever needed):",
    "1. **Locate and read relevant pages across all questions.** Call `read_pages` first (and `search_case` when needed, `1`–`3` consecutive pages per `read_pages` call) across the authorized documents needed for every question, reading all authorized non-empty pages of any `PRIMARY` document before quoting or recording it.",
    "2. **Batch verified evidence quotes and wait for confirmed `E…` IDs.** After `read_pages` returns page text, batch `record_evidence` calls using exact verbatim quotes from the pages you read to obtain confirmed `E…` ids. Do not call `record_document` or `record_document_finding` in the same turn as the `record_evidence` calls they depend on, and never predict `E…` or `DF…` identifiers.",
    "3. **Record document roles and atomic document findings using confirmed `E…` IDs.** Using only confirmed returned `E…` ids from that same document, call `record_document` (recording role, temporal status, and read coverage) and batch `record_document_finding` (`DF…`) to extract each significant atomic fact once (or `record_fact` for question-only facts). Only pass `relatedFindingIds` for `DF…` ids already returned in an earlier turn.",
    "4. **Record relationships, calculations, conflicts, assessments and professional determinations using confirmed `DF…` IDs.** Once `record_document_finding` (or `record_fact`) has returned confirmed `DF…` (or `F…`) ids, batch `record_calculation` (`C…`), `flag_conflict` (`K…`), `record_assessment` and `record_professional_determination` calls that cite those confirmed `DF…` (`findingIds` / `bearingFindingIds`) or same-question `F…` ids without duplicate `record_fact` calls.",
    `5. **Close completed questions and finish the Study.** Call \`finish_question\` exactly once for each investigation question (${questionIds}), citing confirmed reusable \`DF…\` \`findingIds\` (or \`evidenceIds\`) without duplicate \`record_fact\` calls and respecting any \`Answer after\` dependencies during synthesis and closure, then call \`finish_study\` only after all required questions are closed.`,
    "",
    "**Tool dependency and ID rules:**",
    "- **Batch independent calls, but never assume or predict an ID before the tool result that creates it.** `read_pages` must return before `record_evidence` quotes that page; `record_evidence` must return confirmed `E…` ids before `record_document`, `record_document_finding`, `record_fact`, `record_calculation`, `record_assessment` (`criterionEvidenceIds`), `flag_conflict` or `finish_question` cites `E…`; `record_document_finding` or `record_fact` must return confirmed `DF…` or `F…` ids before `record_document_finding` (`relatedFindingIds`), `record_calculation` (`findingIds`), `flag_conflict` (`findingIds`), `record_assessment` (`findingIds` / `factIds`), `record_professional_determination` (`bearingFindingIds` / `bearingFactIds`) or `finish_question` (`findingIds`) cites them.",
    "- **Evidence IDs (`E…`) and document finding IDs (`DF…`) can be shared across questions.** Record each distinct document fact once with `record_document_finding` (`DF…`) and reuse `DF…` and `E…` ids across any `P…` question instead of rereading pages or re-recording duplicate `record_fact` calls.",
    "- **Fact IDs (`F…`) used in assessments or determinations must belong to the same plan question.** `record_assessment` and `record_professional_determination` reject question-scoped `F…` ids recorded under a different `questionId` (`fact_other_question`), whereas case-wide `DF…` document finding ids (`findingIds` / `bearingFindingIds`) can be referenced by any question.",
    "- **Question closure rules:** `ANSWERED` and `PARTIALLY_ANSWERED` can be closed directly with confirmed `DF…` `findingIds` without duplicate `record_fact` calls: `ANSWERED` needs at least one referenced `DF…` finding (or recorded fact or calculation for that question), supporting `findingIds` or `evidenceIds`, and no flagged conflict; `PARTIALLY_ANSWERED` needs at least one referenced `DF…` finding (or fact or calculation) and at least one `limitations` entry. `CONFLICTING` needs a flagged conflict for that question. `MISSING_EVIDENCE` needs at least one prior `search_case` call (or referenced `DF…` finding) and at least one `limitations` entry.",
    "- **Calculations:** `formula` is a tree over `inputs`: leaves `{\"input\": <index into inputs>}` or `{\"value\": \"<plain number>\"}`; nodes `{\"op\": \"+\" | \"-\" | \"*\" | \"/\" | \"min\" | \"max\", \"args\": [...]}` or `{\"op\": \"round\", \"args\": [<one node>], \"places\": <0-6>}`. Each input's `valueAsWritten` contains exactly one number and appears in one of its evidence quotes (via `findingIds` or `evidenceIds`). Hive computes the result; do not send a `result` field.",
    `- **Assembly and budgets:** Hive assembles \`${STUDY_INVESTIGATION_SCHEMA}\` (schema digest \`${schemaDigest}\`) for run \`${processingRunId}\` from what you recorded; text outside tool calls is not kept. Tool calls, turns and time are bounded — batch independent calls across questions so the whole Study finishes within budget. An investigation that does not finish fails as a whole and is never reported as missing evidence.`,
  ].join("\n");
}

function manifestDocuments(snapshot: SourceSnapshot): ManifestSourceDocument[] {
  return snapshot.documents.map((document) => ({
    sourceDocumentId: document.sourceDocumentId,
    fileName: document.fileName,
    sha256: document.sha256,
    readFingerprint: document.readFingerprint,
    pageSetDigest: document.pageSetDigest,
    readStatus: document.readStatus,
    totalPhysicalPages: document.totalPhysicalPages,
    authorizedPageNumbers: authorizedPages(document),
  }));
}

export function buildStudyPrompt(inputs: StudyPromptInputs): BuiltStudyPrompt {
  const { catalog, analysis, intelligence, domain, plan, sourceSnapshot, processingRunId } = inputs;
  const fileNames = new Map(sourceSnapshot.documents.map((document) => [document.sourceDocumentId, document.fileName]));
  const slots: Record<string, string> = {
    PROMPT_ID: catalog.studyTemplate.id,
    INTENTS: renderIntents(analysis),
    AUDIENCES: renderAudiences(inputs.audience),
    DOMAIN: renderDomain(domain, plan, fileNames),
    OBJECTIVES: renderGoals(analysis, intelligence, plan, fileNames),
    COVERAGE: renderCoverage(sourceSnapshot, inputs.coverageDigest),
    OUTPUT_CONTRACT: renderOutputContract(plan, processingRunId, catalog.outputSchema.digest),
  };

  const promptText = catalog.studyTemplate.text.replace(/\{\{([A-Z_]+)\}\}/g, (match, name: string) => {
    if (match === SOURCE_PAGES_PLACEHOLDER) return match;
    const value = slots[name];
    if (value === undefined) throw new Error(`prompt_slot_unknown:${name}`);
    return value;
  });
  if (promptText.split(SOURCE_PAGES_PLACEHOLDER).length !== 2) {
    throw new Error("prompt_source_pages_binding_invalid");
  }

  const promptDigest = sha256Digest(promptText);
  const documents = manifestDocuments(sourceSnapshot);
  const executionManifest: ExecutionManifest = {
    schema: EXECUTION_MANIFEST_SCHEMA,
    prompt: {
      id: catalog.studyTemplate.id,
      version: catalog.studyTemplate.version,
      templateDigest: catalog.studyTemplate.digest,
      promptDigest,
      componentPrompts: PREPARATION_PLANNER_TASKS.map((task) => ({
        id: catalog.planner[task].id,
        digest: catalog.planner[task].digest,
      })),
    },
    outputContract: { id: STUDY_INVESTIGATION_SCHEMA, schemaDigest: catalog.outputSchema.digest },
    processingRunId,
    requiredInputs: {
      intentRequests: {
        intentRequestIds: [...inputs.intentRequestIds],
        intentSnapshotDigest: inputs.intentSnapshotDigest,
      },
      sourceDocuments: { sourceSnapshotDigest: inputs.sourceSnapshotDigest, documents },
      intentIntelligence: {
        schema: intelligence.schema,
        intelligenceDigest: sha256Digest(canonicalJson(intelligence)),
        questionIds: intelligence.questions.map((question) => question.id),
      },
      investigationPlan: {
        schema: plan.schema,
        planDigest: sha256Digest(canonicalJson(plan)),
        questionIds: plan.questions.map((question) => question.id),
      },
      audienceConfiguration: {
        schema: inputs.audience.schema,
        source: inputs.audience.source,
        audienceDigest: sha256Digest(canonicalJson(inputs.audience)),
      },
    },
    bindings: [
      {
        placeholder: SOURCE_PAGES_PLACEHOLDER,
        input: "sourceDocuments",
        format: SOURCE_PAGE_INDEX_FORMAT,
        rule: SOURCE_PAGES_BINDING_RULE,
      },
    ],
    coverage: {
      complete: sourceSnapshot.coverageComplete,
      coverageDigest: inputs.coverageDigest,
      excludedDocuments: sourceSnapshot.excluded.map((document) => ({
        sourceDocumentId: document.sourceDocumentId,
        reason: document.reason,
      })),
      missingPages: sourceSnapshot.documents
        .filter((document) => document.missingPageNumbers.length > 0)
        .map((document) => ({ sourceDocumentId: document.sourceDocumentId, pageNumbers: document.missingPageNumbers })),
      emptyPages: sourceSnapshot.documents
        .filter((document) => document.emptyPageNumbers.length > 0)
        .map((document) => ({ sourceDocumentId: document.sourceDocumentId, pageNumbers: document.emptyPageNumbers })),
    },
    limits: {
      authorizedPageCount: documents.reduce((total, document) => total + document.authorizedPageNumbers.length, 0),
      maxOutputTokensAdvisory: MAX_OUTPUT_TOKENS_ADVISORY,
    },
  };

  return {
    promptId: catalog.studyTemplate.id,
    promptVersion: catalog.studyTemplate.version,
    promptTemplateDigest: catalog.studyTemplate.digest,
    promptText,
    promptDigest,
    executionManifest,
  };
}
