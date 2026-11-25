# Stage 5C — Trusted relationship verification

**Status:** Corrected design (5C.1a). Design only. This document replaces the chat-only `hive.relationship-verification/1` draft. It does not authorize Stage 5C.2 code, tests, prompts, database changes, publication, commit, or push.

Stage 5A remains the plan and ledger contract. Stage 5B remains the investigation-plan and authoring contract. DP-1, DP-2, the binder, the planner, and the ledger stay as they are. This document defines the trusted verifier those components still refuse to invent.

## Corrections incorporated

1. Authorization is a server context: authenticated actor, case ownership and permission, case evidence revision, candidate identity, and the pinned Pack and plan digests. A model candidate or a request payload cannot assert verifier identity or authorization.
2. One canonical verified relationship identity exists per relationship id and ordered endpoint pair. Independently retained decisions that support that identity corroborate it. Conflicting relationship evidence stays ambiguous and fails closed.
3. `ACCEPT`, `REJECT`, and `REVOKE` are append-only records with causal versioning, replay protection, and immutable history. Replaying a revoked acceptance leaves the revocation in force.
4. The deterministic typed-source path stays the verifier for evidence whose relational meaning a reviewed structure can establish. Human confirmation is reserved for evidence that path cannot establish.

## What already stands

`bindInvestigationCandidates` quote-checks field and document candidates into `hive.verified-case-facts/1`. A free-text relationship that survives quote, direction, and endpoint-identity checks is stored as `REVIEW_REQUIRED` with `RELATIONSHIP_SEMANTICS_UNVERIFIED`. The verified relationship array stays empty. Affirmative, negated, unrelated, contradictory, and word-reversed sentences that name both endpoints stop there. Swapped endpoints stop earlier, as `DIRECTION_MISMATCH`.

`evaluateDomainRules` pairs instances only from relationship facts already marked `VERIFIED` and sourced. Several sourced facts for one relationship id and the same ordered endpoints become one `NOT_EVALUATED` result, reason `AMBIGUOUS_RELATIONSHIP`, and no day count. An endpoint with no such fact stays `CROSS_ENTITY`. A relationship fact is join identity. It is not field, document, or calculation evidence.

`buildCoverageLedger` calls DP-2 only with that verified set. It refuses the ledger when every source ref of a verified relationship is also a source ref of an unresolved candidate for the same relationship id and the same ordered endpoints (`relationship_promoted`). That guard detects a copied candidate. It does not establish relational meaning.

No approved typed link structure exists on a compiled relationship. A relationship definition is `fromEntityId`, `toEntityId`, and `evidenceRequired`. Ontology `evidenceForLink` is the question text retained on the task. `checkQuote` proves a quote or table cells appear on the authorized page. Pack review status, applicability verification, authority `humanReview`, coverage acknowledgement, and Study acceptance do not mint a `VerifiedRelationshipFact`.

## Server authorization context

Every verification call takes a context the server has already established. The offline function reads this object from its trusted input. It does not parse the object out of `hive.investigation-candidates/1` or out of the human request.

```ts
{
  schema: "hive.relationship-verification-context/1"
  hiveId: string
  actorId: string
  permission: "HIVE_OWNER"
  evidenceRevision: {
    extractionDigest: string
    binderDigest: string
    evidenceDigest: string
  }
  candidate: {
    candidateId: string
    contentDigest: string
  }
  packDigest: string
  planDigest: string
}
```

`actorId` is the authenticated actor. `permission` is the case ownership check the server has already applied for that Hive. `evidenceRevision.extractionDigest` is `authorizedExtractionDigest` of the pages and extraction facts the binder was allowed to cite. `binderDigest` is the digest returned with that binder result. `evidenceDigest` is the investigation evidence digest the ledger pins for the verified facts and unresolved candidates being decided. `candidate.contentDigest` is the server digest of the pinned unresolved candidate: relationship id, authored entity ids, ordered instance ids, and the ordered excerpt ids of its evidence. `packDigest` and `planDigest` are the compiled pack and the compiled plan already pinned together.

The human request is only:

```ts
{
  requestId: string
  expectedHead: string | null
  candidateId: string
  decision: "ACCEPT" | "REJECT" | "REVOKE"
  targetRecordId?: string
}
```

