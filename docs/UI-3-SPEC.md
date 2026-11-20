# UI-3 — front page, sign in and Your hives (Concept v5)

Branch `ui-3-front-landing`, cut from main **after UI-2 is merged**. Cursor implements every part
below, in order, without committing. References: `docs/DESIGN.md` (v4) and
`prototype/new/HiveForYou-Concept-v5.html` (bottom-left concept bar switches screens; see DESIGN §6 for
selectors). **DESIGN.md wins over the concept; the concept wins over current code.** Skill:
`.cursor/skills/hiveforyou-design/SKILL.md` (update it in Part A to point at these two files).

## What it accomplishes
The three screens a person sees before they are inside a hive move to the Concept v5 look and flow. The
signed-out front page keeps its one question, "What are you working on?", and gains a switch between
"For my clients" (a work email, straight to sign-up) and "For myself" (the existing composer). Below it,
a clickable example hive shows what HiveForYou returns, followed by how it works, who sees what, and
what it covers. Sign in becomes one calm column with two steps. After sign-in, Your hives opens on one
sentence about the whole practice, then the hives grouped by what they need: To review, Being read,
Waiting on documents and Up to date. Each row shows documents received, status dots and when it was
last updated. A professional with no clients yet gets a short first visit. An individual with one hive
goes straight into it. Inside the hive, the assistant becomes a
real chat: a tab beside Home on wide screens and a chat sheet everywhere else, with a greeting, suggested
questions, sources in every answer and the hand-off to a person; the top box goes back to finding. The
only data change is a pure `reason` on hive attention in contracts. **No
migration, no RPC, no new API route, no new server behaviour** apart from the two redirects named in
Part E.

## Ground rules (all parts)
- Shared constraints: same block as FL-4b. No triggers, no feature flags, no domain words in code
  (D-053), no source no claim (D-011), one filled button per screen (header included), "To review" never
  "Needs you", no screen text promising unbuilt features (no reminders, export, pricing), server code
  never imports "use client" modules.
- Every number on screen comes from data; omit a part when its data is missing; never a wrong count.
- The front page's marketing copy and its example hive are content, not components: put them in
  `apps/web/src/content/front-page.ts` (strings + the synthetic example). The domain-word guard may
  exclude **only that file**; components stay generic.
- Existing behaviour tests keep passing. Change only markup/class assertions and tests for moved or
  removed UI; list every test you removed or rewrote, with the reason.
- Gallery pages render the **real** component tree from fixtures (no Supabase, no planner); stubs live
  only under `apps/web/src/dev/gallery/`. The gallery stays notFound in Vercel production.
- Delete only what nothing imports any more (show the grep): `greetingLine` uses on these pages, the
  clients-home sidebar rail, and `ClientsHomeFirstVisit` if replaced.

---

## Part A — design files and skill
1. `docs/DESIGN.md` is already v4 and `prototype/new/HiveForYou-Concept-v5.html` is already in the
   branch (first commit). Do not edit them. Point the skill at both, and say that v5 supersedes v4.
2. Tokens: add the honey-dot ink edge (`StatusDot` honey: 1px `rgba(31,35,40,.55)` ring) and a
   `ring-brand` utility for the front page input (2px wrapper, `line-strong` at rest, conic gradient
   blue→coral→honey→leaf→blue + `lift` on hover and focus-within). No hex outside tokens.

## Part B — contracts: why a hive needs attention (pure, tested)
In `packages/contracts/src/hives/hive-attention.ts`:
1. Add `reason` to `HiveAttentionResult`: `"no_documents" | "unreadable" | "run_failed" | "reading" |
   "not_in_study" | "conflicts" | "to_review" | "missing" | "no_study" | "no_report" | "ready"`, set in
   each existing branch of `hiveAttention` (both "reading" branches → `"reading"`). `level` and
   `sentence` stay exactly as they are.
2. Add `"unreadable"` to `HiveAttentionCountKey`; `nonZeroCounts` sets it from
   `unreadableDocumentCount`.
3. Add `hiveListGroup(result): "review" | "reading" | "waiting" | "done"`: `reading` → reading;
   `no_documents` | `missing` → waiting; `ready` → done; everything else → review.
4. Tests: every branch's `reason`; the group mapping; existing tests unchanged.
5. In apps/web `lib/hives/`: `hiveListSentence(counts)` → "<r> hives have things to review." + "<w> are
   waiting on documents." + "<b> are being read." (singular forms "hive has" / "is"; zero parts left
   out; all zero → "Everything is up to date.") and `hiveRowStatuses(summary)` → ordered dots:
   needs → "<n> to review" blue; changed → "<n> changed" honey; missing → "<n> missing" coral;
   unreadable → "<n> unreadable" coral; else by reason: reading → "Reading the documents" grey,
   no_documents → "No documents yet" grey, run_failed / no_study / no_report → the attention sentence
   without its full stop, grey; ready → "Up to date" leaf. Unit tests for both, including singulars.

