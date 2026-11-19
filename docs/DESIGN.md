# HiveForYou — DESIGN.md

The design system for every HiveForYou screen. The reference implementation is
`prototype/new/HiveForYou-Complete-Prototype.html` (v2, "calm document desk"). Where a screen and
this file disagree, this file wins; where this file is silent, match the prototype.

Brand source: `HiveForYou-Brand-Guide-v1.0.pdf`. Decisions: D18–D20 in `claude/`.

---

## 1. Principles

1. **A calm document desk.** HiveForYou is a tool people work in (professionals) and a place anxious
   people come to understand paperwork (clients). Craft shows as precision and restraint, not decoration.
2. **Space and rules, not boxes.** Sections are separated by space and a single rule. A bordered box is
   only for something you act on or hold: the message composer, a report page, the side panel, a table.
   Never put a box inside a box.
3. **No source, no claim (D-011).** Every statement about the documents carries a source reference that
   opens the page. The reference is the brand's signature element; it is quiet until touched.
4. **One thing leads.** One filled button per screen (header included). One h1 per page. Type steps are
   obvious.
5. **Say what the document says, then stop.** Voice from the brand guide: plain words, name what's
   missing, questions not verdicts, "To review" never "Needs you".
6. **Generic (D-053).** Nothing in a component knows the domain. Labels, topics and checks come from data.

---

## 2. Tokens

Use these names in `tailwind.config.ts` / globals. No hex values anywhere else.

### Colour

| Token | Value | Use |
|---|---|---|
| `ink` | #1B1F24 | Text, section rules |
| `ink-2` | #454D57 | Secondary text, body on dense rows |
| `ink-3` | #6B737D | Meta, labels, counts (≥4.5:1 on white) |
| `line` | #E7E9EC | Row dividers, borders |
| `line-strong` | #D6DADE | Control borders |
| `paper` | #FFFFFF | Page background |
| `canvas` | #F7F8FA | Rail background only |
| `hover` | #F3F4F6 | Hover fill, segmented control track |
| `blue` / `blue-deep` / `blue-wash` | #3B7CF6 / #1A56C4 / #EEF3FE | Actions, links, focus, "To review", current |
| `coral` / `coral-deep` / `coral-wash` | #EF5143 / #B3392D / #FDF0EE | Missing, unreadable, alerts |
| `honey` / `honey-deep` / `honey-wash` | #F6B826 / #7A5200 / #FEF6E0 | Changed, duplicate, uncertain |
| `leaf` / `leaf-deep` / `leaf-wash` | #2FA35A / #1D7A42 / #EAF5EE | Read, checked, complete, client avatar |

Colour **meaning is fixed**: blue = act / to review, coral = missing, honey = changed, leaf = checked.
Never use a colour decoratively. Text in a colour always uses the `-deep` value.

### Type

Fonts: **Outfit** (titles only), **DM Sans** (everything else), **Source Serif 4** (document page excerpts only).
No monospace in the UI.

| Role | Size / line | Weight | Font |
|---|---|---|---|
| Page title (h1) | 30 / 1.15 (26 on phones), tracking −0.02em | 600 | Outfit |
| Section title (h2) | 19 / 1.3 | 600 | Outfit |
| Item title | 15 / 1.45 | 600 | DM Sans |
| Body | 15 / 1.6 | 400 | DM Sans |
| Meta | 13 / 1.5, `ink-3` | 400 | DM Sans |
| Label / small | 12.5 | 500 | DM Sans |
| Glance value | 20 / 1.3 | 600 | Outfit |
| Front-page headline | clamp(40px, 6vw, 64px) / 1.04, tracking −0.04em | 600 | Outfit |

Sentence case everywhere. **No uppercase labels, no eyebrows above headings.** Numbers in tables,
counts and amounts use tabular figures (`font-variant-numeric: tabular-nums`). Body text max 75
characters a line (reading column 760px).

### Space, radius, depth

- Spacing scale (px): 4, 8, 12, 16, 20, 24, 28, 36, 48, 64. Sections: 36 above the heading, 12 below
  the heading to its rule. More space above a heading than below it.
- Radius: controls 8, surfaces (composer, drawer content) 12, chips 6, report paper 4. No pills except
  the avatar circle.
- Shadow: only on things that float — drawer and toast (`0 12px 32px -8px rgba(20,30,50,.18)`), the
  sticky composer (soft), report paper (very soft). No shadows on rows or sections.

### Layout

| Token | Value |
|---|---|
| Top bar | 60px (56 on phones), sticky, white with hairline |
| Rail | 240px, `canvas`, full height, sticky |
| Reading column | 760px (Board, Findings, Reports, Audit trail, Team notes) |
| Wide column | 1040px (Documents, My hives) |
| Page padding | 28px 40px desktop; 20px 16px phones |

### Breakpoints