Any other field on the request, including `actorId`, `verifierId`, `permission`, `method`, `packDigest`, `planDigest`, `evidenceRevision`, `structureDigest`, `decidedAt`, `recordId`, `status`, `outcome`, `daysBetween`, or `verdict`, withholds the action. The same field names inside a model candidate withhold the action. The server loads the candidate by `candidateId` from the pinned unresolved set and computes `contentDigest` itself. Quotations travel from that stored candidate. A payload quotation list is not evidence.

A missing context field, a permission other than `HIVE_OWNER`, a digest that differs from the pinned pack, plan, or evidence revision, or a `candidateId` whose stored content digest differs from the context, withholds the action. No record is appended and no relationship fact is emitted.

## Verification record

Schema: `hive.relationship-verification/1`. One record is one immutable decision. The model cannot supply this object.

```ts
{
  schema: "hive.relationship-verification/1"
  recordId: string
  requestId: string
  sequence: number
  causalParentId: string | null
  candidateId: string
  candidateContentDigest: string
  relationshipId: string
  endpoints: [
    { entityId: string; instanceId: string },
    { entityId: string; instanceId: string }
  ]
  quotations: Array<{
    documentId: string
    page: number
    quote: string
    excerptId: string
  }>
  method: "TYPED_SOURCE" | "AUTHORIZED_HUMAN"
  effect: "SUPPORTS" | "WITHHOLDS" | "OPPOSES" | "REVOKES"
  actorId: string
  permission: "HIVE_OWNER"
  decision: "ACCEPT" | "REJECT" | "REVOKE"
  targetRecordId?: string
  structureDigest?: string
  polarity?: "HOLDS" | "DOES_NOT_HOLD"
  decidedAt: string
  evidenceRevision: {
    extractionDigest: string
    binderDigest: string
    evidenceDigest: string
  }
  packDigest: string
  planDigest: string
}
```

`endpoints` are the authored from-instance, then the authored to-instance. `quotations` are the pinned candidate's own evidence, in stored order, after `checkQuote`. `excerptId` is the server digest of document id, page, and the quote text normalized as `checkQuote` normalizes it. `actorId` and `permission` are copies of the server context. `decidedAt` is the server time of the append. `recordId` is the digest of the canonical record body, including `sequence` and `causalParentId`, excluding `recordId`. `effect` is assigned by the server from the decision and, for a typed record, from the structure polarity. The request cannot set `effect`.

The chain is one append-only log scoped to `(hiveId, evidenceRevision, packDigest, planDigest)`. Records for different candidates share that chain. `sequence` starts at 1. `causalParentId` is null on the first record and is the current head's `recordId` on every later append. Historical bytes stay in place. A later record does not edit `decision`, quotations, actor, digests, or `effect` on an earlier record.

## Decision lifecycle

The server folds the chain in `sequence` order. The fold is the only admission rule. The presence of an `ACCEPT` record is not admission.

`ACCEPT` appends support for one candidate. It is eligible when the candidate is `RELATIONSHIP`, `REVIEW_REQUIRED`, and carries `RELATIONSHIP_SEMANTICS_UNVERIFIED`; it has no hard binder failure; both instances are verified instances of the relationship's authored entity types, in authored order; the stored quotations are that candidate's evidence and each one passes `checkQuote`; and both verified identity values occur in those quotations. Endpoint containment is required and does not establish the link. `DIRECTION_MISMATCH`, a failed quote, a missing endpoint, an unknown relationship, and endpoint-only facts are ineligible.

A human `REJECT`, and a typed mismatch recorded as `REJECT` with effect `WITHHOLDS`, append a withhold for one candidate that has no unrevoked `ACCEPT`. The candidate stays in the unresolved set as `REVIEW_REQUIRED`. No relationship fact is added. That withhold says this candidate does not establish the relationship. A typed `REJECT` with effect `OPPOSES` may append while a different candidate already supports the same identity. That opposition is conflicting evidence, described below.

`REVOKE` appends a withdrawal of one earlier `AUTHORIZED_HUMAN` `ACCEPT`. `targetRecordId` names that `ACCEPT`. The revoke record copies the target's relationship id, endpoints, and quotations from the log. The target `ACCEPT` remains in the log unchanged. A second `REVOKE` of the same target is a replay of the first revoke when the request id matches, and a causal conflict when it does not. `REVOKE` does not apply to a `REJECT`, to another `REVOKE`, or to a `TYPED_SOURCE` record. A human revoke does not withdraw a typed result.

