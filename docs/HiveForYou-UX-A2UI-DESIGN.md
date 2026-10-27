# HiveForYou V4 — Product Experience & A2UI Design

**Version:** 0.1 (design proposal)
**Date:** October 26, 2026
**Decision:** **B — Application-first with dynamic A2UI enhancements**
**Status:** **PROPOSED FOR REVIEW; not implementation authorization**
**Authority:** Latest explicit founder decisions; V3 `HiveForYou-PRODUCT-REQUIREMENTS.md` (R01–R36 and retained OD/MD decisions); unchanged *HiveForYou Brand Guide v1.0*. The V3 infrastructure diagrams and ticket status are historical references; V4 implementation/runtime architecture will be approved separately.

> **One familiar application, one evolving Canonical Study, many intelligent views.**
> **The complicated, made simple.**

---

## 1. Product contract: retain V3, improve the experience

**Keep the product:** A signed-in person creates a Hive, uploads messy documents, describes what they are trying to do, receives evidence-grounded help, explores original documents, asks more questions and gets different outputs from the same evolving Canonical Study. Professional-format outputs can use richer evidence without becoming a separate truth store.

**Change the experience:** The primary navigation and dependable document-management actions are designed and coded by the application. **Inside** those predictable screens, the model proposes the *right arrangement* of permitted cards, comparisons, timelines, tables, question lists and evidence panels for the current intent. The application validates this proposal and renders it using the HiveForYou design system.

**Do not change by implication:** owner-only initial permissions; new-Hive identity; the approved Free upload quota; allowed file types; provenance; source isolation; report history; previous Study revisions; deletion protections; professional access gates; and no invented evidence. A2UI is a presentation capability, not permission to alter stored knowledge or execute actions.

**Do not assume implementation:** This document defines target behavior. It does not claim any V4 feature exists yet, create a repository, approve a deployment, or authorize real sensitive-document processing.

## 2. The V4 experience in one diagram

```text
Public landing → Sign in / Sign up → My Hives → Open Hive
                                         │
                         ┌───────────────┼─────────────────┐
                         │               │                 │
                      Documents         Study             Reports
                  upload/manage/see  understand/ask    saved/generated
                  source and pages   context & evidence outputs/history
                         │               │                 │
                         └───────────────┼─────────────────┘
                                         │
                             Stable authenticated shell
                                         │
                               Validated A2UI regions
                       (contextual panels, not new app routes)
                                         │
                             Study revision + evidence
                                         │
                            Original page in source viewer
```

The persistent mental model is: **Documents are the source; Study is the accepted knowledge; Reports are different answers and presentations of that knowledge.** No fourth independent case database or hidden per-intent truth store.

## 3. Information architecture

| Level | Destination | Stable application role | Proposed A2UI-enhanced regions |
|---|---|---|---|
| Public | Landing | Explain product, honest trust, calls to sign in/create Hive | None required |
| Account | Sign in, sign up, callback, account/privacy | Auth, owner identity, privacy/delete requests | None; security actions always fixed |
| Account | **My Hives** | List/search owned Hives, create/open/archive/delete | Optional non-claim smart hints, never generated permissions |
| Hive | **Documents** | Upload, list, review, replace/delete where permitted; open source viewer | Contextual suggested documents, structure preview, explain extraction gaps |
| Hive | **Study** | Current accepted revision, prior versions, progress, ask a question | Dynamic topic overview, entities, chronology, comparisons, chart/table, questions |
| Hive | **Reports** | Generate and browse independent results pinned to Study revisions | Dynamic validated report composition and evidence-rich Pro view |
| Contextual | **Evidence viewer** | Authorized original file/page, anchor highlight, source metadata | Fact context sidebar, related accepted observations |
| Contextual | **Processing detail** | Real stages, coverage and safe retry | Context-aware next step, never fictional progress |

**Navigation invariants:** Three Hive tabs (Documents, Study, Reports) do not shift based on the model. A persistent **Ask about these documents** input is visible in Hive workspace (desktop header/panel, mobile bottom composer or dedicated accessible entry). A2UI can change the content in a pane, not rename or rearrange the global navigation.

