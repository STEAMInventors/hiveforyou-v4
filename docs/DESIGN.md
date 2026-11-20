# HiveForYou — DESIGN.md (v3, Concept v4 "the file explains itself")

The design system for every HiveForYou screen. Reference implementation:
`prototype/new/HiveForYou-Concept-v4.html`. Where a screen and this file disagree, this file wins;
where this file is silent, match the concept. The v2 prototype
(`prototype/new/HiveForYou-Complete-Prototype.html`) is superseded — use it only for screens the
concept doesn't draw (front page, My hives, sign-in), restyled with the tokens below.

Brand source: `HiveForYou-Brand-Guide-v1.0.pdf`. Decisions: D18–D21 in `claude/`.

---

## 1. Principles

1. **The file explains itself.** A hive opens on one sentence that says where things stand
   ("9 of 14 documents are in. 8 things to review, and 5 records are still to come."), then what to do
   next, then what the documents show. No dashboards, no tiles.
2. **One box does everything.** The top bar holds a single input: find anything in this hive, or ask the
   assistant. There is no separate search page and no separate Ask page.
3. **People and the page are always one step away.** The conversation with the other person sits beside
   the work (staff) or under it (client). Every statement opens its source page full-size.
4. **No source, no claim (D-011).** Every statement about the documents carries a source reference.
5. **One thing leads.** One filled button per screen (header included). One h1 per page.
6. **Say what the document says, then stop.** Plain words, questions not verdicts, "To review" never
   "Needs you". Never promise what isn't built.
7. **Generic (D-053).** Nothing in a component knows the domain. Labels, topics and checks come from data.

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
| `line-strong` | #D3D8DE | Control borders, composer border |
| `mist` | #F4F6F8 | Input fill at rest, tab count, evidence viewer background, hover rows |
| `hover` | #EEF1F4 | Button hover fill |
| `paper` | #FFFFFF | Page background |
| `page-warm` | #FFFEFB | Document page in the evidence viewer |
| `cite` | #FFF1BF (ring #F3D97A) | Highlighted cited text; search match `mark` |
| `blue` / `blue-deep` / `blue-wash` | #3B7CF6 / #1A56C4 / #E8F0FE | Actions, links, focus, "To review" |
| `coral` / `coral-deep` / `coral-wash` | #EF5143 / #B33A2E / #FDEDEB | Missing, unreadable |
| `honey` / `honey-deep` / `honey-wash` | #F6B826 / #7A5200 / #FEF3D6 | Changed, duplicate, uncertain |
| `leaf` / `leaf-deep` / `leaf-wash` | #2FA35A / #197040 / #E6F4EA | Read, checked, received, progress meter, client avatar |

Colour meaning is fixed: blue = act / to review, coral = missing, honey = changed, leaf = in / checked.
Text in a colour uses the `-deep` value (honey dots use `honey` for the dot, `honey-deep` for the word).

### Type

Fonts: **Outfit** (titles, the state sentence), **DM Sans** (everything else), **Source Serif 4**
(document page text only). No monospace in the UI.

| Role | Size / line | Weight | Font |
|---|---|---|---|
| Hive title (h1) | 28 / 1.15 (24 phones), −0.02em | 600 | Outfit |
| State sentence | 23 / 1.35 (20 phones), −0.02em; trailing clause `ink-3` | 500 | Outfit |
| Evidence statement | 21 / 1.4 | 500 | Outfit |
| Section title (h2) | 17 / 1.3, −0.015em | 600 | Outfit |
| Topic (h3) | 13.5 | 600, `ink-3` | DM Sans |
| Item title | 14.5 | 600 | DM Sans |
| Body | 14.5 / 1.55 | 400 | DM Sans |
| Message text | 14 / 1.55 | 400 | DM Sans |
| Meta | 12.5 / 1.5, `ink-3` | 400 | DM Sans |
| Status word | 12.5 | 600 | DM Sans |

Sentence case everywhere. No uppercase labels, no eyebrows. Counts and amounts use tabular figures.

### Radius, depth, motion

- Radius: buttons 9, composer and top input 12, popover 14, source ref 7, status-free tag 5,
  phone sheet 18 (top corners), document page 4. Circles only for avatars and dots.
- Shadow `lift` = `0 1px 2px rgba(16,24,40,.05), 0 12px 32px -16px rgba(16,24,40,.18)` (focused top
  input). Shadow `pop` = `0 2px 6px rgba(16,24,40,.06), 0 24px 56px -20px rgba(16,24,40,.28)`
  (popover, sheet, toast). Nothing else floats.
- Motion: popover rises 4px in 180ms; document page fades up 8px in 350ms; sheet slides up 260ms; typing
  dots blink. All removed under `prefers-reduced-motion`.

### Layout

