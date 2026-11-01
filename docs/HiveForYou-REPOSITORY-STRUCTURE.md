# HiveForYou V4 — Repository structure and ownership

**Version:** 0.2 | **Status:** Proposed paths only. The new repository and application code do not exist yet.

## Proposed minimum repository

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
├── prompts/
│   ├── hive-extract/HiveForYou-Extract-v1.md
│   └── hive-prep/HiveForYou-Prep-v1.md
├── apps/web/                       # Next.js app (V4-001+; auth, Hives, upload UI in progress)
│   └── src/
│       ├── app/                    # Next.js routes + server API handlers
│       ├── components/             # brand shell, screens, approved renderer
│       ├── server/                 # auth, persistence, model I/O, workflows
│       └── lib/                    # web-only helpers / typed clients
├── packages/
│   ├── contracts/src/             # versioned trust-boundary schemas (as needed)
│   └── core/src/                  # pure evidence/merge/calculation logic (as needed)
├── supabase/migrations/            # created only with approved schema ticket
└── tests/fixtures/                # synthetic sources; no real personal records
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

No V4 repository, live database schema, model gateway or frontend exists merely because this folder is distributed.

## Analytical Intelligence logical ownership (future, not scaffolded)

Retain the existing Web / contracts / pure Core / prompts / Supabase boundaries. When approved, implement discovery/LLM planning in `apps/web/src/server/` (or approved portable orchestration boundary); typed opportunity/scenario contracts in `packages/contracts/src/`; deterministic plan/evidence/unit/graph checks in `packages/core/src/`; allowlisted insight/scenario React components in `apps/web/src/components/`; persisted rows only under approved Supabase migrations. Do not create standalone domain engines, a new worker, a solver package or environment flags until workload and approved ticket justify them. The execution adapter for an eventual optimizer is a swappable service boundary; the model may propose the model IR but never inject executable code.
