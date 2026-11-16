# FL-6a — First upload: checklist, instant receipt, item check, two front doors

Written 2026-11-16. Replaces the FL-6a line in `HiveForYou-PILOT-READINESS-REVIEW.md`.
Builds the client upload moment agreed with AB, for **both** ways a person can arrive:

- **Invited by a firm**: a firm member starts a client hive with a matter type and invites the client.
- **On their own**: a person comes to the homepage, describes their situation, and starts their own hive.

Both arrive at the same checklist and the same upload experience. The code knows only "the hive's
checklist", "the people in the hive" and "whether the hive belongs to a firm", never a matter (D-053).

---

## 1. The experience (what must be true when FL-6a is done)

### 1.1 Arriving

| | Invited by a firm | On their own |
|---|---|---|
| Entry | Firm's invite link → email code | Homepage → "I need help with my own documents" → describe situation → email code |
| Checklist comes from | The matter type the firm chose when creating the client hive | The pack suggested from the description, confirmed by the person ("Looks like you're preparing X. Here's what's usually needed." **Use this** / **Choose another** / **No checklist, just add documents**) |
| First line | "Rivera Law needs 18 documents for your intake. Start with any one." | "Here's what's usually needed. Start with any one." |
| "Can't tell" result says | "Got it. Someone at Rivera Law will look at this." | "Got it. We couldn't be sure about this one. Take a look, or share your hive with a professional." |

Self-arrival rule: if no pack fits, the hive works as today (add whatever you have, no checklist).

### 1.2 Uploading one item

1. Tap an item → take photos or choose files. Several photos picked together become **one document**
   (one PDF, pages in the order picked). PDFs, JPEG, PNG and HEIC accepted.
2. As soon as storage confirms the file: thumbnail + **"Received ✓"**. Never wait for reading.
3. Reading starts automatically. The item shows "Reading…" and the client may leave.
4. When reading and the item check finish, the item shows **one** result in plain words:

| Result | Colour | Example | Decided by |
|---|---|---|---|
| Checked | Leaf | "6 pay stubs, June to November. Thank you." | Item check: fits, with page references |
| Needs a fix | Coral | "Page 3 is too blurry to read. Retake it?" + **Retake** | Deterministic: read status PARTIAL / UNREADABLE, encrypted PDF, empty file |
| Doesn't match | Honey | "This return is for 2023. Do you have 2024?" + **Add another** | Item check: wrong document or wrong period, with page references |
| Needs review | Blue | Firm hive: "Got it. Someone at Rivera Law will look at this." | Item check unsure, model error, or a claim without page references (D-011) |

5. The progress bar moves and the next unfinished item is suggested.
6. Firm side: the board shows the same item state with its source pages, refreshing while anything is
   Received/Reading. **No email per upload.** The firm digest (counts only) is FL-6b.

### 1.3 What staff can do with an item (firm hives only)

**Accept** (marks Checked, records who), **Not needed** (removes from the count), **Ask again**
(back to Waiting with a short note the client sees), **Add item** (a custom request not in the pack).
Clients cannot change items, only add documents to them.

---

## 2. What exists today (checked in the repo on 2026-11-16)

- Packs list their documents in a `Documents usually needed` table, parsed as `pack.documentsUsuallyNeeded`
  (`packages/contracts/src/pipeline/pack-contracts.ts`). This is the checklist source. No new pack format.
- A hive's pack is currently **discovered by the pipeline** from documents (`hive-discover`), not chosen
  up front. FL-6a adds an up-front choice, and the pipeline must then use the chosen pack.
- Per-document reading exists: `document-reads` with statuses QUEUED → READING → SAVING → VERIFYING →
  SUCCEEDED | PARTIAL | UNREADABLE | FAILED. FL-6a reuses it; it does not build a new reader.
- `hive.source_documents.owner_user_id` has a foreign key to the hive owner. A client is not the owner,
  so a client upload must store the **hive owner** there and the uploader in a new column.
- `hive.can_write_hive` is false for clients by design (FL-5). FL-6a adds a narrower
  `hive.can_upload_to_hive` (owner, firm staff, active client member), used only by upload and
  request-linking RPCs. Delete and change stay on `can_write_hive`.
