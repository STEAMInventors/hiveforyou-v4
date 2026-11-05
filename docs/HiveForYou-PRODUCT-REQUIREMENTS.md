# HiveForYou V4 — Product requirements

**Version:** 0.4 | **Date:** 2026-11-01 | **Status:** Product strategy expansion proposed for founder approval; existing R01–R84 and previously approved decisions retained; **R85** (V3 LiteLLM reuse) documented. No implementation authorization.

**Mission:** One Hive holds a person's documents and one continuously enriched, evidence-backed Canonical Study; the user can ask different questions and receive useful, customized, trustworthy outputs. **The complicated, made simple.**

**V4 founder choices:** new independent repo; retain V3 product behavior; stable application-first **Documents · Study · Reports** UI with contextual declarative A2UI; pack-free `hive-extract/1` by default; no proliferation of config variables; V4 is actively being developed, not in production. `hive-prep/1` is a standalone IEP one-pass test, not the persisted canonical pipeline.

## User groups and primary journeys

- **Customer:** sign in → create/open Hive → upload material → describe goal → understand current accepted findings with linked evidence → ask another question or add documents → review reports.
- **Professional format:** owner can generate a denser, scope-specific report from the same accepted Study; granting professionals cross-user access is separately gated.
- **Support/operator:** discover failure stage/code and safe retry outcome without private source content.

**Trust terms:** *source* is uploaded original; *candidate* is a model extraction; *verified observation* is a check that the document **says** something (not that the world agrees); *Study revision* is the accepted reconciled state; *intent analysis* answers one question against a pinned revision; *A2UI view/report* is presentation, never authoritative evidence.

## Preserved V3 requirements (R01–R36)

The IDs and capabilities below are retained for traceability. Only infrastructure-specific wording and new intent-independent discovery semantics have been adapted for V4; no prior source code is represented as already ported.

