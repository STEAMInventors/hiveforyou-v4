# HiveForYou V4 — System architecture

**Version:** 0.3 | **Status:** Logical architecture; V4-001/002 implemented; V4-003 upload/register path implemented **locally**, **not deployed** to a live Supabase project. | **Date:** 2026-10-31

## 1. Principles

- **One Hive → one evolving Canonical Study → many independent intent analyses/reports.** The Study is accepted evidence-backed knowledge, not model chat history.
- **Pack-free by default:** `hive-extract/1` is intent-independent, accepts one document/page range, returns untrusted `hive.doc-extraction/1` candidates. No mandatory domain schema/Pack. `hive-prep/1` is standalone IEP one-pass testing only.
- **Application-first:** fixed Documents/Study/Reports navigation, approved brand, model-proposed dynamic A2UI only inside validated component slots.
- **One processing design:** one library of server-side functions; run on an appropriate backend without duplicating an Oracle or an in-browser extraction engine.
- **No source, no claim:** a JSON output is not proof. Independently verify candidate quotations, page/subject/value relationships, structural constraints, and coverage before trusted acceptance.
- **No new configuration variables for each feature.** One model-access boundary and minimal necessary secrets; choose actual provider/deployment settings by approval, not fictitious examples.
- V4 is a **development project**, not production. Build thin working slices with synthetic documents; keep security and correctness checks meaningful and proportional.

## 2. Proposed topology

```text
User browser
   │  HTTPS / authenticated
   ▼
Next.js / Vercel  ── stable shell + API routes, access checks
   │
   ├─ Supabase Auth ── owner identity
   ├─ Supabase Storage ── private original documents / authorized read derivatives
   ├─ Supabase Postgres `hive` ── source metadata, runs, candidates, verified facts,
   │                              one Study/current revision, analyses, reports
   └─ Server-side workflow functions (portable TypeScript)
         ├─ readDocument (PDF/text/OCR/DOCX pages, quality, physical page)
         ├─ protect sensitive text, if approved (tokenization policy gate)
         ├─ extractDocument (`hive-extract/1` via one approved frontier-model adapter)
         ├─ verifyEvidence (independent page/quote/value/context/coverage)
         ├─ mergeStudy (versioned supported relationships and conflicts)
         ├─ analyzeIntent (pinned revision + permitted targeted source retrieval)
         ├─ composeView (validated A2UI JSON → allowlisted React components)
         └─ generateReport (Customer/Pro view, saved unique reportRunId)

For jobs exceeding Vercel execution limits → OPEN decision: use durable job execution,
retaining exactly these portable libraries, contracts and database state transitions.
```

**No Inngest, Oracle Worker, Python Reader, or deployed LiteLLM service is an assumed V4 prerequisite.** The founder is choosing a fresh architecture. The frontier gateway/provider remains an explicit pending technical and data-use choice; never call a model directly from the browser. Vercel function duration, file conversion tooling and multi-document reliability must be evaluated with actual constraints before accepting 20–30 file jobs.

## 3. Logical data flow and stage boundaries

| Stage | Input | Output | Owner of trust |
|---|---|---|---|
| Register | Signed-in user, Hive ID, file | Immutable private source identity, hash, metadata and upload receipt | Server authorization + database |
| Read | Authorized original | Physical pages, text/visual anchors, content/coverage digest, unreadable status | Server reader logic |
| Protect (conditional) | Approved sensitive page content | Transformed representation + separately secured reversible token map, if chosen | Security boundary; never model |
| Discover | One source/page range, prompt `hive-extract/1` | Strict `hive.doc-extraction/1` untrusted candidate JSON, quote/page and coverage | Frontier model proposes only |
| Parse/verify | Candidates and independently stored page evidence | Verified/unresolved/rejected dispositions + reason codes | Trusted pure Core + server authorized fetch |
| Merge | Accepted verified observations, previous current Study | Proposed then atomically accepted immutable Study revision | Server transaction and deterministic validation |
| Analyze | User intent + pinned revision | New intent analysis with findings, limits and citations | Model proposes; code checks refs and safe calculations |
| Compose | Authorized analysis + audience | Declarative A2UI spec, validated against allowlist | Trusted server/React renderer |
| Save report | Validated analysis/view + unique report run | Immutable report/history entry tied to Study revision | Server/database transaction |

**Processing states:** use explicit stages (`REGISTER`, `READ`, `EXTRACT`, `VERIFY`, `MERGE`, `ANALYZE`, `COMPOSE`, `SUCCEEDED`, `FAILED`) scoped to operations; not all are necessarily exposed as literal database enums. User-facing language is calm and truthful; failures preserve prior accepted revision/report.

## 4. Extraction and page boundaries

