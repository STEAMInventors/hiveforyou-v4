# HiveForYou V4 â€” Product Experience & A2UI Design

**Version:** 0.2 (design proposal)
**Date:** October 26, 2026
**Decision:** **B â€” Application-first with dynamic A2UI enhancements**
**Status:** **PROPOSED FOR REVIEW; not implementation authorization**
**Authority:** Latest explicit founder decisions; V3 `HiveForYou-PRODUCT-REQUIREMENTS.md` (R01â€“R36 and retained OD/MD decisions); unchanged *HiveForYou Brand Guide v1.0*. The V3 infrastructure diagrams and ticket status are historical references; V4 implementation/runtime architecture will be approved separately.

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
Public landing â†’ Sign in / Sign up â†’ My Hives â†’ Open Hive
                                         â”‚
                         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                         â”‚               â”‚                 â”‚
                      Documents         Study             Reports
                  upload/manage/see  understand/ask    saved/generated
                  source and pages   context & evidence outputs/history
                         â”‚               â”‚                 â”‚
                         â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                         â”‚
                             Stable authenticated shell
                                         â”‚
                               Validated A2UI regions
                       (contextual panels, not new app routes)
                                         â”‚
                             Study revision + evidence
                                         â”‚
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

### Screen A â€” Public landing

**Purpose:** Make one idea obvious: â€œUpload whatever you have. Tell us what you need to understand.â€ Trust is earned with source-grounded behavior, not vague AI marketing.

- Header: HiveForYou logo and Sign in / Get started.
- Hero question: **â€œWhat are you working on?â€** with the brand four-color focus ring around the primary input.
- Primary CTA: create account/start a Hive. Clearly indicate that user-uploaded files are private to the account initially; do not promise HIPAA compliance or AI de-identification before policies/contracts are in place.
- Optional examples use situations rather than mandatory domain menus: meeting prep, understand spending, organize paperwork.
- Plain supporting line: **â€œUpload whatever you have â€” old, partial or out of order is fine.â€**
- Do not display fabricated testimonials, customer counts, images of distressed children or AI sparkle effects.

### Screen B â€” My Hives

**Stable layout:** Page heading, **New Hive** action, list/grid of owned Hives, search, empty state, account controls. Each Hive card has name, optional description, document count, current Study state, last activity and safe contextual actions.

**Create Hive:** Name required **â‰¤100 characters**, description optional **â‰¤500 characters**. Server-side idempotency prevents accidental duplicate creation; intentional repeats create separate Hives. Navigate into the Hive immediately; a newly created Hive has an empty Study, not a fictional accepted snapshot.

**States:** Empty account (â€œCreate a hive to get startedâ€), no matching search, Hive waiting for first document, Hive awaiting processing, accepted Study, processing problem, archive/pending deletion. Never style an unprocessed Hive as â€œVerified.â€

### Screen C â€” Documents (the main working screen)

**Header:** Hive name/description and **Ask about these documents** input. Stable tabs: Documents Â· Study Â· Reports. Below: the brand **state bar** in order **Needs you Â· Changed Â· Missing Â· Checked** when supported by the actual data. Do not create fake counts to fill it.

**Core document interface:**

- Prominent **Add documents** action with drag/drop and file picker; supports **PDF, PNG, JPG/JPEG, DOCX**.
- Informal reassurance about partial/out-of-order documents; show account upload quota and successful-upload usage when applicable. Preserve **10 successful uploads per UTC calendar month on Free, across all Hives**; metering is server-side and counts registered files, not processing success.
- Each source row/card: human filename (document-management context), proposed document role/type (clearly labeled if uncertain), uploaded time, document date when evidenced, page count, read/verification coverage, duplicate/revision warning, processing state, and an **Open document** action.
- Statuses are real: **Uploaded / Reading / Extracting / Checking evidence / Updating Study / Ready / Needs attention / Failed**. UI may map internal processing statuses to these labels, but never claim a stage is complete early.
- Source actions: open, view metadata, retry supported failed processing, replace/delete only when authorized and consistent with Study locking/provenance rules. Do not conflate archive, deletion of a source, deletion of a Hive and deletion of an account.
- Show unreadable pages/sections and meaningful remediation (â€œPage 3 could not be read; upload a clearer scanâ€) instead of a misleading green completion state.

**A2UI-enhanced side panel (optional and dismissible):**

- â€œWhat these documents appear to coverâ€ (type/category hints with uncertainty labels).
- â€œDocuments referred to but not uploadedâ€ only when a source explicitly mentions them, with cited source chip.
- â€œPossible next documentsâ€ phrased as context-dependent suggestions, not mandatory requirements inferred from a generic domain checklist.
- â€œExplore a questionâ€ suggestions based on the current document coverage and user intent, never a mandatory interview.

