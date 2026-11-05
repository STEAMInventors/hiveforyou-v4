# HiveForYou V4 — Features and acceptance catalogue

**Version:** 0.3 | **Date:** 2026-10-31 | **Status:** Proposed; R01–R44 retained, R45–R64 intelligence-to-work expansion proposed, not implemented.

## Core product vocabulary

**Hive** = private workspace. **Documents** = originals and their page-aware read state. **Study** = one accepted, evolving, evidence-backed knowledge base. **Reports** = one or more independently generated outputs pinned to an accepted Study revision. **Source chip** = an authorization-checked link to the exact original page/context. **A2UI** = validated declarative presentation, not a second fact store.

## Feature inventory

| ID | Screen | Customer-visible behavior | Acceptance |
|---|---|---|---|
| F-001 | Landing | Explain what HiveForYou does; sign in/create account with approved brand | No promise of legal/medical outcome, no invented testimonial/claim |
| F-002 | Auth | Sign up, sign in, sign out, callback/session recovery | PKCE callback where confirmation applies; no leakage of other users' Hives |
| F-003 | My Hives / Landing | Show owned Hives; create from one shared composer with **written intent** and **≥1 supported document**; Hive name is provisional, taken from the intent (D-037) | Provisional name ≤100 chars, intent 1–2000 chars, D-026/D-037; idempotent client requests; route after at least one registered upload in create flow |
| F-004 | My Hives | Archive / delete Hive with explicit confirmation | Pre/post Study deletion safeguards and recoverable failures; do not silently hard-delete evidence |
| F-005 | Documents | Upload PDF/PNG/JPEG/DOCX, register with private source metadata (D-027 prepare/register + hash scan) | Free 10 successful registered uploads per UTC month; server validates type/size/malware; bad file clearly fails |
| F-006 | Documents | See ordered document list and registration/read states | Registration/uploading/failed/rejected shown honestly; **read_status beyond PENDING shown only from verified Read Documents attempts (D-038)** |
| F-007 | Documents | Open exact original document and page | **Deferred past current V4-003 slice.** Accessible viewer; physically numbered pages; source authorization checked on each request |
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
| F-025 | Documents | Owner **Rebuild Study** (D-049): a new accepted revision from pages and intent already saved | Analyze still reuses a compatible revision and can write missing reports. Rebuild does not upload, re-read, or regenerate reports. Same request replays; a second rebuild while one is active does not start another. Acceptance needs a document inventory and atomic findings. Prior revisions and reports remain, with a link to the new revision and its source and finding counts |
| F-020 | Account | Privacy, deletion status and account removal | Retained 30-day recovery decision; no implementation until policy and data lifecycle approved |
| F-021 | Cross-cutting | Distinguish candidate, verified, interpretation, unknown and not reviewed | Displayed states never mislead about completeness or external truth |
| F-022 | Cross-cutting | Professional-caliber accessibility/responsive experience | Keyboard/focus/reader labels, contrast, charts with accessible alternatives |
| F-023 | Cross-cutting | Authorization, privacy and traceable operation status | Private documents, scoped access, sanitized logs, bounded model and DB calls |
| F-024 | Optional future | Reviewed Domain Pack as specialist overlay | Pack never becomes required to use normal Hive or overrides source evidence |

## Main journeys

### First customer

1. Land → describe intent and attach document(s) → register/sign in → name Hive and complete create with intent + upload; show **Documents** with registration status and **no Study yet**.
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


---

## Intelligence-to-work feature expansion (proposed, maps to PRD R45–R64)

These features enhance **Study** and **Reports** inside the stable three-tab shell; they do not add a mandatory Work tab or a separate case truth database.

