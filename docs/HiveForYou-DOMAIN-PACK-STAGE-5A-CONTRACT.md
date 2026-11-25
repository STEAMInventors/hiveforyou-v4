# Stage 5A — Domain Investigation Planner contract

**Status:** Corrected design. Conditionally approved architecture, with the six corrections below. Design only. No production code, tests, prompts, database, commit, or push.

This document replaces the chat-only Stage 5A draft. It keeps that draft's boundaries: one compiled Domain Pack, digest-pinned companion artifacts, a case-independent plan, private candidate proposals, deterministic evidence checks, and `evaluateDomainRules` for executable rows. DP-1 and DP-2 are unchanged.

## Corrections incorporated

1. The ontology and the authority register are digest-pinned with the five supplemental specifications. Authority mappings resolve only through the register's explicit map and are validated in both directions.
2. All 275 Pack definitions are accounted for. Presentation and configuration definitions are a separate class from investigation tasks. Only an executable investigation task may be passed to DP-2.
3. Coverage is per instance. A check such as `check:G2` is accounted for independently on every verified instance of its subject entity, and the no-instance and unresolved-instance cases each have their own row.
4. A join uses a declared relationship id and the relationship's authored direction. Entity types do not select the relationship. Several verified facts for that same id and the same ordered endpoints stay `AMBIGUOUS_RELATIONSHIP`.
5. An empty authority gate does not authorize a legal conclusion. Studies ask the pack's questions and show evidence dispositions.
6. Every model-proposed relationship needs its own quote-verified evidence that the link holds. A list of already verified fact ids is not that evidence.

## What is preserved

`compileDomainPack` still emits a frozen `hive.domain-pack-runtime/1`. Publication stays `UNPUBLISHED`. A professional edition still pins one upstream `{ packId, version, digest }` and applies `add`, `replace`, `supersede`, and `disable`.

`evaluateDomainRules` still accepts only that snapshot and `hive.verified-case-facts/1` records already marked `VERIFIED`. Its outcomes, reason codes, and pairing rules are not edited. `ESTABLISHED` remains the only affirmative check outcome. `COMPUTED` remains an exact `DAYS_BETWEEN` integer and is not a compliance result. Inside DP-2, several sourced facts for one relationship id and the same endpoints still produce one `NOT_EVALUATED` / `AMBIGUOUS_RELATIONSHIP` row and no day count. Three or more entities remain `CROSS_ENTITY`.

The planner does not call DP-2's entity-type search as its own join resolver. Where this contract is stricter than DP-2, the planner records the row and does not ask DP-2 to choose a relationship. Direct DP-2 tests, including the Stage 4B day-count proof, stay on `evaluateDomainRules` and are not rerouted through the planner.

No source, no claim. Pack text is criteria and questions, not facts about a case. An accepted Study keeps the digests it was accepted with. A later edition does not rebase it.

## Pinned companion bundle

`hive.domain-supplemental-bundle/1` is data beside the pack. It is not a DP-1 definition kind. Each item is addressed by schema and by the same content digest the compiler already uses (`packDigest` of the canonical file bytes). A missing file, a schema mismatch, or a digest mismatch fails compilation. No plan is emitted.

```ts
{
  schema: "hive.domain-supplemental-bundle/1"
  items: Array<{
    schema:
      | "hive.domain-conflict-pattern-spec/1"
      | "hive.domain-state-overlay-spec/1"
      | "hive.domain-fact-class-spec/1"
      | "hive.domain-workflow-coverage-spec/1"
      | "hive.domain-unsupported-operator-spec/1"
      | "hive.domain-ontology-spec/1"
      | "hive.domain-authority-register/1"
    digest: string
  }>
}
```

The first five stay `dp1Supported: false`. The ontology and the authority register are pinned the same way. Their proposed schema strings are recorded as data. Pinning does not promote either file into DP-1, and it does not review an authority.

