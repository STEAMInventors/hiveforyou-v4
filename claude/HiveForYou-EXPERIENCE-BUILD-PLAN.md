# HiveForYou — Experience build plan (the flow, built ticket by ticket)

**Date:** 2026-11-15 | **Status:** approved by founder. Updated 2026-11-15: the Hive board is the intake view; an automated intake assistant (named by each professional, for example "Sarah Farrington") talks with the client; **closed pilot launch on Monday 2026-11-30** (sections 7 and 8). | **Reference prototype:** `prototype/HiveForYou V4 Prototype.dc.html` in the repo (commit `456e40e`; open it in a browser; accounts `dana@example.com` and `priya@example.com`; "Open the sign-in link" stands in for the email). | **Older design canvas:** https://claude.ai/artifact/1VCcoCD2Tvmjntz3xko9Uv

**How it is built:** Cursor, one prompt at a time. Each prompt stops for review and does not commit. The founder runs migration SQL by hand in Supabase before the code that needs it, deploys edge functions by pasting them into the Supabase dashboard when a prompt changes them, then commits and pushes from PowerShell; Vercel deploys `main`.

## 1. Founder decisions

| # | Decision |
|---|---|
| D1 | It is always a **hive**, never a "case", in every screen and email. |
| D2 | Home page (signed out) is option A: logo, "What are you working on?", one input, "Add documents" and "I work with clients", three explainer lines, "Sign in". |
| D3 | Sign-in is **email code only**. The email carries the 6-digit code only (mail scanners used up links). Same step for new and returning users. |
| D4 | Email goes through **Resend** (`mail.hiveforyou.com`); Resend is also Supabase's SMTP. |
| D5 | After sign-in a person lands on **home**. One question at first sign-in sets which home: an individual sees their hives (one input, search style); a professional gets a **workspace**: header search "Find a client", a left rail (New client, Needs you, Waiting on client, Ready, All clients, My own matters), tiles and a client list with intake progress (2026-11-15). |
| D6 | Inside a hive the tabs are **Hive board, Documents, Study, Reports**. The Hive board is the **intake view**: what needs you, what you are waiting on, what the hive still needs, the conversation with the client, and what happened. |
| D7 | The rest of the flow is built: new client, inviting a client, the client's side on a phone, sharing with a professional, take or decline. |
| D8 | **Intake assistant.** Each professional has an automated intake assistant that talks with their clients. The professional names it (default "HiveForYou"); code calls it the generic "assistant" (D-053). It **always says it is automated**: in its first message, next to its name every time, and under the message box. It never presents itself as a person. |
| D9 | **What the assistant does on its own:** greets, asks for one item at a time, confirms each upload, asks again when a page is unreadable, helps find a document, reminds on schedule. **What it never does:** answer anything about the matter (eligibility, what to sign, what to do), give advice, or summarise document content to the client. Those questions go to the professional unanswered and appear first under Needs you. **What needs the professional first:** new kinds of request, and closing the intake. |
| D10 | The professional's replies appear in the client's conversation **under the professional's own name**, visibly different from the assistant. |
| D11 | The assistant's free-text replies use **`claude-opus-5-5`**, called only from the server. Its replies are limited to the intents in D9; anything else is routed to the professional. Until FL-8 every assistant message is a fixed template and every client message goes to the professional. |
| D12 | Email first; text messages later. |
| D13 | A client member always sees their hive in full: documents, study and reports (2026-11-15). Only the owner changes anything. An invited professional sees only the welcome counts until they take the hive. |

## 2. Build order