**Source viewer:** Authenticated preview, persistent original physical page number, page navigation/thumbnails, optional search, selection/highlight of exact quoted support, side panel with the accepted fact/interpretation/uncertainty and a link back to the report. A source chip uses a **document role + page**, *not a filename*, following the brand guide. Never claim a coordinate highlight if only page-level attribution was verified.

### Screen D â€” Study (the knowledge workspace)

**Purpose:** Present what Hive currently *knows from sources* and what remains unresolved, separately from any one answer. This is not another document list and not a report gallery.

**Fixed upper region:** Current accepted Study revision/status, date it was accepted, number of eligible documents accounted for, explicit partial/unreadable coverage, access to previous accepted revisions and a short â€œwhat changed since last accepted revisionâ€ view. If no accepted Study exists, show that honestly and route the user toward the next safe processing action.

**Fixed Ask bar:** â€œWhat would you like to understand?â€ Input accepts unrestricted natural language; no required domain picker. A new question creates a separate analysis pinned to a specific accepted Study revision. When only part of the necessary source has been extracted, the UI explains focused follow-up extraction and its scope.

**A2UI result pane:** The model selects validated components using accepted Study data, e.g.:

- topic overview of supported observations;
- attributed timeline of meetings, changes, filings, or transactions;
- entity/relationship cards where identities are supported;
- before/after or document-to-document comparison table;
- metrics and charts only when underlying arithmetic, units and scope are verified;
- competing claims/conflicts, unknowns, unreadable sections and missing referenced documents;
- questions worth asking and next steps (not unsupported verdicts);
- expandable evidence rows with source chips opening the original pages.

**Revision behavior:** New documents enrich **one** Canonical Study; accepted earlier revisions are preserved. User changes to audience, question or layout cannot rewrite source observations. Conflicting and historical claims remain distinguishable; â€œlatest file winsâ€ is forbidden unless supported by specific source evidence.

**If the user asks about something outside existing coverage:** Give a useful partial answer where safe, then offer â€œCheck more of my uploaded documentsâ€ with a clear scope description. â€œThese documents don't show...â€ is only valid when reviewed scope actually supports that statement.

### Screen E â€” Reports

**Purpose:** Turn an accepted intent analysis into a coherent, useful output for a chosen audience, without copying or modifying the Study.

**Stable controls:** Ask/goal, audience **Customer / Professional-format**, source scope, report purpose, allowed emphasis and layout choices, **Generate**, prior results/history. Professional-format means denser presentation; it does **not** grant access to anyone else's Hive. External sharing and professional editing require separate approvals.

**Independent results:** Every Generate action has its own run ID and a pinned Study revision. A failed new report preserves older accepted reports and links. Show generation state and error/retry honestly.

**A2UI report surface:** Dynamic composition from accepted analysis and allowlisted components. Reports can combine summary, key findings, timing, comparison, question list, evidence table and, when justified, chart/timeline/checklist. All case claims are citation-bound; qualified interpretations and general knowledge are explicitly labeled. The model does not choose its own authorization, source files, executable code, database queries or unrestricted external actions.

**Customer view:** Plain, calm, approximately eighth-grade reading level; few primary conclusions, clear questions and uncertainty, expandable provenance. **Professional-format view:** Source-by-source chronology, typed values, evidence matrix, competing claims, coverage and caveats, original quotes and traceable calculation inputs. Same underlying accepted Study and analysis, subject to authorized access.

**History and viewing:** Saved results show created date, question, audience, Study revision and current/previous state. Read-only output initially; exports and external sharing remain gated until policy/format/security decisions are made.

### Screen F â€” Evidence view (deep link / side drawer)

**Source chip is an interaction, not decoration:**

1. Tap a chip such as `Initial IEP Â· p.7`.
2. Authorize source access server-side.
3. Open physical page 7 in place (drawer on desktop, full-screen sheet on mobile), with exact quote and optional verified region highlight.
4. Show â€œWhat this supports,â€ the fact ID/status, raw value and (if different) normalized value or derivation method.
5. Return to the originating sentence/table cell with focus restored.

A chart mark, comparison row or report sentence must also offer this evidence path. For multi-source claims show **all** relevant source chips. If page viewer or quote anchor is unavailable, show the limitation rather than pretending the link worked.

### Screen G â€” Account, privacy and deletion

