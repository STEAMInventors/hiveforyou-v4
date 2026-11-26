# HiveForYou V4 — NEXT (one active engineering ticket)

> **Active ticket (2026-11-26): Stage 5E.3 — Fix production activation and Study UI.** Local only. No deploy, no `supabase db push`, no live model, and no change to the investigation algorithms. Pinned Rebuild still requires one explicit `iep-us-federal` `0.5.0` row whose digest is `2108f8297a240b5daee6d175c2ba6e3699b952613e4b329ff1712d0a25a7a066`. v0.4.0 remains on disk and its compiled digest is unchanged: `809565eb3826b773aec305010d8e8ac7ce7bf022875ab10e977c17608bdddf0f`.

## Active ticket — Stage 5E.3: Fix production activation and Study UI

**Objective:** A production Rebuild accepted revision 10 on legacy IEP v7 (`hive-canonicalize/1`, pack `iep-initial` 7) and the success line read `8 sources · 0 verified claims`. The new investigation engine and pack 0.5.0 were already in the application, but the database check allowed only 0.4.0, so no Hive could store the required edition. Unpinned Hives stay on `hive-canonicalize/1`.

**Status (2026-11-26): local only. Migrations not applied. No Hive pinned. No deploy.**

**Verification:** `packages/contracts` acceptance-summary tests passed (8). Web `DocumentsPanel` (17), `StudyView` (28), and `investigation-rebuild` tests passed. `tsc --noEmit` passed for contracts and web. `supabase/tests/database/domain_pack_selection_050.test.sql` is written and was not executed: the Supabase CLI is not installed in this environment, and the migrations were not applied. A signed-in browser rebuild was not run.

**CI follow-up (2026-11-26, local, not deployed):** Commit `6897c55` failed the RPC coverage script and the domain-word lint. `rpc_smoke_check.sql` now lists `get_domain_pack_selection` and `activate_professional_membership`. `node scripts/assert-app-rpc-coverage.mjs` printed `RPC coverage OK: 104 names`. The acceptance-summary test uses pack ids `pack-alpha` and `pack-beta`, so the domain-word lint no longer sees `iep`. That lint and the acceptance-summary tests passed (12). `npm run typecheck` and `npm run build` passed. The smoke SQL was not executed.

1. Acceptance detail uses `verifiedFacts` when that count was stored. A canonical `documentFindings: 0` is not shown as zero claims. A count that was not stored is omitted.
2. `supabase/migrations/20261126130000_domain_pack_selection_050.sql` widens the check to `0.4.0` and `0.5.0` and does not update any row. `public.set_domain_pack_selection` inserts `0.5.0` for one Hive and refuses to replace a different existing selection. `authenticated` cannot execute it.
3. `supabase/migrations/20261126140000_study_revision_acceptance_counts.sql` replaces the summary function only. A missing count is null. Reading it does not rewrite revisions.
4. Rebuild success and Findings show the investigation engine, Domain Pack id and version, and `Revision N accepted`. Hive Board stays the communication workspace. The success link opens `/hives/{id}/findings`.
5. New accepts record the engine and pack on `verification.counts`. They no longer store `documentFindings: 0`.

**Safe production activation (not performed here):**

1. Apply `20261126130000` and `20261126140000` only. Do not run `UPDATE hive.domain_pack_selections`. Do not apply `20261125140000` again.
2. Deploy the web app that contains this ticket. Leave `PLANNER_EXTERNAL_MAPPING_HIVE_IDS` empty until a separate approval names one synthetic Hive.
3. Confirm the Hive id is the synthetic one. Confirm it has no `hive.domain_pack_selections` row, or that the row is already this exact edition and digest.
4. Recompute the digest in the deployed app (`loadPinnedDomainPack().compiledDigest`). The 5E.2 value is `2108f8297a240b5daee6d175c2ba6e3699b952613e4b329ff1712d0a25a7a066`. A different digest means the shipped source changed; do not reuse the old value.
5. Insert that one row, either with the service-role RPC or one explicit insert. Do not omit the Hive id.

```sql
SELECT public.set_domain_pack_selection(
  '<synthetic-hive-uuid>'::uuid,
  'iep-us-federal',
  '0.5.0',
  '<compiled-digest>'
);
```

A dashboard session that is not `service_role` cannot call the RPC. The equivalent single-row insert, and only when that Hive has no row, is:

```sql
INSERT INTO hive.domain_pack_selections (hive_id, pack_id, version, compiled_digest)
VALUES ('<synthetic-hive-uuid>'::uuid, 'iep-us-federal', '0.5.0', '<compiled-digest>');
```

6. Rebuild Study on that Hive only. The new revision should name `hive.domain-investigation/1` and `iep-us-federal 0.5.0`. The previous revision and its reports stay. Any other Hive stays on its current engine. A 0.4.0 row or a mismatched digest fails closed and does not call the model.

## Previous ticket — Stage 5E.2: Comprehensive Agentic Investigation

**Objective:** One domain-agnostic investigation produces a complete, evidence-checked Canonical Study from the compiled Domain Pack. Mapping remains only the deterministic normalization of written values. There is no second model investigation.

**Decision:** D-065. Reuses the Study Agent transport, compiled Domain Pack, investigation plan, binder, ledger, and rule engine. No new alias, configuration variable, or migration.

**Status (2026-11-26): local integrated study path passed synthetic regression. Not deployed.** The shared contracts barrel names `hive.domain-investigation/1` from an environment-neutral leaf, so Next.js middleware does not load the investigation engine. Pinned Rebuild posts that same prompt id with the twelve investigation tools and passes any compiled relationship structures stored with the pack pin. The planner returns those calls unexecuted. Trusted code checks quotes and written values, decides executable criteria from verified evidence, admits a relationship only when a compiled source structure matches, publishes a supported calculation with its inputs, unit, and provenance, compares a later measurement with the baseline and planned target, and assembles `hive.canonical-study/1`. A failed run does not accept a revision or replace Customer or Pro reports. A stored selection whose version or digest is not 0.5.0 fails closed. Unpinned Hives stay on `hive-canonicalize/1`. Hive Board is unchanged.

**Execution path**

1. Rebuild loads the per-Hive pack pin, saved extractions, and authorized pages.
2. `selectInvestigationWindows` sends one bounded catalog slice, the document manifest, and written fact values. Page text is not in that payload.
3. The model may call `search_case`, `read_pages`, `propose_field`, `propose_relationship`, `propose_document_role`, `propose_measurement`, `propose_assessment`, `propose_determination`, `propose_conflict`, `propose_gap`, `propose_answer`, and `finish_investigation`.
4. The binder accepts a field only when the proposed value is the written value and the quote is on an authorized page. It does not admit a relationship. A compiled source structure may admit one later, and only when the quoted text and the verified endpoints match. A model proposal alone stays unresolved, with its reason kept.
5. The ledger and rule engine decide applicability, evidence coverage, and outcomes the pack marks executable. `REVIEW_REQUIRED` checks and incomplete evidence stay `NOT_ASSESSED`. A field-presence check with complete coverage is `SHOWN` or `NOT_SHOWN`. A supported calculation (`DAYS_BETWEEN`, `DIFFERENCE`, `RATE_PER_WEEK`, `SUM_BY`, `ADD_INTERVAL`, `REFERENCE_GAP`) is published only when its bindings match the operator contract and its units, period, and provenance validate. Anything else stays unpublished, with the reason kept.
6. `projectStudy` writes human-readable findings, document roles, chronology, conflicts, gaps, checklist rows, calculations, progress comparisons, and persona coverage. Professional determinations stay open and outside the spine. A progress comparison is published only when a later measurement exists, and it keeps baseline, planned target, and observed value distinct.

**Known limits**

- The local selectable edition is iep-us-federal 0.5.0. Three checks are field presence on one subject: `check:G2`, `check:S1`, and `check:A3`. The other 64 of 67 stay `REVIEW_REQUIRED`. Timing limits, adequacy, and professional judgments are not legal verdicts. v0.4.0 is unchanged and still compiles to `809565eb3826b773aec305010d8e8ac7ce7bf022875ab10e977c17608bdddf0f`. The 0.5.0 digest is `2108f8297a240b5daee6d175c2ba6e3699b952613e4b329ff1712d0a25a7a066`.
- Executable calculations on 0.5.0 are `calculation:C4` (rate per week), `calculation:C5` (sum by setting), `calculation:C7a` (meeting date plus one year), and `calculation:C7b` (determination date plus three years), plus the existing day-count calculations whose bindings already matched `DAYS_BETWEEN`. `C6`, `C8`, `C9`, `C11`, and `C12` stay declarations because their inputs are not one same-entity operator contract. A rate does not compare separate unit text on number fields. A due date is an estimate, not a deadline verdict, while jurisdiction is `UNVERIFIED`.
- Relationship structures are case companions. The shipped pack has none, so a pinned Hive keeps proposed links unresolved until a structure whose slots appear in the quoted page is supplied. Endpoint co-occurrence is not acceptance.
- On the synthetic L001 documents, the 0.5.0 study publishes the reevaluation date `2027-11-01` from the written determination date `2024-11-01`, records that date on the timeline, marks the incomplete goal check `NOT_SHOWN`, and leaves the timing checks `NOT_ASSESSED`. It does not publish a progress conclusion, a relationship, or a rate, because the corpus has no later measurement, no compiled relationship structure, and no baseline date or goal date in the mapped facts. The four golden negative controls stay out of the findings.
- No external model was called. The eight-PDF check drives the ledger with scripted tool calls over text extracted from the synthetic corpus in Node. A controlled live-model run still needs a separate approval, an allowlisted synthetic Hive, and one stored 0.5.0 selection.

**Not done:** sign in, create a Hive, set the allowlist, pin a pack, click Rebuild Study, deploy the planner or web app, or apply SQL.

## Previous ticket — Stage 5D.4: Approved Frontier-Model Processing

**Objective:** Use the existing LiteLLM study alias for Domain Pack mapping on one explicitly designated synthetic Hive, and keep real regulated records off that route until data-use approvals are documented.

**Decision:** D-064, Option A. No new inference stack or model alias.

**Status (2026-11-25, later): deployed, then stopped at the sign-in page.** Production web `https://hiveforyou-v4.vercel.app` is Ready on `https://hiveforyou-v4-g684igx5g-abhattacharyya-2114s-projects.vercel.app` (app fix `d37cbd0`, alias includes the later report-only workflow commits through `c6c8cb9`). The earlier production build of `5ca3b84` failed on `node:crypto` and did not replace the alias. Oracle planner `/opt/hiveforyou-v4` is `5ca3b84`, healthy, study and canonicalize on `heavy_lifter`, `field_mapping_alias` null, allowlist count 0. Hosted probe: `hive.domain_pack_selections` and `public.get_domain_pack_selection(uuid)` match the selection migration; `public.append_relationship_verification` and `hive.relationship_verification_append_grants` are already present, so the relationship-append migration was not applied again. No Hive was created. Rebuild Study was not clicked. No new Study is displayed.

**Provider policy**

| Route | When a mapping turn may be posted |
|---|---|
| Private `ollama/`, `ollama_chat/`, `hosted_vllm/` | Loopback or private address, and the model server lists the model |
| `anthropic/claude-opus-4-6` | `api_base` absent or `https://api.anthropic.com`, and `hive_id` is in `PLANNER_EXTERNAL_MAPPING_HIVE_IDS` |
| Any other provider or Anthropic model | Not posted (`provider_not_authorized`) |

The Hive id is the id on the processing run. The Rebuild Study button already sends the Hive from the page URL; the worker copies `run.hiveId` onto the mapping turn. A `synthetic` field or `content_class` is rejected or ignored. Legacy canonicalize and Study turns are unchanged and are not treated as approval to map real records.

**Anthropic account, checked 2026-11-25**

| Item | Result |
|---|---|
| Public commercial terms | Anthropic's published Commercial Terms say it may not train models on Customer Content from the Services. This is a public term, not this account's signed contract. |
| Public retention | Messages API tool use is listed as Legacy ZDR eligible and HIPAA eligible. Covered Models that require 30-day retention are Fable and Mythos 5.x, not `claude-opus-4-6`. `claude-opus-4-6` is a published legacy model id. ZDR and HIPAA readiness are off until an organization enables them. |
| This organization's ZDR | **Unknown.** No console, admin API, or contract was available here. |
| This organization's BAA / HIPAA readiness | **Unknown.** Not inferred from the legacy Study path, which already calls the same alias. |
| This workspace's 30-day retention setting | **Unknown.** |
| This key's permission to call `claude-opus-4-6` | **Unknown.** The running gateway was previously recorded as `heavy_lifter` → `anthropic/claude-opus-4-6` with no `api_base`. That configuration was not re-read in this gate. |
| Real IEP, Medicaid, financial, legal, health records | **Blocked.** They are not an allowlisted Hive. |