| Step | Ticket | What a person can do when it ships | Migration | Edge function | State |
|---|---|---|---|---|---|
| 0 | FL-0 | (Founder) Resend and Supabase email set up | none | none | done |
| 1 | FL-1 | Sign in with an email code; answer the one starting question | yes | none | `35bc6fd`, `0c8a877` |
| 2 | FL-2 | New home page; signed-in header | none | none | `3aa2e28` |
| 3 | FL-3 | Home by starting view; professional creates a client's hive | yes | `v1-hives` | `9e6c4de` |
| 3b | FL-3b | Landing proportions, one-screen new client, white hive pages | none | none | `beaa933` |
| 4 | FL-4 | Hive board v1: the intake view on today's data | none | none | `c21b440` |
| 3c | FL-3c | Professional's workspace home; first name in the greeting | yes | none | `8b17efb` |
| 5 | FL-5 | Invite a client, or share with a professional; accept an invitation | yes | none | `d47494e`, hotfix `e0e395f` |
| 5b | FL-5b | A way back from a hive; people list names; one missing count; email never dropped silently; "Send again" | none | none | in Cursor |
| Q | QF-1 | Staging database and previews; database tests in CI; test-only sign-in; end-to-end smoke test | none | none | pilot |
| 6a | FL-6a | Starting checklist by matter type; requests; multi-page photos, HEIC and protected PDFs | yes | maybe | pilot |
| 6b | FL-6b | The client's conversation (fixed messages); questions and replies; email updates | yes | none | pilot |
| 10 | FL-10 | "Intake complete" and the PDF export | small | none | pilot |
| E | EV-1 | Bankruptcy test set and the accuracy run | none | none | pilot |
| 7 | FL-7 | Invited professional reads the summary and takes or declines | small | none | during pilot |
| 8 | FL-8 | The assistant: its name, Opus 5.5 replies within D9, the readability check on uploads | yes | new `v1-assistant` | during pilot, after D-017/D-018 |
| 9 | FL-9 | Automatic reminders on a schedule; the switch on the board | small | new scheduled function | during pilot |
| later | - | Text messages, export, plans and paywall (UX-5), IN-5 to IN-8 | | | |

**FL-5 onwards let one person see another person's hive, and FL-8 sends client messages to a model.** They are built and tested on synthetic data. No real client document or message goes in until the F-028 security checklist (written in FL-5) is signed off and the provider and retention decisions (D-017/D-018) are made. FL-8 adds the assistant's own lines to that checklist.

## 3. Rules for every screen

1. **Match the prototype.** Layout, wording and order come from the prototype. Where this plan and the prototype differ, this plan wins.
2. **One filled button per screen.** Everything else is a quiet button (light grey) or a link. A switch is not a button.
3. **White pages, brand tokens.** Cell Blue = needs you and actions; Coral = missing; Honey = changed; Leaf = checked.
4. **An input looks like what it does.** "Find a client" filters (magnifier). The in-hive question field only saves a question for the next study build (no magnifier). The client's message box says "Message <assistant first name>".
5. **Never promise what is not built.** No "coming soon" teasers.
6. **Generic words only (D-053).**
7. **Phone first for the client.** 44 px targets, one item at a time.
8. **Every claim opens its source (D-011).**
9. **The assistant is always marked automated (D8),** and nothing the assistant says goes beyond D9.
10. **Emails and reminders carry counts and a link only:** never document content, amounts, or names from inside the documents.

## 4. Cursor prompts

Paste the shared constraints with every prompt. Shipped tickets (FL-1 to FL-4, FL-3b, FL-3c) are in git history and the founder's chat.

```
Shared constraints for every FL prompt:
- Reference prototype: prototype/HiveForYou V4 Prototype.dc.html. Match its layout, wording and
  order for the screens this ticket names. Where this prompt differs, this prompt wins.
- It is always "hive", never "case", in screen text, emails, routes you add and test names.
- Domain-agnostic (D-053): code uses only generic nouns. The domain-word lint must pass.
- D-055 no new triggers; D-008 no feature flags; D-011 no source, no claim.
- Screens: brand tokens from tailwind.config.ts and globals only (no new hex values); white page;
  44px minimum targets; visible focus; a label for every input; one filled button per screen.
- Authorisation is enforced in RLS and in every server route and edge function, never only in the
  screen.
- Never weaken or skip a test to make it pass. If a test shows a real defect, stop and report.
- Migrations: new files only; start from the latest definition of any function you rewrite (grep
  all migrations); give me the file names in the order to run them. I run them by hand.
- If you change an edge function, say which one so I can deploy it.
- Full tests with NODE_OPTIONS=--max-old-space-size=8192, typecheck, clean build, lint.
  Stop and report with screenshots at 1280px and 390px. No commit.
```

### FL-5 — Shared hives and invitations (F-028)

