# UI-2 — the whole revamp to Concept v4 (one branch, one run)

Branch `ui-2a-shell-home`. Cursor implements every part below, in order, without committing.
References: `docs/DESIGN.md` (v3) and `prototype/new/HiveForYou-Concept-v4.html` (switch Priya / Dana
top right; `/` opens the box; click a statement or a source ref for the evidence view).
**DESIGN.md wins over the concept; the concept wins over current code.** Skill:
`.cursor/skills/hiveforyou-design/SKILL.md` (update it in Part A to point at these two files).

## What it accomplishes
The whole app moves to the Concept v4 look and layout in one step. The rail goes. Every hive page gets
a top bar with one box that finds anything in the hive and asks the assistant, plus a hive head with
five tabs. A hive opens on Home: one sentence on where things stand, next steps, what the documents
show, and the people conversation beside it. Sources open full-page with the real page highlighted.
Clients get a phone-first home. Documents, Report, Audit trail, Team notes, My hives and the front page
follow the same system. The data, APIs, RPCs, contracts, polling, emails and permissions stay as they
are: **no migration, no RPC/contract change, no new server behaviour** except the route redirects in
Part C.

## Ground rules (all parts)
- Shared constraints: same block as FL-4b. No triggers, no feature flags, no domain words in code
  (D-053), no source no claim (D-011), one filled button per screen (header included), "To review" never
  "Needs you", no screen text promising unbuilt features, server code never imports "use client" modules.
- No decision buttons anywhere (nothing is saved yet; FL-7g adds them later).
- Every number on screen comes from data; omit a part when its data is missing; never a wrong count.
- Existing behaviour tests keep passing. Change only markup/class assertions and tests for moved routes;
  list every test you removed or rewrote, with the reason.
- Reuse from the parked branch instead of rebuilding (copy without committing, e.g.
  `git checkout ui-1b-findings-documents -- <path>`): `components/study/truncate-chip-label.ts` (+ test),
  `components/findings/FindingsCompareTable.tsx`, `components/findings/FindingsTimelineList.tsx`, and
  the gallery fixture `dev/gallery/fixtures/findings-gallery.ts`. Restyle them to v3.
- Gallery pages render the **real** component tree from fixtures (no Supabase, no planner); stubs live
  only under `apps/web/src/dev/gallery/`. The gallery stays notFound in Vercel production.

---

