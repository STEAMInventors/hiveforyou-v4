import type { CanonicalStudy } from "./canonical-study-contracts";
import type { Pack, PackAudience, PackCheck, PackStandingQuestion } from "./pack-contracts";
import { stripCustomerCheckAuthority } from "./pack-write";
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

export function buildChainBlockRows(
  study: CanonicalStudy,
  pack: Pack,
  facts: ReadonlyMap<string, WriteFactRecord>,
): { chainId: string; label: string; rows: StudyViewRow[] }[] {
  const labels = new Map(pack.chains.map((chain) => [chain.id, chain.label]));
  return (study.chains ?? []).map((chain) => ({
    chainId: chain.chainId,
    label: labels.get(chain.chainId) ?? chain.chainId,
    rows: chain.rows.map((row, index) => ({
      id: `${chain.chainId}-R${index + 1}`,
      label: row.label,
      missing: row.links.filter((link) => "missing" in link && link.missing).map((_, linkIndex) => `link-${linkIndex + 1}`),
      values: row.links.flatMap((link) => ("factIds" in link ? valuesForFactIds(link.factIds, facts) : [])),
    })),
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

export function buildQuestionRows(
  study: CanonicalStudy,
  pack: Pack,
  facts: ReadonlyMap<string, WriteFactRecord>,
  audience: PackAudience = "professional",
): StudyViewRow[] {
  const checks = checkById(pack);
  const standing = standingQuestionById(pack);
  const order = study.questionOrder ?? [];
  return order.flatMap((questionId, index) => {
    const checkDef = checks.get(questionId);
    const standingDef = standing.get(questionId);
    if (checkDef?.question) {
      return [
        {
          id: audience === "professional" ? questionId : `q-${index + 1}`,
          statement: checkDef.question,
          values: valuesForFactIds(factIdsForCheck(study, questionId), facts),
        },
      ];
    }
    if (standingDef && standingQuestionAudienceMatches(standingDef, audience)) {
      const applies = study.standingQuestions?.find((row) => row.id === questionId)?.applies === true;
      if (!applies) return [];
      return [
        {
          id: audience === "professional" ? questionId : `q-${index + 1}`,
          statement: standingDef.question,
          values: valuesForFactIds(factIdsForStandingQuestion(study, questionId), facts),
        },
      ];
    }
    return [];
  });
}

/** Strip pack check ids and authority strings from customer-facing block rows. */
export function redactCustomerPackBlockRows(
  _blockName: string,
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
    return {
      ...row,
      id: `row-${index + 1}`,
      statement: statement || null,
      label,
      authority: null,
    };
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

export function buildGeneralNotesRows(pack: Pack): StudyViewRow[] {
  return pack.generalNotes
    .filter((note) => note.showWhen.toLowerCase() === "always")
    .map((note) => ({
      id: note.id,
      statement: note.text,
      values: [],
    }));
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
