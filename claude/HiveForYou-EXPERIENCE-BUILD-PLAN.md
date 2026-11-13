# HiveForYou — Experience build plan (screens + case workflow in one order)

**Date:** 2026-11-13 | **Status:** proposed, waiting for founder approval | **Merges:** `claude/HiveForYou-INTAKE-PLAN.md` (IN-1 to IN-8, F-032 to F-039) with the experience design of 2026-11-13 (four ways in, onboarding by door, free/paid grid, eight search-first screens) | **Design canvas:** https://claude.ai/artifact/1VCcoCD2Tvmjntz3xko9Uv

**How it is built:** Cursor, one prompt at a time. Each prompt stops for review and does not commit. The founder commits and pushes from PowerShell; Vercel deploys `main`; the Oracle host is pulled only when `infra/oracle` changes; migration SQL is run by hand before the code that needs it.

## 1. The idea in one paragraph

One case (a Hive) with two seats: a professional and a client. The four ways in differ only in who sits down first. Every screen has one input and one main action. The professional's home answers "which case needs me today?"; the client's home answers "what is asked of me?". The client seat is always free; money is charged for the professional seat from the second client case.

## 2. What exists, what is designed, what is missing

| # | Screen (canvas) | In the app today | Needs | Ticket |
|---|---|---|---|---|
| 1 | Front page: wordmark, one input, two quiet buttons | Landing with composer, three explainer columns, starter chips | Restyle; "I work with clients" door | UX-1 |
| - | Header input on every signed-in screen | Breadcrumb header; "Ask" input lives in the Hive page | Move the input into the header | UX-1 |
| 6 | Professional home: cases as results, sorted by attention, filters | "My hives" card grid | List, status sentence, ranking, filters | UX-2 |
| 7 | Case board: "Next for you", findings, side panel | Nothing (Documents, Study, Reports tabs only) | "Case" tab built by code from the study | UX-3 |
| 2 | Professional's first case: practice type, two starts | Create-Hive modal | Type-ahead practice type; "My client has them" | IN-2 |
| 3 | Invitation email | Nothing | Membership, magic link, email provider | IN-2, IN-3 |
| 4 | Client to-do on a phone, one item at a time | Nothing | Member-visible requests | IN-2 |
| 8 | Client home | Nothing | Membership and roles | IN-2 |
| 5 | Invited professional: case summary, Take or Decline | Nothing | Handoff summary (UX-3) plus membership | UX-4 |
| - | Paywall at the second client case; plan card | Upload quota only | Plans and limits | UX-5 |
| - | Standing intake link | Nothing | Paid; creates a new case only | UX-5 |

Not drawn yet and needed before their ticket: sign-in and the first-read moment for an individual (UX-1 uses the existing auth screens restyled), the "invite your client" form (IN-2), the paywall screen (UX-5).

## 3. Build order

| Step | Ticket | Contents | Migrations | Done when |
|---|---|---|---|---|
| 0 | IN-1 | Corpus and parser tests | none | **Done 2026-11-13**; commit it |
| 0 | UX-0 | Green test suite (lint and one stale test) | none | `npm test` passes |
| 0 | IN-1b | Paid study run on `intake-smallbiz`; export as a test fixture | none | fixture committed under `eval/` |
| 1 | UX-1 | Search-first front page and header | none | front page and header match the canvas |
| 1 | UX-2 | Home as a results list | none | cases sorted by attention with filters |
| 1 | UX-3 | Case tab v1 and handoff summary, on today's data | none | board renders on three corpora |
| 2 | IN-2 | Shared case, magic link, requests; screens 2, 3, 4, 8 | yes | security checklist passed on test data |
| 2 | IN-3 | Email reminders; "Remind now" on home and board | yes | reminders send and stop |
| 2 | IN-4 | Board completes: requests by holder, client "Your to-do" | none | demo steps 1, 2, 6, 7 |
| 3 | UX-4 | Individual invites a professional: summary, Take or Decline | small | flow 3 works end to end |
| 3 | UX-5 | Plans, paywall at the second client case, standing intake link | yes | grid in section 5 enforced on the server |
| 4 | IN-5 to IN-8 | Parties and records, reconcile, record questions, deadlines, action items, draft check, overlay | yes | as in the intake plan; each lands on the board |

Steps 0 and 1 need no database change and no security review, so they can ship to production as they finish. Step 2 is gated as before: security sign-off on F-028 and the provider and retention decisions (D-017/D-018) before any real client file.

**Why screens first:** the board, the home list and the header are where every later feature shows up. Building them on today's data gives a demo within three prompts and means IN-2 onward only add rows to screens that already exist.

