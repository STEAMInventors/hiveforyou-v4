import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePackMarkdown } from "./pack-contracts";
import { legacyPackToEditableSource } from "./domain-pack-legacy-adapter";
import { canonicalPackJson, compileDomainPack, packDigest } from "./domain-pack-compiler";
import { DOMAIN_PACK_SOURCE_SCHEMA, type DomainPackSource, type PackDefinition } from "./domain-pack-source";

const fixture = join(import.meta.dirname, "../testing/fixtures/widget-review-pack.md");
const parseFixture = () => {
  const parsed = parsePackMarkdown(readFileSync(fixture, "utf8"));
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
};
const owner = { scope: "PLATFORM" as const, ownerId: "platform", authoredBy: "system" };
const baseSource = (): DomainPackSource => {
  const imported = legacyPackToEditableSource(parseFixture(), owner);
  if (!imported.ok) throw new Error(imported.errors.join(","));
  return imported.source;
};
const compileBase = () => {
  const result = compileDomainPack(baseSource());
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
};
const derived = (): DomainPackSource => {
  const base = compileBase();
  return {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: {packId:"firm-a/widget-review", version:"1.0.0", title:"Firm A review"},
    ownership: {scope:"FIRM",ownerId:"firm-a",authoredBy:"editor-a"},
    applicability: {jurisdiction:"neutral test jurisdiction",verification:"UNVERIFIED"},
    upstream: {packId:base.identity.packId,version:base.identity.version,digest:base.identity.digest},
    definitions:[],
    changes:[],
    review:{status:"DRAFT"},
  };
};
const check = (id: string): PackDefinition => ({
  id,kind:"check",label:"Additional review criterion",
  criterion:{op:"REVIEW_REQUIRED"},question:"Can we verify the extra requirement?",
});

