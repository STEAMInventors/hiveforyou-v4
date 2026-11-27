import type { CanonicalStudy } from "../pipeline/canonical-study-contracts";
import type { ProcessingRun, StudyRevisionFormat, StudyRevisionSummary } from "./study-preparation-contracts";

export type StudyRevisionAcceptanceCounts = {
  verifiedFacts: number;
  documents: number;
  checklistShown?: number;
  checklistNotShown?: number;
  packReview?: { id: string; version: number | string; title: string };
  /** Compiled Domain Pack digest recorded with an investigation revision. */
  domainPackDigest?: string;
  /** Verified evidence index digest recorded with a pack-guided revision. */
  evidenceDigest?: string;
};

/** What produced an accepted revision. Missing fields stay null; they are not guessed as zero or as v0.5.0. */
export type StudyRevisionIdentity = {
  investigationEngine: string | null;
  domainPackId: string | null;
  domainPackVersion: string | null;
  revisionStatus: "accepted" | null;
};

const SHOWN_VERDICTS = new Set(["SHOWN", "PARTLY_SHOWN"]);
const NOT_SHOWN_VERDICTS = new Set(["NOT_SHOWN"]);

/** Unique fact ids cited on the accepted Canonical Study (V5). */
export function countVerifiedFactIds(study: CanonicalStudy): number {
  const ids = new Set<string>();
  const add = (list: readonly string[]) => list.forEach((id) => id && ids.add(id));
  for (const node of study.spine) add(node.supportingFactIds);
  for (const item of study.outsideSpine) add(item.factIds);
  for (const item of study.conflicts) add(item.factIds);
  for (const item of study.timeline) add(item.factIds);
  for (const item of study.checklist ?? []) add(item.factIds);
  for (const item of study.standingQuestions ?? []) add(item.factIds);
  for (const item of study.personaCoverage ?? []) add(item.factIds);
  for (const chain of study.chains ?? []) {
    for (const row of chain.rows) {
      for (const cell of row.links) {
        if ("factIds" in cell) add(cell.factIds);
      }
    }
  }
  return ids.size;
}

export function countChecklistVerdicts(study: CanonicalStudy): { shown: number; notShown: number } {
  let shown = 0;
  let notShown = 0;
  for (const item of study.checklist ?? []) {
    if (SHOWN_VERDICTS.has(item.verdict)) shown += 1;
    else if (NOT_SHOWN_VERDICTS.has(item.verdict)) notShown += 1;
  }
  return { shown, notShown };
}

export function buildV5AcceptanceCounts(
  study: CanonicalStudy,
  packTitle: string | null = null,
): StudyRevisionAcceptanceCounts {
  const { shown, notShown } = countChecklistVerdicts(study);
  const documents = study.documents.length;
  const verifiedFacts = countVerifiedFactIds(study);
  const packRef = study.packRef;
  return {
    verifiedFacts,
    documents,
    ...(study.checklist && study.checklist.length > 0 ? { checklistShown: shown, checklistNotShown: notShown } : {}),
    ...(packRef && packTitle
      ? { packReview: { id: packRef.id, version: packRef.version, title: packTitle } }
      : packRef
        ? { packReview: { id: packRef.id, version: packRef.version, title: packRef.id } }
        : {}),
  };
}

const IDENTITY_TOKEN = /^[\w./:-]{1,80}$/;

export function studyIdentityToken(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  return IDENTITY_TOKEN.test(text) ? text : null;
}

function parsePackReview(value: unknown): StudyRevisionAcceptanceCounts["packReview"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const version = typeof row.version === "number" && Number.isFinite(row.version) ? row.version : studyIdentityToken(row.version);
  if (typeof row.id !== "string" || typeof row.title !== "string" || version === null) return undefined;
  return { id: row.id, version, title: row.title };
}

export function parseStudyRevisionAcceptanceCounts(raw: unknown): StudyRevisionAcceptanceCounts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const verifiedFacts = record.verifiedFacts;
  const documents = record.documents;
  if (typeof verifiedFacts !== "number" || typeof documents !== "number") return null;
  const checklistShown = typeof record.checklistShown === "number" ? record.checklistShown : undefined;
  const checklistNotShown = typeof record.checklistNotShown === "number" ? record.checklistNotShown : undefined;
  const packReview = parsePackReview(record.packReview);
  const domainPackDigest =
    typeof record.domainPackDigest === "string" && /^[0-9a-f]{64}$/.test(record.domainPackDigest)
      ? record.domainPackDigest
      : undefined;
  const evidenceDigest =
    typeof record.evidenceDigest === "string" && /^[0-9a-f]{64}$/.test(record.evidenceDigest)
      ? record.evidenceDigest
      : undefined;
  return {
    verifiedFacts,
    documents,
    ...(checklistShown !== undefined ? { checklistShown } : {}),
    ...(checklistNotShown !== undefined ? { checklistNotShown } : {}),
    ...(packReview ? { packReview } : {}),
    ...(domainPackDigest ? { domainPackDigest } : {}),
    ...(evidenceDigest ? { evidenceDigest } : {}),
  };
}

function factLabel(count: number): string {
  return `${count} verified ${count === 1 ? "fact" : "facts"}`;
}