| ID | Capability | V4 acceptance behavior |
|---|---|---|
| **R01** | Create and isolate Hives | Signed-in owner can create/list independent Hives; owner authorization, RLS and server checks prevent cross-Hive/tenant reads. |
| **R02** | Upload supported documents | PDF, PNG, JPG/JPEG and DOCX registered to a Hive under approved policy; multiple documents supported; quality, format errors and incomplete reads surfaced. |
| **R03** | Intent-first experience | Accept verbatim, open-ended questions such as “What should I do?”; ask focused follow-up questions only when missing information blocks a responsible useful answer; no compulsory domain interview. |
| **R04** | Intelligent discovery | Identify meaningful source/document boundaries and kinds without requiring a domain; classification is proposed and uncertain cases are visible. |
| **R05** | Intent-independent dynamic fact discovery | `hive-extract/1` discovers reusable source observations without domain, Pack, predefined field catalog or required user intent. Later questions reuse accepted knowledge; no false completeness claims. |
| **R06** | Bounded processing with explicit progress | Read, extract, independently verify, merge and analyze with explicit scope, bounded capacity, honest errors and recoverable processing; not dependent on a named orchestrator. |
| **R07** | Evidence-backed information | Each document-derived observation retains Hive/source/hash, page or equivalent position, quote/anchor, claimant/date, extraction/run lineage and verification status. Human statements, calculations and outside rules are distinguished from observations. |
| **R08** | Single evolving Canonical Study | Every Hive has at most one logical Study/current accepted revision, enriched across multiple documents and intents; per-intent summaries are separate pinned results. |
| **R09** | Incremental updates | New eligible sources enrich the same Study; prior accepted sources/revisions/analyses remain inspectable according to retention policy. A new Hive remains separate. |
| **R10** | Reuse before re-extraction | Later intents reuse accepted facts and coverage first; if material information is unextracted, retrieve targeted authorized page context and extract only what is needed where feasible. Missing field ≠ fact absent. |
| **R11** | Multiple intents | Distinct and follow-up questions can use the same Study without creating incompatible truth stores, independently of output audience. |
| **R12** | Customer result | Clear plain-language interpretation, supported numbers, relevant tables/charts/questions and meaningful uncertainty; every material factual claim traceable. |
| **R13** | Professionally configurable output | Authorized professional selects purpose, scope, questions, emphasis and permitted layout and gets richer evidence-led presentation from the **same snapshot**; cannot modify evidence through report prompts. |
| **R14** | Study/result history | Store immutable accepted Study revisions and independently generated analysis/output runs; each report identifies source snapshot and remains accessible if a later run fails. |
| **R15** | No unsupported claims | Invented source facts and unsupported certainty are prohibited. Model interpretation, deterministic derivation, user assertion, external rule and `unknown` have distinct status; receipt purchases never assert consumption. |
| **R16** | Optional Domain Packs | No required Pack, schema or hardcoded domain branching for IEP/grocery/synthetic-finance MVP tests; selected reviewed packs may remain optional and never bypass independent evidence verification. |
| **R17** | Reconcile without erasure | Duplicate/revised/conflicting source claims, temporal changes and historical observations remain distinguishable; never automatically assume the newest file wins. |
| **R18** | Attributed corrections | Authorized corrections to interpretations, classification or reconciliation preserve original evidence, prior value, correction actor/time and review status; exact permission model is separately gated. |
| **R19** | Page-aware source preparation | Provide reliable PDF native/OCR, image and DOCX text with physical page/visual anchors, hashes and quality. Reader is a *logical boundary*, not a mandated Python service. |
| **R20** | Independently verify proposed observations | Accepted fact records can be supported using stored source/read artifacts **independent of extract-time assertions**. Assign `VERIFIED`, `UNRESOLVED`, or `REJECTED` with stable reason codes; page/quote match alone is not proof of correct value association. |
| **R21** | Document/attribute coverage | Record which source/page/attribute scopes were reviewed, skipped, unreadable or deferred. A negative “not found” conclusion is limited to explicitly reviewed scope; distinguish unknown/unreadable/not-applicable/not-yet-reviewed. |
| **R22** | Model-driven semantic synthesis | Frontier model may propose entity matching, chronology, amendments, relationships, patterns, conflicts and gaps **from verified observations**. Trusted code checks IDs, subject, modality, dates, units and source/coverage before acceptance; uncertain links remain unresolved. |
| **R23** | Structured reusable knowledge | Retain record grouping (e.g. IEP goal/service rows, receipt line items, debt instruments), typed values, quantities/units, periods, claimant and fact-level provenance; avoid flattening away meaning. |
| **R24** | Independent intent analysis | Generate a versioned analysis over a pinned Study revision; cover significant subquestions, label partial/blocked answers, cite verified fact/finding IDs and avoid ungrounded causal or legal conclusions. |
| **R25** | Safe derived computation | Financial totals, trends and comparisons use validated deterministic arithmetic where available; inputs, normalization, units, scope, method and version traceable. Model's unsupported arithmetic is not accepted as a trusted numeric result. |
| **R26** | Declarative A2UI composition | Fixed Documents/Study/Reports shell; model may propose only validated, allowlisted, evidence-bound dynamic sections from an accepted analysis. No executable HTML/JS/SQL or arbitrary actions. |
| **R27** | Universal output components | Use branded narrative, metric, table, comparison, timeline, checklist, question, chart and evidence components with accessible equivalents and verified source-chip binding. |
| **R28** | Independent Generate actions | Each deliberate Generate click starts its own `reportRunId`. Retries within that run are idempotent; new requests never get silently de-duplicated and accepted reports survive failures. |
| **R29** | Audience and security isolation | Data retrieval, fact display, source-chip deep links, charts and exports enforce owner/member permissions server-side; UI specs and user/model IDs are not authorization. |
| **R30** | High-impact advice safety | Financial, bankruptcy, legal, eligibility and similarly consequential answers must clearly separate verified information, possible options, assumptions, missing evidence and issues for qualified professional review. Unsupported mandatory directives or guarantees are not allowed. |
| **R31** | Explainable incompleteness | Show useful partial answers where safe; explicitly indicate missing material, unreadable sections, unsupported capabilities, conflicting claims and needed follow-up, not fabricated completeness. |
| **R32** | Multimodal follow-up | From accepted facts, the model may request only authorized, selected original page/visual content to resolve context; returned proposals must pass the same verifier and budget gates. No default whole-corpus resend on every question. |
| **R33** | Operational recoverability | User can see honest status, actionable failure/retry options and accepted prior results. Support can identify stage, cause, commit/uncertainty and whether retry is safe without reproducing customer data. |
| **R34** | Controlled provider/model access | No direct model calls from browser. Server calls use one domain-agnostic, approved provider/gateway adapter with permitted retention/contract/consent. Prefer reuse of V3 LiteLLM infrastructure per **R85**; do not introduce parallel gateways, provider-specific business logic in application layers, or unnecessary configuration variables. |
| **R35** | Working V4 end-to-end acceptance | Fresh browser → private source → model candidate → independent verification → accepted Study → A2UI/report with working page chip; test real workflow and negative paths using synthetic data, not historical V3 runs. |
| **R36** | Intent changes do not overwrite observations | Different questions may produce different analyses and layouts, but do not silently alter existing observations/accepted assertions or omit material supported findings without disclosed scope. |