## 4. Rules for every screen

1. **One input, always present.** Front page: the composer. Signed in: the same input in the header.
2. **One main action per screen.** One filled button; everything else is a quiet button or a link.
3. **Results, not dashboards.** A name as the link, one plain sentence, one line of counts as coloured text.
4. **An answer on top, facts on the side.** "Next for you" is one card; the side panel holds readiness, dates and exits.
5. **White space over boxes.** White page, few borders, state colour only as small text.
6. **Built by code.** Board, home ranking and status sentences are computed from stored data with no model call, so they are free, instant and testable.
7. **Generic words only (D-053).** Screens say case, document, request, question, date. Pack wording appears only when a pack is pinned.
8. **Every claim opens its source (D-011).** Any amount, date or finding on the board carries a source chip.
9. **Phone first for the client.** 44 px targets, one item at a time.
10. **Never promise what is not built.** No placeholder tabs, no "coming soon", no feature flags (D-008).

## 5. Free and paid (from the design thread; caps and price still open)

| Capability | Own matter, solo | Invited client | Professional, first case | Professional, paid |
|---|---|---|---|---|
| Cases | 1 active | any invited | 1 client case | unlimited |
| Summaries, study, missing list, Customer report | yes | yes | yes | yes |
| Professional report | no | once shared | yes | yes |
| Send and accept requests, reminders, private notes, case board | no (to-do view) | responds only | yes | yes |
| Export | no | no | this case only | yes |
| SMS reminders, standing intake link, second professional | no | no | no | yes |

Limits are enforced on the server (RPC and route), never only in the screen.

## 6. Decisions the founder still owes

| # | Decision | My suggestion | Blocks |
|---|---|---|---|
| 1 | Free professional case: one forever, or a time-limited trial | One forever | UX-5 |
| 2 | Can an individual pay for more on their own matter | Not at launch | UX-5 |
| 3 | Price and caps | - | UX-5 |
| 4 | Client-created case: what a professional who took it is guaranteed | Guaranteed export | UX-4 |
| 5 | Several invited professionals in one case | Separate view each until one takes it | UX-4 |
| 6 | Client sees the Professional report before review | Draft until the professional shares it | IN-2 |
| 7 | Do client uploads count against the professional's allowance | Yes, the professional's | IN-2 |
| 8 | Email sending domain and provider | - | IN-2, IN-3 |
| 9 | Feature ids for the new screens | F-040 shell, F-041 home list, F-042 intake link, F-043 plans (confirm they are free) | docs |

## 7. Cursor prompts

Paste the shared constraints with every prompt.

```
Shared constraints for every UX and IN prompt:
- Domain-agnostic (D-053): code uses only generic nouns (case, party, record, source, request,
  question, deadline, action item, draft, decision). No domain words in apps/ or packages/ source
  or tests; the domain-word lint must pass. Domain meaning comes only from pack data.
- Every feature must work with no pack and must be tested on eval/corpora/intake-smallbiz,
  eval/corpora/special-ed-l001 and, where it applies, no-anchor-household (real-pack and
  real-corpus tests live under eval/).
- D-055 no new triggers; D-008 no feature flags; D-011 no source, no claim; client statements are
  labelled and never become document facts.
- Never weaken or skip a test to make it pass. If a test shows a real defect, stop and report.
- Screens: brand tokens from tailwind.config.ts and globals only (no new hex values); 44px
  minimum targets; visible focus; labels for every input; one filled button per screen.
- Migrations: new files only; start from the latest definition of any function you rewrite; give
  me the file names, I run them by hand.
- Full tests (8 GB), typecheck, clean build, lint. Stop and report. No commit.
```

### UX-0 — Green test suite

```
Scope: three small fixes so `npm test` passes. No behaviour change beyond item 3.

1. packages/contracts/src/pipeline/domain-word-lint.test.ts: the pack-derived rule forbids every
   pack Terms label. The intake pack's term "Schedules" collides with the ordinary verb (route
   tests "POST schedules no work...", a fixture file name). Add a small, commented set of ordinary
   words that are skipped when term labels are collected, containing only "schedules". Add an
   assertion that another single-word term from that pack is still enforced.
2. "petition" is a real domain word and stays forbidden. Reword the two places that use it:
   - apps/web/src/components/hives/progress-elapsed.test.tsx line 19: use a neutral step label
     that still contains "page 24 of 35".
   - packages/contracts/src/pipeline/canonical-gap-holders.ts line 23: replace
     "petition preparer|tax preparer" with "preparer". Add a test that a holder ending in
     "preparer" is still classified ASKER_OR_CLIENT and that existing cases are unchanged.
3. eval/document-gap-reconcile-iep.test.ts "reports ask-now count": it expects a title containing
   "consent for services" and gets "signed consent to evaluate". Find out whether the test or the
   pack v7 consent split is stale. Do not edit the assertion to make it pass. Report the cause
   and the smallest correct fix, then apply it only if it is a stale test fixture.
4. Report the test totals before and after.
```

