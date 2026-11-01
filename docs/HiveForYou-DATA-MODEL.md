# HiveForYou V4 — Data model (logical design)

**Version:** 0.3 | **Status:** Logical design; **`hive.hives` migration applied in V4-002 Git history**; **V4-003 migration `20261030150000_create_source_documents.sql` exists locally and is not deployed**. Names follow `HiveForYou-NAMING-CONVENTIONS.md`.

## Trust and ownership

All owner-bound records live in one proposed PostgreSQL schema **`hive`** in a new isolated Supabase V4 project. Every table storing Hive data must carry a verifiable ownership path to `hive.hives.owner_user_id`, appropriate row-level security, restrictive service functions where needed and stable UUID IDs. One DB schema shared by all users; **not** separate per-user schemas.

## Logical entities (create incrementally)

| Table | Purpose | Key relations and invariants |
|---|---|---|
| `hive.hives` | User-owned workspace | `id`, `owner_user_id`, name/description, `client_request_id`, `study_locked_at` where needed; unique `(owner_user_id, client_request_id)` |
| `hive.source_documents` | Registered immutable source identity | `hive_id`, `storage_key`, MIME, byte size, `status` (`PENDING`/`REGISTERED`/`REJECTED`), `source_sha256`, `scan_status`, `read_status` (read pipeline deferred), quota on register; D-027 |
| `hive.document_pages` | Source text/anchors and read provenance | `source_document_id`, `page_number` (1-based), digest, extraction quality/method; may store secure text/refs according to privacy policy |
| `hive.processing_runs` | Durable operation/status | `hive_id`, stage/status, correlation ID, error code, scope, timestamps, prompt/model info |
| `hive.extraction_batches` | One document/page-range discovery operation | `processing_run_id`, `source_document_id`, page start/end, prompt/contract version/digest, read digest, coverage |
| `hive.fact_candidates` | Untrusted model observations | FK batch; local `F001` mapped to UUID, category, subject/attribute, raw/normalized value, modality, confidence |
| `hive.fact_verifications` | Independent checking per candidate | verified/unresolved/rejected, reason code, verifier version, checked source digest/time |
| `hive.verified_facts` | Accepted document assertions | Candidate provenance, source claimant, subject/record and as-of dates, not real-world truth endorsement |
| `hive.fact_evidence` | Multiple evidence anchors | Original physical page and quote/anchor; source digest; never free-floating |
| `hive.canonical_studies` | Single logical Study per Hive | `hive_id UNIQUE`, `current_revision_id` nullable until first accepted revision |
| `hive.study_revisions` | Immutable accepted history | `canonical_study_id`, revision sequence/digest, predecessors, accepted source coverage |
| `hive.intent_requests` | Owner goal at Hive start (write-once per client request) | `hive_id`, `intent_text` (1–2000 trimmed), `client_request_id`, owner; D-026 |
| `hive.intent_analyses` | Question-specific findings | `intent_request_id`, pinned `study_revision_id`, supported fact refs, limitations |
| `hive.report_runs` | Independent generation attempts | `hive_id`, pinned revision, audience, generated unique run ID, status/diagnostics |
| `hive.reports` | Accepted saved output | `report_run_id`, pinned analysis/revision, declarative validated view artifact and history |
| `hive.a2ui_views` | **Optional** independent saved view | Add only if view lifetime truly differs from report; otherwise embed under `reports` |

## Relation sketch

```text
user → hives ─── source_documents ─── document_pages
         │                └── extraction_batches ─── fact_candidates
         │                                               └── fact_verifications
         │                                                   └── verified_facts ── fact_evidence
         ├── canonical_studies (0..1) ─── study_revisions (many)
         ├── intent_requests ─── intent_analyses (pin revision)
         └── report_runs ─── reports (pin analysis + revision)
```

Exact FK direction/cardinality and denormalization are implementation decisions; **do not copy this diagram into migrations without design review**.

