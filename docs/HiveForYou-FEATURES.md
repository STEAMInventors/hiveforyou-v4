# HiveForYou V4 — Features and acceptance catalogue

**Version:** 0.1 | **Status:** Proposed; preserving V3 customer behavior, extending presentation with A2UI. Details do not imply implementation.

## Core product vocabulary

**Hive** = private workspace. **Documents** = originals and their page-aware read state. **Study** = one accepted, evolving, evidence-backed knowledge base. **Reports** = one or more independently generated outputs pinned to an accepted Study revision. **Source chip** = an authorization-checked link to the exact original page/context. **A2UI** = validated declarative presentation, not a second fact store.

## Feature inventory

| ID | Screen | Customer-visible behavior | Acceptance |
|---|---|---|---|
| F-001 | Landing | Explain what HiveForYou does; sign in/create account with approved brand | No promise of legal/medical outcome, no invented testimonial/claim |
| F-002 | Auth | Sign up, sign in, sign out, callback/session recovery | PKCE callback where confirmation applies; no leakage of other users' Hives |
| F-003 | My Hives | Show owned Hives, create with name and optional description | Enforce 100/500 char constraints; client request idempotent; route to created Hive |
| F-004 | My Hives | Archive / delete Hive with explicit confirmation | Pre/post Study deletion safeguards and recoverable failures; do not silently hard-delete evidence |
| F-005 | Documents | Upload PDF/PNG/JPEG/DOCX, register with private source metadata | Free 10 successful registered uploads per UTC month; server validates, bad file clearly fails |
| F-006 | Documents | See ordered document list and registration/read states | Duplicates and unreadable pages described accurately, not declared accepted |
| F-007 | Documents | Open exact original document and page | Accessible viewer; physically numbered pages; source authorization checked on each request |
| F-008 | Documents | Inspect document detail, provenance/read coverage | Date, hash/metadata and any source limitations; no raw secrets in UI/logs |
| F-009 | All Hive tabs | Natural-language goal/question input | No mandatory domain question or ontology selection; user can ask before/after upload |
| F-010 | Study | Start/retry processing with honest stage and failure status | An unverified candidate never appears as an accepted Study claim |
| F-011 | Study | See first accepted Canonical Study revision | Empty Hive shows no fabricated Study; one current revision pointer |
| F-012 | Study | Explore entities, record groups, dates, known/unknown conflicts | Source relationships trace to verified IDs, not model confidence alone |
| F-013 | Study | Ask additional questions from the same Study | Reuse accepted facts; approved targeted enrichment if needed; no silent whole-corpus reprocess |
| F-014 | Study | Rich A2UI topic view / timeline / comparison / chart | Model chooses permitted layout, code validates all references, controls are read-only unless explicitly authorized |
| F-015 | Study / Reports | Source chips open physical source page and exact evidence | Wrong owner/invalid fact/page fails closed; return to original context after closing viewer |
| F-016 | Reports | Generate Customer report: simple explanation, questions and uncertainty | All material case statements cited, no legal/medical verdict, plain English |
| F-017 | Reports | Generate Professional-format report: richer evidence/trace | Owner self-service first; pro account sharing is separately approved |
| F-018 | Reports | Saved run history and independent Generate actions | Each click generates new run; prior accepted report survives any later failure |
| F-019 | Study | Accept new documents and incrementally revise same Study | Preserve chronology, conflicts, previous revisions and reports |
| F-020 | Account | Privacy, deletion status and account removal | Retained 30-day recovery decision; no implementation until policy and data lifecycle approved |
| F-021 | Cross-cutting | Distinguish candidate, verified, interpretation, unknown and not reviewed | Displayed states never mislead about completeness or external truth |
| F-022 | Cross-cutting | Professional-caliber accessibility/responsive experience | Keyboard/focus/reader labels, contrast, charts with accessible alternatives |
| F-023 | Cross-cutting | Authorization, privacy and traceable operation status | Private documents, scoped access, sanitized logs, bounded model and DB calls |
| F-024 | Optional future | Reviewed Domain Pack as specialist overlay | Pack never becomes required to use normal Hive or overrides source evidence |

## Main journeys

### First customer

1. Land → register/sign in → create Hive; show meaningful **empty Documents** and **no Study yet**.
2. Upload one or more supported sources; show registered/uploading/failed/unreadable status without false completion.
3. Ask what they want to accomplish (before or after upload). Trigger actual read/extract/verify/Study processing when approved.
4. On acceptance, show a Study overview; source-backed cards/timeline/questions match the intent. Every material case claim has a chip.
5. Generate a Customer report; optionally choose Pro **format** under same owner identity; view pinned history.
6. Ask a different question or add documents; accepted earlier Study/report remain accessible.

### Open evidence

Select a source chip → server validates Hive ownership + cited observation ID + source ID/page → original viewer opens correct physical page with quote location where available → close returns focus. Token restoration, if used, occurs only in an authorized backend path.

### Failure and partial result

Read/AI/verification/persistence/report-stage failure exposes a clear step, safe code and valid retry action. If study acceptance failed, current revision doesn't change. A safe partial answer identifies exactly which page/document/attribute scope remains unreviewed. Never imply absence from a silent omission.

## A2UI component catalogue (proposed allowlist)

- **Foundation:** `NarrativePanel`, `EvidenceList`, `FactTable`, `QuestionList`, `StatusPanel`.
- **After first dynamic vertical slice:** `Timeline`, `ComparisonTable`, `MetricCard`, `Checklist`, `ChartPanel`, `RelatedRecordsPanel`.
- **Interactions:** select source chip, expand section, sort/filter tabular data, choose scoped question, drill to evidence. Generated layout cannot trigger arbitrary mutation, execute code or grant permissions.

Each component must receive validated references to a **pinned** accepted Study or intent analysis; unsupported data/key → reject component or render a safe explanatory fallback. An A2UI generated claim is not itself a verified assertion.

## Acceptance examples (all synthetic)

- **Receipt:** five line-item rows don't collapse; taxes/discounts preserve numeric association and store/date; purchases ≠ consumption. Questions about categories versus stores produce distinct A2UI without replacing Study.
- **IEP:** evaluation need is not an automatic plan match unless plan names the same practice; all goals retain target, mastery criterion, baseline and frequency when source supports. “Worth asking” rather than an unsupported legal verdict.
- **Financial:** balances, creditor, as-of date and ownership stay associated, differences/conflicts explicitly displayed; no guessed legal outcome.
- **Negative:** model hallucinates quote, page empty/unclear, repeated uploads, injection attempt, request to other owner's page, timeout mid-run, writer failure after success: appropriate error and prior accepted state unchanged.

**Source:** `HiveForYou-PRODUCT-REQUIREMENTS.md` is authoritative for requirements IDs; `HiveForYou-UX-A2UI-DESIGN.md` for detailed screens; `HiveForYou-NEXT.md` for order. Do not implement all features in the first ticket.