On the Stage 4B proof pack (`iep-us-federal` `0.3.0`, 275 definitions, review `DRAFT`, applicability `UNVERIFIED`), the seven files are the drafts under `packs/drafts/iep-us-federal/v0.3.0/`. Those files are the proof instance. Hive Core does not gain their vocabulary.

### Ontology pin

The ontology is an annotation overlay on the compiled pack. The planner uses it only where this contract names a field.

- `packRef.packId` and `packRef.version` must equal the compiled identity. The ontology does not carry the pack digest today, so identity equality is necessary and is not treated as a digest pin of the pack. The pack digest is pinned separately on the plan.
- Entity, relationship, and document ids in the ontology must be the same set as the compiled pack, with the same relationship direction (`fromEntityId` → `toEntityId`). A field id on an ontology entity must exist on that compiled entity with the same value type. The compiler does not invent a definition the pack does not contain, and it does not drop a pack definition the ontology omits.
- `factClass` must be one of the names in the pinned fact-class spec, or the entity is `UNCLASSIFIED`. The compiler does not fill a missing class.
- `ruleIds` on an entity are the explicit subject-entity declaration for those check, calculation, and question ids. A check is not given a subject by reading its label or by matching field names.
- `authorityIds` on an ontology node must each exist in the pinned register. They do not add mappings. The register map is the mapping.
- `instanceBoundary`, `identityKeys`, `cardinality`, and `evidenceForLink` are annotations the binder reads. They are not predicates and not DP-1 fields.
- Calculation `preconditions` strings are not parsed. A relationship id written inside that prose is not a declaration.
- Document-availability states stay annotations. They do not become a new definition kind.

### Authority resolution and validation

The register is a cited artifact. Resolution never uses the citation string on a DP-1 `authority` object, and it never matches an authority by title or section text.

The only mapping from a definition to authorities is `definitionAuthorityMap[definitionId]`, an explicit list of `authorityId` values.

Validation fails the bundle, and no plan is emitted, when any of the following is true:

1. An `authorityId` is duplicated, or a mapped id is not in `authorities`.
2. The authority record's `relatedDefinitionIds` does not contain that definition id. The map and the inverse must agree. A one-way link is not a mapping.
3. `authorityRoles[definitionId]` names an authority id that is not in that definition's map entry, or a map entry has a role object that omits one of its mapped ids. When no role object exists, the map entry still stands.
4. A map key is not a compiled definition id and is not an id in the pinned conflict-pattern or state-overlay spec. Proposed ids that were left out of the pack are not implicit targets.
5. An id listed only under `unusedAuthorityDisposition` appears in a map entry.
6. An ontology `authorityIds` value is absent from the register.
7. `structuralDefinitions` marks a presentation definition as making no domain claim, and that same id also appears in `definitionAuthorityMap`.

Role strings and `interpretation.establishes` / `doesNotEstablish` are copied onto the task as data. A role that records a limit, or that the authority is not the statement, keeps that authority as a limitation. It is not promoted to the statement.

Every authority on the current proof register has `humanReview: NOT_REVIEWED`. The ledger therefore sets `UNREVIEWED_AUTHORITY` on every row that cites the register. `verificationStatus` is copied. `PARTIAL_SNIPPET`, `AUTHOR_PROPOSED`, and any status other than a primary excerpt or paraphrase also set `UNREVIEWED_AUTHORITY`. None of these flags are cleared by a successful field check.

Stage 5A.1 made the map and `relatedDefinitionIds` agree. Stage 5A.2 removed the seven proposed check ids that were not compiled definitions. The active register digest is `b7175fb6a54aa5085bbba9c63e9c0827fd4dab1858f12a5e25c36946c3018f74`. Every remaining map key is a compiled definition or a pinned conflict-pattern or state-overlay id. Plan compilation is no longer failed closed on rule 2 or rule 4 for this pack. Authority review is still `NOT_REVIEWED`.

## Definition accounting

The compiled pack's definition list is the population. For the proof pack that population is 275. Every id appears in exactly one class. Supplemental spec rows are additional plan rows. They are not members of the 275.

