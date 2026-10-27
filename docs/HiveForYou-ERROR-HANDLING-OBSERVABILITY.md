# HiveForYou V4 — Error Handling, Observability and Recovery

**Version:** 0.1 — V4-001 shell subset implemented; later boundaries remain specified and are not built
**Scope:** Every V4 server/API, document processing, model, verification, persistence, A2UI, and report boundary.
**Lifecycle:** V4 is **in development**, not designated production. These are architectural conventions to implement incrementally as each boundary is built.

## 1. Goal and principles

A support engineer must be able to answer **which operation failed, at what stage, for what reason, what persisted, whether a retry is safe, and what the user should do next** from an opaque support reference and retained sanitized logs—without accessing private document contents or reproducing the issue locally.

1. Use **one shared error model** and one structured logger. No separate retry/logging frameworks per feature.
2. Fail explicitly and truthfully. No silent failure, fake success, unbounded retries, or automatic trust in model output.
3. Record actionable, *sanitized* diagnostics at the failing boundary; propagate stable codes outward.
4. Persist durable operation states where failure/recovery outlives one HTTP request.
5. Preserve existing accepted Canonical Study revisions and prior reports on any failed or partial operation.
6. Prefer the existing Vercel runtime logs and Supabase database; **no new observability vendor, diagnostic environment variable, or feature flag** by default.

## 2. Shared public error contract

Use camelCase in TypeScript/API JSON; PostgreSQL columns use snake_case. A safe server error response is:

```json
{
  "error": {
    "errorCode": "MODEL_TIMEOUT",
    "category": "DEPENDENCY",
    "message": "Document extraction did not complete. You can retry.",
    "stage": "EXTRACT",
    "retryable": true,
    "correlationId": "2eb8421a-b784-4bf8-ac2b-540299b61d13",
    "operationId": "c772c4dc-c138-4cc3-9d26-8b8b6a2e07c3",
    "timestamp": "2026-10-26T21:00:00Z"
  }
}
```

**Normative fields:** `errorCode`, `category`, `message` (safe), `stage`, `retryable`, `correlationId`, `timestamp`; `operationId` when an operation record exists. Use an allowlisted stage/category/code, not free-text from a provider. An HTTP error code and an operation's persisted lifecycle status are different concepts. `retryable` says retry *may* be safe under policy; it is not a guarantee that an automatic retry exists.

**Internal typed error:** retain `cause` in-process as a non-enumerable property so ordinary `JSON.stringify` does not emit it; copy only `errorCode`, `category`, `stage`, `retryable`, `safeMessage`, `correlationId`, `operationId`, and **sanitized** diagnostic metadata. A thrown value is a typed error only when those contract fields are present and allowlisted. Anything else, including a partial lookalike object, becomes `INTERNAL_ERROR`. Do not expose SQL text, filesystem paths, tokens, original exception messages, stack traces or provider response bodies to clients.

Return suitable HTTP statuses: 400/422 validation, 401 authentication, 403 authorization, 404 resource not found (where appropriate), 409 conflicting state, 429 throttling, 502 invalid upstream/model responses, 503 upstream unavailable, 504 timeout, 500 unexpected/internal. Keep response shape consistent; don't imply all `MODEL_TIMEOUT` failures must map to the same status in every hosting context.

## 3. Error taxonomy and recovery policy

| Category | Example stable codes | Default action |
|---|---|---|
| `VALIDATION` | `INVALID_REQUEST`, `UNSUPPORTED_DOCUMENT_TYPE`, `INVALID_DOCUMENT`, `VIEW_INVALID` | No retry until input is corrected |
| `SECURITY` | `UNAUTHENTICATED`, `ACCESS_DENIED`, `SOURCE_ACCESS_DENIED` | No retry; deny access and avoid revealing existence of private resources |
| `DOCUMENT` | `DOCUMENT_UNREADABLE`, `COVERAGE_INCOMPLETE`, `PAGE_READ_FAILED` | Mark affected source/range; retry only for a verified transient read fault |
| `MODEL` | `MODEL_OUTPUT_INVALID`, `MODEL_REFUSED`, `MODEL_CONTEXT_EXCEEDED` | Preserve rejected output metadata only; no blind retry loop |
| `DEPENDENCY` | `MODEL_TIMEOUT`, `MODEL_UNAVAILABLE`, `STORAGE_UNAVAILABLE` | Bounded retry only when transient and safe |
| `EVIDENCE` | `QUOTE_NOT_FOUND`, `SOURCE_MISMATCH`, `EVIDENCE_ASSOCIATION_INVALID` | Reject or mark candidate unresolved; never promote it as verified |
| `PERSISTENCE` | `PERSISTENCE_FAILED`, `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT` | Investigate commit outcome; retry only with idempotency or concurrency protection |
| `SECURITY_PROCESSING` | `TOKENIZATION_FAILED`, `TOKEN_MAPPING_UNAVAILABLE` | Fail closed; never send unprotected input as a fallback |
| `INTERNAL` | `INTERNAL_ERROR` | Fail safe; retain internal sanitized event for diagnosis |

