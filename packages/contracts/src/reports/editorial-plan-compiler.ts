import {
  buildActiveTemporalClaimIds,
  buildHistoricalTemporalMap,
  type CanonicalFindingResolution,
} from "../analysis/canonical-finding-resolver";
import {
  type EvidenceRef,
  questionsWithAtomicFacts,
  type StudyClaim,
} from "../analysis/study-verification";
import { diagnosticFieldFromMessage } from "../errors/failure-diagnostic";
import {
  A2UI_COMPONENTS,
  type A2uiComponentName,
  BindRejection,
  buildReport,
  EVIDENCE_GRANULAR_KINDS,
  FINDING_GRANULAR_KINDS,
  validateViewComponentProposal,
  type ViewComponentValidationContext,
} from "./application-view-contracts";
import {
  EDITORIAL_PLAN_SCHEMA,
  EDITORIAL_SUPPORTED_COMPONENTS,
  type EditorialAuthoredUncertaintyUnit,
  type EditorialCompiledUncertaintyUnit,
  type EditorialComponentPlan,
  type EditorialMissingDocumentRequestUnit,
  type EditorialPlan,
  type EditorialSectionPlan,
  type EditorialUncertaintyUnit,
} from "./editorial-plan-contracts";
import {
  INSIGHT_ID_PATTERN,
  PLAN_QUESTION_ID_PATTERN,
  type WriterPlannedComponent,
  type WriterPlannedSection,
  type WriterPresentationPlan,
  WriterAgentLedger,
} from "./writer-agent";
import {
  BINDING_TOKEN,
  DOCUMENTED_KINDS,
  INTERPRETATION_KINDS,
  type MissingDocumentRequestMetadata,
  type ReportAudience,
  type ReportBlock,
  type ReportSection,
  SECTION_ID_PATTERN as WRITER_SECTION_ID_PATTERN,
  UNCERTAINTY_KINDS,
  validateReportBlock,
  validateWriterReport,
  visiblyCoversLimitation,
  visiblyPresentsUncertainty,
  WRITER_LIMITS,
  WRITER_REPORT_SCHEMA,
  type WriterReport,
  WriterRejection,
  type WriterTemporalValidationContext,
} from "./writer-report-contracts";

export class EditorialPlanRejection extends Error {
  constructor(
    readonly diagnosticReason: string,
    message: string,
    readonly diagnosticField?: string,
    readonly ungroundedValue?: string,
  ) {
    super(message);
  }
}

function reject(
  diagnosticReason: string,
  message: string,
  diagnosticField = diagnosticFieldFromMessage(message),
  ungroundedValue?: string,
): never {
  throw new EditorialPlanRejection(diagnosticReason, message, diagnosticField, ungroundedValue);
}

export type EditorialPlanCompileContext = {
  readonly reportRunId: string;
  readonly claims: readonly StudyClaim[];
  readonly fileNames: ReadonlyMap<string, string>;
  readonly canonicalFindings?: CanonicalFindingResolution | null;
  readonly asOf?: string | Date | null;
};

export type EditorialPlanCompileSuccess = {
  readonly ok: true;
  readonly presentationPlan: WriterPresentationPlan;
  readonly writerReport: WriterReport;
  readonly missingDocumentRequests: readonly MissingDocumentRequestMetadata[];
  readonly editorialPlanJsonBytes: number;
  readonly compiledWriterReportJsonBytes: number;
};

export type EditorialPlanCompileFailure = {
  readonly ok: false;
  readonly message: string;
  readonly diagnosticReason: string;
  readonly diagnosticField?: string;
  readonly component?: "editorial" | "writer" | "scenario" | "a2ui";
};

export type EditorialPlanCompileResult = EditorialPlanCompileSuccess | EditorialPlanCompileFailure;

const HISTORICAL_DOCUMENTED_SENTENCE =
  "This documented period ended before the report date; whether a newer plan exists is not established in the record.";

function claimMap(claims: readonly StudyClaim[]): ReadonlyMap<string, StudyClaim> {
  return new Map(claims.map((claim) => [claim.id, claim]));
}

function buildTemporalContext(
  claims: readonly StudyClaim[],
  canonicalFindings: CanonicalFindingResolution | null | undefined,
  asOf: string | Date | null | undefined,
): WriterTemporalValidationContext {
  const historicalByClaimId = buildHistoricalTemporalMap(claims, { canonicalFindings, asOf });
  const activeClaimIds = buildActiveTemporalClaimIds(claims, { canonicalFindings, asOf });
  return { historicalByClaimId, activeClaimIds };
}

function assertKnownClaims(ids: readonly string[], claims: ReadonlyMap<string, StudyClaim>, path: string): void {
  ids.forEach((id, index) => {
    if (!claims.has(id)) {
      reject("editorial_plan_claim_unknown", `${path}[${index}] (${id}) is not a Study claim.`, `${path}[${index}]`);
    }
  });
}

function assertDocumentedKinds(ids: readonly string[], claims: ReadonlyMap<string, StudyClaim>, path: string): void {
  ids.forEach((id, index) => {
    const claim = claims.get(id)!;
    if (!DOCUMENTED_KINDS.has(claim.kind)) {
      reject(
        "editorial_plan_claim_kind",
        `${path}[${index}] cites ${id}, which cannot support deterministic DOCUMENTED content.`,
        `${path}[${index}]`,
      );
    }
    if (claim.kind === "CALCULATION" && claim.numericStatus !== "VERIFIED") {
      reject(
        "editorial_plan_claim_kind",
        `${path}[${index}] cites unverified calculation ${id}.`,
        `${path}[${index}]`,
      );
    }
  });
}

function assertInterpretationKinds(ids: readonly string[], claims: ReadonlyMap<string, StudyClaim>, path: string): void {
  ids.forEach((id, index) => {
    const claim = claims.get(id)!;
    if (!INTERPRETATION_KINDS.has(claim.kind)) {
      reject(
        "editorial_plan_claim_kind",
        `${path}[${index}] cites ${id}, which cannot support INTERPRETATION content.`,
        `${path}[${index}]`,
      );
    }
    if (claim.kind === "CALCULATION" && claim.numericStatus !== "VERIFIED") {
      reject(
        "editorial_plan_claim_kind",
        `${path}[${index}] cites unverified calculation ${id}.`,
        `${path}[${index}]`,
      );
    }
  });
}

function assertUncertaintyKinds(ids: readonly string[], claims: ReadonlyMap<string, StudyClaim>, path: string): void {
  ids.forEach((id, index) => {
    const claim = claims.get(id)!;
    if (!UNCERTAINTY_KINDS.has(claim.kind)) {
      reject(
        "editorial_plan_claim_kind",
        `${path}[${index}] cites ${id}, which cannot support UNCERTAINTY content.`,
        `${path}[${index}]`,
      );
    }
  });
}

function ensureSentencePunctuation(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return /[.!?][)"'\]]*$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function normalizeExactPhraseKey(value: string): string {
  return ensureSentencePunctuation(value).toLowerCase();
}