Fixed product UI, never model-generated. Show current data use/privacy policy, account controls, retention policy, access settings and protected deletion actions. Preserve the previously approved **30-day recoverable account deletion** decision as a *deferred implementation*, not a claim that its workflow already exists. Distinguish Hive archive, confirmed Hive deletion, document deletion and account deletion. All require server-side authorization, explicit confirmation and safe partial-failure recovery. A2UI has no access to deletion commands.

## 5. Core interaction journeys

### Journey 1: first-time customer

1. Sign up/sign in â†’ My Hives â†’ **New Hive**.
2. Name the Hive â†’ arrive in Documents with an honest empty Study.
3. Upload documents â†’ each source appears immediately with accurate upload/read status.
4. Describe desired outcome before or after upload; no mandatory domain interview or Pack selection.
5. Processing shows the actual stages; if missing source quality/permissions, UI asks one focused question or offers a repair action.
6. Accepted Study appears; initial answer/report opens in a validated A2UI region, with working source chips.
7. Follow-up question or add documents â†’ reuse existing verified knowledge; new Study revision only when new accepted evidence warrants one; earlier reports preserved.

### Journey 2: add documents after a report

The user uploads later material to the **same Hive**. UI shows which files are new or possible duplicates/revisions, what is being checked, and what changed *once verified*. Accepted prior Study/report remain available during a failed update. â€œChangedâ€ is shown with specific before/after source support and dates; an uploaded newer file is not automatically more authoritative.

### Journey 3: professional-format analysis (owner self-service initially)

Owner chooses professional-format output from their own Hive, sets purpose/source scope/questions, generates an evidence-dense report pinned to the same Study. A user cannot grant third-party access simply by choosing â€œProfessional.â€ Shared access, professional corrections and export require separate owner approval and authorization design.

### Journey 4: a cited finding leads to original source

User opens a source chip from a dynamic A2UI card. The viewer opens the cited file/page with a highlighted quote if a reliable anchor exists, plus original value, interpretation/verification status and return-navigation. If authorization fails, a safe denial replaces the original; no source text leaks.

### Journey 5: blocked and partial states

A corrupted or unreadable source remains listed, with actionable error and exact scope. Study/analysis may produce a qualified partial result when policy allows but cannot label unreviewed content â€œnot found.â€ Failed runs leave accepted snapshots/results unchanged. Recovery reuses immutable run identity when retrying the same action; each new Generate is a new output run.

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
| `Chart` | Verified series, compatible units, calculation lineage | Chart mark â†’ row/fact/source; accessible table alternative |
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
3. **Independent disposition:** `VERIFIED`, `UNRESOLVED` or `REJECTED`, with reason. â€œVerifiedâ€ means accurately supported as *what the document states*, **not** that the statement is objectively true.
4. **Canonical Study:** accepted, versioned observations, relationships, conflicts and limitations.
5. **Intent Analysis:** question-specific supported findings, derived calculations, unknowns and interpretations, pinned to a Study revision.
6. **A2UI report/view:** presentation of authorized accepted material; it does not create truth.

**UI language:** â€œYour documents sayâ€¦â€, â€œWorth askingâ€¦â€, â€œThese records donâ€™t includeâ€¦â€ **when scoped**. Avoid â€œAI provedâ€¦â€, â€œviolatedâ€, â€œguaranteedâ€, or â€œno evidenceâ€ based merely on absent extraction. For receipts, describe what was *purchased*, never what was *consumed*. For high-impact legal/financial/eligibility situations, clearly distinguish source claims, professional questions and qualified general information.

## 8. Product design system (unchanged brand authority)

**Color meanings:** Cell Blue `#3B7CF6` actions/focus; Coral `#EF5143` missing/blocked; Honey `#F6B826` change/source chips; Leaf `#2FA35A` checked/settled. Text uses accessible deep variants (`#1A56C4`, `#B33A2E`, `#7A5200`, `#197040`); most surfaces use Paper `#FFFFFF`, Mist `#F4F6F8` and Ink `#1F2328`. Never color-code children or people as good/bad.

**Typography:** Outfit for headlines/wordmark, DM Sans for UI/body, Source Serif 4 for verbatim quotes only, JetBrains Mono for source chips/data references only; use legitimate font licenses and deployment procedures, do not embed font binaries from the guide.

**Signature components:**

- **Source chip:** Honey wash, document role + physical page; clicking opens the original page; not a filename or a decorative tag.
- **Four-color input ring:** Around the main intent input on hover/focus, restrained and accessible.
- **State bar:** Exactly **Needs you Â· Changed Â· Missing Â· Checked**, in that order, using correct semantic colors and grounded counts.

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