## Part C — front page (`app/page.tsx`, `LandingStart`)
Build DESIGN §3 "Front page" exactly; signed-in visitors still redirect to `/hives`.
1. Signed-out top bar: mark + wordmark left (link to `/`), quiet "Sign in" right (`/sign-in`). The old
   "Get started" pill goes (one filled button: Start).
2. Hero: animated mark (once per page load, brand easing, off under reduced motion), h1, lede.
3. Segmented "For my clients" (default) / "For myself" — a real `role="group"` with `aria-pressed`
   buttons, remembered in the URL as `?for=self` so Back works.
   - For my clients: `<input type="email" autocomplete="email">` "Your work email" + primary Start →
     `/sign-in?start=clients&new=1&next=%2Fhives&prefill=<email>` (omit `prefill` when empty; trim; no
     validation here — the sign-in page validates).
   - For myself: today's `HiveComposer presentation="landing"` + quiet "Add documents" (unchanged guest
     draft → `CREATE_HIVE_AFTER_SIGN_UP_PATH`). Its submit button reads "Start" and is the filled one.
   - Both inside the ring; the two notes under it per DESIGN.
4. "What you get back" band: a client component `FrontExample` rendering the example from
   `content/front-page.ts` (3 statements, 3 documents, 3 missing). Statements are buttons with
   `aria-pressed`; the page area is `aria-live="polite"`; selection swaps the page with the fade-up.
   Reuse `StatusDot`, the meter and the `.ref` look (non-interactive span here — it opens nothing).