## 4. Screen-by-screen specification

### Screen A — Public landing

**Purpose:** Make one idea obvious: “Upload whatever you have. Tell us what you need to understand.” Trust is earned with source-grounded behavior, not vague AI marketing.

- Header: HiveForYou logo and Sign in / Get started.
- Hero question: **“What are you working on?”** with the brand four-color focus ring around the primary input.
- Primary CTA: create account/start a Hive. Clearly indicate that user-uploaded files are private to the account initially; do not promise HIPAA compliance or AI de-identification before policies/contracts are in place.
- Optional examples use situations rather than mandatory domain menus: meeting prep, understand spending, organize paperwork.
- Plain supporting line: **“Upload whatever you have — old, partial or out of order is fine.”**
- Do not display fabricated testimonials, customer counts, images of distressed children or AI sparkle effects.

### Screen B — My Hives

**Stable layout:** Page heading, **New Hive** action, list/grid of owned Hives, search, empty state, account controls. Each Hive card has name, optional description, document count, current Study state, last activity and safe contextual actions.

**Create Hive:** Name required **≤100 characters**, description optional **≤500 characters**. Server-side idempotency prevents accidental duplicate creation; intentional repeats create separate Hives. Navigate into the Hive immediately; a newly created Hive has an empty Study, not a fictional accepted snapshot.

**States:** Empty account (“Create a hive to get started”), no matching search, Hive waiting for first document, Hive awaiting processing, accepted Study, processing problem, archive/pending deletion. Never style an unprocessed Hive as “Verified.”

### Screen C — Documents (the main working screen)

**Header:** Hive name/description and **Ask about these documents** input. Stable tabs: Documents · Study · Reports. Below: the brand **state bar** in order **Needs you · Changed · Missing · Checked** when supported by the actual data. Do not create fake counts to fill it.

**Core document interface:**

- Prominent **Add documents** action with drag/drop and file picker; supports **PDF, PNG, JPG/JPEG, DOCX**.
- Informal reassurance about partial/out-of-order documents; show account upload quota and successful-upload usage when applicable. Preserve **10 successful uploads per UTC calendar month on Free, across all Hives**; metering is server-side and counts registered files, not processing success.
- Each source row/card: human filename (document-management context), proposed document role/type (clearly labeled if uncertain), uploaded time, document date when evidenced, page count, read/verification coverage, duplicate/revision warning, processing state, and an **Open document** action.
- Statuses are real: **Uploaded / Reading / Extracting / Checking evidence / Updating Study / Ready / Needs attention / Failed**. UI may map internal processing statuses to these labels, but never claim a stage is complete early.
- Source actions: open, view metadata, retry supported failed processing, replace/delete only when authorized and consistent with Study locking/provenance rules. Do not conflate archive, deletion of a source, deletion of a Hive and deletion of an account.
- Show unreadable pages/sections and meaningful remediation (“Page 3 could not be read; upload a clearer scan”) instead of a misleading green completion state.

**A2UI-enhanced side panel (optional and dismissible):**

- “What these documents appear to cover” (type/category hints with uncertainty labels).
- “Documents referred to but not uploaded” only when a source explicitly mentions them, with cited source chip.
- “Possible next documents” phrased as context-dependent suggestions, not mandatory requirements inferred from a generic domain checklist.
- “Explore a question” suggestions based on the current document coverage and user intent, never a mandatory interview.

**Source viewer:** Authenticated preview, persistent original physical page number, page navigation/thumbnails, optional search, selection/highlight of exact quoted support, side panel with the accepted fact/interpretation/uncertainty and a link back to the report. A source chip uses a **document role + page**, *not a filename*, following the brand guide. Never claim a coordinate highlight if only page-level attribution was verified.

### Screen D — Study (the knowledge workspace)

**Purpose:** Present what Hive currently *knows from sources* and what remains unresolved, separately from any one answer. This is not another document list and not a report gallery.

**Fixed upper region:** Current accepted Study revision/status, date it was accepted, number of eligible documents accounted for, explicit partial/unreadable coverage, access to previous accepted revisions and a short “what changed since last accepted revision” view. If no accepted Study exists, show that honestly and route the user toward the next safe processing action.

