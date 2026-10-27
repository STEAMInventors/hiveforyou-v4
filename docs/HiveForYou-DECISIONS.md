# HiveForYou V4 — Decision register

**Version:** 0.1 | **Date:** 2026-10-26 | **Status:** V4 proposal; records stated founder choices and unresolved design decisions. Not an implementation claim.

Use three states: **DECIDED** = explicit founder direction or retained approved product behavior; **PROPOSED** = working architecture recommendation; **OPEN** = requires explicit choice before implementation.

| ID | State | Decision / constraint | Source and implications |
|---|---|---|---|
| D-001 | DECIDED | Start a new `hiveforyou-v4` repository; leave V3 intact as reference. | Founder, 2026-10-26. No V3 migration or source rewrite assumed. |
| D-002 | DECIDED | Preserve V3 product features unless an explicit change is approved. | V3 requirements R01–R36 and retained MD/OD decisions. |
| D-003 | DECIDED | Application-first **Documents · Study · Reports** UI with rich, contained A2UI enhancements; fixed navigation/actions. | Founder V4 UX choice B. |
| D-004 | DECIDED | Pack-free document fact extraction by default; optional Domain Packs are specialist overlays, not a dependency. | Founder V4 extraction direction. |
| D-005 | DECIDED | `hive-extract/1` is the user-provided authoritative extraction prompt; output label `hive.doc-extraction/1`. | Prompt text in `prompts/hive-extract/HiveForYou-Extract-v1.md`; model outputs are candidates. |
| D-006 | DECIDED | `hive-prep/1` is the user-provided one-pass **IEP meeting prep** prompt for outside-pipeline testing; Markdown output, not canonical truth. | `prompts/hive-prep/HiveForYou-Prep-v1.md`. |
| D-007 | DECIDED | One Hive, one evolving Canonical Study; different intents and report runs do not overwrite the underlying accepted knowledge. | V3 retained product contract. |
| D-008 | DECIDED | No new configuration variables/feature flags merely to enable ordinary functionality; prefer sensible defaults. | Founder, 2026-10-26. Necessary secrets for new V4 deployment require later explicit design. |
| D-009 | DECIDED | Brand guide v1.0 stays unchanged; no brand redesign. | `docs/brand/HiveForYou-Brand-Guide-v1.0.pdf`. |
| D-010 | DECIDED | Every document filename in V4 begins `HiveForYou-` (including prompts, `.mdc`, PDFs, root overview and ticket file). Executable code names and contract IDs are unaffected. | `docs/HiveForYou-NAMING-CONVENTIONS.md`; names and links synchronized across this package. |
| D-010 | DECIDED | V4 is development, **not** production. Use focused tests and recoverable behavior; don't start release hardening or legacy-run archaeology without a reason. | Founder, 2026-10-26. |
| D-011 | DECIDED | No source, no claim; source chips open physical page; independently check extraction before accepted Study/report claims. | Brand + V3 R07/R15/R20. |
| D-012 | DECIDED | Owner-only initial access, Free 10 registered uploads per UTC month, PDF/PNG/JPG/DOCX, versioned history, account deletion retention decision are carried over pending explicit revision. | V3 MD/OD decisions; see PRD. |
| D-013 | PROPOSED | Next.js/React on Vercel, Supabase Auth/DB/private Storage and portable TypeScript backend libraries. | No new infrastructure provisioned. |
| D-014 | PROPOSED | PostgreSQL application schema `hive` (not `hive4`); only add tables as tickets need them. | Naming convention; distinct V4 project/credentials to avoid V3 data collision. |
| D-015 | PROPOSED | One server-side frontier-model adapter; keep runtime-specific provider configuration centralized, without per-feature switches. | Model provider, gateway and BAA are still OPEN. |
| D-016 | OPEN | Durable execution for large documents: within supported Vercel limits, or external job executor; no assumption that long-running functions always finish. | Architecture gate before large batch processing. |
| D-017 | OPEN | Provider/model/gateway identity, supported structured output, model use/retention policy, costs, contracts and data-sharing consent. | Synthetic tests may be approved separately. |
| D-018 | OPEN | Whether, when and how reversible tokenization applies; secure token vault, protected metadata, original quote proof and restore path. | Must be resolved before any real sensitive documents. |
| D-019 | OPEN | A2UI protocol and allowlisted component schema/version; no arbitrary model HTML/JS. | Approve during the dynamic UX ticket. |
| D-020 | OPEN | Cross-user professional sharing, corrections, export formats and billing tiers. | Do not implement owner bypasses or charges by assumption. |
| D-021 | OPEN | V4 migration of existing V3 accounts/Hives; defaults to **no migration**, not silent copy. | Explicit project and data migration approval. |
| D-022 | OPEN | Final JSON contract clarifications around table quotes, `general_knowledge` glossary, and empty-page / page-range behavior. | Preserve exact `hive-extract/1` wording until amendment approved. |
| D-023 | DECIDED | The application shell uses one public error object, `x-correlation-id`, and allowlisted structured logs. No observability vendor, diagnostic environment variable, or fail-only public route. | V4-001. Unexpected failures are `INTERNAL_ERROR`. `cause` stays in-process and is omitted from JSON. |

**Change process:** If a decision changes, update this register and the affected PRD, architecture, plan, NEXT, rules, and prompt/contract spec in the same approved ticket. Preserve history; never quietly reinterpret founder wording.
