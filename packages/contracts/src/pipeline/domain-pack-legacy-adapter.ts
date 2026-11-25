/**
 * Loss-aware import adapter from the existing hive.pack/2 Markdown parser.
 * No legacy prose rule is upgraded into an executable predicate by inference.
 * Legacy calculations are declaration-only until a reviewed typed binding exists.
 */
import { PACK_CALCULATION_OPERATORS, PACK_REPORT_BLOCKS, DOMAIN_PACK_SOURCE_SCHEMA, type DomainPackSource, type PackDefinition, type PackOwner } from "./domain-pack-source";
import type { Pack } from "./pack-contracts";

const slug = (raw: string): string =>
  raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "unnamed";
const manual = () => ({ op: "REVIEW_REQUIRED" as const });

export type LegacyImportResult =
  | { ok: true; source: DomainPackSource; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * Imports the supported v2 sections without changing or re-parsing old packs.
 * The caller supplies asserted owner information; the compiler does not confer
 * editing/publishing permission. A server must authorize the actual actor.
 */
export function legacyPackToEditableSource(pack: Pack, owner: PackOwner): LegacyImportResult {
  const definitions: PackDefinition[] = [];
  const warnings = [
    "Legacy free-text checks require review; no deterministic verdict is asserted.",
    "Legacy calculations are declarations only until typed operands are reviewed.",
    "Legacy Markdown does not define a typed domain ontology or trusted jurisdiction.",
  ];
  const errors: string[] = [];
  const seen = new Set<string>();
  function push(definition: PackDefinition): void {
    if (seen.has(definition.id)) errors.push("duplicate_imported_definition:" + definition.id);
    else { seen.add(definition.id); definitions.push(definition); }
  }
  for (const [index, rule] of pack.rules.entries()) push({
    id:"guideline:legacy-"+(index+1),kind:"guideline",label:"Imported legacy guidance",
    text:rule,scope:"INVESTIGATION",
  });
  if (pack.rules.length) warnings.push("Legacy free-text rule IDs require manual stabilization before publication.");
  for (const check of pack.checks) push({
    id: "check:" + check.id, kind: "check", label: check.check,
    criterion: manual(), ...(check.question ? {question:check.question} : {}),
    evidenceDescription: check.evidence,
    ...(check.authority ? {authority:{kind:"REFERENCE",citation:check.authority} as const} : {}),
  });
  for (const row of pack.documentsUsuallyNeeded) push({
    id: "document:" + slug(row.document), kind: "document", label: row.document,
    aliases: [], appliesWhen: manual(), settlesCheckIds: row.settlesCheckIds.filter((id)=>id.trim() !== "" && id !== "-").map((id)=>"check:"+id),
    timingDescription:row.when,applicabilityDescription:row.appliesWhen ?? "",
  });
  for (const value of pack.computedValues) {
    if (!(PACK_CALCULATION_OPERATORS as readonly string[]).includes(value.op)) {
      errors.push("unsupported_legacy_calculation:" + value.id + ":" + value.op);
      continue;
    }
    push({
      id:"calculation:"+value.id, kind:"calculation", label:value.label,
      operator:value.op as (typeof PACK_CALCULATION_OPERATORS)[number],
      state:"DECLARATION_ONLY", inputFields:[], legacyInputs:value.inputs,scope:value.per,
    });
  }
  for (const chain of pack.chains) push({
    id:"chain:"+chain.id, kind:"chain", label:chain.label, links:[...chain.links],
  });
  for (const sq of pack.standingQuestions) push({
    id:"question:"+sq.id, kind:"question", label:sq.id, text:sq.question,
    audience: sq.audience === "customer" || sq.audience === "professional" ? sq.audience : "all",
    appliesWhen:manual(),conditionDescription:sq.askWhen,
  });
  for (const q of pack.askThePerson) push({
    id:"question:"+q.id, kind:"question", label:q.id, text:q.question,
    audience:q.audience === "customer" || q.audience === "professional" ? q.audience : "all",
    appliesWhen:manual(),rationale:q.why,
  });
  for (const persona of pack.personas) {
    const ids: string[] = [];
    for (const q of persona.lookingFor) {
      if (!q.id) { warnings.push("unkeyed_persona_question:"+persona.audience); continue; }
      const id = "question:"+persona.audience+":"+q.id;
      push({id,kind:"question",label:q.id,text:q.text,audience:persona.audience,appliesWhen:manual()});
      ids.push(id);
    }
    push({
      id:"persona:"+persona.audience,kind:"persona",label:persona.who,
      audience:persona.audience,context:persona.situation,questionIds:ids,
      knows:persona.knows,doesNotKnow:persona.doesNotKnow,decisions:persona.decisions,
      usefulWhen:persona.usefulWhen,leaveOut:persona.leaveOut,successTest:persona.successTest,
    });
  }
  for (const term of pack.terms) push({
    id:"term:"+slug(term.term),kind:"term",label:term.term,meaning:term.plainMeaning,
  });
  for (const table of pack.referenceTables) push({
    id:"referenceTable:"+slug(table.name),kind:"referenceTable",label:table.name,
    columns:[...table.headers],rows:table.rows.map((row)=>[...row]),
  });
  for (const note of pack.generalNotes) push({
    id:"note:"+note.id,kind:"note",label:note.id,text:note.text,showWhen:note.showWhen,
  });
  const supportedBlocks: ReadonlySet<string> = new Set(PACK_REPORT_BLOCKS);
  for (const audience of ["customer","professional"] as const) {
    const template = audience === "customer" ? pack.customerReport : pack.professionalReport;
    if (!template) continue;
    const sections = template.sections.map((section) => {
      const blockNames = section.blocks.map((b)=>b.name);
      for (const name of blockNames) if (!supportedBlocks.has(name)) warnings.push("unsupported_legacy_report_block:"+name);
      return {
        id:"section:"+slug(section.heading),
        heading:section.heading,
        blocks:blockNames.filter((name)=>supportedBlocks.has(name)),
        templateDescription:section.builtFromRaw,
      };
    });
    push({id:"report:"+audience,kind:"report",label:template.title,audience,sections,voice:template.voice});
  }
  if (pack.briefOnly) warnings.push("Legacy brief-only Pack has no typed executable rules.");
  if (errors.length) return {ok:false,errors};
  return {
    ok:true,
    warnings,
    source:{
      schema:DOMAIN_PACK_SOURCE_SCHEMA,
      identity:{
        packId:pack.meta.pack,version:pack.meta.version+".0.0",
        title:pack.meta.title,description:pack.meta.description,
      },
      ownership:owner,
      applicability:{
        jurisdiction:pack.meta.jurisdiction || "unspecified",
        verification:"UNVERIFIED",
        intentHints:pack.meta.matches.intent,
        documentHints:pack.meta.matches.documents,
      },
      definitions,
      changes:[],
      review:{status:"DRAFT"},
    },
  };
}
