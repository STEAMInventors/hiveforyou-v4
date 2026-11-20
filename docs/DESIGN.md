# HiveForYou — DESIGN.md (v4, Concept v5 "the whole flow")

The design system for every HiveForYou screen. Reference implementation:
`prototype/new/HiveForYou-Concept-v5.html` (front page → sign in → your hives → the hive). Where a
screen and this file disagree, this file wins; where this file is silent, match the concept. Concept v4
(`prototype/new/HiveForYou-Concept-v4.html`) is superseded by v5 (v5 contains all of v4's hive screens
plus the signed-out and signed-in entry screens). The v2 prototype is history only.

Brand source: `HiveForYou-Brand-Guide-v1.0.pdf` (colours kept as v1.0, AB 2026-11-20). Decisions: D18–D22
in `claude/`. Where the brand guide and this file differ, §2 "Brand guide v1.0 — what wins" decides.

**What changed from v3:** a left menu on hive pages and Your hives (D24); Ask <assistant> is a chat (D23): a right-column tab beside Home, a chat sheet on
phones and other pages, the top box back to find-only; new §3
screens Front page, Sign in, Your hives, First visit and Own hive; the
four-colour ring lives only on the front page input; honey graphics get an ink edge; Audit trail is a
hive tab in the concept; the concept's screen switcher moved out of the top bar (it was never app UI);
§5 gains an explicit "no AI look" list.

---

## 1. Principles

1. **The file explains itself.** Every signed-in page opens on one sentence that says where things
   stand — a hive ("9 of 14 documents are in. 3 things to review, and 5 records are still to come.")
   and the list of hives ("4 hives have things to review. 2 are waiting on documents."). Then what to do
   next, then the detail. No dashboards, no tiles.
2. **Sarah is a chat, the box finds.** Asking the assistant is a real chat: a thread with a greeting,
   follow-ups, sources and a hand-off to a person — in the right column beside Home (tab "Ask
   <assistant>", the default) and as a chat sheet everywhere else. The top box only **finds** (Enter on a
   typed question passes it to the chat). On Your hives the box finds a client or hive. There is no
   separate search page; the assistant never appears as a floating bubble.
3. **People and the page are always one step away.** The conversation with the other person sits beside
   the work (staff) or under it (client). Every statement opens its source page full-size.
4. **No source, no claim (D-011).** Every statement about the documents carries a source reference.
5. **One thing leads.** One filled button per screen (header included). One h1 per page.
6. **Say what the document says, then stop.** Plain words, questions not verdicts, "To review" never
   "Needs you". Never promise what isn't built.
7. **Generic (D-053).** Nothing in a component knows the domain. Labels, topics and checks come from data.
   (The signed-out front page is marketing copy and may name the areas HiveForYou covers; that text
   lives in one content file, not in components.)
8. **The only decoration is evidence.** If something on screen isn't a document, a citation, a person,
   a count from data or a next step, it has to earn its place. Proof beats decoration (§5 "No AI look").

---

## 2. Tokens

Names live in `tailwind.config.ts` / `globals.css` only. No hex values anywhere else.

### Colour

| Token | Value | Use |
|---|---|---|
| `ink` | #1F2328 | Text, section rules, selected tab underline, assistant avatar |
| `ink-2` | #4A525C | Secondary text |
| `ink-3` | #6B737D | Meta, labels, counts |
| `line` | #E3E6EA | Row dividers, borders |
| `line-strong` | #D3D8DE | Control borders, composer border, front page ring at rest |
| `mist` | #F4F6F8 | Input fill at rest, tab count, evidence viewer background, hover rows, front page example band |
| `hover` | #EEF1F4 | Button hover fill |
| `paper` | #FFFFFF | Page background |
| `page-warm` | #FFFEFB | Document page in the evidence viewer and the front page example |
| `cite` | #FFF1BF (ring #F3D97A) | Highlighted cited text; search match `mark` |
| `blue` / `blue-deep` / `blue-wash` | #3B7CF6 / #1A56C4 / #E8F0FE | Actions, links, focus, "To review", selected example statement |
| `coral` / `coral-deep` / `coral-wash` | #EF5143 / #B33A2E / #FDEDEB | Missing, unreadable |
| `honey` / `honey-deep` / `honey-wash` | #F6B826 / #7A5200 / #FEF3D6 | Changed, duplicate, uncertain |
| `leaf` / `leaf-deep` / `leaf-wash` | #2FA35A / #197040 / #E6F4EA | Read, checked, received, up to date, progress meter, client avatar |

