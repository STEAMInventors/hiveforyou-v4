# HiveForYou — Screen-by-screen build plan and domain testing

**Date:** 2026-11-17 | **Status:** proposed, for AB to confirm | **Reference prototype:** `prototype/HiveForYou V4 Prototype.dc.html` (commit after `2e80450`, the "workspace look" pass) | **Builds on:** `claude/HiveForYou-EXPERIENCE-BUILD-PLAN.md` (decisions D1–D17, rules, deploy routine) and `claude/HiveForYou-FL-6a-PLAN.md` (FL-6a-2 to 6a-4 prompts).

**Goal:** finish the whole flow, one screen at a time, each screen fully working (data, permissions, empty and error states, phone and desktop, tests), matching the prototype. Then test one domain at a time with at least 20 synthetic cases each.

---

## 1. Decision D18 — the workspace layout (2026-11-17)

Replaces the top tabs (D6) and the left team pane of D17. Recorded here; copy into the build plan's decision table when confirmed.

| # | Decision |
|---|---|
| D18.1 | **Inside a hive** the page is a **sidebar + workspace**. The sidebar (236px, white) holds the logo, a hive card and the navigation. The top bar holds a breadcrumb: *All clients / <hive name> / <page>* (individuals: *Your hives / …*). Below 900px the sidebar becomes a row of scrollable buttons under the header and the breadcrumb hides. |
| D18.2 | **Hive card:** initials badge, hive name, one-line purpose; for firm hives "On it: <name> · <title>" with **one** link (Take it if it isn't yours, otherwise Hand over), and "<assistant> · automated" with Rename. |
| D18.3 | **Navigation.** *Hive:* Hive board (count of what needs you), Documents (count), Facts, Missing and conflicts, Reports (count). *More:* Timeline, Team notes (firm hives only), What happened. Each item has an outline icon. Only the board shows a "needs you" count, so nothing is counted twice. **No Work plan page in the app** (the planner left in V5, D-052); the prototype's Work plan page is prototype-only and is removed from it in S0. |
| D18.4 | **Workspace look.** Inside a hive: light grey workspace (`canvas` token), content in white cards (14px corners, 1px `line` border). Home, sign-in and the client's phone view stay white. This amends rule 3 ("white pages") for the hive workspace only. |
| D18.5 | **Type scale** inside the app: 21px page titles (Outfit 600), 16px section titles (600), 14px body and buttons, 12.5px notes and labels. Existing tokens `section`, `small`, `caption`; body inside the hive workspace uses `small`. |
| D18.6 | **Status** is a coloured dot and a word ("● Read", "● Missing"), not a filled pill. Colours keep their meaning: Cell Blue needs you, Coral missing, Honey changed, Leaf checked. |
| D18.7 | **Buttons:** one filled Cell Blue button per screen; every other button is white with a 1px border, 8px corners. Height 40px from 900px up, 44px below 900px (rule 7 holds on phones). |
| D18.8 | **Source references** (D-011) are quiet monospace links in Cell Blue on a pale blue tint; they open the cited page exactly as today. |
| D18.9 | **Study is split into pages:** Facts (what the documents establish, at a glance, pack sections, the question box "Add a question for the next study build", the study revision line), Missing and conflicts (what disagrees, what is missing, requests), Timeline (dated events). The old `/study` route redirects to Facts. |
| D18.10 | **Hive board** (firm client hive): the workspace column (headline, stage strip, Needs you card, Items card) plus the client pane on the right (conversation, one-line "Waiting on <client>", Remind now). Team notes and history move to their own pages. Individual's board keeps one column plus the side summary. |

---

## 2. The screens, in build order

One ticket per screen. Each ticket ships the screen **complete**: real data, authorisation in RLS and routes, loading, empty and error states, 390px and 1280px, keyboard and screen-reader basics, unit and end-to-end tests, and screenshots compared with the prototype. Shared constraints and the deploy routine are the ones in the build plan (section 4 and 5); CI checking is not part of AB's routine (Cursor runs lint and tests itself).

| # | Ticket | Screen (prototype) | What works when it ships | New data | Depends on |
|---|---|---|---|---|---|
| S0 | **FL-4b** Workspace shell | Sidebar, breadcrumb, hive card, grey workspace, cards, buttons, status dots, source links; Facts / Missing and conflicts / Timeline / What happened / Team notes routes | Every hive page sits in the new shell; Study is split into pages from today's data; nothing new is computed | none | — |
| S1 | **FL-6a-4** Front door | Signed-out home, "I work with clients" / "My own documents", describe your situation, sign-in by code | Both front doors reach a hive with a checklist | done in FL-6a-1 | S0 |
| S2 | **FL-3d** Professional home | Workspace home: rail (New client, Mine, Unassigned, Needs you, Waiting on client, Ready, All clients), glance tiles, client list with intake progress; individual's "Your hives" | Restyled to D18, counts from the same summary as the board | none | S0 |
| S3 | **FL-6a-1b** New client and invite | One screen: client name, email, matter type, starting checklist (editable), "Invite them to upload" | Hive created with the pack's checklist and the invitation sent | done in FL-6a-1 | S2 |
| S4 | **FL-6a-2** Client checklist and upload | Client's phone: welcome, checklist one item at a time, take photos / choose files, "Received ✓" at once | Multi-page photos into one document, HEIC, protected PDFs, instant receipt | done in FL-6a-1 | S3 |
| S5 | **FL-6a-3** Item check and staff actions | Item results (Checked / Needs a fix / Doesn't match / Needs review), Retake; staff Accept / Not needed / Ask again / Add item | Each upload is checked after reading; staff decide | small | S4 |
| S6 | **FL-6c** Documents page | Checklist by item with status dots, then the files table (identified as, period, pages, read, status, notes), drop zone, source viewer | One place to see what is in, what is missing, what each file is | none | S5 |
| S7 | **FL-4c** Hive board | Headline, stage strip (Collecting · n of m in → Attorney review → Closed), Needs you card, Items card with thread line, client pane | The intake view live from S5 data; stage moves with Ready for attorney review / Close intake | `hives.stage` if not yet present | S5, S6 |
| S8 | **FL-6b** Conversation | Client's conversation (fixed assistant messages), questions routed to the team, replies under the person's name, "Waiting on" line, Remind now, email digest (counts only) | Two-way loop without a model | yes (FL-6b) | S7 |
| S9 | **FL-12** Facts | Facts page with the source page **beside** the facts (the OpenAI layout), the question box, study revision and Accept | Every fact opens its page in the side panel, not a pop-up | none | S0 |
| S10 | **FL-13** Missing and conflicts | Filters (All, Needs you, Changed, Missing); each missing item has **Ask <client>** (creates a request); each conflict has Review with both sources side by side | Gaps become requests in one click | none (uses FL-6 requests) | S8 |
| S11 | **FL-14** Timeline | Dated events in order, each with its source, uncertain dates marked | Read-only, from the accepted study | none | S0 |
| S12 | **FL-11** Team | Firm, team members and titles, Take it / Hand over with a note, Team notes page, What happened page with names, Send to attorney, attorney-only close | Human in the loop (D14) | yes (FL-11) | S7 |
| S13 | **FL-10** Reports and close | Reports page in the new layout, Intake complete, one PDF export (checklist with status, conflicts, report with sources) | The intake ends in a file for the firm's case file | small | S12 |
| later | FL-7, FL-9, FL-8 | Take or decline a shared hive; automatic reminders; assistant replies on Opus 5.5 | — | — | after D-017/D-018 |

**Flow check after S13:** a firm member creates a client, invites them, the client sends documents from a phone, each is checked, the team works the board and the conversation, fills gaps from Missing and conflicts, marks it ready, the attorney closes it and downloads the PDF. Then the domain testing in section 3 starts.

### Calendar (honest)

Thirteen screens at one Cursor ticket a day is about thirteen working days, plus review and fixes. With the Thanksgiving freeze (Wed 11-25 evening to Sun 11-29) the full flow lands around **Wed 12-03**, and the bankruptcy test run (20 cases) the day after. Two ways to handle Mon 11-30:

- **A. Keep the 11-30 pilot date with a shorter flow:** S0–S8 and S13 by 11-25 (ten tickets in eight days, tight), S9–S12 during the first pilot week. Pilots start on synthetic files until the bankruptcy run passes.
- **B. Move the pilot to Mon 12-07:** all thirteen screens, then the bankruptcy run, then pilots on real documents once B1–B5 are done.

---

## 3. Domain testing: 20 synthetic cases per domain

One domain at a time. A domain passes before the next one starts.

### 3.1 Order

| Order | Domain | Pack | Why this order |
|---|---|---|---|
| 1 | Bankruptcy intake (Chapter 7) | `HiveForYou-Pack-bankruptcy-intake` | The pilot field |
| 2 | Chapter 13 confirmation | `HiveForYou-Pack-chapter13-confirmation` | Same firms, harder documents (plans, trustee objections) |
| 3 | IEP initial | `HiveForYou-Pack-iep-initial` | Different reader (parent) and different documents; proves domain agnosticism (D-053) |
| later | Medicaid look-back, benefits denial, small-business intake | packs to write | `eval/corpora` already has seeds for benefits denial and small business |

### 3.2 What one case is

A folder under `eval/cases/<domain>/<case-id>/`:

- `documents/` — realistic synthetic files (PDF statements, pay stubs, tax returns, notices; some as phone photos, HEIC, multi-page photo sets, one password-protected PDF with the password in `case.json`).
- `case.json` — the answer key:
  - the checklist items the pack expects and, for each, **in / missing / wrong period / unreadable**, with the file and pages that satisfy it;
  - the conflicts a careful paralegal would raise (two values that disagree), each with both source pages;
  - 10–20 key facts (amounts, dates, names, account endings) with their source page;
  - the dated events for the Timeline;
  - what the client report must **not** say (advice, eligibility).

### 3.3 The case mix for each domain (20 cases)

| Cases | Situation |
|---|---|
| 3 | Clean and complete: every item in, no conflicts |
| 4 | Missing items: 1, 2, 3 and 5 items missing |
| 3 | Wrong period: last year's return, statements that stop early, pay stubs older than 60 days |
| 2 | Unreadable: a blurry page, a cropped page |
| 2 | Conflicts: income on the stubs disagrees with the return; a balance that doesn't carry over |
| 2 | Duplicates and extras: the same statement twice; documents nobody asked for |
| 2 | Formats: an HEIC photo set of a 6-page statement; a password-protected bank PDF |
| 1 | Messy real life: out of order, mixed accounts, handwritten note |
| 1 | Near miss: the right kind of document for the wrong person (spouse's pay stub) |

### 3.4 How a run works

1. `eval/tools/build-cases.mts` generates the 20 folders for a domain from a seed and a scenario table (deterministic, checked in).
2. `eval/tools/run-domain.mts --domain bankruptcy-intake` runs on **staging** with the test-only sign-in (QF-1): for each case it creates a client hive with the pack, uploads the documents as the client would, waits for reading and the study, then reads back the board, Documents, Facts, Missing and conflicts, Timeline and the client report through the API.
3. It scores each case against `case.json` and writes `eval/runs/<domain>/<date>/REPORT.md` with every miss listed and linked to its case.

### 3.5 Pass marks (per domain, all 20 cases)

| Measure | Pass |
|---|---|
| Checklist item status correct (in / missing / wrong period / unreadable) | 95% of items |
| Missing items found | 90% recall, no more than 1 false "missing" per case on average |
| Conflicts flagged that are real | 80% precision, 80% recall |
| Every claim opens the right page (D-011) | 98% |
| Key facts correct | 95% |
| Timeline events in the right order with a source | 95% |
| Client report never gives advice or eligibility (lint plus model check) | 100% |
| Time from last upload to a ready board | under 5 minutes per case |

A domain that misses a mark gets a fix ticket (pack wording, prompt, or code) and the full 20 run again. Release is blocked on a drop (Q5).

---

## 4. Cursor prompt — S0 / FL-4b Workspace shell

Paste the shared constraints from the build plan (section 4) first, then this. Branch `fl-4b-workspace-shell`. No migration. No edge function.

```
FL-4b — Workspace shell (D18). Layout, navigation and visual system only. No new data, no new
model calls, no migration, no edge function.

Read first: prototype/HiveForYou V4 Prototype.dc.html (open it in a browser; sign in as
dana@example.com, open Ruth Ortiz; then as priya@example.com, open "Mom's Medicaid application"),
claude/HiveForYou-SCREEN-BUILD-PLAN.md section 1 (D18), apps/web/src/components/
hive-workspace-layout.tsx, hive-tab-nav.tsx, app-header.tsx, button-classes.ts,
components/study/StudyReport.tsx, SourceChip.tsx, StatusBadge.tsx, StateBar.tsx,
lib/hive-routes.ts, tailwind.config.ts and the globals stylesheet.

Match the prototype's hive pages for layout, order and wording. Ignore the prototype's Work plan
page (it is not in the app). Where this prompt and the prototype differ, this prompt wins.

1. Tokens (globals + tailwind.config.ts, no hex values anywhere else):
   - Add colour token `canvas` (#F7F8FA) for the hive workspace background. It is the only new
     colour. Document it in docs/brand (one line: "canvas — hive workspace background, D18.4").
   - Add radius token `card` = 14px if not already 14px, and `control` = 8px for the new buttons
     (keep the existing pill radius for the home page and the client's phone view).
   - Font sizes stay the existing tokens: section 21px (page titles inside a hive), 16px section
     titles, small 14px body, caption 12.5px.

2. Shared components (apps/web/src/components/workspace/), each with a unit test:
   - WorkspaceShell: grid 236px sidebar + workspace; sidebar sticky under the header with its own
     scroll; below 900px a single column with the sidebar rendered as a horizontally scrolling row
     of buttons (44px high) under the header, hive card hidden.
   - HiveSidebar: hive card (initials badge from the hive name's first two words that start with a
     letter; name; purpose on two lines max; for firm client hives "On it: <name> · <title>" with
     Take it or Hand over as a link, and "<assistant name> · automated" with Rename, both wired to
     the existing actions; for individuals just name and purpose), then the groups:
       Hive: Hive board (count = items that need you, from HiveSummary), Documents (count), Facts,
             Missing and conflicts, Reports (count)
       More: Timeline, Team notes (firm client hives only, count), What happened
     Each item: outline icon (one inline SVG per item, 18px, currentColor; icons: grid, file,
     magnifier, alert circle, bar chart, trend line, note, clock), label, optional count badge.
     Current page: aria-current="page", Cell Blue text on cell-blue-wash. Group labels 11px
     uppercase with letter spacing (the only uppercase text in the app).
   - WorkspaceBreadcrumb in the app header when inside a hive: back label ("All clients" for a
     professional, "Your hives" for an individual, same target as hiveListBackLink) / hive name /
     page name. Hidden below 900px (the sidebar row has the back link there). On desktop the
     header's logo area is 236px wide with a 1px line under it continuing the sidebar border, so
     the sidebar reads as one column from top to bottom.
   - Card: white, 1px line border, 14px radius, 16px 18px padding; optional header row (title
     16px 600, subtitle 12.5px graphite, right slot for a link or filter).
   - StatusDot: dot (7px, currentColor) + word, 12.5px 600. Replace StatusBadge's filled pill
     rendering inside the hive workspace with StatusDot (keep StatusBadge's API so callers don't
     change). Colours as D18.6.
   - Buttons (button-classes.ts): add WORKSPACE_PRIMARY (Cell Blue deep fill, white text) and
     WORKSPACE_SECONDARY (white, 1px line border, ink text, hover mist), both 8px radius, 40px
     high from 900px, 44px below (min-h-11 sm:min-h-10 pattern), 14px text. Use them for every
     button inside the hive workspace. Keep one filled button per screen.
   - SourceChip restyle inside the workspace: mono 12.5px, Cell Blue text on cell-blue-wash, no
     border, 6px radius, 22px high, hover cell-blue-tint. Same click target behaviour as today
     (opens the cited page, D-011). Keep the honey style only where Honey means "changed".

3. Routes (lib/hive-routes.ts + app/hives/[hiveId]/...):
   - Add /facts, /missing, /timeline, /activity, /notes. /study redirects (308) to /facts,
     preserving any #hash or ?query the StateBar links use (map the old hash targets to the new
     pages: missing/disagree → /missing, timeline → /timeline, establish/glance → /facts).
   - Every hive page renders inside WorkspaceShell. Delete HiveTabNav and its test; update every
     import. HivePageHeader becomes a compact page head: h1 (21px Outfit 600) + one 14px graphite
     line; the hive name, description and back link move to the sidebar and breadcrumb (no
     duplication). Remove the StateBar from the page head (counts live in the sidebar and the
     board).
   - /notes and the Team notes sidebar item exist only for firm client hives; others get 404.

4. Splitting Study (no new data; reuse StudyReport's sections as components):
   - /facts: page head "Facts" / "What the documents say, each tied to its page."; then the
     question box (the existing hive-ask-input, moved from the header; no magnifier, rule 4; its
     saved confirmation line under it); the study revision line with Accept for pending
     decisions; cards: what the documents establish (EstablishTable), at a glance, pack sections.
   - /missing: "Missing and conflicts" / "What the records don't include, and where they
     disagree."; one card titled "Items" with the filters All / Needs you / Changed / Missing on
     the right; inside it the disagreements (ComparisonCard), the missing list (MissingList) and
     requests (DocumentRequestList), each row with StatusDot.
   - /timeline: "Timeline" / "Dated events from the documents, in order."; the Timeline component
     in a card.
   - The empty state when no study exists yet: one card with "Your Study builds once documents
     are read" and a secondary "Go to Documents" link (the board keeps the only filled button).
   - Remove the in-page "On this page" table of contents from these pages.

5. Hive board inside the shell:
   - Firm client hive (today's HiveBoardThreePane): remove the left team pane (its content now
     lives in the sidebar card, /notes and /activity). Two columns: workspace column on canvas
     (headline "<n> things need you" with the number in Cell Blue; stage strip of three labelled
     segments "Collecting · <in> of <total> in", "Attorney review", "Closed" using today's stage
     data or "Collecting" alone if the hive has no stage yet; the stage action (Close intake /
     Ready for attorney review) as a WORKSPACE_SECONDARY button beside the headline; a "Needs you
     <count>" Card with rows separated by lines: kind label only when it is not plain "Needs you",
     title, one-line detail with the full text on hover/focus, source links, actions; an "Items"
     Card) and the client pane (white, 384px) with the conversation as today and the waiting
     block reduced to one line "● Waiting on <first name>" with "Auto-remind on/off" as a text
     switch and one row per waiting item with "Remind now" as a link.
   - The assistant bar ("<name>'s table · automated…") is removed from the board; Rename lives in
     the sidebar card.
   - Below 1100px keep today's pane tabs, now only Items · <client first name>.
   - Individual's board: one column plus the side summary; drop the duplicated hive title in the
     side summary.

6. /activity "What happened": every activity row (not only the last 8), newest first, rows
   "<time> <who> <what>" with lines between, the assistant's name in Cell Blue. Same data and
   authorisation as today's board history. /notes "Team notes": today's notes list and the
   note box, page head "Team notes" / "Only people at <firm> see these. Never shown to
   <client name>." Same RLS as today; add a test that a client member gets 404 on /notes.

7. Accessibility: sidebar is a <nav aria-label="Hive sections">; the breadcrumb is a
   <nav aria-label="Breadcrumb">; visible focus on every link and button; the horizontal sidebar
   row on phones is keyboard scrollable; counts have accessible text ("5 items need you").

8. Tests:
   - Unit: WorkspaceShell (both breakpoints via class assertions), HiveSidebar (firm vs
     individual items, Team notes only for firm client hives, aria-current, counts), breadcrumb
     labels, StatusDot colours, the /study redirect mapping, one filled button per page
     (a test helper that counts WORKSPACE_PRIMARY in each page's render).
   - End-to-end smoke (QF-1 harness): as a firm member, open a client hive, visit every sidebar
     page, check the breadcrumb and h1 on each, open a source link from Facts; as a client
     member, check /notes is 404 and the sidebar has no Team notes; as an individual, visit every
     page.
   - Update existing tests that asserted on HiveTabNav, the old header or StateBar placement;
     never weaken an assertion to make it pass.

9. Prototype: remove the Work plan page and its sidebar item from
   prototype/HiveForYou V4 Prototype.dc.html (move its goal and Next line to the top of the
   individual's board side summary), so prototype and app match.

10. Stop and report: the list of files changed, screenshots at 1280px and 390px of Hive board
    (firm and individual), Documents, Facts, Missing and conflicts, Timeline, Reports, What
    happened and Team notes, side by side with the prototype's same pages. Full tests with
    NODE_OPTIONS=--max-old-space-size=8192, typecheck, clean build, lint. No commit.
```

---

## 5. What AB decides now

1. Confirm D18 (section 1), including the grey workspace and 8px buttons inside a hive.
2. Pilot date: **A** (11-30 with a shorter flow) or **B** (12-07 with the full flow).
3. Confirm the domain order (bankruptcy intake → Chapter 13 → IEP) and the pass marks.
