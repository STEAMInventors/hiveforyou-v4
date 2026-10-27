# HiveForYou V4 — Naming conventions

**Version:** 0.1 · **Status:** PROPOSED — approval required before repository or database creation
**Applies to:** V4 code, programs, APIs, prompts, JSON contracts, A2UI components, database, object storage, migrations, tests, logs and documentation.
**Design alignment:** Application-first Documents · Study · Reports; one Hive, one evolving Canonical Study; no mandatory Domain Pack; source-backed extraction using `hive-extract/1` and `hive.doc-extraction/1`.
**Scope:** Naming standard only. No V4 repository, database, migration or running service is created by this document.

## 1. Universal rules

1. **Use business meaning, not architecture history.** Never encode `v4`, Oracle, Inngest, a provider name, or an implementation phase in normal table, module, function, API-resource or object names. The repository is `hiveforyou-v4`; versioned interfaces and prompt IDs are deliberate exceptions.
2. **One name per concept.** Use **Hive**, **Source Document**, **Document Page**, **Candidate Fact**, **Verified Fact**, **Canonical Study**, **Study Revision**, **Intent Analysis**, **Report Run**, **Report**, and **A2UI View**. Do not interchange *case*, *nest*, *workspace*, *file*, *study run*, and *report* as technical synonyms.
3. **Stable IDs.** Use opaque UUIDs for persistent identities. Use human-readable IDs such as `F001` and `R001` only as *local references within model output*, never as database primary keys. Store local-to-persistent ID mappings explicitly.
4. **Separate trust levels.** An extraction candidate is **not** a verified fact; a verified fact is **not** a Study revision; a view is **not** a source of truth. Names should not imply otherwise.
5. **Versions live at boundaries.** Prompts, contracts and HTTP APIs are versioned; internal implementation modules and ordinary database tables are not. Migrations are timestamped and append-only once applied.
6. **Prefer one familiar convention per layer.** Avoid an extra prefix, suffix, service, table, configuration switch, or abbreviation unless it resolves a real collision.
7. **Don't leak private data through names.** Storage keys, logs, IDs and generated filenames must not contain names, SSNs, student identifiers, account numbers or quoted document content.

**Mandatory documentation filename prefix (V4 decision).** Every human-authored document in the repository—including root overview, governing docs, prompt source files, Cursor `.mdc` rules, design records, brand PDFs, and future generated/exported PDFs—must begin with `HiveForYou-`. Use `HiveForYou-NEXT.md` as the one-ticket source of truth and `HiveForYou-README.md` as the repository overview. The *internal* prompt IDs remain `hive-extract/1` and `hive-prep/1`, regardless of the Markdown filenames. This rule is intentionally stricter than the general avoidance of redundant prefixes in executable code, SQL and API routes. Framework-mandated program filenames such as `page.tsx` remain unchanged. GitHub may not automatically display the custom-named root README; do not create an unprefixed duplicate merely for discoverability.

## 2. Canonical vocabulary and identity mapping

| UI / business term | TypeScript symbol | Database table | Primary key | Cross-boundary JSON key |
|---|---|---|---|---|
| Hive | `Hive` | `hive.hives` | `id` | `hiveId` |
| Source Document | `SourceDocument` | `hive.source_documents` | `id` | `sourceDocumentId` |
| Document Page | `DocumentPage` | `hive.document_pages` | `id` | `pageNumber` plus `sourceDocumentId` |
| Processing Run | `ProcessingRun` | `hive.processing_runs` | `id` | `processingRunId` |
| Extraction Batch | `ExtractionBatch` | `hive.extraction_batches` | `id` | `extractionBatchId` |
| Candidate Fact | `FactCandidate` | `hive.fact_candidates` | `id` | `factCandidateId` |
| Fact Verification | `FactVerification` | `hive.fact_verifications` | `id` | `factVerificationId` |
| Verified Fact | `VerifiedFact` | `hive.verified_facts` | `id` | `verifiedFactId` |
| Fact Evidence | `FactEvidence` | `hive.fact_evidence` | `id` | `factEvidenceId` |
| Canonical Study | `CanonicalStudy` | `hive.canonical_studies` | `id` | `canonicalStudyId` |
| Study Revision | `StudyRevision` | `hive.study_revisions` | `id` | `studyRevisionId` |
| Intent Request | `IntentRequest` | `hive.intent_requests` | `id` | `intentRequestId` |
| Intent Analysis | `IntentAnalysis` | `hive.intent_analyses` | `id` | `intentAnalysisId` |
| Report Run | `ReportRun` | `hive.report_runs` | `id` | `reportRunId` |
| Saved Report | `Report` | `hive.reports` | `id` | `reportId` |
| Validated A2UI View | `A2uiView`* | `hive.a2ui_views`* | `id` | `viewId` |

