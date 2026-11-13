import type { CanonicalStudy } from "./canonical-study-contracts";
import type { Pack, PackAudience, PackCheck, PackStandingQuestion } from "./pack-contracts";
import { capCustomerQuestions, stripCustomerCheckAuthority } from "./pack-write";
import type { PersonaCoverageItem } from "./pack-canonicalize";
import type { StudyViewRow, StudyViewSourceRef, StudyViewValue, WriteFactRecord } from "./study-view-contracts";

export const PACK_STUDY_BLOCKS = [
  "checklist",
  "chains",
  "questions",
  "unanswered",
  "terms",
  "general_notes",
] as const;
export type PackStudyBlockName = (typeof PACK_STUDY_BLOCKS)[number];

export type PersonaCoverageCardRow = {
  readonly audience: PackAudience;
  readonly questionId: string;
  readonly questionText: string;
  readonly status: string;
  readonly missing: string;
  readonly values: readonly StudyViewValue[];
};

export type PackStudyViewMeta = {
  readonly packTitle: string;
  readonly packVersion: number;
  readonly verified: string;
  readonly personaWho: Partial<Record<PackAudience, string>>;
};

function valuesForFactIds(
  factIds: readonly string[],
  facts: ReadonlyMap<string, WriteFactRecord>,
): StudyViewValue[] {
  const out: StudyViewValue[] = [];
  for (const factId of factIds) {
    const fact = facts.get(factId);
    if (!fact) continue;
    out.push({
      factId: fact.id,
      valueAsWritten: fact.valueAsWritten,
      sourceRef: { sourceDocumentId: fact.sourceDocumentId, pageNumber: fact.pageNumber, quote: fact.quote },
    });
  }
  return out;
}

function checkById(pack: Pack): Map<string, PackCheck> {
  return new Map(pack.checks.map((check) => [check.id, check]));
}

function factIdsForCheck(study: CanonicalStudy, checkId: string): string[] {
  const item = study.checklist?.find((row) => row.checkId === checkId);
  return item?.factIds ?? [];
}

export function buildChecklistRows(
  study: CanonicalStudy,
  pack: Pack,
  facts: ReadonlyMap<string, WriteFactRecord>,
  audience: PackAudience = "professional",
): StudyViewRow[] {
  const checks = checkById(pack);
  const items = study.checklist ?? [];
  const sortKey = (verdict: string) => (verdict === "NOT_SHOWN" || verdict === "PARTLY_SHOWN" ? 0 : 1);
  const sorted = [...items].sort((a, b) => sortKey(a.verdict) - sortKey(b.verdict));
  return sorted.map((item, index) => {
    const def = checks.get(item.checkId);
  const showIds = audience === "professional";
    return {
      id: showIds ? item.checkId : `check-${index + 1}`,
      label: def?.group ?? null,
      statement: def?.check ?? item.checkId,
      status: item.verdict,
      kind: item.note || null,
      values: valuesForFactIds(item.factIds, facts),
      authority: audience === "professional" && def?.authority ? def.authority : null,
    };
  });
}

function missingLinkLabel(pack: Pack, chainId: string, linkIndex: number): string {
  const def = pack.chains.find((chain) => chain.id === chainId);
  const label = def?.links[linkIndex]?.trim();
  return label && label !== "" ? label : "the next step";
}

export function buildChainBlockRows(
  study: CanonicalStudy,
  pack: Pack,
  facts: ReadonlyMap<string, WriteFactRecord>,
): { chainId: string; label: string; rows: StudyViewRow[] }[] {
  const labels = new Map(pack.chains.map((chain) => [chain.id, chain.label]));
  return (study.chains ?? []).map((chain) => ({
    chainId: chain.chainId,
    label: labels.get(chain.chainId) ?? chain.chainId,
    rows: chain.rows.map((row, index) => {
      let missingIndex = -1;
      row.links.forEach((link, linkIndex) => {
        if (missingIndex < 0 && "missing" in link && link.missing) missingIndex = linkIndex;
      });
      const hasMissing = missingIndex >= 0;
      const start = row.label.trim() || "This item";
      const statement = hasMissing
        ? `${start}: the documents do not show ${missingLinkLabel(pack, chain.chainId, missingIndex)}.`
        : `${start}: the chain is complete in these documents.`;
      return {
        id: `${chain.chainId}-R${index + 1}`,
        label: row.label,
        statement,
        kind: hasMissing ? "worth-asking" : "matches",
        missing: hasMissing ? [`link-${missingIndex + 1}`] : [],
        values: row.links.flatMap((link) => ("factIds" in link ? valuesForFactIds(link.factIds, facts) : [])),
      };
    }),
  }));
}

