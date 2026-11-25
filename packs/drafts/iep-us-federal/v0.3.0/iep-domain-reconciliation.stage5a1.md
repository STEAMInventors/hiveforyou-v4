# IEP domain reconciliation — Stage 5A.1

Result: **PASS**. Status: DRAFT. Applicability: UNVERIFIED. Publication: UNPUBLISHED. All 149 authorities remain NOT_REVIEWED.

definitionAuthorityMap was the contract. 160 links had no matching relatedDefinitionIds entry. 158 were added after the authority record supported the subject. Two were removed from the map because the authority record does not support them. No authority was created.

## Relationship classes

- DIRECT_LEGAL_REQUIREMENT: 132
- LIMITATION: 13
- PROFESSIONAL_CRITERIA: 13

Limitation links stay limitations. They were not given a new authority role, and existing authorityRoles were not edited.

## Unresolved

- `calculation:C21` → `AUTH-CFR-300.301-c-1-i`. 34 CFR 300.301(c)(1)(i) establishes a timeframe measured from receipt of consent. Its record states that it does not say whether eligibility must also occur within those 60 days. calculation:C21 measures evaluation completion to eligibility, a different interval. The citation was not copied into relatedDefinitionIds and was removed from definitionAuthorityMap. No replacement authority was created.
- `conflictPattern:CP-SCORE-MISMATCH` → `AUTH-CFR-300.304-c-1-iii`. 34 CFR 300.304(c)(1)(iii) establishes valid use and a comparability caution. That relationship is already recorded on conflictPattern:CP-ASSESSMENT-NONCOMPARABLE. CP-SCORE-MISMATCH is a same-instrument value disagreement, which this section does not establish. The pattern stays mapped to AUTH-AP-SCORE-CONSISTENCY. The citation remains named on the conflict-pattern and ontology annotations and is not a mapping.

## Joins

Each relationship id was taken from the calculation's approved binding pair and checked against the pack relationship's fromEntityId and toEntityId. Endpoints were not reversed. C14 and C20 stay same-instance with join null.

- `calculation:C1` → `relationship:consent-authorizes-evaluation` (`entity:consent` → `entity:evaluation`). Direction matches the start and end bindings.
- `calculation:C2` → `relationship:eligibility-precedes-iep` (`entity:eligibility-determination` → `entity:iep`). Direction matches the start and end bindings.
- `calculation:C3` → `relationship:iep-contains-service` (`entity:iep` → `entity:service`). Direction matches the start and end bindings.
- `calculation:C14`: same instance of `entity:records-request`. join is null.
- `calculation:C15` → `relationship:notice-for-meeting` (`entity:meeting-notice` → `entity:iep-meeting`). Direction matches the start and end bindings.
- `calculation:C20`: same instance of `entity:iee-request`. join is null.
- `calculation:C21` → `relationship:evaluation-supports-eligibility` (`entity:evaluation` → `entity:eligibility-determination`). Direction matches the start and end bindings.

## Digests

packDigest is the compiler's sha256 of canonical JSON. Both changed digests were recalculated after the edit.

- `iep-domain-authority-register.json`
  - before: `abe8509d1f4fd67723523c02d2ee7a384818f1c39392a72fcca465e0026ea571`
  - after: `a1869a8febf46214b8e1fdb9cc9d42e5d24c58f07ddeb1cc1e7a692d5831f0ec`
- `iep-domain-ontology-spec.json`
  - before: `61467d2a9d911d7cc865c7b7502485578c3c352cf9a13bf53a7c84c7f8935bf5`
  - after: `60e096187cbc44346ec78b76648edd4fcd159e407d0ec1d60000d62610455fd8`

Unchanged pack and supplemental digests are in `iep-domain-reconciliation.stage5a1.json`.

## Stage 5B

The two data blockers are closed: authority mappings agree in both directions, and the five cross-entity day counts carry a structured join whose direction matches the relationship definition. Those two closures are what this ticket was approved to repair.

Parked, not changed: seven proposed check ids remain in the map and are already bidirectional (`check:DS1`, `check:G3-LEGAL`, `check:IM2`, `check:P2b`, `check:PS2`, `check:RV4`, `check:TR4`). They are not among the 275 compiled definitions. Contract rule 4 still rejects a map key that is not a compiled definition, conflict pattern, or state overlay. A plan compile that enforces rule 4 stays blocked on those keys. This ticket did not remove them.