- The approved text of `hive-extract/1` is in `prompts/hive-extract/HiveForYou-Extract-v1.md`; do not let a test or generation utility silently modify it.
- Input: document ID, opaque file reference and optional **physical** `pageRange`. Output: one `hive.doc-extraction/1` JSON. A range is its own bounded model request, not a second extraction engine.
- Reader normalizes and identifies page order/markers, stores source/page digests and tracks OCR/read quality. Original source content remains private.
- Verbatim quotes must correspond to one contiguous source run. **Known prompt tension:** joining table cells with `|` may not match page bytes; enforce actual contiguous quote, preserve column context as structured metadata. Resolve the normative prompt text through explicit prompt revision, not an ad hoc silent exception.
- Page-range local IDs (e.g. `p11-20:F001`) are not DB identifiers. Store local→persistent mapping, prevent duplicates, and retain range/page provenance during merge.
- `glossary` expansions marked `source: general_knowledge` are **not source facts**; they never enter verified observations as document evidence. Document summaries are generated descriptions and require supporting fact refs to be used downstream.
- `emptyFields`, `referencedDocuments`, `instructionsIgnored` and coverage remain separate typed extraction artifacts with their own validation; an unchecked box is not an automatically absent document/field.
- No fact needs a prior user intent; later intent-specific coverage gaps can request selected authorized pages again without corrupting earlier accepted facts.

## 5. Independent verification and Study acceptance

1. Verify owner/Hive/source binding and immutable original/read digests before reading evidence.
2. Schema-validate candidate shape, source identifier, local IDs, modality/status, page window, `valueAsWritten`, quote sizes and field types.
3. Check exact contiguous source quote (with only a separately approved normalization policy) against the correct physical page; reject cross-page concatenation and quote reconstruction.
4. Check the **association**: quote actually supports subject, value, unit, modality, claimed date and relevant row/column. Existence of a number on a page alone is insufficient.
5. Distinguish `VERIFIED`, `UNRESOLVED`, `REJECTED`; keep reason codes. Unreadable/not examined is not a negative fact. A source saying something is not proof that the assertion is true in the world.
6. Save candidate/verifications with lineage. Model proposes semantic linking; code checks IDs, source and dates, preserves uncertain/conflicting claims, then **atomically advances** the one current Study revision pointer only if an accepted revision is valid.
7. Later Study revisions do not rewrite previous revisions; one Hive has no accepted Study until first successful processing.

**Agentic Canonical Study (D-042, V4-004A, local):** `INVESTIGATING` loads the frozen case-wide corpus of persisted authorized pages once (`get_study_source_pages` + `loadSourcePages`; manifest, page-set-digest and page-hash checks; no PDF reopening or OCR) and runs a bounded tool-calling loop (`apps/web/src/server/workflow/study-investigation.ts`). Each turn goes Vercel → `v4-planner` `POST /v1/study-agent-turn` (`study-agent-turn@1`, relay only) → LiteLLM `heavy_lifter`; the returned tool calls are executed on Vercel by the run-local `StudyAgentLedger` (`packages/contracts/src/analysis/study-agent.ts`), idempotent on `(runId, toolCallId)`. The prompt carries a page index, never concatenated page text; pages reach the model only through `read_pages`. Evidence is checked when recorded; after `finish_study` the ledger assembles `hive.study-investigation/1`, the snapshot is rechecked, and the unchanged verifier decides. Budgets (rounds, calls, invalid calls, tokens, request bytes, estimated cost, 235 s wall clock) fail closed with `study_agent_budget_exhausted`; transient model errors restart the stage with a fresh ledger (no mid-loop resumption). Nothing is persisted until the verified Study is advanced to `VERIFYING_EVIDENCE`.

## 6. Intent analysis and A2UI

- User's request is evaluated against an **immutable pinned Study revision**. The model must cite accepted observation/finding IDs for case claims. Missing facts can lead to a scope-limited follow-up extraction, not an ungrounded answer.
- Deterministic numeric calculations preserve units, source inputs and methods. No unsupported model-invented arithmetic, diagnoses, legal verdict or eligibility promise.
- A2UI **proposes presentation**, not code or new factual content. Component allowlist, validated props/IDs, server-authorized data binding, bounded payloads, safe fallbacks and accessible rendering are mandatory.
- Only fixed application components may perform mutations; AI cannot invent navigation destinations, call endpoints or auto-share data.
- Reports are generated independently with unique `reportRunId` per Generate; retries within the same run are idempotent; prior accepted report remains intact on failures.

## 7. Privacy and reliability boundaries

- Supabase Auth + RLS + server authorization on every owner-scoped lookup; public APIs never accept an arbitrary model-generated owner ID. Private Storage, least privilege, secret isolation and sanitized logging.
- **Tokenization is a proposed capability, not implicit HIPAA de-identification.** If enabled, keep original/derived/page/token mapping separate, protect the map, and restore original source quotes only through an authorized verified pathway. BAA/provider/retention and risk assessment required before real sensitive information.
- Every I/O boundary has structured error codes, correlation/run IDs, bounded timeouts and safe retry strategy; idempotent register/merge/report writes and explicit partial/failed status.
- Distinguish client validation, denied access, unsupported type, unreadable source, incomplete range, malformed model JSON, mismatched quote, model timeout and failed DB commit. Failure never promotes unverified candidates or erases accepted results.

## 8. Phased physical realization