```
Scope: membership and invitations in both directions, Resend email, invitation acceptance, the
"People in this hive" list on the Hive board, membership-based authorisation everywhere.
Prototype screens: the client invitation email and welcome, "Invite your client" and "Share with a
professional" dialogs, the invited professional's email and welcome (the summary itself is FL-7).

1. Migration:
   - hive.hive_members (hive_id, user_id, role text check in ('owner','professional','client'),
     state text check in ('active','left','removed'), invited_by, created_at, updated_at; primary
     key (hive_id, user_id)). Backfill one 'owner' row per existing hive from owner_user_id.
   - hive.hive_invitations (id, hive_id, email (lower-cased), role check in
     ('professional','client'), invited_by, token_hash (sha256 hex of a 32-byte random token),
     expires_at (7 days), accepted_at, accepted_by, revoked_at, created_at). Only the hash is
     stored. At most one open invitation per hive and email.
   - RPCs (security definer, search_path set): create_invitation(hive_id, email, role, token_hash)
     - caller must be the owner; the token is generated in the web server and only its hash is
     passed in; accept_invitation(token_hash) - caller's auth email must equal the invited email,
     not expired, not used, not revoked; adds or reactivates the member and marks the invitation
     used; revoke_invitation(id); remove_member(hive_id, user_id) - owner only; leave_hive(hive_id)
     - not the owner; list_hive_people(hive_id) - any active member. No triggers. Every RPC writes
     an audit_events row.
   - Rewrite every hive.* table's RLS and every RPC that today checks owner_user_id = auth.uid()
     to check active membership instead (helpers is_hive_member(hive_id) and, for owner-only
     actions such as delete, is_hive_owner(hive_id)). List every policy and function you change.
     Start each from its latest definition.
2. Edge functions v1-hives and v1-source-documents and every web server route under
   app/api/v1/hives authorise by membership the same way. Delete stays owner-only. Tell me which
   functions to deploy.
3. Email: server/email/ with a typed send interface, a Resend adapter (RESEND_API_KEY,
   EMAIL_FROM) and a console adapter used in tests. Plain text and simple HTML, the small logo,
   one link. Never document content, amounts or names of anything inside the documents.
   - To a client: subject "<professional name> needs <n> items from you" (or "<professional
     name> opened a hive for you" when nothing is requested yet); sender display "HiveForYou, for
     <professional name>"; body: who, that they can send documents from a phone, the link, "No
     password. You'll get a sign-in code at this address."
   - To a professional: subject "<owner name> shared a hive with you"; body: who, the hive name,
     that it is a read-only summary until they choose to take it on, the link.
4. Invite screens:
   - /hives/new-client gains "Client's email" (optional) and a second button: "Invite them to
     upload" becomes the one filled button and "Create hive and add documents" becomes quiet. Invite
     requires a valid email.
   - Hive board side panel (owner only): for a kind 'client' hive, "Invite <first name>" or
     "Invite your client"; for a kind 'own' hive, "Share with a professional". Both open a small
     dialog: Name, Email, "Send invitation" (filled), Cancel. "People in this hive" lists each
     person with "invited, not joined yet" / "joined", and the owner can revoke an invitation or
     remove a person.
5. Acceptance route /invite/[token]: hash the token server side and look it up.
   - Invalid, used, revoked or expired: one plain page saying so and asking them to ask the sender
     for a new link.
   - Not signed in: go to /sign-in with the invited email filled in and locked, next back here.
   - Signed in with a different email: say which email the invitation is for and offer Sign out.
   - Signed in with the invited email: show the welcome screen for the role, then accept on the
     filled button:
     - client (phone first): "Hello <first name>. <inviter> invited you." h1 "<inviter first name>
       needs <n> items from you" (or "opened a hive for you"), three lines with icons, filled
       "Start", line "Old, partial or out of order is fine. You can stop and come back." Start
       accepts and opens the hive's Documents tab (FL-6 replaces this with the conversation).
     - professional: "<owner> shared a hive with you", h1 "<n> documents, read and checked" or
       "The documents are not read yet", coloured counts, filled "Read the summary", line "Reading
       doesn't take it on. <owner first name> is told only what you decide." Accept here gives
       read-only access until FL-7's take or decline (say how you modelled the pending state).
   - New users invited by email get a profile without the /welcome question: client invitations
     set starting_view 'own', professional invitations 'clients'. Ask for their first name on the
     welcome screen (optional field, saved with set_display_name).
6. Home: hives where the person is a member but not owner appear too. A client sees "Your hive
   with <owner name>" as the kicker. The professional's rows show "invited" / "client joined".
7. docs/HiveForYou-SECURITY-CHECKLIST-F028.md: each control and the test that proves it.
8. Tests: RLS for every table (non-member refused, removed member refused at once, client cannot
   delete or invite, professional cannot invite); token reuse, expiry, revoke and wrong email
   refused; email content lint (no document content); acceptance paths; audit rows.
```

