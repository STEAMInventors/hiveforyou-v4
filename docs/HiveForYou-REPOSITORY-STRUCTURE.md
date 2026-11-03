# HiveForYou V4 — Repository structure and ownership

**Version:** 0.3 | **Status:** The repository exists (`hiveforyou-v4`, in active development, not production). The tree below shows the current top-level layout; `packages/core` is still proposed only.

## Repository layout

```text
hiveforyou-v4/
├── HiveForYou-README.md
├── docs/
│   ├── HiveForYou-PRODUCT-REQUIREMENTS.md
│   ├── HiveForYou-FEATURES.md
│   ├── HiveForYou-UX-A2UI-DESIGN.md
│   ├── HiveForYou-ARCHITECTURE.md
│   ├── HiveForYou-DATA-MODEL.md
│   ├── HiveForYou-SECURITY-AND-PRIVACY.md
│   ├── HiveForYou-PROMPTS-AND-CONTRACTS.md
│   ├── HiveForYou-NAMING-CONVENTIONS.md
│   ├── HiveForYou-REPOSITORY-STRUCTURE.md
│   ├── HiveForYou-DEVELOPMENT-PLAN.md
│   ├── HiveForYou-NEXT.md
│   ├── HiveForYou-CURSOR-DEVELOPMENT-STANDARDS.md
│   ├── HiveForYou-DECISIONS.md
│   └── brand/HiveForYou-Brand-Guide-v1.0.pdf
├── .cursor/rules/HiveForYou-*.mdc
├── prompts/                        # hive-extract, hive-prep, hive-intent, hive-domain,
│                                   # hive-intent-intelligence, hive-plan, hive-study, hive-writer
├── apps/web/                       # Next.js app
│   └── src/
│       ├── app/                    # Next.js routes + server API handlers
│       ├── components/             # brand shell, screens, A2UI renderer
│       ├── server/                 # auth, persistence, model I/O, workflows
│       │   ├── study-preparation/  # prompt catalog, planner client, prompt builder
│       │   └── workflow/           # analysis workflow, agentic Study loop (study-investigation.ts),
│       │                           # agentic Writer loop & report generation (report-generation.ts)
│       └── lib/                    # web-only helpers / typed clients
├── packages/
│   ├── contracts/src/              # versioned trust-boundary contracts and pure checks
│   │   ├── analysis/               # Study agent ledger (study-agent.ts), verifier, formulas
│   │   └── reports/                # Writer agent ledger (writer-agent.ts), validation, scenarios, A2UI catalog/binder
│   └── core/src/                   # proposed: pure evidence/merge/calculation logic (not created)
├── infra/oracle/                   # V4 Reader wrapper and v4-planner (FastAPI) + Docker/compose
├── supabase/migrations/, tests/    # append-only SQL created only with approved schema tickets; pgTAP
└── prototype/                      # visual reference (D-036)
```

Do not scaffold empty directories or multiple packages simply to match this illustration. Build only what an approved ticket needs. Do not add `apps/worker`, Oracle runtime, Inngest, Python reader or extra API service by habit. Long-running execution remains a decision gate, and portable server modules should not depend on one deployment target.

## Responsibilities and dependency direction

| Owner | Responsibilities | Must not do |
|---|---|---|
| `apps/web/src/app` | Pages, authenticated routes, API endpoints, request authorization | Accept user/model JSON as authorization; direct browser model keys |
| `apps/web/src/components` | Stable brand shell, document viewer, A2UI allowlisted rendering | Run executable model HTML/JS; fetch other owners' evidence |
| `apps/web/src/server` | Server-side orchestration, model adapter, document access, persistence/retry boundaries | Blend secrets with client bundles; claim model output is verified |
| `packages/contracts` | Typed versioned I/O, JSON Schema, parsers and serializers | Database operations or provider-specific business logic |
| `packages/core` | Pure deterministic checks: source quotes, normalized values, reconciliation acceptance, safe calculations | Network calls, secrets, tenant decisions or DB access |
| `prompts` | Immutable reviewed prompts under named IDs, change history | Untracked runtime overrides or domain-specific main prompts |
| `supabase/migrations` | Append-only SQL schema, RLS, FKs and functions | Schema edits without an approved ticket; V3 tenant data reuse |
| `docs` and `.cursor/rules` | Governing decisions, ticket control and scoped edit instructions | Claim implementation from a proposed design |

**Allowed:** Web server → contracts/core, provider adapter, private DB/storage. Client → server API only. Core → contracts/types and pure dependencies. Contracts must not import Web/server/core runtime.

## Processing seams (logical, not separate services)

`registerDocument` → `readDocument` → (approved privacy transformation if needed) → `extractDocument` → `verifyEvidence` → `mergeStudy` → `analyzeIntent` → `composeView` → `generateReport`.

- Each stage has explicit input/output contract; stages can be composed in one backend without extra configuration flags.
- Model-generated JSON is **candidate/untrusted** until deterministic independent checks and accepted Study merge.
- `hive-extract/1` and `hive-prep/1` remain distinct. Do not wire direct one-pass prep into the accepted Study path.
- For long-running jobs, move only orchestration/execution to a durable executor if needed, without rewriting pure logic or the user experience.

## Versioned boundaries and documentation

Prompt ID and output schema are versioned (`hive-extract/1`, `hive.doc-extraction/1`). SQL tables, internal modules, functions and code packages are not suffixed V4. Persistent IDs are opaque UUIDs; `F001`, `R001`, `P1` are model-local references only. `docs/HiveForYou-NAMING-CONVENTIONS.md` governs concrete names.

The repository existing does not mean a migration is applied or a service is deployed; deployment state is tracked per ticket in `HiveForYou-NEXT.md`.

The Oracle `v4-planner` relays model turns only (D-042, D-045): Study tools are executed by `StudyAgentLedger` in `packages/contracts/src/analysis/` (called from `apps/web/src/server/workflow/study-investigation.ts`), and Writer tools are executed by `WriterAgentLedger` in `packages/contracts/src/reports/` (called from `apps/web/src/server/workflow/report-generation.ts`). Do not add tool execution to `infra/oracle`.

## Analytical Intelligence logical ownership (future, not scaffolded)

Retain the existing Web / contracts / pure Core / prompts / Supabase boundaries. When approved, implement discovery/LLM planning in `apps/web/src/server/` (or approved portable orchestration boundary); typed opportunity/scenario contracts in `packages/contracts/src/`; deterministic plan/evidence/unit/graph checks in `packages/core/src/`; allowlisted insight/scenario React components in `apps/web/src/components/`; persisted rows only under approved Supabase migrations. Do not create standalone domain engines, a new worker, a solver package or environment flags until workload and approved ticket justify them. The execution adapter for an eventual optimizer is a swappable service boundary; the model may propose the model IR but never inject executable code.
