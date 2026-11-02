# HiveForYou V4 — Prompt and model contract index

**Version:** 0.2 | **Status:** Prompt text is selected by founder; parsers/validators not implemented in V4 yet.

## Exact selected prompts

| ID | File | Role | Output |
|---|---|---|---|
| **`hive-extract/1`** | [`../prompts/hive-extract/HiveForYou-Extract-v1.md`](../prompts/hive-extract/HiveForYou-Extract-v1.md) | Domain-free, intent-free source extraction; one document or bounded physical page range. | **`hive.doc-extraction/1` JSON**, *untrusted candidates*. |
| **`hive-prep/1`** | [`../prompts/hive-prep/HiveForYou-Prep-v1.md`](../prompts/hive-prep/HiveForYou-Prep-v1.md) | One-call direct frontier/Opal **IEP meeting preparation** from uploaded documents + question; not a normal Study stage. | Markdown report with model-generated source chips; citations not independently verified. |

These prompt files reproduce the user-selected specification rather than modifying it to fit legacy code. Never substitute prior `source-fact-discovery-output@1` or Pack fact catalog for `hive.doc-extraction/1`.

## Study preparation prompts (V4-004, D-039)

Planning prompts for Analyze / Prompt Preview. They run on the inexpensive planning model (`sorter`) through the Oracle `v4-planner` endpoint; they never extract facts and never replace `hive-extract/1`.

| ID | File | Stage | Output (validated by trusted code) |
|---|---|---|---|
| **`hive-intent/1`** | [`../prompts/hive-intent/HiveForYou-Intent-v1.md`](../prompts/hive-intent/HiveForYou-Intent-v1.md) | Understanding request | `hive.intent-decomposition/1` JSON: verbatim intents, distinct objectives, independently answerable questions, dependencies, evidence, comparisons, expected outputs, ambiguities |
| **`hive-domain/1`** | [`../prompts/hive-domain/HiveForYou-Domain-v1.md`](../prompts/hive-domain/HiveForYou-Domain-v1.md) | Identifying domain | `hive.domain-proposal/1` JSON: open-vocabulary primary domain/subdomain, alternatives, `{sourceDocumentId, pageNumber}` refs checked against sampled persisted pages, reasoning, mixed/ambiguous flags, advisory confidence |
| **`hive-plan/1`** | [`../prompts/hive-plan/HiveForYou-Plan-v1.md`](../prompts/hive-plan/HiveForYou-Plan-v1.md) | Planning investigation | `hive.investigation-plan/1` JSON from the validated decomposition *and* domain proposal; every question links an objective and source question; domain basis must match the validated domain |
| **`hive-study-preview/1`** | [`../prompts/hive-study/HiveForYou-Study-Preview-v1.md`](../prompts/hive-study/HiveForYou-Study-Preview-v1.md) | Building prompt (deterministic template, no model call) | Eight-section Canonical Study prompt plus a `{{SOURCE_PAGES}}` binding section filled only at future execution, + `hive.study-execution-manifest/1`; future output contract `hive.study-investigation/1` ([schema](../prompts/hive-study/hive.study-investigation-1.schema.json)), referenced, not executed in V4-004 |

Rules: uploaded text is untrusted data delimited in the user message and never placed in the system role; instructions found in documents are ignored. Prompt files are digested (sha256 over LF-normalized text) at load time; each stage records prompt ID, digest, model alias, token usage, latency and error code, never prompt or page text. There is no domain switch statement; unknown domains stay supported and uncertain classifications are preserved.

Outcome-oriented planning (founder refinement, 2026-11-01): `hive-intent/1` rule 3 and `hive-plan/1` rule 4 were edited to forbid restating the request and to require spelled-out comparison/chronology/calculation logic, evidence limits (`missingEvidenceConditions`) and answer structure (`deliverable`). Trusted code enforces this: `question_restates_intent` (word-set similarity ≥ 0.85 with any verbatim request) and `answer_logic_missing`. Prompt digests changed accordingly; previews record the digests they were built with.

Implementation status: implemented locally (uncommitted); planner not yet deployed; no paid model run performed.

## Implementation integration (future V4-005)

