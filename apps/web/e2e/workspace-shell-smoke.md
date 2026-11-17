# QF-1 workspace shell smoke harness (outline)

Playwright is not installed in this repo yet. Run these steps manually on **staging** after QF-1 test-only sign-in is available. Do not run against production.

## Prerequisites

- Staging Supabase project with migrations applied (firm membership, workspace routes).
- Vercel preview or local dev pointed at staging (`NEXT_PUBLIC_SUPABASE_URL`, anon key).
- Test-only sign-in helper (QF-1 Q3): three synthetic identities prepared in staging:
  - **Firm member** (owner or attorney on a firm with at least one client hive).
  - **Client member** (invited client on that hive).
  - **Individual** (own-kind hive, no firm).

## Firm member

1. Sign in as firm member; land on `/hives`.
2. Open a **client** hive from the list.
3. For each sidebar section, open the URL and verify breadcrumb + page title (`h1` or `HivePageHead` title):
   - `/hives/{id}/board` — Hive board
   - `/hives/{id}/documents` — Documents
   - `/hives/{id}/facts` — Facts
   - `/hives/{id}/missing` — Missing and conflicts
   - `/hives/{id}/timeline` — Timeline
   - `/hives/{id}/reports` — Reports
   - `/hives/{id}/activity` — What happened
   - `/hives/{id}/notes` — Team notes
4. On **Facts**, follow one source chip / page link; confirm the page viewer or API route loads (401/404 must not appear).
5. Open **Hand over** from the sidebar card; cancel without saving (dialog closes).

## Client member

1. Sign in as the invited client; open the shared hive.
2. Confirm sidebar **does not** show Team notes (or the link is absent).
3. Request `GET /hives/{id}/notes` (or navigate directly): expect **404** Not Found.
4. Visit board, documents, facts, missing, timeline, reports, activity — each should load without firm-only controls.

## Individual (own hive)

1. Sign in as individual owner; open an own-kind hive.
2. Visit every section path as in step 3 (notes may 404 for non-firm client hive; own hives use the FL-4 board, not three-pane).
3. Confirm workspace grey background and sidebar navigation on each page.

## Automation stub (future Playwright)

```typescript
// e2e/workspace-shell-smoke.spec.ts (not wired in CI until QF-1)
test.describe("workspace shell", () => {
  test("firm member visits all sections", async ({ page }) => {
    await testSignIn(page, "firm-member");
    // ...
  });
});
```

## Local / this machine

Cannot execute end-to-end steps here without staging credentials and Playwright. Use unit tests under `apps/web/src` for route wiring and components until QF-1 is complete.