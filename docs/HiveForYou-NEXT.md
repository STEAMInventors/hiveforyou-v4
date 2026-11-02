# HiveForYou V4 — NEXT (one active engineering ticket)

**Date:** 2026-11-01 | **Status:** V4-003 in progress (local implementation including Read Documents; migrations not applied; deployment and live upload/read verification pending; Preview create flow diagnosed as failing — see below) | **Repository:** `hiveforyou-v4`

> **Exactly one active engineering ticket: V4-003 — Upload, register, quota-enforce and read supported source documents (view deferred).** Founder-approved scope change 2026-11-01: **Read Documents** (V4 Oracle Reader → verified `hive.document_pages`) is now part of V4-003. No extraction pipeline, LiteLLM/paid model calls, Canonical Study, tokenization, page viewer, or A2UI-generated Study content as a side effect of this ticket.

## Active ticket — V4-003

**Objective:** Owner can attach supported documents to a Hive through a honest prepare → private upload → server registration flow, with Free monthly quota, malware hash scanning policy, and written intent captured at Hive creation in the primary UX.

**Context (verified in repository, not deployed):** V4-001 (application shell, observability) and V4-002 (Supabase Auth, My Hives, Hive CRUD via Edge Function, owner RLS on `hive.hives`) are implemented in Git history. V4-003 work exists as **uncommitted** application code, contracts, SQL migration, and Edge Function handler; **migration and `v1-source-documents` are not deployed**; **end-to-end authenticated uploads against a live project are not yet verified**.

**Completed in working tree (proposed, pending ticket closure):**

1. **D-026 / D-027 / D-036** reflected in contracts, migration comment, V3 Vault upload adapter, and UI adoption mapping (see `HiveForYou-DECISIONS.md` and `HiveForYou-UX-A2UI-DESIGN.md` §17).
2. **V3 Authentication reused as-is:** `apps/web/src/server/auth/auth-actions.ts` delegates directly to V3's `apps/web/src/lib/auth/*` (`session-actions.ts`, `otp-actions.ts`, `recovery-actions.ts`, `action-outcome.ts`) without changing user sessions, cookies, or login behavior.
3. **V3 Vault Document Uploader reused as-is:** `apps/web/src/server/source-documents/hive-vault-upload-adapter.ts` connects V4 Hive identity (`hive.hives`) 1:1 to V3's `Case` contract (`caseId === hive.id` via `createCase`), runs the pre-registration SHA-256 malware hash scan and 10/month quota check, and invokes V3's `registerSourceDocument` and `reconcileUploadOperation` unchanged against private bucket `hive-source-documents`.
4. **Surgical DOCX addition in `@hives/security`:** `files.ts` and `page-count.ts` accept `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`, PK ZIP + `word/document.xml` magic-byte check) alongside PDF, PNG, and JPG up to 25 MB.
5. **One shared `HiveComposer` (D-037):** Landing and the Create Hive dialog use the same composer — intent textarea, paperclip, removable document chips, single **Create Hive**. Signed-out visitors keep a guest draft through sign-up; signed-in owners create directly.
6. **Create Hive flow (`create-hive-flow.ts`):** validates intent (1–2000 chars) and at least one uploadable PDF/PNG/JPG/DOCX (≤ 25 MB); generates a provisional Hive name from the intent; runs `createHive` → `createIntentRequest` → `uploadSelectedSourceFiles` as named stages with per-stage errors and support reference; completed stages are skipped on retry.
7. **Documents tab `DocumentsPanel` (D-036 prototype alignment scope):** list, quota display, drag-and-drop + button upload with status states (uploading, registered, failed), and inventory table layout mapped from `prototype/HiveForYou V4 Prototype.dc.html` (`isDocs`) without synthetic sample loaders, coverage matrix (`hasMatrix`), or page viewer (`hasViewer`).
8. **Migration `20261030150000_create_source_documents.sql`:** `hive.intent_requests`, 1:1 `hive.cases` (`FOREIGN KEY (id, owner_user_id) REFERENCES hive.hives (id, owner_user_id)`), V3's `hive.source_documents`, `hive.upload_operations`, `hive.audit_events`, `hive.storage_orphans`, `hive.apply_vault_transaction`, private `hive-source-documents` bucket, and monthly quota RPC. No second signed-upload or custom registration Edge Function (`v1-source-documents` retired).
9. **Focused tests:** source-document contracts, client upload batch orchestration, V3 Vault upload adapter (1:1 Case creation, PDF/DOCX registration, idempotent `clientRequestId` replay via `reconcileUploadOperation`, owner isolation, malware/magic-byte rejection, and 10/month quota).

10. **Restored API routes (2026-11-01):** `api/v1/hives/[hiveId]/intent-requests`, `api/v1/hives/[hiveId]/source-documents` (GET list, POST multipart upload) and `api/v1/upload-quota`, wired to the existing adapter. These were removed by an earlier `git clean` before commit `d7137c0`, so commits up to `7f48779` call routes that do not exist.
11. **Read Documents (2026-11-01, D-038):** Documents tab **Read Documents** button (enabled when a registered document is `PENDING`/`FAILED` and no read is active) → `POST /api/v1/hives/{id}/document-reads` (authenticated owner; `start_document_reads` queues one durable `hive.document_reads` attempt per eligible document, idempotent on `clientRequestId`) → Next.js `after()` runs the V4 Reader adapter with a Supabase lease → `put_document_pages` → `list_document_pages` readback + hash/digest verification → terminal status. Statuses `QUEUED · READING · SAVING · VERIFYING · SUCCEEDED · PARTIAL · UNREADABLE · FAILED`; the database refuses `SUCCEEDED`/`PARTIAL` unless the verified page rows exist. `ReadDocumentsModal` (V3 processing-modal pattern, V4 brand) polls `GET …/document-reads` every 3 s only while a read is active; closing, refreshing or reconnecting resumes from the durable rows. Reader-only contracts moved to `@hiveforyou/contracts/document-read` so `node:crypto` stays out of middleware/client bundles.