Colour meaning is fixed: blue = act / to review, coral = missing, honey = changed, leaf = in / checked.
Text in a colour uses the `-deep` value (honey dots use `honey` for the dot, `honey-deep` for the word).
**Honey graphics carry an ink edge:** the honey status dot and any honey fill under 3:1 get a 1px
`rgba(31,35,40,.55)` ring (brand guide §5; honey is 1.8:1 on white). Grey dots (`ink-3`) are for neutral
states: "Not read yet", "Reading the documents", "No documents yet".

### Brand guide v1.0 — what wins

| Topic | Brand guide v1.0 | This file (wins in the product) |
|---|---|---|
| Status word for blue | "Needs you" | **"To review"** |
| Source chip | JetBrains Mono on honey wash | **DM Sans, white chip, `line` border** (`.ref`); no monospace in the UI |
| Four-colour ring | Around "the main input" | **Front page input only**, on hover and focus. Inside the app inputs use the plain focus style |
| State bar (four colours) | Signature element | Replaced by the **progress meter** (documents in) + status dots |
| Logo, colours, voice, guardrails | — | **Unchanged.** Follow the guide |

### Type

Fonts: **Outfit** (titles, the state sentence), **DM Sans** (everything else), **Source Serif 4**
(document page text only). No monospace in the UI.

| Role | Size / line | Weight | Font |
|---|---|---|---|
| Front page question (h1) | clamp(34px, 5.4vw, 52px) / 1.08, −0.03em | 600 | Outfit |
| Front page section (h2) | 30 / 1.2 (26 phones), −0.02em | 600 | Outfit |
| Front page lede | 17 / 1.55, `ink-2` | 400 | DM Sans |
| Hive title / page h1 | 28 / 1.15 (24 phones), −0.02em | 600 | Outfit |
| State sentence | 23 / 1.35 (20 phones), −0.02em; trailing clause `ink-3`. Your hives and the front page example: 22 | 500 | Outfit |
| Evidence statement | 21 / 1.4 | 500 | Outfit |
| Section title (h2) | 17 / 1.3, −0.015em | 600 | Outfit |
| Topic (h3) | 13.5 | 600, `ink-3` | DM Sans |
| Item title / hive row name | 14.5 / 15 | 600 | DM Sans |
| Body | 14.5 / 1.55 | 400 | DM Sans |
| Message text | 14 / 1.55 | 400 | DM Sans |
| Meta | 12.5 / 1.5, `ink-3` | 400 | DM Sans |
| Status word | 12.5 | 600 | DM Sans |

Sentence case everywhere. No uppercase labels, no eyebrows. Counts and amounts use tabular figures.

### Radius, depth, motion

- Radius: buttons 9, composer and top input 12, front page ring 16 (inner 14), segmented control 11
  (buttons 8), popover 14, example card 14, source ref 7, status-free tag 5, hive row initials 8, phone
  sheet 18 (top corners), document page 4. Circles only for avatars and dots.
- Shadow `lift` = `0 1px 2px rgba(16,24,40,.05), 0 12px 32px -16px rgba(16,24,40,.18)` (focused top
  input, front page ring on hover/focus). Shadow `pop` = `0 2px 6px rgba(16,24,40,.06), 0 24px 56px -20px
  rgba(16,24,40,.28)` (popover, sheet, toast). Nothing else floats.
- **Four-colour ring** (front page input only): 2px wrapper; at rest `line-strong`; on hover and
  focus-within `conic-gradient(from 200deg, blue, coral, honey, leaf, blue)` + `lift`. No glow, no blur.
- Motion: popover rises 4px in 180ms; document page fades up 8px in 350ms; sheet slides up 260ms; typing
  dots blink. **Mark animation** (front page only, once per visit, brand guide §4): cells arrive top,
  right, bottom, left, 0.8s each with 120ms stagger, `cubic-bezier(.3,.9,.3,1)`, never loops, never on
  other pages. All motion removed under `prefers-reduced-motion` (the mark shows finished).

### Layout

| Token | Value |
|---|---|
| Top bar | 64px (60 phones), sticky, white 90% with blur, hairline below |
| Front page | hero column 720px; sections 1120px wide, padding 24px (16 phones) |
| Sign in | 400px column |
| Left menu (≥ 1100px) | 232px, sticky under the top bar, full height, own scroll, 1px `line` on the right |
| Your hives | 1040px, padding 32px (16 phones), right of the left menu |
| First visit | 640px |
| Hive content max width | 1240px, padding 32px (16 phones) |
| Home grid | brief `1fr` + side panel `400px` (tabs "Ask <assistant>" / "<other person>"), gap 48. Own hive: the panel holds only the chat |
| Chat sheet | bottom sheet 560px wide, height min(88vh, 780px); phones: full screen (100dvh, no radius) |
| Reading pages (Report, Team notes, Audit trail) | 760px |
| Wide pages (Documents) | 1040px |
| Evidence split | statement side 340–440px + viewer `1fr`; document page max 680px, 8.5:11 |
| Client home | 460px column, padding 22/20, bottom 120 |