| Class | Kinds | Proof-pack count | What the planner does |
|---|---|---|---|
| Presentation and configuration | `persona`, `report`, `term`, `note`, `guideline`, `referenceTable` | 27 (2 + 2 + 10 + 6 + 6 + 1) | One coverage row per id. Not an investigation task. Not passed to DP-2. No outcome, no day count, no question promoted to a finding. |
| Investigation, not executable | `entity`, `relationship`, `document`, `check` whose predicate is `REVIEW_REQUIRED`, `calculation` whose state is `DECLARATION_ONLY`, `chain`, `question` | 241 | One row per required instance, as below. Binds, asks, or records a declared calculation. No `ESTABLISHED`, `NOT_SATISFIED`, or `COMPUTED`. |
| Executable investigation | `check` whose predicate is an executable DP-1 operator; `calculation` with `state: EXECUTABLE` and `operator: DAYS_BETWEEN` | 7 calculations, 0 checks | Eligible for DP-2 after the relationship and evidence gates in this contract. |

248 investigation definitions plus 27 presentation definitions equal 275. The 241 and the 7 are the split of those 248. A `disable` edit keeps the id in its class and marks the row `DISABLED` with the edit reason. The id is still accounted for and is not evaluated.

Supplemental rows, outside the 275, stay as in the prior draft and are still not DP-1 kinds: conflict patterns, state overlays, workflow-coverage exceptions, and `EVERY` / `EXISTS`. An overlay with a null stored threshold records no comparison. `EVERY` and `EXISTS` are `UNSUPPORTED` / `OPERATOR_UNSUPPORTED`. A workflow-coverage row marked deferred is `DEFERRED`.

`hive.investigation-plan/1` remains a different schema from `hive.domain-investigation-plan/1`. The two are not merged.

## Plan

Case-independent. The digest covers the planner version, the pack id, version, and digest, the seven companion digests, the classified ids, the tasks, and the dependency edges. Case facts are not part of it. The same edition and the same companion digests always yield the same plan.

```ts
{
  schema: "hive.domain-investigation-plan/1"
  plannerVersion: "1.0.0"
  digest: string
  pack: {
    packId: string
    version: string
    digest: string
    publication: "UNPUBLISHED"
    reviewStatus: "DRAFT" | "REVIEWED"
  }
  applicability: {
    jurisdiction: string
    verification: "UNVERIFIED" | "REVIEWED"
    effectiveFrom?: string
    effectiveTo?: string
  }
  upstream?: { packId: string; version: string; digest: string }
  supplemental: /* hive.domain-supplemental-bundle/1 */
  presentation: Array<{ definitionId: string; kind: "persona" | "report" | "term" | "note" | "guideline" | "referenceTable" }>
  tasks: InvestigationTask[]
  dependencies: Array<{ fromTaskId: string; toTaskId: string; reason: string }>
  disabledDefinitionIds: string[]
}
```

An investigation task points at one compiled definition, or at one supplemental row. Presentation ids do not appear in `tasks`.

```ts
type InvestigationTask = {
  taskId: string
  definitionId: string
  taskKind:
    | "BIND_ENTITY" | "BIND_RELATIONSHIP" | "BIND_DOCUMENT"
    | "REVIEW_CHECK" | "EVALUATE_CHECK"
    | "DECLARED_CALCULATION" | "COMPUTE_DAYS_BETWEEN"
    | "TRACE_CHAIN" | "ASK_QUESTION"
    | "APPLY_CONFLICT_PATTERN" | "NOTE_OVERLAY" | "NOTE_EXCEPTION" | "NOTE_UNSUPPORTED"
    | "DISABLED"
  subjectEntityId?: string
  /** Present only when a structured join declaration passed validation. */
  join?: { relationshipId: string; fromEntityId: string; toEntityId: string } | null
  authorityIds: string[]
}
```