A new `ACCEPT` after a `REVOKE` is a new record whose `causalParentId` is the current head. It is a new decision. It is not a restoration of the revoked record.

An accepted Study and its reports keep the evidence digest and ledger digest they were accepted with. A later fold produces a later input. It does not rewrite that Study or those reports. After the last support for a pair is revoked, and no conflicting evidence remains, a cross-entity calculation has no sourced link, so it stays `CROSS_ENTITY` and has no day count.

Directly constructed `VERIFIED` relationship fixtures remain evaluator fixtures. They are not an admission path.

## Replay protection

Each append stores the client `requestId` for a human action, or the server-derived typed request id defined below. The same `requestId` on the same chain returns the existing record and appends nothing. Effects are not applied again.

A human mutation also carries `expectedHead`, the `recordId` of the head the server showed when the action was offered, or null when the chain was empty. The server appends only when `expectedHead` equals the current head. A mismatch returns `CAUSAL_CONFLICT` and appends nothing.

Replaying the original `ACCEPT` after a later `REVOKE` matches the historical `ACCEPT` by `requestId` and returns that record. The `REVOKE` remains the later record. The fold continues to omit the revoked support. Replaying the original body with a new `requestId` and an `expectedHead` older than the current head is the same conflict and appends nothing. Support returns only through a new `requestId` whose `expectedHead` is the current head, which is an explicit later `ACCEPT`.

A typed re-run uses the request id derived from the candidate content digest, the structure digest, the evidence revision, and the typed effect. When an unrevoked typed record for that same request id is already on the chain, the server returns it. A later human decision on a different candidate does not cause a second typed support for the first candidate.

## Typed-source path

`hive.relationship-source-structure/1` is an optional digest-pinned companion. It is not a DP-1 definition kind, not a Hive Core rule, and not present on `iep-us-federal` `0.3.0`. Stage 5C does not add one to that pack.

```ts
{
  schema: "hive.relationship-source-structure/1"
  relationshipId: string
  structureDigest: string
  direction: "AUTHORED_FROM_TO"
  polarity: "HOLDS" | "DOES_NOT_HOLD"
  slots: Array<{
    role: "FROM_IDENTITY" | "TO_IDENTITY" | "POLARITY" | "DIRECTION"
    value: string
  }>
}
```

Trusted code compares slots by normalized equality. The from-identity slot equals the verified identity value of the from-instance. The to-identity slot equals the verified identity value of the to-instance. The polarity slot equals a verified scalar already quote-checked in the candidate's evidence. The direction slot equals the authored from-to order. Every compared value is itself quote-checked. The server selects the structure from the pinned companion and records `structureDigest`. Endpoint co-occurrence is not a slot match. `evidenceForLink` stays the question text.

The typed result is one of:

| Result | Meaning | Record |
|---|---|---|
| `NO_TYPED_SOURCE` | No approved structure is pinned for this relationship id. | None from this path. |
| `TYPED_INAPPLICABLE` | A structure is pinned, and the evidence does not present the polarity and direction slots as quote-checked values. | None from this path. |
| `TYPED_ACCEPT` | Every slot equals, and polarity is `HOLDS`. | `ACCEPT`, method `TYPED_SOURCE`, effect `SUPPORTS`. |
| `TYPED_OPPOSE` | The structure's `DOES_NOT_HOLD` polarity matches the quote-checked evidence for this identity. | `REJECT`, method `TYPED_SOURCE`, effect `OPPOSES`, `polarity: DOES_NOT_HOLD`. |
| `TYPED_MISMATCH` | The structure applies to evidence that presents comparable slots, and equality fails. | `REJECT`, method `TYPED_SOURCE`, effect `WITHHOLDS`. |

`NO_TYPED_SOURCE` is the result for every current proof-pack relationship. That result admits nothing. Keyword lists, negation lists, and model labels are not a typed source.

## Human confirmation

Human confirmation is available only when the typed result for that candidate is `NO_TYPED_SOURCE` or `TYPED_INAPPLICABLE`. In both results the approved structure cannot independently establish the relational meaning.

