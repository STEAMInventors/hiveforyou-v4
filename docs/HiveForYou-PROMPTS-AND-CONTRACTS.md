# HiveForYou V4 — Prompt and model contract index

**Version:** 0.1 | **Status:** Prompt text is selected by founder; parsers/validators not implemented in V4 yet.

## Exact selected prompts

| ID | File | Role | Output |
|---|---|---|---|
| **`hive-extract/1`** | [`../prompts/hive-extract/HiveForYou-Extract-v1.md`](../prompts/hive-extract/HiveForYou-Extract-v1.md) | Domain-free, intent-free source extraction; one document or bounded physical page range. | **`hive.doc-extraction/1` JSON**, *untrusted candidates*. |
| **`hive-prep/1`** | [`../prompts/hive-prep/HiveForYou-Prep-v1.md`](../prompts/hive-prep/HiveForYou-Prep-v1.md) | One-call direct frontier/Opal **IEP meeting preparation** from uploaded documents + question; not a normal Study stage. | Markdown report with model-generated source chips; citations not independently verified. |

These prompt files reproduce the user-selected specification rather than modifying it to fit legacy code. Never substitute prior `source-fact-discovery-output@1` or Pack fact catalog for `hive.doc-extraction/1`.

## Implementation integration (future V4-004)

- Load/version controlled `hive-extract/1` prompt, substitute `documentId`, `fileName`, `pageRange` and supplied source pages, ensuring system text and user payload stay separate and document bytes remain *data*.
- Use strict JSON parsing/schema validation and model-output budget/coverage reporting; require `schema: hive.doc-extraction/1` and a single source ID. No fallback to a domain-based default when unset.
- Store prompt ID, immutable prompt digest, schema version, model alias/response metadata and page source digest with every extraction batch. Never log prompt with private pages.
- Every `facts[].evidence[]` references physical page; distinct printed-page label is not positional page number. Model-local IDs must be mapped to DB UUIDs with range context.
- Constrain allowed entity/fact/evidence fields and records; separate `facts`, `emptyFields`, `referencedDocuments`, `glossary`, `instructionsIgnored` and coverage as different trust categories.
- Preserve repeated records and grouped row properties, as well as `modality`, `attributedTo`, `valueAsWritten`, numeric units and effective/as-of dates.
- **No candidate is promoted** without independently checking quote, source/page identity, claimed value and record relationship. Derivations and glossary general knowledge never become document claims merely because present in output.
- Later Study/Writer/A2UI prompts must be separately specified and approved; do not invent their IDs or output schema as implemented here.

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

One approved server-side frontier-model adapter for V4, not a browser provider key. The specific provider/gateway, aliases, structured output support, quotas and contracts are an **OPEN** technical/data-use gate. Do not create a new environment flag per extraction capability. No new V4 configuration variable is approved by this document.

## Validation layers

1. Parse/type-check output and delimit physical page/range.
2. Verify candidate evidence against independently stored pages and binding semantics.
3. Reconcile accepted observations into immutable Study revision.
4. Validate analysis citations and model-proposed A2UI view against accepted revision and allowed components.

For direct-model experiments, the user can paste the prompt independently; a successful JSON response does **not** prove downstream verification or a working V4 pipeline.