- `hive.hives.kind` is `own` | `client`. A client hive has a firm.
- The homepage (`apps/web/src/app/page.tsx` + `LandingStart`) still offers the anonymous composer and
  "Add documents". The new design is the canvas "HiveForYou landing page".

---

## 3. Decisions taken in this plan (AB to confirm or change)

1. **Self-arrival is built now. During the pilot, the homepage sends individuals to a waiting list.**
   Real documents only after F-028 + D-017/D-018 (our rule). Opening it later is a one-line change to the
   homepage link, not a flag (D-008). Test users exercise the self-serve path in the meantime.
2. **Request state is stored and changed only by RPCs** (no triggers, D-055). Every change writes an event row.
3. **The item check is one model call per upload**, against one checklist item, using the reader's
   page text. It never sees other clients' data. Its sentence is shown in the app only, never in email.
4. **Status words:** Checked, Needs a fix, Doesn't match, Needs review, plus Waiting, Received, Reading.
   Honey means "Doesn't match" here (it was "Changed"). The board and legend use the same words.
5. **Live updates by polling** every 4 seconds while any item is Received or Reading, then stop. No realtime.

---

## 4. Order of work

| Step | What | Depends on |
|---|---|---|
| 0 | **QF-1a-3**: database CI green (includes possible permission defects in study and report views) | — |
| 1 | **FL-6a-1** Database: checklist, requests, upload gate, item results | 0 |
| 2 | **FL-6a-2** Client checklist and upload with instant receipt | 1 |
| 3 | **FL-6a-3** Item check after reading, results, retake, staff actions, live board | 2 |
| 4 | **FL-6a-4** Two front doors: new homepage, pilot requests, self-arrival start | 1 |

Steps 2–3 and 4 can run in parallel Cursor chats after step 1 is merged.
Each step ends with: CI green, the check file prints ALL CHECKS PASSED, migration applied by hand in
Supabase, a manual run-through with the test cast (Dana, Maria, Leo, Ruth, Priya), and a short report.

---

## 5. Cursor prompts

### FL-6a-1 — Database: checklist, requests, upload gate, item results