Documents tab shows eight source files. Study A2UI composes **Timing â†’ Evaluations â†’ Goals & Services â†’ Plan vs recommendations â†’ Questions worth asking**, each source statement grounded with chips. A customer receives a calm meeting brief. Professional-format Report shows per-source evidence comparisons and missing/unresolved items. No automatic compliance verdict or school-blame language.

### Synthetic grocery receipt collection

Twenty receipts produce a Study view with **Purchases by category â†’ Evidence-backed spend â†’ Known classification vs unknown â†’ Store/unit comparisons**. Upload ten more receipts into the same Hive; an updated Study revision allows a later organic-product question. Purchase is not consumption. Unknown organic labels remain unknown; incompatible package sizes are not silently compared.

### Synthetic financial / bankruptcy folder

Study A2UI composes **Source inventory â†’ dated income/debt claims â†’ competing balances â†’ referenced documents missing from the upload â†’ questions for counsel**. The system does not make definitive chapter, eligibility or legal-outcome decisions on unreviewed materials. Sources and as-of dates remain visible.

## 12. V3 feature preservation checklist

| V3 requirement/decision | V4 UX handling | Status |
|---|---|---|
| R01; MD-01..05 | Authenticated My Hives, idempotent Create, owner isolation, empty Study until accepted processing | **Retain** |
| R02; OD-01 | PDF, PNG, JPG/JPEG, DOCX; 10 successful Free uploads / UTC month across Hives; visible errors | **Retain** |
| R03â€“R06, R19 | Free-form intent, optional before/after upload; intelligent source discovery; real processing stages | **Retain; enrich** |
| R07, R15, R20â€“R21 | Physical-page source chips, explicit evidence trust, unreadable/not-reviewed scope | **Retain; deepen** |
| R08â€“R11, R17, R22â€“R23, R36 | One evolving Study; incremental evidence; repeat intents; conflicts/revisions retained | **Retain** |
| R12â€“R14, R24â€“R28 | Customer/pro output, unique Generate runs, pinned history, validated dynamic A2UI | **Retain; enrich** |
| R16 | Pack-free normal path; optional specialist overlays not forced in consumer UX | **Retain** |
| R18 | Attributed correction capability remains a permission/design gate | **Retain gated** |
| R25 | Deterministic calculations; drill to method and source inputs | **Retain** |
| R29â€“R30, R32â€“R34 | Server-side access checks, high-impact caution, authorized targeted source re-open, recovery/privacy | **Retain** |
| OD-06 / OD-07 | No failed-run Study promotion; full-scope processing coverage; targeted scope explicit | **Retain** |
| OD-11 | PKCE auth callback and approved email confirmation behavior | **Retain** |
| OD-12 | 30-day recoverable account deletion, with post-retention cleanup; implementation deferred | **Retain decision** |
| OD-03, MD-05 | Owner-only initial authorization; no unapproved collaborators or professional cross-user rights | **Retain** |
| R26â€“R27 | Universal declarative output rendered in HiveForYou-native components | **Expand via A2UI** |
| R35 | Fresh end-to-end real document/browser test and recovery checks needed before claiming complete product behavior | **Retain pragmatically** |

**V3 infrastructure-specific assumptions (Oracle, Inngest, Python Reader, old schemas/rules)** are *not* UX/product features and must not silently become V4 architecture requirements. The founder selected a clean V4 repository and a simplified runtime direction; exact backend execution strategy remains a separate design decision.

## 13. Minimum V4 UX slices (build from a real experience)

| Slice | User-visible result | Prove with synthetic documents |
|---|---|---|
| **UX-1 Foundation** | Brand-faithful landing, auth, My Hives, create/open Hive, fixed three-tab shell | Auth and Hive shell work; **primary create path requires intent + document (D-026)**; no fabricated Study |
| **UX-2 Documents** | Upload/register source files, accurate registration status, file errors, quota; **read/view when approved** | PDF/image/DOCX registration (D-027); **page navigation and viewer deferred** past current V4-003 slice; safe failed upload |
| **UX-3 First Study** | Real pack-free extraction `hive-extract/1` â†’ independent evidence â†’ one accepted Study revision | Synthetic single document then multi-document with working source chips |
| **UX-4 First A2UI** | Fixed Study screen + one validated dynamic evidence-bound results region; plain fallback | Different intents produce different allowed layouts from the same accepted data |
| **UX-5 Reports** | Customer/pro-format Generate, independent history, prior results survive failure | Two different presentations pinned to Study revision |
| **UX-6 Incremental** | Add source, accepted Study revision updates, differences and history; target enrichment | Grocery 20 â†’ 30 in same Hive, then different question |
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