### IN-1b — Study fixture for the new corpus (founder, then Cursor)

```
Founder: upload eval/corpora/intake-smallbiz/docs into a new Hive, run the study in the UI (paid,
synthetic data), then `npm run export-run -- <processingRunId> intake-smallbiz`. Do the same for
special-ed-l001 and no-anchor-household if no exported run exists.

Cursor: copy canonical.json and extract/*.json of each exported run to
eval/corpora/<corpus-id>/study-fixture/ and add eval/study-fixtures.test.ts that loads each
fixture through the existing contracts parsers and fails if one is missing or invalid. Report the
scorer output for intake-smallbiz against golden.json.
```

### UX-1 — Search-first front page and header (proposed F-040)

```
Scope: apps/web/src/app/page.tsx, components/LandingStart.tsx, components/HiveComposer.tsx
(presentation only), components/app-header.tsx, the place that renders HiveAskInput, and their
tests. No server, contract or database change.

1. Front page, signed out and signed in:
   - Header, right aligned: text link "For professionals" and a filled pill "Sign in" (signed in:
     one filled pill "My cases" to /hives).
   - Centre column, max 720px: the hive mark and the wordmark at about 52px; below it the question
     "What are you working on?" in regular weight at about 21px, muted.
   - The existing composer inside one pill-shaped field with a 2px ring that sweeps the four cell
     colours (conic gradient of the brand cell tokens) and a soft shadow; placeholder "Describe
     your situation, then add whatever documents you have"; a round attach button inside the pill.
     Selected-file chips, errors and the busy state keep working exactly as now.
   - Two quiet buttons under it: "Add documents" (opens the file picker) and "I work with
     clients" (signed out: /register with next=/hives?new=1; signed in: /hives?new=1).
   - One muted line: "Upload whatever you have. Old, partial or out of order is fine."
   - Remove the three explainer columns and the starter-situation chips. Footer: the tagline on
     the left, "How it works" and "Privacy" links on the right, and the existing privacy and
     not-advice sentence kept.
   - The guest-draft flow (saveGuestDraft, then sign-up) and the signed-in create flow are
     unchanged in behaviour.
2. Signed-in header (AppShell/AppHeader): mark and wordmark on the left (links to /hives); in the
   middle one pill input, max 680px; account button on the right. Remove the breadcrumb.
   - On /hives the input is "Find a case" and filters the list by name as you type (client side).
   - Inside a Hive the input shows the Hive name as a chip at its left edge and is the existing
     HiveAskInput ("Ask about these documents") with the same save behaviour and the same honest
     status line. Remove the old ask box from the Hive page so there is one input.
3. Page background is white (paper) on every signed-in page; drop card borders that only frame a
   page section. State colours stay as defined.
4. Tests: update app-header and landing tests; add tests for the two doors, the filter input and
   the ask input in the header. Keyboard order: input, attach, the two buttons.
5. Report with before and after screenshots of /, /hives and one Hive at 1280px and 390px.
```

### UX-2 — Home as a results list (proposed F-041)

```
Scope: /hives page, components/hives/MyHivesPanel.tsx and HiveCard.tsx, server/hives/hive-summary.ts,
one new pure module with tests. No database change, no new RPC: use what loadHiveOverview already
loads.

1. Pure module packages/contracts/src/hives/case-attention.ts:
   - caseAttention(input) returns { level: "needs_you" | "in_progress" | "ready", reasons[] } from:
     documents that could not be read, a failed or stalled run, documents not yet in the study,
     open conflicts, open requestable missing items, no study yet, no report yet.
   - caseStatusSentence(input) returns one plain sentence, most urgent reason first, generic words
     only (for example "2 documents could not be read." or "Everything is read and checked.").
   - rankCases(cases) orders needs_you, in_progress, ready, then most recent activity. Stable.
   - Unit tests with neutral fixtures for every reason and for ordering ties.
2. Extend HiveSummary with the counts those functions need, computed in summarizeHive from data
   already loaded.
3. The page becomes a list, not a grid. Each row: the case name as the link (about 20px), the
   status sentence, then one line of counts as small coloured text (need you, missing, checked)
   and the last activity. The row menu (delete) stays reachable.
4. Filters along the top with counts: All, Needs you, Ready. Do not add "Waiting on client" or
   "My own matters"; they arrive with membership (IN-2).
5. One filled button "New case" in the header opens the existing create flow. Empty state: the
   front-page composer.
6. Wording: "case" in the screen text; route and table names stay as they are.
7. Tests: list order, filters, empty state, a case without a summary still shows its name.
```