### Breakpoints

| Width | Behaviour |
|---|---|
| ≥ 1100 | Left menu on hive pages (staff, own hive) and Your hives; the hive tabs, the hive head's people line and the Your hives queue tabs are hidden (the menu carries them). Home: brief + sticky side panel (full height under the top bar, own scroll) with the two tabs |
| < 1100 | No left menu: the hive tabs and the queue tabs come back as the scrolling tabs row. The people conversation moves under the brief (page scroll); the chat moves to a fixed **Ask bar** at the bottom of the screen that opens the chat sheet; evidence split stacks (statement above page) |
| < 760 | Top bar: mark + box + nothing else (breadcrumb, wordmark text, `/` hint, initials hidden); box popover becomes fixed full-width under the bar; hive head stacks; tabs scroll sideways (44px); step action moves under the step; buttons 44px; tables become stacked rows; front page example stacks (statements above the page), "How it works" and "Who sees what" become one column; hive rows become two lines (name + status, then meter + updated) |

Every page works at 320, 390, 600, 768, 1024, 1280 and 1920px with no horizontal page scroll.
Phone touch targets ≥ 40px (44 for primary actions and inputs).

---

## 3. Components and screens

### Left menu (D24)
Shown at ≥ 1100px on every hive page for staff and own hives (Home, Documents, Report, Audit trail, Team
notes, evidence view) and on Your hives. Never on the client home, signed-out pages or First visit.
- **Hive pages:** quiet "← All hives" (staff; goes to Your hives) · identity block: 36px initials square
  (radius 8, `mist`) + client name (14/600) and hive title (12 `ink-3`), both one line with ellipsis
  (own hive: hive title + "Your hive"), hairline under it · nav: Home · Documents <n> · Report · Audit
  trail · Team notes (lock icon; staff only). Rows 38px, radius 9, 16px outline icon + label (14
  `ink-2`), count capsule at the right (11.5/600 `ink-3` on `mist`). Current page: `mist` fill, `ink`
  600, icon `ink`, capsule white; `aria-current="page"`. Hover `hover`. · footer pinned to the bottom
  (hairline above): avatar stack + "<client first>, <staff first> and <assistant>" (own: "You and
  <assistant>").
- **Your hives:** identity block = firm initials + firm name, the signed-in person under it (firmless:
  the person only) · nav = the queues with icons and counts: All (grid) · Mine (person) · Unassigned
  (inbox) · Your own (when shown). Same rules for showing Mine/Unassigned/Your own as the queue tabs.
- It replaces the tabs on wide screens; the top bar breadcrumb stays as the location line.

### Top bar
Three columns. Left = mark + "HiveForYou" wordmark + context: inside a hive (staff) the breadcrumb
"/ All hives / <hive>" ("All hives" is a quiet link to Your hives; hive name `ink` 600, ellipsis); on Your
hives the firm name "/ <firm>" (13.5 `ink-3`) when the person belongs to a firm. Centre = **the box**
(max 600px). Right = the signed-in person's initials (30px ink circle). No filled button in the bar.
The mark goes to Your hives for staff and individuals with more than one hive; for a client it does
nothing. **Signed out** (front page, sign in): mark + wordmark left (goes to the front page), quiet
"Sign in" right (front page only), no box.

### The box (find)
- At rest: 42px, white, 1px `line-strong` border (hover `ink-3`), search icon, `/` hint. Focused:
  `lift`. `/` focuses it from anywhere; Escape closes it (a second Escape closes the evidence view).
- **Inside a hive:** placeholder "Find anything in this hive" (staff, own hive) / "Find in your
  documents" (client). Popover (`pop`, max 70vh, own scroll), groups separated by hairlines, group titles
  12px 600 `ink-3`. Empty: one line "Type to find statements, open items and documents in this hive. To
  ask a question, use <assistant>." With a query: **In the documents** (statements, match highlighted with
  `cite`, topic as sub line, page at right) · **Open items** (sub line "To review" / "Still to come") ·
  **Documents** (role, type · period, pages); max 4 / 3 / 3; then a last row "<avatar> Ask <assistant>:
  **<query>**" (Enter) that sends the text to the chat. Filtering is client-side; it never calls a model.
  No matches: "Nothing in this hive matches "<q>"." above the Ask row.
