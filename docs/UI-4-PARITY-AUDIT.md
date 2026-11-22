# UI-4 — Concept v5 implementation parity audit

**Date:** 2026-11-21 (screenshots re-verified **2026-11-22**, ticket **UI-4-01**)  
**Branch / revision audited:** `hotfix-menu-report-timeline` (includes hotfix `4967144` — Timeline nav + Report → `/reports`)  
**Scope:** Read-only audit plus **UI-4-01** changes to `scripts/ui-shots.mjs` only (server bootstrap + concept navigation). No product UI changes.

## Sources of truth

| Priority | Source | Role |
| --- | --- | --- |
| 1 | `docs/DESIGN.md` | Wins over the concept where they disagree |
| 2 | `prototype/new/HiveForYou-Concept-v5.html` | Reference flow and layout (§6 selectors) |
| 3 | React on `main` | Implementation under test; gallery fixtures at `/dev/gallery/[page]` |

**Hotfix `4967144`:** Left menu and narrow tabs include **Timeline** (`/hives/[id]/timeline`) and **Report** routes to `/reports`. Treat Timeline as an **approved product change** not yet reflected in DESIGN.md or Concept v5 HTML.

## Methodology

1. Mapped production routes and dev gallery keys to the nine audit screens.
2. Compared structure, copy, navigation, tokens, and responsive layout tokens against DESIGN.md and Concept v5 (HTML `data-tab` / `data-queue` lists).
3. Reviewed component tests that assert Concept v5 behaviours (omni, chat, sidebar, reports, timeline).
4. Ran engineering checks (see below).
5. **Visual screenshots:** **`npm run ui:shots`** after UI-4-01 (Playwright gallery + concept at DESIGN widths). **474 PNGs** under `apps/web/.ui-shots/`. Pairwise comparison at **390** and **1280** against Concept v5 where `conceptStates` defines a match; see [UI-4-01 screenshot baseline](#ui-4-01-screenshot-baseline-2026-11-22).

## Engineering verification (this machine)

| Command | Result |
| --- | --- |
| `npm run typecheck` | **PASS** (2026-11-22) |
| `npm run lint` | **PASS** (0 errors, 33 warnings — pre-existing unused vars / hook deps) |
| `npm run build` | **PASS** (Next.js 15.5.28 production build + `assert-packs-traced`) |
| `npm test` (root) | **NOT RUN** (out of scope for UI-4-01; prior audit: contracts pass + worker timeout exit 1) |
| `npm run test -w @hiveforyou/web` | **NOT RUN** (out of scope; prior audit: 6 failures / flakes) |
| `npm run ui:shots` | **PASS** (exit 0 after UI-4-01; ~474 files in `apps/web/.ui-shots/`) |

**Note:** UI parity is independent of flaky API route timeouts; web test stabilization remains **UI-4-12**.

### Screenshot rerun

```bash
npm run build
npm run ui:shots
```

`scripts/ui-shots.mjs` (UI-4-01) will **`next start -H 127.0.0.1`** on `UI_SHOTS_PORT` (default **3000**) when the gallery is not already healthy. Env:

| Variable | Default | Purpose |
| --- | --- | --- |
| `UI_SHOTS_MANAGE_SERVER` | `1` | Set `0` to require a manually started server |
| `UI_SHOTS_PORT` | `3000` | Port for auto-started server |
| `UI_SHOTS_BASE_URL` | `http://127.0.0.1:<port>` | Override base URL (skips auto-start unless default host) |
| `UI_SHOTS_CONCEPT_ONLY` | — | Set `1` to capture concept HTML only |

If port 3000 accepts TCP but `/api/health` never responds, stop the stale `node` process or set `UI_SHOTS_PORT`.

Outputs: `apps/web/.ui-shots/gallery-<page>-<width>.png`, `concept-<state>-<width>.png`.  
Key report pairings: `gallery-<key>-390.png` / `gallery-<key>-1280.png` beside `concept-<key>-390.png` / `concept-<key>-1280.png` where `conceptStates` in `scripts/ui-shots.mjs` defines a match.

### UI-4-01 root cause (2026-11-22)

1. **No server lifecycle:** Original `ui:shots` assumed `next start` was already running; Playwright `goto` waited **120s** per page with nothing listening (or a **zombie listener** on `:3000` that accepted TCP but never returned HTTP).
2. **Concept navigation on v5 HTML:** At **≥1100px**, Concept duplicates hive tabs and queue controls in **side-nav** and **tablist**; Playwright strict mode failed on `[data-tab="…"]` and `[data-queue="mine"]`. Fixed via `clickConceptHiveTab` / `clickConceptQueue`.

### UI-4-01 screenshot baseline (2026-11-22)

**Artifacts:** `apps/web/.ui-shots/` — gallery keys from `galleryPages` in `scripts/ui-shots.mjs` (widths **320, 390, 600, 768, 1024, 1280, 1920**); concept slugs from `conceptStates` (widths **390, 768, 1280, 1920**).

**Responsive (overflow):** `ui:shots` reported **exit 0** with no gallery console/page errors at **390** and **1280**; full-width overflow list is stdout-only (not persisted to `ui-shots-log.txt` on this host). Spot-check PNGs show no obvious horizontal scroll chrome at **390** on front, hives, home, audit, report, client home.

**Concept pairs verified at 390 / 1280** (19 concept slugs): `front*`, `sign-in-*`, `hives-firm|mine|first-visit`, `home-staff*`, `home-narrow-askbar`, `omni-answer`, `documents`, `evidence-item|evidence-ask-page`, `client-home`, `chat-sheet-client`.

**No concept baseline** (gallery only): `report`, `audit`, `notes`, timeline (no gallery key), `hives-find-none`, `hives-own`, `hives-error`, most omni/home edge states.

| Area | @390 / @1280 visual vs Concept | Notes |
| --- | --- | --- |
| Landing | **PARTIAL** | Structure matches; gallery hero uses **four-colour ring**, concept uses **speech bubbles**; example band figures differ ($2,140 vs $2,340 gross pay); footer year differs |
| Your hives | **PARTIAL** | Left menu + queues align at 1280; **fixture rows, counts, and names** differ (e.g. Mine **5** vs **4**, 9-doc meter vs 14-doc meter in concept) |
| Home staff | **PARTIAL** | Grid and omni/side panel present at 1280; **meter copy** (6/9 vs 9/14), **titles**, and **right panel default** (gallery people thread vs concept Sarah assistant tab) diverge |
| Documents | **FAIL layout parity** | Concept shows **Still to come** + rich **Uploaded** table; gallery fixture is **upload-only** stub (uniform dates, all “Not read yet”) |
| Report | **N/C** | Gallery shows **Timeline** tab (approved hotfix); no `concept-report` capture |
| Audit | **N/C** | Wrong meta + extra sections (code audit); no `concept-audit` |
| Client home | **PARTIAL** | Column layout matches; verify touch targets separately (UI4-9-01) |

---

## Summary table

| # | Screen | vs DESIGN | vs Concept v5 | Visual @390/1280 | Functional (fixtures/tests) |
| --- | --- | --- | --- | --- | --- |
| 1 | Signed-out landing + sign-in | **PARTIAL** | **PARTIAL** | **VERIFIED PARTIAL** | **PARTIAL** |
| 2 | Your hives | **PASS** | **PARTIAL** | **VERIFIED PARTIAL** (fixture drift) | **PASS** |
| 3 | Hive Home + assistant | **PARTIAL** | **PARTIAL** | **VERIFIED PARTIAL** | **PASS** |
| 4 | Documents | **PARTIAL** | **PARTIAL** | **VERIFIED FAIL** (missing Still to come) | **PASS** |
| 5 | Timeline | **PARTIAL** (approved nav) | **FAIL** (no prototype screen) | **NOT CAPTURED** (no gallery key) | **PASS** |
| 6 | Reports + earlier versions | **PARTIAL** | **PARTIAL** | **GALLERY ONLY** | **PASS** |
| 7 | Audit trail + Team notes | **FAIL** | **FAIL** | **GALLERY ONLY** | **PARTIAL** |
| 8 | Evidence viewer | **PARTIAL** | **PARTIAL** | **VERIFIED PARTIAL** | **PASS** |
| 9 | Client mobile Home + chat | **PARTIAL** | **PARTIAL** | **VERIFIED PARTIAL** | **PASS** |

---

## 1. Signed-out landing page and sign-in

**Assessment:** **PARTIAL** (code + content); visual **VERIFIED PARTIAL** at 390/1280 (`gallery-front-*` vs `concept-front-*`).

**Aligned**

- Front page structure matches DESIGN §3: hero 720px, sections 1120px, four-colour ring, segmented “For my clients / For myself”, example band, footers (`apps/web/src/app/page.tsx`, `GalleryUI3Bundle.tsx` `LandingPageSections`).
- Signed-out bar: mark, wordmark, optional “Sign in” (`SignedOutBar.tsx`).
- Sign-in column `max-w-[400px]` (`SignInShell.tsx`); gallery covers email, prefill, code, and error states.

**Discrepancies (defects)**

| ID | Sev | Issue | Evidence |
| --- | --- | --- | --- |
| UI4-1-01 | P2 | Production “What it covers” uses live practice areas; gallery uses static `COVERS` — parity screenshots can diverge without being product bugs | `page.tsx` vs `GalleryUI3Bundle.tsx` |
| UI4-1-02 | P2 | Signed-in visitors redirect to `/hives` on `/`; not exercisable in gallery | `page.tsx`; `page.test.tsx` flaky/skipped |

**UX improvements (not defects)**

- Extra routes (`/login`, `/register`, `/forgot-password`, …) exist without Concept v5 equivalents; acceptable legacy as long as they stay visually on-system.

**Screenshots:** `gallery-front-*`, `gallery-sign-in-*`, `concept-front-*`, `concept-signin-*` (**captured 2026-11-22**).

**Recommended ticket:** Align example-band fixture figures with concept (or document intentional drift); landing redirect test → **UI-4-12** if CI-blocking.

---

## 2. Your hives — firm, individual, search, empty states

**Assessment:** **PASS** vs DESIGN; **PARTIAL** vs concept (no dedicated gallery for Unassigned queue); visual **VERIFIED PARTIAL** at 1280 (`hives-firm`).

**Aligned**

- Width `max-w-col-wide` (1040) + padding (`MyHivesPanel.tsx` 307–308).
- State sentence, queue tabs, grouped sections, hive rows, firm left menu ≥1100px (`HivesLeftMenu`, `hive-list-copy.ts`).
- First visit 640px (`HivesFirstVisit.tsx`).
- In-place find (`data-testid="hives-find"`); gallery `hives-find-none`.

**Discrepancies**

| ID | Sev | Issue | Evidence |
| --- | --- | --- | --- |
| UI4-2-01 | P2 | No gallery page for **Unassigned** queue (`?queue=unassigned`) | `dev/gallery/[page]/page.tsx` `PAGES` |
| UI4-2-02 | P2 | `/hives/new-client` and `/welcome` — real flows, no gallery | routes under `apps/web/src/app/` |

**Screenshots:** `gallery-hives-firm|mine|find-none|first-visit|own|error|hives-firm-menu-*`.

**Recommended ticket:** UI-4-02 — Add `hives-unassigned` gallery key + ui:shots concept `data-queue="unassigned"`.

---

## 3. Hive Home — overview, next steps, findings, assistant panel

**Assessment:** **PARTIAL**; visual **VERIFIED PARTIAL** at 390/1280 (`home-staff`, `home-narrow-askbar`); functional **PASS** (broad test coverage).

**Aligned**

- State sentence, meter, next steps, “What the documents show”, source refs (`HiveHome.tsx`).
- Home grid 400px side panel + 48px gap at ≥1100px; Ask / People tabs; firmless single column.
- Omni find-only box (`OmniBox.tsx`); assistant chat (`AskChat.tsx`) — greeting, chips, refs, handoff covered in tests.
- Narrow Ask bar + chat sheet (`home-narrow-askbar`, `chat-sheet-client` gallery keys).

**Discrepancies**

| ID | Sev | Issue | Evidence |
| --- | --- | --- | --- |
| UI4-3-01 | P1 | Workspace content uses **`max-w-col-wide` (1040px)** for all hive sections; DESIGN specifies hive content **1240px** (`max-w-content` exists in `tailwind.config.ts` but unused) | `WorkspaceShell.tsx` 149 |
| UI4-3-02 | P2 | Firmless home max **760px** (`max-w-col-read`); DESIGN own-hive brief **820px** | DESIGN §3 Own hive; `HiveHome.tsx` layout |
| UI4-3-03 | P2 | Timeline content on Home (**disclosure “Events in date order”**) **and** dedicated Timeline page — duplication vs concept (events only on Home) | `HiveHome.tsx` 508–515; `HiveTimelinePanel.tsx` |

**Screenshots:** `gallery-home-staff|home-staff-chat|home-staff-people|home-narrow-askbar|home-older-study|home-no-study|home-assistant-off-*`; concept `home-staff*`.

**Recommended tickets**

- **UI-4-03 (P1):** Adopt `max-w-content` (1240) for hive workspace main column; verify Documents wide 1040 vs home grid per DESIGN.
- **UI-4-04 (P2):** Decide single surface for timeline (Home disclosure only vs page); update DESIGN if Timeline page is canonical.

---

## 4. Documents

**Assessment:** **PARTIAL**; visual **VERIFIED FAIL** at 1280 (gallery lacks concept **Still to come** band); functional **PASS** (`DocumentsPanel.test.tsx`).

**Aligned**

- Wide column 1040; Still to come + Uploaded sections; Analyze / Rebuild flows (backend unchanged in audit).
- Gallery `documents`, `documents-empty`.

**Discrepancies**

| ID | Sev | Issue | Evidence |
| --- | --- | --- | --- |
| UI4-4-01 | P2 | “Open study revision” still links to **`/study`** (legacy redirect to Home), not a stable in-app anchor | `DocumentsPanel.tsx` + `hiveStudyPath` in `hive-routes.ts` 77–79 |
| UI4-4-02 | P2 | Workspace shell width (1040) may squeeze Documents table vs DESIGN “wide 1040” intent inside 1240 shell | `WorkspaceShell.tsx` |

**Screenshots:** `gallery-documents-*`, `concept-documents-*` (**2026-11-22** — layout mismatch on Still to come).

**Recommended ticket:** UI-4-05 — Replace `/study` links with Home meta or Report per product intent.

---

## 5. Timeline

**Assessment:** **PARTIAL** vs approved hotfix; **FAIL** vs Concept v5 / current DESIGN.md; visual **NOT VERIFIED**.

**Approved implementation (`4967144`)**

- Nav: Home · Documents · **Timeline** · Report · Audit trail · Team notes (`hive-menu-tabs.ts` 13–19).
- Route `apps/web/src/app/hives/[hiveId]/timeline/page.tsx` → `HiveTimelinePanel` (“Events in date order”).
- Tests: `HiveTimelinePanel.test.tsx`, `hive-menu-tabs.test.ts`, `HiveSidebar.test.tsx` (Report `href` → `/reports`, Timeline `data-tab`).

**Gaps**

| ID | Sev | Issue | Evidence |
| --- | --- | --- | --- |
| UI4-5-01 | P0 | **DESIGN.md and Concept v5 omit Timeline** as a tab; prototype menu is only home, documents, report, audit, notes | `HiveForYou-Concept-v5.html` 802–803, 822–823; DESIGN §3 Left menu |
| UI4-5-02 | P1 | **No dev gallery or ui:shots concept state** for Timeline — cannot regression-test parity | `dev/gallery/[page]/page.tsx`; `scripts/ui-shots.mjs` `conceptStates` |
| UI4-5-03 | P2 | Duplicate timeline UX on Home disclosure + Timeline page | `HiveHome.tsx` vs `HiveTimelinePanel.tsx` |

**Functional:** Timeline list uses `FindingsTimelineList` with evidence provider; empty / older-study / error patterns mirror Home (`timeline-study-error`, `timeline-no-study` test ids).

**Recommended tickets**

- **UI-4-06 (P0 docs):** Update DESIGN.md §3/§6 for Timeline nav and route (founder-approved via `4967144`).
- **UI-4-07 (P1):** Add `timeline` gallery view + ui-shots concept navigation (or document parity baseline = DESIGN disclosure only).
- **UI-4-04:** Resolve Home vs Timeline duplication.

---

## 6. Reports and earlier versions

**Assessment:** **PARTIAL**; visual **NOT VERIFIED**; functional **PASS** (`ReportsPanel.test.tsx` includes Earlier versions).

**Aligned**

- Read column 760px on reports page (`reports/page.tsx`, `max-w-col-read`).
- Meta “Written from Study v… Nothing new is analyzed.” (`ReportsPanel.tsx` 232).
- Audience segmented control; `flatInPaper` on main `StudyReport` (no nested cards in body).
- **Earlier versions** section when `history.length > 1` (314–337).
- Hotfix: sidebar/tab **Report** → `/hives/[id]/reports` (`HiveSidebar.test.tsx` 59–69).

**Discrepancies**

| ID | Sev | Issue | Evidence |
| --- | --- | --- | --- |
| UI4-6-01 | P1 | **Earlier versions** wrapped in bordered `CARD` (`rounded-input border`) — DESIGN Report is **one paper**; nested box may violate §5 “no boxes inside boxes” | `ReportsPanel.tsx` 49, 314–337 |
| UI4-6-02 | P2 | Gallery `report` omits outer page meta wrapper present in production | `GalleryUI2Bundle.tsx` vs `reports/page.tsx` |
| UI4-6-03 | P2 | “Save as PDF” in DESIGN — verify presence vs unbuilt guardrail (DESIGN §5) | manual check when built |

**Screenshots:** `gallery-report-*` (**2026-11-22**); **no** `concept-report` in `conceptStates` — concept comparison **NOT POSSIBLE**.

**Recommended ticket:** UI-4-08 — Restyle Earlier versions as in-paper list (no second card); extend ui-shots concept `data-tab=report`.

---

## 7. Audit trail and Team notes

**Assessment:** **FAIL** vs DESIGN / concept copy and information architecture; visual **NOT VERIFIED**.

### Audit trail

**DESIGN / v5 expectation:** 760 column; meta “Every check HiveForYou ran on these documents…”; **one** section “Checks \<n\>”; rows with status dot, title, one sentence, refs; pagination “Show all” (`DESIGN.md` 446–450).

**Implementation:**

```72:74:apps/web/src/app/hives/[hiveId]/audit/page.tsx
      <p className="m-0 mb-6 text-meta text-ink-3">
        How HiveForYou reached its findings: each check, its method and result.
      </p>
```

```104:106:apps/web/src/components/audit/AuditTrailPageView.tsx
        <PaginatedSection
          title="Checks and methods"
```

Extra sections **Study versions** and **Activity** (132–191) are **not** in DESIGN or Concept v5 audit screen.

| ID | Sev | Issue | Evidence |
| --- | --- | --- | --- |
| UI4-7-01 | P1 | Wrong **meta copy** on prod + gallery | `audit/page.tsx` 72–74; `GalleryUI2Bundle.tsx` |
| UI4-7-02 | P1 | Section title **“Checks and methods”** vs DESIGN **“Checks”** | `AuditTrailPageView.tsx` 105 |
| UI4-7-03 | P2 | **Study versions** + **Activity** sections — scope creep vs v5 | `AuditTrailPageView.tsx` 132–191 |

### Team notes

**Aligned:** 760 read width; firm/client meta on production notes page; lock on tab; staff-only gate.

| ID | Sev | Issue | Evidence |
| --- | --- | --- | --- |
| UI4-7-04 | P2 | Gallery `notes` **drops** meta paragraph | `GalleryUI2Bundle.tsx` vs `notes/page.tsx` |

**Screenshots:** `gallery-audit|notes-*`; concept audit not in `conceptStates` — **NOT VERIFIED**.

**Recommended ticket:** UI-4-09 — Audit trail: DESIGN copy, single Checks section (relocate versions/activity or hide behind disclosure); sync gallery.

---

## 8. Evidence viewer

**Assessment:** **PARTIAL**; visual **NOT VERIFIED**; functional **PASS** (evidence tests, `?source=` routing).

**Aligned**

- Split layout: statement column + mist viewer; back link; refs; “Ask assistant about this page” (`EvidenceViewer.tsx`, `EvidenceViewPanel.tsx`).
- Gallery: `evidence-statement|item|unreadable`, `evidence-ask-page`.
- Client evidence: no hive head (DESIGN §3 Client home).

**Discrepancies**

| ID | Sev | Issue | Evidence |
| --- | --- | --- | --- |
| UI4-8-01 | P2 | Statement column width tokens vs DESIGN 340–440px — verify at 390/1280 when shots exist | DESIGN §2 Layout |
| UI4-8-02 | P2 | FL-7g: confirm no decision buttons on evidence (DESIGN) | `EvidenceViewPanel.tsx` |

**Screenshots:** `gallery-evidence-*`, `concept-evidence-item-*`.

**Recommended ticket:** UI-4-10 — Evidence viewer responsive pass with ui-shots at 320/390/1280.

---

## 9. Client mobile Home and assistant chat

**Assessment:** **PARTIAL**; visual **NOT VERIFIED**; functional **PASS** (`client-home-model.test.ts`, `AskChat` tests).

**Aligned**

- 460px column, meter, Ask button 52px, suggestion chips, Still to send, messages thread (`ClientHome`, gallery `client-home*`).
- Chat sheet full-screen on phones (`chat-sheet-client`); handoff (`omni-client-handoff`).
- Privacy line with lock; assistant answers only from documents.

**Discrepancies**

| ID | Sev | Issue | Evidence |
| --- | --- | --- | --- |
| UI4-9-01 | P2 | Horizontal overflow / touch 44px targets **not measured** (ui:shots failed) | DESIGN §2 breakpoints |
| UI4-9-02 | P2 | “Your documents · Your report” quiet links — verify hrefs and client auth | `ClientHome` |

**Screenshots:** `gallery-client-home|client-home-done|client-home-older-study|chat-sheet-client-*`; `concept-client-home-*`.

**Recommended ticket:** UI-4-11 — Client home 390px ui-shots + overflow check from `ui-shots.mjs` `pageOverflows`.

---

## Responsive and accessibility (cross-cutting)

| Check | Status | Notes |
| --- | --- | --- |
| 320–1920 no page horizontal scroll | **PASS** (ui:shots exit 0) | `pageOverflows` in `ui-shots.mjs`; no console errors at 390/1280 |
| Typography / tokens from `tailwind.config.ts` | **PARTIAL** | No raw hex in components reviewed; width tokens mismatched (1040 vs 1240) |
| `role="tablist"` on hive tabs | **PASS** | `HiveSectionTabs.tsx` 43–57; keyboard order tested |
| `aria-current="page"` on left menu | **PASS** | `HiveSidebar.tsx` |
| “To review” not “Needs you” | **PASS** | `wording-to-review.test.ts` |
| No source, no claim in UI fixtures | **PASS** | Assistant / statement components use `SourceRefs` / chips in tests |
| `prefers-reduced-motion` | **NOT VERIFIED** | Front page mark animation — verify in CSS/globals when shots run |

---

## Prioritized defects

### P0

| ID | Summary |
| --- | --- |
| UI4-5-01 | DESIGN.md / concept selectors out of sync with **approved Timeline navigation** — blocks authoritative parity sign-off |

### P1

| ID | Summary |
| --- | --- |
| UI4-3-01 | Hive workspace max width 1040 vs DESIGN 1240 |
| UI4-5-02 | No gallery / ui-shots for Timeline |
| UI4-6-01 | Reports “Earlier versions” nested card vs single paper |
| UI4-7-01 | Audit trail meta copy wrong |
| UI4-7-02 | Audit section title / structure vs DESIGN |

### P2

Remaining IDs in sections above (gallery gaps, legacy `/study` link, duplicate timeline, firmless 760 vs 820, test flakes, screenshot pipeline).

---

## Implementation defects vs UX improvements

| Defects (must match DESIGN / approved nav) | UX improvements (product judgement) |
| --- | --- |
| Audit copy and extra sections | Whether Study versions belong on Audit vs Documents |
| Workspace 1240 vs 1040 | Timeline as top-level tab vs Home-only disclosure |
| Report nested CARD | Merging Activity into a future unified “Hive activity” page |
| Gallery gaps | New-client / welcome gallery for onboarding QA |
| `/study` redirect link label | Wording of Documents rebuild success CTA |

---

## Recommended Cursor tickets (small, testable)

| Ticket | Scope | Acceptance |
| --- | --- | --- |
| **UI-4-06** | DESIGN.md: Timeline tab, route, §6 selectors | Founder review; matches `hive-menu-tabs.ts` |
| **UI-4-07** | `GalleryTimeline` + `PAGES.timeline` + ui-shots | Shots at 390/1280; no horizontal overflow |
| **UI-4-03** | `WorkspaceShell` max width token | Home/Documents match DESIGN widths; snapshots updated |
| **UI-4-09** | Audit trail copy + section scope | Matches DESIGN §3 Audit; gallery synced |
| **UI-4-08** | Reports Earlier versions in-paper | No second bordered card; `ReportsPanel.test.tsx` green |
| **UI-4-05** | Documents study link target | No `/study` dead-end; test for href |
| **UI-4-01** | ui:shots CI/local doc + fix server hang | **Done 2026-11-22** — auto `next start`, concept nav fixes; `apps/web/.ui-shots/` |
| **UI-4-12** | Stabilize 6 flaky web tests | `npm run test -w @hiveforyou/web` green on CI |

---

## Gallery ↔ audit screen index

| Audit screen | Gallery key(s) | Production route |
| --- | --- | --- |
| Landing | `front`, `front-self`, `front-example-2` | `/` |
| Sign-in | `sign-in-*` | `/sign-in` |
| Your hives | `hives-firm`, `hives-mine`, `hives-find-none`, `hives-first-visit`, `hives-own` | `/hives` |
| Home + assistant | `home-staff*`, `omni-*`, `home-narrow-askbar` | `/hives/[id]` |
| Documents | `documents`, `documents-empty` | `/hives/[id]/documents` |
| Timeline | — | `/hives/[id]/timeline` |
| Reports | `report` | `/hives/[id]/reports` |
| Audit / notes | `audit`, `notes` | `/hives/[id]/audit`, `.../notes` |
| Evidence | `evidence-*` | `?source=` on hive routes |
| Client mobile | `client-home*`, `chat-sheet-client` | Client `/hives/[id]` |

---

## Stop condition

**UI-4-01 complete.** Screenshot baseline captured; parity audit updated with visual findings. **No commits or deployments.** Approve correction tickets one at a time — recommended next: **UI-4-06** (DESIGN Timeline), **UI-4-07** (gallery + concept timeline shots), **UI-4-03** (1240 workspace width), **UI-4-09** (audit copy), **UI-4-08** (report earlier-versions + concept report state).