| Feature | Customer-visible functionality | Requirements | Priority |
|---|---|---|---|
| **F-025** | Describe the job to complete and desired output in plain language | R45 | P0 |
| **F-026** | Preview goal, deliverable, evidence scope and definition of done; distinguish suggestions from authoritative criteria | R46 | P0 |
| **F-027** | View goal-specific work plan, task order/dependencies, human vs machine ownership | R47 | P0 |
| **F-028** | See actual task progress and blocked/failure states, not AI-estimated completion | R48, R59 | P0 |
| **F-029** | Open document inventory, source coverage by date/type and unreadable/duplicate flags | R49 | P0 |
| **F-030** | Compare related records across documents and inspect matched/unresolved conflicting details | R50 | P0 |
| **F-031** | Run verified totals, groupings, date comparisons and related deterministic operations | R51 | P0 |
| **F-032** | View actionable missing/conflicting/unsupported evidence register, with traceable next action | R52 | P0 |
| **F-033** | Generate a review-ready work product (not just a narrative report) with methods, caveats and source index | R53, R63 | P0 |
| **F-034** | Human-review tasks and annotate/accept/reject proposed matches or results with trace | R54 | P1 |
| **F-035** | Add new files and refresh only impacted work, preserving older snapshots/results | R55 | P1 |
| **F-036** | Draft tailored missing-document requests for user editing; never silently send | R56 | P1 |
| **F-037** | Download authorized review packet with evidence manifest and revision provenance | R57 | P1 |
| **F-038** | Choose/reuse reviewed workflow recipes with explicit completion criteria; no mandatory domain pack | R58 | P1 |
| **F-039** | Inspect task failures, methods and safe retry/history independently from Study/report revisions | R59 | P0 |
| **F-040** | See measurable processing/review metrics where available, with estimates clearly labeled | R60 | P1 |
| **F-041** | Future approved connector-assisted requests/hand-offs with user confirmation and audit | R61 | Future |
| **F-042** | Dynamic evidence-bound progress, task, gap and work-product components in Study/Reports | R62 | P0 |
| **F-043** | Clear `DRAFT` / `PARTIAL` / `READY_FOR_REVIEW` / `REVIEWED` labels, never unsupported submission readiness | R63 | P0 |
| **F-044** | Pilot evaluation measures user steps eliminated, effort, accuracy, cost and willingness to pay | R64 | P0 |

### Example first wedge: financial document preflight (illustrative only)

1. Customer asks: “Prepare a five-year financial record for review.” The app captures the actual requested dates and purpose, not a presumptive eligibility judgment.
2. User uploads statements and supporting materials; Hive inventories accounts, statement coverage and read quality, and resolves known account references.
3. Hive groups transactions, checks missing periods, proposes matches for transfers/supporting records and calculates only validated totals.
4. A live exception register lists unsupported transfers, missing periods and conflicting account details, each with citation and suggested follow-up.
5. Reports contains a **financial preflight packet**: account inventory, coverage matrix, transaction exceptions, evidence index, calculation methods, unresolved caveats and reviewer questions. Output is `READY_FOR_REVIEW`, not application-approved or compliance-certified.

### First-slice acceptance tests

- Given two synthetic statement sets with overlapping periods, identify overlap without double-counting or suppressing original evidence.
- Given a transaction amount appearing in an unrelated row, do not verify a false record match merely because the figure appears on the page.
- Given unreviewed months, label coverage unknown instead of asserting statements are missing.
- Given an uploaded supplemental document, update impacted work while preserving the previous accepted revision and report.
- Given a failed calculation or invalid model work plan, do not mark a task complete or produce a `READY_FOR_REVIEW` output.
- Given unresolved exceptions, produce a useful `PARTIAL` packet and an explicit review queue.
- Given a proposed external request, produce a user-editable draft only; no message is sent.

**Implementation note:** P0/P1 here indicate product value and proposed priority, not permission to alter the current **V4-003** engineering ticket. Preserve existing V4 UX, provenance, privacy, and no-source-no-claim restrictions.

## Analytical Discovery and Scenario Intelligence (F-045–F-064) — proposed 2026-10-31