## V4 experience requirements (R37–R44)

| ID | Requirement | Acceptance behavior |
|---|---|---|
| **R37** | Stable application-first navigation | Documents, Study, Reports remain fixed and usable without AI-generated UI; A2UI cannot create routes or change navigation. |
| **R38** | Dynamic evidence-bound workspace | User intent changes composition of allowed cards/tables/timelines/questions but never changes facts or bypasses authorization. |
| **R39** | Honest empty/error/partial states | Empty Hive ≠ empty Study ≠ missing source; show accurate upload/read/extract/verify/study/report progress; distinguish partial and blocked. |
| **R40** | Source chip interaction | Every material case claim links to accessible owner-authorized source document, physical page and relevant verbatim evidence context; invalid link never silently opens unrelated file. |
| **R41** | A2UI schema validation and fallback | Reject invalid component IDs, props, references, actions, URLs and unbound claims; show safe static fallback rather than generated code. |
| **R42** | Rich interaction with grounded data | Sorting, filtering, compare views, charts, disclosures and questions operate on a pinned authorized data set and cannot mutate Study through UI layout. |
| **R43** | Brand-consistent accessibility | Honor approved color semantics, source chips, typography, accessible keyboard/focus, screen reader labels and non-color status meanings. |
| **R44** | Privacy-aware source inspection | Document viewer and token/identity restoration are authorization-gated; model output/telemetry never exposes protected originals or secret keys. |

## Retained approved product policies

- **Owner-only initial access.** Cross-user professional invitation, collaboration, sharing and attributed corrections require separate policy and SQL approvals.
- **Create Hive:** the owner does not type a name; a provisional name (at most **100 characters**) is taken from the written intent and may be renamed later (D-037); description optional at the API, at most **500 characters**, not asked for in the primary UX; each intended creation gets a distinct client request UUID and repeated submission is idempotent. **Primary UX (D-026):** written intent (1–2000 characters) and at least one supported document in the same flow; intent is persisted write-once per request. A new Hive has no accepted Study until the first verified acceptance.
- **Supported initial uploads:** PDF, PNG, JPG/JPEG, DOCX; file size limits are approved when coded, not invented here. A successful upload is private storage registration plus source metadata, not proof of successful extraction.
- **Free uploads:** **2000 successful registered uploads per UTC calendar month across owner Hives** (D-012 amended 2026-11-05 for development). Server-side enforcement and honest quota UI. Billing above that threshold not specified.
- **Full Study:** account for **all eligible documents** in its declared scope; targeted enrichment must explicitly label source/page/attribute scope. Unreadable/missing is not equivalent to absent facts.
- **Retention/deletion:** owner Hive archive and deletion distinct; account deletion has retained **30-day recoverable window** then permanent deletion/cleanup and audit, but implementation is a separately gated feature. Prior accepted Study and report revisions survive a *failed generation*; deletion follows approved retention rules.
- **Trusted boundaries:** original documents and source quotes are private, owner-bound; no browser-side model key; source text is untrusted instructions; source evidence and review statuses are independent of model formatting confidence.

## End-to-end acceptance scenarios (synthetic only in development)