5. How it works · Who sees what · What it covers · closing (secondary "Start a hive" scrolls to the hero
   and focuses the input) · footer. Copy word for word from DESIGN §3. "What it covers" lists the
   areas from the domain packs that exist (read them; don't hard-code a list in a component).
6. Remove the old three-column "Upload whatever you have / Every point opens its page / See what is
   missing" block and the mist footer.

## Part D — sign in (`app/sign-in/page.tsx`, `SignInFlow`, `SignInShell`)
1. Layout per DESIGN §3 "Sign in": signed-out bar (no "Sign in" link), 400 column, mark, h1, lede, one
   field, full-width primary, privacy line. Keep every behaviour: actions, `next`, `start`, `new`,
   `linkError`, invite `email` + `lockEmail`, resend wait, errors.
2. New search param `prefill`: a valid-looking email fills the field **without** locking it. `email`
   (invites) keeps locking. Never both: `email` wins.
3. Code step copy: h1 "Check your email", lede "We sent a sign-in code to <b>email</b>. Enter it below.",
   label "Code from the email", `inputMode="numeric"`, `autoComplete="one-time-code"`, primary "Sign in",
   text buttons "Use a different email" / "Send a new code" (existing timer text kept).
4. Tests: `prefill` fills and stays editable; `email` still locks; both → `email` wins.

## Part E — Your hives (`app/hives/page.tsx`, `MyHivesPanel` and its pieces)
Build DESIGN §3 "Your hives" and "First visit" for every person (clients view and own view use the
same page; queues decide what shows).
1. Top bar: mark + wordmark + "/ <firm name>" (firm members only) · the box as **find** ("Find a client
   or hive", `/` focuses it, filters client-side, reuses `useClientsHomeSearch` state) · initials. The
   separate find field under the heading goes.
2. Head: h1 "Your hives", state sentence from `hiveListSentence` over the rows **with** a summary in the
   current queue, primary "New hive" (opens the existing create flow / New client exactly as today).
   No greeting line.
3. Queues as text tabs (hive-tab style, count capsules) replacing the sidebar rail: All · Mine ·
   Unassigned (only when `showFirmRail`) · Your own (only when the person has own hives **and** client
   hives). Same URL param `queue` and the same `hiveMatchesClientsHomeQueue` logic.
4. Groups via `hiveListGroup`, order To review · Being read · Waiting on documents · Up to date, each a
   Section with count; empty groups omitted. Within a group keep `rankHives` order. A hive without a
   summary goes in To review with **no** status dots and is not counted in the sentence.
5. Row per DESIGN: the whole row a `Link` to the hive; initials square; name (client hives: client
   name; own hives: hive title) + sub (hive title or purpose · "with <assignee first name>" /
   "unassigned"; firmless: purpose only); mini meter + "<received> of <asked> documents in" only when
   `intake.total > 0`; `hiveRowStatuses`; "Updated <relative>" from `hiveLastActivity`. The existing
   row menu (`HiveCardMenu`: delete, kind change) stays as a quiet 32px icon button after "Updated",
   **outside** the link. Phones: the two-line layout.
6. No matches for a find: "No hive matches "<q>". Try a client's first or last name." plus, for firm
   members, a **text** button "New client named <q>" (same route as today — no second filled button).
7. First visit (clients view, no client hives, no find, no error): DESIGN §3 "First visit" —
   primary "New hive", text button "Or start one for your own documents" (opens the existing own-hive
   create flow), the three rows. Replaces `ClientsHomeFirstVisit`.
8. Redirects (server, `app/hives/page.tsx`): a person with no firm whose hives are all own and exactly
   one (not deletion-pending) → `redirect(hiveHomePath(id))`, unless `?all=1`. Nothing else changes.
9. Loading: skeleton rows under the head. Error: the existing inline error with "Reference <8 chars>"
   (not mono) and "Try again".

## Part F — Ask <assistant> as a chat (DESIGN §3 "Ask <assistant> — the chat", decision D23)
UI-2 put the assistant into the top box's popover. This part turns it into a real chat and gives the box
back to finding. **Same data, no new API:** the chat reads and writes each person's existing ask thread
(the FL-8h ask channel, `thread_owner_user_id`), the same reply job, the same hand-off, and staff's
read-only view of the client's thread. Build it as one `AskChat` component used in two shells.
1. `AskChat`: header (avatar 40 with the ready dot, name, "AI assistant" tag, line), the staff-only
   "<client> has asked <assistant> <n> questions · Read them" row and the read-only view, the thread
   (greeting first, suggestion chips while empty, assistant bubbles left with refs, own bubbles right, a
   typing bubble while a reply is pending, hand-off button / "Sent to …" on the client side), the composer
   (icon send button, Enter sends, Shift+Enter new line, pending state, inline failure with Try again only
   when retryable). Opens scrolled to the newest message; new messages scroll into view; `role="log"`.
2. **Side panel** (Home ≥ 1100px): segmented tabs "Ask <assistant>" (default) / "<other first name>"
   (the existing people conversation, unchanged); own hives: the chat only. Keep the selected tab in the
   URL (`?side=people`) so reload keeps it.
3. **Chat sheet** (everywhere else): bottom sheet, full screen under 760px; scrim/Escape/close button
   close it; focus trap while open; focus returns to the opener. Opened by: the fixed **Ask bar** on Home
   under 1100px (staff and own hive), the client home's Ask button and chips, "Ask <assistant> about this
   page" in the evidence view (composer prefilled "About the <role> page <p>: "), and the box's "Ask
   <assistant>: <query>" row / Enter on a typed query when the panel isn't visible.
4. **The box** becomes find-only: search icon, "Find anything in this hive" / "Find in your documents",
   the empty-state line, the three result groups, and the "Ask <assistant>: <query>" row last. Remove the
   answer view, the question-history lists and the suggestions from the popover (they live in the chat).
   Escape closes the box without reopening it (blur before re-render).
5. Avatar: the assistant avatar becomes the mark on a white circle with a `line-strong` ring everywhere.
6. When the assistant is off for the hive (`assistant_replies_on = false`): no Ask tab, no Ask bar, no
   chips, no "Ask about this page", no Ask row in the box; the panel shows only the people conversation.
7. Tests: one composer visible at a time; chips and the box's Ask row post into the thread; the evidence
   prefill; the hand-off posts into the people conversation exactly once; the staff read-only view has no
   composer; a client never sees staff's thread; panel vs sheet by width; assistant-off hides every entry
   point; Escape order (sheet → box → evidence view).

## Part G — gallery and screenshots
Gallery pages from fixtures (real tree): `front`, `front-self`, `front-example-2`, `sign-in-email`,
`sign-in-prefill`, `sign-in-code`, `sign-in-error`, `hives-firm` (9 hives across all four groups,
2 members, one unassigned, one without summary), `hives-mine`, `hives-find-none`, `hives-first-visit`,
`hives-own` (an individual with 3 own hives), `hives-error`, plus for Part F `home-staff-chat` (wide Home, Ask tab with a
question and answer), `home-staff-people` (people tab), `home-staff-client-questions` (read-only view),
`home-narrow-askbar` (390, Ask bar), `chat-sheet-client` (390, with a hand-off), `evidence-ask-page` (sheet
with the prefill), `home-assistant-off`. `npm run ui:shots` captures each at 390,
768, 1280, 1920 plus the concept's matching states (`[data-go=front|signin|hives|first]`,
`[data-mode=self]`, `[data-exsel=2]`, `#lpFind` + typing, `[data-queue=mine]`, `[data-who=staff]` Home,
`[data-side=people]`, `[data-act=clientqs]`, `[data-act=opensheet]`, `.chip`, `[data-act=askpage]` in the
evidence view, `[data-who=client]`; hide `.cnav`).

## Check before reporting
1. ui:shots; put each gallery page next to the concept's state at 390 and 1280 and fix differences in
   spacing, type, colour, alignment and wrapping. Attach the pairs for front, sign-in-code, hives-firm
   and hives-first-visit.
2. No horizontal page scroll at 320/390/600/768/1024/1280/1920; phone targets ≥ 40 (44 primary/inputs);
   one filled button per screen; keyboard: `/` on Your hives, Tab order through the segmented control,
   Enter submits Start / Send code / Sign in, focus rings; reduced motion shows the finished mark.
3. Full web + contracts test suites, `tsc --noEmit`, lint, clean build + assert script, the wording,
   domain-word (with the one content-file exclusion), no-client-imports and pack-id guards.
4. No commit. Report: files changed per part, tests removed/rewritten with why, judgement calls, the
   grep for deletions, and anything you could not finish (say which part — don't fake it).
