# HiveForYou V4 — NEXT (no active engineering ticket)

**Date:** 2026-10-26 | **Status:** V4-001 **accepted locally** — verification passed; **initial Git commit not made** | **Repository:** `hiveforyou-v4` (local git initialized; GitHub remote not created)

> **No engineering ticket is active.** V4-001 is accepted and ready for its initial commit. Do not start V4-002 until the founder opens it. No extraction, database migrations, deployments, paid model calls, tokenization, or A2UI-generated content as a side effect.

## V4-001 — accepted, awaiting the initial commit

**Verification (2026-10-26):** typecheck, lint, unit tests, and production build passed. Documents, Study, and Reports show distinct empty states. Unknown hive ids render the hive not-found screen; other unknown addresses render the root not-found screen. `GET /api/health` returns `x-correlation-id` on the header and body, regenerates invalid ids without logging them, and writes the same id on the structured completion event. Unexpected failures through `withApiRoute` return `INTERNAL_ERROR` with that same correlation id, stage, and error code in the failure log, and without stacks, paths, or nested sensitive values.

**Remaining authorization:** the initial Git commit. Push, remote creation, and deployment are still separate. Do not open V4-002 from this acceptance.

## Ticket record — V4-001

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
| V4-002 | Supabase Auth, owner-only My Hives, create/open Hive; initial safe data model and RLS | After V4-001 |
| V4-003 | Upload/register/read/view PDF, image and DOCX with page-aware provenance; Free quota | After V4-002 |
| V4-004 | Pack-free `hive-extract/1` one real synthetic document; bounded pages, candidate JSON and statuses | After V4-003; approve model route/cost |
| V4-005 | Independent candidate verification, immutable accepted Study revision, source chip to original page | After V4-004 |
| V4-006 | Intent analysis from pinned Study; dynamic validated A2UI section in Study | After V4-005 |
| V4-007 | Independent Customer/Pro report runs and history; prior good results survive failure | After V4-006 |
| V4-008 | Add documents / multi-intent incremental merge and full coverage test (receipt 20→30, eight-document synthetic L001) | After V4-007 |
| V4-009 | Retention/account deletion, permissions/security verification and sensitive-data readiness gates | Before sensitive-data rollout |

**Parking lot:** Real-world provider data/BAAs; tokenization mechanics; alternative durable executor; professional cross-user permissions; export format/pricing; optional Domain Packs; historical V3/P2.3/P3.1 migrations; V3→V4 data migration; deep semantic domain rules.

**Rule:** One ticket only. Significant work follows **inspect → plan → approve → implement → verify success/failure → synchronize documents/rules → close**. No commits, pushes, deployments, SQL migrations, destructive data changes, or paid calls without authorization.