1. **New Hive, one receipt:** sign in; start a Hive with written intent and upload a synthetic receipt in the create flow (D-026); after registration (D-027), frontier extraction produces `hive.doc-extraction/1` candidate facts and evidence; independent verification accepts/rejects with reasons; first accepted Study revision appears; citation opens exact page.
2. **Repeat questions, one Study:** questions about purchases, comparisons, and missing item attributes lead to different A2UI output regions/report layouts pinned to same Study revision; no re-reading unchanged pages merely for a new presentation.
3. **Incremental grocery:** add ten receipts to twenty, produce next revision preserving former information and histories; purchase is **not** assumed to mean consumption; unknown organic classification stays unknown.
4. **Synthetic IEP L001 eight-document case:** document chronology, goals/services, evaluations, conflicts and gaps retain exact source provenance; customer and professional output share accepted study; no legal verdicts or invented needs.
5. **Synthetic finance/bankruptcy/Medicaid case:** record/amount/date/claimant association preserved, contradictory figures displayed honestly, no eligibility or legal outcome guarantee.
6. **Adversarial/negative:** wrong owner, bad MIME, unreadable scan, bad quote, injection text, wrong record association, schema-invalid model JSON, partial pages, provider timeout, persistence interruption and failed view composition do not advance trusted Study or erase accepted reports.

## Explicit exclusions and open gates

- No automatic cross-user professional access, autonomous legal/financial action, arbitrary-generated program execution, mandatory Domain Packs, domain-specific UI app implementations, or cross-Hive private learning.
- Runtime topology (Vercel function duration vs durable job executor), provider/gateway, regulated-data agreements, reversible tokenization, sharing/exports/billing and final A2UI wire protocol remain open in `HiveForYou-DECISIONS.md`.
- **Compliance cannot be inferred** from use of Supabase, Vercel, tokenization or an external model; operate on synthetic documents until data-use approvals and safeguards are settled.
- Prior V3 routing through **Oracle LiteLLM** is the **preferred** V4 gateway path when inventory and compatibility checks pass (**R85**). That reuse is infrastructure strategy, not a substitute for V4's single domain-agnostic server-side model boundary, authorization, provenance, or verification gates.

**Related authority:** `HiveForYou-FEATURES.md` for screen behavior; `HiveForYou-UX-A2UI-DESIGN.md` for UI; `HiveForYou-ARCHITECTURE.md` for data flow; `HiveForYou-PROMPTS-AND-CONTRACTS.md` and `prompts/` for exact AI inputs; `HiveForYou-NEXT.md` for the only active engineering ticket.


---

## V4 product expansion: intelligence to completed work (R45–R64) — proposed 2026-10-30

### Positioning and design contract

**Product promise:** *Give Hive the paperwork. Get the work done.* Hive transforms unstructured document collections into **review-ready, evidence-linked work products**, not just summaries or chat answers. This is a proposed positioning test, not a replacement for the approved brand slogan, *The complicated, made simple.*

**Value model:** LLMs propose document meaning, intent, relationships, work plans, and explanations. Deterministic software owns validation, calculations, state, workflow execution, and permissions. A human approves consequential findings, changes, and external actions. A generated plan is not proof that its tasks were performed.

**Product structure:** Retain the fixed **Documents · Study · Reports** navigation and one evolving Canonical Study. Introduce **Work Plan**, **Work Item**, **Work Result**, and **Deliverable** as logical outcome-specific records/artifacts *only when actually required by an approved implementation*. They are not a second fact store, domain-specific application fork, additional mandatory navigation tab, or authorization bypass. The Work Plan is displayed contextually within Study; reviewable deliverables and history live under Reports.

**Scope discipline:** The first product wedge and supported work recipes are *not yet selected*. Demonstrations for Medicaid financial preflight, IEP meeting prep, and financial/contract reconciliation are illustrative, not launched offers or claims of regulated readiness. Domain-free intake stays available; optional reviewed domain rulebooks can define specialist requirements without embedding domain branching in Core. A universal autonomously executing agent is not part of MVP.

### New requirements

