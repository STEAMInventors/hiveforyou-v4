# HiveForYou V4 — Data model (logical design)

**Version:** 0.3 | **Status:** Logical design; **`hive.hives` migration applied in V4-002 Git history**; **V4-003 migration `20261030150000_create_source_documents.sql` exists locally and is not deployed**. Names follow `HiveForYou-NAMING-CONVENTIONS.md`.

## Trust and ownership

All owner-bound records live in one proposed PostgreSQL schema **`hive`** in a new isolated Supabase V4 project. Every table storing Hive data must carry a verifiable ownership path to `hive.hives.owner_user_id`, appropriate row-level security, restrictive service functions where needed and stable UUID IDs. One DB schema shared by all users; **not** separate per-user schemas.

## Logical entities (create incrementally)

| Table | Purpose | Key relations and invariants |
|---|---|---|
| `hive.hives` | User-owned workspace | `id`, `owner_user_id`, name/description, `client_request_id`, `study_locked_at` where needed; unique `(owner_user_id, client_request_id)` |
| `hive.source_documents` | Registered immutable source identity | `hive_id`, `storage_key`, MIME, byte size, `status` (`PENDING`/`REGISTERED`/`REJECTED`), `source_sha256`, `scan_status`, `read_status` (`PENDING`/`SUCCEEDED`/`PARTIAL`/`UNREADABLE`/`FAILED`, set only by a terminal `document_reads` transition) and `page_count`, quota on register; D-027, D-038 |
| `hive.document_pages` | Source text/anchors and read provenance | `source_document_id`, `hive_id`, `page_number` (1-based), `page_text` (≤ 64 KiB), `page_text_sha256`, `read_fingerprint`, `page_set_digest`, extraction method, `provenance_json`; insert-only via service-role `put_document_pages`; unique `(source_document_id, page_set_digest, page_number)`; owner-read RLS |
| `hive.document_reads` | Durable read attempt and status (D-038) | `hive_id`, `owner_user_id`, `source_document_id`, `request_id`, `attempt_number`, `status` (`QUEUED`→`READING`→`SAVING`→`VERIFYING`→`SUCCEEDED`/`PARTIAL`/`UNREADABLE`, or `FAILED`), `lease_expires_at`, page counts, `page_set_digest`, safe `error_code`/`error_message_safe`/`retryable`, `correlation_id`; unique `(hive_id, request_id, source_document_id)` and one active attempt per document; trigger-enforced transitions; terminal rows immutable; owner-read RLS; writes only via `start_document_reads` (owner) and `transition_document_read` (service role) |
| `hive.processing_runs` | Durable operation/status (D-039; first `kind`: `STUDY_PREPARATION`) | `hive_id`, `owner_user_id`, `kind`, `request_id` (unique per owner), `attempt_number`, `status` (`QUEUED`→`UNDERSTANDING_REQUEST`→`IDENTIFYING_DOMAIN`→`DEVELOPING_QUESTIONS` (D-040)→`PLANNING_INVESTIGATION`→`BUILDING_PROMPT`→`SAVING`→`SUCCEEDED`, or `NEEDS_CLARIFICATION`/`FAILED`), `lease_expires_at`, frozen `authorized_source_document_ids`, `intent_request_ids`, `source_snapshot` + `source_snapshot_digest`, `intent_snapshot_digest`, `coverage_digest` + `coverage_acknowledged`, validated `stage_outputs`, allowlisted `stage_metrics` (prompt ID/digest, model alias, tokens, latency, finish reason, error code), safe error fields, `correlation_id`; one active run per Hive and kind; trigger-enforced transitions; owner-read RLS; writes only via `start_study_preparation` (owner) and `transition_processing_run` (service role) |
| `hive.study_prompt_previews` | Immutable prepared Canonical Study prompt (D-039) | One per `processing_run_id`; `intent_request_ids`, validated `intent_decomposition`, `domain_proposal`, `intent_intelligence` (D-040; NULL on earlier previews), `investigation_plan`, `sample_coverage`, `source_snapshot`, `execution_manifest` (`hive.study-execution-manifest/1`), `stage_metadata`, `prompt_id`/`prompt_version`/`prompt_template_digest`, `prompt_text`, `prompt_digest`, snapshot digests, `superseded_by_run_id`; staleness is computed against current sources and intents; write-once via service-role `save_study_prompt_preview`; owner-read RLS. Not an accepted Study revision |
| `hive.extraction_batches` | One document/page-range discovery operation | `processing_run_id`, `source_document_id`, page start/end, prompt/contract version/digest, read digest, coverage |
| `hive.fact_candidates` | Untrusted model observations | FK batch; local `F001` mapped to UUID, category, subject/attribute, raw/normalized value, modality, confidence |
| `hive.fact_verifications` | Independent checking per candidate | verified/unresolved/rejected, reason code, verifier version, checked source digest/time |
| `hive.verified_facts` | Accepted document assertions | Candidate provenance, source claimant, subject/record and as-of dates, not real-world truth endorsement |
| `hive.fact_evidence` | Multiple evidence anchors | Original physical page and quote/anchor; source digest; never free-floating |
| `hive.canonical_studies` | Single logical Study per Hive | `hive_id UNIQUE`, `current_revision_id` nullable until first accepted revision |
| `hive.study_revisions` | Immutable accepted history | `canonical_study_id`, revision sequence/digest, predecessors, accepted source coverage |
| `hive.intent_requests` | Owner goal at Hive start (write-once per client request) | `hive_id`, `intent_text` (1–2000 trimmed), optional `audience` (1–200 trimmed, D-040), `client_request_id`, owner; D-026 |
| `hive.intent_analyses` | Question-specific findings | `intent_request_id`, pinned `study_revision_id`, supported fact refs, limitations |
| `hive.report_runs` | Independent generation attempts | `hive_id`, pinned revision, audience, generated unique run ID, status/diagnostics |
| `hive.reports` | Accepted saved output | `report_run_id`, pinned analysis/revision, declarative validated view artifact and history |
| `hive.a2ui_views` | **Optional** independent saved view | Add only if view lifetime truly differs from report; otherwise embed under `reports` |

## Relation sketch

```text
user → hives ─── source_documents ─┬─ document_pages
         │                         └─ document_reads (attempts)
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

**Implementation sequence:** V4-002 created auth/Hive tables/policies; V4-003 adds `intent_requests`, `source_documents`, private bucket, quota/registration RPCs (**local SQL, not deployed**), then `document_pages` (`20261101190000`) and `document_reads` (`20261101200000`) for Read Documents (**local SQL, not applied**; D-038); V4-004 `processing_runs` + `study_prompt_previews` for Analyze / Prompt Preview (`20261102090000`, applied; D-039), then the intent intelligence stage, preview column and intent `audience` (`20261102120000`, **local SQL, not applied**; D-040); V4-005 candidate/run; V4-006 verification/revision; later analysis/report structures.

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
