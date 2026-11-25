# IEP domain reconciliation — Stage 5A.2

Result: **PASS**. Status: DRAFT. Applicability: UNVERIFIED. Publication: UNPUBLISHED. All 149 authorities remain NOT_REVIEWED. Verification statuses were not changed.

The seven proposed checks were already bidirectional and were not compiled definitions. Stage 5A contract rule 4 rejects a map key that is not a compiled definition, a conflict pattern, or a state overlay. This ticket withdrew only those seven keys. Their mappings, the absent role objects, and the Stage 4A rationale are in `iep-domain-proposed-checks.v1.json` (`hive.domain-proposed-check-set/1`, version 1.0.0). That file is not a DP-1 definition kind and is not a planner input.

## Withdrawn proposals

None of the seven had an `authorityRoles` entry. No role string was added.

- `check:DS1` → `AUTH-CFR-300.530-e-1`. Role object: none. Discipline is deferred. The only authority is a partial snippet of 34 CFR 300.530(e)(1). No ontology rule was defined, so no check was added. The authority stays, with `verificationStatus` `PARTIAL_SNIPPET`, and is now unused (`requiring review`, not applied).
- `check:G3-LEGAL` → `AUTH-CASE-ENDREW-F-HOLDING`, `AUTH-CASE-ENDREW-F-AMBITIOUS`, `AUTH-CASE-ENDREW-F-GRADE`, `AUTH-CASE-ENDREW-F-NO-ELABORATION`, `AUTH-CASE-ENDREW-F-DEMINIMIS`. Role object: none. This was a proposed split of `check:G3`. `check:G3` stays mapped to the holding, ambitious, and no-elaboration authorities. `calculation:C4` and `chain:CH5` stay on the no-elaboration authority. Grade and de minimis had no other definition, so those two authorities are unused (`intentionally available`, not applied).
- `check:IM2` → `AUTH-CFR-300.323-d`. Role object: none. Authority-only proposal for implementer access under 34 CFR 300.323(d). No ontology rule id. The authority is unused (`intentionally available`, not applied).
- `check:P2b` → `AUTH-CFR-300.324-a-1-iii`. Role object: none. Authority-only proposal for considering the most recent evaluation. `check:S3`, `chain:CH3`, `conflictPattern:CP-REC-NOT-TRACEABLE`, and `entity:evaluation-recommendation` stay mapped to that authority.
- `check:PS2` → `AUTH-CFR-300.321-f`. Role object: none. Authority-only proposal for a Part C coordinator invitation. Preschool / Part C transition stays a deferred workflow. The authority is unused (`intentionally available`, not applied).
- `check:RV4` → `AUTH-CFR-300.305-e-1`, `AUTH-CFR-300.305-e-2`. Role object: none. Authority-only proposal for an evaluation before ending eligibility. No ontology rule id. Both authorities are unused (`intentionally available`, not applied). Workflow and ontology notes that mention RV1–RV4 were left as notes. They are not mappings.
- `check:TR4` → `AUTH-CFR-300.305-e-3`. Role object: none. Authority-only proposal for a summary of performance. No ontology rule id. The authority is unused (`intentionally available`, not applied).

## Mapping counts

- Map keys: 239 before, 232 after.
- Links: 399 before, 387 after. Twelve reverse `relatedDefinitionIds` entries were removed, one for each withdrawn link.
- Compiled-definition keys: 214. Each is one of the 275 Stage 4B definitions.
- Conflict-pattern keys: 14. State-overlay keys: 4. Rule 4 allows both. They are not members of the 275.
- Map keys that resolve to neither a compiled definition nor a pinned conflict pattern or state overlay: 0.
- Authority records: 149. Class counts are unchanged (135 federal law, 2 research, 1 professional criteria, 10 author-proposed, 1 platform policy).
- Unused authorities: 16 before, 24 after. None of the 24 appear in `definitionAuthorityMap`.
- Forward and reverse disagreements: 0. Presentation definitions in `structuralDefinitions` do not appear in the map.

## Unresolved, unchanged

- `calculation:C21` → `AUTH-CFR-300.301-c-1-i`. The section's timeframe runs from consent. C21 measures evaluation completion to eligibility. No replacement authority was created.
- `conflictPattern:CP-SCORE-MISMATCH` → `AUTH-CFR-300.304-c-1-iii`. That section is the comparability caution already mapped to `conflictPattern:CP-ASSESSMENT-NONCOMPARABLE`. The score-mismatch pattern stays on `AUTH-AP-SCORE-CONSISTENCY`. The citation remains an annotation, not a mapping.

## Digests

`packDigest` is the compiler's sha256 of canonical JSON. The register digest was recalculated after the edit. The proposal digest is the new file. The other pins match Stage 5A.1.

- `iep-domain-authority-register.json`
  - before: `a1869a8febf46214b8e1fdb9cc9d42e5d24c58f07ddeb1cc1e7a692d5831f0ec`
  - after: `b7175fb6a54aa5085bbba9c63e9c0827fd4dab1858f12a5e25c36946c3018f74`
- `iep-domain-proposed-checks.v1.json`
  - `0b52029813fe61575cb0ba927ab610183b990711f871b4d1a5b860697a434dcf`

Unchanged pack, ontology, conflict-pattern, state-overlay, fact-class, workflow-coverage, and unsupported-operator digests are in `iep-domain-reconciliation.stage5a2.json`.

## Stage 5B

The rule 4 blocker is closed. Stage 5B may compile a plan from the 275 definitions and the pinned supplemental specs. The proposal set is not an input to that plan. Promoting one of the seven checks is a later reviewed `add`, and only when an ontology rule id exists and an authority used as the statement is more than a partial snippet. This ticket does not promote them.