| ID | Capability | Acceptance behavior | Priority |
|---|---|---|---|
| **R45** | Outcome-first goal capture | Capture the user's desired *deliverable* and intended use in natural language, before or after upload; preserve their original words and optionally clarify only materially ambiguous objectives. No required domain selector. | P0 |
| **R46** | Work-product definition | Propose a structured, inspectable definition of done: expected artifact, coverage/scope, inputs, review needs and blocking unknowns. Distinguish model-suggested criteria from authoritative external requirements. | P0 |
| **R47** | Goal-specific work plan | Produce an ordered, versioned set of evidence-linked work items from an accepted Study and pinned goal; each has a type, rationale, dependencies, source scope and machine/human ownership. No fabricated completion. | P0 |
| **R48** | Work-item lifecycle | Support `PROPOSED`, `READY`, `RUNNING`, `BLOCKED`, `NEEDS_REVIEW`, `COMPLETED`, `FAILED`, `SKIPPED`; status derives from actual operation/review results, with timestamps, attempts and reason codes. | P0 |
| **R49** | Document inventory and coverage matrix | Inventory sources by inferred role, subject and period; show verified overlaps, duplicates, unreadable periods and *scoped* absences. Do not infer a missing month/account from an unreviewed corpus. | P0 |
| **R50** | Cross-document reconciliation | Match supported identities, dates, record rows, values and versions; preserve competing assertions and propose match candidates separately from verified matches. Unresolved conflicts generate review items. | P0 |
| **R51** | Deterministic task execution | Perform reusable trusted operations—sort, group, compare, calculate, check coverage, detect duplicates—using typed, validated inputs. Never treat a model-calculated figure as an accepted result without independent method/input validation. | P0 |
| **R52** | Exception and gap register | Create actionable exception records (missing, conflicting, unexplained, unreadable, insufficient support) with reason, exact source/coverage context, severity based on explicit criteria, and a clear next step. No invented legal/compliance breaches. | P0 |
| **R53** | Evidence-bound deliverable builder | Assemble a purpose-specific review-ready output (e.g., inventory, chronology, comparison, reconciliation, meeting brief or case packet) with scope, revision, method, status and source links. Incomplete work must be labeled. | P0 |
| **R54** | Human review and sign-off | Present machine results, uncertain associations and exception resolutions for owner review. Record accept/reject/annotate decisions with actor/time/rationale, without changing original evidence or granting professional access. | P1 |
| **R55** | Work plan refresh after new evidence | When new documents create an accepted Study revision, recompute affected work only, retain the prior plan/result history and surface why an item changed; do not silently mark previously blocked work complete. | P1 |
| **R56** | Missing-document request drafting | Generate a precise, editable request identifying the required document, period, subject, reason and supporting evidence/criteria; user decides whether and where to send it. No automatic outbound contact. | P1 |
| **R57** | Export and handoff packaging | Produce authorized, stable exports of deliverables and supporting evidence index, with manifest, revision, exceptions, and provenance; redaction/access policy and formats require separate approval. | P1 |
| **R58** | Repeatable work recipes | Parameterize reusable sequences of generic operators, review gates and deliverable compositions. Recipe version and originating criteria are explicit; specialist overlays are optional and cannot declare compliance without verified rule authority. | P1 |
| **R59** | Task-level audit and recoverability | Each work operation has immutable input references, processor/method version, output, state/error and retry identity; failures do not corrupt accepted Study, prior work or reports. | P0 |
| **R60** | Cost and time-to-value instrumentation | With appropriate privacy safeguards, record processing cost, work completion time, task counts, human interventions and optionally user-provided baseline time. Never present estimated savings as measured results. | P1 |
| **R61** | Safe external actions and connectors | Future outbound email, document requests, third-party writes or submissions require a separately approved integration, least-privilege authorization, explicit user confirmation and auditable status; MVP is draft-only. | Future |
| **R62** | Goal-specific dynamic application view | Within existing Study/Reports slots, render allowed progress, exception, task, evidence and deliverable components tailored to the goal; server validates schema and references, and provides a usable non-AI fallback. | P0 |
| **R63** | No unsupported readiness claim | Display distinct states such as `DRAFT`, `PARTIAL`, `READY_FOR_REVIEW`, and `REVIEWED`; never call an output submission-ready, legally sufficient, complete or approved without defined checks and authorized human decision. | P0 |
| **R64** | Workflow evaluation against manual alternative | For each market wedge, test real or synthetic representative files and document baseline human steps, verified accuracy, exceptions caught, minutes to review-ready output, and total variable cost. Market launch only after measurable willingness-to-pay validation. | P0 |