```
FL-6a-1. Read first: claude/HiveForYou-FL-6a-PLAN.md (sections 1–3), HiveForYou-DATA-MODEL.md,
HiveForYou-CURSOR-DEVELOPMENT-STANDARDS.md, supabase/migrations/20261115200000_firms_and_assignment.sql,
supabase/migrations/20261030150000_create_source_documents.sql, the document_reads migration, and
packages/contracts/src/pipeline/pack-contracts.ts. Database only in this step; no UI.

Rules: no triggers (D-055), no feature flags (D-008), no domain words in code or SQL (D-053; run the
domain-word lint), SECURITY DEFINER RPCs with SET search_path = hive, public, pg_temp, REVOKE ALL FROM
PUBLIC, anon and GRANT EXECUTE TO authenticated on every RPC the app calls; helper functions called
from policies or INVOKER functions also GRANT EXECUTE TO authenticated. Every new table: RLS on,
explicit grants. UNION ALL, never UNION, on json.

1. Migration supabase/migrations/20261117100000_hive_checklist_and_requests.sql:

   a. hive.hives: add pack_id text NULL, pack_version int NULL, both set or both null (CHECK).
      Setting them is the "chosen pack". The pipeline must use the chosen pack when present instead of
      discovering one: find where hive-discover's result is used and make the chosen pack win; report
      the exact file and line you changed.

   b. hive.can_upload_to_hive(p_hive_id uuid) returns boolean, SECURITY DEFINER, STABLE: true when the
      hive is not archived or deleting AND (hive.can_write_hive(p_hive_id) OR the caller is an active
      hive_members row on it). Do not change can_write_hive.

   c. hive.source_documents: add uploaded_by_user_id uuid NULL REFERENCES auth.users(id). owner_user_id
      stays the hive owner (FK to cases). Find the RPC(s) that register an upload and the "complete"
      path (apps/web/src/server/source-documents/hive-vault-upload-adapter.ts and what it calls); change
      them to authorise with can_upload_to_hive, write owner_user_id = the hive owner, and
      uploaded_by_user_id = auth.uid(). Storage RLS for upload paths must allow the same people (see
      the FL-5 storage RLS migration); reading files stays as it is for members.

   d. hive.requests:
        id uuid pk default gen_random_uuid(), hive_id uuid not null references hive.hives on delete cascade,
        source text not null check (source in ('pack','staff')),
        pack_row_key text null  -- normalised document title from the pack row; null for staff items
        title text not null, detail text null,   -- shown to the client exactly as written
        position int not null,
        state text not null check (state in ('WAITING','RECEIVED','READING','CHECKED','NEEDS_FIX',
              'DOESNT_MATCH','NEEDS_REVIEW','NOT_NEEDED')),
        state_note text null,   -- short client-visible sentence for the current state
        accepted_by uuid null, created_by uuid not null, created_at, updated_at timestamptz
        unique (hive_id, pack_row_key) where pack_row_key is not null
      hive.request_documents (request_id, source_document_id, added_by, added_at; pk both ids).
      hive.request_events (id, request_id, from_state, to_state, actor_user_id null, actor_kind
        check in ('person','system'), note, created_at) — append only; every state change writes one.
      hive.request_checks (id, request_id, source_document_ids uuid[] not null, verdict check in
        ('FITS','WRONG_DOCUMENT','WRONG_PERIOD','UNSURE'), sentence text not null, page_refs jsonb not
        null default '[]', model text not null, prompt_version text not null, created_at) — write once.
      RLS: members of the hive (hive.is_hive_member, which includes firm staff) may SELECT requests,
      request_documents and request_checks. request_events: SELECT for firm staff and the owner only.
      No INSERT/UPDATE/DELETE policies: all writes go through RPCs.

   e. RPCs (all return json, all write request_events on state change):
      - start_checklist(p_hive_id, p_pack_id text, p_pack_version int, p_items jsonb)
        caller must pass can_write_hive. Sets hives.pack_id/version and inserts one pack request per
        item (p_items: [{key,title,detail,position}] built by the server from the pack; validate shape,
        max 60 items). Idempotent per (hive, pack_row_key). Refuses if a different pack is already set.
      - list_requests(p_hive_id): members. Each request with its documents (id, file name, page_count,
        created_at, uploaded_by display name) and its latest check (verdict, sentence, page_refs).
        Ordered by position. Also returns counts per state.
      - add_request(p_hive_id, p_title, p_detail): firm staff or owner; source 'staff'.
      - attach_document_to_request(p_request_id, p_source_document_id): can_upload_to_hive on the
        request's hive; the document must be ACTIVE and in the same hive; sets state RECEIVED.
      - set_request_state(p_request_id, p_to_state, p_note): the system path. Allowed transitions only:
        RECEIVED→READING, READING→CHECKED|NEEDS_FIX|DOESNT_MATCH|NEEDS_REVIEW, and any of those →
        RECEIVED when a new document is attached. Callable by service_role only (REVOKE from
        authenticated). Report which server code will call it.
      - record_request_check(p_request_id, p_document_ids, p_verdict, p_sentence, p_page_refs, p_model,
        p_prompt_version): service_role only. Rejects FITS/WRONG_* with empty page_refs (D-011).
      - staff_resolve_request(p_request_id, p_action text check in ('ACCEPT','NOT_NEEDED','ASK_AGAIN'),
        p_note): firm staff or owner only (never a client). ACCEPT → CHECKED with accepted_by,
        NOT_NEEDED → NOT_NEEDED, ASK_AGAIN → WAITING with the note shown to the client.

2. Contracts in packages/contracts: RequestState, RequestItem, RequestCheck types with validators,
   mirrored constants with a comment pointing at the migration (same pattern as
   document-read-status-contracts.ts). A pure function packChecklistItems(pack) → items for
   start_checklist (title from the pack row's Document cell, key = normalised title, position = row
   order; rows whose "When" says later are excluded). Unit tests on all three current packs.

3. Tests:
   - supabase/tests/database/hive_requests_check.sql (the check-file pattern: one transaction, seed
     with pg_temp helpers from pg_fixture_helpers.sql, act as each role with request.jwt.claims +
     SET LOCAL ROLE authenticated, end with RAISE NOTICE 'ALL CHECKS PASSED' and ROLLBACK). Prove:
     owner starts a checklist; a different pack is refused; client member can upload and attach but
     cannot add_request, staff_resolve_request or set_request_state; a non-member sees nothing and
     cannot attach; firm staff (paralegal) can resolve; ASK_AGAIN note is visible to the client;
     request_events are invisible to the client; record_request_check with FITS and no page_refs is
     refused; a client upload stores owner_user_id = hive owner and uploaded_by_user_id = client.
   - Add every new RPC to rpc_smoke_check.sql (the coverage script will fail otherwise).
   - Contract unit tests.

4. Do not touch UI. Do not apply the migration. Report: migration summary, every existing function you
   changed and why, the pipeline change for the chosen pack (file:line), test results from CI, and
   anything you were unsure about. No commit until I've reviewed.
```

