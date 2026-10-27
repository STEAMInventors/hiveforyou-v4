# HiveForYou V4 — documentation-first starter

**Status (2026-10-26):** V4 documentation plus an **accepted V4-001 application shell** (`apps/web`, `@hiveforyou/contracts`). Verification passed locally. The initial Git commit is not made. No GitHub remote, SQL migration, deployment, or paid model integration yet.

> **The complicated, made simple.**

## Product

One authenticated **Hive** holds its Source Documents, one evolving evidence-backed **Canonical Study**, and multiple questions, analyses, dynamically composed views, and saved reports. V4 retains the V3 customer functionality but uses a stable **Documents · Study · Reports** application shell with richer declarative A2UI regions. Pack-free extraction is the default, using user-selected **`hive-extract/1`**; the IEP-specific **`hive-prep/1`** is a standalone one-pass test and not a replacement for verified processing.

## Read in order

1. [`docs/HiveForYou-PRODUCT-REQUIREMENTS.md`](docs/HiveForYou-PRODUCT-REQUIREMENTS.md) — what the product must do, V3 retention
2. [`docs/HiveForYou-FEATURES.md`](docs/HiveForYou-FEATURES.md) — journeys, features, acceptance behaviors
3. [`docs/HiveForYou-UX-A2UI-DESIGN.md`](docs/HiveForYou-UX-A2UI-DESIGN.md) — application-first screen and A2UI design
4. [`docs/HiveForYou-ARCHITECTURE.md`](docs/HiveForYou-ARCHITECTURE.md) — logical processing, trust, proposed runtime
5. [`docs/HiveForYou-DATA-MODEL.md`](docs/HiveForYou-DATA-MODEL.md) — proposed persistence entities and invariants
6. [`docs/HiveForYou-SECURITY-AND-PRIVACY.md`](docs/HiveForYou-SECURITY-AND-PRIVACY.md) — model data handling, isolation, tokenization design gates
7. [`docs/HiveForYou-NAMING-CONVENTIONS.md`](docs/HiveForYou-NAMING-CONVENTIONS.md) — canonical naming across all artifacts
8. [`docs/HiveForYou-REPOSITORY-STRUCTURE.md`](docs/HiveForYou-REPOSITORY-STRUCTURE.md) — code ownership
9. [`docs/HiveForYou-DEVELOPMENT-PLAN.md`](docs/HiveForYou-DEVELOPMENT-PLAN.md) — dependency-ordered slices
10. [`docs/HiveForYou-NEXT.md`](docs/HiveForYou-NEXT.md) — **only active engineering ticket**
11. [`docs/HiveForYou-ERROR-HANDLING-OBSERVABILITY.md`](docs/HiveForYou-ERROR-HANDLING-OBSERVABILITY.md) — shared errors, correlation, logging
12. [`docs/HiveForYou-CURSOR-DEVELOPMENT-STANDARDS.md`](docs/HiveForYou-CURSOR-DEVELOPMENT-STANDARDS.md) and [`.cursor/rules/`](.cursor/rules/) — approved execution discipline
13. [`docs/HiveForYou-DECISIONS.md`](docs/HiveForYou-DECISIONS.md) — founder decisions vs open proposals
14. [`docs/HiveForYou-PROMPTS-AND-CONTRACTS.md`](docs/HiveForYou-PROMPTS-AND-CONTRACTS.md) and [`prompts/`](prompts/) — exact model prompt sources
15. [`docs/HiveForYou-PROJECT-SOURCES.md`](docs/HiveForYou-PROJECT-SOURCES.md) — retained source provenance and precedence
16. [`docs/brand/HiveForYou-Brand-Guide-v1.0.pdf`](docs/brand/HiveForYou-Brand-Guide-v1.0.pdf) — **unchanged approved brand guide**

## Governance and limits

- A new V4 repo is intended; **V3 remains untouched**. This package may be copied into a new repo after approval.
- The user-selected prompts are source-of-truth text. Their known implementation contradictions are described in `docs/HiveForYou-PROMPTS-AND-CONTRACTS.md`, **not silently edited**.
- No new per-feature environment switches, no duplicate pipelines, no premature domain-specific application code.
- No real PHI/PII uploads or paid model runs without appropriate approval, vendor safeguards and explicit authorization.
- Work only the one active ticket in `docs/HiveForYou-NEXT.md`; changes follow **inspect → plan → approve → implement → verify → synchronize → close**.