| Token | Value |
|---|---|
| Top bar | 64px (60 phones), sticky, white 90% with blur, hairline below |
| Hive content max width | 1240px, padding 32px (16 phones) |
| Home grid | brief `1fr` + conversation `400px`, gap 48 |
| Reading pages (Report, Team notes, Audit trail) | 760px |
| Wide pages (Documents, My hives) | 1040px |
| Evidence split | statement side 340–440px + viewer `1fr`; document page max 680px, 8.5:11 |
| Client home | 460px column, padding 22/20, bottom 120 |

### Breakpoints

| Width | Behaviour |
|---|---|
| ≥ 1100 | Home: brief + sticky conversation column (full height under the top bar, own scroll) |
| < 1100 | Conversation moves under the brief (page scroll); evidence split stacks (statement above page) |
| < 760 | Top bar: mark + box + nothing else (breadcrumb, wordmark text, `/` hint, initials hidden); box popover becomes fixed full-width under the bar; hive head stacks; tabs scroll sideways (44px); step action moves under the step; buttons 44px; tables become stacked rows |

Every page works at 320, 390, 600, 768, 1024, 1280 and 1920px with no horizontal page scroll.
Phone touch targets ≥ 40px (44 for primary actions and inputs).

---

## 3. Components

### Top bar
Three columns: left = mark + "HiveForYou" wordmark + (staff, inside a hive) breadcrumb
"/ All hives / <hive>" (13.5 `ink-3`, hive name `ink` 600, ellipsis); centre = **the box** (max 600px);
right = the signed-in person's initials (30px ink circle). No filled button, no other links inside a hive.
Outside a hive the centre is empty and the right side keeps the quiet "My hives" link.

### The box (find + ask)
- At rest: 42px, `mist` fill, no border, search icon, placeholder "Ask <assistant> or find anything in
  this hive" (staff) / "Ask <assistant> about your documents" (client), `/` hint. Focused: white,
  `line-strong` border, `lift`. `/` focuses it from anywhere; Escape closes.
- Popover (opens on focus, `pop`, max 70vh, own scroll), groups separated by hairlines, group titles
  12px 600 `ink-3`:
  1. **Ask row** first: assistant avatar + "Ask <assistant>: **<query>**" (Enter) or, empty, "Ask
     <assistant> a question about the documents".
  2. Empty query: up to 3 suggestion rows (from data, never hard-coded domain text), then **Your
     questions** (latest 5, each reopens its answer), and for staff **<client>'s questions <n>**
     (read-only, each opens the answer with "<client> asked this. Only your team can see it.").
  3. With a query: **In the documents** (statements, match highlighted with `cite`, topic as sub line,
     page at right) · **Open items** (to review / still to come) · **Documents** (role, type · period,
     pages). Max 4 / 3 / 3. Filtering is client-side over what the page already has; it never calls a
     model. No matches: "Nothing in this hive matches "<q>". Press Enter to ask <assistant>."
- **Answer** (in the popover): the question (600), byline avatar + name + "AI assistant" tag + "answers
  only from the documents", the text, refs, then a foot: privacy line ("Only you can see your
  questions." staff / "Only you and <staff>'s team can see your questions." client) and either
  "Ask <staff first name>" (secondary, client on firm hives, when the reply can't answer or needs a
  person) or "New question" (quiet). Waiting: "Looking through the documents" + three dots; after 20 s
  "…still working on it…". Every answer is also kept in that person's question history.

### Hive head
h1 hive title; sub line "<purpose> · for <client>" (14 `ink-3`); right: avatar stack (client, staff,
assistant; 2px white ring, −6px overlap) + "<client>, <staff> and <assistant>". Then **tabs**:
Home · Documents <n> · Report · Audit trail · Team notes 🔒 (staff only). Text tabs 42px, 14/500
`ink-3`; selected `ink` 600 with a 2px **ink** underline; count in a small `mist` capsule (11.5/600).
`role="tablist"`. Firmless hives: no Team notes, avatars show only the people who exist.

### Status
7px dot + word, 12.5/600 in the meaning's `-deep`: ● To review ● Missing ● Changed ● Uncertain
● Read ● Duplicate ● Received ● Not read yet (grey). Never a filled pill.

### Source reference (`.ref`)
24px, radius 7, 1px `line`, white, 12/500 `ink-2`, 12px doc icon, "<document role> p.<n>" with the page
in `ink-3`; ellipsis at the button's width (cut at a word boundary, full role in `title`). Hover
`blue-wash` / `blue-deep`. Click opens the **evidence view** on that page. Never a file name. Group in
`.refs` (wrap, 6px gap, 8px above).

### Progress meter
Segments (6px high, 3px radius, 3px gap, max 420px; full width on the client home): one per document
asked for; received = `leaf`, not yet = `line`. Label "<n> of <m> documents in". Only shown when the
hive has a checklist; the numbers come from data.

### State sentence (Home)
"<n> of <m> documents are in." (or "<n> documents are in." without a checklist) + "<k> to review" +
", and <r> records are still to come." + `ink-3` clause "<client> last wrote <when>." Parts that are 0
are left out; "Nothing is waiting on you." when everything is 0. Under it: meter, then meta
"Study v<n>, accepted <Mon D> · every statement below opens the page it comes from".