`ACCEPT` then means the authenticated owner asserts that this stored quotation set, read together, supports this relationship in the authored direction. The machine does not classify the sentences. The record stores the quotations that were decided. `REJECT` records that this set does not establish the relationship.

When the typed result is `TYPED_ACCEPT`, `TYPED_OPPOSE`, or `TYPED_MISMATCH`, the server withholds the human action. A human `ACCEPT` does not replace a typed match, and it does not outvote typed opposition or a typed mismatch. The typed record, when one is appended, is the decision for that evidence.

Coverage acknowledgement of a digest remains a different owner action. It is not this confirmation.

## Canonical identity, corroboration, and contradiction

The canonical identity is the relationship id plus the ordered `(fromInstanceId, toInstanceId)` pair. The authored opposite order is a different relationship claim and is ineligible for this identity.

The canonical fact id, when the fold emits a fact, is the digest of that identity and the evidence revision. Corroborating decisions do not mint additional fact ids.

The fold for one identity:

- An unrevoked `SUPPORTS` record contributes its `recordId` and its quotations.
- A `WITHHOLDS` record retains the decision and contributes no support. A later unrevoked `SUPPORTS` record for a different candidate still supports the identity. A `REJECT` of a candidate that already has an unrevoked `ACCEPT` is refused; withdrawal of that `ACCEPT` is `REVOKE`.
- A `REVOKES` record removes the named `ACCEPT` from the support set and leaves the `ACCEPT` in the log.
- An `OPPOSES` record stands for the life of the evidence revision. A later human `ACCEPT` is withheld while it stands.

Corroboration is two or more unrevoked `SUPPORTS` records for the same identity and no `OPPOSES` record. Different candidates, different quotation sets, and different `recordId`s stay independent records. The fold emits one `VerifiedRelationshipFact`:

- `status: "VERIFIED"`
- the canonical fact id
- the same `relationshipId` and ordered instance ids
- `sourceRefs` the union of the supporting records' quotations, as `{ documentId, page, excerptId }`

DP-2 therefore sees one sourced fact for that pair. It does not see one fact per supporting decision, and corroboration does not become `AMBIGUOUS_RELATIONSHIP`.

Contradiction is an unrevoked `SUPPORTS` record together with an `OPPOSES` record for the same identity. The fold emits no relationship fact for that identity, records disposition `CONTRADICTORY_RELATIONSHIP`, and does not choose a winning record. Both records remain. No day count is adopted. A human action cannot clear the opposition inside the same evidence revision.

`OPPOSES` with no remaining support emits no fact and records `NOT_HELD`. Support with no opposition emits the one canonical fact and records `HELD`. Withholds alone emit no fact and leave the candidates in review. Each of those results fails closed for a cross-entity day count except `HELD`, which is the single sourced link DP-2 may pair.

DP-2's existing duplicate-fact rule stays in force and is unchanged. A verified set that still contains more than one sourced fact for the same relationship id and the same ordered endpoints remains one `NOT_EVALUATED` / `AMBIGUOUS_RELATIONSHIP` row and no day count. This verifier does not emit that shape for corroboration. Callers that bypass the verifier and supply duplicate facts still fail closed inside DP-2.

Each candidate whose evidence is in an unrevoked `SUPPORTS` record leaves the unresolved array that the ledger reads. The proposal, quotations, and decision stay on the verification record. That split keeps a lawful admission clear of `relationship_promoted`. Rejected, opposed, and not-yet-decided candidates stay unresolved. A verified fact whose source refs are all source refs of one of those remaining candidates is still `relationship_promoted`. Admission must not leave the accepted candidate in that array.

Distinct endpoint pairs of the same relationship are distinct identities. Two relationship ids are distinct identities. This contract adds no exclusivity list between relationship ids.

## Admission boundary

The binder remains unable to emit a relationship fact. Admission is the fold above, in a separate trusted function. It consumes the binder output, the compiled pack, the pinned plan, the authorized pages, the server context, and either a typed-source companion or a human request. It returns the append result, the updated verified set, and the updated unresolved set.

On `HELD`, the returned verified set contains the one canonical relationship fact for that identity. On `CONTRADICTORY_RELATIONSHIP`, `NOT_HELD`, and an undecided review candidate, `verified.relationships` has no fact for that identity.