function hasExplicitHistoricalFraming(value: string): boolean {
  return /\bended before\b/i.test(value) || /\bnot established in the record\b/i.test(value);
}

function documentedPhraseForClaim(claim: StudyClaim): string {
  return ensureSentencePunctuation(claim.text);
}

function joinDocumentedPhrases(
  claimIds: readonly string[],
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext?: WriterTemporalValidationContext,
): string {
  const historicalByClaimId = temporalContext?.historicalByClaimId;
  const entries: { phrase: string; claimIds: string[] }[] = [];
  const entryByKey = new Map<string, { phrase: string; claimIds: string[] }>();

  for (const id of claimIds) {
    const phrase = documentedPhraseForClaim(claims.get(id)!);
    if (!phrase) continue;
    const key = normalizeExactPhraseKey(phrase);
    const existing = entryByKey.get(key);
    if (existing) {
      existing.claimIds.push(id);
    } else {
      const entry = { phrase, claimIds: [id] };
      entryByKey.set(key, entry);
      entries.push(entry);
    }
  }

  const framedPeriodKeys = new Set<string>();
  if (historicalByClaimId && historicalByClaimId.size > 0) {
    for (const entry of entries) {
      if (!hasExplicitHistoricalFraming(entry.phrase)) continue;
      for (const id of entry.claimIds) {
        const historical = historicalByClaimId.get(id);
        if (historical) {
          framedPeriodKeys.add(`${historical.startDate ?? ""}..${historical.endDate ?? ""}`);
        }
      }
    }
  }

  const parts: string[] = [];
  for (const entry of entries) {
    if (historicalByClaimId && historicalByClaimId.size > 0 && !hasExplicitHistoricalFraming(entry.phrase)) {
      const historical = entry.claimIds
        .map((id) => historicalByClaimId.get(id))
        .find((item) => item !== undefined && !framedPeriodKeys.has(`${item.startDate ?? ""}..${item.endDate ?? ""}`));
      if (historical) {
        const periodKey = `${historical.startDate ?? ""}..${historical.endDate ?? ""}`;
        framedPeriodKeys.add(periodKey);
        parts.push(`${entry.phrase} ${HISTORICAL_DOCUMENTED_SENTENCE}`);
        continue;
      }
    }
    parts.push(entry.phrase);
  }
  return parts.join(" ");
}

function compileSummaryBlock(
  plan: EditorialPlan["summary"],
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext: WriterTemporalValidationContext,
): ReportBlock {
  const path = "summary[0]";
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.documentedClaimIds) || plan.documentedClaimIds.length === 0) {
    reject(
      "editorial_plan_shape",
      "summary.documentedClaimIds must be a non-empty list of Study claim IDs.",
      "summary.documentedClaimIds",
    );
  }
  assertKnownClaims(plan.documentedClaimIds, claims, "summary.documentedClaimIds");
  assertDocumentedKinds(plan.documentedClaimIds, claims, "summary.documentedClaimIds");
  const claimRefs = [...plan.documentedClaimIds];
  const calcTokens: string[] = [];
  for (const binding of plan.calculationBindings ?? []) {
    if (!claims.has(binding.calcId)) {
      reject("editorial_plan_claim_unknown", `summary.calculationBindings calcId ${binding.calcId} is not a Study claim.`);
    }
    const calc = claims.get(binding.calcId)!;
    if (calc.kind !== "CALCULATION" || calc.numericStatus !== "VERIFIED") {
      reject(
        "editorial_plan_claim_kind",
        `summary.calculationBindings calcId ${binding.calcId} must be a verified calculation.`,
      );
    }
    if (!claimRefs.includes(binding.calcId)) claimRefs.push(binding.calcId);
    calcTokens.push(`({{calc:${binding.calcId}}}${binding.suffix ?? ""})`);
  }
  let text = joinDocumentedPhrases(plan.documentedClaimIds, claims, temporalContext);
  if (calcTokens.length > 0) {
    text = `${text} ${calcTokens.join(" ")}`;
  }
  return validateReportBlock(
    { type: "DOCUMENTED", text, claimRefs },
    path,
    claims,
    temporalContext,
  ).block;
}

function compileInterpretationBlock(
  unit: { text: string; claimRefs: readonly string[] },
  path: string,
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext: WriterTemporalValidationContext,
): ReportBlock {
  assertKnownClaims(unit.claimRefs, claims, `${path}.claimRefs`);
  assertInterpretationKinds(unit.claimRefs, claims, `${path}.claimRefs`);
  if (unit.text.trim() === "" || unit.text.length > WRITER_LIMITS.blockText) {
    reject("editorial_plan_shape", `${path}.text must be non-empty text up to ${WRITER_LIMITS.blockText} characters.`, `${path}.text`);
  }
  return validateReportBlock(
    { type: "INTERPRETATION", text: unit.text.trim(), claimRefs: [...unit.claimRefs] },
    path,
    claims,
    temporalContext,
  ).block;
}

function compileUncertaintyBlock(
  unit: EditorialUncertaintyUnit,
  path: string,
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext: WriterTemporalValidationContext,
): ReportBlock {
  const partiallyAnsweredQuestions = new Set<string>(
    [...claims.values()]
      .filter((c) => c.kind === "ANSWER" && c.answerStatus === "PARTIALLY_ANSWERED" && c.planQuestionId !== null)
      .map((c) => c.planQuestionId as string),
  );
  if ("mode" in unit && unit.mode === "compiled") {
    const compiled = unit as EditorialCompiledUncertaintyUnit;
    assertKnownClaims(compiled.claimIds, claims, `${path}.claimIds`);
    assertUncertaintyKinds(compiled.claimIds, claims, `${path}.claimIds`);
    const text = joinDocumentedPhrases(compiled.claimIds, claims);
    return validateReportBlock(
      { type: "UNCERTAINTY", text, claimRefs: [...compiled.claimIds] },
      path,
      claims,
      temporalContext,
    ).block;
  }
  const authored = unit as EditorialAuthoredUncertaintyUnit;
  assertKnownClaims(authored.claimRefs, claims, `${path}.claimRefs`);
  assertUncertaintyKinds(authored.claimRefs, claims, `${path}.claimRefs`);
  if (authored.text.trim() === "" || authored.text.length > WRITER_LIMITS.blockText) {
    reject("editorial_plan_shape", `${path}.text must be non-empty text up to ${WRITER_LIMITS.blockText} characters.`, `${path}.text`);
  }
  const originalRefs = new Set(authored.claimRefs);
  const claimRefs = [...authored.claimRefs];
  const touchedPartialQuestions = new Set<string>();
  for (const ref of claimRefs) {
    const claim = claims.get(ref);
    if (claim?.planQuestionId && partiallyAnsweredQuestions.has(claim.planQuestionId)) {
      touchedPartialQuestions.add(claim.planQuestionId);
    }
  }
  for (const c of claims.values()) {
    if (c.kind === "LIMITATION" && c.planQuestionId && touchedPartialQuestions.has(c.planQuestionId) && !claimRefs.includes(c.id)) {
      claimRefs.push(c.id);
    }
  }
  let text = ensureSentencePunctuation(authored.text.trim());
  for (const ref of claimRefs) {
    const claim = claims.get(ref);
    if (
      claim &&
      claim.kind === "LIMITATION" &&
      claim.planQuestionId &&
      partiallyAnsweredQuestions.has(claim.planQuestionId) &&
      (!originalRefs.has(claim.id) ? !visiblyCoversLimitation(text, claim) : !visiblyPresentsUncertainty(text, claim))
    ) {
      const limSentence = ensureSentencePunctuation(claim.text);
      if (limSentence) text = `${text} ${limSentence}`;
    }
  }
  return validateReportBlock(
    { type: "UNCERTAINTY", text, claimRefs },
    path,
    claims,
    temporalContext,
  ).block;
}