### FL-6a-2 — Client checklist and upload with instant receipt

```
FL-6a-2. Read claude/HiveForYou-FL-6a-PLAN.md section 1 and the FL-6a-1 migration and contracts.
Prototype reference: prototype/HiveForYou V4 Prototype.dc.html (client laptop view) and the canvas
"HiveForYou landing page" for visual language (white page, brand tokens, hexagon status icons, one
filled button per screen).

Build the checklist screen every member of a hive with a checklist sees (client, owner, staff), at the
hive's existing client view route (find it; do not create a parallel route).

1. Header: firm hive → "{Firm name} needs {n} documents for your intake. Start with any one." Own hive →
   "Here's what's usually needed. Start with any one." Progress bar in four status colours + Waiting
   (Line #E3E6EA) with an accessible label giving the counts. Counts exclude NOT_NEEDED.
2. One row per request: hexagon status icon (Leaf/Coral/Honey/Cell Blue; outline for Waiting; animated
   outline for Received/Reading, respecting prefers-reduced-motion), title, detail, state sentence,
   thumbnails of attached documents, and one action:
   Waiting → "Add"; Needs a fix → "Retake"; Doesn't match → "Add another"; others → none for clients.
3. Add / Retake / Add another opens the picker: <input type="file" multiple accept="image/*,
   application/pdf,.heic,.heif"> (with capture available on phones). Several images picked together
   become ONE PDF, pages in picked order, built in the browser with pdf-lib. HEIC/HEIF: convert to JPEG
   in the browser before building the PDF; choose the smallest maintained library that works in
   Safari and Chrome and say which and its size. A password-protected PDF is detected in the browser
   (pdf-lib load with ignoreEncryption false) and refused with "This PDF has a password. Please upload
   a copy without one." Size limit = the existing upload quota.
4. Upload through the existing upload + complete path, then attach_document_to_request. The row shows
   "Received ✓" with the thumbnail the moment complete + attach succeed — before any reading. Then start
   the read for that document through the existing document-reads route.
5. While any row is RECEIVED or READING, poll list_requests every 4 s; stop when none are.
6. After an upload, suggest the next WAITING item by position: "Next: {title}" with its Add button
   focused for keyboard users.
7. Errors: network or storage failure keeps the files in the picker state and shows "That didn't
   upload. Try again." with a retry; never a silent failure.
8. Tests: component tests for every row state and the header variants; unit tests for the image→PDF
   builder (order, page count, HEIC path mocked), and the encrypted-PDF refusal. A Playwright test if
   QF-1b's harness exists; otherwise list the manual steps you ran.

No reading/check logic in this step beyond starting the read. Report with screenshots of: empty
checklist, Received, Reading, a mixed checklist on a phone width (390px). No commit until reviewed.
```

### FL-6a-3 — Item check, results, retake, staff actions, live board

