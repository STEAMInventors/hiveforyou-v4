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
| **`hive-intent-intelligence/1`** | [`../prompts/hive-intent-intelligence/HiveForYou-Intent-Intelligence-v1.md`](../prompts/hive-intent-intelligence/HiveForYou-Intent-Intelligence-v1.md) | Developing specialist questions (D-040) | `hive.intent-intelligence/1` JSON from the verbatim intents (with optional audience), validated decomposition, domain and the same page sample: every substantive question a domain specialist would investigate (`I` ids) with objective, covered decomposed questions, why it matters, outcome supported, dependencies, judgment flag + criterion, sampled-page context refs; plus a passed outcome-completeness review per objective. Generated per Hive; no domain checklists |
| **`hive-plan/1`** | [`../prompts/hive-plan/HiveForYou-Plan-v1.md`](../prompts/hive-plan/HiveForYou-Plan-v1.md) | Planning investigation | `hive.investigation-plan/1` JSON from the validated decomposition, specialist questions *and* domain proposal; every plan question names the `specialistQuestionIds` it answers (all must be covered), its `sourceDependencies`, and an `evaluation` wherever a specialist question needs judgment; domain basis must match the validated domain |
| **`hive-study-preview/1`** | [`../prompts/hive-study/HiveForYou-Study-Preview-v1.md`](../prompts/hive-study/HiveForYou-Study-Preview-v1.md) | Building prompt (deterministic template, no model call); system prompt of the agentic `INVESTIGATING` loop (D-042) | Nine-section Canonical Study prompt: sections 1–7 (rules, intents, audiences, objectives, plan, coverage, tool-based output rules), section 8 "How to investigate" and section 9 "Case page index" (`{{SOURCE_PAGES}}`, bound to `hive.source-page-index/1` at execution: document ids, page ranges, character counts — no page text), + `hive.study-execution-manifest/1`. The model works through eleven tools; trusted code assembles the output contract `hive.study-investigation/1` ([schema](../prompts/hive-study/hive.study-investigation-1.schema.json)). Each answer separates `facts`, `calculations`, `assessments` (judgment, declared criterion + source, fact indexes, reasoning, strength, what would change it), `uncertainties` and `professionalDeterminations` (D-040) |

Rules: uploaded text is untrusted data delimited in the user message and never placed in the system role; instructions found in documents are ignored. Prompt files are digested (sha256 over LF-normalized text) at load time; each stage records prompt ID, digest, model alias, token usage, latency and error code, never prompt or page text. There is no domain switch statement; unknown domains stay supported and uncertain classifications are preserved.

Outcome-oriented planning (founder refinement, 2026-11-01): `hive-intent/1` rule 3 and `hive-plan/1` rule 4 were edited to forbid restating the request and to require spelled-out comparison/chronology/calculation logic, evidence limits (`missingEvidenceConditions`) and answer structure (`deliverable`). Trusted code enforces this: `question_restates_intent` (word-set similarity ≥ 0.85 with any verbatim request) and `answer_logic_missing`. Prompt digests changed accordingly; previews record the digests they were built with.

Intent intelligence and assessments (founder refinement, 2026-11-02, D-040): new prompt `hive-intent-intelligence/1`; `hive-plan/1` and `hive-study-preview/1` and the `hive.study-investigation/1` schema were edited in place (ids stay `/1`; no accepted Study existed). The blanket "no verdicts" rule is replaced by evidence-backed assessment rules: judgments only on cited facts, a declared criterion, written reasoning and a stated strength; professional/legal determinations are left to the named professional. Trusted code enforces `objective_not_covered`, `question_not_covered`, `judgment_basis_missing`, `outcome_incomplete`, `completeness_review_missing` and, for the plan, `question_not_covered` over specialist questions and `evaluation_missing`.

Audiences, Study execution and Writers (founder-approved end-to-end plan, 2026-11-02, D-041). Edits to accepted prompt texts, made at the founder's request (ids stay `/1`; no accepted Study or report existed):