`effectiveFrom` and `effectiveTo` are copied and are not applied. DP-2 has no verified evaluation-date binding.

Dependency edges are unchanged in spirit, except the relationship edge: a two-entity task depends on the `BIND_RELATIONSHIP` task of its declared `join.relationshipId`, not on "the relationship whose endpoint types match." A task with no `join` has no relationship predecessor and is not paired.

## Per-instance coverage

The ledger is complete only when every presentation id appears once and every investigation task is accounted for across its instance population. "The task id appears at least once" is not coverage.

The subject entity of a check, calculation, or question is the ontology entity whose `ruleIds` list that definition id. Zero subject entities, or more than one, makes the task `UNRESOLVED_SUBJECT`. The planner does not pick an entity. One row is stored, and no instance is evaluated.

For a task with one subject entity, the population is:

| Case | Rows |
|---|---|
| No verified instance and no unresolved candidate of that entity | One row. `instances` empty. Reason `NO_INSTANCE`. |
| One or more unresolved candidates | One row per unresolved candidate. Reason `UNRESOLVED_INSTANCE`. These rows are not merged with each other or with a verified instance. |
| One or more verified instances | One row per verified instance, independent of the others. |

An unresolved candidate is a model proposal of that entity whose identity keys are missing, not quote-verified, or in conflict. It does not receive a verified instance id.

`check:G2` is the worked example. Its criterion is `REVIEW_REQUIRED`. The ontology lists it on `entity:annual-goal` only. The ledger therefore contains:

- one `NO_INSTANCE` row when the case has no verified annual-goal instance and no unresolved annual-goal candidate
- one `UNRESOLVED_INSTANCE` row for each annual-goal candidate that was proposed and not verified
- one row for each verified annual-goal instance, with that instance's own evidence, missing requirements, and authority gate

A complete record for one goal does not cover another goal. Because the criterion is `REVIEW_REQUIRED`, every one of those rows stays a question. None of them is `ESTABLISHED`.

The same population rule applies to every other subject-entity task, including each of the seven day-count calculations. A day count is not `COMPUTED` on a `NO_INSTANCE` or `UNRESOLVED_INSTANCE` row, and a missing date still produces no day count.

Presentation rows and tasks with no subject entity (`BIND_RELATIONSHIP` as a definition, chains, conflict patterns, overlays) are once per id, not once per case entity.

## Relationships

A relationship definition already declares `id`, `fromEntityId`, `toEntityId`, and `evidenceRequired`. Direction is that authored order. The opposite order is a different claim and is not this relationship.

A cross-entity calculation or check may name a join only through a structured field on the pinned ontology:

```ts
join: { relationshipId: string } | null
```

`null` is valid only when every binding of the calculation is the same entity id (one instance, two fields). A two-entity binding with `join: null`, or with `join` omitted, is `RELATIONSHIP_UNDECLARED`. The planner does not recover an id from `preconditions` prose, from the Stage 4B test table, or by searching definitions whose endpoint types equal the binding entities.

When `join` is present, validation requires all of the following. Any failure is `RELATIONSHIP_UNDECLARED` for that task, and DP-2 is not asked to pair instances:

- `relationshipId` is a compiled relationship definition.
- `fromEntityId` equals the start binding's entity id and `toEntityId` equals the end binding's entity id. A definition that runs in the opposite direction does not qualify.
- The task stores that id and that direction. Later evidence may satisfy it. Evidence does not replace it.

Stage 5A.1 pinned `join` on the proof ontology (digest `60e096187cbc44346ec78b76648edd4fcd159e407d0ec1d60000d62610455fd8`). Preconditions prose is still not a declaration. The five cross-entity day counts (`C1`, `C2`, `C3`, `C15`, `C21`) carry `join.relationshipId` in the authored direction. The two same-entity day counts (`C14`, `C20`) use `join: null`. They do not use a relationship.