**Not done:** sign in through the existing UI, create one Hive from the eight synthetic L001 PDFs, verify the stored corpus, set `PLANNER_EXTERNAL_MAPPING_HIVE_IDS` to that Hive only, insert one `hive.domain_pack_selections` row for the compiled digest, click Rebuild Study, and confirm the new revision, facts, citations, unresolved calculations and relationships, and the intact previous Study and reports.

## Previous ticket — Stage 5D.3: Unified Agentic Domain Investigation

**Objective:** Replace the one-shot field-mapping completion with the existing Study agent loop. The ledger admits only catalog ids, extraction fact ids, instance ids, and source-written values, then the existing investigation engine accepts `hive.field-mapping-proposal/1`.

**Status (2026-11-25): local path passed synthetic regression. External refusal superseded by 5D.4.** The study alias stayed `anthropic/claude-opus-4-6`. At the close of 5D.3 a mapping turn returned `private_route_unverified` and did not post fact values. D-064 replaces that blanket refusal with the allowlist. Unpinned Hives stay on `hive-canonicalize/1`. No Hive pin, migration, commit, push, or deploy.

## Previous ticket — Stage 5D.2c: Unblock Private Field Mapping

**Objective:** Run one Domain Pack rebuild through a private model for `hive.field-mapping-proposal/1`, without sending case values to an external provider and without changing the Rebuild Study UI, canonical contracts, or investigation engine.

**Status (2026-11-25): BLOCKED.** No private model on this host met schema compliance, mapping accuracy, and the 600-second canonicalize limit together. The alias was not configured. No external model was used.

**Host, measured before the trial:** 2× ARM Neoverse-N1, 11 GiB RAM with about 9.7 GiB available, 45 GB disk with 11 GB free, load idle. No GPU, no Ollama, no vLLM. Planner container limit remains 512 MiB and 1 CPU. LiteLLM still has only `sorter` (`openai/gpt-4o-mini`), `harvester` (`anthropic/claude-sonnet-4-5`), and `heavy_lifter` (`anthropic/claude-opus-4-6`), none with an `api_base`.

**Synthetic test:** the shipped IEP catalog (237 fields, 39 relationships) plus eight invented facts. Same system prompt the planner would send. Temperature 0, JSON output. No case record.

| Model | Cores | Wall | Prefill | Generation | Schema | Field accuracy | Notes |
|---|---|---|---|---|---|---|---|
| Qwen2.5 1.5B Q4 (986 MB) | 1 | 593 s | 6,592 tokens / 409 s | 570 tokens / 3.15 per s | Top-level object only | 3/6 | Every mapping omitted `instanceId`. Invented field ids. Kept the unmappable fact. No relationship. |
| Qwen2.5 3B Q4 (1.9 GB) | 2 | 615 s | 6,592 tokens / 413 s | 602 tokens / 3.11 per s | Mappings match; relationship does not | 6/6 | Unmappable fact omitted. Relationship id was right, but the row used entity ids instead of `fromInstanceId` / `toInstanceId`, so the engine would reject the proposal. |

**Minimum additional compute:** 4 Neoverse-N1 cores (add 2) to give the measured 8-fact call margin under 600 s. RAM already holds a 3B Q4 model inside a 4 GB cap. The boot disk cannot keep that model installed: the Ollama image used about 6 GB and left 2 GB free at 96% full. Reclaim the unused Docker build cache (about 14 GB) or add disk before another install. A larger fact list needs more than 4 cores, because generation on 2 cores is about 3 tokens per second. A GPU is not required. The trial container, volume, and image were removed. Disk is 11 GB free again. Planner, Reader, and LiteLLM were not restarted.

**Legacy privacy finding (not changed):** `buildCanonicalizePayload` still sends file names, printed titles, issuer and person names, summaries, key dates, `valueAsWritten`, timeframes, attributed speakers, empty-field labels, and referenced-document descriptions to `heavy_lifter`. Study-agent turns send `read_pages` text to the same alias. That alias is `anthropic/claude-opus-4-6` with no private `api_base`. Smallest safe change, not applied: before the planner posts a legacy canonicalize body or a study-agent turn, reuse the field-mapping private-route check and return `private_route_unverified` without posting. Do not unset the aliases. That would stop legacy Study until a private route exists, and it needs a separate approval. Extract and write still use `harvester` and are parked, not part of this change.

**Not done:** LiteLLM alias, planner env, planner deploy, Hive pin, either migration, commit, or push.

## Previous ticket — Stage 5D.2b: Private Model Routing

**Objective:** Route `hive.field-mapping-proposal/1` through a dedicated private alias. Do not replace `heavy_lifter`. Verify the model server before sending case values. A private hostname is not proof of an approved provider. Legacy canonicalize stays on its current task, async job, timeout, and schema checks.

**Status (2026-11-25): BLOCKED for a live rebuild.** Planner tests `infra/oracle/test_v4_planner.py`: 132 passed. The planner now selects `PLANNER_FIELD_MAPPING_LITELLM_ALIAS` only for the field-mapping prompt. It accepts `ollama/`, `ollama_chat/`, or `hosted_vllm/` when every resolved address is loopback or private and that server lists the model id. Otherwise it returns `private_route_unverified` and does not post the facts. The running gateway has no alias that can pass that check, so a real model generation was not run. The deployed planner (up 5 days) does not contain this prompt and still serves legacy canonicalize as `heavy_lifter`.

**Legacy privacy finding:** `buildCanonicalizePayload` sends case-derived text to `heavy_lifter`: file names, printed titles, issuer and person names, summaries, `valueAsWritten`, timeframes, and referenced-document descriptions. On the running gateway that alias is `anthropic/claude-opus-4-6` with no private `api_base`. That is an existing disclosure on legacy Study generation. This ticket does not reroute it. Study-agent turns use the same alias and can include page text. Field mapping is not on the deployed planner; an unknown prompt id is refused before a model call.

**Not done:** deploy the planner, set the alias, install or attach a private model, pin a Hive, apply either migration, commit, or push.

## Previous ticket — Stage 5D.2: Enable Existing Rebuild Study

**Objective:** The existing Rebuild Study button runs the Domain Pack engine for one Hive whose `hive.domain_pack_selections` row is `iep-us-federal` `0.4.0` and the compiled digest of the shipped source. Unpinned Hives stay on `hive-canonicalize/1`. The pinned call requests and validates `hive.field-mapping-proposal/1`.

**Status (2026-11-25): selection and acceptance are local; live routing moved to 5D.2b.** The first private-route check treated a private host as sufficient and used the canonicalize alias. 5D.2b replaces that check. No migration applied. No production rebuild.

## Previous ticket — RB-2: Rebuild Study Reliability Fix

**Objective:** Make Rebuild Study reliable on the existing path. One Documents preparation instance drives the legacy notice and the rebuild control. The worker honors `rebuildMode`: reuse a verified extraction when its page-set digest matches, otherwise reconstruct only from saved pages. A personal Hive can open the newest accepted study. Historical revisions and their reports stay.

**Scope:** Documents notice and progress dialog, the rebuild extract/canonicalize path, and personal `/study` and `/findings` navigation. No migration. No new pipeline. No report regeneration on rebuild.

**Status (2026-11-23): implemented locally, awaiting founder review.** No migration. No production rebuild.

## Previous ticket — HB-5: Give HiveForYou a Distinctive Visual Identity

**Objective:** Make the Hive Board and the main hive pages visibly distinct with the existing brand palette: a compact case summary, separate surfaces for My Work, Ask AI, and Pro Conversation, and the same header language on Documents, Findings, Timeline, Reports, and Audit. Fix My Work so an authorized document list is not reported as empty.

**Scope:** Presentation and the personal-hive document load on the board. No database, no new tokens, no permission change. Leaf is completion, Coral is missing or an error, Honey stays on changes and evidence, Blue is action and selection.

**Status (2026-11-23): implemented locally, awaiting founder review.** No migration. Typecheck passed. Targeted UI tests 84/84. The owner document list follows `personalBoardRole` and the authorized source already used by Documents. A listing failure is an error, not "No documents uploaded yet."

## Previous ticket — HB-4: Apply HiveForYou Brand Colors Across All Pages

**Objective:** Use the existing brand tokens so Cell Blue marks actions, navigation, links and focus; Coral, Honey and Leaf keep their meanings; Paper, Mist and Ink stay the dominant surfaces. Styling only.

**Scope:** Shared selection styles (current menu row, active tab, segmented control, focus rings), personal Hive channel headers, and a few inputs and dialogs that still used non-token colors or bright text. No gallery edits, no database, no domain logic.

**Status (2026-11-23): implemented locally, awaiting founder review.** No migration. Typecheck passed. Targeted UI tests 23/23. Production build passed.

## Previous ticket — HB-3: Polish Hive Board as a Communication Workspace

**Objective:** The personal Hive board uses the workspace width as a communication surface: Hive title and a compact case summary, then My Work beside Ask AI (private) and Pro Conversation (shared). The viewer's actions follow their membership row. Routes stay the same.

**Scope:**
1. Hive sidebar (and the narrow-screen tabs that replace it) label the board **Hive Board**. The route stays `/hives/{id}`.
2. Wide screens show three columns. From 760px to 1479px, My Work sits beside a channel switcher. Phones stack a compact summary, My Work, and chat tabs. Each chat scrolls inside a panel with the composer at the bottom.
3. With no active Pro, the shared composer stays closed. A pending professional gets **Join this hive** instead. After they join, the header uses the other person's name and the composer opens.
4. Presentation role comes from the signed-in row in `list_hive_people`, not from a label and not from a hive card that omitted `membershipRole`. The owner does not see Pro request controls. Server checks are unchanged. No migration.

**Approval stops:** commit, push, deployment.

**Status (2026-11-23): implemented locally, awaiting founder review.** No migration. Sidebar label is Hive Board; the route is unchanged. Wide layout is three columns; 1280px uses My Work plus a channel switcher; 390px stacks summary, My Work, and chat tabs. The owner is taken from the signed-in `list_hive_people` row, so a hive card without an owner role does not show Pro request controls. Typecheck passed. Targeted tests: personal board, roster, people, My Work, sidebar, menu tabs, and workspace shell. Screenshots: `apps/web/.next/hb3-review-1600.png`, `hb3-review-1280.png`, `hb3-review-390.png`.

## Previous ticket — HB-2: Restore Hive Board for Personal Hives

**Objective:** A personal Hive opens on the communication board: a compact case summary, My Work & Pro Requests, and two channels — Ask AI (private) and Pro Conversation (shared). The full study stays on its own page. An invited professional can join and then create and review requests. The owner responds, uploads, and tracks them. Study and checklist rows are never shown as requests from a Pro.

**Scope (D-060):**
1. Personal Hive home (`firmId` null) renders `PersonalHiveBoard` instead of the long study Home. Firm client and staff homes are unchanged.
2. My Work shows for a personal Hive with no firm and no Pro. Uploaded documents are listed. With no staff-sourced requests, the empty state is "No requests from a Pro yet." `source = pack` stays out of that list.
3. Ask AI and Pro Conversation are separate. The shared composer stays closed until a professional membership is active. Ask threads stay private (`can_read_assistant_thread` unchanged).
4. The owner invites a professional and sees invited / accepted-not-joined / accepted. Accepting an invitation still leaves the professional pending. `activate_professional_membership` (personal Hives only) is how they join.
5. **Migration `supabase/migrations/20261123120000_personal_hive_pro_requests.sql` (not applied):** `hive.can_review_requests` is firm staff or an active professional on a personal Hive. `add_request` and `staff_resolve_request` use it, so a personal-Hive owner cannot create or accept requests. `respond_to_request` allows the owner because they are not a reviewer. `list_hive_people` includes a pending professional. No earlier migration file is edited.

**Approval stops:** applying `20261123120000`, commit, push, deployment.

