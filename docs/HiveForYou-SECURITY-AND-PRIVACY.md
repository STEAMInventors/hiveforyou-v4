# HiveForYou V4 — Security, privacy and tokenization design

**Version:** 0.2 | **Status:** Proposed design and gates, not a security certification or authorization to process real sensitive records.

## Objectives

Protect uploaded documents, page text, people named within them, identity mappings and generated outputs while keeping **No source, no claim** evidence verifiable. Development begins with synthetic/sanitized materials. Do not claim HIPAA compliance from any one provider's certification, RLS setting, gateway, or tokenization feature.

## Security boundaries

| Boundary | Required behavior |
|---|---|
| Browser → Next.js | Authenticate user; authorize Hive at every operation; validate size/type/method/input; never expose model/provider or Supabase service credentials |
| Register (D-027) | After private upload, trusted service verifies bytes, MIME, SHA-256, and hash-based malware scan before `REGISTERED`; reject or leave `PENDING` with retry when scan unavailable; never count quota until honest registration |
| Next.js → private Storage | Create time-limited scoped access or server-stream authorized pages; opaque private object keys; no public bucket for source documents |
| Next.js → Postgres | Owner RLS + explicit server authorization; service credentials bypassing RLS must be guarded and not exposed to client |
| Next.js → Oracle planner (D-039) | HTTPS through the same TLS proxy as the Reader, bearer `PLANNER_SERVICE_TOKEN` (distinct from the Reader token) compared in constant time; planner binds only to `127.0.0.1:8083`; allowlisted task/prompt IDs, bounded body and output tokens; model alias fixed server-side (`sorter`). LiteLLM (port 4000) is never proxied publicly; its credential is a scoped virtual key held only in `v4-planner.env` on Oracle, never the master key and never in Vercel. Logs carry IDs, codes, token counts and latency only — no prompt, page text, completion or key. V3 LiteLLM is not modified or restarted |
| Agentic Study & Writer (D-042, D-045) | `POST /v1/study-agent-turn` uses the same bearer, proxy and scoped key; it accepts only prompt `hive-study-preview/1` (`task: "study"`, eleven Study tools, `PLANNER_STUDY_LITELLM_ALIAS`) or `hive-writer/1` (`task: "writer"`, five Writer tools, `PLANNER_WRITER_LITELLM_ALIAS`), closed object tool parameter schemas and bounded messages, and relays tool calls without executing them. Study tools run on Vercel in `StudyAgentLedger` over the frozen corpus already authorized for the run (unknown documents/pages refused, page hashes checked, quotes verified against stored page text). Writer tools run on Vercel in `WriterAgentLedger` over the accepted Study's claim catalog (validating claim-kind compatibility, claim-level numerical grounding, deterministic scenario formulas and A2UI provenance immediately without auto-citing or repairing unsupported values). Budgets cap rounds, accepted calls, rejected calls, tokens, bytes, estimated cost and wall clock. Logs (web and Oracle) carry counts, token totals, latency and safe reason codes only — never page text, quotes, tool arguments, messages or provider error bodies |
| Preparation scope (D-039, D-049) | `start_study_preparation` computes the authorized document set and frozen snapshot server-side for the owner's Hive; workers read pages only by frozen fingerprint/digest; material coverage gaps require the owner's acknowledgment of the exact coverage digest, stored per gap and never inferred from clicking Analyze (D-041 B5); previews never claim full coverage they do not have. `rebuild_study` is a separate owner-only RPC: it refuses another owner's Hive, requires documents already read, reuses those saved pages, and does not dispatch Writer. Page-read coverage is not claimed as extraction completeness |
| Backend → frontier model | Approved provider, data retention/usage terms, necessary consent and least document scope; no real sensitive payload before approval |
| Model → parse/check | Treat model JSON, suggestions and document-embedded instructions as untrusted; validate schema, ids, evidence/source ownership, quotas/limits |
| Analysis → A2UI | Validate allowlisted component type, referenced verified fact IDs, props, URLs and actions; no arbitrary executable HTML, JS, Markdown HTML, SQL, scripts or mutations |
| Evidence viewer | Recheck ownership and revision-to-source bindings even after clicking a valid-looking chip; audit protected access as needed |

## Proposed reversible tokenization (not approved implementation)