Duplicate-link handling is unchanged. After a declared id and direction have been accepted, several verified relationship facts with that `relationshipId` and the same ordered `(fromInstanceId, toInstanceId)` produce one `NOT_EVALUATED` row, reason `AMBIGUOUS_RELATIONSHIP`, every relationship fact id, every source ref, and no day count. The planner does not pick one link. Distinct endpoint pairs of that same relationship are separate rows.

DP-2 still selects a relationship definition by entity-type pair, in either direction, when it is called directly, and it still returns `AMBIGUOUS_RELATIONSHIP` when more than one definition matches that pair. The planner never uses that search. If a declared join is valid and the pack also contains another relationship between the same entity types, the planner records `AMBIGUOUS_RELATIONSHIP` itself and does not call DP-2 to break the tie. The proof pack currently has 39 relationships and no repeated entity-type pair. That fact is not the resolver.

## Relationship evidence

A candidate relationship is untrusted. Checking that each cited extraction fact id exists, and was quote-verified for some other field, does not verify the link.

`hive.investigation-candidates/1` may propose a relationship only as:

```ts
{
  candidateId: string
  relationshipId: string
  fromInstanceId: string
  toInstanceId: string
  evidence: Array<{ sourceDocumentId: string; page: number; quote: string }>
}
```

There is no `extractionFactIds` field on a relationship proposal. Outcome, day count, verdict, jurisdiction, and applicability fields still reject the whole candidate set.

The binder accepts the proposal into `hive.verified-case-facts/1` only when every item below holds. Otherwise the proposal is dropped, or kept only as an unresolved candidate. It is not a verified relationship fact.

1. `relationshipId` is a compiled relationship, and the two instances are verified instances of that definition's `fromEntityId` and `toEntityId` in that order.
2. `evidenceRequired` is honored. The proof pack sets it on every relationship. Zero quotes fail the proposal.
3. Each quote is an exact quote of the authorized page of that source document, under the existing quote check (typographic folding only; paraphrase, ellipsis, unread page, and the wrong page fail).
4. The quotes are evidence for this link. Each endpoint's verified identity value, as written, must occur in those quotes. The same containment check used for a calculation input applies. A quote that is on the page but does not identify both endpoints does not establish the link.
5. Co-occurrence of the two entity types in one document is not a link. A verified field fact on each endpoint is not a link. The relationship's own quotes are the evidence.
6. The ontology `evidenceForLink` text is retained on the task as the question the quotes must answer. It is not executed as a matcher and it is not a verdict.

A verified relationship fact still has the DP-2 shape: `id`, `status: VERIFIED`, `relationshipId`, `fromInstanceId`, `toInstanceId`, `sourceRefs`. The source refs point at the quotes that passed the checks above. DP-2's rule that a relationship fact is not field, document, or calculation evidence remains in force.

## Questions, not verdicts

Authority gates on a ledger row are:

```ts
authorityGate: Array<
  | "UNREVIEWED_AUTHORITY"
  | "UNVERIFIED_APPLICABILITY"
  | "UNKNOWN_JURISDICTION"
  | "PUBLICATION_UNPUBLISHED"
>
```

An empty `authorityGate` means those four flags were not set. It does not mean a statute applies, a deadline was missed, or a legal conclusion may be stated. A later Study or report may quote a `COMPUTED` day count and may show the pack's question, the evidence disposition, the missing requirements, and the limitations copied from the register. It may not describe a check as a legal conclusion, whether or not the gate is empty.

`ESTABLISHED` and `NOT_SATISFIED`, if DP-2 returns them, stay evidence dispositions against a pack predicate. They are not verdicts. `REVIEW_REQUIRED` stays `NOT_EVALUATED`. The labels `unknown` and `unspecified` are not jurisdictions. A threshold comparison without a reviewed, matching jurisdiction stays `NOT_EVALUATED`. Publication and authority review remain a later gate, and passing that gate still does not turn a check into a legal conclusion.

## Ledger

`hive.domain-investigation-ledger/1` is case-specific. Its digest is the plan digest, the verified-fact digest, and the canonical rows.