describe("editable Domain Pack DP-1", () => {
  it("imports existing Markdown without converting prose checks into executable rules", () => {
    const source = baseSource();
    expect(source.schema).toBe(DOMAIN_PACK_SOURCE_SCHEMA);
    expect(source.review.status).toBe("DRAFT");
    expect(source.applicability.verification).toBe("UNVERIFIED");
    expect(source.definitions.some((d)=>d.kind==="check")).toBe(true);
    expect(source.definitions.filter((d)=>d.kind==="check").every((d)=>d.criterion.op==="REVIEW_REQUIRED")).toBe(true);
    expect(source.definitions.filter((d)=>d.kind==="calculation").every((d)=>d.state==="DECLARATION_ONLY")).toBe(true);
  });

  it("compiles existing parsed format-2 pack, preserving source IDs and report templates", () => {
    const runtime = compileBase();
    expect(runtime.identity.version).toBe("2.0.0");
    expect(runtime.identity.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(runtime.definitions.some((d)=>d.id==="check:T1")).toBe(true);
    expect(runtime.definitions.some((d)=>d.id==="report:professional")).toBe(true);
    expect(runtime.publication).toBe("UNPUBLISHED");
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.definitions[0])).toBe(true);
  });

  it("produces reproducible cryptographic identities across object key ordering", () => {
    expect(canonicalPackJson({b:2,a:1})).toBe(canonicalPackJson({a:1,b:2}));
    expect(packDigest({b:2,a:1})).toBe(packDigest({a:1,b:2}));
    const first = compileDomainPack(baseSource());
    const second = compileDomainPack(baseSource());
    expect(first).toEqual(second);
  });

  it("allows a separately owned firm edition to add a check while leaving upstream frozen", () => {
    const base = compileBase();
    const draft = derived();
    draft.changes.push({op:"add",definitionId:"check:firm-extra",definition:check("check:firm-extra"),reason:"Practice intake preference"});
    const compiled = compileDomainPack(draft,base);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.ownership.ownerId).toBe("firm-a");
    expect(compiled.value.identity.digest).not.toBe(base.identity.digest);
    expect(compiled.value.definitions.some((d)=>d.id==="check:firm-extra")).toBe(true);
    expect(base.definitions.some((d)=>d.id==="check:firm-extra")).toBe(false);
    expect(compiled.value.upstream?.digest).toBe(base.identity.digest);
  });

  it("supports independent professional editions without any upstream", () => {
    const source = baseSource();
    source.identity = {packId:"pro-a/new-review",version:"1.0.0",title:"Independent review"};
    source.ownership = {scope:"PRO",ownerId:"pro-a",authoredBy:"pro-a"};
    source.definitions = [check("check:pro-only")];
    const result = compileDomainPack(source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.upstream).toBeUndefined();
  });

  it("replaces and supersedes by stable ID, requiring an auditable reason", () => {
    const base = compileBase();
    const replacement = derived();
    replacement.changes.push({op:"supersede",definitionId:"check:T1",definition:check("check:T1"),reason:"Firm review practice"});
    const result = compileDomainPack(replacement,base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.definitions.find((d)=>d.id==="check:T1")?.origin.operation).toBe("supersede");
    expect(result.value.editHistory.at(-1)?.reason).toBe("Firm review practice");
  });

  it("refuses a moved upstream digest and silent upgrade", () => {
    const base = compileBase();
    const edition = derived();
    edition.upstream!.digest = "0".repeat(64);
    const r = compileDomainPack(edition,base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i)=>i.code==="upstream_digest_mismatch")).toBe(true);
  });

  it("refuses arbitrary edit targets, duplicate IDs and type changes", () => {
    const base = compileBase();
    const draft = derived();
    draft.changes.push({op:"replace",definitionId:"check:absent",definition:check("check:absent"),reason:"Test"});
    const invalid = compileDomainPack(draft,base);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.issues.some((i)=>i.code==="edit_target_missing")).toBe(true);
    const src = baseSource();
    src.definitions.push(structuredClone(src.definitions[0]));
    const duplicate = compileDomainPack(src);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.issues.some((i)=>i.code==="duplicate_definition")).toBe(true);
  });

  it("does not permit disabling a check still required by a document", () => {
    const base = compileBase();
    const draft = derived();
    draft.changes.push({op:"disable",definitionId:"check:T1",reason:"Not used in this process"});
    const result = compileDomainPack(draft,base);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i)=>i.code==="check_target_missing")).toBe(true);
  });

  it("rejects code payload, prototype keys and arbitrary workflow URLs", () => {
    const source = baseSource() as unknown as Record<string, unknown>;
    source.evil = () => "run";
    const bad = compileDomainPack(source);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.some((i)=>i.code==="unsafe_value" || i.code==="unknown_field")).toBe(true);
    const workflow = baseSource();
    workflow.definitions.push({
      id:"workflow:test",kind:"workflow",label:"Untrusted action",
      steps:[{id:"s1",action:"WEBHOOK" as "ASK_QUESTION",requiresReview:false,url:"https://example.invalid"} as never],
    });
    const invalid = compileDomainPack(workflow);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.issues.some((i)=>i.code==="workflow_unsafe_action")).toBe(true);
    const polluted = JSON.parse('{"schema":"hive.domain-pack-source/1","__proto__":{"admin":true}}');
    const rejected = compileDomainPack(polluted);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.issues.some((i)=>i.code==="unsafe_key")).toBe(true);
  });

  it("rejects unknown operators, legal authority without review and inconsistent dates", () => {
    const calc = baseSource();
    calc.definitions.push({
      id:"calculation:bad",kind:"calculation",label:"Bad operator",
      operator:"EVAL" as "DIFFERENCE",inputFields:[],state:"EXECUTABLE",
    });
    const c = compileDomainPack(calc);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.issues.some((i)=>i.code==="calculation_invalid")).toBe(true);
    const authority = baseSource();
    authority.definitions.push({...check("check:law"),authority:{kind:"REGULATION",citation:"Unreviewed rule"}});
    const a = compileDomainPack(authority);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.issues.some((i)=>i.code==="authority_review_missing")).toBe(true);
    const dated = baseSource();
    dated.applicability.effectiveFrom = "2026-12-01";
    dated.applicability.effectiveTo = "2026-01-01";
    const d = compileDomainPack(dated);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.issues.some((i)=>i.code==="applicability_dates")).toBe(true);
  });

  it("allows typed data fields and safe reviewed predicates without executing them", () => {
    const source = baseSource();
    source.definitions.push({
      id:"entity:batch",kind:"entity",label:"Batch",
      fields:[{id:"start",valueType:"DATE"},{id:"end",valueType:"DATE"}],
    });
    source.definitions.push({
      id:"check:batch-start",kind:"check",label:"Batch has a start",
      criterion:{op:"FIELD_PRESENT",entityId:"entity:batch",fieldId:"start"},
    });
    const result = compileDomainPack(source);
    expect(result.ok).toBe(true);
  });

  it("rejects missing typed entity references and unsupported predicates", () => {
    const source = baseSource();
    source.definitions.push({
      id:"check:missing-entity",kind:"check",label:"Unknown entity",
      criterion:{op:"FIELD_PRESENT",entityId:"entity:missing",fieldId:"start"},
    });
    const result = compileDomainPack(source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i)=>i.code==="predicate_target_missing")).toBe(true);
    const other = baseSource();
    other.definitions.push({...check("check:unsafe"),criterion:{op:"ARBITRARY_JS"} as never});
    const reject = compileDomainPack(other);
    expect(reject.ok).toBe(false);
    if (!reject.ok) expect(reject.issues.some((i)=>i.code==="predicate_operator")).toBe(true);
  });
});