1. **V4-001 (done):** Next.js app shell, brand, observability contract.
2. **V4-002 (done):** Supabase Auth, owner Hives, Edge-backed Hive APIs, RLS on `hive.hives`.
3. **V4-003 (in progress, local):** written intent at create (D-026), prepare/register upload with quota and hash scan (D-027), Documents tab list/status. **Not yet:** document read pipeline or page-aware viewer.
4. **V4-003 completion gate:** deploy migration + `v1-source-documents`; verify live authenticated registration before closing ticket.
5. **V4-004 (paused, awaiting live verification; D-039–D-041):** Analyze / Prompt Preview — durable `processing_runs` preparation run; planning calls only through the authenticated Oracle `v4-planner` (loopback, behind the Reader's TLS proxy) to private LiteLLM `sorter`; immutable `study_prompt_previews`; extended end-to-end to Canonical Study acceptance and Customer/Pro reports (D-041).
5a. **V4-004A (active, D-042):** agentic Canonical Study — bounded tool-calling investigation over the case-wide page corpus replaces the single Study JSON call; contract, verifier, acceptance, Writer and A2UI unchanged.
6. **V4-005:** one real frontier extraction from synthetic document with prompt/contract. Verify candidate persistence/output only; not yet trusted Study.
7. **V4-006:** independent verification and first accepted Study with functional source-chip navigation (requires read/viewer from V4-003 follow-on or same ticket extension when approved).
8. **V4-007/008:** analyze once and dynamically present; save Customer/Pro reports and independent run history.
9. **V4-009+:** incremental multi-document processing, negative-path and privacy/data-lifecycle completion.

**Do not require an up-front platform/orchestration migration merely to start V4 development.** Select a durable executor when an actual workload shows it is needed, before claiming long-job reliability. See `HiveForYou-DEVELOPMENT-PLAN.md`, `HiveForYou-NEXT.md`, `HiveForYou-DECISIONS.md`.

## 9. Analytical Intelligence extension (2026-10-31; proposed, not deployed)

**New flow after acceptance:** `accepted Study revision → discoverOpportunities → qualifyOpportunities → planAnalysis → validateAnalysisPlan → executeAnalysis → verifyAnalysisResult → presentInsight`. Optional scenario path: `createScenarioOverlay → compileScenarioModel (LLM) → validateScenarioModel → evaluateScenario → compareScenarios`. These are logical functions, not new required services/packages or already-authorized identifiers.

**Trust separation:** `source → untrusted extraction → verified facts → immutable Study revision → proposed analytical opportunities → validated analysis plan → executed result → evidence- and method-linked insight`. Scenario overlay extends a *pinned* Study revision without mutating it. Opportunity proposal, LLM causal edge, external rule, interpretation and computed value are separate kinds of claims.

**LLM responsibility:** discover candidate analysis questions from existing fact/coverage manifests and user goal; propose typed inputs and dependency graph; reason qualitatively within bounds; identify needed outside rules, assumptions and unknowns; compose read-only presentation. **Trusted Core responsibility:** authorization, ref/coverage/subject/date/unit checks, deterministic arithmetic, plan validation, input-dependent rules/solver dispatch, provenance checks and transactional persistence. A solver's `OPTIMAL` is valid only for the formalized constraints—not proof the model describes reality.

**Execution router:** `{aggregation, comparison, chronology, reconciliation, coverage_check, conditional_rule_evaluation, optimization, qualitative_synthesis}` are *proposed analysis kinds*, not a fixed domain ontology. Use the smallest supported operation. For rules: retrieve authoritative source + jurisdiction + effective version and check applicability; otherwise `BLOCKED`/qualified partial result. For optimization: constrain a typed intermediate representation to safe supported operators, compile to an approved backend (OR-Tools only if needed) in a sandboxed trusted service; never run unrestricted model-authored Python/JS/SQL. When mathematical formulation cannot be certified, display a question rather than a quantitative prediction.

**Cost/reliability:** one bounded discovery pass per accepted revision (idempotent on revision + discovery version) with ranked top-N candidates; defer high-cost executions until approved by policy/user. Cache identical inputs/methods, invalidate affected analyses on new revisions, cap tokens/runtime/tool calls, log sanitized stage/cost/status. Always keep prior accepted Study/reports intact.

**Presentation:** retain fixed Documents · Study · Reports shell. In Study add allowlisted `SuggestedAnalyses`, `AnalysisResult`, `ScenarioExplorer`, `DependencyView`, `ScenarioComparison` as proposed views/component families. Report artifacts pin analysis/scenario inputs and revision. A2UI is read-only/validated; user-initiated actions route through typed authorized application commands.

**Example — conditional bankruptcy comparison:** ask whether individual/entity debtor; read dated asset, liability and income facts; retrieve applicable authoritative rules; propose Chapter 7/Chapter 11 paths and unresolved eligibility factors; compute only valid financial comparisons; present tradeoffs and questions for counsel. Avoid implied court-outcome probabilities or an authoritative chapter recommendation.

**Contract gates:** names and JSON shapes for opportunity, plan, result, scenario and comparison need explicit schema design during their tickets. Keep `hive-extract/1` and `hive.doc-extraction/1` unchanged. No new auto-execution infrastructure approved by this document.