### Initial reusable operator catalogue (implementation candidates, not new model engines)

- **Inventory and coverage:** fingerprint, classify, group, period coverage, detect overlaps/duplicates and cited referenced documents.
- **Reconcile and compute:** subject/entity alignment proposals, record matching, before/after differences, totals and typed unit-safe arithmetic.
- **Exceptions:** contradictions, missing support, out-of-scope material, unreadable sections and unresolved association queues.
- **Prepare:** source-linked chronology, evidence matrix, checklist, request draft, formatted review packet and manifest.
- **Review:** accept/reject an interpretation or task result with attribution; no change to originals or trust dispositions through presentation commands.

### Product-first release sequence (not a change to the active engineering ticket)

| Release slice | Demonstrable outcome | Exit criterion |
|---|---|---|
| **W0 — Find paying workflow** | Interview ~10 reachable practitioners in one narrow segment; gather 3–5 representative anonymized/synthetic-equivalent cases and the manually produced deliverables | At least three buyers corroborate a repeated costly activity and agree to pilot terms or provide a concrete buying signal; record substitutes and objections |
| **W1 — Evidence operations** | First accepted Study plus document inventory, scoped coverage and one cross-source reconciliation | Input-to-output source chips work; wrong associations and unreadable periods stay unresolved |
| **W2 — Work completion** | One goal generates a task plan, live exception register and one concrete review-ready deliverable | A real reviewer can use the output and resolve/trace every material exception |
| **W3 — Repeat and improve** | Incremental evidence refresh, human sign-off, saved deliverable history and handoff | Same case can be updated without rebuilding everything; prior accepted states remain intact |
| **W4 — Expansion** | Second workflow uses the same reusable operators and Study core | No duplicated domain processing path; demonstrated paid demand before additional build-out |

**Engineering sequencing:** W0 runs as product discovery alongside the separately authorized V4 plan. No changes to the current **`V4-003`** ticket, new tables beyond approved upload scope, integrations, migrations, paid calls, or UI code are approved by this Intelligence-to-Work specification alone. Add work-plan implementation tickets only following explicit reprioritization and review of the existing dependency chain.

### Explicitly open decisions

1. First paying persona and narrow workflow (e.g., small elder-law practice financial preflight versus a lower-regulation alternative); verify buyer economics and competition rather than assume a winner.
2. What constitutes a completed work product for that buyer; required inputs, review authority and exact export format.
3. Work-item schema, status transition authority, recipe format and versioning; no schema or contract name is preapproved here.
4. Whether criteria are user-specified, derived from evidence, or maintained in reviewed specialist guidance; do not disguise model suggestions as law or policy.
5. Privacy, regulated information, provider terms, external actions, sharing and billing/usage pricing remain separately gated.

## V4 analytical intelligence expansion (R65–R84) — 2026-10-31

**Founder product direction:** Once a Canonical Study revision has been accepted, Hive should proactively discover what analyses the available evidence can support, run appropriately validated analyses, and offer useful insights, next actions and optional what-if exploration. This extends R45–R64 (Intelligence-to-Work); it does **not** convert a model response into accepted source truth, require a Domain Pack, introduce a fourth global tab, or authorize external actions.

**Distinguish three capabilities:** (1) *Automatic Analytical Discovery* proposes analyses suggested by the accepted evidence, even without a question; (2) *Analytical Execution* evaluates approved/supported operations; (3) *Scenario Intelligence* explores explicitly hypothetical alterations, keeping assumptions separate from source facts. An analysis can be valuable even when it is qualitative or returns a gap, provided scope and confidence are honest. An optimization solver is optional and appropriate only for well-defined optimization problems.