const MISSING_RECORD_TARGETS: readonly { readonly key: string; readonly re: RegExp }[] = [
  {
    key: "progress_reports",
    re: /\b(?:progress\s+reports?|quarterly\s+(?:progress\s+)?(?:reports?|probes?)|oral[- ]reading[- ]fluency\s+probes?|fluency\s+probes?|progress\s+monitoring|progress\s+data|interim\s+probes?)\b/i,
  },
  {
    key: "evaluation_report",
    re: /\b(?:academic\s+evaluation|psychoeducational\s+evaluation|evaluation\s+report|comprehension\s+(?:score|assessment|evaluation))\b/i,
  },
  {
    key: "successor_iep",
    re: /\b(?:successor\s+iep|subsequent\s+iep|newer\s+(?:iep|plan)|replacement\s+(?:iep|plan)|updated\s+iep)\b/i,
  },
  {
    key: "service_logs",
    re: /\b(?:service\s+logs?|delivery\s+logs?|attendance\s+logs?|session\s+logs?|therapy\s+logs?)\b/i,
  },
];

const NON_DOCUMENT_ARTIFACT_RE =
  /\b(?: Prior\s+Written\s+Notice|PWN\b|Functional\s+Behavioral\s+Assessment|FBA\b|Behavior\s+Intervention\s+Plan|BIP\b|medical\s+diagnosis|hospital\s+records?|tax\s+returns?|bank\s+statements?|deed|mortgage|disciplinary\s+records?|suspension\s+notice|report\s+cards?|classroom\s+work\s+samples?|standardized\s+state\s+test)\b/i;

const MISSING_GAP_CUE_RE =
  /\b(?:missing|absent|not\s+(?:included|attached|separately\s+attached|provided|available|reported|collected|in\s+the\s+record|in\s+this\s+(?:single-document\s+)?corpus|in\s+the\s+case\s+records|present)|no\s+(?:\w+\s+){0,5}(?:probe|probes|report|reports|record|records|score|scores|data|evaluation|iep|log|logs)|only\s+one\s+(?:progress|evaluation|measurement)|unassessed|cannot\s+be\s+(?:assessed|determined))\b/i;

const REQUEST_STOPWORDS = new Set([
  "have",
  "does",
  "do",
  "you",
  "the",
  "can",
  "could",
  "would",
  "will",
  "please",
  "share",
  "upload",
  "provide",
  "attach",
  "send",
  "bring",
  "from",
  "with",
  "that",
  "this",
  "these",
  "those",
  "what",
  "when",
  "where",
  "which",
  "whether",
  "after",
  "before",
  "during",
  "since",
  "until",
  "into",
  "over",
  "under",
  "about",
  "their",
  "there",
  "were",
  "been",
  "being",
  "also",
  "more",
  "most",
  "some",
  "such",
  "than",
  "then",
  "them",
  "they",
  "your",
  "for",
  "and",
  "are",
  "was",
  "not",
  "any",
  "all",
  "copy",
  "copies",
  "available",
  "missing",
  "needed",
  "confirm",
  "verify",
  "determine",
  "evaluate",
  "assess",
  "blocks",
  "blocked",
  "analysis",
]);

function significantWords(value: string): Set<string> {
  const words = new Set<string>();
  for (const raw of value.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
    const stem = raw.replace(/(?:ing|ed|es|s)$/, "");
    if (!REQUEST_STOPWORDS.has(raw) && !REQUEST_STOPWORDS.has(stem) && stem.length >= 3) {
      words.add(stem);
    }
  }
  return words;
}

function detectTargetKeys(value: string): string[] {
  const matched: string[] = [];
  for (const target of MISSING_RECORD_TARGETS) {
    if (target.re.test(value)) matched.push(target.key);
  }
  return matched;
}

/**
 * Derives a deterministic canonical missing-document request ID (`mdr:<question_scope>:<target_key>`)
 * from the verified Study gap identity and the missing-record target. Independent of audience,
 * wording, section ordering, or model-generated identifiers.
 */
export function deriveMissingDocumentRequestId(
  gapClaims: readonly StudyClaim[],
  supportingClaims: readonly StudyClaim[],
  requestText: string,
): { readonly requestId: string; readonly targetKey: string } {
  const questionIds = new Set<string>();
  for (const claim of gapClaims) {
    if (claim.planQuestionId) questionIds.add(claim.planQuestionId.toLowerCase());
    for (const qId of claim.questionIds ?? []) questionIds.add(qId.toLowerCase());
  }
  if (questionIds.size === 0) {
    for (const claim of supportingClaims) {
      if (claim.planQuestionId) questionIds.add(claim.planQuestionId.toLowerCase());
      for (const qId of claim.questionIds ?? []) questionIds.add(qId.toLowerCase());
    }
  }
  const sortedQuestions = [...questionIds].sort();
  const questionScope = sortedQuestions.length > 0 ? sortedQuestions.join("-") : "study";

  const gapAndSupportingCorpus = [
    ...gapClaims.map((c) => c.text),
    ...supportingClaims.map((c) => c.text),
    ...supportingClaims.flatMap((c) => c.quotes),
  ].join(" ");
  const supportedTargets = new Set(detectTargetKeys(gapAndSupportingCorpus));
  const requestedTargets = detectTargetKeys(requestText).filter((key) => supportedTargets.has(key));
  const targetKey =
    requestedTargets[0] ??
    [...supportedTargets][0] ??
    [...gapClaims.map((c) => c.id.toLowerCase().replace(/[^a-z0-9]/g, ""))].sort().join("-");

  return {
    requestId: `mdr:${questionScope}:${targetKey}`,
    targetKey,
  };
}

