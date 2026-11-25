# DP-1 — Editable Domain Pack contract (offline implementation)

**Status:** Draft / review only. This document describes an isolated contract experiment. There is no database migration, processing-path integration, publishing endpoint, permission change, Study rewrite, or Domain Studio UI.

## Goal

A professional or firm may author an independent Domain Pack edition, or create an edition from one *exact* immutable upstream artifact. Both first-party and professional sources compile through the same code. Source-provided ownership is **not authentication** and cannot grant edit/publish privileges. A future service must verify actor, owner scope and publication approval before accepting any source.

## Contract files

- `packages/contracts/src/pipeline/domain-pack-source.ts`: browser-safe editable `hive.domain-pack-source/1` and immutable `hive.domain-pack-runtime/1` shapes.
- `packages/contracts/src/pipeline/domain-pack-compiler.ts`: Node-side offline validation, effective snapshot resolution, stable-ID patching and SHA-256 digest. Never executes authored JavaScript, SQL, external URLs or webhooks.
- `packages/contracts/src/pipeline/domain-pack-legacy-adapter.ts`: loss-aware adapter from the existing `hive.pack/2` parser. It preserves supported definition IDs and report sections. Its imported checks are **REVIEW_REQUIRED**, not executable checks. Its imported calculations are **DECLARATION_ONLY** until reviewed typed operand definitions exist.

No existing export, pipeline, Pack file or Study schema was modified by DP-1.

## What a professional edition can change

`identity.packId` uniquely identifies a Pro/Firm edition; `identity.version` is its independent semantic version. `ownership.scope` is `PRO` or `FIRM` (and `PLATFORM` for first-party authors); `ownership.ownerId` is a declared owner identity. The trusted service must independently authorize the edit.

An edition may have no upstream and provide complete definitions, or reference one immutable upstream as `{ packId, version, digest }` and apply ID-based `add`, `replace`, `supersede`, and `disable` operations with a nonblank reason. A mismatched upstream digest, changed definition kind, missing target, duplicate ID, invalid reference, unsupported operator, unsafe action or unreviewed legal authority fails compilation.

Compilation flattens inherited and amended definitions and calculates a content digest. The compiled artifact is deeply frozen and marked `UNPUBLISHED`. This compiler does not certify legal accuracy or authorize publication.

## Supported typed definition families

Entity / attributes, relationships, documents, checks and predicates, calculations, chains, questions, workflows with allowlisted actions, reports with allowlisted data blocks, terms, reference tables, personas, and notes.

The current predicate contract represents bounded comparison and presence checks. DP-1 does not evaluate them. DP-2 (`docs/HiveForYou-DOMAIN-PACK-DP2-CONTRACT.md`) evaluates a compiled snapshot against verified facts. Legacy prose is still not upgraded into an executable rule.

The current legacy Markdown parser does not expose every domain-oriented table (notably `Record kinds`); the adapter does not invent those missing definitions. A separate reviewed adapter enhancement is required for complete ontology migration.

## Offline example

~~~ts
const base = compileDomainPack(firstPartySource);
if (!base.ok) throw new Error(JSON.stringify(base.issues));

const firmDraft: DomainPackSource = {
  schema: "hive.domain-pack-source/1",
  identity: { packId: "firm-example/record-review", version: "1.0.0", title: "Firm record review" },
  ownership: { scope: "FIRM", ownerId: "firm-example", authoredBy: "editor-1" },
  applicability: { jurisdiction: "practice scope pending review", verification: "UNVERIFIED" },
  upstream: {
    packId: base.value.identity.packId,
    version: base.value.identity.version,
    digest: base.value.identity.digest,
  },
  definitions: [],
  changes: [{
    op: "add",
    definitionId: "check:local-question",
    reason: "Firm-specific review practice",
    definition: {
      id: "check:local-question",
      kind: "check",
      label: "Ask for supplementary record",
      criterion: { op: "REVIEW_REQUIRED" },
      question: "Would another record help clarify this?",
      authority: { kind: "FIRM_POLICY", citation: "Internal practice checklist" },
    },
  }],
  review: { status: "DRAFT" },
};

const firm = compileDomainPack(firmDraft, base.value);
if (!firm.ok) throw new Error(JSON.stringify(firm.issues));
// firm.value is an immutable, UNPUBLISHED effective snapshot.
// A published edition requires a separate authorized review/publish action.
~~~

## Trust and history constraints

1. No source, no claim: the Pack defines criteria and question templates, **not facts about a case**. Case facts remain bound to authorized, independently verified pages and excerpts.
2. Typed checks do not imply valid evaluations; domain calculation and rule execution are not wired into production by DP-1.
3. Published artifact ownership is separate from Hive membership and from authorization to read a case.
4. Old accepted Studies and reports retain their existing `packRef` behavior; DP-1 does not rewrite them.
5. There is no automatic rebase when the first-party Pack updates. An edition pins the original digest.
6. No client/Pro editing API, UI, storage table, background job, or deployment is introduced here.

## Verification

Run `npm run typecheck -w @hiveforyou/contracts` and `npm run test -w @hiveforyou/contracts` before review. `domain-pack-legacy-smoke.test.ts` walks the current active first-party Pack files (not the archive) and attempts to import and compile the supported sections without assigning executable semantics.

Before DP-2, review the incomplete legacy imports, add a publication authorization contract, and approve explicit typed bindings for the initial deterministic checks. Do not publish or wire an `UNPUBLISHED` artifact into production.
