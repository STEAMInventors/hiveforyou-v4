# HiveForYou V4 — Product requirements

**Version:** 0.1 | **Date:** 2026-10-26 | **Status:** Proposed V4 source-of-truth document; product direction decided, implementation not authorized.

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
| **R34** | Controlled provider/model access | No direct model calls from browser. Server calls use one approved provider/gateway adapter and permitted retention/contract/consent. Neither LiteLLM nor any specific provider is mandated by V4 yet. |
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
- **Create Hive:** name required, at most **100 characters**; description optional, at most **500 characters**; each intended creation gets a distinct client request UUID and repeated submission is idempotent. A new Hive has no accepted Study until the first verified acceptance.
- **Supported initial uploads:** PDF, PNG, JPG/JPEG, DOCX; file size limits are approved when coded, not invented here. A successful upload is private storage registration plus source metadata, not proof of successful extraction.
- **Free uploads:** **10 successful registered uploads per UTC calendar month across owner Hives** (retained V3 decision). Server-side enforcement and honest quota UI. Billing above that threshold not specified.
- **Full Study:** account for **all eligible documents** in its declared scope; targeted enrichment must explicitly label source/page/attribute scope. Unreadable/missing is not equivalent to absent facts.
- **Retention/deletion:** owner Hive archive and deletion distinct; account deletion has retained **30-day recoverable window** then permanent deletion/cleanup and audit, but implementation is a separately gated feature. Prior accepted Study and report revisions survive a *failed generation*; deletion follows approved retention rules.
- **Trusted boundaries:** original documents and source quotes are private, owner-bound; no browser-side model key; source text is untrusted instructions; source evidence and review statuses are independent of model formatting confidence.

## End-to-end acceptance scenarios (synthetic only in development)

1. **New Hive, one receipt:** sign in; create empty Hive; upload synthetic receipt; frontier extraction produces `hive.doc-extraction/1` candidate facts and evidence; independent verification accepts/rejects with reasons; first accepted Study revision appears; citation opens exact page.
2. **Repeat questions, one Study:** questions about purchases, comparisons, and missing item attributes lead to different A2UI output regions/report layouts pinned to same Study revision; no re-reading unchanged pages merely for a new presentation.
3. **Incremental grocery:** add ten receipts to twenty, produce next revision preserving former information and histories; purchase is **not** assumed to mean consumption; unknown organic classification stays unknown.
4. **Synthetic IEP L001 eight-document case:** document chronology, goals/services, evaluations, conflicts and gaps retain exact source provenance; customer and professional output share accepted study; no legal verdicts or invented needs.
5. **Synthetic finance/bankruptcy/Medicaid case:** record/amount/date/claimant association preserved, contradictory figures displayed honestly, no eligibility or legal outcome guarantee.
6. **Adversarial/negative:** wrong owner, bad MIME, unreadable scan, bad quote, injection text, wrong record association, schema-invalid model JSON, partial pages, provider timeout, persistence interruption and failed view composition do not advance trusted Study or erase accepted reports.

## Explicit exclusions and open gates

- No automatic cross-user professional access, autonomous legal/financial action, arbitrary-generated program execution, mandatory Domain Packs, domain-specific UI app implementations, or cross-Hive private learning.
- Runtime topology (Vercel function duration vs durable job executor), provider/gateway, regulated-data agreements, reversible tokenization, sharing/exports/billing and final A2UI wire protocol remain open in `HiveForYou-DECISIONS.md`.
- **Compliance cannot be inferred** from use of Supabase, Vercel, tokenization or an external model; operate on synthetic documents until data-use approvals and safeguards are settled.
- Prior V3 requirement to route models through **Oracle LiteLLM** was an infrastructure constraint, **not** a V4 product feature. V4 keeps one approved server-side model boundary; gateway selection is separate.

**Related authority:** `HiveForYou-FEATURES.md` for screen behavior; `HiveForYou-UX-A2UI-DESIGN.md` for UI; `HiveForYou-ARCHITECTURE.md` for data flow; `HiveForYou-PROMPTS-AND-CONTRACTS.md` and `prompts/` for exact AI inputs; `HiveForYou-NEXT.md` for the only active engineering ticket.