function collectSupportingRefs(supportingClaims: readonly StudyClaim[]): EvidenceRef[] {
  const seen = new Set<string>();
  const refs: EvidenceRef[] = [];
  for (const claim of supportingClaims) {
    for (const ref of claim.refs) {
      const key = `${ref.sourceDocumentId.toLowerCase()}:${ref.pageNumber}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ sourceDocumentId: ref.sourceDocumentId, pageNumber: ref.pageNumber });
      }
    }
  }
  return refs;
}

function compileMissingDocumentRequestBlock(
  unit: EditorialMissingDocumentRequestUnit,
  audience: ReportAudience,
  path: string,
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext: WriterTemporalValidationContext,
): ReportBlock {
  if (!unit || typeof unit !== "object" || Array.isArray(unit)) {
    reject("editorial_plan_shape", `${path} must be an object.`, path);
  }
  if (!Array.isArray(unit.gapClaimIds) || unit.gapClaimIds.length === 0 || unit.gapClaimIds.length > WRITER_LIMITS.claimRefsPerBlock) {
    reject(
      "editorial_plan_shape",
      `${path}.gapClaimIds must be a non-empty list of verified gap claim IDs.`,
      `${path}.gapClaimIds`,
    );
  }
  if (
    !Array.isArray(unit.supportingClaimIds) ||
    unit.supportingClaimIds.length === 0 ||
    unit.supportingClaimIds.length > WRITER_LIMITS.claimRefsPerBlock
  ) {
    reject(
      "editorial_plan_shape",
      `${path}.supportingClaimIds must be a non-empty list of page-backed source fact claim IDs.`,
      `${path}.supportingClaimIds`,
    );
  }
  assertKnownClaims(unit.gapClaimIds, claims, `${path}.gapClaimIds`);
  assertKnownClaims(unit.supportingClaimIds, claims, `${path}.supportingClaimIds`);

  const gapClaims = unit.gapClaimIds.map((id, index) => {
    const claim = claims.get(id)!;
    const isAllowedGapKind =
      claim.kind === "UNCERTAINTY" ||
      claim.kind === "LIMITATION" ||
      (claim.kind === "ANSWER" && (claim.answerStatus === "MISSING_EVIDENCE" || claim.answerStatus === "PARTIALLY_ANSWERED"));
    if (!isAllowedGapKind) {
      reject(
        "editorial_plan_claim_kind",
        `${path}.gapClaimIds[${index}] cites ${id} (${claim.kind}${claim.answerStatus ? `:${claim.answerStatus}` : ""}), which is not a verified MISSING_EVIDENCE, PARTIALLY_ANSWERED, LIMITATION, or UNCERTAINTY gap claim.`,
        `${path}.gapClaimIds[${index}]`,
      );
    }
    return claim;
  });

  const combinedGapText = gapClaims.map((c) => c.text).join(" ");
  if (!MISSING_GAP_CUE_RE.test(combinedGapText)) {
    reject(
      "editorial_plan_request_ungrounded",
      `${path}.gapClaimIds does not establish a missing-record or missing-evidence gap.`,
      `${path}.gapClaimIds`,
    );
  }

  const supportingClaims = unit.supportingClaimIds.map((id, index) => {
    const claim = claims.get(id)!;
    if (claim.kind !== "FACT") {
      reject(
        "editorial_plan_claim_kind",
        `${path}.supportingClaimIds[${index}] cites ${id} (${claim.kind}); supportingClaimIds must cite source FACT claims (DF… or P#.F#).`,
        `${path}.supportingClaimIds[${index}]`,
      );
    }
    if (claim.refs.length === 0) {
      reject(
        "editorial_plan_request_ungrounded",
        `${path}.supportingClaimIds[${index}] (${id}) has no source page reference.`,
        `${path}.supportingClaimIds[${index}]`,
      );
    }
    return claim;
  });

  const rawText = typeof unit.text === "string" ? unit.text.trim() : "";
  if (rawText === "" || rawText.length > WRITER_LIMITS.blockText) {
    reject(
      "editorial_plan_shape",
      `${path}.text must be non-empty text up to ${WRITER_LIMITS.blockText} characters.`,
      `${path}.text`,
    );
  }

  const blockedAnalysis =
    unit.blockedAnalysis !== undefined && unit.blockedAnalysis !== null ? String(unit.blockedAnalysis).trim() : undefined;
  if (audience === "PRO" && (!blockedAnalysis || blockedAnalysis.length === 0)) {
    reject(
      "editorial_plan_shape",
      `${path}.blockedAnalysis is required for PRO missing-document requests to state the analysis blocked by the missing record.`,
      `${path}.blockedAnalysis`,
    );
  }

  const evidenceCorpus = [
    ...gapClaims.map((c) => c.text),
    ...supportingClaims.map((c) => c.text),
    ...supportingClaims.flatMap((c) => c.quotes),
    ...supportingClaims
      .map((c) => [c.documentFinding?.subject, c.documentFinding?.attribute, c.documentFinding?.valueAsWritten, c.documentFinding?.section].filter(Boolean).join(" ")),
  ].join(" ");

  if (NON_DOCUMENT_ARTIFACT_RE.test(rawText) && !NON_DOCUMENT_ARTIFACT_RE.test(evidenceCorpus)) {
    reject(
      "editorial_plan_request_ungrounded",
      `${path}.text requests an invented document type not supported by the verified gap or source facts.`,
      `${path}.text`,
    );
  }

  const supportedTargets = new Set(detectTargetKeys(evidenceCorpus));
  const requestedTargets = detectTargetKeys(rawText);
  if (requestedTargets.length > 0 && supportedTargets.size > 0 && !requestedTargets.some((t) => supportedTargets.has(t))) {
    reject(
      "editorial_plan_request_ungrounded",
      `${path}.text requests a document target (${requestedTargets.join(", ")}) that is not supported by the cited gap (${[...supportedTargets].join(", ")}).`,
      `${path}.text`,
    );
  }

  const corpusWords = significantWords(evidenceCorpus);
  const requestWords = significantWords(rawText);
  let overlapCount = 0;
  for (const word of requestWords) {
    if (corpusWords.has(word)) overlapCount += 1;
  }
  if (overlapCount === 0) {
    reject(
      "editorial_plan_request_ungrounded",
      `${path}.text is not grounded in the cited gap and supporting source facts.`,
      `${path}.text`,
    );
  }

  const claimRefs = [...new Set([...unit.gapClaimIds, ...unit.supportingClaimIds])];
  const { requestId, targetKey } = deriveMissingDocumentRequestId(gapClaims, supportingClaims, `${rawText} ${blockedAnalysis ?? ""}`);
  const refs = collectSupportingRefs(supportingClaims);

  let compiledText = rawText;
  if (audience === "CUSTOMER") {
    if (!compiledText.endsWith("?")) {
      compiledText = `${compiledText.replace(/[.!]+$/, "")}?`;
    }
  } else if (blockedAnalysis) {
    const normalizedText = compiledText.toLowerCase();
    const normalizedBlocked = blockedAnalysis.toLowerCase();
    if (!normalizedText.includes(normalizedBlocked)) {
      const baseText = /[.!?]$/.test(compiledText) ? compiledText : `${compiledText}?`;
      const blockedSentence = ensureSentencePunctuation(
        /^blocked\s+analysis\s*:/i.test(blockedAnalysis) ? blockedAnalysis : `Blocked analysis: ${blockedAnalysis}`,
      );
      compiledText = `${baseText} ${blockedSentence}`;
    }
  }

  const validated = validateReportBlock(
    {
      type: "QUESTION",
      text: compiledText,
      claimRefs,
      missingDocumentRequest: {
        requestId,
        targetKey,
        gapClaimIds: [...unit.gapClaimIds],
        supportingClaimIds: [...unit.supportingClaimIds],
        refs,
        ...(blockedAnalysis ? { blockedAnalysis } : {}),
      },
    },
    path,
    claims,
    temporalContext,
  );
  return validated.block;
}