A relationship fact admitted this way is still join identity only. DP-2's rule that it is not field, document, or calculation evidence remains in force.

## Trust boundaries

| Boundary | Rule |
|---|---|
| Model candidate | May propose a relationship id, ordered instances, and quotations. The verifier withholds the action when that object carries a decision, method, actor, verifier, status, or verdict. |
| Request payload | May name `requestId`, `expectedHead`, `candidateId`, `decision`, and, for `REVOKE`, `targetRecordId`. Authorization fields are ignored by withholding the action. |
| Server context | Supplies actor, permission, evidence revision, candidate content digest, pack digest, and plan digest. |
| Quote check | Proves the quotation is on the authorized page. Typographic folding only. |
| Endpoint containment | Proves both identity values appear. Leaves the candidate in review until a typed or human decision appends. |
| Typed source | Normalized slot equality against a digest-pinned structure. Absent for the current proof pack, so those relationships stay `NO_TYPED_SOURCE`. |
| Human action | Server-side owner confirmation, and only after the typed path cannot establish the meaning. |
| Log | Append-only. Replay returns the historical record. A revoked `ACCEPT` stays revoked under replay. |
| DP-2 and ledger | Read the folded `VERIFIED` facts only. They do not interpret quotations or verification records. Duplicate facts for one identity still fail closed. |
| Accepted Study | Keeps the digests it was accepted with. |
| Private evidence | Page text and quotations stay in the authorized Hive corpus. Verification calls no model. Logs carry record id, decision, method, actor id, and digests. |

## Stage 5C.2

The smallest offline implementation is one new module beside the binder, plus tests. It implements this contract. It does not edit the binder, planner, DP-1, DP-2, ledger, prompts, pipeline, database, or UI. The live owner route, any stored row, and any screen remain a later approved ticket. The pure function is the policy that route must call.

Tests use the existing synthetic North/South corpus, plus one synthetic typed-source structure that is not an IEP pack edition:

1. Co-occurrence of an affirmative, negated, unrelated, contradictory, or word-reversed sentence admits nothing.
2. Swapped endpoints cannot be accepted.
3. A decision, method, verifier, actor, or status placed in the candidate or in extra request fields admits nothing.
4. A missing server context field, a mismatched evidence revision, or a pack or plan digest mismatch admits nothing.
5. An owner `ACCEPT` with `NO_TYPED_SOURCE`, matching context, and quotes that pass `checkQuote` appends one record, adds one canonical relationship fact, preserves the proposal on the record, and removes that candidate from the unresolved array. The same pair with the candidate left unresolved still fails as `relationship_promoted`.
6. `REJECT` appends a withhold, leaves relationships empty, keeps the candidate in review, and produces no day count.
7. Two `ACCEPT` records with different quotation sets for the same relationship id and the same ordered endpoints produce one canonical fact, retain both records, and produce a day count. They do not produce `AMBIGUOUS_RELATIONSHIP`.
8. A synthetic structure that matches `HOLDS` appends a typed `ACCEPT` without a human request. A human `ACCEPT` for that same evidence is withheld.
9. A typed `DOES_NOT_HOLD` match on one candidate, while another candidate for the same identity has an unrevoked human or typed support, yields `CONTRADICTORY_RELATIONSHIP`, no fact, and no day count. A later human `ACCEPT` does not clear it.
10. `REVOKE` appends a new record, leaves the `ACCEPT` bytes unchanged, removes that support from a later fold, and leaves an already-built ledger object unchanged.
11. Replaying the revoked `ACCEPT` by its original `requestId` returns the historical record, appends nothing, and leaves the relationship withdrawn.
12. A new `requestId` whose `expectedHead` is the revoke head may append a later `ACCEPT`. A new `requestId` with a stale `expectedHead` appends nothing.
13. `TYPED_SOURCE` returns `NO_TYPED_SOURCE` for the synthetic relationship when no structure is supplied, and for every current proof-pack relationship, without using case text as a matcher.

**Stage 5C.2 readiness: PASS.** The offline module can be written from this contract. Typed verification of `iep-us-federal` `0.3.0` admits nothing, because that pack has no approved typed source. That refusal is the contract. It is not a missing design decision.

No source, no claim. No model-generated verified relationship. No promotion from endpoint co-occurrence. No rewrite of an accepted Study. No IEP-specific Hive Core logic.