**Fixed Ask bar:** “What would you like to understand?” Input accepts unrestricted natural language; no required domain picker. A new question creates a separate analysis pinned to a specific accepted Study revision. When only part of the necessary source has been extracted, the UI explains focused follow-up extraction and its scope.

**A2UI result pane:** The model selects validated components using accepted Study data, e.g.:

- topic overview of supported observations;
- attributed timeline of meetings, changes, filings, or transactions;
- entity/relationship cards where identities are supported;
- before/after or document-to-document comparison table;
- metrics and charts only when underlying arithmetic, units and scope are verified;
- competing claims/conflicts, unknowns, unreadable sections and missing referenced documents;
- questions worth asking and next steps (not unsupported verdicts);
- expandable evidence rows with source chips opening the original pages.

**Revision behavior:** New documents enrich **one** Canonical Study; accepted earlier revisions are preserved. User changes to audience, question or layout cannot rewrite source observations. Conflicting and historical claims remain distinguishable; “latest file wins” is forbidden unless supported by specific source evidence.

**If the user asks about something outside existing coverage:** Give a useful partial answer where safe, then offer “Check more of my uploaded documents” with a clear scope description. “These documents don't show...” is only valid when reviewed scope actually supports that statement.

### Screen E — Reports

**Purpose:** Turn an accepted intent analysis into a coherent, useful output for a chosen audience, without copying or modifying the Study.

**Stable controls:** Ask/goal, audience **Customer / Professional-format**, source scope, report purpose, allowed emphasis and layout choices, **Generate**, prior results/history. Professional-format means denser presentation; it does **not** grant access to anyone else's Hive. External sharing and professional editing require separate approvals.

**Independent results:** Every Generate action has its own run ID and a pinned Study revision. A failed new report preserves older accepted reports and links. Show generation state and error/retry honestly.

**A2UI report surface:** Dynamic composition from accepted analysis and allowlisted components. Reports can combine summary, key findings, timing, comparison, question list, evidence table and, when justified, chart/timeline/checklist. All case claims are citation-bound; qualified interpretations and general knowledge are explicitly labeled. The model does not choose its own authorization, source files, executable code, database queries or unrestricted external actions.

**Customer view:** Plain, calm, approximately eighth-grade reading level; few primary conclusions, clear questions and uncertainty, expandable provenance. **Professional-format view:** Source-by-source chronology, typed values, evidence matrix, competing claims, coverage and caveats, original quotes and traceable calculation inputs. Same underlying accepted Study and analysis, subject to authorized access.

**History and viewing:** Saved results show created date, question, audience, Study revision and current/previous state. Read-only output initially; exports and external sharing remain gated until policy/format/security decisions are made.

### Screen F — Evidence view (deep link / side drawer)

**Source chip is an interaction, not decoration:**

1. Tap a chip such as `Initial IEP · p.7`.
2. Authorize source access server-side.
3. Open physical page 7 in place (drawer on desktop, full-screen sheet on mobile), with exact quote and optional verified region highlight.
4. Show “What this supports,” the fact ID/status, raw value and (if different) normalized value or derivation method.
5. Return to the originating sentence/table cell with focus restored.

A chart mark, comparison row or report sentence must also offer this evidence path. For multi-source claims show **all** relevant source chips. If page viewer or quote anchor is unavailable, show the limitation rather than pretending the link worked.

### Screen G — Account, privacy and deletion

Fixed product UI, never model-generated. Show current data use/privacy policy, account controls, retention policy, access settings and protected deletion actions. Preserve the previously approved **30-day recoverable account deletion** decision as a *deferred implementation*, not a claim that its workflow already exists. Distinguish Hive archive, confirmed Hive deletion, document deletion and account deletion. All require server-side authorization, explicit confirmation and safe partial-failure recovery. A2UI has no access to deletion commands.

## 5. Core interaction journeys

### Journey 1: first-time customer

