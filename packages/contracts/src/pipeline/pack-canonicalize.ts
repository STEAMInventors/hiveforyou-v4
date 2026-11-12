/**
 * Verify-or-drop for pack-shaped canonicalize output (checklist, chains, personaCoverage, questionOrder).
 */

import type { CanonicalStudy } from "./canonical-study-contracts";
import type { Pack, PackCheck, PackStandingQuestion } from "./pack-contracts";
import { mergePackSettlesGaps } from "./document-gap-reconcile";

export const CHECK_VERDICTS = [
  "SHOWN",
  "PARTLY_SHOWN",
  "NOT_SHOWN",
  "CONFLICT",
  "NOT_APPLICABLE",
  "NOT_ASSESSED",
] as const;
export type CheckVerdict = (typeof CHECK_VERDICTS)[number];

export const PERSONA_COVERAGE_STATUSES = ["ANSWERABLE", "PARTLY", "NOT_ANSWERABLE", "NOT_ASSESSED"] as const;
export type PersonaCoverageStatus = (typeof PERSONA_COVERAGE_STATUSES)[number];

export type CanonicalChecklistItem = {
  checkId: string;
  verdict: CheckVerdict;
  factIds: string[];
  note: string;
};

export type CanonicalChainLinkCell = { factIds: string[] } | { missing: true };

export type CanonicalChainRow = {
  label: string;
  links: CanonicalChainLinkCell[];
};

export type CanonicalChainItem = {
  chainId: string;
  rows: CanonicalChainRow[];
};

export type PersonaCoverageItem = {
  audience: string;
  questionId: string;
  status: PersonaCoverageStatus;
  factIds: string[];
  checkIds: string[];
  missing: string;
};

export type CanonicalStandingQuestionItem = {
  id: string;
  applies: boolean;
  factIds: string[];
};

export type PackCanonicalizeDrops = {
  unknownCheckIds: number;
  unknownChainIds: number;
  unknownPersonaQuestionIds: number;
  unknownStandingQuestionIds: number;
  verdictDowngradedNoFacts: number;
  coverageDowngradedNoFacts: number;
  standingQuestionDowngradedNoFacts: number;
  checksNotAssessed: number;
  personaQuestionsNotAssessed: number;
  standingQuestionsNotAssessed: number;
};

export type PackCanonicalStudyFields = {
  checklist?: CanonicalChecklistItem[];
  chains?: CanonicalChainItem[];
  personaCoverage?: PersonaCoverageItem[];
  standingQuestions?: CanonicalStandingQuestionItem[];
  questionOrder?: string[];
  studyDate?: string;
  packRef?: { id: string; version: number };
};

export const PACK_STANDING_QUESTIONS_INSTRUCTION =
  "Standing questions are listed with the condition that makes each worth asking. For each, say whether the condition holds in these facts, citing the fact ids that show it. Put the ids of those that hold into questionOrder together with the check ids, most important first for the reader.";