- **`hive-intent/1`:** new rule 14 and Section 6A — the output gains `audienceAnalysis` (Customer role with `STATED`/`INFERRED` only on an exact quotation of the request or stated audience, `PROVISIONAL` from the glossary, otherwise `UNKNOWN`; Pro `primaryRole` plus up to four `alternativeRoles`; tone, `detailLevel`, `studyGuidance`, `writerGuidance`). Never infers personal characteristics; never changes goals.
- **`hive-intent-intelligence/1`:** rule 8 now refines both audiences into `audience` and records each change in `audienceChanges`; document context may raise a Customer role at most to `PROVISIONAL` with sampled-page `contextRefs`.
- **`hive-plan/1`:** rule 9 — one neutral investigation serves both audiences; input carries `audienceConfiguration` (`hive.audience-configuration/1`); audiences may widen coverage, never lower evidence requirements.
- **`hive-study-preview/1`:** new `{{AUDIENCES}}` section ("Who this investigation serves"); `{{SOURCE_PAGES}}` is now filled by the `INVESTIGATING` stage (planner task `study`). **`hive.study-investigation/1` schema:** each calculation may carry a `formula` tree (`input`, `value`, `+ - * / min max round`); code recomputes it, and a calculation without a reproducible formula is shown as unverified.
- **New `hive-writer/1`** ([prompt](../prompts/hive-writer/HiveForYou-Writer-v1.md), [schema `hive.writer-report/1`](../prompts/hive-writer/hive.writer-report-1.schema.json)): one call per audience over one accepted revision's claim catalog. Prose may cite only catalog claim ids and bind numbers through `{{calc:…}}` / `{{result:…}}`; scenarios name catalog inputs and assumptions, and code recomputes them; the A2UI view is checked against the allowlisted component catalog. Validators accept or reject; nothing is repaired. **V4-004B refinement (2026-11-03, D-043):** `hive-writer/1` (digest `sha256:b738806c29058e310795888f31f8bab40a950ba45d47bd6a07dc7a10f1a2f9cc`) explicitly specifies allowed and forbidden `(block.type, claim.kind)` pairs with JSON block examples, requires specific `.F`/`.C`/`.K`/`.A`/`.D` claims instead of broad question-level `ANSWER` claims in granular A2UI components and scenario parameters whenever atomic facts exist, carries `criterion` and `criterionSource` (`DOCUMENT` | `GENERAL_KNOWLEDGE`) on `ASSESSMENT` claims while keeping `quotes` strictly to verbatim source quotes, forbids duplicating structured components inside `Narrative` sections, and counts structured components toward mandatory uncertainty coverage only when their prose visibly states the uncertainty (`visiblyPresentsUncertainty`).

Model routing for execution: the Study uses `PLANNER_STUDY_LITELLM_ALIAS` (approved `heavy_lifter`) and task `writer` uses `PLANNER_WRITER_LITELLM_ALIAS` (approved `harvester`); both fail closed when unset and never fall back to `sorter`. Writer model timeout 270 s within the 300 s function limit.

Implementation status: implemented locally (uncommitted); planner not yet redeployed; no paid model run performed.

Agentic Canonical Study (founder-approved, 2026-11-03, D-042, ticket V4-004A). Documented edit of `hive-study-preview/1` (id stays `/1`; no accepted Study existed): the execution instructions name the tools; rule 9 "Look for what cuts the other way" is added; section 7 describes recording through tools instead of returning JSON; section 8 is "How to investigate" and section 9 "Case page index". Sections 2–5 slots are unchanged. Template digest `sha256:fc0651fc…0ee36` → `sha256:ed29966b…036ad` (full values in D-042). The manifest binding format becomes `hive.source-page-index/1`; previews with `hive.source-pages/1` are refused at `INVESTIGATING` (`study_preview_outdated`).

- **Contract `study-agent-turn@1`** (`POST /v1/study-agent-turn` on `v4-planner`): request `{contract_version, prompt_id: hive-study-preview/1, prompt_digest, system_prompt, messages[user|assistant(tool_calls)|tool], tools (exactly the eleven), max_output_tokens ≤ 8000, timeout_seconds 5–240}`; response `{contract_version, model_alias, resolved_model, message: {content, tool_calls: [{id, name, arguments}]}, usage, latency_ms, finish_reason}`. Errors use `planner-error@1` with operation `study_agent_turn`. Oracle relays; it never executes a tool.
- **Tools** (`STUDY_AGENT_TOOLS`, closed argument objects): `search_case` (snippets, not evidence), `read_pages` (≤ 3 authorized pages, verbatim), `record_evidence` (contiguous quote on a page already read), `record_fact`, `record_calculation` (formula tree, recomputed), `record_assessment` (a `DOCUMENT` criterion cites evidence ids; a `GENERAL_KNOWLEDGE` criterion cites none), `record_determination`, `record_conflict`, `record_uncertainty`, `finish_question` (`ANSWERED` needs a finding, answer evidence and no conflict; `PARTIALLY_ANSWERED` a finding and a limitation; `CONFLICTING` a flagged conflict; `MISSING_EVIDENCE` a limitation and at least one prior search), `finish_study`.
- **Assembly:** after `finish_study` the ledger builds `hive.study-investigation/1` deterministically; the existing verifier is the final gate. Budget exhaustion fails the run (`study_agent_budget_exhausted`) and is never reported as missing evidence.

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

**Planning model (decided, D-039):** the web server calls only `v4-planner` (`planner-completion@1`, bearer `PLANNER_SERVICE_TOKEN`, `PLANNER_BASE_URL`). The planner forces alias `PLANNER_LITELLM_ALIAS` (`sorter`) against private LiteLLM with a scoped virtual key held only on Oracle; callers cannot choose a model. Per-task overrides live in the planner's `TASK_MODEL_ALIASES` code constant (D-040: `intelligence` starts on `sorter` and can be switched to `harvester` for comparison by a reviewed code change). D-041 adds `study` → `PLANNER_STUDY_LITELLM_ALIAS` and `writer` → `PLANNER_WRITER_LITELLM_ALIAS`, which are required and have no default. D-042 moves the Study from `planner-completion@1` to the `study-agent-turn@1` relay on the same alias; no provider structured-output mode is used.

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