| Width | Behaviour |
|---|---|
| ≥ 1280 | Findings shows the "On this page" list in a 200px right margin |
| 900–1279 | Rail + one column; "Jump to…" select instead of the margin list |
| < 900 | Rail becomes one horizontal, scrollable tab row under the top bar (hive card and footer hidden); page head stacks; buttons 44px high; item action moves under the item; tables with `stack-sm` become stacked rows |
| < 400 | Glance row becomes one column; front-page headline 36px |

Every page must work at 320, 390, 600, 768, 1024, 1280 and 1920px with no horizontal page scroll.
Touch targets on phones ≥ 40px (44 for primary actions and inputs).

---

## 3. Components

Class names refer to the prototype; implement them as React components with the same anatomy.

### Top bar
Brand (mark + "HiveForYou") left. Right: quiet text buttons ("How it works", "My hives"/"All hives"),
then the signed-in person's initials. **No filled button in the top bar.**

### Rail (hive navigation)
- Hive card: initials square (34px, white, hairline) + hive name (14/600) + purpose (12.5, 2 lines max).
- Items: Hive board, Documents, Findings, Reports, Audit trail, Team notes (staff only, lock icon).
  No Work plan. 36px rows, 18px outline icons, 14px/500 `ink-2`.
- Current item: white fill, 1px `line` ring, `ink` 600 text, icon in `blue-deep`, `aria-current="page"`.
- Counts are plain tabular numbers at the right (`ink-3`); Findings' open count is `coral-deep`.
  Hive board count = unread messages. No count when the summary fails (never a wrong number).
- Footer: "Study v3 · accepted Oct 28" and "Every finding opens its source page."

### Page head
Breadcrumb (13px meta: "All hives / <hive>"), h1, one line of description (`ink-2`), and at most one
action at the right (primary only if it's the page's one primary action).

### Section
`<section>` with a header row: h2 left, meta or a control right, then a **1px `ink` rule**. Rows below
are separated by 1px `line`. No card around the section.

### Meta line
Short facts separated by small dots: "Study v3, accepted Oct 28 · 9 documents · 8 to review".

### Glance row
A definition list in one band (top and bottom hairline, vertical hairlines between): label (12.5 meta),
value (Outfit 20), one sub line, optional "How it's calculated" text button. Max 4 entries. Only true
counts or calculated values that exist in data — never phrases, never status codes.

### Status
A 7px dot and a word, 13/600, in the meaning colour's `-deep`: ● To review, ● Missing, ● Changed,
● Read, ● Duplicate, ● Uncertain, ● Not read yet (grey). **Never a filled pill.**

### Source reference (`.ref`)
24px high, 6px radius, 1px `line` border, white, 12.5/500 `ink-2`, small document icon, label
"<document role> · p.<n>" (role from the canonical study, max ~24 characters then "…"; full name in
`title`). Hover: `blue-wash` fill, `blue-deep` text. Opens the side panel on that page. **Never a file
name, never monospace, never honey.** Group with `.refs` (wraps, 6px gap).

### Item row (open items, requests)
Grid: status + item title on the first line; one line of detail (`ink-2`, 14); refs; the action at the
right (secondary small button, e.g. "Review", "Add it"). One action per row. Phones: action under the item.
Don't repeat the title as a question.

### Statement
Body text then refs; rows divided by hairlines. Topics are h3 (15/600) with their count in meta and an
optional status ("● Uncertain").

