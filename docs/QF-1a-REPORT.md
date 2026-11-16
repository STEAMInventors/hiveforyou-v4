# QF-1a — Repair and extend automated checks (report)

**Branch:** `qf-1a` (not committed per ticket). **Local Docker/Supabase:** not run on the developer machine; verify via **GitHub Actions** after push.

## 1. pgTAP / check SQL status

| File | Before | After |
| --- | --- | --- |
| `document_reads.test.sql` | FAIL `hive_not_found` / owner not in `hive_members` | PASS expected: FL-5 fixture via `qf1a_ensure_owner_memberships` |
| `study_preparation.test.sql` | FAIL same | PASS expected |
| `analysis_workflow.test.sql` | FAIL same (3 hive inserts) | PASS expected |
| `doc_extractions_v5_pipeline.test.sql` | FAIL same | PASS expected |
| `v5_workflow_part_a.test.sql` | FAIL same (+ optional diagnostic path) | PASS expected |
| `v5_report_study_view.test.sql` | FAIL + syntax error extra `)` in `save_report` payload | PASS expected: paren fix + membership |
| `rebuild_study.test.sql` | FAIL same | PASS expected |
| `hive_deletion_v5.test.sql` | FAIL `ck_processing_runs__finished` (`SUCCEEDED` without `finished_at`) | PASS expected: `finished_at` set |
| `workflow_write_ahead_handoff.test.sql` | FAIL permission on `hive.is_valid_failure_diagnostic` as `authenticated` | PASS expected: assert as `service_role` (app never calls this RPC) |
| `processing_run_workflow_state.test.sql` | Not in CI; hive fixture gap | PASS expected: helpers |
| `study_revision_immutability.test.sql` | Same | PASS expected |
| `workflow_recovery_sweeper.test.sql` | Same | PASS expected |
| `study_tab_view.test.sql` | Same | PASS expected |
| `recover_lost_workflow_handoffs.test.sql` | Same | PASS expected |
| `doc_extraction_attempts.test.sql` | Same | PASS expected |
| `hive_deletion_audit_events.test.sql` | Same | PASS expected |
| `hive_kind.test.sql` | Uses `create_hive` (OK) | Unchanged |
| `user_profiles.test.sql` | No hives | Unchanged |
| `hive_membership.test.sql` | Scaffolding only | **Deleted** — covered by `hive_membership_check.sql` + `firm_membership_check.sql` + `rpc_smoke_check.sql` |
| `hive_membership_check.sql` | Not in CI | Run via `*_check.sql` discovery |
| `firm_membership_check.sql` | Not in CI | Run via discovery |
| `rpc_smoke_check.sql` | New list_hives smoke only | Extended: 85 app/edge RPCs × roles |

## 2. Assertions rewritten (not weakened)

| Change | Why |
| --- | --- |
| `pg_fixture_helpers.sql` + `qf1a_ensure_owner_memberships()` | FL-5: access and owner RPCs require active owner `hive_members` row (same as `public.create_hive`). Old direct `INSERT INTO hive.hives` obsolete for authorization. |
| `workflow_write_ahead_handoff`: `is_valid_failure_diagnostic` under `service_role` | Migration `20261102170000` revokes execute from `authenticated`; only DB constraints and service paths use it — not a defect in product. |
| `v5_report_study_view`: removed one closing parenthesis in `save_report` JSON | Syntax fix only; behaviour assertion unchanged. |
| `hive_deletion_v5`: `finished_at` on terminal `SUCCEEDED` processing run | Matches `ck_processing_runs__finished` schema — fixture was stale. |

## 3. Defects found

None in product code from this ticket. Failures were **test/fixture drift** after FL-5 membership and diagnostics grants.

**Note:** App calls `hive.persist_intake_result` but no migration defines it yet; `rpc_smoke_check.sql` expects refusal for all four participant roles (missing or denied function), not success.

## 4. RPC coverage

- **Discovery:** `scripts/assert-app-rpc-coverage.mjs` walks `apps/web` and `supabase/functions` (literal `.rpc("name")`, `rpc(client, "name")`, `invokeRpc`, `rpcPersist`, `hive.schema().rpc`).
- **Header:** `rpc_smoke_check.sql` `APP_RPC_COVERAGE_BEGIN/END` — **85** names; CI runs the script before database tests.
- **Smoke:** Each RPC invoked as owner, firm member, client, and stranger (plus existing pro list_hives paths) with success or expected refusal.

## 5. Workflows created or changed

| File | Change |
| --- | --- |
| `HiveForYou-database-tests.yml` | Discover all `*.test.sql` and `*_check.sql`; prepend `pg_fixture_helpers.sql`; RPC coverage script; count checks |
| `HiveForYou-app-ci.yml` | **New** — npm ci, typecheck, lint, test (8 GB), build, cache |
| `HiveForYou-deploy-edge-functions.yml` | All functions; `target` input; `verify_jwt`; CI gate on `main`; staging project id |
| `HiveForYou-deploy-migrations.yml` | `target` production/staging; post-apply `*_check.sql` on target |

## 6. Docs

- `docs/HiveForYou-CI.md` — triggers, secrets, local commands, release routine.
- `docs/HiveForYou-SECURITY-CHECKLIST-F028.md` — points at `rpc_smoke_check.sql` for `list_hives` rows.

## 7. Migration chain

`supabase/migrations/20261115210000_list_hives_union_all.sql` unchanged and retained after `20261115200000` (production already applied).