| ID | Capability | Acceptance requirement | Suggested sequencing |
|---|---|---|---|
| **R65** | Revision-triggered opportunity discovery | On an accepted Study revision, enqueue or offer a bounded asynchronous discovery run pinned to that immutable revision. No trigger from unverified candidates or failed merges; avoid duplicate equivalent runs. | A0 |
| **R66** | Generic analytical opportunity proposal | LLM proposes question, user value, analysis kind, required fact IDs, dependencies, relevant scope, limitations and expected output; no hardcoded domain-specific branching or obligatory Pack. | A0 |
| **R67** | Opportunity qualification/ranking | Score proposals on relevance to expressed goal (if present), evidence availability, actionability, duplication, cost, risk and user effort; label rankings as heuristics, never verified truth. Suppress trivial, unsupported and redundant opportunities. | A0 |
| **R68** | Explicit analysis plan | Generate inspectable typed plan with inputs, transformations, outputs, calculation/rule methods, assumption slots and validation criteria; every accepted source reference must resolve in the pinned revision. | A0 |
| **R69** | Analysis execution routing | Choose supported tools by problem type: deterministic arithmetic/joins/comparisons first; bounded LLM interpretation for supported qualitative work; retrieved verified rules for rule-dependent cases; optional solver for optimization/feasibility. No unrestricted model-authored code execution. | A0 |
| **R70** | Analysis trust and evidence checks | Independently verify source IDs, scope, types/units/dates, computations, rule identity/effective dates and declared dependencies. Persist `SUPPORTED`, `PARTIAL`, `BLOCKED`, or `REJECTED` with reason and uncertainty. A plausible model narrative is not validation. | A0 |
| **R71** | Proactive analysis results | Display prioritized evidence-bound findings, relevant comparisons, noteworthy conflicts, key unknowns and next actions within Study; distinguish generated insight from accepted source facts; do not overwhelm users with low-value analysis. | A0 |
| **R72** | Coverage-aware analysis | Describe exact analyzed sources/periods, unreadable/unreviewed material, failed prerequisites and potential bias; no global absence claim from partial scope. | A0 |
| **R73** | Incremental re-analysis | On a new accepted revision, identify affected analyses, rerun only relevant work where possible, preserve prior outputs and explain changes; stale pinned analyses remain viewable as historical. | A1 |
| **R74** | Natural-language what-if request | User can ask an alternative-question against a pinned Study and optionally an existing finding; LLM clarifies only missing material variables. | A1 |
| **R75** | Isolated scenario overlays | Represent assumption overrides, proposed interpretations, selected rule sets and time horizons as a separate immutable scenario overlay; never write hypothetical values to source facts or Canonical Study. | A1 |
| **R76** | LLM-generated dependency models | LLM may synthesize variables, dependency links, equations, conditions, objectives and prerequisites from the Study and available rules. Label them *proposed* until validated; explicitly capture missing assumptions and unsupported causal assertions. | A1 |
| **R77** | Typed scenario model validation | Validate allowed variable types, units, data provenance, dependency referential integrity, cycles, formula/operator allowlist, constraint satisfiability where applicable and rule source/version/effective jurisdiction. Reject or limit unsafe models; explain blocked outcomes. | A1 |
| **R78** | Controlled scenario evaluation | Evaluate formulas using deterministic operators; use rule evaluators only with verified rules; optionally translate supported integer/linear constraint models to OR-Tools or another approved solver. Never claim solver optimality implies real-world or legal correctness. | A1 |
| **R79** | Baseline versus alternatives | Present baseline and multiple scenarios side-by-side, changed assumptions, calculated deltas, sensitivity, constraints, tradeoffs, unsupported outcomes, and evidence/rule links. | A1 |
| **R80** | Scenario-guided discovery | When material, suggest bounded, useful what-if questions derived from accepted facts and unresolved decisions, clearly marked as exploration rather than recommendations or predictions. | A1 |
| **R81** | Scenario/analysis history | Store independently identified runs, model/prompt/method versions, inputs, assumptions, pinned Study revision, verification status and saved comparisons; failures must not erase prior accepted analyses/reports. | A0 for analysis; A1 for scenarios |
| **R82** | High-impact outcome boundaries | For legal, education, healthcare, eligibility and finance, separate documented facts, authoritative rules, user hypotheticals, computations, interpretations and professional decisions. No unsupported eligibility, discharge, court, school-performance or causal prediction claims. | A0 |
| **R83** | Reusable validated analytical recipes | Retain generic operator/model patterns with explicit provenance, tests, version and approval; reuse only within compatible types/contexts. No automatic cross-customer private-fact learning or silent domain rule creation. | A2 |
| **R84** | Analytical quality and economics gate | Evaluate discovery precision/usefulness, missing and hallucinated dependencies, reproducibility, numeric correctness, rule grounding, blocked-rate, compute cost, time-to-result and user action taken against representative synthetic goldens; gate rollout by task-specific thresholds selected later. | A0 |

