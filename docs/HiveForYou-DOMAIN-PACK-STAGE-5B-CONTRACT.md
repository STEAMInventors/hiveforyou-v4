# Stage 5B — Investigation plan and conversational authoring

**Status:** Design ready. Draft artifacts only. No planner, Domain Studio, model tool, pipeline wiring, UI, database, publication, or legal review is authorized by this document.

Stage 5A remains the plan and ledger contract. This document records that the proof-pack data blockers are closed, and it adds the architectural requirements for a later natural-language professional configuration. Those requirements use DP-1. They do not add a rule-module system, and they do not put domain-specific logic in Hive Core.

## Proof pack after Stage 5A.2

`iep-us-federal` `0.3.0` still has 275 compiled definitions, review `DRAFT`, applicability `UNVERIFIED`, publication `UNPUBLISHED`. All 149 authorities stay `NOT_REVIEWED`.

Stage 5A.1 made `definitionAuthorityMap` and `relatedDefinitionIds` agree, and it pinned structured joins on the seven day-count calculations. Stage 5A.2 withdrew the seven proposed check ids that were not compiled definitions. Their mappings, absent role objects, and rationale are in `packs/drafts/iep-us-federal/v0.3.0/iep-domain-proposed-checks.v1.json` (`hive.domain-proposed-check-set/1` version `1.0.0`). That file is not one of the seven companion specs and is not a planner input.

Active register digest: `b7175fb6a54aa5085bbba9c63e9c0827fd4dab1858f12a5e25c36946c3018f74`.

Map keys after the withdrawal: 232. Of those, 214 are compiled definitions from the 275. Fourteen are conflict patterns and four are state overlays, which Stage 5A rule 4 already allows. Zero keys fall outside those sets. `calculation:C21` and `conflictPattern:CP-SCORE-MISMATCH` stay unresolved. No replacement authority was created for either.

The ontology join pin is unchanged: `60e096187cbc44346ec78b76648edd4fcd159e407d0ec1d60000d62610455fd8`. `C1`, `C2`, `C3`, `C15`, and `C21` carry `join.relationshipId` in the authored direction. `C14` and `C20` use `join: null`.

## What a later Stage 5B implementation may do

An offline implementation may compile `hive.domain-investigation-plan/1` and `hive.domain-investigation-ledger/1` for this pinned bundle. The acceptance bar is the Stage 5A contract, read with the pins above:

- All 275 definitions are classified. The 27 presentation and configuration definitions are coverage rows. They are not passed to DP-2.
- Investigation coverage is per instance, including `NO_INSTANCE` and `UNRESOLVED_INSTANCE`.
- A join is the structured relationship id and the authored direction. Prose is not a declaration. Duplicate links for the same endpoints stay `AMBIGUOUS_RELATIONSHIP`.
- `evaluateDomainRules` runs only for an executable task whose join gate passed. `REVIEW_REQUIRED` stays a question. `ESTABLISHED` is an evidence disposition, not a legal conclusion.
- An empty authority gate does not authorize a legal conclusion. `UNREVIEWED_AUTHORITY` stays on every row that cites this register.
- The proposal set is not compiled, not classified as one of the 275, and not evaluated.

Pipeline call sites stay unwired. DP-1 and DP-2 semantics are not edited. An accepted Study keeps the digests it was accepted with.

## Conversational authoring

A later Domain Studio may accept professional language and propose a pack edition. The conversation is not the compiler, not the evaluator, and not an approval. Hive Core stays domain-blind: pack words travel as data, and the same DP-1 compiler accepts or rejects them.

### Typed, atomic proposed change sets

A proposal is one `hive.domain-pack-source/1` draft, or a patch against one pinned upstream, whose `changes` array is a list of DP-1 `PackEdit` values. Each item is one definition id, one operation, and one nonblank reason. The model may propose that object. Trusted code validates it. The model does not emit a compiled snapshot, a verdict, a day count, or a Study revision.

The set is atomic: `compileDomainPack` accepts the whole set or returns issues and no snapshot. A partial apply is not a result.

### Incremental operations

The only operations are the DP-1 operations already implemented:

- `add` inserts one new definition.
- `replace` and `supersede` require the same definition id and the same kind.
- `disable` keeps the id in the edition, records the reason, and leaves it unevaluated.

No fifth operation is added. A conversational phrase such as "change the deadline" becomes one of those four edits or it is rejected. The seven withdrawn proposals are not revived by conversation. Promoting one is a later reviewed `add`, and only when an ontology rule id exists and every authority used as the statement is more than a partial snippet.

### Ownership, provenance, applicability, and edition pinning

The draft carries `ownership` (`PLATFORM`, `PRO`, or `FIRM`), `authoredBy`, and optional `upstream: { packId, version, digest }`. Those fields are declarations. They are not authentication and they do not grant permission to edit a case or to publish.

Applicability keeps `jurisdiction` and `verification`. A conversation cannot set `verification` to `REVIEWED` and cannot treat `unknown` or `unspecified` as a jurisdiction. `effectiveFrom` and `effectiveTo` are copied and are not applied, because DP-2 still has no verified evaluation-date binding.

An edition pins one upstream digest. A later upstream does not rebase the edition. Provenance of a proposed change is the edit reason plus the upstream digest the compiler checked. A mismatched digest fails compilation.