### Section
h2 (17) left, meta count right, 1px **ink** rule under the header row; rows divided by 1px `line`;
40px above each section.

### Step (Next steps)
Grid: status dot + title (14.5/600) on line 1; detail (13.5 `ink-2`) on line 2; one secondary action
at the right spanning both lines (under the step on phones). Steps: first "Ask <client> for <r> missing
records" (detail = first two requests · "<k> more"; action "Write the request" puts the list into the
conversation composer); then each open item ("Look at it" opens its evidence view). Show 3, then
"Show all <n>" / "Show fewer".

### Statement (What the documents show)
Topic h3 (13.5/600 `ink-3`, optional "● Uncertain"), then statements as full-width rows with 10/12px
padding, radius 10, `mist` on hover, "See the page →" (blue-deep 12.5/600) fading in on hover, refs
under the text. The whole row opens the evidence view. 2 per topic, then "<k> more".

### Supporting detail (Home, bottom)
`details` disclosures, closed: "Compare across documents", "Events in date order", "Document coverage",
"How the totals are calculated" — only those with data. Tables per §Tables.

### Conversation (people only)
Header: "Conversation with <other first name>" (16/600) + "People only. <assistant> doesn't take part
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
with an ink ring). Staff on an open item: quiet "Ask <client> about it" (puts a question into the
composer). Right (`mist`): bar "<document role> · <issuer>" / "Page <p> of <n>", then the real page
(white-warm paper, 4px radius, soft shadow) with the cited text highlighted (`cite`). The URL carries
`?source=<ref>` so Back and reload work. Escape closes. No decision buttons until decisions are saved
(FL-7g).

### Tables
Header 12 `ink-3` with an ink rule; rows 14px, `line` dividers, 14px vertical padding; numbers right +
tabular; row hover `#FAFBFC`; whole row clickable when it opens a source. < 760: no header, rows become
a 2-column grid (title + sub left, status right); secondary columns hidden.

### Buttons
| Kind | Look | Use |
|---|---|---|
| Primary | `blue-deep` fill, white, 34px (44 phones), radius 9 | The one main action (Send, Add note) |
| Secondary | white, `line-strong` border, `ink` 600 | Step and row actions |
| Quiet | no border, `ink-2`, hover fill | Back, New question |
| Text | `blue-deep`, hover `blue-wash` | Show all, "<k> more" |
16px outline icons, stroke 1.8, one family. No Unicode arrows as icons (the "→" inside "See the page →"
is text).

### Client home (phone first)
460px column: staff card (44px avatar, "Your file with" / staff name 600 / title); h1 hive title; lead
"<r> things left to send. Everything else is in." (or "Everything we asked for is in. <staff> will be in
touch."); meter full width + "<n> of <m> documents in"; **Still to send <r>** rows (request text,
why as small meta, secondary "Add" 44px with upload icon → the upload flow; received rows show
"● Received"); 3 then "<k> more"; the **Ask button** (52px, radius 14, assistant avatar, "Ask
<assistant> about your documents" → focuses the box); **Messages with <staff first name>** (same rows
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
760 column, same section/row rules; each check a row with status dot, text, refs; 6 then "Show all".

### Toast
Ink pill-free box (radius 10, `pop`), white 13.5 text, bottom centre, 2.6 s. Used for "Added." and
"Sent to <staff> in your messages."

---

## 4. States (every screen)
- Loading: skeleton rows in the page's own layout; top bar and hive head render at once.
- Empty: one sentence saying what will appear and the one action that gets there.
- Error: inline where it happened — safe message, "Reference <8 chars>", "Try again" only when
  retryable. Other sections keep rendering. Never swallow a load error into an empty state.
- Pending actions: "Sending…", "Adding…"; repeat clicks ignored; failures next to the control.

## 5. Never
- A rail; cards as page structure; boxes inside boxes; tiles of metrics on Home.
- A second search or ask input on the page (the box is the only one; the client's Ask button opens it).
- Eyebrows, uppercase labels (the evidence page's issuer line is document art, not UI), section numbers.
- More than one filled button per screen; filled status pills; colour without its meaning.
- Monospace, file names as citations, raw status codes or model kinds on screen.
- "Needs you", "Simulated AI", "Work plan", "Ask anything"; yes/no verdicts from the assistant.
- Promising something that isn't built (no decision buttons before FL-7g; no "View as" switch — that is
  concept-only).

## 6. How Cursor uses this
1. Read this file and open the concept before any UI ticket (`data-who` switches staff/client,
   `data-tab` the tabs, `[data-ev]` opens the evidence view, focus `#omni` opens the box).
2. Shared components in `components/ui/`; tokens only in `tailwind.config.ts` and globals.
3. Before reporting: real gallery screenshots at 390 and 1280 beside the concept's same state; fix
   differences first.