```
FL-6a-3. Read the plan section 1.2–1.3 and HiveForYou-PROMPTS-AND-CONTRACTS.md.

1. When a document read reaches a terminal status for a document attached to a request, the server
   (service role) moves the request through set_request_state:
   - UNREADABLE, FAILED, encrypted, zero pages → NEEDS_FIX with a sentence naming what to fix
     (deterministic text; PARTIAL names the unreadable page numbers: "Page 3 is too blurry to read.
     Retake it?"). No model call.
   - SUCCEEDED → READING stays until the item check below finishes.
   Find where read completion is handled today and call this from there; no trigger, no new queue.
2. Item check: one model call per completed upload. New versioned prompt in prompts/ following the
   prompts contract: input = the request's title and detail (from the pack row), the document's page
   texts with page numbers, today's date. Output JSON: {verdict FITS|WRONG_DOCUMENT|WRONG_PERIOD|
   UNSURE, sentence (≤ 140 chars, plain words, addressed to the person who uploaded, no advice, no
   amounts), page_refs [{document_id, page}]}. Use the model the reader already uses (config, not a
   literal). Validate strictly; on invalid output, timeout, or FITS/WRONG_* without page_refs →
   UNSURE. Record with record_request_check, then set state: FITS→CHECKED, WRONG_*→DOESNT_MATCH,
   UNSURE→NEEDS_REVIEW with the firm or own-hive sentence from the plan table.
   The code passes no matter-specific words; the pack row supplies them (D-053).
3. Several documents on one request: the check runs on all ACTIVE documents attached to it.
4. Firm board (HiveBoardThreePane): the checklist appears in the team pane with the same states,
   source page chips that open the page viewer, and staff actions Accept / Not needed / Ask again /
   Add item (staff_resolve_request, add_request). Clients never see these controls.
5. Eval: eval/corpora/request-check/ with at least 12 synthetic cases (fits, wrong year, wrong
   document, blurry, unsure) and a script that reports verdict accuracy. Synthetic data only.
6. Tests: unit tests for the state mapping and validator (including the D-011 downgrade), an
   integration test with the model mocked, check-file additions for the service-role-only RPCs.

Report: where the read-completion hook lives, prompt version, eval results, screenshots of each state
on the client checklist and on the board. No commit until reviewed.
```

### FL-6a-4 — Two front doors

```
FL-6a-4. Build the homepage from the canvas "HiveForYou landing page" (copy exactly as on the canvas;
brand tokens from the app; next/font/local fonts already in the app). Replace LandingStart on "/".

1. The box: work email → Request pilot access. On submit the box becomes, in place, one question at a
   time: "Your firm's name" (text), then "What do you handle?" as chips built from the packs' display
   names plus "Something else", plus a separate chip "I need help with my own documents".
2. Storage: migration hive.pilot_requests (id, email citext, kind check in ('firm','individual'),
   firm_name, practice text, created_at, ip_hash text) with RLS on and no client policies; RPC
   submit_pilot_request callable by anon through a Next route only, which rate-limits per ip_hash
   (5/hour) and validates. Email AB through the existing Resend setup: subject "Pilot request: {firm}",
   body with name, email, firm and practice only. Send the requester a short confirmation from
   AB's sending address (configure via env; do not hard-code any address). Neither email contains
   anything else.
3. Confirmation in place: firm → "Thanks. We'll email you within one business day to set up your firm."
   Individual → "We're starting with law firms. We'll email you when you can start on your own."
4. Self-arrival start (built, reachable by test users from /hives "Start your own hive"; not linked
   from the homepage during the pilot): describe the situation → existing discover suggests a pack →
   "Looks like … Here's what's usually needed." Use this / Choose another / No checklist → on Use this,
   start_checklist with packChecklistItems, then the FL-6a-2 checklist screen.
5. Remove the anonymous composer and guest draft path from "/" only; keep the components if used
   elsewhere, delete them if not, and say which.
6. Tests: route tests (validation, rate limit, email bodies contain no other fields), component tests
   for each in-place step, check file for pilot_requests (anon and authenticated cannot read).
Report with screenshots desktop and 390px. No commit until reviewed.
```
