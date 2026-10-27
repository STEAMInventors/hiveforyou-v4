# HiveForYou V4 — Source provenance and precedence

**Version:** 0.1 | **Date:** 2026-10-26 | **Status:** Documentation-only compilation from founder decisions and provided reference materials.

## Founder-selected V4 directions (highest priority)

- New clean V4 repository, leave V3 intact as history.
- Preserve V3 product capabilities and user-facing decisions, **not** its execution/infrastructure constraints.
- Application-first fixed Documents/Study/Reports UI with dynamic, evidence-bound A2UI enhancements.
- Pack-free extraction without a required Domain Pack, predefined fact catalog or user intent; prompt `hive-extract/1`, schema `hive.doc-extraction/1` exactly as provided.
- Standalone direct-model/Opal IEP meeting prep `hive-prep/1` exactly as provided; not canonical pipeline.
- No per-feature environment variables or flags; simplify and minimize infrastructure.
- V4 is under active development and is not to be referred to as production.
- Branding is finished; preserve approved brand guide v1.0 unchanged.

## Source documents used

| Source | V4 use | Caveat |
|---|---|---|
| V3 `HiveForYou-PRODUCT-REQUIREMENTS.md` v1.2.1 (attached in project) | R01–R36, owner-only/Free quota, source/Study/report behavior, deletion timing, negative-path obligations | Old Oracle/LiteLLM/Inngest mandates are **historical V3 topology**, not V4 requirements. |
| V3 `HiveForYou-ARCHITECTURE.md`, `HiveForYou-REPOSITORY-STRUCTURE.md`, `HiveForYou-DEVELOPMENT-PLAN.md`, `HiveForYou-NEXT.md`, `HiveForYou-CURSOR-DEVELOPMENT-STANDARDS.md` | Evidence trust principles and development discipline | V3 tickets, migrations, schemas and program paths are **not** carried forward as active V4 implementation. |
| Previous proposed V4 UX/A2UI design (2026-10-26) | Detailed fixed-shell flows and A2UI component catalogue | Included as `HiveForYou-UX-A2UI-DESIGN.md`; still a proposal pending code. |
| Previous proposed V4 naming conventions (2026-10-26) | Program, prompts, APIs and Supabase object naming | Included as `HiveForYou-NAMING-CONVENTIONS.md`; proposed until approved. |
| Founder-provided `hive-extract/1` | Entire `prompts/hive-extract/HiveForYou-Extract-v1.md` body | Preserve exact wording; notes about internal quote contradictions captured separately. |
| Founder-provided `hive-prep/1` | Entire `prompts/hive-prep/HiveForYou-Prep-v1.md` body | One-pass IEP-specific experiment only. |
| `HiveForYou brand guide.pdf` v1.0 | Name, tone, mark, colors, source chip, state bar, typography | Included unchanged as `brand/HiveForYou-Brand-Guide-v1.0.pdf`. |

## Precedence and update discipline

Explicit new founder decision > approved current V4 documents > approved exact prompt/brand in their respective scope > historical V3 context. Record any conflict for a decision rather than silently fill it in. A document drafted here is **not evidence** of a created GitHub repository, migrated data, installed runtime, passed test, deployed app or active HIPAA coverage. Verify real state with actual tools before statements about implementation.