\* **Conditional:** The `a2ui_views` table is needed only if generated view specifications must be saved independently of reports. If specs belong exclusively to reports, store them as report artifacts and omit this table. Table names above are **reserved recommendations**, not an instruction to create them all now.

**Cardinality invariant:** `hives (1) → canonical_studies (0..1) → study_revisions (many)`; a newly created Hive does not require a pre-created Canonical Study. Each saved report pins a `study_revision_id`; repeated Generate actions create distinct `report_runs`.

## 3. Naming patterns by artifact

| Artifact | Convention | Example |
|---|---|---|
| GitHub repository | lower-case kebab-case | `hiveforyou-v4` |
| npm package scope | stable product scope | `@hiveforyou/core` |
| Directory / non-component source | lower-case kebab-case | `source-documents/`, `verify-evidence.ts` |
| React component & component file | PascalCase | `EvidencePanel.tsx`, `HiveCard.tsx` |
| Type / interface / enum | PascalCase | `StudyRevision`, `VerificationStatus` |
| Function / variable / property | camelCase | `extractDocument()`, `studyRevisionId` |
| Exported constants | UPPER_SNAKE_CASE | `MAX_PAGE_BYTES` |
| Existing necessary environment vars | UPPER_SNAKE_CASE | `LITELLM_BASE_URL` (example only; **no new settings mandated**) |
| HTTP resource segment | plural kebab-case | `/source-documents`, `/report-runs` |
| HTTP JSON fields | camelCase | `sourceDocumentId`, `exactQuote` |
| SQL schema/table/column | snake_case | `hive.study_revisions`, `source_document_id` |
| SQL constraint/index/policy/function | snake_case with type prefix/verb | `fk_study_revisions__canonical_studies`, `idx_source_documents__hive_id` |
| Storage bucket / folders | lowercase kebab-case | `hive-sources`, `sources/` |
| Prompt identifier | stable name `/major` | `hive-extract/1` |
| JSON contract identifier | `hive.<noun>/major` | `hive.doc-extraction/1` |
| Error code / status | UPPER_SNAKE_CASE | `QUOTE_NOT_FOUND`, `UNRESOLVED` |
| Test file | source name + `.test.ts(x)` | `verify-evidence.test.ts`, `EvidencePanel.test.tsx` |
| Synthetic fixture | descriptive kebab-case | `receipt-two-items.json` |
| Documentation (`.md`, `.mdc`, `.pdf`) | **Every document filename begins `HiveForYou-`**; governing docs use `UPPER-KEBAB-CASE` after the prefix | `HiveForYou-PRODUCT-REQUIREMENTS.md`, `.cursor/rules/HiveForYou-00-project.mdc`, `docs/design/HiveForYou-A2UI-View-Contract.md` |

**Framework exceptions:** Keep Next.js reserved filenames exactly (`page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`, `not-found.tsx`); directory names use Next.js standard dynamic segment syntax (`[hiveId]`).

**Data mapping:** Prefer camelCase in new V4 HTTP/model contracts, snake_case in PostgreSQL. Adapters at the database boundary map, e.g. `sourceDocumentId` ↔ `source_document_id`. **Do not silently rename user-approved JSON keys:** the exact `hive.doc-extraction/1` prompt contract uses `documentId`, `fileName`, `pageRange`, `valueAsWritten`, `printedPageLabel`, etc.; preserve those names inside that contract.

## 4. Program/module names (backend and UI)

Use **verb–object** filenames for single-purpose operations, and **noun** directories for capabilities. Do not add `Engine`, `Manager`, `Processor`, `Util`, `V4`, `New`, `Final` or `Service` everywhere.

| Responsibility | Example module/function | Owner (proposed) |
|---|---|---|
| Register document | `register-document.ts` / `registerDocument()` | Next.js server |
| Read document pages | `read-document.ts` / `readDocument()` | Backend processing |
| Tokenize sensitive text | `tokenize-document.ts` / `tokenizeDocument()` | Trusted backend only; gated by approved privacy design |
| Extract candidates | `extract-document.ts` / `extractDocument()` | Server-side model orchestration |
| Check evidence quotes | `verify-evidence.ts` / `verifyEvidence()` | Pure domain-independent Core |
| Persist trusted facts | `save-verified-facts.ts` / `saveVerifiedFacts()` | Server-side persistence |
| Merge accepted Study | `merge-study.ts` / `mergeStudy()` | Trusted backend |
| Analyze a question | `analyze-intent.ts` / `analyzeIntent()` | Server-side model orchestration |
| Build A2UI view | `compose-view.ts` / `composeView()` | Server + allowlisted renderer |
| Generate report | `generate-report.ts` / `generateReport()` | Server-side composition |
| Resolve source chip | `resolve-evidence.ts` / `resolveEvidence()` | Authorized backend |

