# HiveForYou V5 — status and handoff

**As of:** 2026-11-11 evening | **Branch:** `main` (last pushed `249623a`; read-status fix patch pending, see "Next step") | **Companion docs:** `claude/HiveForYou-PIPELINE-SIMPLIFICATION-PLAN.md`, `claude/HiveForYou-CURSOR-PROMPTS-V5.md`, `HiveForYou-FEATURES.md` (v0.2), `docs/HiveForYou-DECISIONS.md` (D-055 no new triggers, D-056 report composition, D-057 summary chips)

## Where we are

V5 pipeline (Extract → Canonicalize → Write) is live and the bankruptcy case now works end to end.

| Test case | Result |
|---|---|
| no-anchor-household | ✅ (11-06) |
| special-ed-l001 (Maya) | ✅ study rev 1 (old gap format). **Rebuild pending** to get classified Missing documents |
| bankruptcy-c13 | ✅ **Study rev 4 (Opus, 11-09):** all 35 petition pages read; both planted conflicts found (arrearage $9,600 vs $12,180; Schedule I $4,850 no overtime vs $5,325); trustee objections tied to amended plan; schedules facts present |
| benefits-denial | Not run yet |

## Next step (first thing in the new session)

1. **Read-status regression (found 11-11):** migrations `20261109180000` / `20261110020000` rebuilt `list_hive_source_documents` from an old version that hard-codes `readStatus 'PENDING'` (all docs showed "Not read yet"). Fix SQL `20261112010000_list_source_documents_read_status.sql` was **run by hand in production (works)**; the repo patch `fix-list-read-status.patch` still needs `git apply` + commit + push.
2. **Maya's Hive → Rebuild study.** Expect Missing documents: ask now = PWN, exclusionary-factors review, parent input record, RTI data; later = progress reports, service logs; blank "Other (specify)" as an observation. Documents tab should show the Missing card with Upload buttons above the 8 documents.
3. **Slot-upload test on bankruptcy:** upload any PDF into the 2025 tax-return slot → "Added — rebuild to include" + banner on Study/Reports → Rebuild → only that gap drops.
4. Then **domain packs** (drafts written 11-09: `HiveForYou-Pack-chapter13-confirmation.md`, `HiveForYou-Pack-iep-initial.md`; prompt below). Founder to have the Chapter 13 pack reviewed by the bankruptcy attorney before relying on it.
5. Study tab title: use case name, show the request as "Your question" (option A, not yet sent).

## Done 2026-11-07 → 11-11 (root causes, in order)

- **PDF drawer:** two pdfjs-dist copies (API 5.4.296 vs worker 5.7.284) → single copy; then a reload loop (inline `file={{url}}`) → memoized. Quote highlight in the PDF text layer (escaped `customTextRenderer`).
- **Petition never read:** (a) file hash compared with/without `sha256:` prefix; (b) `trg_doc_extraction_attempts__bind_source` read `NEW.model_alias` on a table without it → every attempt insert failed silently (dropped trigger, check moved into `begin_doc_extraction_attempt`; D-055); (c) unread pages cached as empty extractions when the time budget ran out; (d) 60 s per-call floor → 90 s deadline, ≤3-page / ≤4,000-char ranges, regroup only unread pages, `CLIENT_DEADLINE`.
- **Stalls:** write-ahead hand-off, stall detection by `workflow_last_handoff_at`, re-dispatch (not fail), failure diagnostics, recovery sweeper route (Vercel cron daily on Hobby; manual = open the Hive page).
- **Workflow bookkeeping never saved:** `transition_processing_run` only accepts immutable stage outputs, so planner job ids and the zero-progress counter were rejected (`invalid_request`). New `patch_processing_run_workflow_state` RPC (`20261110010000`) is the only writer of `plannerJobs`, `extractZeroProgressHandoffs`, `extractGapRetryCompleted`.
- **Study build on Opus:** async planner jobs (`/v1/jobs`, `PLANNER_ASYNC_JOBS_TASKS=canonicalize` in Vercel); Dockerfile had to COPY `planner_jobs.py`. Slim canonicalize input (no quotes, deduped facts).
- **UX:** elapsed-time progress (no countdown); summary chips (D-057); Rebuild study button on Study tab; short document labels; **Missing documents** A2UI component (`DocumentRequestList`, D-056) with REQUESTABLE_DOCUMENT / FUTURE_RECORD / OBSERVATION and holder types; Documents-tab Missing card with upload slots; banners; stable gap-fill link (revision + id + title); legacy gaps shown as plain list; pipeline wording filtered.

## Infrastructure