### Analytical result lifecycle and UX

- Proposed opportunity is not a finding. Store discovery status separately from execution outcome; suggested lifecycle: `PROPOSED → QUALIFIED → READY → RUNNING → SUPPORTED | PARTIAL | BLOCKED | REJECTED`, with `STALE` a view/history marker after newer revisions. These are **proposed logical states**, not authorized SQL enums.
- Trigger discovery automatically only after accepted revision and within approved token, cost and concurrency budgets. Initial user-facing UI can show a modest **Suggested analyses** section rather than automatically execute every proposal.
- A scenario result contains a *baseline* (pinned accepted Study), *overlay assumptions* (hypothetical), *execution trace* (method), and *comparison* (conditional result); never imply a hypothetical is part of the Study.
- Every analysis and scenario must be reviewable, interruptible where possible, safely retryable, owner-scoped and explainable at the evidence and method levels.

### Representative synthetic acceptance tests

1. **Financial records:** Identify debt composition and a statement-coverage analysis without user asking; compute totals from typed entries, show conflicting balances and periods, reject arithmetic on mixed currencies.
2. **IEP documents:** Identify plan-versus-evaluation comparison and timing questions; distinguish recommendations from provided services, block claimed educational outcomes without outcome evidence.
3. **Bankruptcy:** Propose a conditional Chapter 7 versus Chapter 11 analytical opportunity, request debtor type/jurisdiction, verify rule source/effective date, never pronounce eligibility or chapter superiority from incomplete facts.
4. **What-if:** Change a hypothetical income or asset valuation; keep original facts unchanged, reproducibly calculate supported deltas and label downstream legal conclusions as conditional/unresolved.
5. **Adversarial:** Reject nonexistent fact IDs, circular dependency graph, unsupported legal rule, wrong-unit formula, model-authored executable code, unauthorized source or invented citation; retain prior accepted Study/reports.
6. **Cost/duplication:** Equivalent accepted revision/repeated trigger does not spawn unbounded runs; irrelevant proposals are filtered; re-analysis records exactly what changed.

### Open design gates (not implementation approval)

Specific LLM orchestration, JSON contracts/validators, analysis quality thresholds, rule-source retrieval/versioning, optional solver/backends, user consent for auto-execution, token budgets, billing impact, persistence tables and scheduling mechanism require ticket-level design and approval. Do not assume all queries are optimizations or causal inference problems.

## V4 model gateway reuse (R85) — 2026-11-01

HiveForYou V4 shall preferentially reuse V3's existing LiteLLM deployment, provider configurations, model aliases, routing, environment variables, structured-output compatibility, error handling, and safe observability conventions.

| ID | Capability | Acceptance behavior |
|---|---|---|
| **R85** | Reuse existing V3 LiteLLM infrastructure | **(1)** Inventory the actual V3 LiteLLM implementation and deployed configuration before integration. **(2)** Reuse existing gateway infrastructure and model routing wherever compatible. **(3)** Provide one domain-agnostic, server-side model-access boundary in V4. **(4)** Preserve privacy, authorization, provenance, bounded timeouts, typed errors, and safe retries. **(5)** Avoid duplicate infrastructure, provider-specific business logic, and unnecessary configuration variables. **(6)** Adapt only what V4's architecture and approved model contracts require. **(7)** Verify structured JSON compatibility and provider behavior before enabling V4 extraction. |
