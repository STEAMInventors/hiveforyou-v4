# HiveForYou V4 — NEXT (single active engineering ticket)

**Date:** 2026-10-26 | **Status:** **V4-002 ACTIVE** — Port Authentication + Hives from V3 | **Repository:** `hiveforyou-v4` (`main` tracking `origin/main`)

> **Active ticket: V4-002.** V4-001 is closed and committed (`3ba9cd1`). Do not start V4-003 until V4-002 is verified and closed. Do not apply SQL migrations, deploy Edge Functions, modify Supabase infrastructure, commit, or push without separate authorization.

## Active ticket — V4-002 — Port Authentication + Hives from V3

**Objective:** Reuse the working V3 authentication and Hive functionality in V4 with minimum changes, following all approved V4 engineering standards.

**Approved scope:**
1. Retain Next.js SSR authentication, session management, signup, login, logout, PKCE/OTP callback, and password recovery.
2. Route Hive CRUD (`create`, `list`, `get`) through the authenticated `v1-hives` Supabase Edge Function (`verify_jwt = true`) and `SECURITY INVOKER` public RPCs (`list_hives`, `get_hive`, `get_hive_by_client_request_id`, `create_hive`) over private `hive.hives` with owner-only RLS (`ENABLE` + `FORCE`).
3. Enforce complete authorization, validation (name 1–100 chars trimmed, description ≤500 chars trimmed, UUID `client_request_id`), and atomic idempotency (`(owner_user_id, client_request_id)`) in the RPC/database boundary as well as application contracts.
4. Do not grant general `UPDATE` or `DELETE` permissions on `hive.hives` in V4-002; implement only `create`, `list`, and `get`.
5. Map idempotency conflicts to `409 IDEMPOTENCY_CONFLICT` without treating unrelated uniqueness failures as the same error.
6. Connect My Hives and Create/Open Hive to the V4 branded shell (`Documents · Study · Reports`) and remove demo Hive data once replaced with functioning persistence.

## Closed ticket record — V4-001

**Status:** Closed and committed (`3ba9cd1 chore(v4): establish application foundation and observability`).
**Verification (2026-10-26):** typecheck, lint, unit tests, and production build passed. Documents, Study, and Reports show distinct empty states. Unknown hive ids render the hive not-found screen; other unknown addresses render the root not-found screen. `GET /api/health` returns `x-correlation-id` on the header and body, regenerates invalid ids without logging them, and writes the same id on the structured completion event. Unexpected failures through `withApiRoute` return `INTERNAL_ERROR` with that same correlation id, stage, and error code in the failure log, and without stacks, paths, or nested sensitive values.

**Objective:** Establish a minimal Next.js V4 codebase and brand-faithful application shell using these governing documents, without importing V3 implementation complexity.

**Read-only first:** Inspect whether `hiveforyou-v4` repository exists, its actual branch/status, any existing scaffolding and dependencies, and these documents. Provide a concrete minimal proposed file list and commands. Wait for explicit approval to create/edit code, repository, dependencies or services.

**Approved scope *after* implementation authorization:**

1. Initialize one TypeScript Next.js application, a small pure core/contracts boundary only if needed, and a repeatable local test/build command.
2. Add fixed Documents / Study / Reports workspace tabs and empty states with approved branding; navigation stable; no generated A2UI yet.
3. Add a landing/My Hives UI scaffold **without claiming functional auth, persisted Hives or ingestion** until those are separately implemented/verified.
4. Define only necessary lint/typecheck/test tools and scripts; do not add feature flags or unnecessary environment variables.
5. Keep this documentation and scoped Cursor rules intact; report any conflicts rather than silently altering them.

**Excluded:** Real Supabase integration, schema creation, uploads, PDF parsing, frontier model, prompt execution, persistence, source verification, Canonical Study acceptance, report generation, provider keys, migration, production deployment, paid model runs.

**Verification / done when (for V4-001 only):**
- New clean repo structure opens; tests/typecheck/build pass with actual command outputs.
- Documents/Study/Reports tabs and distinct honest empty states work in local browser.
- Brand typography/usage and keyboard navigation conform to brand baseline; no fake study or source evidence.
- Changes limited to agreed files; no unrelated work deleted; `git diff --check` clean.
- Report exact files and command results; submit for ticket closure. **Do not automatically start V4-002.**

## Next tickets (parked, not simultaneously active)

| Ticket | Scope | Unlock |
|---|---|---|
| V4-003 | Upload/register/read/view PDF, image and DOCX with page-aware provenance; Free quota | After V4-002 |
| V4-004 | Pack-free `hive-extract/1` one real synthetic document; bounded pages, candidate JSON and statuses | After V4-003; approve model route/cost |
| V4-005 | Independent candidate verification, immutable accepted Study revision, source chip to original page | After V4-004 |
| V4-006 | Intent analysis from pinned Study; dynamic validated A2UI section in Study | After V4-005 |
| V4-007 | Independent Customer/Pro report runs and history; prior good results survive failure | After V4-006 |
| V4-008 | Add documents / multi-intent incremental merge and full coverage test (receipt 20→30, eight-document synthetic L001) | After V4-007 |
| V4-009 | Retention/account deletion, permissions/security verification and sensitive-data readiness gates | Before sensitive-data rollout |

**Parking lot:** Real-world provider data/BAAs; tokenization mechanics; alternative durable executor; professional cross-user permissions; export format/pricing; optional Domain Packs; historical V3/P2.3/P3.1 migrations; V3→V4 data migration; deep semantic domain rules.

**Rule:** One ticket only. Significant work follows **inspect → plan → approve → implement → verify success/failure → synchronize documents/rules → close**. No commits, pushes, deployments, SQL migrations, destructive data changes, or paid calls without authorization.