**Approve or revise this experience contract before implementation.** Then design a detailed, clickable **Documents â†’ Study â†’ Report** V4 prototype using synthetic source evidence and the brand guide, and implement the first authenticated upload-to-cited-answer vertical slice. Keep V3 intact as reference; no V4 repository, deployment or data change is claimed here.

---

**Source basis:** Founder decisions in this conversation (new V4 repo; product feature continuity; B: application-first with rich A2UI; `hive-extract/1`, `hive.doc-extraction/1`; `hive-prep/1` remains an IEP-specific stand-alone one-pass test); attached V3 `HiveForYou-PRODUCT-REQUIREMENTS.md` v1.2.1 and *HiveForYou Brand Guide* v1.0; A2UI project documentation (https://a2ui.org/, https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/). Product behavior described above is proposed for V4, not represented as implemented.

## 16. Proactive Analytical Intelligence and Scenario Explorer (2026-10-31 proposal)

Preserve **Documents Â· Study Â· Reports** and the stable authorized shell. After a verified Study update, **Study** may surface a restrained `Suggested analyses` area: 2â€“5 relevant suggestions with one-sentence value, inputs considered, missing prerequisites, and states `Suggested / Ready / In progress / Supported / Partial / Blocked`. A suggested question is not a computed finding; don't imply all possibilities have been analyzed.

**Analytical insight card:** question answered; concise result; supporting source chips; calculation/rule/method drawer; coverage limitations; `Explore what-if` and `Add to report` only where supported. Unreadable or incomplete source scope cannot be labeled not found.

**What-if workspace:** input `What if â€¦?`; explicit **Baseline (from documents)** vs **Assumptions (hypothetical)** vs **Results (conditional)**. Allow edits to safe typed scenario parameters, pin source Study revision, compare variants, open dependency graph with uncertain/missing edges, surface sensitivity only when calculated, and explain when no numeric estimate is warranted. User can save/rename scenario without modifying evidence. High-impact result includes `Questions to discuss with a professional`, not legal/medical verdicts.

**New allowlisted component candidates:** `SuggestedAnalyses`, `AnalysisMethod`, `AnalysisCoverage`, `ScenarioAssumptions`, `DependencyView`, `ScenarioComparison`, `SensitivityTable` (only after schema approval). For every numerical card, show unit, method, inputs and source linkage. No generic model-created forms, code execution or data mutation through A2UI specs. Non-AI static view remains usable.

**Prototype proof:** synthetic bank debt records automatically produce a debt-composition suggestion; the user opens its evidence-backed result and tests an income-change scenario. Under an alternative IEP case, show plan comparison but not fabricated educational outcomes. Test blocked rule verification, unsupported causality, insufficient pages, bad fact ID and invalid formula as first-class UX, not hidden errors.

---

## 17. Prototype UI Adoption & Component Mapping (D-036 — 2026-10-31)

**Authoritative visual and interaction reference:**
- `prototype/HiveForYou V4 Prototype.dc.html`
- `prototype/hive-data.js` (synthetic reference only; never imported into `apps/web/`)
- `prototype/support.js` (prototype runtime only; never imported into `apps/web/`)
- `prototype/assets/` (`hiveforyou-logo.svg`, `hiveforyou-mark.svg`)
- **Explicitly unused:** `prototype/_ds/` (do not adopt its Modernist theme).

**Adoption invariants:**
1. Reproduce the prototype's page layouts, typography (`Outfit`, `DM Sans`, `Source Serif 4`, `JetBrains Mono`), colors, spacing, navigation, cards, tables, and interaction patterns in Next.js/React (`apps/web/`).
2. Reuse existing V4 React components and real API integrations rather than copying synthetic data or prototype JavaScript.
3. Preserve V3 authentication (`apps/web/src/server/auth/*`, `apps/web/src/lib/auth/*`) and V3 Vault uploader logic (`hive-vault-upload-adapter.ts`, D-027) unchanged.
4. Preserve mandatory written intent and document attachment at Hive creation (D-026).
5. Show actual backend states only; never display simulated Studies, evidence, coverage matrices, calculations, or reports as real.
6. Keep **Documents · Study · Reports** as the primary Hive navigation.
7. Adopt prototype screens ticket-by-ticket; keep **V4-003** as the only active engineering ticket (Documents page scope only).

### 17.1 Full Prototype-to-React Component Mapping

| Prototype region (`HiveForYou V4 Prototype.dc.html`) | Existing V4 React component(s) (`apps/web/src/`) | Preserved V4 functionality & backend wiring | Ticket gate |
|---|---|---|---|
| **Global tokens, fonts & focus ring** (`<helmet>`, lines 10–23, `RING` line 725) | `app/layout.tsx`, `app/globals.css`, `tailwind.config.ts`, `lib/brand-assets.ts` | Brand CSS variables (`--color-*`), Google fonts (`DM Sans`, `Outfit`, `Source Serif 4`, `JetBrains Mono`), `.hive-composer` 4-color conic ring | V4-001 / V4-003 |
| **Public Landing** (`isLanding`, lines 30–122) | `app/page.tsx`, `components/LandingStart.tsx`, `components/HiveComposer.tsx`, `components/HiveWordmark.tsx` | Real auth state (`getOptionalAuthenticatedUser`), guest draft persistence (`saveGuestDraft`), mandatory intent + ≥1 file in `HiveComposer` (D-026); signed-in owners create the Hive directly from this composer (D-037); omit synthetic sample-case matcher (`classify`, `Explore the sample case`) | V4-002 / V4-003 |
| **Sticky Inner Header & Breadcrumb** (`isInner` / `isApp`, lines 124–146) | `components/app-header.tsx`, `components/hive-workspace-layout.tsx`, `components/HiveWordmark.tsx` | Logo (`HiveAppLogo`), `My hives / {{ hiveTitle }}` breadcrumb, `/account/password` link, `signOutAction` form; omit prototype `<select aria-label="Sample case">` and `Synthetic data` badge | V4-001..V4-003 |
| **Hive Primary Tabs** (`isApp` nav, lines 147–153) | `components/hive-tab-nav.tsx`, `components/hive-workspace-layout.tsx` | Next.js `<Link>` routes for `/hives/[hiveId]/documents`, `/study`, `/reports`; active `2px solid #3B7CF6` indicator and real count badge on `Documents` | V4-001..V4-003 |
| **My Hives** (`isHives`, lines 156–203) | `app/hives/page.tsx`, `components/hives/MyHivesPanel.tsx`, `components/hives/HiveCard.tsx`, `components/hives/HiveCardMenu.tsx` | Server-loaded + `fetchMyHives()` refresh, `HiveCardMenu` actions, whole-card link, empty state, `New Hive` → D-026 `CreateHiveModal` (no composer on this page, matching the prototype); card footer shows only real values (`Created`, Study `—`, `None yet`); omit `Preview empty state` toggle, status pills and simulated work-plan progress bar until Study/tasks exist | V4-002 / V4-003 |
| **Create Hive Flow** (`isCreate`, lines 205–240) | `components/hives/CreateHiveModal.tsx`, `components/HiveComposer.tsx`, `components/hives/useCreateHive.ts`, `components/hives/create-hive-flow.ts`, `components/hives/SourceFilePicker.tsx` | D-037: the same `HiveComposer` as Landing (intent textarea, paperclip, removable document chips, single `Create Hive`) inside a responsive dialog (bottom sheet on mobile); no name/description fields — provisional name from the intent (`provisionalHiveName`). D-026 validation (intent 1–2000, ≥1 valid PDF/PNG/JPG/DOCX ≤25 MB); idempotent staged `createHive` → `createIntentRequest` → `uploadSelectedSourceFiles` with per-stage errors and support reference; completed stages are skipped on retry; do not replace with simulated `Suggest a plan` | V4-002 / V4-003 |
| **Documents Page** (`isDocs`, lines 242–300) | `app/hives/[hiveId]/documents/page.tsx`, `components/hives/DocumentsPanel.tsx`, `components/hives/SourceFilePicker.tsx`, `components/hives/source-file-upload.ts` | Server `listHiveSourceDocumentsWithV3Vault`, client `fetchSourceDocuments` + `fetchUploadQuota`, `uploadSelectedSourceFiles` (D-027 V3 Vault registration + SHA-256 scan + 10/month quota), error/retry with `correlationId` | **V4-003 (ACTIVE)** |
| **Statement / Record Coverage Matrix** (`hasMatrix`, lines 302–329) | *Deferred* (future Documents coverage component) | Requires verified extracted document periods/accounts (`hive-extract/1` + Study merge); must not render synthetic cells in V4-003 | Deferred (V4-005+) |
| **Study Workspace** (`isStudy`, lines 332–494) | `app/hives/[hiveId]/study/page.tsx`, `components/tab-empty-state.tsx` | Shows honest empty state (`TabEmptyState variant="study"`, matching prototype `studyEmpty` lines 334–340) until accepted Study revision exists | Deferred (V4-005 / V4-006+) |
| **Reports Workspace** (`isReports`, lines 496–570) | `app/hives/[hiveId]/reports/page.tsx`, `components/tab-empty-state.tsx` | Shows honest empty state (`TabEmptyState variant="reports"`, matching prototype `noRepView` lines 565–567) until report generation exists | Deferred (V4-007) |
| **Contextual Detail Drawer** (`hasDrawer`, lines 572–623) | *Deferred* (future Study task/exception/operation drawer) | Requires persisted work items, exceptions, or deterministic operations | Deferred (V4-006+) |
| **Source Page & Evidence Viewer** (`hasViewer`, lines 625–692) | *Deferred* (future authorized page/evidence viewer modal) | Page reading into `document_pages` now exists (D-038); still requires verified quote anchors and an authorized viewer | Deferred (F-007 / V4-005) |
| **Draft Request Modal** (`hasModal`, lines 694–710) | *Deferred* (future missing-record request draft modal) | Requires missing-evidence exceptions register (F-036) | Deferred (F-036) |

### 17.2 Prototype Components Needed for V4-003's Documents Page (`isDocs`)

Within active ticket **V4-003**, only the **Documents page** (`isDocs`, lines 242–300) and its enclosing workspace shell (`isInner` / `isApp`, lines 124–154) are in scope:

1. **Workspace Container & Header (`HiveWorkspaceLayout`, `HiveTabNav`)**:
   - Container width `max-w-[1240px]`, padding `py-8 px-[clamp(16px,3vw,32px)] pb-16`, vertical rhythm `gap-6` (`24px`) on `#FFFFFF` (`bg-paper`).
   - Breadcrumb (`My hives / <Hive name>`) and sticky tab bar (`Documents`, `Study`, `Reports` with `44px` height, `2px solid #3B7CF6` active bottom border, and real document count on `Documents`).
2. **Documents Header Bar (Prototype lines 244–253 → `DocumentsPanel.tsx` + `AddFilesButton` in `SourceFilePicker.tsx`)**:
   - Heading: `<h1 className="font-brand text-[30px] font-semibold text-ink">Documents</h1>`.
   - Summary / Quota subtitle (`#documents-quota`, `15px` `#4A525C`): real registered count (`"N files"` or `"No documents yet"`) paired with live Free monthly quota (`"${remaining} of ${limit} free uploads left this month · PDF, PNG, JPG or DOCX, up to 25 MB each"`).
   - Action button: `AddFilesButton` styled as prototype's `Add files` control (`h-10 px-4 rounded-[12px] border border-[#E3E6EA] bg-paper text-[14px] font-medium text-ink hover:bg-mist`, upload-arrow SVG icon), wired to hidden `<input type="file" multiple accept={SOURCE_FILE_ACCEPT} />`.
   - **Omit:** Prototype's `Load synthetic sample documents` button (`notLoaded` / `loadSample`).
3. **Drag-and-Drop Upload Zone (Prototype lines 255–262 → `DocumentsPanel.tsx`)**:
   - Interactive dropzone (`onDragOver`, `onDragLeave`, `onDrop`, plus click/keyboard activation via `AddFilesButton` / file input) accepting `PDF, PNG, JPG, DOCX` up to `25 MB` (`MAX_FILES_PER_BATCH = 10`), disabled when `busy || remaining === 0`.
   - Rest state: `border-[1.5px] border-dashed border-[#C9CED5] bg-paper rounded-[20px] p-6`; drag-over state: `border-[#3B7CF6] bg-[#E8F0FE]`.
   - Copy: primary line `"Upload whatever you have — old, partial or out of order is fine."` (`15px font-medium text-ink`); secondary line `"Drop PDF, PNG, JPG or DOCX files here, or select Add files. Each file is checked and stored privately in your account."` (`13px text-[#6B737D]`, replacing the prototype's browser-only disclaimer).
4. **In-Flight Upload Status Banner & Batch Queue (Prototype lines 264–270 → `DocumentsPanel.tsx` + `SelectedFileList` in `SourceFilePicker.tsx`)**:
   - When `busy` is true, render the prototype's blue status bar (`bg-[#E8F0FE] rounded-[12px] px-[18px] py-3.5 text-[14px] text-[#1A56C4]`) showing real upload progress (`"Uploading and checking your documents…"`), alongside `SelectedFileList` for per-file states (`ready`, `invalid`, `uploading`, `checking`, `registered`, `rejected`, `failed`) and specific rejection messages (`TYPE_MISMATCH`, `SIZE_MISMATCH`, `MALWARE_DETECTED`, `QUOTA_EXCEEDED`).
5. **Documents Inventory Table (Prototype lines 272–300 → `DocumentsPanel.tsx`)**:
   - Replace the temporary `<ul>` card list in `DocumentsPanel.tsx` with the prototype's rounded table container (`border border-[#E3E6EA] rounded-[20px] overflow-auto`, `<table className="w-full min-w-[860px] border-collapse text-[14px]">`).
   - Columns mapped to real `SourceDocument` fields from `@hiveforyou/contracts`:
     - **File**: 16×16 document SVG icon (`#6B737D`) + `document.fileName` (`font-medium text-ink`).
     - **Identified as**: `TYPE_LABELS[document.mimeType]` (`PDF`, `PNG`, `JPG`, `DOCX`) + formatted byte size (`formatSize(document.byteSize)`).
     - **Period**: `Added ${dateFormat.format(new Date(document.createdAt))}` (since statement-period extraction awaits V4-004).
     - **Pages**: `—` (physical page counting/reading deferred past V4-003).
     - **Read**: 56×4px progress track (`bg-[#E3E6EA]`, fill `0%` when `document.readStatus === "PENDING"`) + label `"Not read yet"` (`12.5px text-[#4A525C]`).
     - **Status**: semantic pill (`h-6 px-2.5 rounded-full text-[12px] font-medium`):
       - `REGISTERED` → `"Added"` (`bg-[#E6F4EA] text-[#197040]`)
       - `PENDING` → `"Upload not finished"` (`bg-[#FEF3D6] text-[#7A5200]`)
       - `REJECTED` → `"Not accepted"` (`bg-[#FDEDEB] text-[#B33A2E]`)
     - **Notes**: status detail or failure badge (`rejectionMessage(document)` in Coral wash `#FDEDEB` / `#B33A2E` for `REJECTED`; `"Add this file again to finish uploading it."` in Honey wash `#FEF3D6` / `#7A5200` for `PENDING`; `"Page reading comes next"` in `#6B737D` for `REGISTERED`).
6. **Error Alert & Recovery (`DocumentsPanel.tsx`)**:
   - Preserve the `role="alert"` error banner with `loadError.correlationId` (`Support reference: ...`) and `Try again` button calling `refresh()`.
7. **Deferred Components on Documents Page**:
   - `hasMatrix` (Statement/Record coverage matrix, lines 302–329) and `hasViewer` (Source page & evidence viewer modal, lines 625–692) remain unrendered in V4-003 so the UI never fabricates page counts, read percentages, or coverage cells.
8. **Read Documents (D-038 — V4-003 scope change, 2026-11-01)** (`DocumentsPanel.tsx`, `ReadDocumentsModal.tsx`, `useDocumentReads.ts`, `document-read-progress.ts`, `HoneycombActivity.tsx`):
   - **Button:** primary **Read Documents** beside `Add files`, enabled only when at least one registered document has `readStatus` `PENDING` or `FAILED`, no read is active and nothing is uploading. A polite hint states the real count ("2 documents need reading." / "Every added document has been read."). While a read is active the button becomes **Show reading progress**. A start failure shows the safe message and support reference inline.
   - **Row status:** pills come from the latest recorded attempt or `readStatus`: Added (not read yet) · Waiting · Reading · Saving · Checking · Read · Partly read · Can't be read · Didn't finish, with the recorded safe message as the note.
   - **Modal:** reuses V3's processing-modal pattern in V4 tokens — Living-Hive honeycomb (processing / success / failed), title and sub copy derived only from recorded statuses ("Getting started", "Reading your documents", "All N documents are read", "Reading finished", "Reading didn't finish"), counter "N of M documents read" with a per-document segment bar (`role="progressbar"`), a 5-step row (Waiting · Reading · Saving · Checking · Done) that follows the slowest active document, and one row per document with its pill, detail and, for failures, its support reference. Footer: **Run in background** while active; **Close** and **Try again** (retryable failures only) when finished. Escape closes, focus is trapped and returned, reduced motion disables the count pulse and honeycomb motion.
   - **Durability:** the modal reads `GET …/document-reads` every 3 s only while a read is active; it reopens on page load if reading is still running (unless the owner chose **Run in background** for that same set of reads), refreshes when the tab becomes visible, shows a reconnecting notice after three failed polls and an "auth expired" notice for a lapsed session, and refreshes the document list when every read settles. Nothing is shown as read until the server records `SUCCEEDED`/`PARTIAL` after verification.
