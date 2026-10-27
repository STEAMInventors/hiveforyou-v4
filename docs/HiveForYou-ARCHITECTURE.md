# HiveForYou V4 — System architecture

**Version:** 0.1 | **Status:** Proposed logical architecture and first development topology, **not** deployed. | **Date:** 2026-10-26

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

1. **V4-001:** Local Next.js app shell, shared error contract, and sanitized request logging. No live auth, database, or model adapter.
2. **V4-002/003:** Supabase Auth, Hives, source registration and page-aware document viewing.
3. **V4-004:** one real frontier extraction from synthetic document with prompt/contract. Verify candidate persistence/output only; not yet trusted Study.
4. **V4-005:** independent verification and first accepted Study with functional source-chip navigation.
5. **V4-006/007:** analyze once and dynamically present; save Customer/Pro reports and independent run history.
6. **V4-008+:** incremental multi-document processing, negative-path and privacy/data-lifecycle completion.

**Do not require an up-front platform/orchestration migration merely to start V4 development.** Select a durable executor when an actual workload shows it is needed, before claiming long-job reliability. See `HiveForYou-DEVELOPMENT-PLAN.md`, `HiveForYou-NEXT.md`, `HiveForYou-DECISIONS.md`.