1. Sign up/sign in → My Hives → **New Hive**.
2. Name the Hive → arrive in Documents with an honest empty Study.
3. Upload documents → each source appears immediately with accurate upload/read status.
4. Describe desired outcome before or after upload; no mandatory domain interview or Pack selection.
5. Processing shows the actual stages; if missing source quality/permissions, UI asks one focused question or offers a repair action.
6. Accepted Study appears; initial answer/report opens in a validated A2UI region, with working source chips.
7. Follow-up question or add documents → reuse existing verified knowledge; new Study revision only when new accepted evidence warrants one; earlier reports preserved.

### Journey 2: add documents after a report

The user uploads later material to the **same Hive**. UI shows which files are new or possible duplicates/revisions, what is being checked, and what changed *once verified*. Accepted prior Study/report remain available during a failed update. “Changed” is shown with specific before/after source support and dates; an uploaded newer file is not automatically more authoritative.

### Journey 3: professional-format analysis (owner self-service initially)

Owner chooses professional-format output from their own Hive, sets purpose/source scope/questions, generates an evidence-dense report pinned to the same Study. A user cannot grant third-party access simply by choosing “Professional.” Shared access, professional corrections and export require separate owner approval and authorization design.

### Journey 4: a cited finding leads to original source

User opens a source chip from a dynamic A2UI card. The viewer opens the cited file/page with a highlighted quote if a reliable anchor exists, plus original value, interpretation/verification status and return-navigation. If authorization fails, a safe denial replaces the original; no source text leaks.

### Journey 5: blocked and partial states

A corrupted or unreadable source remains listed, with actionable error and exact scope. Study/analysis may produce a qualified partial result when policy allows but cannot label unreviewed content “not found.” Failed runs leave accepted snapshots/results unchanged. Recovery reuses immutable run identity when retrying the same action; each new Generate is a new output run.

## 6. A2UI boundaries: where it may, and may not, operate