- **On Your hives:** placeholder "Find a client or hive"; no popover — typing filters the list in
  place (client name and hive title, case-insensitive, client-side). No matches: "No hive matches
  "<q>". Try a client's first or last name." It never calls a model.

### Ask <assistant> — the chat (D23)
The assistant is a chatbot with a calm, friendly presence — never a robot icon, mascot, sparkle or
floating bubble (brand guide guardrails).
- **Avatar:** the four-cell mark on a white circle with a 1px `line-strong` ring (22 in tabs, 24 in rows,
  28 beside messages, 40 in the chat header). In the chat header only, a 10px `leaf` dot with a 2px white
  ring at the bottom right ("ready").
- **Where it lives:**
  - **Home, ≥ 1100px:** the right column is a side panel with a segmented tab row (mist track, 38px tabs,
    selected white): "<avatar> Ask <assistant>" (default) · "<avatar> <other person first name>" (the
    people conversation, unchanged). Own hive: no tabs, the panel is the chat.
  - **Everywhere else** (Home < 1100px, Documents, Report, Audit trail, Team notes, the evidence view,
    the client home): the **chat sheet** (bottom sheet; full screen on phones; scrim, Escape and the
    close button close it; focus moves into the composer and back to the opener on close).
  - **Ask bar** (Home < 1100px, staff and own hive): fixed at the bottom centre, min(560px, 100vw − 32px),
    54px, radius 16, white, `line-strong`, `pop`: avatar 32 + "**Ask <assistant>** about these
    documents". Opens the sheet. The brief gets 120px bottom padding so nothing hides under it.
  - **Client home:** the Ask button (52px, under the meter, before "Still to send") opens the sheet; up
    to 3 suggestion chips under it ask straight into the sheet.
  - **Evidence view:** quiet "<avatar> Ask <assistant> about this page" opens the sheet with the composer
    prefilled "About the <document role> page <p>: " and the caret at the end.
- **Chat layout** (panel and sheet are the same component): header = avatar 40 + "**<assistant>**"
  (Outfit 16/600) + "AI assistant" tag + "Answers only from the documents in this hive" (12.5 `ink-3`)
  [+ close button in the sheet]; then the thread (own scroll, opens at the newest message); then the
  composer.