1. Store immutable original source in private access-controlled Storage.
2. Read/OCR into traceable physical page text and selected allowed visual anchors.
3. If tokenization is approved and feasible, detect defined sensitive identifiers (names, IDs, account/claim numbers, addresses); use stable within-Hive tokens but never globally predictable token strings. Store mappings separately under strong encryption, least privilege and access audit.
4. Send only the approved transformed representation to model, recognizing that remaining unique circumstances can still be identifying. Tokenization alone does **not** automatically satisfy HIPAA de-identification or prevent re-identification.
5. Quote support must be verified against the exact representation the model saw, then independently reconciled to original page/positions through the protected mapping before source chips display restored originals. **Never pretend a tokenized quote is literally verbatim original source text.**
6. Make sensitive-entity detection, ambiguous replacements, OCR spans, table structure, token collisions and cross-page naming consistency measurable before trusting transformed evidence.

**Do not implement** tokenization without a design for keys, mapping storage/encryption, authorized detokenization, provenance, deletion propagation, OCR/image behavior, test cases and incident handling. Never log the token map or store it in model-visible prompts/artifacts.

## Sensitive-data provider/contract gate

Before processing *real* PHI/PII or client legal/bankruptcy files: determine covered entity/business associate role, applicable contracts/BAAs, provider's input retention/training/abuse logging policy, Supabase project/service terms, Vercel/data-processing agreements, consent/disclosures, region and deletion obligations. Review actual provider terms rather than assuming blanket compliance. Synthetic tests do not require representing the product as HIPAA compliant.

## Source/evidence trust

- Exact quote validation uses correct original page or authorized transformed page + reversible anchor mapping. Model's `confidence: high` is not independent trust.
- Test prompt injection in page text, mismatched subject/value/row, wrong page, quoted text spanning pages, malformed IDs, duplicate local IDs, alternate printed page labels, partial and blank pages.
- Keep `general_knowledge` glossary and inferred summary apart from verified source facts.
- `hive-prep/1` directly uses documents and produces model citations; these are **not independently verified** and must not silently be saved as accepted Study.

## Availability, retries and safe failures

Use stable request/run IDs, structured error codes (`INVALID_INPUT`, `ACCESS_DENIED`, `DOCUMENT_UNREADABLE`, `COVERAGE_INCOMPLETE`, `MODEL_TIMEOUT`, `MODEL_OUTPUT_INVALID`, `QUOTE_NOT_FOUND`, `PERSISTENCE_FAILED`, `VIEW_INVALID`), stage, source ID, safe provider alias, attempts and sanitized durations. Do not log uploaded text, full quotes, raw model JSON, secret values or PII. Bound model requests and retries; only repeat operations with idempotency guarantees. Preserve accepted revisions and reports after failure.

## Retention and deletion

Distinguish pending upload, original, derived page/OCR, candidate, verification record, accepted Study, report, token map and support logs. Hive deletion and account deletion operate over all relevant object types. Preserve retained V3 decision: account deletion has 30-day recoverable retention before permanent cleanup and audit, subject to implementing its specific policy/authorization ticket. Do not create automated deletion jobs before approved scope and retention obligations are understood.

## Initial development checklist

- [ ] Authenticated owner-only access at API and DB; deny cross-Hive references.
- [ ] Private storage keys opaque; content/quotes not in application logs.
- [ ] Model boundary server-side and explicitly approved before non-synthetic data.
- [ ] Source quotes bound to immutable physical page and original/transformed representation.
- [ ] A2UI cannot execute user/model code or invoke unapproved operations.
- [ ] Safe explicit failure, bounded model/DB calls, recoverable operation status.
- [ ] Prior Study/report accepted state survives retries and partial failures.

**Security is a feature of a working product, not proof it is operating in a compliant environment.** See `HiveForYou-DECISIONS.md` for open choices.

## Analytical Intelligence privacy and high-impact boundaries (2026-10-31)

Discovery uses least-necessary *authorized* accepted Study representations, ideally fact/coverage manifests before original pages. Only retrieve original excerpts through existing owner-checked pathways; do not automatically re-send entire uploaded files for each analysis. Apply existing frontier-provider approval, retention/consent and sensitive-data gates equally to discovery, optimization and scenario explanation.

**Threats:** prompt injection inside quoted evidence; model-derived faux legislation; scenario input crafted to invoke tools; inferred protected information in logs; accidental conversion of a hypothetical into a verified fact; excessive background cost/denial-of-service; fabricated legal/health/financial outcome certainty. **Controls:** immutable pinned source revisions; distinct hypothetical namespace; input limits and budgets; typed read-only analysis tool contracts; authorized rule-source retrieval; deterministic verification; no model-authored executable code; approval for external actions; output scope/caveats.

For legal/eligibility what-ifs (e.g., bankruptcy Chapters 7 and 11), identify jurisdiction/individual-vs-entity and relevant effective law; if missing, return conditional alternatives and professional-review questions, not a chapter recommendation. Retain all existing owner-only access, deletion, audit and source-chip restrictions. No unsanctioned real sensitive-data tests.