**Preview failure diagnosis (2026-11-01, `Could not save what you need`):**

- **Failing operation:** `createIntentRequest` → `POST /api/v1/hives/{id}/intent-requests`. `createHive` succeeds first, so each failed attempt leaves one Hive with no intent or documents (existing records left untouched).
- **Response:** HTML `404` from Next.js `/_not-found` (verified on `hiveforyou-v4.vercel.app`; the branch Preview is behind Vercel Authentication and built from the same commit). `parseApiJson` cannot read JSON and substitutes the fallback message with `PERSISTENCE_FAILED`. The correlation ID is generated in the browser per request and echoed by middleware; no route handler runs, so no server log line exists for it.
- **Blockers behind the route fix (unverified against the live project — no credentials available locally):** migration `20261030150000` (`public.create_intent_request`, `public.get_upload_quota`, `hive.cases`/`source_documents`/…, bucket) is recorded as not applied; the V3 Vault adapter calls PostgREST `schema("hive")` with the service key, but `hive` is intentionally unexposed (config + tests), which would return `PGRST106`; `SUPABASE_SECRET_KEY` must exist in Vercel; Vercel Functions reject request bodies over 4.5 MB, below the 25 MB upload limit; the live adapter has no persistent `clientRequestId` registry, so a lost-response retry can register a duplicate document.
- **Documents tab:** committed `documents/page.tsx` renders the static "No documents yet" empty state, not `DocumentsPanel` (item 7), so registered uploads would not be shown.

**Explicitly deferred (still V4-003 scope boundaries or later tickets):**

- ~~Document reading~~ — moved into V4-003 (item 11). Still deferred: a durable job queue beyond `after()` + lease, and reading documents larger than one 300 s function invocation allows.
- **Source page viewer** (F-007 physical-page navigation).
- Frontier extraction, verification, Study acceptance (V4-004+).

**Excluded:** Applying SQL to a live Supabase project, deploying Edge Functions, production VirusTotal keys, PDF/DOCX parsing libraries, Canonical Study, reports, A2UI dynamic Study, paid model usage.

**Verification / done when (for V4-003):**

- Founder approves and migration is applied to the V4 Supabase project; `v1-source-documents` deployed; web app configured for that project.
- Signed-in owner: landing or My Hives → Create Hive with intent + file → at least one document reaches **REGISTERED** with stored hash and scan status; quota decrements honestly; rejected type/size/malware/quota paths fail closed without false “done”.
- Idempotent client request IDs replay safely; unauthorized cross-Hive access denied.
- Documents tab reflects registration and read states; no claim of Study content.
- Founder approves and migrations `20261101190000_create_document_pages.sql` and `20261101200000_create_document_reads.sql` are applied; Vercel has `READER_BASE_URL`, `READER_SERVICE_TOKEN` and `SUPABASE_SECRET_KEY`; the Oracle Reader is reachable over HTTPS.
- Clicking **Read Documents** on a synthetic document starts genuine reading; the modal shows the recorded statuses; `SUCCEEDED` appears only after pages are read back from `hive.document_pages` and verified; repeated clicks create no duplicate attempt; a failed attempt can be retried; `supabase test db` (`supabase/tests/database/document_reads.test.sql`) passes locally.
- Automated tests for touched packages still pass; `git diff --check` clean on documentation.
- Report exact files, commands, and live-test evidence; submit for ticket closure. **Do not automatically start V4-004.**

## Next tickets (parked, not simultaneously active)

| Ticket | Scope | Unlock |
|---|---|---|
| V4-004 | Pack-free `hive-extract/1` one real synthetic document; bounded pages, candidate JSON and statuses | After V4-003 closure; approve model route/cost |
| V4-005 | Independent candidate verification, immutable accepted Study revision, source chip to original page | After V4-004 |
| V4-006 | Intent analysis from pinned Study; dynamic validated A2UI section in Study | After V4-005 |
| V4-007 | Independent Customer/Pro report runs and history; prior good results survive failure | After V4-006 |
| V4-008 | Add documents / multi-intent incremental merge and full coverage test (receipt 20→30, eight-document synthetic L001) | After V4-007 |
| V4-009 | Retention/account deletion, permissions/security verification and sensitive-data readiness gates | Before sensitive-data rollout |

**Completed tickets (closed in Git, not re-opened here):** V4-001 application foundation; V4-002 authentication and owner Hives.

**Parking lot:** Real-world provider data/BAAs; tokenization mechanics; alternative durable executor; professional cross-user permissions; export format/pricing; optional Domain Packs; historical V3/P2.3/P3.1 migrations; V3→V4 data migration; deep semantic domain rules; analytical track V4-A01–V4-A07 (see `HiveForYou-DEVELOPMENT-PLAN.md`).

**Rule:** One ticket only. Significant work follows **inspect → plan → approve → implement → verify success/failure → synchronize documents/rules → close**. No commits, pushes, deployments, SQL migrations, destructive data changes, or paid calls without authorization.

## Analytical Intelligence parking-lot note — 2026-10-31

Product requirements **R65–R84** and features **F-045–F-064** add **proactive analysis discovery and scenario what-if** to the long-term V4 product direction. Decisions **D-028–D-035** record that product direction. This documentation change does **not** authorize code, schema, background jobs, LLM calls, or a new active ticket. Preserve **V4-003 as the only active ticket**. Proposed future sequence **V4-A01–V4-A07** requires explicit ticket activation after prerequisites are met.