### Three separate families

Legal authority, professional methodology, and report preferences stay separate data. They are not one rule module.

- **Legal authority.** Citations and register links. `humanReview: NOT_REVIEWED` fails closed for any use as a statement of law. A conversation cannot mark an authority reviewed, cannot clear `PARTIAL_SNIPPET`, and cannot turn a citation into a conclusion about a person.
- **Professional methodology.** Entities, relationships, documents, checks, calculations, chains, questions, and workflows, using the DP-1 definition kinds. A check becomes executable only when its predicate is already a DP-1 operator. `REVIEW_REQUIRED` stays a question. A calculation becomes executable only as `DAYS_BETWEEN` with typed `start` and `end` bindings. Other operators stay unsupported.
- **Report preferences.** Personas, reports, notes, guidelines, terms, and reference tables. These are presentation and configuration. They are not passed to DP-2 and are not findings.

Hive Core does not contain IEP rules or any other profession's rules. The pack carries that vocabulary.

### Deterministic validation and plain-language preview

`compileDomainPack` is the validator. The same draft and the same upstream digest always produce the same issues or the same unpublished snapshot and the same digest.

The preview is a deterministic rendering of that result, in plain language: which ids would be added, replaced, superseded, or disabled; which of those rows would be executable, review-only, presentation, or unsupported; and which authority gates would remain. The preview quotes compiler issues. It does not call a model again, and it does not say that a statute applies to a case.

### Professional approval before activation

Compilation leaves `publication: UNPUBLISHED`. Preview is not activation. A professional approval names the exact compiled digest and is a separate authorized action. This contract does not implement that action. Ownership on the snapshot is not that approval.

### Reversible changes

`disable`, or a later edition that supersedes the change, is how a professional withdraws it. The id remains accounted for. An accepted Study and its reports keep the pack digest they were accepted with. Reversal does not rewrite them. A new Study revision, if any, is a later pipeline ticket.

### Executable, review, and unsupported

The preview and any later planner use the classes Stage 5A already defined:

- **Executable.** A check whose predicate is an executable DP-1 operator, or a calculation with `state: EXECUTABLE` and `operator: DAYS_BETWEEN`, and only after the relationship and evidence gates pass. `ESTABLISHED` and a computed day count are evidence dispositions. They are not legal conclusions.
- **Review-based investigation.** `REVIEW_REQUIRED` checks, `DECLARATION_ONLY` calculations, questions, chains, and entity, relationship, and document binding. The product shows the pack's question, the evidence disposition, and what is missing.
- **Unsupported.** `EVERY`, `EXISTS`, conflict patterns, state overlays, and calculation operators DP-2 already returns as `CALCULATION_UNSUPPORTED`. They are recorded as unsupported. They are not simulated and not added to DP-1.

The proposal file from Stage 5A.2 is a preserved candidate list. It is none of these three classes until a reviewed edition adds a real definition.

## Stage 5B.3 ledger

`buildCoverageLedger` accounts for every plan task and presentation row. It calls `evaluateDomainRules` only with independently verified facts and relationships. Unresolved relationship candidates stay `REVIEW_REQUIRED` and are not copied into that evidence. Pipeline, prompt, database, and UI call sites stay unwired. DP-1 and DP-2 are unchanged.

## Stage 5B.4 result binding

Ontology `ruleIds` remain the investigation-subject mapping. Zero subjects, or more than one, still records `coverage.population: UNRESOLVED_SUBJECT`. That population is not the calculation result.

An executable `DAYS_BETWEEN` calculation whose structured join passed carries `resultBinding`:

```ts
resultBinding?: {
  relationshipId: string
  fromEntityId: string
  toEntityId: string
}
```

The object is copied from the join that already passed. It is present only when that join names one compiled relationship in the authored start-to-end direction. `join: null` stays a same-entity calculation and does not get `resultBinding`. A missing join, the wrong direction, or more than one relationship between the same entity types does not get `resultBinding`, and the ledger does not adopt a day count.

The ledger result identity is `relationshipId` plus one ordered `(fromInstanceId, toInstanceId)` pair. One relationship with several endpoint pairs produces one row per pair. An endpoint instance with no verified link of that relationship stays its own `NOT_EVALUATED` row, reason `CROSS_ENTITY`, missing that relationship id once. Duplicate verified links for the same ordered endpoints stay `AMBIGUOUS_RELATIONSHIP` and have no day count. The ledger does not choose a relationship by entity type, proximity, or an unresolved candidate.

A verified relationship is `relationship_promoted` only when every one of its source refs is also a source ref of an unresolved relationship candidate for the same relationship id and the same ordered endpoints. A candidate for those endpoints does not reject a relationship that cites a different source. The candidate stays `REVIEW_REQUIRED` and is not copied into verified evidence. DP-1, DP-2, and the binder's relationship-meaning policy are unchanged. DP-2 may still emit `relationship:` in front of an id that already begins with `relationship:`. The ledger reports that dependency once.

## Out of scope

This document does not authorize the planner, Domain Studio, model tools, prompt changes, pipeline wiring, UI, database tables, publication, or a new compiler. DP-1 and DP-2 tests stay the tests of the existing compiler and evaluator.
