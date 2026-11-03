# HiveForYou V4 — Development plan

**Version:** 0.3 | **Status:** Execution roadmap; **V4-001 and V4-002 closed in Git**; **V4-003 active with local uncommitted implementation**; later tickets parked. | **Date:** 2026-10-31

## Development objective

Build the smallest real, pleasant **Documents → Study → Reports** experience with `hive-extract/1`, independent evidence checks, a persistent evolving Study and rich validated A2UI. V4 is actively in development and **not in production**. Keep a single active ticket in `HiveForYou-NEXT.md`; don't block basic product progress on historical V3 qualification or hypothetical scale features.

## Standards

- New repo `hiveforyou-v4`; V3 is read-only reference, no V3 source/migration copied reflexively.
- Program logic portable and TypeScript-first; Next.js/Vercel and Supabase are proposed. Durable job executor is a separate decision when needed.
- Domain Packs are never required for ordinary extraction. `hive-extract/1` is the authoritative user prompt, `hive.doc-extraction/1` is target candidate contract, `hive-prep/1` is external one-pass IEP testing.
- No new feature-specific flags/config vars, clone pipelines or premature distributed services. A single approved model interface and only necessary deployment secrets.
- User-approved changes only; authorization separately required for Git pushes, deployments, SQL migrations, paid model runs and sensitive documents.
- Each functional slice tests success and most relevant failure behavior; no automatic claiming completion based on compilation.

## Phases and tickets (dependency-order, one active at a time)

| Phase / ticket | Work | User-visible proof | State |
|---|---|---|---|
| P0 · V4-001 | New repo, code scaffold, brand-faithful stable application shell | Documents, Study, Reports tabs and true empty states locally | **DONE** (Git) |
| P1 · V4-002 | Auth/My Hives/Create Hive + owner-only RLS, idempotent creation | User signs in, creates own Hive; cannot access another owner's Hive | **DONE** (Git) |
| P1 · **V4-003** | Private file upload, registration, quota, intent at create; **read/view deferred** | Authenticated owner registers synthetic PDF/PNG/JPEG/DOCX; quota/malware/type failures honest; **not** page viewer yet | **PAUSED** — local code incl. Read Documents; migration deploy and live upload/read verification pending |
| P2 · **V4-004** | Analyze / Prompt Preview (D-039): intent decomposition, generic domain proposal, investigation plan and versioned Canonical Study prompt via Oracle planner (`sorter`) | Owner clicks Analyze after reads and reaches a persisted Prompt Preview labelled *Prepared — Canonical Study not yet executed*; extended end-to-end to an accepted Study and both reports (D-041) | **PAUSED** — implemented locally; migrations, deployment and the first paid run pending |
| P2 · **V4-004A** | Agentic Canonical Study (D-042): bounded tool-calling investigation over the case-wide page corpus via `study-agent-turn@1`; trusted ledger, exact assembly, unchanged verifier | Synthetic Maya run reaches an accepted Study through the loop with recorded calls, tokens and cost; budget failure never becomes missing evidence | **PAUSED** — implemented locally; `v4-planner` rebuild and first paid run pending |
| P2 · **V4-004B** | Writer reliability and evidence precision (D-043): `hive-writer/1` block/claim-kind rules, delayed report retry dispatch, specific granular A2UI provenance, assessment `criterion`/`criterionSource` labeling, deduplicated narrative composition | Customer and Pro reports validate, retry on backoff when needed, cite specific facts per row/event/checklist item, label general-knowledge criteria without quoting fact statements, and avoid duplicate sections | **PAUSED** — implemented locally; live paid run pending |
| P2 · **V4-004C** | Optimize agentic Study investigation (D-044): case-wide five-phase batching across `P1`–`Pn`, shared `E…` evidence rules, safe budget progress diagnostics | 6-question Maya investigation completes in 5 batched turns within the 18-round budget | **PAUSED** — implemented locally; live paid run pending |
| P2 · **V4-004D** | Agentic Writer with immediate validation (D-045): five-tool `WriterAgentLedger` over `study-agent-turn@1` (`task: "writer"`), shared block/scenario/A2UI validators, targeted in-turn repair, unchanged `hive.writer-report/1` and `buildReport()` | Customer and Pro reports complete cleanly or recover from a rejected block/component without regenerating accepted sections | **PAUSED** — implemented locally; live paid run pending |
| P2 · **V4-004E** | Resumable Analyze and Report Reuse (D-046): compatible Study revision resolution (`20261102180000`), per-audience report reuse and selective Writer dispatch | Clicking Analyze reuses compatible Study and existing reports; navigates directly to Reports when both exist | **PAUSED** — implemented locally; migration and live verification pending |
| P2 · **V4-004F** | Scalable Writer Agent and Dynamic A2UI (D-047): presentation planning (`hive.writer-presentation-plan/1`), structured content generation (`compose_writer_report`) and targeted unit correction (`apply_writer_correction`), deterministic `WriterCompiler` + `buildReport()`, privacy-safe observability | Customer and Pro reports dynamically compose approved A2UI components, repair only rejected units, and persist against the accepted Study revision | **ACTIVE** |
| P2 · V4-005 | Frontier pack-free extraction `hive-extract/1`, versioned candidates, bounded pages | Real synthetic receipt produces honest `hive.doc-extraction/1` candidate JSON | PARKED |
| P2 · V4-006 | Verify evidence, candidate trust dispositions, merge accepted revision | Source page chips work and one verified Study is accepted; bad quote rejected | PARKED |
| P3 · V4-007 | Study intent analysis and one dynamic A2UI slot | Two questions yield different validated views of same pinned Study | PARKED |
| P3 · V4-008 | Customer/Pro report runs, history and pinned revisions | New Generate creates new report; failure doesn't erase prior accepted result | PARKED |
| P4 · V4-009 | Incremental sources, conflict/currentness, full-scope and targeted extraction | Add 10 receipts to 20 in same Hive; eight synthetic L001 docs; reuse Study | PARKED |
| P4 · V4-010 | Sensitive-data readiness and account/Hive deletion/recovery mechanics | Synthetic negative cases, authorized cleanup, complete safe retention policy | PARKED |