### UX-3 — Case tab v1 and handoff summary (F-032, today's data)

```
Scope: a "Case" tab, first in the Hive, built BY CODE from data the app already has (study,
missing list, timeline, conflicts, read state, reports). No model call, no database change.
Requests, client questions, action items and membership are not part of this ticket.

1. Pure builder packages/contracts/src/case/case-board.ts: buildCaseBoard(input, today) returns
   { next, findings[], readiness, dates[], exits[] }. `today` is passed in so day counts are
   testable.
   - next: exactly one item, chosen in this order: documents that could not be read; documents
     not yet in the study (rebuild); a dated item in the documents that is overdue or within 14
     days; open conflicts; open missing items; no report yet; otherwise "Nothing needs you".
     Each has a title, one sentence, and the route its button opens.
   - findings: conflicts (title, one sentence with both values as written, source refs); missing
     items grouped by holder; the study revision and whether newer documents are waiting.
   - readiness: missing items received / total; with a pinned pack also checks shown / total.
   - dates: future-dated timeline items with days remaining from `today`, overdue first, each
     with its source ref. With no dated item the section is omitted.
   - Deterministic and stable: same input, same output, same order.
2. Screen at /hives/[hiveId]/case: tab order Case, Documents, Study, Reports. Main column: the
   "Next for you" card with one filled button, then findings as results (title as link, one
   sentence, source chips). Side panel: case name, readiness lines, "Date in the documents" with
   days remaining and its source chip, then links: Handoff summary.
   /hives/[hiveId] redirects to Case when a study exists, otherwise to Documents.
3. Handoff summary at /hives/[hiveId]/case/handoff: one printable page titled
   "Case status as of <date>", the same content as the board with every item linked to its
   source, print styles for browser print-to-PDF, and a "Copy as text" button. No PDF library.
4. Labels: generic words in code; the pack's term and persona wording where a pack is pinned.
5. Tests: unit tests on neutral fixtures for every `next` branch and for ordering. Under eval/,
   using eval/corpora/<id>/study-fixture/ (stop if a fixture is missing):
   - intake-smallbiz with today = 2026-11-16: the dates section shows the response deadline
     December 7, 2026 with 21 days remaining and a source ref to 09_court_summons.pdf; the two
     golden conflicts appear in findings.
   - special-ed-l001: renders with no conflicts; the plan end date appears in dates.
   - no-anchor-household: renders with no pack.
   The expired-certificate day count is not required here; it arrives with validity rules (IN-7).
6. Report screenshots of the board for the three corpora and the printed handoff page.
```

### Later tickets (outlines; full prompts when step 1 is in production)

- **IN-2 Shared case, magic link, requests** (prompt in the intake plan), plus these screens: the first-case screen with a type-ahead practice type and the two starts ("I already have the documents", "My client has them" with name and email); the invitation email that names the professional and the count; the client to-do page, one requested item at a time with a progress bar, camera or upload, "I don't have this", and a finished state; the client home. The one signup question ("my own matter" or "cases for clients") sets the default landing only; role stays per case. Home gains the "Waiting on client" and "My own matters" filters.
- **IN-3 Reminders** (prompt in the intake plan), plus "Remind now" on the home row and the board.
- **IN-4 Board completes:** requests grouped by holder with age and due date, readiness from requests, last activity per member, the client's "Your to-do" from the same builder, next five actions.
- **UX-4 Individual invites a professional:** read-only case summary (the handoff page) for the invitee, "Take this case" or "Decline"; taking uses the professional's free case or plan; each invited professional has a separate view until one takes it.
- **UX-5 Plans and intake link:** plan and limits tables, server-side enforcement of section 5, the paywall screen at the second client case, the standing intake link that only creates a new case after the client verifies an email.
- **IN-5 to IN-8:** as in the intake plan. Each adds rows to the board: parties and records, reconcile results as findings, record questions on the client to-do, deadlines and validity in dates, action items, draft check.

## 8. First demo after step 1

1. Front page: one input. Drop in the eleven `intake-smallbiz` documents.
2. Home: the case appears at the top with one sentence saying what it needs.
3. Case tab: "Next for you", the two amount conflicts with their source chips, the response deadline with days remaining.
4. Handoff summary: print it; "the associate is out" is answered by one page.
5. Open the special-education case: the same screens, different words, no new code.