**Suggested minimal V4 layout** (create directories only when code needs them):

```text
hiveforyou-v4/
  apps/web/src/app/                 # Next.js pages and API routes
  apps/web/src/components/          # Stable screens and approved A2UI renderer
  apps/web/src/server/              # I/O, auth, model calls, persistence
  packages/core/src/               # Pure verification, normalization, merge rules
  packages/contracts/src/          # Versioned boundary types and validators
  prompts/hive-extract/HiveForYou-Extract-v1.md        # Source extraction prompt; ID hive-extract/1
  prompts/hive-prep/HiveForYou-Prep-v1.md           # Standalone IEP meeting-prep prompt; ID hive-prep/1
  supabase/migrations/              # Append-only SQL migrations
  docs/                             # Approved product/architecture/standards
  tests/fixtures/                   # Synthetic, de-identified test inputs
```

No separate `apps/worker`, Python application, or extra package is assumed in V4. The long-running execution arrangement is an independent architecture decision; modules must remain portable between runtimes.

## 5. Prompts, contracts and generated artifacts

**Keep previously selected identifiers verbatim:**

- Extraction prompt **`hive-extract/1`** → file `prompts/hive-extract/HiveForYou-Extract-v1.md`; output schema **`hive.doc-extraction/1`**.
- Standalone meeting preparation **`hive-prep/1`** → `prompts/hive-prep/HiveForYou-Prep-v1.md`; IEP-specific quick-test experience, not the universal core.
- Do **not** assume `hive-study/1`, `hive-writer/1` or A2UI contracts are approved merely because they were mentioned as future pipeline stages. When specified, use the same `name/major` / `hive.<name>/major` pattern.

Each model-generated, persisted artifact should carry appropriate immutable metadata: `contractVersion`, `promptId`, `promptDigest`, `modelAlias`, `processingRunId`, `sourceDocumentId`, and `pageRange` where relevant. Do not force source-specific fields onto non-source artifacts; add `studyRevisionId` to analyses, views and reports. Prompt digest should be deterministic SHA-256 of the canonical approved prompt text. Keep prompt/contract revisions explicit; never edit the meaning of `/1` without compatibility consideration.

**Artifact kind names** use `hive.<noun>/major`, e.g. `hive.doc-read/1`, `hive.doc-extraction/1`, `hive.fact-verification/1`, `hive.study-revision/1`, `hive.intent-analysis/1`, `hive.a2ui-view/1` (**proposed IDs except the already chosen extraction ID**). Artifact instance ID is UUID; separate `kind` from `instanceId`. Do not use storage paths as artifact identities.

**Extraction-local references:** Honor `hive.doc-extraction/1`'s `F001`, `E001`, `R001`, `P1` and optional `p11-20:F001` range prefix; these references are document/window-local. Resolve them to persistent UUIDs before linking across documents or Study revisions.

## 6. HTTP APIs and A2UI

**API version lives in the URL** (`/api/v1`); resource names remain stable. Examples (proposed, not deployed):

```text
GET    /api/v1/hives
POST   /api/v1/hives
GET    /api/v1/hives/{hiveId}
GET    /api/v1/hives/{hiveId}/source-documents
POST   /api/v1/hives/{hiveId}/source-documents
GET    /api/v1/hives/{hiveId}/source-documents/{sourceDocumentId}
POST   /api/v1/hives/{hiveId}/processing-runs
GET    /api/v1/hives/{hiveId}/processing-runs/{processingRunId}
GET    /api/v1/hives/{hiveId}/study
GET    /api/v1/hives/{hiveId}/study/revisions/{studyRevisionId}
POST   /api/v1/hives/{hiveId}/intent-analyses
POST   /api/v1/hives/{hiveId}/report-runs
GET    /api/v1/hives/{hiveId}/reports/{reportId}
```

Use **resource nouns**, HTTP verbs for intent, and single clear run IDs. No RPC-style routes such as `/startProcessingNow`, no provider names, and no fixed-domain route families such as `/iep/reports` in Hive Core.

