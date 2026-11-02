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
  PLANNER_MAX_OUTPUT_TOKENS,
  PREPARATION_PLANNER_TASKS,
  type ManifestSourceDocument,
  SOURCE_PAGES_FORMAT,
  SOURCE_PAGES_PLACEHOLDER,
  type SourcePageRef,
  type SourceSnapshot,
  STUDY_INVESTIGATION_SCHEMA,
} from "@hiveforyou/contracts";

import { type PromptCatalog, sha256Digest } from "./prompt-catalog";

/**
 * Deterministic `hive-study-preview/1` assembly: the same validated inputs always produce the same
 * prompt text and digest. No model call, clock or randomness. `{{SOURCE_PAGES}}` stays in place for the
 * Canonical Study execution, bound by the manifest.
 */

export const MAX_OUTPUT_TOKENS_ADVISORY = PLANNER_MAX_OUTPUT_TOKENS.study;
const SOURCE_PAGES_BINDING_RULE =
  "Replace the single placeholder under '## 9. Source pages' with every authorized page of every listed document, " +
  "in manifest order, after checking each document's sha256, readFingerprint and pageSetDigest against this manifest. " +
  "Format each page as '### <sourceDocumentId> · page <pageNumber>' followed by its stored text. Refuse to execute on any mismatch.";

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

function renderOutputContract(plan: InvestigationPlan, processingRunId: string, schemaDigest: string): string {
  const evidence = { sourceDocumentId: "<uuid>", pageNumber: 1, quote: "<verbatim run of words from that page>" };
  const example = {
    schema: STUDY_INVESTIGATION_SCHEMA,
    processingRunId,
    answers: [
      {
        planQuestionId: plan.questions[0]?.id ?? "P1",
        status: "ANSWERED | PARTIALLY_ANSWERED | MISSING_EVIDENCE | CONFLICTING",
        answer: "<answer in the structure the question asks for>",
        facts: [{ statement: "<what one page says>", evidence: [evidence] }],
        calculations: [
          {
            description: "<what is computed>",
            inputs: [{ label: "<input>", valueAsWritten: "<value exactly as written>", evidence: [evidence] }],
            arithmetic: "<the arithmetic, step by step>",
            result: "<result as one number, optionally with its unit>",
            formula: { op: "*", args: [{ input: 0 }, { value: "2" }] },
          },
        ],
        assessments: [
          {
            judgment: "<the analytical judgment>",
            criterion: "<the criterion applied>",
            criterionSource: "DOCUMENT | GENERAL_KNOWLEDGE",
            criterionEvidence: [],
            factIndexes: [0],
            reasoning: "<from the facts to the judgment, step by step>",
            strength: "STRONG | MODERATE | TENTATIVE",
            wouldChangeIf: ["<what would change this assessment>"],
          },
        ],
        uncertainties: [],
        professionalDeterminations: [
          { determination: "<decision reserved for a professional or authority>", bearingFacts: [0], decidedBy: "<who decides>" },
        ],
        evidence: [evidence],
        conflicts: [],
        limitations: [],
      },
    ],
    coverageNotes: [],
    instructionsIgnored: [],
  };
  return [
    `Return exactly one JSON object conforming to \`${STUDY_INVESTIGATION_SCHEMA}\` (schema digest \`${schemaDigest}\`) and nothing else:`,
    "",
    "```json",
    JSON.stringify(example, null, 2),
    "```",
    "",
    `- Include exactly one answer for each investigation question: ${plan.questions.map((question) => question.id).join(", ")}.`,
    `- \`processingRunId\` must be \`${processingRunId}\`.`,
    "- Status values must be one of the four listed exactly. Use `[]` for empty lists.",
    "- `factIndexes` and `bearingFacts` are positions in the same answer's `facts` list. `criterionEvidence` is required when `criterionSource` is `DOCUMENT`.",
    "- Each calculation's `formula` repeats its arithmetic as a tree: leaves `{\"input\": <index into inputs>}` or `{\"value\": \"<plain number>\"}`; nodes `{\"op\": \"+\" | \"-\" | \"*\" | \"/\" | \"min\" | \"max\", \"args\": [...]}` or `{\"op\": \"round\", \"args\": [<one node>], \"places\": <0-6>}`. Each `valueAsWritten` must contain exactly one number and appear in its quote. Code recomputes every formula; a result it cannot reproduce is shown as unverified, so use `null` only when the arithmetic cannot be written this way.",
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
        format: SOURCE_PAGES_FORMAT,
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