## Ticket template (mandatory for Cursor)

1. **Ticket:** ID from `HiveForYou-NEXT.md`; only that active ticket.
2. **Objective:** one observable customer or engineering result.
3. **Context:** governing approved docs and actual local state.
4. **Scope:** exact operations/files after inspection; explicit exclusions.
5. **Constraints:** one path, no new configs without approval, no private data leakage, preserve unrelated changes.
6. **Implementation:** minimal functions/components/SQL contract to reach output.
7. **Error handling:** likely edge and negative paths at relevant boundaries.
8. **Observability:** safe stage/code/IDs only, appropriate for development.
9. **Verification:** runnable commands, local/browser demonstration and failure cases.
10. **Done when:** actual observable checks, not just green compilation.
11. **Report:** changed files, results, known gaps, affected docs and authorization needed.

**Workflow:** Inspect actual files → propose read-only plan → obtain approval → implement approved scope → verify positive and failure paths → synchronize documents, decisions, rules and NEXT → close. No auto-advance to next ticket.

## Integration/acceptance scenarios (not separate bureaucracy)

| Scenario | First relevant ticket | Expected proof |
|---|---|---|
| One synthetic receipt unknown to the code | V4-005/006 | Dynamic model candidates; verified fact trace to correct page and row |
| Two different questions and views | V4-007 | Same pinned Study; different grounded A2UI; no silent re-extraction |
| Report revision independence | V4-008 | Unique run, pinned inputs, accepted earlier output survives failure |
| Receipt corpus twenty → thirty | V4-009 | Incremental coverage and source identities maintained; known/unknown clear |
| IEP eight docs L001 | V4-009 | Chronology/goal/service provenance; no unsupported currentness/legal findings |
| Wrong owner, injected instructions, wrong quote, partial page | Each boundary's ticket | Denied/rejected/explicit incomplete; no accepted trust state changes |
| Regulated sensitive inputs | V4-010 or earlier gate if attempted | Stop until provider, contracts, tokenization/data-use policy approved |

## Decision gates before specific tickets