- Quick tunnels (since 11-07): `PLANNER_BASE_URL=https://unix-earth-might-folding.trycloudflare.com` → 8083, `READER_BASE_URL=https://third-romance-early-reaching.trycloudflare.com` → 8082. Rebuild routine: `pkill -f 'cloudflared tunnel --url'`, two `nohup cloudflared tunnel --url …` lines, `grep -aho 'https://[a-z0-9-]*\.trycloudflare\.com' ~/tunnel-*.log`, update Vercel vars, redeploy. Do not reboot Oracle until a named tunnel exists.
- Oracle: `ssh -i "C:\Users\abhattacharyya\.ssh\ssh-key-2026-09-05.key" ubuntu@129.153.1.97`; repo `/opt/hiveforyou-v4`; `v4-planner.env` is not tracked by git. Canonicalize alias = `heavy_lifter` (Opus 4.6); extract/write = `harvester` (Sonnet 4.5).
- Vercel Hobby plan: crons once per day only. `CRON_SECRET` set.

## Deploy routine

1. Migration SQL by hand in Supabase **before** the code that uses it; paste whole files; never edit an applied migration.
2. When a migration rewrites an existing function, start from its **latest** definition (grep all migrations) — the read-status regression came from copying an old one.
3. Laptop PowerShell on `main`: `git add -A`, `git commit -m …`, `git push`; wait for Vercel Ready.
4. Oracle only if `infra/oracle` changed: `git pull`, `docker compose -f infra/oracle/compose.planner.yml up -d --build`, `curl -s http://localhost:8083/health`.
5. Before pushing: full web suite with `$env:NODE_OPTIONS='--max-old-space-size=8192'`, typecheck (both packages), clean build. A hanging test = a render/refresh loop in the app.

## Useful diagnostics

- Attempts: `select page_range, attempt_status, error_code, diagnostic_reason, aborted_by_our_deadline, duration_ms, call_started_at from hive.doc_extraction_attempts where source_document_id = '<id>' order by call_started_at;`
- Latest run: `select status, error_code, stage_attempt, failure_diagnostic, stage_outputs -> 'plannerJobs', updated_at from hive.processing_runs order by created_at desc limit 2;`
- Stuck runs: `select id, status, lease_expires_at, next_dispatch_at, updated_at from hive.processing_runs where finished_at is null;`
- Cost: `hive.pipeline_model_call_samples` (task, input_tokens, output_tokens, succeeded_at); timed-out calls are billed but not logged. Opus 4.6 $5/$25, Sonnet 4.5 $3/$15 per M tokens. Output dominates extract cost (quotes) — consider anchors instead of full quotes.
- Recovery as owner: `begin; select set_config('request.jwt.claims','{"role":"authenticated","sub":"<owner>"}',true); set local role authenticated; select public.recover_expired_workflow_leases('<hive>'::uuid); rollback;`

## Open items / cleanup

1. Domain packs (prompt below).
2. Report structure: answer each question in the request first; trustee-objection verdict table; code-computed feasibility arithmetic; Customer voice addresses the person.
3. Document labels: "13 bankruptcy plan" → "Chapter 13 plan (original/amended)"; "Mortgage arrearage amount" → "Cobalt Ridge letter".
4. `14-18` five-page range still produced somewhere (cap 3); our own deadline aborts still recorded as HTTP 504/503 (should be null); planner "job not found" uses `DEPENDENCY_UNAVAILABLE`.
5. Stage-attempt counter never resets after progress (3 crashed steps fail a progressing run).
6. Move LOGIC triggers (`sync_case_from_hive`, `document_pages` bind) into RPCs (D-055).
7. Named Cloudflare tunnel (needs a domain); then the Oracle reboot.
8. Earlier list: inference labels, gap/spine citations, anchor golden for no-anchor-household, red pgTAP tests, RLS line for `pipeline_model_call_samples`, audit_events repo parity.

### Domain pack prompt (Cursor)

```
Minimum domain packs (D-004 optional overlays; respect D-053 - no domain words in apps/ or packages/).
1. Packs are data: packs/HiveForYou-Pack-<id>.md (front matter: pack, version, title, matches.intent[],
   matches.documents[], status; body as in the two drafts). Add the drafts as-is.
2. Selection in generic code: score packs by case-insensitive matches of matches.intent against the request
   text and matches.documents against extracted document types/titles; top pack above a config threshold,
   else none. Record pack id + version via patch_processing_run_workflow_state (add key "domainPack" to its
   allowlist in a new migration). No model call for selection.
3. Pass the pack body as domainBrief to hive-canonicalize/1 and as "specialistChecklist" to hive-write/1, with
   one domain-blind rule: use it to decide what to check, which documents are usually needed and the answer
   order; never state anything about the case that cited facts don't support; an unsupported checklist item
   becomes a gap or question. "Documents usually needed" rows feed gap classification (holder, now/later).
4. UI: "Reviewed with: <pack title> (v<version>)" on Study/report header; "Rebuild without checklist".
5. Eval bankruptcy-c13 and special-ed-l001 with and without packs (golden scores, planted issues, gap counts
   by kind, tokens, cost).
Full tests (8 GB), typecheck, clean build. Do not commit.
```

## After that

Prompt 9 (V5-006): remove the old pipeline once all four cases pass. Then F-025 / F-026 / F-027 (F-027 send flow needs security sign-off).