**Status (2026-11-23): implemented locally, awaiting founder review.** Uncommitted. Migration not applied. SQL check `supabase/tests/database/personal_hive_board_check.sql` not run (no local Postgres). Verified: contracts `hive-board-requests.test.ts` 12/12; web `PersonalHiveBoard`, `personal-hive-roster`, `MyWorkPanel`, and `HiveBoardPeople` 13/13. Signed-in personal Hive and the production home were not opened; the new RPC is not applied.

## Previous ticket — HB-1 Addendum: My Work & Pro Requests

**Objective:** A compact **My Work & Pro Requests** section at the top of Hive Home (the Hive Board; `/board` redirects there) shows a client **What I've done**, **Waiting on me** and **Waiting on Pro**, and shows firm staff the mirror (**Waiting on client**, **Waiting on me**, **Done**). Each request shows requester, date, status, documents, linked messages and recorded history, expandable below.

**Scope (D-059):**

1. **Reuse, no new task system.** `hive.requests`, `hive.request_documents`, `hive.request_events`, `hive.request_checks` and their RPCs (FL-6a). Grouping is a pure function of the persisted request state and events (`packages/contracts/src/hives/hive-board-requests.ts`), never of conversation text.
2. **Additive migration (`supabase/migrations/20261122100000_my_work_requests.sql`, not applied):** `request_events` readable by every Hive member (RLS; supersedes FL-6a's staff/owner-only rule); `request_events.kind` (`state` · `response` · `reply`), `response` and `message_id`; `hive_messages.request_id` (people channel only); `list_requests` returns requester, documents with uploader, history with actor names and linked messages; `respond_to_request` (client "I don't have it" / "Doesn't apply" with note → `NEEDS_REVIEW`); `reply_to_request` (one people-channel message linked to the request plus a `reply` event, idempotent on `clientRequestId`). Staff `ACCEPT` / `NOT_NEEDED` / `ASK_AGAIN` and `add_request` unchanged.
3. **Web:** routes for add, attach, resolve, respond and reply under `/api/v1/hives/{hiveId}/requests`; `MyWorkPanel` on `ClientHome` and staff `HiveHome`; Hives without a firm show nothing.
4. **Unchanged:** document reading and intelligence pipeline, Study revisions (no rebuild on status change), private assistant threads, completed requests and attached documents (nothing deleted).

**Approval stops:** applying `20261122100000`, commit, push, deployment.

**Status (2026-11-22): implemented locally, awaiting founder review.** Uncommitted; migration not applied; SQL checks `supabase/tests/database/my_work_requests_check.sql` and the updated `hive_requests_check.sql` not run (no local Postgres). Until the migration is applied, `list_requests` returns no history or requester, so the panel shows requests without history and the respond/reply actions fail with a reference.
- Contracts: `hive-request-contracts.ts` (history, actions, `parseRequestAction`, `parseAddRequest`), `hive-board-requests.ts` (`buildMyWorkModel`).
- Server and routes: `server/hives/hive-requests.ts`; `GET`/`POST /api/v1/hives/{hiveId}/requests`; `POST /api/v1/hives/{hiveId}/requests/{requestId}` (attach, respond, reply with `idempotency-key`, resolve); reply notices share `hiveMessageNoticeTarget` with the messages route.
- UI: `components/hives/MyWorkPanel.tsx` (+ `lib/hive-requests-client.ts`); `ClientHome` shows it instead of *Still to send* when persisted requests exist; staff `HiveHome` shows *Client requests* above *Next steps* with *Add a request*; `hive-board-loader.ts` exposes `requests`.
- Verified locally: `npm run typecheck` (contracts and web) passed; contracts suite 631/631 on the full run; `MyWorkPanel.test.tsx` 6/6; request and message route tests 32/32; ESLint clean on changed files. In the full web run, the only failure left after rerunning is a 20 s cold-import timeout in `hive-workspace-routes.test.ts` (Documents page, not touched). No screenshots yet (they need the migration applied and a signed-in session).

**Date:** 2026-11-05 | **Status:** Active ticket **V5 pipeline simplification** (D-052, D-053; V5-004 next). V4-004M and V4-004L parked as superseded by D-052. V4-004H paused at *awaiting founder review* (committed as `2cb7113` and `1c0b2d4`; migration `20261104120000` not applied; no paid model run). V4-004G paused at *awaiting founder review* (implemented locally, uncommitted; migration `20261103190000` not applied; no paid model run). V4-004F paused at *awaiting live verification* (implemented locally, uncommitted; no paid model run). V4-004E paused at *awaiting live verification* (implemented locally, uncommitted; migration `20261102180000` not applied; no paid model run). V4-004D paused at *awaiting live verification* (implemented locally; no paid model run). V4-004C paused at *awaiting live verification* (implemented locally; no paid model run). V4-004B paused at *awaiting live verification* (implemented locally; no paid model run). V4-004A paused at *awaiting live verification* (implemented locally; `v4-planner` not rebuilt; no paid model run). V4-004 paused at *awaiting live verification* (implemented locally; migrations `20261102120000`, `20261102150000`, `20261102170000`, `20261102180000`, `20261103190000` not applied; `v4-planner` and Vercel settings not deployed). V4-003 paused at *awaiting live verification* (local implementation complete; migrations not applied). | **Repository:** `hiveforyou-v4`

> **Active ticket: V5 pipeline simplification** (D-052, D-053). V5-004 is next. V4-004M and V4-004L are parked as superseded by D-052. V4-004H, V4-004G, V4-004F, V4-004E, V4-004D, V4-004C, V4-004B, V4-004A, V4-004 and V4-003 remain paused, not closed.

## Active ticket — V5 pipeline simplification

**Objective:** Replace the agentic Study and Writer with the simplified pipeline in `docs/HiveForYou-PIPELINE-SIMPLIFICATION-PLAN.md` (D-052, D-053). Sequence from plan §6:

| Ticket | Scope | Status |
|---|---|---|
| **V5-000** | Decisions D-052/D-053, this plan in `docs/`, planner tasks `extract`, `canonicalize`, `write` | **Done** (planner tasks). D-052, D-053 and the plan are recorded in this documentation change. |
| **V5-001** | Four synthetic corpora with reviewed golden labels and negative controls; eval harness | **Done** (eval corpora; golden labels awaiting founder review) |
| **V5-002** | Extract stage and quote verification | **Done** (extract, built and unit-tested) |
| **V5-003** | Canonicalize stage | **Done** (canonicalize, built and unit-tested) |
| **V5-004** | Write stage and study view | **Next** |
| **V5-005** | Additive migration; wire the new stages into the workflow and UI; export UI runs to the eval | Not started |
| **V5-006** | Surgical removal of the old pipeline by reachability; docs sync | Not started |

**Founder decision (2026-11-05):** V5-002 to V5-004 are built and unit-tested offline; paid evaluation runs happen through the UI after V5-005, scored with the eval harness via an export script.

## Paused ticket — V4-004H Explicit Rebuild Study (awaiting founder review)

**Objective:** From the existing Documents UI, let the Hive owner create a new accepted Canonical Study revision with the current document-centered Study agent, using the pages and intent already saved. Analyze keeps its reuse behavior. Rebuild does not upload, re-read unchanged files, or regenerate Customer and Pro reports.

**Scope (D-049):**

1. **Owner RPC (`supabase/migrations/20261104120000_rebuild_study.sql`, `public.rebuild_study`):** authenticated Hive owner only. Same `request_id` replays that rebuild; an Analyze request id on this path is `idempotency_conflict`. An active Analyze blocks with `analysis_active`; an active Rebuild reattaches. Requires an accepted revision, a saved intent, and already-read documents with a non-empty frozen snapshot. Does not insert `document_reads`. Inserts one frozen `QUEUED` `STUDY_PREPARATION` with `preparation_mode = REBUILD`. `preparation_mode` is immutable.
2. **Acceptance without Writer (`accept_study_revision`, `analysis-workflow.ts`):** a Rebuild is accepted only when the investigation has a meaningful document inventory and at least one usable atomic document finding (`assessDocumentCenteredStudy`). That gate is open-vocabulary: no Hive id, no category list, and no fixed finding count. Page-read coverage is not extraction completeness. Failure leaves the current revision and its reports in place. Rebuild does not insert or dispatch `report_runs`. Analyze still queues both Writers.
3. **Documents UI (`DocumentsPanel.tsx`, `useStudyPreparation.ts`, `POST .../study-preparation/rebuild`):** secondary **Rebuild Study** when an accepted Study exists and nothing is running. Disabled until documents are read. Confirmation when material gaps need the same coverage digest as Analyze. Success shows the new revision number, source count, atomic finding count, and a link to the Study. Analyze still reuses a compatible accepted revision and can navigate to reports.
4. **Verification:** contract assessment and availability tests, Analyze reuse vs explicit rebuild, unchanged page reuse, owner and signed-out authorization, duplicate and concurrent requests, failed acceptance preserving the prior revision, workflow refusal when the inventory is missing, and pgTAP `supabase/tests/database/rebuild_study.test.sql`.

**Implementation status (2026-11-04, committed as `2cb7113` and `1c0b2d4`; not deployed):**

- **Migration:** `supabase/migrations/20261104120000_rebuild_study.sql` (not applied) + `supabase/tests/database/rebuild_study.test.sql`.
- **Contracts:** `assessDocumentCenteredStudy` and `rebuildAvailability`.
- **Web:** rebuild route, `rebuildStudy()`, Documents **Rebuild Study** action, and the acceptance gate that skips Writer dispatch only for `preparationMode = REBUILD`. Writer (`report-generation.ts`) is unchanged.
- **Verification (2026-11-04):** `npm test` — contracts 314 tests (24 files) and web 371 tests (47 files), all passed; `npm run typecheck` passed. `supabase/tests/database/rebuild_study.test.sql` is written and was not executed: `psql`, Docker, and a local Supabase database are not available on this machine (`npx supabase` 3.0.0 only). Migration `20261104120000` is not applied.
- **Approval stops:** applying `20261104120000`, deployment, live Analyze or Rebuild, paid model run, commit, push.

**Done when:** founder reviews this local implementation and verification; after a separately approved migration and run, L001 can rebuild a new revision from the pages already saved while revision 6 and its reports remain.

## Paused ticket — V4-004G Restore Intent, Domain and Professional-Purpose Intelligence in Writer (awaiting founder review)

**Objective:** Restore the end-to-end reporting chain (`Customer intention → domain → relevant professional's work → evidence-backed Study → distinct Customer and Pro deliverables`) by passing persisted intent decomposition, specialist questions (`whyItMatters`, `supportsOutcome`), investigation deliverables, domain context and audience guidance into the Writer payload and making the LLM presentation planner align section organization, priority findings, depth and A2UI components to each audience's job to be done.

**Scope (D-048):**

1. **Additive database RPC update (`supabase/migrations/20261103190000_writer_study_context_inputs.sql`, `supabase/tests/database/analysis_workflow.test.sql`):** update `public.get_report_generation_inputs(p_report_run_id uuid)` in a new additive migration to include `intentDecomposition` (`v_preview.intent_decomposition`), `intentIntelligence` (`v_preview.intent_intelligence`), `investigationPlan` (`v_preview.investigation_plan`) and `audience` on each item in `intents`, preserving `service_role` and Hive-owner isolation checks without modifying prior migration files.
2. **Bounded structured Writer payload (`apps/web/src/server/workflow/report-generation.ts`):** extend `GenerationInputs`, `loadGenerationInputs()` and `buildWriterPayload()` to pass `studyContext` (`subjects`, `goals` with `statedAs`, `questions`, `unclear.askThePerson` and `remainingLimits`, `reservedDecisions`, `specialistQuestions` with `whyItMatters`, `supportsOutcome` and `judgmentBasis`, and `investigationQuestions` with `establish`, `answerType`, `deliverable`, `comparison`, `chronology`, `calculation`, `evaluation` and `dependsOn`), enriched `domain` (`subdomain`, `reasoning`, `alternatives`, `ambiguityNotes`, `considerations`), and enriched `audienceProfile` (`alternativeRoles` for `PRO`, `studyGuidance`, `statedAudience` on `requests`), while gracefully handling missing/null fields on older revisions and never exposing raw document page text.
3. **LLM-driven audience-objective presentation planning (`packages/contracts/src/reports/writer-agent.ts`, `prompts/hive-writer/HiveForYou-Writer-v1.md`):** extend `WriterPresentationPlan` (`hive.writer-presentation-plan/1`), `presentationPlanSchema` and `recordPresentationPlan()` with optional validated `audienceObjective`, `sections[].goalIds` (`G1…`), `sections[].specialistQuestionIds` (`I1…`), `sections[].purpose` and `components[].purpose`; update `hive-writer/1` (digest `sha256:f8b896ff7e8611dadf883789addb96652aaedf3f6c0640115d484c7069946436`) so Customer and Pro dynamically organize, prioritize and visualize the identical verified claims for their respective jobs to be done without domain hard-coding, fixed templates or fixed component counts.
4. **Deterministic verification (`writer-agent.test.ts`, `report-generation.test.ts`, `prompt-catalog.test.ts`, `maya-fixture.ts`):** verify that `buildWriterPayload()` forwards persisted `whyItMatters`, `supportsOutcome`, investigation `deliverable`, goals, reserved decisions and domain reasoning; that missing/legacy context payloads succeed with safe empty defaults; and that identical verified Study claims produce meaningfully different validated presentation plans and A2UI compositions across `CUSTOMER` vs `PRO` and across different customer objectives.

**Implementation status (2026-11-03, local working tree, uncommitted):**

- **Migration:** `supabase/migrations/20261103190000_writer_study_context_inputs.sql` + pgTAP assertion in `supabase/tests/database/analysis_workflow.test.sql`.
- **Contracts & Fixture:** `packages/contracts/src/reports/writer-agent.ts`, `packages/contracts/src/testing/maya-fixture.ts` + focused tests in `packages/contracts/src/reports/writer-agent.test.ts`.
- **Web & Prompt:** `prompts/hive-writer/HiveForYou-Writer-v1.md` (digest `sha256:f8b896ff7e8611dadf883789addb96652aaedf3f6c0640115d484c7069946436`), `apps/web/src/server/workflow/report-generation.ts` + focused tests in `apps/web/src/server/workflow/report-generation.test.ts`, `apps/web/src/server/study-preparation/prompt-catalog.test.ts`.
- **Verification (2026-11-03):** contracts 250 tests (20 files), web 343 tests (45 files) — all pass; typecheck pass; lint 0 errors (2 pre-existing warnings); production build pass; `git diff --check` clean.
- **Approval stops:** applying pending migrations (`20261102120000`, `20261102150000`, `20261102170000`, `20261102180000`, `20261103190000`), deployment / `v4-planner` rebuild, live paid run, commit.

**Done when:** founder approves the local implementation and verification results; we can point to the exact place where customer intent, domain-specific professional purpose and report objectives enter Writer (`get_report_generation_inputs` → `loadGenerationInputs` → `buildWriterPayload` → `hive-writer/1` + `recordPresentationPlan`) and demonstrate differentiated Customer/Pro presentation plans without a paid model run.

## Paused ticket — V4-004F Scalable Writer Agent and Dynamic A2UI (awaiting live verification)

**Objective:** The Writer consumes an existing accepted Canonical Study, generates audience-specific narratives and dynamically composes approved A2UI components, and Hive validates and binds the output before publication.

**Scope (D-047):**

1. **Three-responsibility application-orchestrated Writer (`packages/contracts/src/reports/writer-agent.ts`, `apps/web/src/server/workflow/report-generation.ts`, `prompts/hive-writer/HiveForYou-Writer-v1.md`):**
   - **A. Presentation planning (`hive.writer-presentation-plan/1`, `recordPresentationPlan`):** given the accepted Canonical Study, `audience` and user `requests`, determine priority findings (`priorityFindings`), narrative organization and section headings (`sections`), appropriate summary/detail level (`CONCISE | BALANCED | COMPREHENSIVE`), approved A2UI components (`components`), and supporting verified claim IDs without fixed section counts, rigid layouts or copied evidence records.
   - **B. Content generation (`compose_writer_report`, `apply_writer_correction`):** generate audience-specific narrative content and dynamic A2UI composition via application-controlled structured generation (`WRITER_COMPOSE_TOOLS`) without requiring one model tool call per section or component, while allowing segmented section/unit generation (`WRITER_AGENT_TOOLS`) and targeted unit-level repair (`compileUnits`) that corrects only rejected content units (`title`, `summary`, specific `sections` by `id`, `scenarios` by `id`, or `view` components by `index`), preserves stable zero-based A2UI component slots and original section/component ordering across turns, marks dependency-blocked `view` components (`pendingViewComponents`) as pending without counting them as independent validation failures, revalidates pending components once their dependencies are corrected, and returns precise unit-level feedback (`ungroundedValue`, component-specific claim-kind requirements, and page-backed `candidateClaimIds`).
   - **C. Validation and compilation (`WriterCompiler` / `WriterAgentLedger`, `validateWriterReport`, `buildReport`):** reuse existing shared validators to verify claim IDs and `(block.type, claim.kind)` compatibility, enforce source provenance and strict claim-level numerical grounding, resolve scenario calculations deterministically, validate and bind the 13 allowlisted A2UI components from authorized Study records, refuse publication if any dependency remains unresolved, assemble `hive.writer-report/1` and `hive-application-view/1`, and persist the validated report against its exact accepted Study revision.
2. **Planner transport & model routing (`infra/oracle/v4_planner.py`, `planner-wire-contracts.ts`):** route `task: "writer"` on `POST /v1/study-agent-turn` (`study-agent-turn@1`) to `PLANNER_WRITER_LITELLM_ALIAS` (`harvester`) with closed object tool schemas (`WRITER_COMPOSE_TOOL_NAMES` / `WRITER_AGENT_TOOL_NAMES`), preserving `WRITER_AGENT_BUDGET` (235 s wall clock, 5 rounds, 48 accepted calls, 768 KB request cap, USD 1.50 cost ceiling; `rejectedUnits` counted for observability without a `maxInvalidCalls` termination limit).
3. **Privacy-safe observability (`apps/web/src/server/observability/logger.ts`, `report-generation.ts`):** emit structured runtime events (`writer.start`, `writer.model.completed`, `writer.validation.completed`, `writer.correction.requested`, `writer.publication.completed`) with elapsed `durationMs`, token counts (`inputCount`, `outputCount`, `totalCount`), `componentCount`, `sectionCount`, `scenarioCount`, `rejectedUnits` and sanitized `diagnosticReason`/`diagnosticField`, never logging document text, personal information, raw prompts or model responses.
4. **Deterministic verification (`writer-agent.test.ts`, `report-generation.test.ts`, `prompt-catalog.test.ts`, `analyze-resumability.test.ts`, `test_v4_planner.py`):** Customer and Pro report generation, dynamic A2UI component selection, correct source and claim bindings, exact numerical grounding, targeted correction of invalid content, stable component indexes and pending dependency resolution (including the `budget.invalid_calls:r2/5:tc20:inv9:s5:v10` Customer regression), preservation of previously accepted report sections, full final Writer and A2UI contract compatibility, existing Study and report persistence behavior, and no duplicate processing when Analyze reuses an accepted Study.

**Implementation status (2026-11-03, local working tree, uncommitted):**

- **Contracts & Fixture:** `packages/contracts/src/reports/writer-agent.ts`, `packages/contracts/src/reports/writer-report-contracts.ts`, `packages/contracts/src/reports/application-view-contracts.ts`, `packages/contracts/src/testing/maya-fixture.ts` + focused tests in `packages/contracts/src/reports/writer-agent.test.ts`.
- **Web, Prompt & Observability:** `prompts/hive-writer/HiveForYou-Writer-v1.md` (digest `sha256:9b0deaa04a5ec0d4f27f355b5ecd6d46888652f602bfe4948f1bcb78427e3b77`), `apps/web/src/server/workflow/report-generation.ts`, `apps/web/src/server/observability/logger.ts` + focused tests in `report-generation.test.ts`, `prompt-catalog.test.ts`.
- **Oracle:** `infra/oracle/v4_planner.py` + `infra/oracle/test_v4_planner.py`.
- **Verification (2026-11-03):** contracts 249 tests (20 files), web 341 tests (45 files), Oracle pytest 83 (79 planner + 4 reader) — all pass; typecheck pass; lint 0 errors (2 pre-existing warnings); production build pass; `git diff --check` clean.
- **Approval stops:** deployment / `v4-planner` rebuild, applying pending migrations (`20261102120000`, `20261102150000`, `20261102170000`, `20261102180000`), live paid run, commit.

**Done when:** founder approves the local implementation and verification results; after deployment, Customer and Pro Writer runs plan presentation, dynamically compose A2UI views, repair rejected units without losing accepted sections, and persist verified reports against the accepted Canonical Study revision.

## Paused ticket — V4-004E Resumable Analyze and Report Reuse (awaiting live verification)

**Objective:** Make clicking **Analyze** state-aware so it reuses existing durable Canonical Study revisions and Customer/Pro reports instead of repeating completed, paid processing.

**Scope (D-046):**

1. **Snapshot, configuration and Study reuse (`supabase/migrations/20261102180000_resumable_analyze_and_report_reuse.sql`, `public.start_study_preparation`, `hive.expire_stale_report_runs`):** resolve the current case's source snapshot (`sourceSnapshotDigest`, `coverageDigest`) and analysis configuration (`intentSnapshotDigest`); fail any in-flight Study `processing_runs` row whose frozen snapshot or intent digest is stale with `SOURCE_CHANGED` before reattaching; reattach to an active compatible Study run if one exists; when all eligible documents are read and no new reads are needed, find the latest compatible accepted `hive.study_revisions` row matching `(source_snapshot_digest, intent_snapshot_digest, coverage_digest)` and current manifest binding format (`hive.source-page-index/1`).
2. **Per-audience report reuse and selective Writer dispatch (`start_study_preparation`, `study-preparation.ts`, `api/v1/hives/[hiveId]/study-preparation/route.ts`):** inspect valid `hive.reports` and `hive.report_runs` tied to that exact compatible revision: if both `CUSTOMER` and `PRO` reports exist, return `reusedStudy: true, reportsReady: true` (HTTP `200`) with zero Study or Writer runs created; if only one audience report exists, preserve it and queue (`trigger = 'OWNER_GENERATE'`) or reattach only the missing audience; if both reports are missing or failed, queue only the required Writer runs without rerunning the Study; if a matching Writer run is already active (`QUEUED`/`WRITING`/`VALIDATING`/`SAVING`), reattach to it rather than creating duplicates; keep explicit user-requested regeneration (`POST /api/v1/hives/{id}/reports` / `generate_hive_report`) as a separate action that appends new reports without overwriting previously accepted reports.
3. **Client navigation and modal state (`useStudyPreparation.ts`, `DocumentsPanel.tsx`, `study-preparation-contracts.ts`):** when `startStudyPreparation` returns `reportsReady: true` (both Customer and Pro reports exist for the compatible Study), navigate directly to `/hives/{hiveId}/reports` without opening the progress modal; when reusing a Study with active or newly queued Writer runs, open the modal at the completed Study stage and poll until both reports settle.
4. **Deterministic verification (`analyze-resumability.test.ts`, `study-preparation.test.ts`, `route.test.ts`, `DocumentsPanel.test.tsx`, `study-preparation-contracts.test.ts`, `analysis_workflow.test.sql`):** test every state transition including both reports ready, partial report success (Customer only / Pro only), both reports failed, active Writer reattachment, repeated clicks and concurrent requests, active vs stale Study runs, stale revisions after document/intent changes, multi-revision selection, separate non-overwriting regeneration history, and tenant ownership isolation.

**Implementation status (2026-11-03, local working tree, uncommitted):**

- **Migration:** `supabase/migrations/20261102180000_resumable_analyze_and_report_reuse.sql` + pgTAP tests in `supabase/tests/database/analysis_workflow.test.sql`.
- **Contracts:** `packages/contracts/src/study-preparation/study-preparation-contracts.ts` + `study-preparation-contracts.test.ts`.
- **Web Server & UI:** `apps/web/src/server/study-preparation/study-preparation.ts`, `apps/web/src/app/api/v1/hives/[hiveId]/study-preparation/route.ts`, `apps/web/src/lib/study-preparation-client.ts`, `apps/web/src/components/hives/useStudyPreparation.ts`, `apps/web/src/components/hives/DocumentsPanel.tsx` + tests in `analyze-resumability.test.ts`, `study-preparation.test.ts`, `route.test.ts`, `DocumentsPanel.test.tsx`.
- **Verification (2026-11-03):** contracts 242 tests (20 files), web 338 tests (45 files) — all pass; typecheck pass; lint 0 errors (2 pre-existing warnings); production build pass.
- **Approval stops:** applying `20261102180000_resumable_analyze_and_report_reuse.sql`, deployment, live paid run, commit.

**Done when:** founder approves the local implementation and migration; after deployment, clicking Analyze reuses compatible Study revisions and existing audience reports, navigates directly to Reports when both exist, and runs only missing Writer audiences when needed.

## Paused ticket — V4-004D Agentic Writer with Immediate Validation (awaiting live verification)

**Objective:** Replace the brittle one-shot Writer JSON completion with a minimal native tool-driven Writer (`WriterAgentLedger` + `runWriterAgent`) that validates report blocks, deterministic scenarios and A2UI components as they are recorded, returns actionable errors for targeted correction without regenerating accepted sections, and assembles the unchanged `hive.writer-report/1` contract for `buildReport()` and `save_report`.

**Scope (D-045):**

1. **`WriterAgentLedger` and shared validation (`packages/contracts/src/reports/writer-agent.ts`, `writer-report-contracts.ts`, `application-view-contracts.ts`):** five tools (`set_report_outline`, `record_section`, `record_scenario`, `record_view_component`, `finish_report`) with closed object parameter schemas (`WRITER_AGENT_TOOLS`); shared validators (`validateReportBlock`, `validateScenarioDefinition`, `validateViewComponentProposal`, `mustSurfaceClaims`) enforcing `(block.type, claim.kind)` rules, strict claim-level numerical grounding, verified calculation and scenario result bindings, deterministic scenario formula evaluation, granular A2UI claim specificity and source page references, component ordering, and mandatory visible uncertainty surfacing; rejected tool calls never mutate accepted state and return actionable diagnostics (`error`, `field`, `hint`, `candidateClaimIds`); replacement of accepted sections/scenarios/view components by stable ID or zero-based index; idempotent `(reportRunId, toolCallId)` handling with `tool_call_conflict` on conflicting replays; deterministic assembly of `hive.writer-report/1` followed by unchanged `buildReport()`.
2. **Planner transport (`infra/oracle/v4_planner.py`, `planner-wire-contracts.ts`, `planner-client.ts`):** extend `POST /v1/study-agent-turn` (`study-agent-turn@1`) with `task: "study" | "writer"` (default `"study"`), validating `hive-writer/1`, `WRITER_AGENT_TOOL_NAMES` and closed object parameter schemas and routing to `PLANNER_WRITER_LITELLM_ALIAS` (`harvester`); remove obsolete one-shot `task: "writer"` from `/v1/plan-completion` and `PLANNER_COMPLETION_TASKS`.
3. **Writer prompt & workflow loop (`prompts/hive-writer/HiveForYou-Writer-v1.md`, `prompt-catalog.ts`, `report-generation.ts`, `failure-diagnostic.ts`):** update `hive-writer/1` (digest `sha256:72e5fcd500a6ef635be290ec8ed4d01448d6de18fad650cf917fc300c50238b8`) to build reports through the five tools, batch independent calls, repair only rejected items, and never invent claim IDs, numbers or citations; enforce `WRITER_AGENT_BUDGET` (235 s wall clock, 5 rounds, 48 accepted tool calls, 8 rejected calls, USD 1.50 cost ceiling); fail closed without automatic retries on `writer_agent_budget_exhausted` (`budget.<dimension>:r<used>/<allowed>:tc<accepted>:inv<rejected>:s<sections>:v<viewComponents>`) while preserving delayed retry dispatch on `MODEL_TIMEOUT` / `MODEL_UNAVAILABLE`.
4. **Deterministic verification (`writer-agent.test.ts`, `report-generation.test.ts`, `agentic-study-a2ui.test.ts`, `planner-wire-contracts.test.ts`, `planner-client.test.ts`, `failure-diagnostic.test.ts`, `test_v4_planner.py`):** 1-turn clean Customer and Pro report completion, 2-turn targeted recovery from `writer_claim_kind`, `writer_number_ungrounded`, broad `ANSWER` claims in granular A2UI components, and `writer_uncertainty_hidden`, unsupported number rejection, scenario arithmetic and binding, idempotent/conflicting toolCallIds, non-mutation on failure, budget exhaustion, and timeout retry backoff.

**Implementation status (2026-11-03, local working tree, uncommitted):**

- **Contracts:** `packages/contracts/src/reports/writer-agent.ts`, `writer-report-contracts.ts`, `application-view-contracts.ts`, `study-preparation/planner-wire-contracts.ts`, `errors/failure-diagnostic.ts`, `testing/maya-fixture.ts` + focused tests in `writer-agent.test.ts`, `agentic-study-a2ui.test.ts`, `planner-wire-contracts.test.ts`, `failure-diagnostic.test.ts`.
- **Web & Prompt:** `prompts/hive-writer/HiveForYou-Writer-v1.md`, `apps/web/src/server/study-preparation/prompt-catalog.ts`, `planner-client.ts`, `apps/web/src/server/workflow/report-generation.ts` + focused tests in `report-generation.test.ts`, `prompt-catalog.test.ts`, `planner-client.test.ts`.
- **Oracle:** `infra/oracle/v4_planner.py` + `infra/oracle/test_v4_planner.py`.
- **Verification (2026-11-03):** contracts 240 tests (20 files), web 320 tests (44 files), Oracle pytest 83 (79 planner + 4 reader) — all pass; typecheck pass; lint 0 errors (2 pre-existing warnings); production build pass; `git diff --check` clean.
- **Approval stops:** deployment / `v4-planner` rebuild, live paid run, commit.

**Done when:** founder approves the local implementation and verification results; after deployment, Customer and Pro Writer runs complete through the tool loop (recovering in-turn when a block or A2UI component is rejected) and persist verified reports without touching the accepted Canonical Study.

## Paused ticket — V4-004C Optimize Agentic Study Investigation (awaiting live verification)

**Objective:** Resolve investigation round exhaustion (`study_agent_budget_exhausted`, `budget.rounds`, 18 rounds, 6 questions, 182,640 ms) caused by sequential question-by-question execution, without increasing execution budgets, introducing migrations, or altering `hive.study-investigation/1`, verification, deterministic calculations, revision acceptance, Writer or A2UI.

**Scope (D-044):**

1. **Case-wide batched Study prompt (`prompts/hive-study/HiveForYou-Study-Preview-v1.md`, `study-prompt-builder.ts`, `study-investigation.ts`):** replace Section 4 instructions that told Claude to finish `P1` before starting `P2` with instructions to investigate the entire authorized case corpus across all plan questions (`P1`–`Pn`) together; define the recommended five-phase execution pattern in Section 8 (`renderOutputContract`) and `START_MESSAGE` (locate and read relevant pages across all questions → batch `record_evidence` → batch `record_fact`, `record_calculation` and `flag_conflict` → record `record_assessment` and `record_professional_determination` using returned `F…` ids → close completed questions with `finish_question` respecting `Answer after` dependencies and call `finish_study` once all required questions are closed, allowing additional targeted reads when evidence requires it); explicitly state that `E…` evidence ids are reusable across questions without rereading pages, `F…` fact ids in assessments and determinations must belong to the same `questionId` (`fact_other_question` otherwise), and no tool call may assume an `E…` or `F…` id before the tool result that creates it. Template digest `sha256:b0df79fb08ebb2c9b96341d63dea7da19d4bec90155737443903ea333281323f`.
2. **Safe budget-exhaustion diagnostics (`study-agent.ts`, `study-investigation.ts`):** on `study_agent_budget_exhausted`, report safe non-content progress counters in `diagnosticField` (`formatStudyAgentBudgetDiagnosticField` / `parseStudyAgentBudgetDiagnosticField`: `budget.<dimension>:r<roundsUsed>/<roundsAllowed>:tc<toolCalls>:inv<invalidCalls>:q<questionsCompleted>/<questionsTotal>`) within existing `failure-diagnostic@1` and SQL check constraints, without a migration or any document/quote/message content.
3. **Deterministic tests (`study-agent.test.ts`, `study-investigation.test.ts`, `study-prompt-builder.test.ts`, `analysis-workflow.test.ts`, `agentic-study-a2ui.test.ts`, `maya-fixture.ts`):** six plan questions (`P1`–`P6`) with shared evidence completed in 5 batched turns within the 18-round allowance, batched independent tool calls, cross-question `E…` reuse, rejection of cross-question `F…` ids (`fact_other_question`), tool-call dependency ordering, question dependency handling, complete Study assembly, failure on incomplete investigation, safe progress diagnostics, and verifier + Customer/Pro Writer/A2UI compatibility.

**Implementation status (2026-11-03, local working tree, uncommitted):**

- **Prompt & Builder:** `prompts/hive-study/HiveForYou-Study-Preview-v1.md`, `apps/web/src/server/study-preparation/study-prompt-builder.ts`, `apps/web/src/server/workflow/study-investigation.ts` + focused tests in `study-prompt-builder.test.ts`, `study-investigation.test.ts`, `analysis-workflow.test.ts`.
- **Contracts & Fixture:** `packages/contracts/src/analysis/study-agent.ts`, `packages/contracts/src/testing/maya-fixture.ts` + focused tests in `study-agent.test.ts` and `agentic-study-a2ui.test.ts`.
- **Verification (2026-11-03):** contracts 231 tests (19 files), web 316 tests (44 files) — all pass; typecheck pass; lint 0 errors (2 pre-existing warnings); production build pass; `git diff --check` clean.
- **Approval stops:** deployment, live paid Maya run, commit.

**Done when:** founder approves the local implementation and verification results; after deployment, a 6-question Maya investigation completes within the 18-round budget and reaches an accepted Study revision and Customer/Pro reports.

## Paused ticket — V4-004B Writer Reliability and Evidence Precision (awaiting live verification)

**Objective:** Fix confirmed downstream report defects — Customer `writer_claim_kind` failure at `sections[2].blocks[3]`, Customer (`sections[4].blocks[2]`) and Pro (`summary[1]`) `writer_number_ungrounded` failures, missing delayed report retry dispatch after `transition_report_run` sets `next_dispatch_at`, overly broad question-level source attribution on granular A2UI entries, assessment provenance (`criterion` / `criterionSource`) and verbatim-quote separation, and duplicated narrative/structured report content — while preserving the accepted Canonical Study, investigation engine, database migrations and 13-component A2UI catalog.

**Scope (D-043):**

1. **Customer & Pro Writer validation (`hive-writer/1`, `writer-report-contracts.ts`, `application-view-contracts.ts`):** keep deterministic `validateWriterReport()` claim-kind rules and strict claim-level numeric grounding unchanged (no automatic question-wide number expansion, no fuzzy matching, no global number-word-to-digit conversion); strip canonical Study claim identifiers (`CLAIM_ID_TOKEN`: `P1`, `P1.F0`, `P2.C0`, …) alongside binding tokens in `stripReferenceTokens()` / `numericTokensIn()` / `numbersIn()`, and exempt genuine formatting-only list markers (`1.`, `2)`, `(3)`, `Step 4:` at the start of a line or list item, `category === "list_marker"`) in `firstUngroundedNumericToken()` and `numbersIn()` across Writer validation and A2UI binding while still rejecting numbers in factual prose, dates, percentages, measurements, identifiers and deadlines; emit safe token position + category diagnostics (`${path}@num[${position}]:${category}`, where `category` is `quantity | decimal | percent | date | list_marker | page_ref | identifier`) on `writer_number_ungrounded` without logging values or document text; update `prompts/hive-writer/HiveForYou-Writer-v1.md` (digest `sha256:8f747862df5b9f456ceb1e7fb3a94b0725f4d167d239da38274e093eca477f83`) with explicit `(block.type, claim.kind)` compatibility rules, multi-claim citation guidance (including supporting `.F` / verified `.C` claims whenever numbers or dates appear in `INTERPRETATION`, `UNCERTAINTY`, `QUESTION` or `NEXT_STEP` blocks), no claim IDs or page numbers in prose, no numbered lists inside block text, and updated JSON examples.
2. **Report retry dispatch (`report-generation.ts`):** when `transition_report_run` returns `applied: true` and `retrying: true` (`status = 'QUEUED'`, `next_dispatch_at = now() + 30s * attempt_count`), `processReportRun()` schedules `{ kind: "report", id: reportRunId }` via `deps.dispatch` with `delaySeconds = 30 * attemptCount`, preserving attempt counters, backoff, leases, `max_attempts` (3) and `save_report` idempotency.
3. **Granular claim-level provenance (`application-view-contracts.ts`, `writer-report-contracts.ts`):** require non-empty specific `claimRefs`/`claimIds` on `Timeline`, `Checklist`, `RecordTable`, `Comparison`, `IssueList`, `QuestionList`, `KeyFindings` and `EvidencePanel`; reject broad question-level `ANSWER` claims (`P1`, `P2`, …) in granular A2UI entries and scenario parameters when atomic `FACT` claims (`P1.F*`) exist; require source page references on `Timeline`, `Checklist`, `RecordTable`, `Comparison`, `KeyFindings` and `EvidencePanel`; never infer citations via fuzzy text matching.
4. **Assessment provenance (`study-verification.ts`, `report-generation.ts`, `application-view-contracts.ts`, `A2uiView.tsx`):** carry `criterion` and `criterionSource` (`DOCUMENT` | `GENERAL_KNOWLEDGE`) from the accepted Study through `StudyClaim`, `buildWriterPayload()`, `BoundClaim` and `BoundBlock`; keep `StudyClaim.quotes` strictly to deduplicated verbatim source quotes (never model-written `fact.statement` strings); render provenance badges (`Source-backed fact`, `Interpretation · General-knowledge criterion`, `Interpretation · Document criterion`, `Reserved determination`, `General information`) and the declared criterion in `A2uiView`.
5. **Deduplicated report composition and visible uncertainty coverage:** render each `Narrative` `sectionId` and `ScenarioExplorer` `scenarioId` at most once; filter out narrative blocks (and unplaced sections in `PROPOSED` layout) that duplicate structured component items; count structured components toward mandatory uncertainty coverage (`mustSurface`) only when their rendered text visibly presents the uncertainty (`visiblyPresentsUncertainty`).

**Implementation status (2026-11-03, local working tree, uncommitted):**

- **Contracts:** `packages/contracts/src/analysis/study-verification.ts`, `packages/contracts/src/reports/writer-report-contracts.ts`, `packages/contracts/src/reports/application-view-contracts.ts` + focused tests in `study-verification.test.ts` and `writer-report-contracts.test.ts`.
- **Web & Prompt:** `prompts/hive-writer/HiveForYou-Writer-v1.md`, `apps/web/src/server/workflow/report-generation.ts`, `apps/web/src/components/a2ui/A2uiView.tsx` + focused tests in `report-generation.test.ts`, `ReportsPanel.test.tsx`, `prompt-catalog.test.ts`.
- **Verification (2026-11-03):** contracts 228 tests (19 files), web 314 tests (44 files) — all pass; typecheck pass; lint 0 errors (2 pre-existing warnings); production build pass; `git diff --check` clean.
- **Approval stops:** deployment, live paid Writer run, commit.

**Done when:** founder approves the local implementation and verification results; after deployment, Customer and Pro Writer runs complete without `writer_claim_kind` failure or orphaned `QUEUED` retries, and rendered reports show precise per-item source chips, general-knowledge assessment labels and deduplicated sections.

## Paused ticket — V4-004A Agentic Canonical Study (awaiting live verification)

**Objective:** Replace the single `study` JSON call in `INVESTIGATING` with a bounded native tool-calling investigation over one case-wide corpus of persisted authorized pages, so the Study scales past what fits in one prompt and every recorded item is checked as it is made. Output contract, verifier, formulas, `accept_study_revision`, Writer, reports and A2UI are unchanged.

**Scope (D-042):** case page index instead of page text in the prompt; eleven tools executed by the trusted `StudyAgentLedger`; run-local idempotent ledger; exact assembly of `hive.study-investigation/1`; budgets that fail closed; snapshot recheck before verification; `study-agent-turn@1` relay on `v4-planner` (no tool execution on Oracle); documented `hive-study-preview/1` template change; removal of the unused structured-output and one-shot paths.

**Implementation status (2026-11-03, local working tree, uncommitted):**

- **Contracts:** `packages/contracts/src/analysis/study-agent.ts` (tools, ledger, budgets, assembly) + tests; `study-agent-turn@1` wire types in `planner-wire-contracts.ts`; binding format `hive.source-page-index/1`; Maya four-turn agent script in `testing/maya-fixture.ts`; `reports/agentic-study-a2ui.test.ts` (ledger → verifier → catalog → Customer/Pro A2UI).
- **Web:** `apps/web/src/server/workflow/study-investigation.ts` (loop, budgets, page index) + tests; `analysis-workflow.ts` `investigate()` uses it; `planner-client.ts` `callStudyAgentTurn`; prompt builder writes the tool instructions.
- **Oracle:** `v4_planner.py` `POST /v1/study-agent-turn`; `task: study` removed from `/v1/plan-completion`; structured-output schema and probe modules deleted.
- **Verification (2026-11-03):** contracts 221 tests, web 310 tests, Oracle pytest 83 (planner + reader) — all pass; lint 0 errors (2 pre-existing warnings); typecheck, build and `git diff --check` recorded in the ticket report.
- **Approval stops:** rebuild and redeploy `v4-planner` (new path; the proxy route `/planner/*` already covers it); first paid agentic run on synthetic Maya; commit. V4-004's own approval stops (migrations, Vercel `HIVE_INTERNAL_WORKER_TOKEN`, LiteLLM key models) still apply before any live run.

**Done when:** the founder approves the local implementation; after deployment, a synthetic Maya run reaches an accepted Study revision through the agentic loop with recorded token, call and cost totals, and both reports render.

## Paused ticket — V4-004 Analyze / Prompt Preview (awaiting live verification)

**Objective:** After document reads are verified, the owner clicks **Analyze** on the Documents page and reaches a persisted Study **Prompt Preview**. The preview contains the real stored intent, an evidence-referenced domain proposal, specific investigation questions grouped by objective, and complete prompt instructions labelled **Prepared — Canonical Study not yet executed**.

**Scope (D-039):**

1. **Analyze button.** Enabled when at least one document has a verified `SUCCEEDED`/`PARTIAL` read and no read or preparation is active. Partial coverage (excluded documents, `PARTIAL` reads, missing or empty pages) is disclosed and requires acknowledging the exact server-computed coverage digest. Idempotent on `clientRequestId`; one active run per Hive.
2. **Durable run.** `hive.processing_runs` (`kind = STUDY_PREPARATION`), `after()` + lease as in D-038. Stages: Understanding request (`hive-intent/1`), Identifying domain (`hive-domain/1`), Planning investigation (`hive-plan/1`, from the validated intent and domain), Building prompt (deterministic `hive-study-preview/1`). Each model output is validated by trusted code before it is saved. No stored intent leads to `NEEDS_CLARIFICATION` with zero model calls.
3. **Frozen sources.** Each run freezes sha256, read fingerprint and page-set digest per document plus the intent request IDs. A change mid-run fails the run (`source_changed`); completed previews report staleness reasons.
4. **Preview.** Immutable `hive.study_prompt_previews`: prompt text, `hive.study-execution-manifest/1`, source snapshot, output contract `hive.study-investigation/1`, per-stage model metadata (alias, tokens, latency, errors; never text or credentials). `SUCCEEDED` requires its readback.
5. **Model access.** Only through `v4-planner` on Oracle (bearer token, loopback bind behind the Reader's TLS proxy, fixed alias `sorter`, scoped LiteLLM virtual key held on Oracle). V3 LiteLLM is not modified or restarted.

**Implementation order:** (1) docs, migration + pgTAP test, contracts, prompts; (2) Oracle planner; (3) web server pipeline; (4) UI. Report after each step.

**Approval stops (not performed by the agent):** applying `20261102090000_create_study_preparation.sql`; creating the scoped LiteLLM virtual key; deploying `v4-planner` and its TLS proxy route; setting Vercel `PLANNER_BASE_URL` / `PLANNER_SERVICE_TOKEN`; the first paid `sorter` smoke run.

**Done when:** a user completes reading, clicks Analyze, sees persisted stage progress, and reaches a persisted Prompt Preview as described above; automated tests, typecheck, lint and production build pass; failure, retry, duplicate-click, stale-source, partial-coverage and cross-Hive paths are tested.

**Implementation status (2026-11-01, local working tree):**

- **Oracle planner:** `infra/oracle/v4_planner.py` (FastAPI, `GET /health`, `POST /v1/plan-completion`, constant-time bearer check, fails closed without a token, forced alias, `temperature 0`, JSON-object output, 90 s LiteLLM timeout, `planner-error@1` envelope), `Dockerfile.planner`, `compose.planner.yml` (bridge network attached to external `oracle_default`, LiteLLM at `http://hive-litellm:4000`, published only on `127.0.0.1:8083`, read-only root, no host networking), `v4-planner.env.example`, `PLANNER-DOCKER.md`. 21 pytest cases pass.
- **Web server:** `apps/web/src/server/study-preparation/` — `prompt-catalog.ts` (LF-normalized sha256 digests; prompts traced into the route via `outputFileTracingIncludes`), `planner-client.ts`, `page-sampling.ts` (deterministic first/last/even-interior sample, round-robin across documents, 2,500 chars/page, 24,000 total), `study-prompt-builder.ts` (deterministic `hive-study-preview/1` + manifest), `study-preparation.ts` (owner start/get; worker with validated stages, read-back before `SUCCEEDED`). Route `GET|POST /api/v1/hives/{id}/study-preparation` (`after()`, `maxDuration` 300).
- **Outcome-oriented planning (founder refinement):** validators reject questions that restate a request (`question_restates_intent`) and `COMPARISON`/`CHRONOLOGY`/`CALCULATION` plan questions without their logic (`answer_logic_missing`); `hive-intent/1` and `hive-plan/1` texts were edited to state this. No domain-specific code or question sets.
- **Contracts:** error codes `MODEL_TIMEOUT` (504), `MODEL_UNAVAILABLE` (503), `MODEL_OUTPUT_INVALID` (502); stage labels "Understanding your request", "Identifying the domain", "Planning the investigation", "Constructing your study prompt".
- **UI:** Documents **Analyze** button + hint, `AnalyzeModal` (coverage-gap confirmation, four persisted stages, failure with support reference and Try again), 3 s polling only while active, automatic navigation to Study on success. Study tab renders `StudyPromptPreview` (verbatim requests, domain with advisory confidence and page chips, objectives, investigation questions, coverage, staleness, full prompt, **Copy Prompt**).
- **Remaining approval stops:** scoped LiteLLM virtual key; `v4-planner` deployment and TLS route `/planner/*`; Vercel `PLANNER_BASE_URL` / `PLANNER_SERVICE_TOKEN`; first paid `sorter` smoke run; commit.

**Refinement — intent intelligence and investigation quality (2026-11-02, D-040, local working tree, uncommitted):**

- **New stage** `DEVELOPING_QUESTIONS` ("Developing specialist questions") between domain and planning: prompt `prompts/hive-intent-intelligence/HiveForYou-Intent-Intelligence-v1.md` (`hive-intent-intelligence/1`), validator `validateIntentIntelligence` (output `hive.intent-intelligence/1`), stage output `intentIntelligence`, persisted on the preview as `intent_intelligence`. The worker now makes four planner calls (`intent`, `domain`, `intelligence`, `plan`).
- **Planner:** `hive-plan/1` input includes the specialist questions; each plan question lists `specialistQuestionIds`, `sourceDependencies` and an optional `evaluation`; the validator fails a plan that drops a specialist question or leaves a judgment question without an evaluation.
- **Study prompt:** `hive-study-preview/1` allows evidence-backed assessments (facts, declared criterion, reasoning, strength) and keeps facts, calculations, assessments, uncertainties and professional determinations in separate fields of `hive.study-investigation/1`. The prompt lists each objective's specialist questions and what the documents may not settle.
- **Model routing:** `v4-planner` `TASK_MODEL_ALIASES` (all `sorter`; intelligence switchable to `harvester` in code); per-task output budgets (intelligence and plan 12,000 tokens); LiteLLM timeout 150 s, web planner timeout 160 s.
- **Audience:** optional "Who is this for?" field in `HiveComposer`, saved with the intent (`create_intent_request(…, p_audience)`), passed to the intent intelligence stage and shown in the prompt.
- **Migration (not applied):** `supabase/migrations/20261102120000_add_intent_intelligence_stage.sql` — additive (audience column + 4-arg RPC, new status/transition/gate, preview column, updated save/readback/inputs). pgTAP `study_preparation.test.sql` now plans 49 tests.
- **Tests:** contracts (96), web (worker regression scenarios: synthetic Maya multi-intent plan review and a domain-neutral insurance claim), planner pytest (24).
- **Approval stops:** applying the migration; redeploying `v4-planner`; the live `sorter` run through Study Prompt Preview (needs LiteLLM and Supabase access); commit. Canonical Study is not executed.

**Extension — end-to-end Analyze, Canonical Study and both reports (2026-11-02, D-041, local working tree, uncommitted):** supersedes the "no Opus execution, reports or A2UI" boundary above for V4-004 by founder decision.

- **Single entry point:** Documents **Read Documents** button, `ReadDocumentsModal` and `useDocumentReads` removed. Analyze queues reads for unread documents (`READING_DOCUMENTS`), reuses verified reads, freezes the snapshot after reading, then runs intent (with `audienceAnalysis`) → domain → specialist questions (audience refinement) → plan → prompt → `INVESTIGATING` (one `study` call) → `VERIFYING_EVIDENCE` → `ACCEPTING_STUDY` → `SUCCEEDED`, then both Writer runs automatically.
- **Server:** `server/workflow/analysis-workflow.ts` (stage engine; at most one model stage per invocation, deterministic stages inline, lease release + dispatch), `report-generation.ts` (one `writer` call per audience, validate, scenarios, A2UI bind, `save_report`), `worker.ts`, internal route `POST /api/internal/workflow` (bearer `HIVE_INTERNAL_WORKER_TOKEN`), owner routes `GET|POST /api/v1/hives/{id}/reports`, `GET …/reports/{reportId}`; `server/reports/reports.ts`.
- **Contracts:** audience configuration, Study verifier (quotes, page hashes, `VERIFIED`/`UNVERIFIED`/`NOT_CALCULABLE`, claim catalog), Writer validator, deterministic scenarios, A2UI catalog and binder (`packages/contracts/src/analysis`, `reports`).
- **Planner:** tasks `study` (`PLANNER_STUDY_LITELLM_ALIAS`, approved `heavy_lifter`; replaced by the `study-agent-turn@1` loop in V4-004A) and `writer` (`PLANNER_WRITER_LITELLM_ALIAS`, approved `harvester`), fail closed when unset; 270 s model timeout.
- **UI:** `AnalyzeModal` (documents to read, gaps, eight stages, report rows, **Open reports**), Reports tab `ReportsPanel` (Customer/Pro, status, **Generate again**, history), `components/a2ui/*` (13-component registry, scenario explorer, charts, source chips, status badges).
- **B5 coverage (founder review 2026-11-02, D-041 item 8):** Analyze is not blanket consent. Successful reads proceed; acknowledgements are stored per gap in `hive.coverage_acknowledgements` and reused; newly found material gaps pause the same run in `AWAITING_ACKNOWLEDGEMENT` until the owner continues (`POST /api/v1/hives/{id}/study-preparation/acknowledge`, RPC `acknowledge_study_coverage`); nonmaterial gaps proceed as visible limitations; reason, coverage status, gaps and acknowledgement persist on the run and Study revision; completed reads are not restarted.
- **Orchestration (2026-11-02, immediate dispatch):** Analyze is the only UI trigger. Each completed stage schedules the next through Next.js `after()` → `POST /api/internal/workflow` (bearer `HIVE_INTERNAL_WORKER_TOKEN`), with in-process fallback when self-HTTP fails. Delayed read polling and model retry backoff schedule the same route (no recurring Cron). UI polling is status-only. Database leases (`claim_processing_run` / `claim_report_run`) remain authoritative when duplicate dispatches arrive.
- **Migration (not applied):** `supabase/migrations/20261102150000_analysis_workflow.sql` — new run statuses and stage attempts, coverage classification and acknowledgements, `canonical_studies`, `study_revisions`, `report_runs`, `reports`, worker RPCs, owner report RPCs, optional manual `dispatch_due_work()` (no Cron schedule). **`20261102153000_disable_hive_workflow_cron_dispatcher.sql`** — separate production apply to unschedule `hive-dispatch-due-work` if an earlier apply created it; does not re-run the full workflow migration.
- **Database verification (isolated, 2026-11-02):** all 13 migrations applied to a fresh local PostgreSQL 17 with pgTAP 1.3.3 and stub `pg_net`/`pg_cron`/`supabase_vault` (harness outside the repo; not Supabase itself): `analysis_workflow` 83/83, `document_reads` 30/30, `study_preparation` 53/53. Upgrade simulation (legacy rows created through the `20261102120000` RPCs, then `20261102150000` applied): backfill, no invented acknowledgements, trigger re-enabled, and an in-flight legacy run is taken over only after its old lease lapses — 7/7. `20261102120000` is in `origin/main` (`09266e9`); whether it is applied to the hosted project is **unverified** (run `HiveForYou-deploy-migrations.yml` with `run_mode=report`).
- **Prompt edits (founder-requested):** `hive-intent/1`, `hive-intent-intelligence/1`, `hive-plan/1`, `hive-study-preview/1` + schema; new `hive-writer/1` — see `HiveForYou-PROMPTS-AND-CONTRACTS.md`.
- **Verification (2026-11-02, after B5):** contracts 162 tests, web 277 tests, planner pytest 33 — all pass; typecheck pass; lint 0 errors (2 pre-existing warnings in V3-vault storage); production build pass (run in an isolated copy because a local `next start` held `.next`).
- **Failure diagnostics (2026-11-02, local, uncommitted, not deployed):** `planner-error@1` now carries `diagnostic_reason`, `component`, `operation`, `processing_run_id` and `task`. Vercel keeps that reason instead of rewriting every planner failure to `planner_unavailable`. Failed runs store `failure-diagnostic@1` (task, stage, component, reason, retryability, attempt, and `diagnosticField` for schema errors). Owner lookup: `GET /api/v1/hives/{hiveId}/diagnostics?correlationId=…`. Migration `20261102170000_failure_diagnostics.sql` is **not applied**. No paid model run.
- **Study structured-output schema (2026-11-02, local, uncommitted; removed by V4-004A, D-042):** with `PLANNER_STUDY_STRUCTURED_OUTPUT=json_schema` (still off by default) `v4-planner` sends a compact, nonrecursive projection of `hive.study-investigation/1` built by `infra/oracle/study_investigation_schema.py`: only `type`/`properties`/`required`/`additionalProperties`/`items`/`enum`, evidence inlined, `formula` an optional fixed three-level structure; 4.5 KB, no unions or `$ref`. Format, pattern, length, minimum and `minItems` constraints are omitted from the provider schema only (pinned list in `test_study_investigation_schema.py`); the canonical schema file and `verifyStudyInvestigation` are unchanged and enforce them. Unknown canonical keywords fail closed. The probe sends the planner's exact `response_format`. No paid probe run yet.
- **Approval stops:** applying `20261102120000`, `20261102150000`, `20261102170000_failure_diagnostics.sql`, and (on hosted Supabase if needed) `20261102153000_disable_hive_workflow_cron_dispatcher.sql`; Vercel `HIVE_INTERNAL_WORKER_TOKEN`; redeploying `v4-planner` with both aliases, the diagnostic envelope and the longer proxy timeout; adding `heavy_lifter` / `harvester` to the scoped LiteLLM key; optional Vault secrets only if manual `dispatch_due_work()` recovery is desired; the first paid run (synthetic Maya); commit.

## Paused ticket — V4-003 (awaiting live verification)

**Objective:** Owner can attach supported documents to a Hive through a honest prepare → private upload → server registration flow, with Free monthly quota, malware hash scanning policy, and written intent captured at Hive creation in the primary UX.

**Context (verified in repository, not deployed):** V4-001 (application shell, observability) and V4-002 (Supabase Auth, My Hives, Hive CRUD via Edge Function, owner RLS on `hive.hives`) are implemented in Git history. V4-003 work exists as **uncommitted** application code, contracts, SQL migration, and Edge Function handler; **migration and `v1-source-documents` are not deployed**; **end-to-end authenticated uploads against a live project are not yet verified**.

**Completed in working tree (proposed, pending ticket closure):**

1. **D-026 / D-027 / D-036** reflected in contracts, migration comment, V3 Vault upload adapter, and UI adoption mapping (see `HiveForYou-DECISIONS.md` and `HiveForYou-UX-A2UI-DESIGN.md` §17).
2. **V3 Authentication reused as-is:** `apps/web/src/server/auth/auth-actions.ts` delegates directly to V3's `apps/web/src/lib/auth/*` (`session-actions.ts`, `otp-actions.ts`, `recovery-actions.ts`, `action-outcome.ts`) without changing user sessions, cookies, or login behavior.
3. **V3 Vault Document Uploader reused as-is:** `apps/web/src/server/source-documents/hive-vault-upload-adapter.ts` connects V4 Hive identity (`hive.hives`) 1:1 to V3's `Case` contract (`caseId === hive.id` via `createCase`), runs the pre-registration SHA-256 malware hash scan and 10/month quota check, and invokes V3's `registerSourceDocument` and `reconcileUploadOperation` unchanged against private bucket `hive-source-documents`.
4. **Surgical DOCX addition in `@hives/security`:** `files.ts` and `page-count.ts` accept `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`, PK ZIP + `word/document.xml` magic-byte check) alongside PDF, PNG, and JPG up to 25 MB.
5. **One shared `HiveComposer` (D-037):** Landing and the Create Hive dialog use the same composer — intent textarea, paperclip, removable document chips, single **Create Hive**. Signed-out visitors keep a guest draft through sign-up; signed-in owners create directly.
6. **Create Hive flow (`create-hive-flow.ts`):** validates intent (1–2000 chars) and at least one uploadable PDF/PNG/JPG/DOCX (≤ 25 MB); generates a provisional Hive name from the intent; runs `createHive` → `createIntentRequest` → `uploadSelectedSourceFiles` as named stages with per-stage errors and support reference; completed stages are skipped on retry.
7. **Documents tab `DocumentsPanel` (D-036 prototype alignment scope):** list, quota display, drag-and-drop + button upload with status states (uploading, registered, failed), and inventory table layout mapped from `prototype/HiveForYou V4 Prototype.dc.html` (`isDocs`) without synthetic sample loaders, coverage matrix (`hasMatrix`), or page viewer (`hasViewer`).
8. **Migration `20261030150000_create_source_documents.sql`:** `hive.intent_requests`, 1:1 `hive.cases` (`FOREIGN KEY (id, owner_user_id) REFERENCES hive.hives (id, owner_user_id)`), V3's `hive.source_documents`, `hive.upload_operations`, `hive.audit_events`, `hive.storage_orphans`, `hive.apply_vault_transaction`, private `hive-source-documents` bucket, and monthly quota RPC. No second signed-upload or custom registration Edge Function (`v1-source-documents` retired).
9. **Focused tests:** source-document contracts, client upload batch orchestration, V3 Vault upload adapter (1:1 Case creation, PDF/DOCX registration, idempotent `clientRequestId` replay via `reconcileUploadOperation`, owner isolation, malware/magic-byte rejection, and 10/month quota).

10. **Restored API routes (2026-11-01):** `api/v1/hives/[hiveId]/intent-requests`, `api/v1/hives/[hiveId]/source-documents` (GET list, POST multipart upload) and `api/v1/upload-quota`, wired to the existing adapter. These were removed by an earlier `git clean` before commit `d7137c0`, so commits up to `7f48779` call routes that do not exist.
11. **Read Documents (2026-11-01, D-038):** Documents tab **Read Documents** button (enabled when a registered document is `PENDING`/`FAILED` and no read is active) → `POST /api/v1/hives/{id}/document-reads` (authenticated owner; `start_document_reads` queues one durable `hive.document_reads` attempt per eligible document, idempotent on `clientRequestId`) → Next.js `after()` runs the V4 Reader adapter with a Supabase lease → `put_document_pages` → `list_document_pages` readback + hash/digest verification → terminal status. Statuses `QUEUED · READING · SAVING · VERIFYING · SUCCEEDED · PARTIAL · UNREADABLE · FAILED`; the database refuses `SUCCEEDED`/`PARTIAL` unless the verified page rows exist. `ReadDocumentsModal` (V3 processing-modal pattern, V4 brand) polls `GET …/document-reads` every 3 s only while a read is active; closing, refreshing or reconnecting resumes from the durable rows. Reader-only contracts moved to `@hiveforyou/contracts/document-read` so `node:crypto` stays out of middleware/client bundles.

**Preview failure diagnosis (2026-11-01, `Could not save what you need`):**

- **Failing operation:** `createIntentRequest` → `POST /api/v1/hives/{id}/intent-requests`. `createHive` succeeds first, so each failed attempt leaves one Hive with no intent or documents (existing records left untouched).
- **Response:** HTML `404` from Next.js `/_not-found` (verified on `hiveforyou-v4.vercel.app`; the branch Preview is behind Vercel Authentication and built from the same commit). `parseApiJson` cannot read JSON and substitutes the fallback message with `PERSISTENCE_FAILED`. The correlation ID is generated in the browser per request and echoed by middleware; no route handler runs, so no server log line exists for it.
- **Blockers behind the route fix (unverified against the live project — no credentials available locally):** migration `20261030150000` (`public.create_intent_request`, `public.get_upload_quota`, `hive.cases`/`source_documents`/…, bucket) is recorded as not applied; the V3 Vault adapter calls PostgREST `schema("hive")` with the service key, but `hive` is intentionally unexposed (config + tests), which would return `PGRST106`; `SUPABASE_SECRET_KEY` must exist in Vercel; Vercel Functions reject request bodies over 4.5 MB, below the 25 MB upload limit; the live adapter has no persistent `clientRequestId` registry, so a lost-response retry can register a duplicate document.
- **Documents tab:** committed `documents/page.tsx` renders the static "No documents yet" empty state, not `DocumentsPanel` (item 7), so registered uploads would not be shown.

**Explicitly deferred (still V4-003 scope boundaries or later tickets):**

- ~~Document reading~~ — moved into V4-003 (item 11). Still deferred: a durable job queue beyond `after()` + lease, and reading documents larger than one 300 s function invocation allows.
- **Source page viewer** (F-007 physical-page navigation).
- Frontier extraction, verification, Study acceptance (V4-005+).

**Excluded:** Applying SQL to a live Supabase project, deploying Edge Functions, production VirusTotal keys, PDF/DOCX parsing libraries, Canonical Study, reports, A2UI dynamic Study, paid model usage.

**Verification / done when (for V4-003):**

- Founder approves and migration is applied to the V4 Supabase project; `v1-source-documents` deployed; web app configured for that project.
- Signed-in owner: landing or My Hives → Create Hive with intent + file → at least one document reaches **REGISTERED** with stored hash and scan status; quota decrements honestly; rejected type/size/malware/quota paths fail closed without false “done”.
- Idempotent client request IDs replay safely; unauthorized cross-Hive access denied.
- Documents tab reflects registration and read states; no claim of Study content.
- Founder approves and migrations `20261101190000_create_document_pages.sql` and `20261101200000_create_document_reads.sql` are applied; Vercel has `READER_BASE_URL`, `READER_SERVICE_TOKEN` and `SUPABASE_SECRET_KEY`; the Oracle Reader is reachable over HTTPS.
- Clicking **Read Documents** on a synthetic document starts genuine reading; the modal shows the recorded statuses; `SUCCEEDED` appears only after pages are read back from `hive.document_pages` and verified; repeated clicks create no duplicate attempt; a failed attempt can be retried; `supabase test db` (`supabase/tests/database/document_reads.test.sql`) passes locally.
- Automated tests for touched packages still pass; `git diff --check` clean on documentation.
- Report exact files, commands, and live-test evidence; submit for ticket closure.

## Next tickets (parked, not simultaneously active)

Renumbered 2026-11-01 when Analyze / Prompt Preview became V4-004 (D-039).

| Ticket | Scope | Unlock |
|---|---|---|
| V4-005 | Pack-free `hive-extract/1` one real synthetic document; bounded pages, candidate JSON and statuses | After V4-003 and V4-004 closure; approve model route/cost |
| V4-006 | Independent candidate verification, immutable accepted Study revision, source chip to original page | After V4-005 |
| V4-007 | Intent analysis from pinned Study; dynamic validated A2UI section in Study | After V4-006 |
| V4-008 | Independent Customer/Pro report runs and history; prior good results survive failure | After V4-007 |
| V4-009 | Add documents / multi-intent incremental merge and full coverage test (receipt 20→30, eight-document synthetic L001) | After V4-008 |
| V4-010 | Retention/account deletion, permissions/security verification and sensitive-data readiness gates | Before sensitive-data rollout |

**Completed tickets (closed in Git, not re-opened here):** V4-001 application foundation; V4-002 authentication and owner Hives.

**Parking lot:** Real-world provider data/BAAs; tokenization mechanics; alternative durable executor; professional cross-user permissions; export format/pricing; optional Domain Packs; historical V3/P2.3/P3.1 migrations; V3→V4 data migration; deep semantic domain rules; analytical track V4-A01–V4-A07 (see `HiveForYou-DEVELOPMENT-PLAN.md`). V4-004M (Study agent execution policy) and V4-004L (Corpus Reconciliation Gate), superseded by D-052.


## Parked as superseded by D-052 (2026-11-05)

V4-004M and V4-004L are not the active ticket. Their local implementations remain; this move is documentation only.

## Parked ticket — V4-004M Study agent execution policy (superseded by D-052)

**Objective:** Relax operational Study-agent budgets and guidance so an L001-shaped eight-document / seven-question investigation can finish within infrastructure limits, without weakening exact-quote validation, source authorization, atomic finding grounding, or the Corpus Reconciliation Gate (D-050).

**Scope (D-051):**

1. **Hard ceilings (`packages/contracts/src/analysis/study-agent.ts`, `STUDY_AGENT_BUDGET`):** 275 s wall clock, 145 s max turn, 32 rounds, 320 tool calls, 28 invalid-turn strikes, 32 calls/turn, 900k/64k tokens, USD 12 cost ceiling — each at or below Vercel/lease 300 s, TLS proxy 290 s, planner turn 240 s, and wire max 32 tool calls.
2. **Scaled allowances (`studyAgentAllowance`):** rounds, tool calls and invalid strikes grow with question count and document count under those ceilings (includes D-050 reconciliation headroom).
3. **Quote rejections (`study-verification.ts`, `study-agent.ts`):** typographic punctuation folding only; paraphrases, unread pages and unauthorized documents still fail; truncated-read and search-snippet guidance in tool errors.
4. **Batching and dependency order (`study-prompt-builder.ts` section 8, `study-investigation.ts` START/NUDGE):** per-turn batching at the 32-call cap; unchanged tool set and Writer.
5. **Verification:** `study-agent-budget.test.ts` (infrastructure ordering, L001 allowance regression, cost ceiling, quote provenance); updated `study-agent*.test.ts` and `study-investigation.test.ts`.

**Implementation status (2026-11-05, local working tree, uncommitted):**

- **Contracts:** `study-agent.ts`, `study-verification.ts`, `study-agent-budget.test.ts`; allowance and budget test updates.
- **Web:** `study-investigation.ts`, `study-prompt-builder.ts` (section 8 only; `hive-study-preview/1` template digest unchanged).
- **Verification (2026-11-05):** `npm test` — contracts **348** tests (27 files) and web **373** tests (47 files), all passed; `npm run typecheck` passed; `npm run lint` 0 errors (2 pre-existing warnings); `npm run build` passed; `git diff --check` clean. Quote provenance covered in `study-agent-budget.test.ts` (paraphrase, unread page, unauthorized document).
- **Approval stops:** deployment, live Analyze or Rebuild, paid model run, commit, push.

**Done when:** founder reviews this local implementation and verification; after a separately approved run, L001 Rebuild either completes a new reconciled revision or fails closed with adequate budget headroom while revision 6 and its reports remain.

**Remaining timing risk:** one `INVESTIGATING` invocation still runs the full tool loop plus verification within the same 300 s lease; heavy verification or slow planner turns on the last seconds can still exhaust wall clock before `finish_study`.

## Parked ticket — V4-004L Corpus Reconciliation Gate (superseded by D-052)

**Objective:** A new Canonical Study cannot finish until every authorized document is classified and given a disposition, and every investigation question states what evidence it needed and whether it was found. The same deterministic rules apply in `StudyAgentLedger` and `verifyStudyInvestigation`, for every new Analyze and Rebuild run. Older accepted revisions, including revision 6 and its reports, are not reinterpreted.

**Scope (D-050):**

1. **Shared rules (`packages/contracts/src/analysis/corpus-reconciliation.ts`):** document classification (`UNDETERMINED` only with `UNCERTAIN`), dispositions (`MATERIAL_FINDINGS_RECORDED`, `NO_MATERIAL_FINDINGS`, `UNRESOLVED`), evidence needs (`FOUND`, `NOT_FOUND`, `UNCERTAIN`, `NOT_REQUIRED`), corpus inventory, and the deterministic unresolved-document coverage note. Open vocabulary; no domain or document taxonomy.
2. **Ledger (`study-agent.ts`):** existing tools only. `finish_question` requires `evidenceNeeds`; `finish_study` requires `documentReconciliations` for every document in one call and is non-mutating on rejection; `record_document` accepts an evidence-free `UNDETERMINED` record after a read (or for a blank document); allowance scales with document count under the hard ceilings in D-051.
3. **Verifier (`study-verification.ts`):** integrity of any present reconciliation and evidence needs; completeness, and visible `UNRESOLVED` coverage notes, when `requireCorpusReconciliation` is set. `analysis-workflow.ts` sets it for every new run.
4. **Prompt and contract:** `hive-study-preview/1` sections 4 and 7, the code-owned section 8 (`study-prompt-builder.ts`), `START_MESSAGE` / `NUDGE_MESSAGE`, tool descriptions, and optional `documents[].reconciliation` / `answers[].evidenceNeeds` in `hive.study-investigation/1`.
5. **Verification:** all documents accounted for; omitted `SUPPORTING` / `REFERENCE` rejected; missing and unsupported evidence needs; valid `NO_MATERIAL_FINDINGS` / `UNRESOLVED`; forged and cross-document `DF…` ids; blank documents; partial reads; a synthetic L001-shaped eight-document corpus; a non-IEP corpus (lease and invoices); a hand-built output bypassing the ledger; legacy and revision-6-shaped outputs accepted without the flag and rejected with it; an unreconciled in-flight Analyze or Rebuild fails at `VERIFYING_EVIDENCE` without `accept_study_revision` or Writer dispatch.

**Implementation status (2026-11-04, local working tree, uncommitted):**

- **Contracts:** new `corpus-reconciliation.ts` (+ `corpus-reconciliation.test.ts`, `study-agent-reconciliation.test.ts`); `study-agent.ts`, `study-verification.ts`, `execution-manifest-contracts.ts`, `index.ts`; synthetic fixtures in `testing/maya-fixture.ts` now record and reconcile every document.
- **Web:** `analysis-workflow.ts` (`requireCorpusReconciliation: true`), `study-investigation.ts` (messages, document-scaled allowance), `study-prompt-builder.ts` (section 8). Writer, Oracle and SQL unchanged.
- **Prompt and schema:** `hive-study-preview/1` template digest `sha256:ece27769…a259d5`; `hive.study-investigation/1` schema digest `sha256:245873ec…6e440` (optional fields only).
- **Verification (2026-11-04):** `npm test` — contracts 340 tests (26 files) and web 373 tests (47 files), all passed; `npm run typecheck` passed; `npm run lint` 0 errors (2 pre-existing warnings); `npm run build` passed; `git diff --check` clean. No database test applies (no SQL change).
- **Approval stops:** deployment, live Analyze or Rebuild, paid model run, commit, push.

**Done when:** founder reviews this local implementation and verification; after a separately approved run, a new L001 Rebuild either accounts for all eight documents or fails closed while revision 6 and its reports remain.

**Rule:** One ticket only. Significant work follows **inspect → plan → approve → implement → verify success/failure → synchronize documents/rules → close**. No commits, pushes, deployments, SQL migrations, destructive data changes, or paid calls without authorization.

## Analytical Intelligence parking-lot note — 2026-10-31

Product requirements **R65–R84** and features **F-045–F-064** add **proactive analysis discovery and scenario what-if** to the long-term V4 product direction. Decisions **D-028–D-035** record that product direction. This documentation change does **not** authorize code, schema, background jobs, LLM calls, or a new active ticket. Preserve the single active ticket (now **V5 pipeline simplification**). Proposed future sequence **V4-A01–V4-A07** requires explicit ticket activation after prerequisites are met.