function compileDocumentedBlock(
  claimIds: readonly string[],
  path: string,
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext: WriterTemporalValidationContext,
): ReportBlock {
  assertKnownClaims(claimIds, claims, path);
  assertDocumentedKinds(claimIds, claims, path);
  const text = joinDocumentedPhrases(claimIds, claims, temporalContext);
  return validateReportBlock({ type: "DOCUMENTED", text, claimRefs: [...claimIds] }, path, claims, temporalContext).block;
}

function normalizeCellValueKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function formatCellFromClaims(cellClaimIds: readonly string[], claims: ReadonlyMap<string, StudyClaim>): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const id of cellClaimIds) {
    const claim = claims.get(id)!;
    const value = claim.documentFinding?.valueAsWritten?.trim();
    const display = (value && value.length > 0 ? value : claim.text.trim()).replace(/\s+/g, " ").trim();
    if (!display) continue;
    const key = normalizeCellValueKey(display);
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(display);
  }
  return parts.join(" · ");
}

function compileViewProps(
  component: EditorialComponentPlan,
  componentIndex: number,
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext: WriterTemporalValidationContext,
  sectionIds: ReadonlySet<string>,
  scenarioIds: ReadonlySet<string>,
  hasOutline: boolean,
): Record<string, unknown> {
  const compPath = `components[${componentIndex}]`;
  if (!(EDITORIAL_SUPPORTED_COMPONENTS as readonly string[]).includes(component.component)) {
    reject(
      "editorial_plan_shape",
      `Component ${String(component.component)} at ${compPath}.component is not supported by the editorial compiler. Supported components: ${EDITORIAL_SUPPORTED_COMPONENTS.join(", ")}.`,
      `${compPath}.component`,
    );
  }
  const layout = component.layout;
  if (!layout || typeof layout !== "object") {
    reject("editorial_plan_shape", `${compPath}.layout must be an object.`, `${compPath}.layout`);
  }
  switch (component.component) {
    case "Narrative": {
      if (layout.kind !== "Narrative") {
        reject("editorial_plan_shape", `${compPath}.layout must be Narrative.`, `${compPath}.layout`);
      }
      if (component.sectionId === "summary") return { sectionId: "summary" };
      if (typeof component.sectionId !== "string" || !sectionIds.has(component.sectionId)) {
        reject("editorial_plan_shape", "Narrative components require a valid sectionId.", `${compPath}.sectionId`);
      }
      return { sectionId: component.sectionId };
    }
    case "RecordTable": {
      if (layout.kind !== "RecordTable") reject("editorial_plan_shape", "RecordTable layout mismatch.", `${compPath}.layout`);
      const rows = layout.rows.map((row, rowIndex) => {
        const rowPath = `${compPath}.layout.rows[${rowIndex}]`;
        if (Array.isArray(row.cells) && Array.isArray(row.claimRefs)) {
          if (row.cells.length !== layout.columns.length) {
            reject(
              "editorial_plan_shape",
              `RecordTable row ${rowIndex} must provide one cell string per column.`,
              rowPath,
            );
          }
          assertKnownClaims(row.claimRefs, claims, `${rowPath}.claimRefs`);
          assertDocumentedKinds(row.claimRefs, claims, `${rowPath}.claimRefs`);
          return { cells: [...row.cells], claimRefs: [...row.claimRefs] };
        }
        const cellClaimIds = row.cellClaimIds;
        if (!cellClaimIds) {
          reject(
            "editorial_plan_shape",
            `RecordTable row ${rowIndex} must provide cellClaimIds or model-authored cells with claimRefs.`,
            rowPath,
          );
        }
        if (cellClaimIds.length !== layout.columns.length) {
          reject(
            "editorial_plan_shape",
            `RecordTable row ${rowIndex} must provide one cellClaimIds entry per column.`,
            rowPath,
          );
        }
        const cells = cellClaimIds.map((ids, cellIndex) => {
          assertKnownClaims(ids, claims, `RecordTable.rows[${rowIndex}].cells[${cellIndex}]`);
          assertDocumentedKinds(ids, claims, `RecordTable.rows[${rowIndex}].cells[${cellIndex}]`);
          return formatCellFromClaims(ids, claims);
        });
        const claimRefs = [...new Set(cellClaimIds.flat())];
        return { cells, claimRefs };
      });
      return { title: layout.title, columns: [...layout.columns], rows };
    }
    case "Comparison": {
      if (layout.kind !== "Comparison") reject("editorial_plan_shape", "Comparison layout mismatch.", `${compPath}.layout`);
      const items = layout.items.map((item, index) => {
        const itemPath = `${compPath}.layout.items[${index}]`;
        if (item.left !== undefined && item.right !== undefined) {
          const leftClaimIds = item.leftClaimIds ?? [];
          const rightClaimIds = item.rightClaimIds ?? [];
          const claimRefs = [...new Set(item.claimRefs ?? [...leftClaimIds, ...rightClaimIds])];
          assertKnownClaims(claimRefs, claims, `${itemPath}.claimRefs`);
          assertDocumentedKinds(claimRefs, claims, `${itemPath}.claimRefs`);
          if (leftClaimIds.length > 0) {
            assertKnownClaims(leftClaimIds, claims, `${itemPath}.leftClaimIds`);
            assertDocumentedKinds(leftClaimIds, claims, `${itemPath}.leftClaimIds`);
          }
          if (rightClaimIds.length > 0) {
            assertKnownClaims(rightClaimIds, claims, `${itemPath}.rightClaimIds`);
            assertDocumentedKinds(rightClaimIds, claims, `${itemPath}.rightClaimIds`);
          }
          return { label: item.label, left: item.left, right: item.right, claimRefs };
        }
        const leftClaimIds = item.leftClaimIds;
        const rightClaimIds = item.rightClaimIds;
        if (!leftClaimIds || !rightClaimIds) {
          reject(
            "editorial_plan_shape",
            `Comparison item ${index} must provide leftClaimIds and rightClaimIds or model-authored left/right with claimRefs.`,
            itemPath,
          );
        }
        assertKnownClaims(leftClaimIds, claims, `${itemPath}.leftClaimIds`);
        assertKnownClaims(rightClaimIds, claims, `${itemPath}.rightClaimIds`);
        assertDocumentedKinds(leftClaimIds, claims, `${itemPath}.leftClaimIds`);
        assertDocumentedKinds(rightClaimIds, claims, `${itemPath}.rightClaimIds`);
        const left = formatCellFromClaims(leftClaimIds, claims);
        const right = formatCellFromClaims(rightClaimIds, claims);
        const claimRefs = [...new Set([...leftClaimIds, ...rightClaimIds])];
        return { label: item.label, left, right, claimRefs };
      });
      return {
        title: layout.title,
        leftLabel: layout.leftLabel,
        rightLabel: layout.rightLabel,
        items,
      };
    }
    case "Timeline": {
      if (layout.kind !== "Timeline") reject("editorial_plan_shape", "Timeline layout mismatch.", `${compPath}.layout`);
      const events = layout.events.map((event, index) => {
        const eventPath = `${compPath}.layout.events[${index}]`;
        if (event.date !== undefined && event.text !== undefined) {
          const dateClaimIds = event.dateClaimIds ?? [];
          const textClaimIds = event.textClaimIds ?? [];
          const claimRefs = [...new Set(event.claimRefs ?? [...dateClaimIds, ...textClaimIds])];
          assertKnownClaims(claimRefs, claims, `${eventPath}.claimRefs`);
          assertDocumentedKinds(claimRefs, claims, `${eventPath}.claimRefs`);
          return { date: event.date, text: event.text, claimRefs };
        }
        const dateClaimIds = event.dateClaimIds;
        const textClaimIds = event.textClaimIds;
        if (!dateClaimIds || !textClaimIds) {
          reject(
            "editorial_plan_shape",
            `Timeline event ${index} must provide dateClaimIds and textClaimIds or model-authored date/text with claimRefs.`,
            eventPath,
          );
        }
        assertKnownClaims(dateClaimIds, claims, `${eventPath}.dateClaimIds`);
        assertKnownClaims(textClaimIds, claims, `${eventPath}.textClaimIds`);
        assertDocumentedKinds(dateClaimIds, claims, `${eventPath}.dateClaimIds`);
        assertDocumentedKinds(textClaimIds, claims, `${eventPath}.textClaimIds`);
        const date = formatCellFromClaims(dateClaimIds, claims);
        const text = formatCellFromClaims(textClaimIds, claims);
        const claimRefs = [...new Set([...dateClaimIds, ...textClaimIds])];
        return { date, text, claimRefs };
      });
      return { title: layout.title, events };
    }
    case "Metric": {
      if (layout.kind !== "Metric") reject("editorial_plan_shape", "Metric layout mismatch.", `${compPath}.layout`);
      assertKnownClaims(layout.claimIds, claims, "Metric.claimIds");
      assertDocumentedKinds(layout.claimIds, claims, "Metric.claimIds");
      if (!/^\{\{calc:[A-Za-z0-9.]{1,32}\}\}$/.test(layout.binding)) {
        reject("editorial_plan_shape", "Metric.binding must be a single {{calc:…}} token.", `${compPath}.layout.binding`);
      }
      return {
        label: layout.label,
        binding: layout.binding,
        ...(layout.unit !== undefined ? { unit: layout.unit } : {}),
      };
    }
    case "KeyFindings": {
      if (layout.kind !== "KeyFindings") reject("editorial_plan_shape", "KeyFindings layout mismatch.", `${compPath}.layout`);
      assertKnownClaims(layout.claimIds, claims, "KeyFindings.claimIds");
      for (const [index, id] of layout.claimIds.entries()) {
        const claim = claims.get(id)!;
        if (!FINDING_GRANULAR_KINDS.has(claim.kind)) {
          reject("editorial_plan_claim_kind", `KeyFindings.claimIds[${index}] cites ${id}, which is not allowed.`);
        }
      }
      return { title: layout.title, claimIds: [...layout.claimIds] };
    }
    case "EvidencePanel": {
      if (layout.kind !== "EvidencePanel") reject("editorial_plan_shape", "EvidencePanel layout mismatch.", `${compPath}.layout`);
      assertKnownClaims(layout.claimIds, claims, "EvidencePanel.claimIds");
      for (const [index, id] of layout.claimIds.entries()) {
        const claim = claims.get(id)!;
        if (!EVIDENCE_GRANULAR_KINDS.has(claim.kind)) {
          reject("editorial_plan_claim_kind", `EvidencePanel.claimIds[${index}] cites ${id}, which is not allowed.`);
        }
      }
      return { title: layout.title, claimIds: [...layout.claimIds] };
    }
    case "ScenarioExplorer": {
      if (layout.kind !== "ScenarioExplorer" && layout.kind !== "Narrative") {
        reject("editorial_plan_shape", `${compPath}.layout must be ScenarioExplorer.`, `${compPath}.layout`);
      }
      if (typeof component.scenarioId !== "string" || !scenarioIds.has(component.scenarioId)) {
        reject("editorial_plan_shape", "ScenarioExplorer requires a recorded scenarioId.", `${compPath}.scenarioId`);
      }
      return { scenarioId: component.scenarioId };
    }
    default:
      reject(
        "editorial_plan_shape",
        `Component ${String(component.component)} is not supported by the editorial compiler.`,
        `${compPath}.component`,
      );
  }
}