### FL-6 — Requests and the client's conversation (F-027)

_To be split into FL-6a (starting checklist, requests, multi-page photos, HEIC, protected PDFs) and FL-6b (conversation, questions and replies, email updates) before Tue 2026-11-17; the text below is the base for both._

```
Scope: member-visible document requests, the conversation between the client and the hive
(assistant messages are fixed templates in this ticket, no model call), questions routed to the
professional, the professional's reply, and the Hive board's waiting and conversation sections.
Prototype screens: "See what Ruth sees" (the conversation on a phone), Dana's Hive board for Ruth
Ortiz (Needs you with "Question from Ruth", Waiting on Ruth, "Sarah and Ruth", the conversation
drawer). Leave out what FL-8 and FL-9 add: the assistant's chosen name (use "HiveForYou" and the
label "automated"), free-text answers, the readability check, automatic reminders and the switch.

1. Migration:
   - hive.document_requests (id, hive_id, title, detail, gap_id nullable link to the missing item
     it came from, status check in ('requested','received','accepted','not_available',
     'cancelled'), reason, requested_by, requested_at, received_source_document_id, updated_at).
   - hive.hive_messages (id, hive_id, author_kind check in ('assistant','client','professional'),
     author_user_id nullable (null only for 'assistant'), body text (1-4000), request_id nullable,
     source_document_id nullable (an upload shown in the conversation), kind check in ('text',
     'upload','question'), created_at).
   - hive.client_questions (id, hive_id, message_id, status check in ('open','answered'),
     answered_by, answered_at).
   - RLS by membership for all three. A client may insert only author_kind 'client' rows for
     themself; a professional or owner only 'professional' rows for themself; nobody inserts
     'assistant' rows directly: they are written only inside the RPCs below, from fixed templates
     in one module (packages/contracts/src/hives/assistant-templates.ts, generic words, each
     template unit-tested). No triggers.
   - RPCs (audit rows for each): create_request (owner or professional; also writes "<pro first
     name> asked for one more item: <title>." when a conversation exists); mark_received (client,
     on upload against the request; writes the upload message and "Thank you, <first name>. <pro
     first name> will review it. Next: <title>." or the finished line); mark_not_available(reason
     required; writes the reason and "Thank you. I've passed that to <pro first name>."); accept,
     reopen ("asked again"), cancel (owner or professional); post_client_message(hive_id, body):
     stores it as a question, writes "That's a question for <pro first name>, so I won't answer it
     myself. I've passed it on, and the reply will appear here."; post_professional_reply(hive_id,
     body): stores it and marks open questions answered; start_conversation(hive_id): on the
     client's first visit, the greeting ("Hello <first name>. I'm HiveForYou, <pro name>'s intake
     assistant. I'm automated, not a person: I collect the documents <pro first name> needs and
     check that every page is readable. I can't answer questions about your matter, but I'll pass
     them to <pro first name>.") and "<pro first name> needs <n> items from you. We'll go one at a
     time. First: <title>." Idempotent.
2. Client side, phone first, /hives/[hiveId]/conversation, the client's landing after Start and on
   every later visit:
   - Header: avatar with initials, the assistant's name, "Automated intake assistant for <pro
     name>"; under it a progress bar of segments.
   - The messages, newest at the bottom, scroll anchored to the bottom: assistant left on Mist,
     client right on Cell Blue deep with white text, professional left with a Cell Blue deep
     outline and the professional's name. Each with its label and time. Uploads show the file
     name with a document icon.
   - The current request as a card in the conversation: "Item <i> of <n>", the title, the detail,
     filled "Take a photo" (file input with capture="environment", images and PDF, same upload
     path as Documents, against the request), quiet "I don't have this". After "I don't have
     this", the assistant asks why and the message box placeholder becomes "Tell <assistant first
     name> why"; the next message is the reason.
   - Message box "Message <assistant first name>", Enter sends, an icon send button (not filled),
     and the line "<assistant first name> is automated. Only you and <pro first name> see this
     conversation." under it.
3. Professional side, Hive board:
   - Needs you, first: each open client question ("Question from <client first name>", the
     question in quotes, "<assistant first name> didn't answer it: questions about the matter are
     yours. Your reply appears in <client first name>'s conversation.", action "Reply"); then
     replies to review ("Sent by <name>" with Accept / Ask again; "Not available" with the reason).
   - "Waiting on <client first name>": each open request with when it was asked.
   - "What this hive needs": each missing item gets "Ask <client first name>" when the hive has a
     client, otherwise "Add it" (FL-4).
   - "<assistant first name> and <client first name>": the last three messages and "Open the
     conversation", which opens a side drawer with every message and a reply box ("Reply to <client
     first name>", filled "Send reply", note "<client first name> sees this from you, not from
     <assistant first name>."). Validation: a reply is required.
   - Side panel: "See what <client first name> sees" (owner only) opens the conversation read-only.
   - "What happened" includes requests, uploads, replies, questions and answers.
4. Home: sentences and counts include requests and questions ("1 reply from <name> to review.",
   "Waiting on <name> for 2 items.", "1 question from <name>."), and the rail gains "Waiting on
   client".
5. Email (server/email, counts and a link only): a new request, and a professional's reply, to the
   client; a client's question or reply, to the professional. At most one email per person per
   hive per hour; later ones fold into it.
6. Tests: RLS for each table and role, including that nobody can insert an assistant message;
   status transitions allowed and refused by role; every template; the greeting is idempotent;
   question routing and answering; the conversation order; one filled button on the phone and on
   the board; home sentences; email content lint.
```