An error can affect one **candidate**, one **page/window**, one **document**, one **processing run**, or one **report run**. The scope must be explicit: one rejected fact must not automatically mean the entire Hive failed; an incomplete required source range cannot be reported as a complete successful extraction.

Codes should be stable constants with tests, not generated from model/provider text. Introduce additional codes only when they change diagnosis or handling.

## 4. Correlation and structured events

- Validate a caller-supplied correlation ID to a safe bounded format or generate a fresh UUID at the trusted API boundary. Return it to the caller and expose it as a support reference.
- Propagate the same `correlationId` through server helpers, model adapter, page processing, verification, Supabase writes, A2UI composition and report operations.
- Generate separate opaque `operationId` / `processingRunId` / `reportRunId` where the operation is persistent. **An independent user Generate click creates a new `reportRunId`; a retry within one report run reuses its idempotency identity.**
- Emit structured JSON events for **start**, **meaningful state transitions**, **completion**, and **failure**. Prefer one failure event at the owning boundary and avoid repeated exception spam at every stack frame.
- Use application/log fields consistent with `HiveForYou-NAMING-CONVENTIONS.md`:

```json
{
  "eventName": "document.extraction.failed",
  "severity": "ERROR",
  "timestamp": "2026-10-26T21:00:00Z",
  "component": "extraction",
  "operation": "extractDocument",
  "stage": "EXTRACT",
  "correlationId": "2eb8421a-b784-4bf8-ac2b-540299b61d13",
  "processingRunId": "c772c4dc-c138-4cc3-9d26-8b8b6a2e07c3",
  "sourceDocumentId": "opaque-source-id",
  "status": "FAILED",
  "errorCode": "MODEL_TIMEOUT",
  "retryable": true,
  "attempt": 1,
  "durationMs": 90123,
  "diagnosticReason": "gateway_timeout"
}
```

The example is illustrative, not a real logged failure. Keep only fields needed for the event. **Never log** original documents, OCR/page text, exact quotes, raw model input/output, prompt bodies, PHI/PII, token maps, model credentials, service keys, signed URLs, or complete provider/database error responses. IDs must be opaque. Avoid log headers/URLs that carry tokens. Use bounded retention/access appropriate for later approved data policy.

## 5. Durable operation lifecycle

For processing that can exceed one request, persist an operation record **before** any non-idempotent or costly work starts. At a minimum track: opaque identity, owner/Hive binding, operation type, `stage`, `status`, creation/update times, attempts, latest safe `errorCode`, correlation ID, source/version fingerprint, and retry/resumption information.

Recommended status semantics:

- `QUEUED` → accepted but not started
- `RUNNING` → actively executing one named stage
- `SUCCEEDED` → accepted results committed and completeness conditions met
- `PARTIAL` → usable scoped results plus explicit incomplete coverage (never silently counted as complete)
- `FAILED` → terminal failure for this attempt, with code and recovery guidance
- `CANCELLED` → user/system cancellation where supported

Persist stages such as `REGISTER`, `READ`, `PROTECT`, `EXTRACT`, `VERIFY`, `MERGE`, `ANALYZE`, `COMPOSE`, `SAVE_REPORT` only when the operation uses them. The stage is not the status. Only introduce actual database enums/tables when that feature is implemented and approved.

**Timeout/termination caveat:** A Vercel function may be terminated without running cleanup. A durable resume solution needs an approved executor or explicit user-driven retry/reconciliation mechanism; `try/finally` alone does not guarantee failed-state persistence. Do not claim asynchronous or automatic recovery until an actual executor and stale-run handling exist. Keep server-side processing libraries portable.

## 6. Retry, idempotency and atomic acceptance