A2UI is **a declarative presentation contract**, not a model writing frontend source code. We should evaluate the official protocol and pin a compatible supported version before implementation. Verify the current supported A2UI protocol version and React renderer compatibility at implementation time against the official project site (https://a2ui.org/). V4 can adopt a compatible supported protocol or implement a narrow approved application-spec adapter; this is an **implementation decision**, not a new user-facing configuration choice.

| Fixed by application | Composable by model in approved A2UI region |
|---|---|
| Authentication, authorization, routing | Arrangement of approved read-only information components |
| Hive creation, upload, replace, delete | Topic summaries and contextual explainers |
| Source access, original viewer, quote retrieval | Evidence panels, cross-source comparisons |
| Accepted Study revisions, provenance status | Timelines, metrics, tables and supported charts |
| Report run identities, processing state | Report section order and visual emphasis within rules |
| Privacy, sharing, billing, export authorization | Suggested follow-up questions routed through typed, authorized actions |

### Initial component catalog

| Component | Data it requires | Key behavior |
|---|---|---|
| `Narrative` | Text spans bound to supported claim IDs/qualified interpretation IDs | Sentence-level source chips |
| `Metric` | Deterministic value, unit, calculation ID, scope, inputs | Opens supporting evidence and method |
| `RecordTable` | Typed rows, source evidence per row/cell, sort metadata | Accessible responsive table and row expansion |
| `Comparison` | Paired assertions, subject/period compatibility and citations | Highlight same/different/unresolved, not legal compliance |
| `Timeline` | Event date semantics, claimant, source status, citations | Chronology with unresolved dates appropriately labeled |
| `IssueList` | Missing/unreadable/conflicting/unknown reason + scope | Only supported gaps and clarifying questions |
| `QuestionList` | Neutral prompts tied to observations or open coverage | Copy or use as next question; never force a verdict |
| `EvidencePanel` | Authorized source IDs, physical page, quote/anchor IDs | Open original source viewer |
| `Chart` | Verified series, compatible units, calculation lineage | Chart mark → row/fact/source; accessible table alternative |
| `Checklist` | Grounded tasks or user-maintained preferences, distinct from facts | Read-only first; interactive state later by explicit action rules |

**Component rules:** Explicitly version allowlisted component names and field contracts; validate the complete spec, source IDs, Study revision, access, size/depth, action names and evidence refs *before* rendering. Reject unsupported components and fall back to a plain accessible evidence-linked view. No model-authored HTML, JavaScript, SQL, arbitrary URLs, executable callbacks, injected CSS or privileged API actions. The model cannot create an action that changes verified facts or deletes data.

### Simplified A2UI application-spec concept (illustrative, not the official wire schema)

```json
{
  "version": "hive-application-view/1",
  "studyRevisionId": "<server-pinned revision>",
  "analysisId": "<server-authorized analysis>",
  "audience": "customer",
  "components": [
    { "type": "Narrative", "claimRefs": ["finding-1"], "style": "lead" },
    { "type": "Comparison", "findingRefs": ["finding-2", "finding-3"] },
    { "type": "QuestionList", "questionRefs": ["question-1"] },
    { "type": "EvidencePanel", "sourceRefs": ["fact-1"] }
  ]
}
```

IDs here are placeholders. The server supplies authorized values from accepted evidence; the model proposes the arrangement, not unchecked facts or raw file access. If the official A2UI protocol is chosen, map this concept to its supported message/component model instead of presenting this illustrative object as compliant A2UI.

## 7. Information and trust hierarchy

1. **Source file:** the original uploaded document; read status and quality are visible.
2. **Candidate extraction:** model-proposed observations. Do not present as established findings.
3. **Independent disposition:** `VERIFIED`, `UNRESOLVED` or `REJECTED`, with reason. “Verified” means accurately supported as *what the document states*, **not** that the statement is objectively true.
4. **Canonical Study:** accepted, versioned observations, relationships, conflicts and limitations.
5. **Intent Analysis:** question-specific supported findings, derived calculations, unknowns and interpretations, pinned to a Study revision.
6. **A2UI report/view:** presentation of authorized accepted material; it does not create truth.

**UI language:** “Your documents say…”, “Worth asking…”, “These records don’t include…” **when scoped**. Avoid “AI proved…”, “violated”, “guaranteed”, or “no evidence” based merely on absent extraction. For receipts, describe what was *purchased*, never what was *consumed*. For high-impact legal/financial/eligibility situations, clearly distinguish source claims, professional questions and qualified general information.

## 8. Product design system (unchanged brand authority)

**Color meanings:** Cell Blue `#3B7CF6` actions/focus; Coral `#EF5143` missing/blocked; Honey `#F6B826` change/source chips; Leaf `#2FA35A` checked/settled. Text uses accessible deep variants (`#1A56C4`, `#B33A2E`, `#7A5200`, `#197040`); most surfaces use Paper `#FFFFFF`, Mist `#F4F6F8` and Ink `#1F2328`. Never color-code children or people as good/bad.

**Typography:** Outfit for headlines/wordmark, DM Sans for UI/body, Source Serif 4 for verbatim quotes only, JetBrains Mono for source chips/data references only; use legitimate font licenses and deployment procedures, do not embed font binaries from the guide.

**Signature components:**

- **Source chip:** Honey wash, document role + physical page; clicking opens the original page; not a filename or a decorative tag.
- **Four-color input ring:** Around the main intent input on hover/focus, restrained and accessible.
- **State bar:** Exactly **Needs you · Changed · Missing · Checked**, in that order, using correct semantic colors and grounded counts.

**Writing:** Sentence-case headings/buttons; body approximately 8th-grade reading level; numbers copied exactly from source when quoting; no all-caps labels, false urgency, adversarial wording, mascot/bees, fake proof or AI theatrics.

**Motion:** Logo settles once for ~1.2 seconds only at suitable brand moments; no repeated animation. Respect reduced motion immediately. Processing uses real stage updates, not staged theatrical progress.

## 9. Responsive and accessibility behavior

- **Desktop:** Stable left or top navigation, three Hive tabs, two-pane Documents/Study with dismissible contextual A2UI region; side source drawer for citations.
- **Tablet:** A2UI panels stack or become disclosure sections; document list remains first-class; fixed actions are always reachable.
- **Mobile:** Bottom/compact Hive navigation or accessible tabs, prominent Add documents and Ask, source chip opens full-screen evidence sheet, chart always has a table/summary alternative.
- **Keyboard:** Every generated control/section and source chip has a predictable focus order, labels, `Esc` behavior for drawers, and focus restoration after close.
- **Assistive technology:** Plain text alternatives, table headers, accessible result announcements, no color-only meaning; live processing statuses announced without excessive interruptions.
- **Long content:** A2UI output has pagination/virtualization or bounded expansion; never drop cited findings silently to fit a card count.
- **Localization:** User-facing text is plain English initially; locale/date/currency presentation never changes source values or creates an unverified conversion.

## 10. Data security, tokenization and privacy as UX requirements

- Original files and source evidence require owner/server authorization. Model-generated UI cannot bypass RLS or request arbitrary original pages.
- If reversible tokenization is adopted, tokenized model quotations and original source quotations require a secure, audited mapping and verifier semantics. **Tokenization is not automatically HIPAA de-identification** and is not a substitute for agreements, access controls or source retention policy.
- Clearly explain which document content may be sent to an approved frontier-model provider. Get policy/authorization before real sensitive data. Never promise a given compliance status from a proposed UI.
- Avoid disclosing full private quotes/content in operational logs, URLs, browser telemetry, or generated preview/analytics events.
- Show explicit scope when sharing/export becomes available. Initial Milestone 1 remains owner-only.
- Stable upload/recovery states for wrong file type, oversized file, failed OCR, unreadable scan, expired access, security denial, model failure, validation failure and uncertain persistence.

## 11. Cross-domain UX examples (all hypothetical, not actual case findings)

### Synthetic IEP preparation

Documents tab shows eight source files. Study A2UI composes **Timing → Evaluations → Goals & Services → Plan vs recommendations → Questions worth asking**, each source statement grounded with chips. A customer receives a calm meeting brief. Professional-format Report shows per-source evidence comparisons and missing/unresolved items. No automatic compliance verdict or school-blame language.

### Synthetic grocery receipt collection

Twenty receipts produce a Study view with **Purchases by category → Evidence-backed spend → Known classification vs unknown → Store/unit comparisons**. Upload ten more receipts into the same Hive; an updated Study revision allows a later organic-product question. Purchase is not consumption. Unknown organic labels remain unknown; incompatible package sizes are not silently compared.

### Synthetic financial / bankruptcy folder

Study A2UI composes **Source inventory → dated income/debt claims → competing balances → referenced documents missing from the upload → questions for counsel**. The system does not make definitive chapter, eligibility or legal-outcome decisions on unreviewed materials. Sources and as-of dates remain visible.

## 12. V3 feature preservation checklist

| V3 requirement/decision | V4 UX handling | Status |
|---|---|---|
| R01; MD-01..05 | Authenticated My Hives, idempotent Create, owner isolation, empty Study until accepted processing | **Retain** |
| R02; OD-01 | PDF, PNG, JPG/JPEG, DOCX; 10 successful Free uploads / UTC month across Hives; visible errors | **Retain** |
| R03–R06, R19 | Free-form intent, optional before/after upload; intelligent source discovery; real processing stages | **Retain; enrich** |
| R07, R15, R20–R21 | Physical-page source chips, explicit evidence trust, unreadable/not-reviewed scope | **Retain; deepen** |
| R08–R11, R17, R22–R23, R36 | One evolving Study; incremental evidence; repeat intents; conflicts/revisions retained | **Retain** |
| R12–R14, R24–R28 | Customer/pro output, unique Generate runs, pinned history, validated dynamic A2UI | **Retain; enrich** |
| R16 | Pack-free normal path; optional specialist overlays not forced in consumer UX | **Retain** |
| R18 | Attributed correction capability remains a permission/design gate | **Retain gated** |
| R25 | Deterministic calculations; drill to method and source inputs | **Retain** |
| R29–R30, R32–R34 | Server-side access checks, high-impact caution, authorized targeted source re-open, recovery/privacy | **Retain** |
| OD-06 / OD-07 | No failed-run Study promotion; full-scope processing coverage; targeted scope explicit | **Retain** |
| OD-11 | PKCE auth callback and approved email confirmation behavior | **Retain** |
| OD-12 | 30-day recoverable account deletion, with post-retention cleanup; implementation deferred | **Retain decision** |
| OD-03, MD-05 | Owner-only initial authorization; no unapproved collaborators or professional cross-user rights | **Retain** |
| R26–R27 | Universal declarative output rendered in HiveForYou-native components | **Expand via A2UI** |
| R35 | Fresh end-to-end real document/browser test and recovery checks needed before claiming complete product behavior | **Retain pragmatically** |

**V3 infrastructure-specific assumptions (Oracle, Inngest, Python Reader, old schemas/rules)** are *not* UX/product features and must not silently become V4 architecture requirements. The founder selected a clean V4 repository and a simplified runtime direction; exact backend execution strategy remains a separate design decision.

## 13. Minimum V4 UX slices (build from a real experience)

| Slice | User-visible result | Prove with synthetic documents |
|---|---|---|
| **UX-1 Foundation** | Brand-faithful landing, auth, My Hives, create/open Hive, fixed three-tab shell | Can create isolated empty Hive; no fabricated Study |
| **UX-2 Documents** | Upload/register/view source files, accurate page/read status, file errors, quota, evidence viewer shell | PDF/image/DOCX; correct page navigation, safe failed upload |
| **UX-3 First Study** | Real pack-free extraction `hive-extract/1` → independent evidence → one accepted Study revision | Synthetic single document then multi-document with working source chips |
| **UX-4 First A2UI** | Fixed Study screen + one validated dynamic evidence-bound results region; plain fallback | Different intents produce different allowed layouts from the same accepted data |
| **UX-5 Reports** | Customer/pro-format Generate, independent history, prior results survive failure | Two different presentations pinned to Study revision |
| **UX-6 Incremental** | Add source, accepted Study revision updates, differences and history; target enrichment | Grocery 20 → 30 in same Hive, then different question |
| **UX-7 Controls** | Recovery, accountable coverage, deletion/privacy/account flows as separately approved | Denial, unreadable file, bad quote, invalid view, failure before Study pointer update |

Do not substitute a visually convincing static mockup for a working evidence-linked flow. Equally, do not delay basic UX building for broad production-hardening work while V4 is still under active development.

## 14. Open product decisions (explicitly not assumed)

1. **V4 account/Hive migration:** V4 starts clean in a new repository; whether existing accounts/Hives/data migrate is unapproved.
2. **New environment/runtime:** Vercel-only extraction vs separate durable compute for large multi-file jobs requires its own technical decision; this UX proposal does not imply unlimited Vercel execution.
3. **Professional access and sharing:** owner-selected pro-format reports can precede cross-user professionals; sharing roles and export formats remain open.
4. **Correction workflows:** which fields can be annotated/corrected, by whom, and with what review status remains open.
5. **Privacy/provider/tokenization:** provider/model, BAA requirements for regulated data, token mapping/evidence restoration, retention and deletion policy decisions remain open.
6. **A2UI wire protocol/renderer:** choose a supported protocol version/React integration or minimal adapter at implementation; do not add new user-facing feature flags just to support it.
7. **Payments and pricing:** preserve Free upload cap, but pricing for other tiers/export remains an explicit business decision.
8. **Responsive interaction details:** validate keyboard/mobile behavior with actual designs before final acceptance; presentation styles may evolve but brand semantics do not.

## 15. Immediate product-design next action

**Approve or revise this experience contract before implementation.** Then design a detailed, clickable **Documents → Study → Report** V4 prototype using synthetic source evidence and the brand guide, and implement the first authenticated upload-to-cited-answer vertical slice. Keep V3 intact as reference; no V4 repository, deployment or data change is claimed here.

---

**Source basis:** Founder decisions in this conversation (new V4 repo; product feature continuity; B: application-first with rich A2UI; `hive-extract/1`, `hive.doc-extraction/1`; `hive-prep/1` remains an IEP-specific stand-alone one-pass test); attached V3 `HiveForYou-PRODUCT-REQUIREMENTS.md` v1.2.1 and *HiveForYou Brand Guide* v1.0; A2UI project documentation (https://a2ui.org/, https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/). Product behavior described above is proposed for V4, not represented as implemented.