function documentLabel(count: number): string {
  return `${count} ${count === 1 ? "document" : "documents"}`;
}

function counted(value: number | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function sourcePhrase(count: number): string {
  return `${count} ${count === 1 ? "source" : "sources"}`;
}

/**
 * Owner-facing acceptance detail.
 * A missing count is omitted. `documentFindingCount: 0` on a canonical study is not a measured claim count.
 */
export function formatStudyRevisionAcceptanceDetail(revision: StudyRevisionSummary): string {
  const counts = revision.acceptanceCounts;
  const verifiedFacts = counted(counts?.verifiedFacts);
  const documents = counted(counts?.documents) ?? counted(revision.sourceCount);
  const measuredClaims =
    verifiedFacts === null && revision.format !== "canonical-study-1" ? counted(revision.documentFindingCount) : null;
  const parts: string[] = [];
  if (verifiedFacts !== null) {
    parts.push(factLabel(verifiedFacts));
    if (documents !== null) parts.push(documentLabel(documents));
  } else {
    if (documents !== null) parts.push(revision.format === "canonical-study-1" ? documentLabel(documents) : sourcePhrase(documents));
    if (measuredClaims !== null) {
      parts.push(`${measuredClaims} verified ${measuredClaims === 1 ? "claim" : "claims"}`);
    }
  }
  if (
    counts &&
    typeof counts.checklistShown === "number" &&
    typeof counts.checklistNotShown === "number" &&
    counts.checklistShown + counts.checklistNotShown > 0
  ) {
    parts.push(`${counts.checklistShown} checks shown · ${counts.checklistNotShown} not shown`);
  }
  if (parts.length === 0) return "Counts were not recorded with this revision.";
  let text = parts.join(" · ");
  if (verifiedFacts === null && measuredClaims === null) text += ". Verified claim count was not recorded";
  else if (documents === null) text += ". Source count was not recorded";
  if (counts?.packReview) {
    text += `. Reviewed with: ${counts.packReview.title} (v${counts.packReview.version})`;
  }
  return text;
}

export function readStudyRevisionIdentity(input: {
  revision: Pick<
    StudyRevisionSummary,
    "format" | "acceptanceCounts" | "investigationEngine" | "domainPackId" | "domainPackVersion" | "revisionStatus"
  >;
  study?: {
    packRef?: { id: string; version: number | string } | null;
    questionOrder?: readonly string[] | null;
  } | null;
  knownInvestigationPack?: { packId: string; version: string; compiledDigest: string } | null;
}): StudyRevisionIdentity {
  const revision = input.revision;
  const study = input.study ?? null;
  const known = input.knownInvestigationPack ?? null;
  const digestNote = (study?.questionOrder ?? []).find((item) => item.startsWith("pack-digest:")) ?? null;
  const digestMatches = Boolean(known && digestNote === `pack-digest:${known.compiledDigest}`);
  const packReview = revision.acceptanceCounts?.packReview;
  const investigationEngine =
    studyIdentityToken(revision.investigationEngine) ??
    (digestNote ? "hive.domain-investigation/1" : null) ??
    (study?.packRef?.id ? "hive-canonicalize/1" : null) ??
    (revision.format === "investigation-1" ? "hive.study-investigation/1" : null);
  const domainPackId =
    studyIdentityToken(revision.domainPackId) ??
    (digestMatches && known ? known.packId : null) ??
    studyIdentityToken(study?.packRef?.id) ??
    studyIdentityToken(packReview?.id);
  const domainPackVersion =
    studyIdentityToken(revision.domainPackVersion) ??
    (digestMatches && known ? known.version : null) ??
    (study?.packRef ? studyIdentityToken(study.packRef.version) : null) ??
    (packReview ? studyIdentityToken(packReview.version) : null);
  return {
    investigationEngine,
    domainPackId,
    domainPackVersion,
    revisionStatus: "accepted",
  };
}

export function formatStudyRevisionProvenance(identity: StudyRevisionIdentity, revisionNumber: number): string {
  const engine = identity.investigationEngine
    ? `Investigation engine ${identity.investigationEngine}`
    : "Investigation engine was not recorded";
  const pack =
    identity.domainPackId && identity.domainPackVersion
      ? `Domain pack ${identity.domainPackId} ${identity.domainPackVersion}`
      : identity.domainPackId
        ? `Domain pack ${identity.domainPackId}. Domain pack version was not recorded`
        : "Domain pack version was not recorded";
  const status = identity.revisionStatus === "accepted" ? `Revision ${revisionNumber} accepted` : `Revision ${revisionNumber}`;
  return `${engine}. ${pack}. ${status}.`;
}

export function studyRevisionAcceptanceSubtext(
  format: StudyRevisionFormat | undefined,
  preparationMode: ProcessingRun["preparationMode"] | undefined,
): string {
  if (preparationMode === "REBUILD") {
    return "A new study revision was accepted from your saved pages. Earlier revisions and their reports stay as they are.";
  }
  if (format === "canonical-study-1") {
    return "Your study is ready. Reports are being written from the same verified facts.";
  }
  return "Every claim was checked against its page. Your reports are being written.";
}