- Load/version controlled `hive-extract/1` prompt, substitute `documentId`, `fileName`, `pageRange` and supplied source pages, ensuring system text and user payload stay separate and document bytes remain *data*.
- Use strict JSON parsing/schema validation and model-output budget/coverage reporting; require `schema: hive.doc-extraction/1` and a single source ID. No fallback to a domain-based default when unset.
- Store prompt ID, immutable prompt digest, schema version, model alias/response metadata and page source digest with every extraction batch. Never log prompt with private pages.
- Every `facts[].evidence[]` references physical page; distinct printed-page label is not positional page number. Model-local IDs must be mapped to DB UUIDs with range context.
- Constrain allowed entity/fact/evidence fields and records; separate `facts`, `emptyFields`, `referencedDocuments`, `glossary`, `instructionsIgnored` and coverage as different trust categories.
- Preserve repeated records and grouped row properties, as well as `modality`, `attributedTo`, `valueAsWritten`, numeric units and effective/as-of dates.
- **No candidate is promoted** without independently checking quote, source/page identity, claimed value and record relationship. Derivations and glossary general knowledge never become document claims merely because present in output.
- Later Study/Writer/A2UI prompts must be separately specified and approved; do not invent their IDs or output schema as implemented here. (V4-004's preparation prompts and `hive.study-investigation/1` are approved under D-039; execution remains a later ticket.)

## Known contract issues to decide explicitly before implementation

1. **Joined table cells vs verbatim quote:** Prompt says `Speech... | 60 min/week | Therapy room`; real page text may not contain inserted `|`. Literal exact-match verifier must reject the synthetic concatenation. Resolve with an approved v1 clarification or implement quote selection only from contiguous text; **do not weaken the verifier**.
2. **Output schema examples contain placeholder enum strings and `"YYYY-MM-DD|null"`:** treat these as documentation placeholders; actual JSON Schema must use nullable typed values and enums, not emit placeholders as facts.
3. **`general_knowledge` glossary has no supporting source page:** keep explanatory metadata separate from facts and from source-verified observations; do not emit claim-chips pretending it came from source.
4. **`document.summary` is a model-generated narrative:** display only after grounding to accepted fact IDs; summarizer prose is not a new source fact.
5. **One call per document vs bounded ranges:** output may be truncated even when model says complete; validate explicit page coverage and page window against Reader source data. Decide accepted partial behavior without implying `NOT_FOUND` on unreviewed pages.
6. **Compound documents:** prompt says one document, but combined PDFs can contain distinct logical docs; assign logical boundaries and preserve source page identity. Later cross-document merge is separate.
7. **Scanned documents and images:** exact quotation can differ from OCR. Define the authoritative read representation and original evidence highlighting before accepting those model anchors.
8. **`instructionsIgnored`:** potentially malicious source text is not an instruction. Store privately with safe quoting, not in logs or new prompt roles.

## Model routing and configuration

One approved server-side frontier-model adapter for V4, not a browser provider key. The specific frontier provider/gateway, aliases, structured output support, quotas and contracts are an **OPEN** technical/data-use gate. Do not create a new environment flag per extraction capability.

**Planning model (decided, D-039):** the web server calls only `v4-planner` (`planner-completion@1`, bearer `PLANNER_SERVICE_TOKEN`, `PLANNER_BASE_URL`). The planner forces alias `PLANNER_LITELLM_ALIAS` (`sorter`) against private LiteLLM with a scoped virtual key held only on Oracle; callers cannot choose a model.

## Validation layers

1. Parse/type-check output and delimit physical page/range.
2. Verify candidate evidence against independently stored pages and binding semantics.
3. Reconcile accepted observations into immutable Study revision.
4. Validate analysis citations and model-proposed A2UI view against accepted revision and allowed components.

For direct-model experiments, the user can paste the prompt independently; a successful JSON response does **not** prove downstream verification or a working V4 pipeline.

## Analytical Intelligence prompt and contract design reservation (2026-10-31)

**Do not change the exact approved `hive-extract/1`, `hive.doc-extraction/1` or standalone `hive-prep/1`.** New prompts/contracts remain **proposed**, requiring separate explicit IDs/versions and approval before integration. Recommended *roles* (not approved prompt names):

1. **Opportunity discovery:** input pinned Study fact/coverage manifest, user goal, safe capability catalog, budget; output candidate questions, relevance, prerequisites, evidence refs and missing inputs. No unsupported claim.
2. **Analysis planning:** output a typed, bounded intermediate representation of operators, fact refs, dependencies, method, applicable rule refs, units, validation assertions and planned result shape. No executable free-form code.
3. **Scenario compilation:** input immutable Study revision plus user assumptions; propose graph variables, conditional edges, equations/constraints, temporal assumptions, rules and unknowns; distinguish observational, legal/normative and causal dependencies.
4. **Result explanation:** present executed/verifiable results with fact/method/rule/assumption refs; separate conditional interpretation from verified statement.

**Boundary checks:** JSON schema/size/depth; owner and pinned revision refs; unit/type/date/subject compatibility; operator allowlist; cycles and missing graph nodes; externally sourced rule jurisdiction/effective date; unsafe goal/action screening; deterministic execution traces. Refusal or `BLOCKED` is an acceptable correct outcome. Model confidence is not proof. Distinct run identity/version and immutable input hashes for reproducibility. Adversarial fixtures must include invented facts, law without citation, coercive recommendations, unsatisfiable models and unsupported outcome prediction.