## Source facts, conflict and times

- Raw source value and `valueAsWritten` preserved; normalized values are additional fields, not replacements.
- Record grouping and order preserved (IEP service rows, grocery line items, loan/debt rows). Model-local IDs and full extraction object stored or traceably mapped as needed.
- Separate *document issuance date*, *effective dates*, *observation/as-of date*, *event date* and *verification timestamp*. Do not infer a current status merely from upload order.
- Conflicting claims retain each source/date/claimant; a newer file does not automatically overwrite prior evidence. Human corrections are attributed and audited under later approval.
- Never treat `NOT_FOUND` as absence without reviewed scope, nor `UNCERTAIN` or `REJECTED` as accepted facts.

## Promotion and idempotency

Source registration is idempotent for one client upload request. Candidate and evidence writes are idempotent by appropriate batch/source/range identity; distinct processing runs are independently tracked. Study merge creates an immutable revision and advances current pointer **only in one successful transaction**; concurrent merges must check expected previous revision. New report Generate action gets a new report run; replay of that specific run is idempotent.

## Privacy, retention, backups

Proposed private Supabase bucket `hive-sources`; storage keys use opaque IDs, never filenames containing personal data. Any reversible token mapping belongs to a separate protected access boundary (exact tables/encryption unresolved) and is not automatically readable by end users or models. RLS is not a substitute for server authorization. Account deletion's previously approved 30-day recovery window applies when implemented under its own ticket.

**Implementation sequence:** V4-002 created auth/Hive tables/policies; V4-003 adds `intent_requests`, `source_documents`, private bucket, quota/registration RPCs (**local SQL, not deployed**); **`document_pages` and read pipeline deferred** within V4-003 closure scope as documented in NEXT; V4-004 candidate/run; V4-005 verification/revision; later analysis/report structures.

## Analytical Intelligence persistence extension (proposed; no migrations authorized)

Keep existing one-Hive/one-Study cardinality and immutable revisions. New *logical* entities should be created only as required by an approved ticket:

| Proposed entity | Purpose / minimum keys | Trust invariant |
|---|---|---|
| `analysis_discovery_runs` | `hive_id`, `study_revision_id`, discovery version, goal context, status/budget | Idempotent per equivalent revision/version; never a Study revision |
| `analysis_opportunities` | discovery run, question/kind, evidence refs, prerequisites, value/rank, disposition | Proposed insight ≠ finding |
| `analysis_plans` | opportunity, pinned revision, typed inputs, operator/dependency model, validation | Model proposal immutable; validated status separate |
| `analysis_execution_runs` | plan, run ID, status, evaluator/method version, costs/errors | Each attempt auditable; preserve prior result |
| `analysis_results` | execution run, derived values, evidence/rule links, coverage, confidence/limitations | Supported/partial/blocked/rejected, never asserted as raw source |
| `scenario_overlays` | owner/Hive, pinned Study revision, user assumption set, horizon, parent scenario | No hypothetical overwrites verified facts |
| `scenario_models` | overlay, proposed dependency graph, rules, units, model validation | Edge provenance and rule version mandatory if applied |
| `scenario_runs` | scenario/model, execution method, status, results, versions | Deterministic method and input trace |
| `scenario_comparisons` | baseline, selected scenario run IDs, delta summary, caveats | Avoid cross-scope invalid comparisons |

These table names are *reservations for review*, not an instruction to create all nine or to split objects unnecessarily; reuse existing `intent_analyses`/`processing_runs` where lifecycles align. Explicitly separate stable source fact IDs, model-proposed dependencies, fetched rule authority, and hypothetical assumptions. Store no unsourced rule as a verified fact. Revised Study creates new analysis pointers and marks earlier outputs historical/stale, never deletes them. Owner-path RLS and server permission checks apply to all entities. `source_sha256`/physical-page provenance remains authoritative for document claims.