**A2UI naming:** Keep the application tabs **Documents · Study · Reports**; React components follow `Narrative`, `Metric`, `RecordTable`, `Comparison`, `Timeline`, `IssueList`, `QuestionList`, `EvidencePanel`, `Chart`, `Checklist` as in the V4 UX proposal. If an approved A2UI protocol is adopted, retain its exact wire type names/version. Otherwise, proposed app-local component IDs use PascalCase matching the React catalog, e.g. `{ "type": "EvidencePanel", "evidenceRefs": [...] }`. No arbitrary model-created component names or executable HTML/JS. `viewId`, `studyRevisionId`, `intentAnalysisId` and referenced evidence IDs must be validated and authorized by the server.

## 7. Supabase PostgreSQL naming

**Proposed new V4 Supabase project:** use application schema **`hive`**, not `hive4`, and never create separate schemas per Hive, customer or document domain. Existing Supabase-owned `auth`, `storage`, and `public` schemas retain their normal purposes; privileged public wrappers are allowed only if required and explicitly reviewed. This assumes a new isolated V4 database: **do not rename or migrate V3's existing `hive3` schema by implication.**

### Tables and columns

- Tables: **plural snake_case** (`hives`, `study_revisions`, `fact_candidates`); column names singular snake_case (`hive_id`, `source_document_id`).
- Every durable entity uses `id uuid` unless a verified need for a composite primary key is documented. References use `<entity_singular>_id` (`canonical_study_id`, `study_revision_id`, `source_document_id`).
- For ownership, use `owner_user_id` referencing `auth.users`; do not conflate a Hive ID with an owner/tenant ID.
- Timestamps: `created_at`, `updated_at`, `deleted_at`, `accepted_at`, `started_at`, `completed_at`, all `timestamptz` in UTC; do not prefix table names onto their own columns.
- Provenance: `source_sha256`, `read_fingerprint`, `page_number` (1-based physical), `exact_quote`, `quote_verified_at` if checked, `verification_status`, `reason_code` and version/digest fields as applicable.
- Monetary values: preserve source string and explicitly typed currency/units; do not infer units or store financial amounts as floating-point.
- Flags are positive booleans (`is_active`, `is_deleted`) but prefer clear state enums/status columns for mutually exclusive life cycles.
- Array/JSON columns end in `_json` only where the field stores structured JSON and a descriptive noun alone would be ambiguous; e.g. `output_json`, `coverage_json`. Do not put every row's searchable columns into a giant JSON blob.

### Database object patterns

| Object | Pattern | Example |
|---|---|---|
| Primary key constraint | `pk_<table>` | `pk_hives` |
| Foreign key constraint | `fk_<table>__<referenced_table>` (qualify with column if multiple) | `fk_study_revisions__canonical_studies` |
| Unique constraint | `uq_<table>__<purpose>` | `uq_hives__owner_client_request` |
| Check constraint | `ck_<table>__<rule>` | `ck_document_pages__page_positive` |
| Index | `idx_<table>__<columns_or_purpose>` | `idx_source_documents__hive_id` |
| RLS policy | `pol_<table>__<operation>__<actor>` | `pol_hives__select__owner` |
| SQL function / RPC | snake_case verb–object | `accept_study_revision(...)` |
| Trigger | `trg_<table>__<event_purpose>` | `trg_hives__set_updated_at` |
| Enum type (only if needed) | `<concept>_status` | `verification_status` |
| View | `v_<purpose>` | `v_hive_document_counts` |
| Materialized view (only if needed) | `mv_<purpose>` | `mv_hive_activity` |
| SQL migration | `YYYYMMDDHHMMSS_<action>.sql` | `20261027090000_create_hive_schema.sql` (illustrative) |

**PostgreSQL identifiers are limited to 63 bytes.** Keep automatically generated names shorter than this limit; use concise purposes rather than truncation collisions. Don't generate migrations solely to reserve names. Applied migration files are immutable; create a new timestamped migration for changes.

**RLS/security:** Privileges and policies are substantive security controls, not achieved by a naming pattern. RLS must enforce owner scoping; functions that change accepted Study revisions require explicit authorization, atomicity and safe retry behavior.

## 8. Supabase private object storage

| Purpose | Bucket (proposed) | Object path pattern |
|---|---|---|
| Original uploaded files | `hive-sources` (private) | `hives/{hiveId}/sources/{sourceDocumentId}/original.{ext}` |
| Derived private artifacts (only if files, not DB records) | `hive-artifacts` (private) | `hives/{hiveId}/runs/{processingRunId}/{artifactId}.{ext}` |
| Generated exports (only when authorized) | `hive-exports` (private) | `hives/{hiveId}/reports/{reportId}/exports/{exportId}.{ext}` |