function standingQuestionById(pack: Pack): Map<string, PackStandingQuestion> {
  return new Map(pack.standingQuestions.map((item) => [item.id, item]));
}

function standingQuestionAudienceMatches(def: PackStandingQuestion, audience: PackAudience): boolean {
  const raw = def.audience.trim().toLowerCase();
  return raw === "all" || raw === audience;
}

function factIdsForStandingQuestion(study: CanonicalStudy, id: string): string[] {
  return study.standingQuestions?.find((row) => row.id === id)?.factIds ?? [];
}

const QUESTION_VERDICTS = new Set(["NOT_SHOWN", "PARTLY_SHOWN", "CONFLICT"]);

function checklistVerdict(study: CanonicalStudy, checkId: string): string | null {
  return study.checklist?.find((row) => row.checkId === checkId)?.verdict ?? null;
}

export function buildQuestionRows(
  study: CanonicalStudy,
  pack: Pack,
  facts: ReadonlyMap<string, WriteFactRecord>,
  audience: PackAudience = "professional",
): StudyViewRow[] {
  const checks = checkById(pack);
  const standing = standingQuestionById(pack);
  const order = study.questionOrder ?? [];
  const seenText = new Set<string>();
  const rows: StudyViewRow[] = [];
  let ordinal = 0;
  for (const questionId of order) {
    const checkDef = checks.get(questionId);
    const standingDef = standing.get(questionId);
    if (checkDef?.question) {
      const verdict = checklistVerdict(study, questionId);
      if (verdict === "SHOWN" || verdict === "NOT_APPLICABLE") continue;
      if (verdict != null && !QUESTION_VERDICTS.has(verdict)) continue;
      const text = checkDef.question.trim();
      const key = text.toLowerCase();
      if (text === "" || seenText.has(key)) continue;
      seenText.add(key);
      ordinal += 1;
      rows.push({
        id: audience === "professional" ? questionId : `q-${ordinal}`,
        statement: text,
        values: valuesForFactIds(factIdsForCheck(study, questionId), facts),
      });
      continue;
    }
    if (standingDef && standingQuestionAudienceMatches(standingDef, audience)) {
      const applies = study.standingQuestions?.find((row) => row.id === questionId)?.applies === true;
      if (!applies) continue;
      const text = standingDef.question.trim();
      const key = text.toLowerCase();
      if (text === "" || seenText.has(key)) continue;
      seenText.add(key);
      ordinal += 1;
      rows.push({
        id: audience === "professional" ? questionId : `q-${ordinal}`,
        statement: text,
        values: valuesForFactIds(factIdsForStandingQuestion(study, questionId), facts),
      });
    }
  }
  return [...capCustomerQuestions(rows, audience)];
}

/** Strip pack check ids and authority strings from customer-facing block rows. */
export function redactCustomerPackBlockRows(
  blockName: string,
  rows: readonly StudyViewRow[],
  pack: Pack,
): StudyViewRow[] {
  const authorityStrings = pack.checks.map((check) => check.authority).filter((text) => text.trim() !== "");
  return rows.map((row, index) => {
    let statement = row.statement ?? "";
    statement = stripCustomerCheckAuthority(statement);
    for (const authority of authorityStrings) {
      if (statement.includes(authority)) {
        statement = statement.replace(authority, " ").replace(/\s{2,}/g, " ").trim();
      }
    }
    let label = row.label ?? null;
    if (typeof label === "string") label = stripCustomerCheckAuthority(label);
    let next: StudyViewRow = {
      ...row,
      id: `row-${index + 1}`,
      statement: statement || null,
      label,
      authority: null,
      issues: undefined,
    };
    if (blockName === "spine_table") {
      next = {
        ...next,
        statement: (row.label ?? row.statement ?? "").trim() || null,
        label: null,
        status: null,
        missing: [],
        issues: undefined,
      };
    }
    if (blockName === "terms" && row.label && row.statement) {
      next = { ...next, statement: `${row.label} - ${row.statement}` };
    }
    if (blockName === "unanswered") {
      const missingNote = (row.kind ?? "").trim();
      const question = (row.statement ?? row.label ?? "").trim();
      next = {
        ...next,
        statement: question || null,
        kind: missingNote || null,
        label: "These documents don't show",
      };
    }
    return next;
  });
}