### FL-7 — Invited professional: summary, take or decline

```
Scope: the read-only summary for an invited professional and the take or decline decision.
Prototype screens: "Invited professional: take or decline".

1. /hives/[hiveId]/summary, available to an invited professional who has not decided, and to the
   owner as a preview:
   - "<owner> shared this with you · as of <date>", h1 the hive name, one line of coloured counts
     and "<n> documents, all pages read".
   - From the accepted study only (no model call): each open finding as a result (title, one
     sentence, source chips) and "These records don't include" with the missing items.
   - Side panel: "Will you take this hive?", "Reading does not take it. <owner first name> is told
     only when you choose.", filled "Take this hive", quiet "Decline".
2. Take: the professional becomes a full member with the professional role and the hive appears in
   their client list. Decline: the membership ends. Either way the owner gets one short email and
   the owner's people list shows "took this hive" or "declined", and "Share with someone else"
   reappears after a decline.
3. Until they take it, the professional sees only the summary page (no Documents, Study, Reports
   or source pages beyond the cited pages the chips open). Enforce this in RLS and routes.
4. Tests: access before and after taking; decline removes access at once; owner preview; emails.
```

### FL-8 — The intake assistant: name, Opus 5.5 replies, readability check

```
Scope: the professional names their assistant; client messages get a reply from claude-opus-5-5
limited to D9; uploads get a readability check from the existing document read; the board shows the
assistant by name. Prototype screens: the board's "Intake assistant" block with Rename, "What
<assistant first name> does here", "What happened" with the assistant's first name, and the
client's conversation (help answer, matter question passed on, blurry page).

1. Migration: hive.user_profiles gets assistant_name text (1-40 chars, nullable; null means
   "HiveForYou"). RPC set_assistant_name(p_name). Every template and screen that names the assistant
   reads it from the hive owner's profile. Board side panel (owner, client hives): "Intake
   assistant", "<name> · automated", Rename (inline field "Assistant's name", Save, Cancel,
   "Use 1 to 40 characters."), note "The name your clients see. It always says it is automated."
2. Edge function v1-assistant (server only; the web never calls a model directly):
   - Input: hive_id and the new client message id. It authorises the caller as the hive's client.
   - It calls claude-opus-5-5 through the app's existing model client (add the model id to the
     model registry; key from Supabase secrets; timeout 20 s). System prompt in one versioned file
     (prompts/assistant/v1.md): the assistant is automated and says so if asked; it may only
     (a) explain where a requested document is usually found, (b) acknowledge "later" and say when
     it will check back, (c) acknowledge thanks. It must not answer anything about the matter, give
     advice, predict outcomes, or describe document contents. Input to the model: the assistant
     name, the professional's name, the open request titles, and the last 10 messages' text. No
     document content, no uploads.
   - Structured output only: { intent: "where_to_find" | "later" | "thanks" | "matter_question" |
     "other", reply: string <= 600 chars }. Validate with zod. If invalid, timed out, intent is
     "matter_question" or "other", or the reply fails the guard (a deterministic check that refuses
     replies containing advice words, amounts, dates or anything quoted from a document - write the
     list in the contracts package and unit-test it), store the FL-6 routing line and the question
     instead. Never show raw model output that failed validation.
   - Store the reply as an assistant message with model id, prompt version and latency in a
     separate hive.assistant_runs row (no message text duplicated there). Rate limit: 20 client
     messages per hive per hour.
   - Tell me to deploy v1-assistant and the secret to set.
3. Readability check: when the existing document read finishes for an upload attached to a
   request, use its per-page results (no new model call). Any page unreadable or blank: the
   request goes back to 'requested' with a problem note, and the assistant writes "I looked at it:
   page <p> of <n> is hard to read. Could you take it again in good light, with the whole page in
   view?". The card shows the problem in Coral. All pages readable: the FL-6 confirmation line
   says "every page is readable".
4. The board names the assistant by first name in "What happened", "Waiting" notes and "<name>
   and <client>"; "What <first name> does here" lists D9 in one paragraph.
5. F-028 checklist: add the assistant's controls (no document content to the model, structured
   output, guard, routing default, rate limit, audit) and their tests.
6. Tests: name validation and display everywhere; each intent path; a matter question is never
   answered (property test over a fixed set of questions with a mocked model that tries to
   answer); invalid output, timeout and guard failure all route to the professional; the model
   input never contains document text; readability results drive the retake; rate limit.
```