function sectionClaimUnion(section: EditorialSectionPlan): string[] {
  const ids = new Set<string>();
  for (const id of section.documentedClaimIds ?? []) ids.add(id);
  if (section.interpretation) for (const id of section.interpretation.claimRefs) ids.add(id);
  if (section.uncertainty) {
    if ("mode" in section.uncertainty) {
      for (const id of section.uncertainty.claimIds) ids.add(id);
    } else {
      for (const id of section.uncertainty.claimRefs) ids.add(id);
    }
  }
  for (const req of section.missingDocumentRequests ?? []) {
    for (const id of req.gapClaimIds) ids.add(id);
    for (const id of req.supportingClaimIds) ids.add(id);
  }
  return [...ids];
}

/** Editorial content selections that must appear in compiled writer output (not presentation-only metadata). */
function collectRequiredRenderedClaimSelections(plan: EditorialPlan): Set<string> {
  const selected = new Set<string>();
  for (const id of plan.summary.documentedClaimIds ?? []) selected.add(id);
  for (const binding of plan.summary.calculationBindings ?? []) selected.add(binding.calcId);
  for (const section of plan.sections) {
    for (const id of section.documentedClaimIds ?? []) selected.add(id);
    if (section.interpretation) for (const id of section.interpretation.claimRefs) selected.add(id);
    if (section.uncertainty) {
      if ("mode" in section.uncertainty) {
        for (const id of section.uncertainty.claimIds) selected.add(id);
      } else {
        for (const id of section.uncertainty.claimRefs) selected.add(id);
      }
    }
    for (const req of section.missingDocumentRequests ?? []) {
      for (const id of req.gapClaimIds) selected.add(id);
      for (const id of req.supportingClaimIds) selected.add(id);
    }
  }
  for (const component of plan.components) {
    if (component.layout.kind === "RecordTable") {
      for (const row of component.layout.rows) {
        for (const cell of row.cellClaimIds ?? []) for (const id of cell) selected.add(id);
        for (const id of row.claimRefs ?? []) selected.add(id);
      }
    }
    if (component.layout.kind === "Comparison") {
      for (const item of component.layout.items) {
        for (const id of item.leftClaimIds ?? []) selected.add(id);
        for (const id of item.rightClaimIds ?? []) selected.add(id);
        for (const id of item.claimRefs ?? []) selected.add(id);
      }
    }
    if (component.layout.kind === "Timeline") {
      for (const event of component.layout.events) {
        for (const id of event.dateClaimIds ?? []) selected.add(id);
        for (const id of event.textClaimIds ?? []) selected.add(id);
        for (const id of event.claimRefs ?? []) selected.add(id);
      }
    }
    if (component.layout.kind === "Metric") for (const id of component.layout.claimIds) selected.add(id);
    if (component.layout.kind === "KeyFindings") for (const id of component.layout.claimIds) selected.add(id);
    if (component.layout.kind === "EvidencePanel") for (const id of component.layout.claimIds) selected.add(id);
  }
  return selected;
}