```ts
{
  schema: "hive.domain-investigation-ledger/1"
  planDigest: string
  evidenceDigest: string
  packDigest: string
  rows: Array<{
    taskId: string
    taskKind: string
    definitionId: string
    instances: Array<{ entityId: string; instanceId: string }>
    disposition:
      | "COMPUTED" | "ESTABLISHED" | "NOT_ESTABLISHED" | "NOT_SATISFIED"
      | "CONFLICT" | "NOT_EVALUATED" | "UNSUPPORTED" | "DISABLED"
      | "DEFERRED" | "PRESENTATION" | "UNRESOLVED_INSTANCE"
    reasonCodes: string[]
    authorityGate: Array<"UNREVIEWED_AUTHORITY" | "UNVERIFIED_APPLICABILITY" | "UNKNOWN_JURISDICTION" | "PUBLICATION_UNPUBLISHED">
    supportingFactIds: string[]
    relationshipFactIds: string[]
    sourceRefs: Array<{ documentId: string; page?: string; excerptId?: string }>
    missingRequirements: string[]
    daysBetween?: string
  }>
}
```

`PRESENTATION` is the disposition of each of the 27 configuration rows. `UNRESOLVED_INSTANCE` is the disposition of an unresolved candidate row. `NO_INSTANCE` is a reason code on a `NOT_EVALUATED` row, not a second population of verified instances.

A missing presentation id, a missing task, a missing verified instance, a missing unresolved candidate, or a missing no-instance row fails the ledger. No partial ledger is returned.

`RELATIONSHIP_UNDECLARED` is a planner reason code. It is not a DP-2 code and it does not require a DP-2 change. `OPERATOR_UNSUPPORTED` and `UNCLASSIFIED` remain planner reason codes as well.

## Data flow

```
hive.domain-pack-source/1
        │ compileDomainPack
        ▼
hive.domain-pack-runtime/1  +  seven pinned companion digests
        │ compileInvestigationPlan
        ▼
hive.domain-investigation-plan/1          (case-independent)
        │
verified hive.doc-extraction/1  ──►  private candidate call
        │
        ▼
hive.investigation-candidates/1
        │ quote-verify field facts; quote-verify each proposed relationship on its own evidence
        ▼
hive.verified-case-facts/1
        │ evaluateDomainRules, only for executable tasks whose join gate passed
        ▼
hive.domain-pack-rule-evaluation/1
        │ buildCoverageLedger
        ▼
hive.domain-investigation-ledger/1
        │
        ▼
hive.canonical-study/1   (new revision only; questions and evidence dispositions)
```

The private model returns candidates only. Pack words travel as data. The prompt template stays domain-blind. The model does not see `evaluateDomainRules` and cannot set outcomes.

Exact call sites stay where the prior draft put them, and they stay unimplemented: `selectAndPersistDomainPack`, `runCanonicalizeForRun`, `canonicalizeCase`, `applyPackCanonicalizeOutput`, rebuild snapshot selection, and the accepted Study record. Wiring those sites is not Stage 5A and is not Stage 5B.

## Stage 5B assessment

**READY**

The two data failures named in the first draft of this assessment are closed. Stage 5A.1 repaired bidirectional authority links and pinned structured joins. Stage 5A.2 withdrew the seven noncompiled proposed-check map keys into `iep-domain-proposed-checks.v1.json`. The operative design for the later implementation, including conversational authoring, is `docs/HiveForYou-DOMAIN-PACK-STAGE-5B-CONTRACT.md`.

An offline Stage 5B may compile the plan and the ledger: 275 definitions classified, presentation rows separate, per-instance coverage including `NO_INSTANCE` and `UNRESOLVED_INSTANCE`, declared joins only, duplicate links left ambiguous, and no legal conclusion from an empty authority gate. The proposal set is not an input. Pipeline, prompt, database, and UI stay out of that later ticket. DP-1 and DP-2 are not changed.
