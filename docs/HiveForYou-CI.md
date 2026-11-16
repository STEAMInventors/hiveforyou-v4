# HiveForYou V4 — Continuous integration and release

## Workflows (what runs when)

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Database tests | `HiveForYou-database-tests.yml` | Push/PR touching `supabase/**`, database workflow, or `scripts/assert-app-rpc-coverage.mjs` | Local `supabase db reset`, all `*.test.sql` (pgTAP), all `*_check.sql` (psql), RPC header coverage script |
| App CI | `HiveForYou-app-ci.yml` | Push/PR touching `apps/**`, `packages/**`, root `package.json`, `scripts/**`, or app CI workflow | `npm ci`, typecheck, lint, unit tests (8 GB heap), build |
| Deploy migrations | `HiveForYou-deploy-migrations.yml` | Manual `workflow_dispatch` only | Report or apply migrations to **production** or **staging**; after apply, run all `*_check.sql` on target |
| Deploy edge functions | `HiveForYou-deploy-edge-functions.yml` | Push to `main` (function paths), PR (validate only), manual dispatch | Deploy changed functions under `supabase/functions`; `main` waits for green database tests and app CI when those workflows ran for the commit |

## Repository secrets (names only)

| Secret | Used by |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Migrations deploy, edge deploy |
| `SUPABASE_PROJECT_ID` | Production migrations and edge deploy |
| `SUPABASE_DB_PASSWORD` | Production migrations (`psql` / `supabase link`) |
| `SUPABASE_STAGING_PROJECT_ID` | Staging migrations and edge dispatch target **staging** |
| `SUPABASE_STAGING_DB_PASSWORD` | Staging migrations |

Edge and migration workflows fail fast with a clear message if required secrets for the selected **target** are missing.

## Run checks locally

Docker is required for database tests (`supabase db start`). This environment does not run Docker; **GitHub Actions on branch `qf-1a`** is the verification proof after push.

```bash
# Migrations + pgTAP (from repo root; helpers are prepended automatically in CI)
supabase db start
supabase db reset --no-seed

# All pgTAP files (same merge as CI: pg_fixture_helpers.sql + each *.test.sql)
node scripts/run-pgtap-database.mjs

# Single pgTAP file (manual merge)
psql "$DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/database/pg_fixture_helpers.sql \
  -f supabase/tests/database/document_reads.test.sql

# Paste checks (expect ALL CHECKS PASSED, then ROLLBACK in file)
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/database/hive_membership_check.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/database/firm_membership_check.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/database/rpc_smoke_check.sql

# RPC list drift guard
node scripts/assert-app-rpc-coverage.mjs

# App CI
npm ci
npm run typecheck && npm run lint && npm test && npm run build
```

Shared hive fixtures: `supabase/tests/database/pg_fixture_helpers.sql` — call `SELECT pg_temp.qf1a_ensure_owner_memberships();` after direct `INSERT INTO hive.hives` so owner `hive.hive_members` rows match `public.create_hive` (FL-5).

## Release routine

1. Branch from `main` (e.g. `qf-1a`).
2. Open a pull request; wait for **HiveForYou Database Tests** and **HiveForYou App CI** on the PR commit.
3. **Migrations → staging** (`workflow_dispatch`, `target: staging`, `run_mode: apply`, `apply_through_version` = reviewed timestamp); confirm all `*_check.sql` steps pass in the job.
4. Founder review on staging.
5. **Migrations → production** with the same `apply_through_version` after approval; `*_check.sql` must pass again.
6. Merge pull request to `main`; edge function deploy runs for changed functions when database/app CI succeeded for that commit (or use manual dispatch with **target**).
7. Keep `20261115210000_list_hives_union_all.sql` in the migration chain (already applied in production).

## Related security proof

`docs/HiveForYou-SECURITY-CHECKLIST-F028.md` — membership and firm controls; `list_hives` / home-kicker proof includes `supabase/tests/database/rpc_smoke_check.sql`.