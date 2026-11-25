# DP-2 — Deterministic domain rule engine (offline)

**Status:** Draft / review only. This evaluates a compiled Domain Pack against verified facts. It does not migrate a database, change the Read → Extract → Canonicalize → Accept → Write path, rewrite an accepted Study or report, or publish a pack.

## What runs

`evaluateDomainRules` in `packages/contracts/src/pipeline/domain-pack-rules.ts` accepts only:

- a compiled `hive.domain-pack-runtime/1` snapshot from the DP-1 compiler
- a `hive.verified-case-facts/1` set whose records are already marked `VERIFIED`

Model output, an authoring source, and a fact whose status is anything else are not evaluated. The call fails closed and returns no verdicts.

A check result carries the rule ID, the instance it was judged against, an outcome, the supporting evidence IDs, source references, missing requirements, and reason codes. `ESTABLISHED` is the only affirmative check verdict. `COMPUTED` means `DAYS_BETWEEN` produced an exact integer day count. It is not a compliance verdict.

## Evidence rules

- `FIELD_PRESENT`, `DOCUMENT_PRESENT`, `ALL`, `ANY`, `NOT`, and typed `COMPARE` are executable. `REVIEW_REQUIRED`, including under `NOT` or `ALL`, cannot become `ESTABLISHED`.
- A DP-1 comparison string is still accepted by the compiler and is not looked up as a field name. The evaluator returns `NOT_EVALUATED` / `OPERAND_UNTYPED`.
- Operand bindings are `FIELD`, `CALCULATION`, or `LITERAL`. A value whose type does not match the field is not coerced. An impossible calendar date is not rolled forward.
- Missing check evidence is `NOT_ESTABLISHED`. `NOT` of missing evidence stays `NOT_ESTABLISHED` (`NEGATION_OF_UNKNOWN`). It is not proof that the thing did not happen. A `DAYS_BETWEEN` result whose date is missing or unsourced is `NOT_EVALUATED` and has no day count.
- Disagreeing sourced values, or a caller-declared conflict, produce `CONFLICT` and no day count.
- A fact or relationship with no source reference cannot support a claim.
- `ESTABLISHED` and `NOT_SATISFIED` each require at least one sourced field fact, document fact, or calculation input. A literal comparison and a sourced relationship do not supply that evidence. The result is then `NOT_EVALUATED` / `SOURCE_MISSING`, including under `ALL`, `ANY`, `NOT`, and a cross-entity plan. A negative determination remains when that evidence exists.
- Incomplete coverage cannot produce `ESTABLISHED` or `NOT_SATISFIED`. An exact day count may still be returned, with `INCOMPLETE_COVERAGE`, because that number is the difference of the cited dates rather than a compliance conclusion.
- Rules run per entity instance. Two instances are paired only through sourced facts of one relationship whose endpoints are those two entities. Unrelated records are not combined. Several sourced facts for the same relationship and the same endpoints produce one `NOT_EVALUATED` result with `AMBIGUOUS_RELATIONSHIP` and no day count. Distinct endpoint pairs are evaluated separately. Three or more entities are not joined.
- A joined result keeps that relationship fact's ID and source references, including a direct field comparison. Those references explain the join. They are not the field, document, or calculation evidence required for a verdict.

## Calculations and jurisdiction

`DAYS_BETWEEN` subtracts two civil dates with the existing exact decimal arithmetic. The result is the integer number of calendar days from `start` to `end`, including leap days, and it may be negative. Both bindings must be `DATE` fields. Roles are exactly `start` and `end`.

`DIFFERENCE`, `RATE_PER_WEEK`, `SUM_BY`, `ADD_INTERVAL`, and `REFERENCE_GAP` return `NOT_EVALUATED` / `CALCULATION_UNSUPPORTED`. They do not return an estimate. A `DECLARATION_ONLY` calculation, which is what the legacy adapter still emits, is not executed. `inputFields`, `legacyInputs`, and `scope` are not field names.

A comparison that uses `DAYS_BETWEEN` becomes a deadline verdict only when the other operand is a numeric literal that names a jurisdiction, the pack applicability names that same jurisdiction, and `applicability.verification` is `REVIEWED`. The labels `unknown` and `unspecified` are not jurisdictions. Otherwise the outcome is `NOT_EVALUATED`. The day count can still be `COMPUTED`. An unknown jurisdiction does not produce a pass or a violation.

## What this does not establish

- `REVIEWED` is a flag stored on the compiled snapshot. The evaluator does not decide that a statute applies to a person or a place.
- A threshold has to be written on the rule. A number found in a case fact is not treated as the legal limit.
- Pack `effectiveFrom` / `effectiveTo` are not applied. There is no separate verified evaluation-date binding in this contract.
- Question conditions, document conditions, and workflow actions are not executed.
- Legacy markdown checks stay `REVIEW_REQUIRED`. The G2 / C1 / T2 proof is a typed pack and a professional edition compiled through the same DP-1 edit operations. Core code does not contain those rules.
- Publication remains `UNPUBLISHED`. Ownership on the snapshot is not permission to edit a case or to publish.

## Verification

`domain-pack-rules.test.ts` covers a complete record, a missed deadline, missing evidence, incomplete coverage, conflicts, invalid and impossible values, unrelated instances, a sourced relationship, a literal verdict with no field evidence, ambiguous relationship facts, relationship provenance on a direct field comparison, a professional criterion override, jurisdiction gates, untyped labels, unsupported arithmetic, review-required rules, sourceless facts, unverified input, and the active legacy packs. `domain-pack-iep-stage4b.test.ts` covers the seven executable IEP day counts.