- **V4-002:** use an independent V4 Supabase project/schema; approve SQL and RLS separately. No V3 live migration.
- **V4-003:** malware hash-scan policy and registration RPC are **decided in D-027** and implemented locally; founder must still **approve migration deploy**, Edge deploy, and optional VirusTotal secret. **Page reading, OCR, and viewer** remain a gate before claiming F-007; choose read libraries and physical-page semantics then.
- **V4-004:** gateway route decided in D-039 (Oracle `v4-planner` → private LiteLLM `sorter`); founder approves the migration, scoped virtual key, Oracle deployment and the first paid `sorter` run separately.
- **V4-004A:** founder approves the `v4-planner` rebuild/redeploy with `/v1/study-agent-turn`, the first paid agentic `heavy_lifter` run (budget ceiling USD 8 per Study attempt, D-042) and the commit separately.
- **V4-004B:** founder approves deployment, the live paid Writer run (`harvester`, D-043) and the commit separately.
- **V4-005:** approve frontier provider/gateway, structured JSON interface, costs, private-content policy, prompt contract clarifications; authorize paid synthetic test separately.
- **V4-006:** approve verifier checks and data model; explain evidence quote acceptance vs real-world truth.
- **V4-007:** pick supported A2UI wire schema/React integration, allowlist and model-safe actions.
- **Before large corpora:** validate backend runtime/durable execution and interruption recovery within actual limits.
- **Before real personal documents:** resolve `HiveForYou-SECURITY-AND-PRIVACY.md` safeguards and applicable provider/BAA/consent requirements.

## Source-of-truth sync at ticket close

Update as affected: `HiveForYou-PRODUCT-REQUIREMENTS.md`, `HiveForYou-FEATURES.md`, `HiveForYou-ARCHITECTURE.md`, `HiveForYou-DATA-MODEL.md`, `HiveForYou-UX-A2UI-DESIGN.md`, `HiveForYou-PROMPTS-AND-CONTRACTS.md`, `HiveForYou-NAMING-CONVENTIONS.md`, `HiveForYou-REPOSITORY-STRUCTURE.md`, `HiveForYou-DEVELOPMENT-PLAN.md`, `HiveForYou-NEXT.md`, `HiveForYou-DECISIONS.md`, `.cursor/rules/*.mdc`. Never rewrite the brand guide or user-approved prompt silently.

## Explicitly parked

Optional Domain Packs; cross-user professional membership; automated external filing; billing models beyond retained Free cap; source-data cross-Hive learning; broad infra rebuild; V3→V4 migration; large-scale multi-agent orchestration; claim of HIPAA operation; template-per-domain apps; release promotion/prod hardening (V4 is not in production).

## Future analytical capability track (2026-10-31; parked until current ticket closure)

The following are **proposed dependency-ordered future tickets, not active or approved implementation**. Preserve the single-ticket process in NEXT. Do not block earlier extraction → evidence → Study → basic view vertical slice for speculative analysis infrastructure.

| Proposed ticket | Minimal vertical proof | Gate |
|---|---|---|
| **V4-A01 Opportunity Discovery** | Accepted synthetic Study yields 2–5 deduplicated useful candidate analyses with cited fact IDs; wrong refs rejected | After accepted Study (V4-006); approve discovery contract/cost |
| **V4-A02 Trusted Analysis** | Execute one typed comparison/aggregation with reproducible result and source/method drilldown; unsupported option blocked | A01; validator/operator contracts |
| **V4-A03 Proactive Study UI** | Suggested, running, supported, blocked cards in approved A2UI slot; output/history pinned to revision | A02; component allowlist |
| **V4-A04 Scenario Overlay** | Hypothetical change compares to baseline without changing accepted fact values | A02; scenario contracts |
| **V4-A05 Dynamic Scenario Model** | LLM proposes dependency graph; generic verifier rejects invalid refs/units/cycles/rules; supported arithmetic runs | A04; quality threshold |
| **V4-A06 Optional Optimization** | One independently reviewed constrained problem compiled from safe model IR to approved solver and back; infeasible states explained | Demonstrated buyer need, cost and security approval |
| **V4-A07 Incremental/Quality** | Re-run changed analyses only; test usefulness, correctness, cost, safety across synthetic financial/IEP/insurance examples | Earlier analytical track verified |

**Minimum experiment before broad coding:** from one synthetic accepted Study, have the model propose analyses, select one useful plan, independently verify fact refs/method, run safe computation, and present a cited result. Track useful-opportunity precision, model-plan error rate, dollar cost and review time. Avoid expanding to full causal simulation before this is measured.