function collectRenderedClaimRefs(report: WriterReport): Set<string> {
  const rendered = new Set<string>();
  const scanBlock = (block: ReportBlock) => {
    for (const ref of block.claimRefs) rendered.add(ref);
    for (const match of block.text.matchAll(BINDING_TOKEN)) {
      if (match[1] === "calc") rendered.add(match[2]!);
    }
  };
  for (const block of report.summary) scanBlock(block);
  for (const section of report.sections) for (const block of section.blocks) scanBlock(block);
  for (const view of report.view) {
    const props = view.props;
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.claimRefs)) {
        for (const ref of record.claimRefs) if (typeof ref === "string") rendered.add(ref);
      }
      if (Array.isArray(record.claimIds)) {
        for (const ref of record.claimIds) if (typeof ref === "string") rendered.add(ref);
      }
      for (const nested of Object.values(record)) walk(nested);
    };
    walk(props);
  }
  return rendered;
}

function buildPresentationPlan(
  plan: EditorialPlan,
  missingDocumentRequests: readonly MissingDocumentRequestMetadata[],
): WriterPresentationPlan {
  const sections: WriterPlannedSection[] = plan.sections.map((section) => ({
    id: section.id,
    heading: section.heading,
    priority: section.priority,
    claimIds: sectionClaimUnion(section),
    ...(section.insightIds ? { insightIds: [...section.insightIds] } : {}),
    ...(section.purpose ? { purpose: section.purpose } : {}),
  }));
  const components: WriterPlannedComponent[] = plan.components.map((component) => ({
    component: component.component,
    claimIds: [...component.claimIds],
    ...(component.sectionId !== undefined ? { sectionId: component.sectionId } : {}),
    ...(component.scenarioId !== undefined ? { scenarioId: component.scenarioId } : {}),
    ...(component.purpose ? { purpose: component.purpose } : {}),
  }));
  return {
    schema: "hive.writer-presentation-plan/1",
    audienceObjective: plan.audienceObjective,
    summaryDetailLevel: plan.summaryDetailLevel,
    ...(plan.insights ? { insights: plan.insights.map((insight) => ({ ...insight })) } : {}),
    priorityFindings: plan.priorityFindings.map((entry) => ({ ...entry })),
    sections,
    components,
    ...(missingDocumentRequests.length > 0 ? { missingDocumentRequests: [...missingDocumentRequests] } : {}),
  };
}

function validateEditorialPlanShape(plan: EditorialPlan, claims: ReadonlyMap<string, StudyClaim>): void {
  if (plan.audience !== "CUSTOMER" && plan.audience !== "PRO") {
    reject("editorial_plan_shape", "audience must be CUSTOMER or PRO.", "audience");
  }
  if (plan.title.trim() === "" || plan.title.length > WRITER_LIMITS.title) {
    reject("editorial_plan_shape", "title must be non-empty text.", "title");
  }
  if (plan.audienceObjective.trim() === "" || plan.audienceObjective.length > 600) {
    reject("editorial_plan_shape", "audienceObjective must be non-empty text up to 600 characters.", "audienceObjective");
  }
  if (plan.sections.length === 0 || plan.sections.length > WRITER_LIMITS.sections) {
    reject("editorial_plan_shape", "sections must contain 1–12 items.", "sections");
  }
  const sectionIds = new Set<string>();
  for (const [index, section] of plan.sections.entries()) {
    const path = `sections[${index}]`;
    if (!WRITER_SECTION_ID_PATTERN.test(section.id) || sectionIds.has(section.id)) {
      reject("editorial_plan_shape", `${path}.id must be a unique s1…s99 id.`, `${path}.id`);
    }
    sectionIds.add(section.id);
    if (section.heading.trim() === "" || section.heading.length > WRITER_LIMITS.heading) {
      reject("editorial_plan_shape", `${path}.heading must be non-empty text.`, `${path}.heading`);
    }
    const hasDocumented = (section.documentedClaimIds?.length ?? 0) > 0;
    const hasInterpretation = Boolean(section.interpretation);
    const hasUncertainty = Boolean(section.uncertainty);
    const hasMissingDocRequests = (section.missingDocumentRequests?.length ?? 0) > 0;
    if (!hasDocumented && !hasInterpretation && !hasUncertainty && !hasMissingDocRequests) {
      reject("editorial_plan_shape", `${path} must include documented, interpretation, uncertainty, or missingDocumentRequests content.`, path);
    }
  }
  if (plan.components.length === 0 || plan.components.length > WRITER_LIMITS.viewComponents) {
    reject("editorial_plan_shape", "components must contain 1–30 items.", "components");
  }
  for (const [index, component] of plan.components.entries()) {
    if (!(A2UI_COMPONENTS as readonly string[]).includes(component.component)) {
      reject(
        "editorial_plan_shape",
        `components[${index}].component (${String(component.component)}) is not in the A2UI catalog. Supported editorial components: ${EDITORIAL_SUPPORTED_COMPONENTS.join(", ")}.`,
        `components[${index}].component`,
      );
    }
    if (!(EDITORIAL_SUPPORTED_COMPONENTS as readonly string[]).includes(component.component)) {
      reject(
        "editorial_plan_shape",
        `Component ${String(component.component)} at components[${index}].component is not supported by the editorial compiler. Supported components: ${EDITORIAL_SUPPORTED_COMPONENTS.join(", ")}.`,
        `components[${index}].component`,
      );
    }
    assertKnownClaims(component.claimIds, claims, `components[${index}].claimIds`);
  }
  for (const [index, finding] of plan.priorityFindings.entries()) {
    assertKnownClaims([finding.claimId], claims, `priorityFindings[${index}].claimId`);
  }
  for (const [index, insight] of (plan.insights ?? []).entries()) {
    if (!INSIGHT_ID_PATTERN.test(insight.id)) {
      reject("editorial_plan_shape", `insights[${index}].id is invalid.`, `insights[${index}].id`);
    }
    assertKnownClaims(insight.claimIds, claims, `insights[${index}].claimIds`);
    for (const qId of insight.questionIds) {
      if (!PLAN_QUESTION_ID_PATTERN.test(qId)) {
        reject("editorial_plan_shape", `insights[${index}].questionIds contains invalid id ${qId}.`);
      }
    }
  }
}