**Product contract:** After an accepted Study revision, Hive proactively discovers and qualifies useful analyses, executes only supported methods, and offers optional what-if exploration. These features map to PRD **R65–R84**; all outcomes stay separate from Canonical Study evidence and preserve Documents · Study · Reports navigation.

| Feature | Product behavior | Evidence of acceptance | PRD |
|---|---|---|---|
| **F-045** | Auto-discovery trigger | One bounded run pinned to newly accepted Study revision | R65 |
| **F-046** | Opportunity generation | LLM proposes analysis kinds, value, required facts and gaps | R66 |
| **F-047** | Relevance filter | Prioritized, deduplicated, useful opportunities; irrelevant ones suppressed | R67 |
| **F-048** | Inspectable analysis plan | Typed inputs, dependencies, method, output and unresolved assumptions | R68 |
| **F-049** | Tool-aware engine routing | Arithmetic, reconciliation, qualitative reasoning, rules or solver selected appropriately | R69 |
| **F-050** | Independent analysis checks | Verified IDs, type/unit/period/rule and method; explicit reason on failure | R70 |
| **F-051** | Suggested analyses / insights UI | Evidence chips, findings, uncertainty and next actions in Study | R71 |
| **F-052** | Coverage and limitations | Reviewed vs not reviewed, unknown vs absent, incomplete scope | R72 |
| **F-053** | Incremental refresh | Affected analyses re-evaluated; older results preserved and clearly dated | R73 |
| **F-054** | Ask a what-if | Conversational assumption changes from the current Study | R74 |
| **F-055** | Scenario overlay | Hypotheticals isolated from immutable accepted source facts | R75 |
| **F-056** | Model-generated dependency map | Inspect assumptions, rules, variables, links and unknowns | R76 |
| **F-057** | Scenario validation | Reject unresolved unsupported links/unsafe formulas and misleading rule use | R77 |
| **F-058** | Scenario evaluator | Deterministic numerical evaluation; optional solver only for suitable cases | R78 |
| **F-059** | Scenario comparison view | Baseline, alternatives, deltas, tradeoffs and provenance | R79 |
| **F-060** | Suggested what-if questions | Curated conditional questions, not predictions or prescriptive advice | R80 |
| **F-061** | Pinned history | Analysis/scenario runs with version, inputs and status; failed run preserves success | R81 |
| **F-062** | High-impact trust cues | Facts, hypotheticals, rules, computation and professional review visibly distinct | R82 |
| **F-063** | Tested analytical recipes | Reusable only after verification and review, with no private cross-Hive training | R83 |
| **F-064** | Quality/cost instrumentation | Measure usefulness, validity, safety, reproducibility and processing cost | R84 |

### New primary journey — proactive analysis

Upload → evidence independently verified → accepted Study revision → bounded opportunity discovery → useful analysis cards in **Study** → user opens grounded result → considers optional action or report. The user need not first invent a good question. Do not display an unexecuted proposal as a completed insight.

### New secondary journey — scenario explorer

Open a finding or ask "What if …?" → review explicit hypothetical overlay → inspect LLM-proposed dependencies and any rule-source limitations → execute validated method → compare baseline and alternatives → optionally save a scenario-bound report. Scenario assumptions are never stored as source facts.

### Prototype demonstration (synthetic)

- Financial: Hive independently suggests debt composition, missing statements and balance reconciliation; a what-if adjustment affects a computed comparison but not recorded balances.
- IEP: Hive suggests evaluation-versus-plan comparison; alternative service schedules are modeled as possibilities, **not** predicted learning outcomes.
- Bankruptcy: Hive suggests Chapter 7/11 review questions, surfaces debtor/asset/rule gaps and labels every legal conclusion conditional.
- Negative: invented rule, wrong units, circular dependency, partial corpus, unauthorized references and model-generated code are blocked with understandable explanations.