### FL-9 — Automatic reminders

```
Scope: scheduled reminders to clients with open requests, and the switch on the board.
Prototype screens: the board's "Automatic reminders" switch and "Remind now".

1. Migration: hive.hives gets reminders_on boolean not null default true; RPC set_reminders(hive_id,
   on) (owner or professional). document_requests gets last_reminded_at.
2. Scheduled edge function (daily): for each hive with reminders on and open requests not
   reminded in the last 3 days, one email to the client (counts and a link only) and one assistant
   message ("A reminder: <n> items are still open. Reply here if you're stuck."). Never more than
   one reminder per hive per 3 days. "Remind now" on each waiting row sends one immediately.
3. Board: "Waiting on <client>" note "<assistant first name> reminds <client> every 3 days until
   these arrive." or "Automatic reminders are off."; side panel switch "Automatic reminders" with
   "On, every 3 days" / "Off" and "Counts and a link only. Reminders never include what is in the
   documents."
4. Tests: schedule edges (2 days, 3 days, switched off, nothing open), one email per run, content
   lint, Remind now.
```

## 5. Deploy routine for each ticket

From QF-1 on, every ticket goes through staging first:

1. Cursor works on a branch named after the ticket and stops without committing. Founder commits and pushes the branch; Vercel builds a preview that uses the **staging** Supabase project.
2. Run the ticket's migrations on **staging**, in Cursor's order, then `supabase/tests/database/hive_membership_check.sql` (and any new check file). GitHub Actions must be green: tests, typecheck, lint, build, database tests, end-to-end smoke.
3. Claude reviews the branch (migrations line by line). Fix, re-run on staging.
4. Run the same migrations on **production**, then the check files there. Deploy changed edge functions to production.
5. Merge the branch into `main` and push; Vercel deploys production. Click through the ticket's screens against the prototype at 390px and 1280px.
6. Never edit a migration that has run on production; add a new one.

## 6. Still open