The original human filename is kept as authorized metadata, **not embedded in object paths**. Replacements get a new source identity or explicitly versioned immutable object. Never use a generic `latest.pdf`, names or email addresses as private object keys. Do not create optional buckets before their feature needs them.

## 9. Events, jobs, states, logs and errors

- Background work/event name (if a queue is introduced): `hive.processing.requested` / `hive.processing.completed`. Do not name it after a specific queue vendor. Do not build a queue merely to adopt these names.
- Event fields and structured log fields: `eventName`, `correlationId`, `hiveId`, `processingRunId`, `sourceDocumentId`, `stage`, `status`, `errorCode`, `durationMs` (only when applicable). Database fields remain snake_case.
- Run states (reserved vocabulary, precise semantics to be finalized in contracts): `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`. Processing stages: `READ`, `EXTRACT`, `VERIFY`, `MERGE_STUDY`, `ANALYZE_INTENT`, `COMPOSE_VIEW`. A view can be produced without changing accepted Study state.
- Fact-verification outcomes: `VERIFIED`, `REJECTED`, `UNRESOLVED` — not `VALID` as a synonym for trusted.
- Error codes: stable UPPER_SNAKE_CASE, e.g. `INVALID_DOCUMENT`, `MODEL_OUTPUT_INVALID`, `QUOTE_NOT_FOUND`, `COVERAGE_INCOMPLETE`, `SOURCE_ACCESS_DENIED`.
- Logs must not include source contents, exact quotes, prompt bodies, token maps, signed URLs, raw model responses or PII/PHI. Correlation IDs are opaque; never overload them as object IDs.
- Retries of the same run share run identity and idempotency context; **new user Generate** actions create new `reportRunId` values and preserve previous reports.

## 10. Privacy/tokenization naming (design reservation, not authorization)

Use `PERSON_001`, `ADDRESS_001`, `ACCOUNT_001`, `PATIENT_001` style tokens **only as example classes**; the final privacy design must establish deterministic scope, reversible vault storage, collision rules, redact/restore behavior and proof that quotes still map to original text. Token maps must be scoped to a Hive and authorized identities, kept separately from model-visible candidates, and never logged. The potential table name `hive.token_mappings` is **reserved, not approved for creation**; tokenization alone does not establish legal de-identification or permission to send sensitive documents to a provider.

## 11. Generated reports, exports, documents and tests

- User-visible saved report title: natural language; e.g. **Meeting preparation**, **Spending comparison**. Report **database identity** remains an opaque UUID.
- Download/export filenames, if implemented: `HiveForYou-Report-YYYYMMDD-{shortOpaqueId}.pdf`; no person's name or sensitive subject in filename by default. If a user edits a title, sanitize it before any optional user-named export.
- Governing documentation: `HiveForYou-PRODUCT-REQUIREMENTS.md`, `HiveForYou-UX-A2UI-DESIGN.md`, `HiveForYou-ARCHITECTURE.md`, `HiveForYou-REPOSITORY-STRUCTURE.md`, `HiveForYou-DEVELOPMENT-PLAN.md`, `HiveForYou-NEXT.md`, `HiveForYou-NAMING-CONVENTIONS.md`.
- Design decisions: `docs/adr/HiveForYou-ADR-0001-Short-Topic.md` (incrementing, never reuse an ADR number).
- Tests: `*.test.ts`, `*.test.tsx`, `*.spec.ts` for E2E as appropriate. Fixture sets: `tests/fixtures/grocery/HiveForYou-Receipt-001.pdf`, `tests/fixtures/iep/l001/` (synthetic only). Golden expected results: `receipt-001.expected.json`.
- CI workflows: `.github/workflows/typecheck.yml`, `test.yml`, `preview.yml` only as actually required. Never use `final-final`, `new2`, or model/provider names in test baseline names.

## 12. Naming review checklist

Before approving any new artifact name, ask:

1. Does the name refer to **one clearly defined product concept**?
2. Does it follow its layer's convention without gratuitous prefixes or version numbers?
3. Is the artifact's **trust level** clear: source, candidate, verified, Study, intent or presentation?
4. Does it preserve user-approved IDs (`hive-extract/1`, `hive.doc-extraction/1`) and V4 UX wording?
5. Is it domain-independent, provider-independent, non-sensitive, unique within its namespace, and compatible with PostgreSQL's 63-byte limit?
6. Can the feature be implemented **without** adding a config variable or table just for naming symmetry?

**Adoption decision pending:** Approve this standard first. New V4 architecture, exact table inventory, prompt contract and deployment choices are separate design approvals. V3 files and `hive3` tables remain untouched.
