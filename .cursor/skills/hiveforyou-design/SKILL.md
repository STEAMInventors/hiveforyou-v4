---
name: hiveforyou-design
description: Use for any HiveForYou screen, component, style or layout change — building, restyling or reviewing UI in apps/web. Applies the HiveForYou design system (docs/DESIGN.md) and the reference prototype.
---

# HiveForYou design

Before writing or changing any UI:

1. Read `docs/DESIGN.md` (v4) in full. It is the source of truth for tokens, type, spacing, components,
   long-list rules, states and the "Never" list. Where a screen and this file disagree, this file wins.
2. Open `prototype/new/HiveForYou-Concept-v5.html` and find the same state (see DESIGN.md §6
   selectors: `[data-go=front|signin|hives|first]`, `[data-side=sarah|people]`, `#omni`, etc.).
   Concept v5 supersedes v4; match layout, order, wording and behaviour unless DESIGN.md or the ticket
   says otherwise.
3. Use the shared components in `apps/web/src/components/ui/` (create them from DESIGN.md section 7 if
   they don't exist yet). Never restyle a one-off copy.
4. Tokens only from `tailwind.config.ts` and globals. No new hex values, no new font sizes.

Checks before you report:

- One filled button on the screen, header included. No box inside a box. No eyebrows or uppercase.
- Status is a dot plus a word. Source references are quiet `<role> · p.<n>` tags, never file names.
- Long lists follow the limits (5 items, 3 statements per topic, 6 rows) with "Show all <n>".
- Works at 320, 390, 768, 1024, 1280 and 1920px with no horizontal page scroll; phone targets at least 40px.
- Loading, empty and error states exist; errors show a reference and "Try again" only when retryable.
- Real screenshots at 390px and 1280px of every page touched, compared with the prototype.
- Wording: "To review" (never "Needs you"), "AI assistant" (never "Simulated AI"), no "Work plan".