- Apply finite timeouts to network/model/storage operations and bound request/page windows. Never wait indefinitely.
- Retry **only transient failures** (e.g., timeout, 429, temporary 5xx) with small capped attempts and backoff **if** the operation is idempotent. Respect provider retry hints within a safe ceiling. No repeated calls for invalid JSON, invalid evidence, access denied or invalid input by default.
- Use a stable operation/idempotency identity to prevent duplicate source registrations, repeated fact acceptance and duplicate report writes after client retries or uncertain network completion.
- Use immutable original documents and content/read fingerprints to prevent mixing page content from different document revisions. Reprocessed ranges must have deterministic lineage.
- Keep candidate extraction separate from trusted acceptance. Failed verification never upgrades unsupported claims.
- Construct a candidate Study revision without changing the current pointer; in one authorized database transaction accept the revision and advance the current pointer with optimistic concurrency checks. On failure keep last accepted Study untouched.
- Generate reports independently and store a successful result atomically. A failed new report run must not hide or overwrite accepted reports.

## 7. Boundary-specific expected handling

| Boundary | Handle explicitly | Preserve / record |
|---|---|---|
| Browser → Next.js API | Malformed request, unauthenticated/unauthorized user, invalid Hive/source IDs, duplicates | Safe status/message, correlation ID; no other user's resource detail |
| Upload → Storage | Unsupported format/size, partial upload, checksum mismatch, unavailable storage | Never claim registered until durable, authorized state is consistent |
| Read/OCR | Corrupt PDF, bad encoding, unreadable/blank page, incomplete page range, timeouts | Physical page IDs, read quality/coverage, source digest, safe reason |
| Protect/tokenize (if approved) | Detection ambiguity, token collision, mapping/key failure | Fail closed, no silent unprotected-provider fallback; no tokens in logs |
| Frontier model | Missing approved credentials/route, rate limit, timeouts, refusal, invalid JSON, incomplete response | Provider/alias identity if safe, latency/attempt, prompt/contract version/digest, sanitized reason |
| Evidence verification | Wrong source/page, missing quote, wrong row/value, invalid IDs, duplicate IDs, incomplete coverage | Per-observation `VERIFIED`/`UNRESOLVED`/`REJECTED` and stable reason; do not elevate rejected facts |
| Database/Study | Permission/RLS failure, transaction conflict, uncertain commit, partial write | Atomic revision acceptance, idempotency key, previous revision preserved |
| Intent/A2UI/Reports | Unsupported source claims, unknown component/action, invalid layout, model error | Reject unsafe UI; render safe fixed fallback; retain previous report |

## 8. User-facing experience and support runbook

A user sees a clear action and a support reference, never raw infrastructure details. Example: **“We couldn't finish reading one document. Your previously saved Study is unchanged. Try again or contact support with reference 2eb8421a…”** Do not suggest retry if the issue is permanent.

Support procedure:

1. Locate events by `correlationId` or `operationId` in existing platform logs and the operation's authorized database record.
2. Determine last successful stage, latest safe error code, attempts and duration.
3. Inspect source/page coverage and acceptance metadata, **not** raw customer records by default.
4. Determine if failure was transient, permanent, a candidate-level rejection, stale execution or ambiguous persistence outcome.
5. Choose safe retry/resume/re-upload/manual escalation according to the operation's policy. Never force an unverified candidate into the Study.
6. Record outcome, recovery action and whether the same failure is recurring. Alerting/monitoring vendors are future choices, not V4-001 requirements.

## 9. Incremental implementation and tests

**V4-001 (implemented):** this document, one shared typed error contract, structured JSON logging helper, correlation-ID generation/validation, and a consistent error response at the application-shell API boundary. Focused tests cover unexpected failures, correlation on the failure response and log, and nested sensitive values kept out of logs. No job framework, database state machine, retry service, monitoring vendor, or public fail-only route.

**Subsequent tickets:** implement the relevant boundary's statuses/observability when that feature is built, and test both success and failure.

Minimum focused negative-path tests as applicable: malformed input; unauthorized Hive/document reference; invalid upload; unreadable source; missing page; provider timeout/rate limit; non-JSON model output; quote absent/wrong page/wrong row; duplicate retry; database conflict/uncertain commit; A2UI unknown component; previous accepted Study/report unchanged after failure; log sanitizer does not leak private content.

**Done-when standard:** For every implemented operation, a controlled failure produces a correct safe response, one traceable failure event, a truthful state, and an actionable recovery behavior. Success must be verified end to end—not merely inferred from compilation or passing unit tests.