### Long lists (generic rules)
- Item lists show **5**, then "Show all <n>" (text button); expanded lists offer "Show fewer".
- Topics show **3** statements, then "<k> more in <topic>".
- Timelines, audit checks and similar rows show **6**.
- Headings carry their count ("To review 19", "Uncertain 6").
- A list with more than one kind gets a segmented filter with counts ("All 19 · Missing 9 · Changed 5 ·
  To review 5").
- A page with more than 3 sections gets "On this page" (≥1280px, sticky, current section highlighted)
  or "Jump to…" (<1280px).
- A page that can exceed ~30 rows gets "Filter by a word, name or amount": filters what's on the page,
  shows "<n> items and <m> statements match "<q>" · Clear", never calls a model, never looks like "Ask".
- Filtering or searching always shows every match (limits don't apply).

### Segmented control (`.seg`)
Track `hover`, 3px padding; options 30px (40 on phones), 13px; selected = white, 1px ring, 600.
Scrolls sideways if it doesn't fit. Use for filters and the report audience — not for page navigation.

### Disclosure (`details.more`)
A full-width row with title (600), meta hint right, chevron that rotates; hairline below. Closed by default.

### Tables
Header 12.5 meta with an `ink` rule under it; rows 14px with `line` dividers; numbers right-aligned and
tabular; row hover `#fafbfc`; action column right-aligned with quiet buttons. Wrap in `.scrollx`; tables
whose rows are objects (Documents) use the stacked phone layout.

### Buttons
| Kind | Look | Use |
|---|---|---|
| Primary | `blue-deep` fill, white, 8px radius, 36px (44 phones) | The single main action of the screen |
| Secondary | white, 1px `line-strong`, `ink` | Other actions |
| Quiet | no border, `ink-2`, hover fill | Top bar, table actions, close |
| Text | `blue-deep`, no border | "Show all", "See items", "How it's calculated" |
Icons are 16px outline SVG in one family (stroke 1.8). No Unicode arrows or emoji as icons.

### Conversation (Hive board)
- Above: "Still to come" bar — label, thin leaf progress bar, "<in> of <total> in", "See items →".
- Messages are flat rows (no bubbles): 32px round avatar (client = leaf-wash initials, staff = blue-wash
  initials, assistant = ink circle with the hive mark), byline "<name> · <role> · <time>", body 15px,
  refs under the body. The assistant's byline carries an "AI assistant" tag (bordered, 11.5/600).
  The viewer's own messages add "· you" after the name.
- Date dividers ("Today") centred between hairlines.
- Typing line: "<assistant> is looking through the documents…" (`role="status"`).
- Composer: one bordered surface (12px radius) sticky at the bottom of the column; textarea without its
  own border; bottom bar with a hint (staff: "The client sees this. Start with "<assistant>" to ask the
  assistant.") and **Send** (the page's primary). Enter sends, Shift+Enter new line.
- Staff-only "Preview as" below the composer.

### Side panel (drawer)
520px from the right, scrim 28% ink, slides in 220ms ease-out. Header: title + close. Content uses h4
meta labels ("What this supports", "Why it's uncertain"). The **page excerpt** is set in Source Serif 4
on warm white (#FFFEFB) with a hairline and soft shadow, the cited text highlighted (#FFF1BF); source
line above it in meta. Decisions go in a footer bar.

### Report paper
One white page (4px radius, hairline, soft shadow), 48/56px padding, brand at top with audience and
Study version, h2 title, plain paragraphs; professional version adds refs and a sources table.
Print stylesheet hides everything else.

### Team notes
Flat note rows (name · date, text) and a static composer with "Staff only" and a lock icon.
Page line: "Only people at <firm> see these. Never shown to <client>."

### Front page
Centred headline "What are you working on?", one lead line, the **four-colour ring** input (the brand's
input signature: 2px ring in blue/coral/honey/leaf quarters) with an icon submit button (primary),
"Try:" suggestions as quiet text buttons, then "Add documents" (secondary) and "See a sample hive"
(quiet). "How it works": three columns with a 2px top rule in blue / honey / leaf — no cards, no numbers.

### My hives
A list, not cards: initials square, name (600) + purpose (meta), "<n> documents · Study v<n>", and a
status ("● 8 to review" / "● Up to date"). Primary "New hive" in the page head.

---

## 4. States (every screen)

- **Loading:** skeleton rows in the page's own layout (no full-page spinner); the rail renders at once.
- **Empty:** one sentence saying what will appear and the one action that gets there.
- **Error:** inline where it happened — safe message, "Reference <8 chars>", "Try again" only when
  retryable. Other sections keep rendering. Never swallow a load error into an empty state.
- **Pending actions:** the control says "Saving…"/"Sending…", ignores repeat clicks; failures appear next
  to the control.

## 5. Browser details

Focus: 2px `blue` outline, 2px offset, on every interactive element. Text selection `#CFE0FD`.
Thin scrollbars in `line-strong`. Underline offset 3px. Reduced motion removes all animation.
Only one motion moment: the side panel slide.

## 6. Never

- A box inside a box; cards as page structure; same-size icon cards in a row.
- Eyebrow labels, uppercase labels, section numbers ("01.").
- More than one filled button on a screen (header included).
- Filled status pills; colour used without its meaning; honey for anything but changed/uncertain/duplicate.
- Monospace in the UI; file names as citations; raw status codes or model kinds on screen ("matches",
  "worth-asking", "decision").
- A coloured bar down one side of a box; gradient text; glass/blur as decoration (the top bar's
  translucency is the one exception).
- Repeating the same text twice in a row (a title restated as a question).
- "Needs you", "Simulated AI", "Work plan", "Ask anything".
- Promising something that isn't built.

## 7. How Cursor uses this

1. Read this file and open the prototype before any UI ticket.
2. Build shared components once (`components/ui/`): Section, StatusDot, SourceRef, ItemRow, Statement,
   GlanceRow, Segmented, Disclosure, ShowMore, OnThisPage, PageHead, Drawer, Composer.
3. Tokens live only in `tailwind.config.ts` and globals.
4. Before reporting, capture real screenshots at 390px and 1280px of every page touched (signed-in test
   hive), compare with the prototype's same page, and fix differences first.