- **Thread:**
  - First message, always: a greeting from the assistant (staff: "Hi <staff first name>. I've read the
    <n> documents in <client first name>'s hive. Ask me anything about them and I'll show you the page
    each answer comes from." · own hive: "… in your hive …" · client: "Hi <client first name>. I've read
    the documents you sent. Ask me anything about them and I'll show you the page each answer comes from.
    If I can't help, I'll pass your question to <staff first name>."). Counts from data.
  - While the thread is empty: up to 3 suggestion chips under the greeting (32px, 40 on phones, radius
    9, white, `line` border; hover `blue-wash`). Data-driven, never hard-coded domain text. A chip sends
    its question.
  - Assistant messages: left, 28px avatar at the bottom, bubble `mist`, radius 16 with a 5px bottom-left
    corner, 14/1.55, refs inside the bubble under the text (every factual sentence carries one — D-011).
    Waiting: the same bubble with three typing dots; after 20 s the text "…still working on it…".
  - Your messages: right, bubble `blue-wash`, `ink` text, radius 16 with a 5px bottom-right corner, no
    avatar.
  - Hand-off (client, when the assistant can't answer or the question needs a person): a secondary "Ask
    <staff first name>" inside that bubble; after use it becomes "● Sent to <staff first name>" (leaf) and
    the question appears in the people conversation with "Passed on from Ask <assistant>".
  - Staff only: a mist row under the header "<client first name> has asked <assistant> <n> questions." +
    text button "Read them" → the client's thread read-only with the row "<client first name> asked these.
    Only your team can see them." + "Back to your chat" (no composer while reading).
- **Composer:** the standard composer, placeholder "Ask <assistant> about the documents…", hint (lock)
  "Only you can see your questions" (staff, own hive) / "<staff first name>'s team can see your
  questions" (client), send = a 38px filled icon button (arrow, `aria-label="Send to <assistant>"`). Enter
  sends, Shift+Enter new line. It is the filled button of whatever is visible (the people tab's Send is
  never on screen at the same time).
- Every question and answer is kept in that person's thread (existing data: the ask channel per person).
- Assistant off for the hive: no Ask tab, Ask bar, chips, "Ask about this page" or Ask row in the box.

### Front page (signed out)
Order, top to bottom; nothing else on the page:
1. **Hero** (720 column, centred): the mark (64px, animated once), h1 **"What are you working on?"**,
   lede "Upload the paperwork. HiveForYou reads every page, shows what's missing, and links every point
   to the page it came from."
2. **Who it's for** — segmented control (`role="group"`, `aria-pressed`): "For my clients" (default) /
   "For myself". It changes the input under it, nothing else:
   - **For my clients:** one email input "Your work email" + primary **Start** → `/sign-in` with the
     email prefilled (editable, not locked), `start=clients`, `new=1`. Note under it: "Set up your
     practice, then invite your first client. You sign in with a code sent to your email."
   - **For myself:** the existing guest composer ("Describe your situation, then add whatever documents
     you have") + primary **Start**, with a quiet "Add documents" under it; Start saves the guest draft and
     goes to sign-up exactly as today. Note: "You get your own hive. Old, partial or out of order is fine.
     You sign in with a code sent to your email."
   - Both: second note "Invited by your lawyer or advocate? Open the link in your invitation email."
     (text, not a link — clients enter through their invitation).
   The input sits in the **four-colour ring** (§2). Start is the page's only filled button.
3. **What you get back** (`mist` band): h2, sub "An example hive for a Chapter 7 intake. Click a
   statement to see the page it comes from." Then one card (white, `line`, radius 14): header row
   "<client> · <purpose>" left, "Example · synthetic documents" right; left half = state sentence (22),
   meter + "<n> of <m> documents in", topic "What the documents show" with 3 statements (each a button,
   selected one `blue-wash`, `aria-pressed`, ref under it) and "Still to come" with 3 Missing rows;
   right half (`mist`) = viewer bar "<role> · <issuer>" / "Page 1 of <n>" and a `page-warm` document page
   (Source Serif 4) with the cited line in `cite`, then "● Checked against the page". Selecting a
   statement swaps the page (fade-up). All example content is synthetic and lives in one fixture file.
4. **How it works** — three columns (one on phones), each with a 1px `ink` rule on top, h3 (19) and one
   sentence: "Ask for the documents" / "HiveForYou reads every page" / "Review from the page". Only
   built behaviour (no reminders, no export).
5. **Who sees what** — rows (label 200px + text): Your client / Your team / The assistant / Anyone else.
6. **What it covers** — one paragraph naming only the areas that have a domain pack.
7. **Closing** — hairline, mark + slogan "The complicated, made simple." (Outfit 26) left, secondary
   "Start a hive" right (scrolls to the hero and focuses the input).
8. **Footer** — "© <year> HiveForYou" left, "Not legal, financial or medical advice." right (13, `ink-3`).

### Sign in
400px column under the signed-out bar: mark (40px), h1, lede, one field, one primary button (full width,
44px), privacy line. Two steps, same page:
- **Email:** h1 "Sign in" (or "Create your account" when `new=1`); lede = the existing copy ("Use your
  email. New here? We'll set up your account. No password needed." / "Enter your email and we'll send
  you a code. No password needed."); label "Email"; primary **Send code**.
- **Code:** h1 "Check your email"; lede "We sent a sign-in code to **<email>**. Enter it below."; label
  "Code from the email" (numeric, `autocomplete="one-time-code"`, letter-spaced); primary **Sign in**;
  text buttons "Use a different email" and "Send a new code" (keeps the existing 60 s wait).
- Errors inline under the field in `coral-deep` (`role="alert"`). Privacy line (lock icon): "No password
  to remember. Each hive is visible only to the people invited to it."
- Where it goes after sign-in is unchanged (the `next` path; professionals with no client hives land on
  First visit).

### Your hives (signed-in landing, `/hives`)
1040 column under the top bar (box = find).
- **Head:** h1 "Your hives"; state sentence (22) built from the groups below: "<r> hives have things to
  review." + "<w> are waiting on documents." + "<b> are being read." (zero parts left out; all zero:
  "Everything is up to date."); primary **New hive** (plus icon) at the right — the page's only filled
  button.
- **Queues** (text tabs like the hive tabs, count capsules): All · Mine · Unassigned — Mine and
  Unassigned only when the person belongs to a firm with more than one joined member; "Your own" only
  when the person has own hives as well as client hives. Counts from data.
- **Groups**, in this order, each a Section (h2 + count, ink rule), empty groups left out:
  **To review** · **Being read** · **Waiting on documents** · **Up to date**. Inside a group rows keep
  the existing rank (most recent activity first).
- **Hive row** (the whole row is one link to the hive; hover `mist`): initials square (36, radius 8) +
  client name (15/600; own hive: the hive title) and sub "<hive title> · with <assignee first name>" /
  "· unassigned" (13 `ink-3`; firmless: just the purpose) · mini meter (120px, 5px segments,
  `leaf`/`line`) + "<received> of <asked> documents in" (only when the hive has a checklist) · status
  dots, one per non-zero count: "● <n> to review" blue, "● <n> changed" honey, "● <n> missing" coral,
  "● <n> unreadable" coral, "● Reading the documents" grey, "● No documents yet" grey, "● Up to date" leaf
  · "Updated <relative time>" right (13 `ink-3`) · the existing row menu (delete, change kind) as a
  quiet 32px icon button after it, outside the link. Phones: two lines (name + statuses; meter +
  updated). A hive whose summary failed keeps its row with no status dots and is left out of the
  state sentence.
- No cards, no tiles, no greeting ("Good morning …"), no rail.

### First visit (professional with no client hives yet)
640 column: h1 "Your hives"; state sentence "Start with one client." + `ink-3` clause "Add their name
and email, and HiveForYou sends them a list of what to upload."; primary **New hive** + text button "Or
start one for your own documents"; then three rows (label 130px + text): "You set it up" / "They upload"
/ "You review". No empty list, no tour, no checklist of onboarding tasks.

### Hive head
h1 hive title; sub line "<purpose> · for <client>" (own hive: "<purpose> · your hive") (14 `ink-3`);
right: avatar stack (client, staff, assistant; own hive: you + assistant; 2px white ring, −6px overlap) +
"<client>, <staff> and <assistant>" / "You and <assistant>" (the people line and the tabs are hidden at ≥ 1100px,
where the left menu carries them). Then **tabs**: Home · Documents <n> · Report ·
Audit trail · Team notes 🔒 (staff only). Text tabs 42px, 14/500 `ink-3`; selected `ink` 600 with a 2px
**ink** underline; count in a small `mist` capsule (11.5/600). `role="tablist"`. Firmless (own) hives: no
Team notes, avatars show only the people who exist.

### Own hive (an individual's firmless hive)
Same hive screens as staff, minus everything that needs a second person: no conversation column (Home is
one column, brief max 820), no Team notes tab, no "Ask <client> about it", no state-sentence trailing
clause. The missing-records step reads "Find <r> missing records" with secondary "See the list" (opens
Documents). An individual with exactly one hive lands in it after sign-in; with more, on Your hives.

### Status
7px dot + word, 12.5/600 in the meaning's `-deep`: ● To review ● Missing ● Changed ● Uncertain
● Duplicate ● Unreadable ● Read ● Checked ● Received ● Up to date ● Not read yet / Reading the
documents / No documents yet (grey). Honey dots carry the ink edge. Never a filled pill.

### Source reference (`.ref`)
24px, radius 7, 1px `line`, white, 12/500 `ink-2`, 12px doc icon, "<document role> p.<n>" with the page
in `ink-3`; ellipsis at the button's width (cut at a word boundary, full role in `title`). Hover
`blue-wash` / `blue-deep`. Click opens the **evidence view** on that page. Never a file name. Group in
`.refs` (wrap, 6px gap, 8px above).

### Progress meter
Segments (6px high, 3px radius, 3px gap, max 420px; full width on the client home; 5px / 120px on hive
rows): one per document asked for; received = `leaf`, not yet = `line`. Label "<n> of <m> documents in".
Only shown when the hive has a checklist; the numbers come from data.

### State sentence (Home)
"<n> of <m> documents are in." (or "<n> documents are in." without a checklist) + "<k> things to review"
+ ", and <r> records are still to come." + `ink-3` clause "<client> last wrote <when>." (staff only).
Parts that are 0 are left out; "Nothing is waiting on you." when everything is 0. Under it: meter, then
meta "Study v<n>, accepted <Mon D> · every statement below opens the page it comes from".

### Section
h2 (17) left, meta count right, 1px **ink** rule under the header row; rows divided by 1px `line`;
40px above each section.

### Step (Next steps)
Grid: status dot + title (14.5/600) on line 1; detail (13.5 `ink-2`) on line 2; one secondary action
at the right spanning both lines (under the step on phones). Steps: first "Ask <client> for <r> missing
records" (own hive: "Find <r> missing records"; detail = first two requests · "<k> more"; action "Write
the request" puts the list into the conversation composer / "See the list"); then each open item (● To
review or ● Changed; "Look at it" opens its evidence view). Show 3, then "Show all <n>" / "Show fewer".

### Statement (What the documents show)
Topic h3 (13.5/600 `ink-3`, optional "● Uncertain"), then statements as full-width rows with 10/12px
padding, radius 10, `mist` on hover, "See the page →" (blue-deep 12.5/600) fading in on hover, refs
under the text. The whole row opens the evidence view. 2 per topic, then "<k> more".

### Supporting detail (Home, bottom)
`details` disclosures, closed: "Compare across documents", "Events in date order", "Document coverage",
"How the totals are calculated" — only those with data. Tables per §Tables.

### Conversation (people only)
The second tab of the side panel on wide Home pages; under the brief on narrow ones. Header: "Conversation with <other first name>" (16/600) + "People only. <assistant> doesn't take part
here." (12.5 `ink-3`) + the other person's avatar. Thread: flat rows, 30px avatar, byline
"<name> · you · <role> · <time>" (12 `ink-3`, name 13.5/600 `ink`), "Passed on from Ask <assistant>" meta
for hand-offs, text 14/1.55, refs. Day labels centred 11.5. Composer at the bottom: 12px radius,
`line-strong` border, focus ring `blue` + 3px 14% halo; textarea borderless; bar = lock icon hint
"Everyone in this hive sees this" + primary "Send →". Enter sends, Shift+Enter new line. Firmless hive:
no conversation column (Home is one column).

### Evidence view (replaces the side drawer)
Full width under the hive head. Left (statement side, hairline right): quiet "← Back to <tab>", the
statement (21 Outfit), its status ("● Checked against the page" leaf / "● Uncertain" honey /
"● Page unreadable" coral), h4 meta labels "Why it matters", "What this page supports",
"What the documents don't say", "Pages behind this" (one bordered button per cited page, current one
with an ink ring). Then the actions row: staff on an open item: secondary "Ask <client> about it" (puts a
question into the people composer); everyone: quiet "Ask <assistant> about this page" (opens the chat
sheet, prefilled). Right (`mist`): bar "<document role> · <issuer>" / "Page <p> of <n>", then the real page
(white-warm paper, 4px radius, soft shadow) with the cited text highlighted (`cite`). The URL carries
`?source=<ref>` so Back and reload work. Escape closes. **No decision buttons until decisions are saved
(FL-7g).**

### Tables
Header 12 `ink-3` with an ink rule; rows 14px, `line` dividers, 14px vertical padding; numbers right +
tabular; row hover `#FAFBFC`; whole row clickable when it opens a source. < 760: no header, rows become
a 2-column grid (title + sub left, status right); secondary columns hidden.

### Buttons
| Kind | Look | Use |
|---|---|---|
| Primary | `blue-deep` fill, white, 34px (44 phones and on front page / sign in / first visit), radius 9 | The one main action (Start, Send code, Sign in, New hive, Send, Add note) |
| Secondary | white, `line-strong` border, `ink` 600 | Step and row actions, "Start a hive" at the foot of the front page |
| Quiet | no border, `ink-2`, hover fill | Back, New question, Sign in (top bar), Add documents |
| Text | `blue-deep`, hover `blue-wash` | Show all, "<k> more", "Use a different email", "Or start one for your own documents" |
16px outline icons, stroke 1.8, one family. No Unicode arrows as icons (the "→" inside "See the page →"
is text).

### Client home (phone first)
460px column: staff card (44px avatar, "Your file with" / staff name 600 / title); h1 hive title; lead
"<r> things left to send. Everything else is in." (or "Everything we asked for is in. <staff> will be in
touch."); meter full width + "<n> of <m> documents in"; the **Ask button** (52px, radius 14, assistant
avatar, "Ask <assistant> about your documents" → opens the chat sheet) with up to 3 suggestion chips
under it; **Still to send <r>** rows (request text, why as small meta, secondary "Add" 44px with upload icon →
the upload flow; received rows show "● Received"); 3 then "<k> more"; **Messages with <staff first
name>** (same rows
and composer; hint "Only you and <staff>'s team"); a quiet links row "Your documents · Your report";
privacy line (lock): "Only you and <staff>'s team can see this file. <assistant> is an AI assistant
that answers only from your documents and never decides anything about your case." Clients have no
hive head and no tabs; their evidence view has no hive head.

### Documents
"Still to come <r>" section (Missing rows, "Why" opens the evidence view) then "Uploaded" section
"<n> files · <p> pages" with the table: Document (role 600 + sub "<type> · <flags>"), Period, Pages,
Read (● Read / ● <n>% read coral / ● Duplicate). Primary "Add documents" in the page's first row.

### Report
760 column: meta line "Written from Study v<n>. Nothing new is analyzed." + secondary "Save as PDF";
one paper (1px `line`, radius 4, 48/56 padding, very soft shadow): meta "HiveForYou · prepared for
<client> · Study v<n>", h2 deliverable, goal, then sections. Audience switch stays (segmented).

### Team notes
760 column, meta "Only people at <firm> see these. Never shown to <client>." Flat note rows
(name 600 + date, text), composer with lock hint "Staff only" + primary "Add note".

### Audit trail
760 column, meta "Every check HiveForYou ran on these documents, and what it found. Nothing here is a
decision." One section "Checks <n>"; each check a row: status dot (Checked / Missing / Unreadable /
Duplicate / Changed), title (600), one sentence of what was compared and what was found, refs; 6 then
"Show all <n>".

### Toast
Ink pill-free box (radius 10, `pop`), white 13.5 text, bottom centre, 2.6 s. Used for "Added.",
"Sent to <staff> in your messages." and "A new code is on its way."

---

## 4. States (every screen)
- Loading: skeleton rows in the page's own layout; top bar and hive head render at once. Your hives:
  skeleton hive rows under the head; the state sentence waits for the summaries.
- Empty: one sentence saying what will appear and the one action that gets there (Your hives with no
  hives = First visit for professionals; an individual with no hives goes to the front page composer).
- Error: inline where it happened — safe message, "Reference <8 chars>", "Try again" only when
  retryable. Other sections keep rendering. A hive whose summary failed still shows its row with name,
  sub and "Updated …", and no status dots (never a wrong count). Never swallow a load error into an
  empty state.
- Pending actions: "Sending…", "Adding…", "Signing in…"; repeat clicks ignored; failures next to the
  control.

## 5. Never
- A second rail or a right-hand nav (the left menu of D24 is the only menu); cards as page structure (the front page example card is the one exception); boxes inside
  boxes; tiles of metrics.
- A second find input on the page; a way to ask the assistant other than the chat (the box can only
  pass a typed question to the chat).
- A floating chat bubble or launcher circle, robot or bot icons, "Hi! 👋" style greetings with emoji.
- Eyebrows, uppercase labels (the evidence page's issuer line is document art, not UI), section numbers.
- More than one filled button per screen; filled status pills; colour without its meaning.
- Monospace, file names as citations or in statements, raw status codes or model kinds on screen.
- "Needs you", "Simulated AI", "Work plan", "Ask anything"; yes/no verdicts from the assistant.
- Promising something that isn't built (no decision buttons before FL-7g; no reminders, export or
  pricing on the front page until they exist; no "View as" switch — the concept's screen switcher is
  concept-only).
- **No AI look:** gradients (the front page ring is the only one), glows, glassmorphism beyond the top
  bar blur, sparkles ✨, robot or orb icons, "AI-powered" badges, tilted floating screenshots, feature
  grids of icon cards, stat tiles ("10x faster"), testimonials or logos we don't have, stock photos,
  mascots, emoji in UI, greetings ("Good morning, Priya!"), dark-mode neon.

## 6. How Cursor uses this
1. Read this file and open the concept before any UI ticket. Concept v5 selectors: the concept bar at
   the bottom left switches screens — `[data-go=front|signin|hives|first]`, `[data-who=staff|client|self]`
   (opens the hive as Priya, Dana or an own hive); front page `[data-mode=clients|self]`,
   `[data-exsel=0..2]`; sign in `#email`, `[data-act=sendcode]`, `#code`, `[data-act=verify]`; Your hives
   `#lpFind`, `[data-queue=all|mine|unassigned]`, `[data-open=dana]`; inside a hive `[data-tab=home|
   documents|report|audit|notes]` (in the left menu at ≥ 1100px: `.side-nav [data-tab=…]`; Your hives:
   `.side-nav [data-queue=…]`), `[data-ev]` opens the evidence view, focus `#omni` opens the find box;
   chat: `[data-side=sarah|people]` (wide Home), `[data-act=opensheet]` (Ask bar / client Ask button),
   `.chip` sends a suggestion, `#sarahDraft` + `[data-act=asksend]`, `[data-act=clientqs]` (staff reads the
   client's questions), `[data-act=handoff]` (client), `[data-act=askpage]` (evidence view). The concept
   bar starts folded on phones (tap "Concept"). Hide `.cnav` before screenshots.
2. Shared components in `components/ui/`; tokens only in `tailwind.config.ts` and globals.
3. Before reporting: real gallery screenshots at 390 and 1280 beside the concept's same state; fix
   differences first.