const NEEDS_FACTS = new Set<string>(["SHOWN", "PARTLY_SHOWN", "CONFLICT", "ANSWERABLE", "PARTLY"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const strings = (value: unknown): string[] => [...new Set(arr(value).map(str).filter((item) => item !== ""))];

function keepFacts(ids: readonly string[], known: ReadonlySet<string>): string[] {
  return ids.filter((id) => known.has(id));
}

function verdictNeedsFacts(verdict: string): boolean {
  return NEEDS_FACTS.has(verdict);
}

function parseChecklist(raw: unknown, pack: Pack, known: ReadonlySet<string>, drops: PackCanonicalizeDrops): CanonicalChecklistItem[] {
  const checkIds = new Set(pack.checks.map((c) => c.id));
  const byId = new Map<string, CanonicalChecklistItem>();
  for (const item of arr(raw)) {
    if (!isRecord(item)) continue;
    const checkId = str(item.checkId);
    if (checkId === "" || !checkIds.has(checkId)) {
      drops.unknownCheckIds += 1;
      continue;
    }
    let verdict = str(item.verdict).toUpperCase() as CheckVerdict;
    if (!CHECK_VERDICTS.includes(verdict)) verdict = "NOT_ASSESSED";
    let factIds = keepFacts(strings(item.factIds), known);
    const note = str(item.note).slice(0, 200);
    if (verdictNeedsFacts(verdict) && factIds.length === 0) {
      verdict = verdict.startsWith("NOT") ? verdict : "NOT_SHOWN";
      drops.verdictDowngradedNoFacts += 1;
    }
    byId.set(checkId, { checkId, verdict, factIds, note });
  }
  for (const check of pack.checks) {
    if (!byId.has(check.id)) {
      drops.checksNotAssessed += 1;
      byId.set(check.id, { checkId: check.id, verdict: "NOT_ASSESSED", factIds: [], note: "" });
    }
  }
  return [...byId.values()];
}

function parseChains(raw: unknown, pack: Pack, known: ReadonlySet<string>, drops: PackCanonicalizeDrops): CanonicalChainItem[] {
  const chainIds = new Set(pack.chains.map((c) => c.id));
  const out: CanonicalChainItem[] = [];
  for (const item of arr(raw)) {
    if (!isRecord(item)) continue;
    const chainId = str(item.chainId);
    if (chainId === "" || !chainIds.has(chainId)) {
      drops.unknownChainIds += 1;
      continue;
    }
    const rows: CanonicalChainRow[] = [];
    for (const row of arr(item.rows)) {
      if (!isRecord(row)) continue;
      const label = str(row.label);
      if (label === "") continue;
      const links: CanonicalChainLinkCell[] = [];
      for (const link of arr(row.links)) {
        if (!isRecord(link)) continue;
        if (link.missing === true) {
          links.push({ missing: true });
          continue;
        }
        const factIds = keepFacts(strings(link.factIds), known);
        links.push({ factIds });
      }
      rows.push({ label, links });
    }
    out.push({ chainId, rows });
  }
  return out;
}

function personaQuestionKeys(pack: Pack): Set<string> {
  const keys = new Set<string>();
  for (const persona of pack.personas) {
    for (const q of persona.lookingFor) {
      keys.add(`${persona.audience}:${q.id}`);
    }
  }
  return keys;
}

function parsePersonaCoverage(
  raw: unknown,
  pack: Pack,
  known: ReadonlySet<string>,
  drops: PackCanonicalizeDrops,
): PersonaCoverageItem[] {
  const valid = personaQuestionKeys(pack);
  const seen = new Set<string>();
  const byKey = new Map<string, PersonaCoverageItem>();
  for (const item of arr(raw)) {
    if (!isRecord(item)) continue;
    const audience = str(item.audience).toLowerCase();
    const questionId = str(item.questionId);
    const key = `${audience}:${questionId}`;
    if (questionId === "" || !valid.has(key)) {
      drops.unknownPersonaQuestionIds += 1;
      continue;
    }
    let status = str(item.status).toUpperCase() as PersonaCoverageStatus;
    if (!PERSONA_COVERAGE_STATUSES.includes(status)) status = "NOT_ASSESSED";
    let factIds = keepFacts(strings(item.factIds), known);
    const checkIds = strings(item.checkIds);
    let missing = str(item.missing).slice(0, 120);
    if (NEEDS_FACTS.has(status) && factIds.length === 0) {
      status = "NOT_ANSWERABLE";
      drops.coverageDowngradedNoFacts += 1;
    }
    seen.add(key);
    byKey.set(key, { audience, questionId, status, factIds, checkIds, missing });
  }
  for (const key of valid) {
    if (!seen.has(key)) {
      drops.personaQuestionsNotAssessed += 1;
      const [audience, questionId] = key.split(":");
      byKey.set(key, {
        audience,
        questionId,
        status: "NOT_ASSESSED",
        factIds: [],
        checkIds: [],
        missing: "",
      });
    }
  }
  return [...byKey.values()];
}

function standingQuestionById(pack: Pack): Map<string, PackStandingQuestion> {
  return new Map(pack.standingQuestions.map((item) => [item.id, item]));
}

function parseStandingQuestions(
  raw: unknown,
  pack: Pack,
  known: ReadonlySet<string>,
  drops: PackCanonicalizeDrops,
): CanonicalStandingQuestionItem[] {
  const valid = standingQuestionById(pack);
  const byId = new Map<string, CanonicalStandingQuestionItem>();
  for (const item of arr(raw)) {
    if (!isRecord(item)) continue;
    const id = str(item.id);
    if (id === "" || !valid.has(id)) {
      drops.unknownStandingQuestionIds += 1;
      continue;
    }
    let applies = item.applies === true;
    let factIds = keepFacts(strings(item.factIds), known);
    if (applies && factIds.length === 0) {
      applies = false;
      drops.standingQuestionDowngradedNoFacts += 1;
    }
    byId.set(id, { id, applies, factIds });
  }
  for (const sq of pack.standingQuestions) {
    if (!byId.has(sq.id)) {
      drops.standingQuestionsNotAssessed += 1;
      byId.set(sq.id, { id: sq.id, applies: false, factIds: [] });
    }
  }
  return [...byId.values()];
}

function parseQuestionOrder(
  raw: unknown,
  pack: Pack,
  checklist: readonly CanonicalChecklistItem[],
  standingQuestions: readonly CanonicalStandingQuestionItem[],
): string[] {
  const withQuestion = new Map(
    pack.checks.filter((c) => c.question).map((c) => [c.id, c] as const),
  );
  const standingApplies = new Set(standingQuestions.filter((item) => item.applies).map((item) => item.id));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of strings(raw)) {
    if (seen.has(id)) continue;
    if (withQuestion.has(id) || standingApplies.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  const notShown = checklist
    .filter((item) => (item.verdict === "NOT_SHOWN" || item.verdict === "PARTLY_SHOWN") && withQuestion.has(item.checkId))
    .map((item) => item.checkId);
  for (const id of notShown) {
    if (!seen.has(id)) order.push(id);
  }
  for (const id of standingApplies) {
    if (!seen.has(id)) order.push(id);
  }
  return order;
}

export function applyPackCanonicalizeOutput(
  study: CanonicalStudy,
  pack: Pack,
  packRef: { id: string; version: number },
  raw: Record<string, unknown>,
  knownFactIds: ReadonlySet<string>,
): { study: CanonicalStudy; drops: PackCanonicalizeDrops } {
  const drops: PackCanonicalizeDrops = {
    unknownCheckIds: 0,
    unknownChainIds: 0,
    unknownPersonaQuestionIds: 0,
    unknownStandingQuestionIds: 0,
    verdictDowngradedNoFacts: 0,
    coverageDowngradedNoFacts: 0,
    standingQuestionDowngradedNoFacts: 0,
    checksNotAssessed: 0,
    personaQuestionsNotAssessed: 0,
    standingQuestionsNotAssessed: 0,
  };
  const checklist = parseChecklist(raw.checklist, pack, knownFactIds, drops);
  const chains = parseChains(raw.chains, pack, knownFactIds, drops);
  const personaCoverage = parsePersonaCoverage(raw.personaCoverage, pack, knownFactIds, drops);
  const standingQuestions = parseStandingQuestions(raw.standingQuestions, pack, knownFactIds, drops);
  const questionOrder = parseQuestionOrder(raw.questionOrder, pack, checklist, standingQuestions);
  const withPack: CanonicalStudy = {
    ...study,
    checklist,
    chains,
    personaCoverage,
    standingQuestions,
    questionOrder,
    packRef,
  };
  return { study: mergePackSettlesGaps(withPack, pack, checklist), drops };
}

export function packCanonicalizeInput(pack: Pack, studyDate: string) {
  return {
    studyDate: `Study date: ${studyDate}`,
    packRules: pack.rules,
    readers: pack.personas.map((persona) => ({
      audience: persona.audience,
      who: persona.who,
      situation: persona.situation,
      lookingFor: persona.lookingFor,
      decisions: persona.decisions,
    })),
    checks: pack.checks.map((c: PackCheck) => ({
      id: c.id,
      check: c.check,
      evidence: c.evidence,
    })),
    standingQuestions: pack.standingQuestions.map((sq) => ({
      id: sq.id,
      askWhen: sq.askWhen,
    })),
    chains: pack.chains,
    documentsUsuallyNeeded: pack.documentsUsuallyNeeded.map((d) => d.document),
    standingQuestionsInstruction: PACK_STANDING_QUESTIONS_INSTRUCTION,
  };
}
