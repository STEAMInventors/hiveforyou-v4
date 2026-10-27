# HiveForYou V4 — Security, privacy and tokenization design

**Version:** 0.1 | **Status:** Proposed design and gates, not a security certification or authorization to process real sensitive records.

## Objectives

Protect uploaded documents, page text, people named within them, identity mappings and generated outputs while keeping **No source, no claim** evidence verifiable. Development begins with synthetic/sanitized materials. Do not claim HIPAA compliance from any one provider's certification, RLS setting, gateway, or tokenization feature.

## Security boundaries

| Boundary | Required behavior |
|---|---|
| Browser → Next.js | Authenticate user; authorize Hive at every operation; validate size/type/method/input; never expose model/provider or Supabase service credentials |
| Next.js → private Storage | Create time-limited scoped access or server-stream authorized pages; opaque private object keys; no public bucket for source documents |
| Next.js → Postgres | Owner RLS + explicit server authorization; service credentials bypassing RLS must be guarded and not exposed to client |
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