export function buildUnansweredRows(
  study: CanonicalStudy,
  pack: Pack,
  audience: PackAudience,
  facts: ReadonlyMap<string, WriteFactRecord>,
): StudyViewRow[] {
  const persona = pack.personas.find((p) => p.audience === audience);
  if (!persona) return [];
  const questions = new Map(persona.lookingFor.map((q) => [q.id, q.text]));
  const coverage = (study.personaCoverage ?? []).filter((row) => row.audience === audience);
  return coverage
    .filter((row) => row.status === "NOT_ANSWERABLE" || row.status === "PARTLY")
    .flatMap((row) => {
      const text = questions.get(row.questionId);
      if (!text) return [];
      return [
        {
          id: row.questionId,
          statement: text,
          kind: row.missing || null,
          values: valuesForFactIds(row.factIds, facts),
        },
      ];
    });
}

export function buildTermsRows(pack: Pack, facts: readonly WriteFactRecord[]): StudyViewRow[] {
  const haystack = facts
    .flatMap((fact) => [fact.quote, fact.valueAsWritten])
    .join("\n")
    .toLowerCase();
  return pack.terms
    .filter((term) => haystack.includes(term.term.toLowerCase()))
    .map((term, index) => ({
      id: `term-${index + 1}`,
      label: term.term,
      statement: term.plainMeaning,
      values: [],
    }));
}

function generalNoteRows(notes: Pack["generalNotes"]): StudyViewRow[] {
  return notes.map((note) => ({
    id: note.id,
    statement: note.text,
    values: [],
  }));
}

export function buildGeneralNotesRows(pack: Pack): StudyViewRow[] {
  return generalNoteRows(pack.generalNotes.filter((note) => note.showWhen.toLowerCase() === "always"));
}

export function buildGeneralNotesRowsForIds(pack: Pack, noteIds: readonly string[]): StudyViewRow[] {
  if (noteIds.length === 0) return buildGeneralNotesRows(pack);
  const want = new Set(noteIds.map((id) => id.trim().toUpperCase()));
  const selected = pack.generalNotes.filter((note) => want.has(note.id.toUpperCase()));
  return generalNoteRows(selected.length > 0 ? selected : pack.generalNotes.filter((note) => note.showWhen.toLowerCase() === "always"));
}

export function buildPersonaCoverageCard(
  study: CanonicalStudy,
  pack: Pack,
  facts: ReadonlyMap<string, WriteFactRecord>,
): PersonaCoverageCardRow[] {
  const out: PersonaCoverageCardRow[] = [];
  for (const persona of pack.personas) {
    const coverageById = new Map(
      (study.personaCoverage ?? [])
        .filter((row) => row.audience === persona.audience)
        .map((row) => [row.questionId, row] as const),
    );
    for (const question of persona.lookingFor) {
      const cov: PersonaCoverageItem | undefined = coverageById.get(question.id);
      const status = cov?.status ?? "NOT_ASSESSED";
      const mark =
        status === "ANSWERABLE" ? "covered" : status === "PARTLY" ? "partly" : "not shown";
      out.push({
        audience: persona.audience,
        questionId: question.id,
        questionText: question.text,
        status: mark,
        missing: cov?.missing ?? "",
        values: valuesForFactIds(cov?.factIds ?? [], facts),
      });
    }
  }
  return out;
}

export function packStudyViewMeta(pack: Pack): PackStudyViewMeta {
  return {
    packTitle: pack.meta.title,
    packVersion: pack.meta.version,
    verified: pack.meta.verified,
    personaWho: Object.fromEntries(pack.personas.map((p) => [p.audience, p.who])) as Partial<
      Record<PackAudience, string>
    >,
  };
}