/**
 * Validates editorial selections, compiles deterministic DOCUMENTED content and A2UI props,
 * preserves model-authored INTERPRETATION / UNCERTAINTY prose, assembles `hive.writer-report/1`
 * and `hive.writer-presentation-plan/1`, and runs existing Writer validation plus `buildReport()`.
 */
export function compileEditorialPlan(plan: EditorialPlan, context: EditorialPlanCompileContext): EditorialPlanCompileResult {
  const editorialPlanJsonBytes = Buffer.byteLength(JSON.stringify(plan), "utf8");
  try {
    if (plan.schema !== undefined && plan.schema !== EDITORIAL_PLAN_SCHEMA) {
      reject("editorial_plan_shape", "schema must be hive.editorial-plan/1 when provided.", "schema");
    }
    const claims = claimMap(context.claims);
    validateEditorialPlanShape(plan, claims);
    const temporalContext = buildTemporalContext(context.claims, context.canonicalFindings, context.asOf);
    const questionsWithFacts = questionsWithAtomicFacts(context.claims);

    const summaryBlock = compileSummaryBlock(plan.summary, claims, temporalContext);
    const missingDocumentRequests: MissingDocumentRequestMetadata[] = [];
    const seenRequestIds = new Set<string>();
    const sections: ReportSection[] = plan.sections.map((section, sectionIndex) => {
      const blocks: ReportBlock[] = [];
      if (section.documentedClaimIds && section.documentedClaimIds.length > 0) {
        blocks.push(
          compileDocumentedBlock(
            section.documentedClaimIds,
            `sections[${sectionIndex}].documented`,
            claims,
            temporalContext,
          ),
        );
      }
      if (section.interpretation) {
        blocks.push(
          compileInterpretationBlock(
            section.interpretation,
            `sections[${sectionIndex}].interpretation`,
            claims,
            temporalContext,
          ),
        );
      }
      if (section.uncertainty) {
        blocks.push(
          compileUncertaintyBlock(section.uncertainty, `sections[${sectionIndex}].uncertainty`, claims, temporalContext),
        );
      }
      for (const [reqIndex, reqUnit] of (section.missingDocumentRequests ?? []).entries()) {
        const reqPath = `sections[${sectionIndex}].missingDocumentRequests[${reqIndex}]`;
        const reqBlock = compileMissingDocumentRequestBlock(reqUnit, plan.audience, reqPath, claims, temporalContext);
        if (reqBlock.missingDocumentRequest) {
          if (seenRequestIds.has(reqBlock.missingDocumentRequest.requestId)) {
            reject(
              "editorial_plan_shape",
              `${reqPath} duplicates missing-document request ${reqBlock.missingDocumentRequest.requestId}.`,
              reqPath,
            );
          }
          seenRequestIds.add(reqBlock.missingDocumentRequest.requestId);
          missingDocumentRequests.push(reqBlock.missingDocumentRequest);
        }
        blocks.push(reqBlock);
      }
      return { id: section.id, heading: section.heading, blocks };
    });

    const scenarios = (plan.scenarios ?? []).map((scenario) => ({
      ...scenario,
      claimRefs: [...scenario.claimRefs],
      parameters: scenario.parameters.map((param) => ({ ...param })),
      results: scenario.results.map((result) => ({ ...result })),
    }));
    const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
    const scenarioResultIds = new Set<string>();
    for (const scenario of scenarios) {
      for (const result of scenario.results ?? []) {
        scenarioResultIds.add(`${scenario.id}.${result.id}`);
      }
    }
    const sectionIds = new Set(plan.sections.map((section) => section.id));

    const view = plan.components.map((component, index) => {
      const props = compileViewProps(
        component,
        index,
        claims,
        temporalContext,
        sectionIds,
        scenarioIds,
        true,
      );
      const path = `view[${index}]`;
      const validationContext: ViewComponentValidationContext = {
        claims,
        questionsWithFacts,
        hasOutline: true,
        sectionIds,
        scenarioResultIds,
        scenarioIds,
        temporalContext,
      };
      validateViewComponentProposal({ component: component.component, props }, path, validationContext);
      return { component: component.component, props };
    });

    const writerReport: WriterReport = {
      schema: WRITER_REPORT_SCHEMA,
      audience: plan.audience,
      title: plan.title.trim(),
      summary: [summaryBlock],
      sections,
      scenarios,
      view,
    };

    const selectedClaims = collectRequiredRenderedClaimSelections(plan);
    const renderedClaims = collectRenderedClaimRefs(writerReport);
    for (const id of selectedClaims) {
      if (!renderedClaims.has(id)) {
        reject(
          "editorial_plan_claim_missing",
          `Selected claim ${id} does not appear in compiled report output.`,
          "claimSelections",
        );
      }
    }

    const validated = validateWriterReport(writerReport, {
      audience: plan.audience,
      claims: context.claims,
      canonicalFindings: context.canonicalFindings,
      asOf: context.asOf,
    });
    if (!validated.ok) {
      return {
        ok: false,
        message: validated.message,
        diagnosticReason: validated.diagnosticReason,
        ...(validated.diagnosticField ? { diagnosticField: validated.diagnosticField } : {}),
        component: "writer",
      };
    }

    const presentationPlan = buildPresentationPlan(plan, missingDocumentRequests);
    const ledger = new WriterAgentLedger({
      reportRunId: context.reportRunId,
      audience: plan.audience,
      claims: context.claims,
      fileNames: context.fileNames,
      canonicalFindings: context.canonicalFindings ?? null,
      asOf: context.asOf ?? null,
    });
    try {
      ledger.recordPresentationPlan(presentationPlan);
    } catch (error) {
      if (error instanceof WriterRejection) {
        return {
          ok: false,
          message: error.message,
          diagnosticReason: error.diagnosticReason,
          ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
          component: "writer",
        };
      }
      throw error;
    }

    const built = buildReport(validated.value, {
      audience: plan.audience,
      claims: context.claims,
      fileNames: context.fileNames,
      canonicalFindings: context.canonicalFindings,
      asOf: context.asOf,
    });
    if (!built.ok) {
      return {
        ok: false,
        message: built.message,
        diagnosticReason: built.diagnosticReason,
        ...(built.diagnosticField ? { diagnosticField: built.diagnosticField } : {}),
        component: built.component,
      };
    }

    return {
      ok: true,
      presentationPlan,
      writerReport: validated.value,
      missingDocumentRequests,
      editorialPlanJsonBytes,
      compiledWriterReportJsonBytes: Buffer.byteLength(JSON.stringify(validated.value), "utf8"),
    };
  } catch (error) {
    if (error instanceof EditorialPlanRejection) {
      return {
        ok: false,
        message: error.message,
        diagnosticReason: error.diagnosticReason,
        ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
        component: "editorial",
      };
    }
    if (error instanceof WriterRejection) {
      return {
        ok: false,
        message: error.message,
        diagnosticReason: error.diagnosticReason,
        ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
        component: "writer",
      };
    }
    if (error instanceof BindRejection) {
      return {
        ok: false,
        message: error.message,
        diagnosticReason: error.diagnosticReason,
        ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
        component: "a2ui",
      };
    }
    throw error;
  }
}