| # | Decision | Suggestion | Blocks |
|---|---|---|---|
| 1 | Supabase Site URL still points at the V2 site | Set it to the V4 address; add V4 and localhost redirect URLs | invitations (FL-5) |
| 3 | Do client uploads count against the professional's allowance | Yes, the owner's | FL-6 |
| 4 | Several invited professionals in one hive | Each has a separate summary until one takes it | FL-7 |
| 5 | Model provider and retention for client messages (D-017/D-018) | Decide before any real client message reaches FL-8 | FL-8 with real data |
| 6 | Free and paid limits (grid from 2026-11-13); is the assistant paid | Assistant on paid professional plans | UX-5 |
| 7 | Text messages to clients | After email works end to end | later |

## 7. Launch readiness: closed pilot from Monday 2026-11-30

**What launches:** a closed pilot with 5 to 10 professionals in one field, **bankruptcy intake** (packs exist; no health data, so no HIPAA scope). The loop it must prove: create a client hive from a starting checklist, invite the client, the client sends documents from a phone, HiveForYou reads them, the professional sees what is missing and what disagrees, closes the intake and exports one PDF. Pilots are free on written pilot terms.

**Pilot success measures:** time from invitation to complete intake; share of clients who finish on a phone without help; share of missing items and conflicts the professional agrees with; time from sign-up to the first useful Hive board (target under 10 minutes); whether they would pay the grid price.

Owner: **F** founder, **C** Cursor ticket, **R** Claude review or draft, **L** lawyer. Status as of 2026-11-15.

### 7.1 Features

| # | Item | Why | Ticket | Owner | Status |
|---|---|---|---|---|---|
| F1 | Starting checklist by matter type, chosen in New client, editable, sent with the invitation | A new hive has nothing to ask for until documents arrive | FL-6a | C | to do |
| F2 | Multi-page photos into one document; HEIC; password-protected PDFs (client enters the password, it is not stored) | A statement is 3 to 8 pages; iPhones send HEIC; banks send protected PDFs | FL-6a | C | to do |
| F3 | Requests, the client's conversation (fixed messages), questions and replies, email updates | The two-way loop | FL-6a, FL-6b | C | to do |
| F4 | "Intake complete" and one PDF export: checklist with status, conflicts, report with sources | Goes into the firm's case file; otherwise HiveForYou is a dead end | FL-10 | C | to do |
| F5 | A way back from a hive; people names; one missing count | Basic navigation and trust | FL-5b | C | in Cursor |
| F6 | Spanish on the client side | Many bankruptcy clients need it; confirm with pilot firms first | later ticket | C | ask pilots |
| F7 | A second seat per firm (paralegal does intake, attorney reviews) | How firms work | later ticket | C | ask pilots |
| F8 | Take or decline (FL-7); Sarah's Opus replies (FL-8); reminders (FL-9) | Differentiators, not needed for the loop | FL-7/8/9 | C | during pilot |
| F9 | Payments (UX-5), text messages, individual-first flow, more fields, practice-software integrations | Not needed to learn from the pilot | - | - | after pilot |

### 7.2 Quality

| # | Item | Target or proof | Ticket | Owner | Status |
|---|---|---|---|---|---|
| Q1 | Staging Supabase project; Vercel previews use it; every migration runs there first | No migration reaches production untested | QF-1 | F, C | to do |
| Q2 | Database tests in GitHub Actions against a local Supabase (pgTAP and the check files) on every push | Access rules proven by machine | QF-1 | C | to do |
| Q3 | Test-only sign-in for previews and tests (Supabase admin API; absent in production, refused unless an env flag and the staging project are both present) | Signed-in pages testable | QF-1 | C | to do |
| Q4 | End-to-end tests of the loop on every preview: invite, accept, upload, review, complete, export | Catches what reviews miss | QF-1, then each ticket | C | to do |
| Q5 | Bankruptcy test set: 20 realistic synthetic files with known answers; accuracy run on every prompt or model change; release blocked on a drop | Sources open the right page 98%+; missing items found 90%+; flagged conflicts real 80%+ | EV-1 | F, C | to do |
| Q6 | Every ticket: branch, staging, CI green, review, merge. No direct pushes to `main` | Section 5 | all | F | from QF-1 |
| Q7 | Design check per screen at 390px and 1280px against the prototype: one filled button, a way back, the same number everywhere, names not role words | Consistency | each ticket | R | ongoing |

### 7.3 Before any real client document