## Part A — tokens and shared components
1. Re-tune `tailwind.config.ts` + `globals.css` to DESIGN §2: ink #1F2328, ink-2 #4A525C, ink-3 #6B737D,
   line #E3E6EA, line-strong #D3D8DE, mist #F4F6F8, hover #EEF1F4, page-warm #FFFEFB, cite #FFF1BF
   (ring #F3D97A), blue/coral/honey/leaf + -deep + -wash per the table; body 14.5/1.55; type roles per
   §2; radii button 9, input/composer 12, popover 14, ref 7, tag 5, sheet 18, page 4; shadows `lift`
   and `pop`; top bar 64 (60 phones); content 1240; home conversation 400; read 760; wide 1040.
   Old token names keep working as aliases until Part H.
2. Update `components/ui/` to v3 anatomy: Button (radius 9, 34/44px), StatusDot (12.5/600, adds
   Received), SourceRef (24px, radius 7, "<role> p.<n>" with page in ink-3, word-boundary truncation
   via truncate-chip-label, full role in title), SourceRefs (cap 6 + "+n more"), Section (h2 17 + ink
   rule, 40px above), Tabs (ink underline, count capsule), Composer (radius 12, focus ring + halo,
   lock hint), MetaLine, Disclosure, ShowMore. Add: ProgressMeter, StateSentence, Step, Statement
   (hover row + "See the page →"), AvatarStack, Toast.

## Part B — top bar, the box, hive head
1. **Top bar** per DESIGN §3: mark + wordmark + (staff, inside a hive) breadcrumb "/ All hives /
   <hive>"; centre the box; right initials. Outside a hive: no box, quiet "My hives". No filled
   button. < 760: mark + box only.
2. **The box** (`components/ui/OmniBox` + a hive-scoped provider fed by data the hive layout already
   loads): rest/focus look, `/` focuses, Escape closes, arrows move (role=listbox/option,
   aria-activedescendant), Enter selects. Popover groups exactly as DESIGN §3 "The box": Ask row
   first; empty query → suggestions from data, **Your questions** (latest 5) and for staff
   **<client>'s questions <n>** (read-only, opens with "<client> asked this. Only your team can see
   it."); with a query → In the documents / Open items / Documents (client-side filter, `cite`
   highlight, max 4/3/3, no-match line). Asking uses the **existing FL-8h Ask channel** (same hook,
   route, polling, thread ownership): answer in the popover with the existing safe assistant-reply
   renderer, refs, typing row, 20 s "still working", privacy foot, hand-off "Ask <staff first name>"
   (client, firm hives, same condition and action as today; afterwards a toast "Sent to <staff> in
   your messages.") or "New question". `?ask=1` opens the box. Refs open the evidence view (Part D).
3. **Hive head** replaces rail + PageHead on hive pages: h1, "<purpose> · for <client>", AvatarStack
   of people who exist + names, tabs **Home · Documents <n> · Report · Audit trail · Team notes 🔒**
   (Team notes staff-only; firmless hives have no Team notes). Home shows the unread conversation count
   when > 0. Tabs scroll sideways < 760 (44px). Remove the rail and the phone tab row from the layout.

## Part C — Home (staff and firmless) + redirects
1. Routes: `/hives/[id]` renders Home (zero documents → still redirect to Documents). `/board` →
   Home (`?view=ask` → `?ask=1`); `/findings` and legacy findings tabs/anchors → `Home#show`; other old
   routes (study, facts, timeline, missing, activity) keep redirecting to their new home. Update
   `hiveBoardPath` callers to `hiveHomePath`; emails keep working through the redirects (test them).
2. Layout ≥ 1100: brief `1fr` + Conversation column 400px, sticky under the top bar, full height, own
   scroll. < 1100: conversation under the brief, page scroll. Firmless: one 760 column, no conversation.
3. Brief: StateSentence from real counts (documents in, checklist size, open review items, still-to-come
   requests, other person's last message time), zero parts omitted, "Nothing is waiting on you." when
   all zero; ProgressMeter only with a checklist; meta "Study v<n>, accepted <Mon D> · every statement
   below opens the page it comes from". No study yet → one sentence + secondary "Go to Documents".
4. **Next steps <n>**: missing-records step first ("Ask <client> for <r> missing records", detail =
   first two requests · "<k> more", secondary "Write the request" fills the conversation composer;
   firmless → "Add documents" opening the upload flow); then each open review item (dot by kind:
   missing coral "Missing", difference honey "Changed", needs blue "To review"; title; one detail line;
   secondary "Look at it" → evidence view on its first ref). 3, then "Show all <n>" / "Show fewer".
   The old "Still to come" bar and the Ask-about-documents card are gone.
5. **What the documents show <s statements>** (`id="show"`): topics h3 + "● Uncertain"; Statement rows
   (whole row opens its first ref; keyboard Enter/Space); 2 per topic, then "<k> more".
6. **Supporting detail**: closed Disclosures, only those with data — "Compare across documents"
   (FindingsCompareTable), "Events in date order" (FindingsTimelineList, 6 then "Show all"),
   "Document coverage" (dots, no pills), "How the totals are calculated" (existing calculation panel).
7. **Conversation column**: existing Conversation thread + composer per DESIGN (header "Conversation
   with <first name>" + "People only. <assistant> doesn't take part here." + avatar; flat rows; day
   labels; "Passed on from Ask <assistant>"; hint "Everyone in this hive sees this"; primary Send). The
   board's Ask tab, staff segmented control and tabs are removed from the UI (the box owns Ask).

## Part D — evidence view (replaces the tray and the review drawer)
1. `EvidenceViewerProvider` renders DESIGN §3 "Evidence view" full width under the hive head instead of
   the tray/drawer, on every page that shows refs. URL `?source=<ref>` (push on open; Back and reload
   work; Escape and "← Back to <tab>" close).
2. Statement side: the statement (Outfit 21), status (Checked against the page / Uncertain / Page
   unreadable — from the data's status), "Why it matters" (open items), "What this page supports",
   "What the documents don't say", "Pages behind this" (one button per cited page; current with ink
   ring). The FindingsReviewDrawer content (compare row, spine row, gap text) folds in here. Staff on
   an open item, firm hive: quiet "Ask <client> about it" → Home with the question in the composer.
3. Viewer side (`mist`): bar "<role> · <issuer if known>" / "Page <p> of <n>", then the real page via
   `EvidencePdfPage` with its highlight on `page-warm` paper (radius 4, soft shadow, max 680). Keep its
   loading/error states. Unreadable page → the unreadable message instead.
4. < 1100 the two sides stack (statement first).

## Part E — Documents
1. 1040 column. First row: MetaLine "<n> files · <p> pages · <k> with unreadable pages · <d> duplicate
   set aside" (parts > 0) and primary **Add documents** (the page's one filled button).
2. **Still to come <r>** (anchor `#requested`): Missing rows with the request text, one detail line,
   secondary "Add it" (same upload flow) and quiet "Why" (evidence view) when it has a ref. Received
   items show "● Received" only if the checklist data says so. 5, then "Show all".
3. **Uploaded <n files · p pages>**: table per DESIGN Tables — Document (role 600 + "<type> · <flags>"),
   Period (tabular), Pages (right), Read (● Read / ● <n>% read coral / ● Duplicate / ● Not read yet),
   row opens its first source or the existing inspect drawer restyled as the DESIGN drawer. < 760 stacked
   rows, no header. Under it one meta line "Reading a page isn't the same as proving what it says.
   Unreadable pages and gaps stay visible."
4. Analyze / Rebuild Study / retry / upload progress keep working exactly as today, restyled as
   secondary or text buttons and inline meta lines (never filled, no boxes).
5. Empty: "Upload whatever you have. Old, partial or out of order is fine." + primary "Add documents".

## Part F — client home (phone first)
1. A client (firm hive, not staff) opening the hive gets DESIGN §3 "Client home" instead of Home: no
   hive head, no tabs; top bar with the box only.
2. Staff card ("Your file with" / name / title — fallbacks per UI-1a: "your team"), h1, lead sentence,
   full-width meter + "<n> of <m> documents in" (checklist only), **Still to send <r>** (request,
   why, secondary 44px "Add" with upload icon → existing upload; received → "● Received"), 3 then
   "<k> more"; the Ask button (52px, assistant avatar, "Ask <assistant> about your documents" → focuses
   the box); **Messages with <staff first name>** (same conversation, hint "Only you and <staff>'s
   team"); quiet links "Your documents · Your report" (existing client-visible pages); privacy line.
3. Client evidence view: same as Part D without hive head; Back returns to the client home.
4. Team notes and staff-only data never reach the client (keep the existing guards/tests).

## Part G — Report, Audit trail, Team notes, My hives, front page
1. **Report** (760): meta "Written from Study v<n>. Nothing new is analyzed." + secondary "Save as PDF"
   (existing print); audience Segmented stays where it exists; one paper per DESIGN §3 "Report"; print
   stylesheet hides everything else.
2. **Audit trail** (760, fifth tab): Section + rows with dot, text, refs; 6 then "Show all".
3. **Team notes** (760): meta "Only people at <firm> see these. Never shown to <client>."; flat note
   rows; composer with lock "Staff only" + primary "Add note".
4. **My hives** (1040): list, not cards — initials square, name 600 + purpose meta, "<n> documents ·
   Study v<n>", status ("● <n> to review" / "● Up to date"); primary "New hive" in the page head.
5. **Front page / signed-out pages / New client**: v3 tokens, type and buttons only (keep their
   structure and wording); one filled button each.

## Part H — clean-up (only after A–G are green)
Remove the old token aliases (`TOKENS_ALIASES.md` list) and fix every use; delete the rail, the phone tab
row, the three-pane board components, the board Ask tab UI and the tray/drawer components that Parts
C–D replaced — only when nothing imports them (show the grep). Keep `HiveAskInput` code only if still
imported; otherwise delete it with its tests.

## Gallery and screenshots
Update `/dev/gallery` with real-tree pages, fixtures from `findings-gallery.ts` + the concept's Medicaid
sample: `shell`, `omni-staff-empty`, `omni-staff-results` (query "2023"), `omni-answer`,
`omni-client-handoff`, `omni-staff-client-questions`, `home-staff`, `home-long` (40 messages, 20 items,
8 topics), `home-firmless`, `home-no-study`, `evidence-statement`, `evidence-item`, `evidence-unreadable`,
`documents`, `documents-empty`, `client-home`, `client-home-done`, `report`, `audit`, `notes`, `my-hives`.
`npm run ui:shots` captures each at 390, 768, 1280, 1920 plus the concept's matching states
(`[data-who]`, `[data-tab]`, `[data-ev]`, focus `#omni` + typing).

## Check before reporting
1. ui:shots; put each gallery page next to the concept's state at 390 and 1280 and fix differences in
   spacing, type, colour, alignment and wrapping. Attach the pairs for home-staff, omni-answer,
   evidence-item, documents and client-home.
2. No horizontal page scroll at 320/390/600/768/1024/1280/1920; phone targets ≥ 40 (44 primary/inputs);
   one filled button per screen; keyboard: `/`, arrows, Enter, Escape, tab order, focus rings.
3. Full web + contracts test suites, `tsc --noEmit`, lint, clean build + assert script, the wording,
   domain-word, no-client-imports and pack-id guards.
4. No commit. Report: files changed per part, tests removed/rewritten with why, judgement calls, the
   grep for Part H deletions, and anything you could not finish (say which part — don't fake it).
