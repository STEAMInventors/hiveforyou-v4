# HiveForYou V4 — Development plan

**Version:** 0.1 | **Status:** V4-001 shell accepted locally; later tickets not started. | **Date:** 2026-10-26

## Development objective

Build the smallest real, pleasant **Documents → Study → Reports** experience with `hive-extract/1`, independent evidence checks, a persistent evolving Study and rich validated A2UI. V4 is actively in development and **not in production**. Keep a single active ticket in `HiveForYou-NEXT.md`; don't block basic product progress on historical V3 qualification or hypothetical scale features.

## Standards

- New repo `hiveforyou-v4`; V3 is read-only reference, no V3 source/migration copied reflexively.
- Program logic portable and TypeScript-first; Next.js/Vercel and Supabase are proposed. Durable job executor is a separate decision when needed.
- Domain Packs are never required for ordinary extraction. `hive-extract/1` is the authoritative user prompt, `hive.doc-extraction/1` is target candidate contract, `hive-prep/1` is external one-pass IEP testing.
- No new feature-specific flags/config vars, clone pipelines or premature distributed services. A single approved model interface and only necessary deployment secrets.
- User-approved changes only; authorization separately required for Git pushes, deployments, SQL migrations, paid model runs and sensitive documents.
- Each functional slice tests success and most relevant failure behavior; no automatic claiming completion based on compilation.

## Phases and tickets (dependency-order, one active at a time)

| Phase / ticket | Work | User-visible proof | State |
|---|---|---|---|
| P0 · **V4-001** | New repo, code scaffold, brand-faithful stable application shell | Documents, Study, Reports tabs and true empty states locally | **ACCEPTED locally — initial commit not yet authorized** |
| P1 · V4-002 | Auth/My Hives/Create Hive + owner-only RLS, idempotent creation | User signs in, creates own empty Hive; cannot access another owner's Hive | PARKED |
| P1 · V4-003 | Private file upload, quota, page-reading/viewer with real status | Synthetic PDF/PNG/JPEG/DOCX registered; exact page displayed; error/quota cases | PARKED |
| P2 · V4-004 | Frontier pack-free extraction `hive-extract/1`, versioned candidates, bounded pages | Real synthetic receipt produces honest `hive.doc-extraction/1` candidate JSON | PARKED |
| P2 · V4-005 | Verify evidence, candidate trust dispositions, merge accepted revision | Source page chips work and one verified Study is accepted; bad quote rejected | PARKED |
| P3 · V4-006 | Study intent analysis and one dynamic A2UI slot | Two questions yield different validated views of same pinned Study | PARKED |
| P3 · V4-007 | Customer/Pro report runs, history and pinned revisions | New Generate creates new report; failure doesn't erase prior accepted result | PARKED |
| P4 · V4-008 | Incremental sources, conflict/currentness, full-scope and targeted extraction | Add 10 receipts to 20 in same Hive; eight synthetic L001 docs; reuse Study | PARKED |
| P4 · V4-009 | Sensitive-data readiness and account/Hive deletion/recovery mechanics | Synthetic negative cases, authorized cleanup, complete safe retention policy | PARKED |

## Ticket template (mandatory for Cursor)

1. **Ticket:** ID from `HiveForYou-NEXT.md`; only that active ticket.
2. **Objective:** one observable customer or engineering result.
3. **Context:** governing approved docs and actual local state.
4. **Scope:** exact operations/files after inspection; explicit exclusions.
5. **Constraints:** one path, no new configs without approval, no private data leakage, preserve unrelated changes.
6. **Implementation:** minimal functions/components/SQL contract to reach output.
7. **Error handling:** likely edge and negative paths at relevant boundaries.
8. **Observability:** safe stage/code/IDs only, appropriate for development.
9. **Verification:** runnable commands, local/browser demonstration and failure cases.
10. **Done when:** actual observable checks, not just green compilation.
11. **Report:** changed files, results, known gaps, affected docs and authorization needed.

**Workflow:** Inspect actual files → propose read-only plan → obtain approval → implement approved scope → verify positive and failure paths → synchronize documents, decisions, rules and NEXT → close. No auto-advance to next ticket.

## Integration/acceptance scenarios (not separate bureaucracy)

| Scenario | First relevant ticket | Expected proof |
|---|---|---|
| One synthetic receipt unknown to the code | V4-004/005 | Dynamic model candidates; verified fact trace to correct page and row |
| Two different questions and views | V4-006 | Same pinned Study; different grounded A2UI; no silent re-extraction |
| Report revision independence | V4-007 | Unique run, pinned inputs, accepted earlier output survives failure |
| Receipt corpus twenty → thirty | V4-008 | Incremental coverage and source identities maintained; known/unknown clear |
| IEP eight docs L001 | V4-008 | Chronology/goal/service provenance; no unsupported currentness/legal findings |
| Wrong owner, injected instructions, wrong quote, partial page | Each boundary's ticket | Denied/rejected/explicit incomplete; no accepted trust state changes |
| Regulated sensitive inputs | V4-009 or earlier gate if attempted | Stop until provider, contracts, tokenization/data-use policy approved |

## Decision gates before specific tickets

- **V4-002:** use an independent V4 Supabase project/schema; approve SQL and RLS separately. No V3 live migration.
- **V4-003:** choose server-side PDF/DOCX/image read libraries, reasonable file/page limits, storage retention and malware handling, physical page evidence semantics.
- **V4-004:** approve model provider/gateway, structured JSON interface, costs, private-content policy, prompt contract clarifications; authorize paid synthetic test separately.
- **V4-005:** approve verifier checks and data model; explain evidence quote acceptance vs real-world truth.
- **V4-006:** pick supported A2UI wire schema/React integration, allowlist and model-safe actions.
- **Before large corpora:** validate backend runtime/durable execution and interruption recovery within actual limits.
- **Before real personal documents:** resolve `HiveForYou-SECURITY-AND-PRIVACY.md` safeguards and applicable provider/BAA/consent requirements.

## Source-of-truth sync at ticket close

Update as affected: `HiveForYou-PRODUCT-REQUIREMENTS.md`, `HiveForYou-FEATURES.md`, `HiveForYou-ARCHITECTURE.md`, `HiveForYou-DATA-MODEL.md`, `HiveForYou-UX-A2UI-DESIGN.md`, `HiveForYou-PROMPTS-AND-CONTRACTS.md`, `HiveForYou-NAMING-CONVENTIONS.md`, `HiveForYou-REPOSITORY-STRUCTURE.md`, `HiveForYou-DEVELOPMENT-PLAN.md`, `HiveForYou-NEXT.md`, `HiveForYou-DECISIONS.md`, `.cursor/rules/*.mdc`. Never rewrite the brand guide or user-approved prompt silently.

## Explicitly parked

Optional Domain Packs; cross-user professional membership; automated external filing; billing models beyond retained Free cap; source-data cross-Hive learning; broad infra rebuild; V3→V4 migration; large-scale multi-agent orchestration; claim of HIPAA operation; template-per-domain apps; release promotion/prod hardening (V4 is not in production).