| # | Item | Owner | Status |
|---|---|---|---|
| B1 | Vercel Pro (Hobby is non-commercial use only); Supabase paid plan with backups, point-in-time restore if possible, one restore drill | F | to do |
| B2 | F-028 security checklist up to date; check file passing on production; one outside review of the access rules | F, R, outside reviewer | check file not yet confirmed |
| B3 | D-017/D-018: model provider and its retention terms; file retention; automatic deletion after a hive closes | F | open |
| B4 | Terms of service, privacy policy, data processing agreement for professionals, list of outside services (Supabase, Vercel, Resend, model provider); "not legal advice" kept visible | R drafts, L reviews, F signs | to do |
| B5 | Delete and export: owner deletes a hive and downloads their data; a client can leave | C | delete exists; export in FL-10 |
| B6 | Supabase Site URL set to the V4 address; redirect URLs for V4 and localhost | F | to do |
| B7 | Vercel env: `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_SITE_URL` in Production and Preview | F | to confirm |

### 7.4 Operations

| # | Item | Owner | Status |
|---|---|---|---|
| O1 | Error tracking (for example Sentry) on web and edge functions; uptime check; alerts for failed emails and failed document reads | C, F | to do |
| O2 | Email sending fails loudly; "Send again" on an invitation | C | in FL-5b |
| O3 | Support routine: one address for pilots; staff look at a hive only with the owner's permission | F | to do |
| O4 | Sign-in edge cases: changed email; a forwarded invitation (refused, with a plain message) | C | partly done in FL-5 |

### 7.5 Product checks with people

| # | Item | Owner | Status |
|---|---|---|---|
| P1 | Recruit 5 to 10 bankruptcy professionals; send pilot terms | F | start now |
| P2 | Watch 3 professionals and 3 clients (on their own phones) use the staging build with synthetic files; fix what blocks them | F, R | week of 2026-11-23 |

## 8. Order of work to the pilot

Thanksgiving is Thursday 2026-11-26. No production changes from Wednesday 2026-11-25 evening to Sunday 2026-11-29. One Cursor ticket a day; the founder's items run alongside.

| Day | Cursor (C) | Founder (F) and review (R) |
|---|---|---|
| Sun 11-15 | FL-5b and the email fixes | Run the check file on production (B2); Site URL (B6); Vercel env (B7); start recruiting pilots (P1) |
| Mon 11-16 | **QF-1** quality foundations (Q1 to Q4) | Create the staging Supabase project; install the Supabase CLI; upgrade Vercel and Supabase plans (B1); R reviews QF-1 |
| Tue 11-17 | **FL-6a** starting checklist, requests, multi-page photos, HEIC, protected PDFs | Pick the 20 test files' content with R (Q5); R reviews FL-6a on staging |
| Wed 11-18 | **FL-6b** conversation, questions and replies, email updates | R drafts terms, privacy policy, DPA and the outside-services list (B4); send to lawyer |
| Thu 11-19 | **FL-10** intake complete and PDF export | D-017/D-018 decisions (B3); R reviews FL-10 |
| Fri 11-20 | **EV-1** bankruptcy test set and accuracy run | Error tracking and uptime (O1); support address (O3) |
| Sat-Sun 11-21/22 | Fixes from the accuracy run | Buffer |
| Mon 11-23 | Fixes; end-to-end tests of the whole loop green | Watch 3 professionals and 3 clients on staging (P2); request the outside security review (B2) |
| Tue 11-24 | Fixes from P2; design check pass (Q7) | Restore drill (B1); security review findings fixed |
| Wed 11-25 | **Freeze** by noon: production migrations, merge, final checks | Pilot onboarding: a one-page guide and a 3-minute video; schedule pilot kickoffs |
| Thu-Sun 11-26/29 | Nothing to production | Thanksgiving |
| **Mon 11-30** | **Pilot opens** to the first 2 or 3 firms, the rest that week | Daily check of errors, emails and pilot feedback |
| During pilot | FL-7, FL-9, then FL-8 once D-017/D-018 are decided; F6 and F7 if pilots ask | Weekly call with each pilot firm |

**If the date slips:** the pilot can open on 11-30 with synthetic files only (a guided demo with each firm) and switch to real client documents once B1 to B5 are done. Do not put real client documents in before B1 to B5, whatever the date.
