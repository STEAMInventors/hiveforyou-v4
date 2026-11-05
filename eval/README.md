# HiveForYou evaluation harness

Domain-agnostic corpora with golden labels, and a scorer that every pipeline stage is measured against. All names and data are synthetic and fictional.

## Layout

- `corpora/<corpus-id>/docs/*.pdf` - the documents a run reads.
- `corpora/<corpus-id>/source/*.md` - Markdown the PDFs are generated from (generated corpora only).
- `corpora/<corpus-id>/README.md` - the case, the documents, and what was planted.
- `corpora/<corpus-id>/golden.json` - golden labels (`reviewed: false` until the founder reviews them).
- `tools/build-corpora.mts` - regenerates the PDFs: `node eval/tools/build-corpora.mts [corpus-id ...]`. It fails if a page overflows (so golden page numbers stay exact), checks that every page carries extractable text, and checks that every golden `quoteFragment` appears on its stated page.
- `runs/<timestamp>/<corpus-id>/` - stage outputs of one run (git-ignored).

## Scoring a run

```
npm run eval -- <corpus-id> eval/runs/<timestamp>/<corpus-id>
```

Prints the scores and writes `eval-summary.json` into the run folder. A stage output that is absent is reported as `not run`; one that cannot be parsed is reported as `invalid` (exit code 1).

## Stage outputs read from the run folder

### `extract/<file>.json` and `extract-stats.json`

Written by `npm run extract -- <corpus-id> [run-timestamp]` (`scripts/run-extract.ts`), which runs `hive-extract/1` through the planner `extract` task once per document (or once per 20-page range). It needs `PLANNER_BASE_URL` and `PLANNER_SERVICE_TOKEN`. Page text comes from the Reader when `READER_BASE_URL` and `READER_SERVICE_TOKEN` are set, otherwise from local extraction with unpdf (`textSource: "local text (unpdf)"` in the stats).

`extract/<file>.json` is one `hive.doc-extraction/1` object per document (`prompts/hive-extract/HiveForYou-Extract-v1.md`, section 5) after code checks. It holds only what survived quote verification. Fact ids are final and unique across the run: `F-<doc>-NNN`, where `<doc>` is the first 8 hex digits of the document id (likewise `E-<doc>-NNN` for empty fields and `R-<doc>-NNN` for referenced documents). The model's own id is kept in `modelId`. People in `document.aboutPeople` get `P-<doc>-NNN`: people with the same `nameAsWritten` (whitespace, typographic quotes and case ignored) are merged across page ranges, their model refs (`P1`, or `p21-40:P1` for a range) are kept in `modelRefs`, and every fact's `aboutPersonRef` is rewritten to the final id (`null` when no kept person has that ref).

```json
{
  "schema": "hive.doc-extraction/1",
  "documentId": "3f2a9c1e-....",
  "fileName": "02_denial_notice.pdf",
  "facts": [
    { "id": "F-3f2a9c1e-001", "modelId": "F001", "subject": "...", "valueAsWritten": "$8,420.00",
      "evidence": [{ "page": 1, "printedPageLabel": null, "quote": "Your countable resources are $8,420.00." }] }
  ]
}
```

`extract-stats.json` records, per document: `factsProposed` (facts in the model answer), `malformed` (items dropped before verification, by reason), `factsIn` (well-formed facts whose quotes were checked), `factsKept`, `evidenceIn`, `evidenceDropped`, `byReason` (rejected evidence by reason), every dropped evidence item in `dropped`, and per planner call the input and output tokens, latency, finish reason and outcome. A document whose extraction failed has `ok: false` and no `extract/<file>.json`.

Quote verification: an evidence quote is kept when its normalized text (whitespace collapsed, typographic quotes folded, case kept) appears on the stated page; a table row quoted with `|` is kept when every cell appears on that page. A fact with no surviving evidence is dropped; the same rule applies to empty fields and referenced documents.

- Quote verify rate per document = facts kept / facts checked (`factsIn`). Malformed facts are reported separately.
- Facts dropped = facts proposed - facts kept.
- Only kept facts can count as evidence below: dropped facts have no final id and appear only as counts in `extract-stats.json`.

### `canonical.json`, `canonicalize-stats.json` and `brief.txt`

Written by `npm run canonicalize -- <corpus-id> <run-folder> [--brief]` (`scripts/run-canonicalize.ts`), which reads `extract/*.json` from the run folder, runs `hive-canonicalize/1` (`prompts/hive-canonicalize/HiveForYou-Canonicalize-v1.md`) through the planner `canonicalize` task in one call, and then runs the scorer on the same folder. It needs `PLANNER_BASE_URL` and `PLANNER_SERVICE_TOKEN`. With `--brief` it first asks for a 10-line domain brief from the document identity blocks only, saves it as `brief.txt`, and passes it to `hive-canonicalize/1`. To compare a run without and with the brief, copy `extract/` and `extract-stats.json` into a second run folder and run once in each.

`canonical.json` is one `hive.canonical-study/1` object after code checks (`verifyCanonicalStudy` in `packages/contracts/src/pipeline/canonical-study-contracts.ts`):

```json
{
  "schema": "hive.canonical-study/1",
  "documents": [{ "sourceDocumentId": "3f2a9c1e-....", "role": "ANCHOR", "typeInPlainWords": "...", "date": "2026-07-08", "version": null, "chainPosition": null }],
  "spineSource": "ANCHOR",
  "spine": [{ "id": "S1", "label": "...", "kind": "figure", "status": "CONFLICTED",
    "supportingFactIds": ["F-3f2a9c1e-001"], "contradictingFactIds": ["F-7b01d2aa-004"], "updatingFactIds": [], "missing": [] }],
  "outsideSpine": [{ "id": "O1", "statement": "...", "factIds": ["F-7b01d2aa-002"] }],
  "conflicts": [{ "id": "C1", "statement": "...", "factIds": ["F-3f2a9c1e-001", "F-7b01d2aa-004"] }],
  "timeline": [{ "date": "2026-07-08", "asWritten": "July 8, 2026", "statement": "...", "factIds": ["F-3f2a9c1e-003"] }],
  "gaps": [{ "id": "X1", "statement": "...", "relatedSpineIds": ["S1"] }],
  "domainLabel": "..."
}
```

- `role` is `ANCHOR`, `SUPPORTING` or `REFERENCE`. In an anchor chain every version is `ANCHOR` and `chainPosition` counts from 1 (earliest); the scorer's predicted anchor is the `ANCHOR` document with the highest `chainPosition`, named by its file through `extract/<file>.json` `documentId`.
- `spineSource` is one of `ANCHOR`, `ANCHOR_CHAIN`, `TIMELINE`, `PARTIES_AND_OBLIGATIONS`, or `null` when the model gave none.
- Code assigns `S…`, `O…`, `C…` and `X…` ids in output order; the model's ids are used only to resolve `relatedSpineIds`.
- Verification removes fact ids that are not kept facts of the case, sets a spine element with no remaining supporting or updating fact to `UNSUPPORTED`, and drops conflicts left with fewer than two fact ids. Everything else is kept. The counts are in `canonicalize-stats.json` under `drops`; items the parser dropped as malformed are under `malformed`.

`canonicalize-stats.json` also records the payload size, per planner call the input and output tokens, latency, finish reason and resolved model, and in `totals` the summed input and output tokens and the distinct resolved models. It does not estimate cost.

### `write.md`

The written output in Markdown. Citations are bracketed fact ids such as `[F-3f2a9c1e-001]` or `[F-3f2a9c1e-001, F-7b01d2aa-004]`. Headings and table rules are ignored; every other sentence without a citation is counted as uncited. Citations to ids that are not in `extract/` are listed.

## Golden labels (`golden.json`)

```json
{
  "anchorDocument": "<file name or null>",
  "spineSource": "ANCHOR|ANCHOR_CHAIN|TIMELINE|PARTIES_AND_OBLIGATIONS, or a list of acceptable values",
  "spine": [{ "id": "G1", "label": "...", "kind": "commitment|figure|date|obligation|decision|claim", "expectedStatus": "...", "evidence": [{ "file": "...", "page": 1, "quoteFragment": "..." }] }],
  "conflicts": [{ "id": "C1", "description": "...", "evidence": ["two or more locations"] }],
  "gaps": [{ "id": "X1", "description": "..." }],
  "negativeControls": [{ "id": "N1", "statement": "...", "why": "..." }],
  "reviewed": false
}
```

`negativeControls` is optional: claims a correct study must not make, such as a superseded value presented as current, a non-contradiction called a conflict, or a statement about a document that is not in the corpus. `why` cites the documents that rule the claim out. Extra fields (for example `origin` in `special-ed-l001`) are ignored by the scorer.

## Matching rule

A predicted fact matches a golden evidence location when it is in the same file and one of its evidence items is on the same page with a quote that contains the golden `quoteFragment`, ignoring case, whitespace and typographic punctuation.

- **Spine coverage:** a golden spine element is covered when one predicted element cites (as supporting, contradicting or updating fact) a fact that matches any of its evidence locations. When several predicted elements match, the one with the expected status is shown.
- **Status:** scored only where the golden `expectedStatus` is `SUPERSEDED` or `UNSUPPORTED`: the number of such elements matched by a predicted element with the same status. Other statuses are shown but not scored.
- **Conflicts:** a golden conflict is found when one predicted conflict cites facts matching at least two of its evidence locations. Predicted conflicts that satisfy no golden conflict are listed as **unmatched conflicts**: each is a likely false positive to check by hand. In a corpus with no golden conflicts (`special-ed-l001`), every predicted conflict is a false positive.
- **Negative controls:** listed next to the predicted spine statements (`spine[].label` and `status`) for a manual check that none of them asserts a negative control. Not matched automatically yet.
- **Gaps:** listed side by side for a manual check; not scored.
- **Anchor / spine source:** exact match (file names compared case-insensitively); the spine source is correct when it is one of the golden values.

Golden `expectedStatus` values used so far: `CURRENT`, `SUPERSEDED`, `SUPPORTED`, `CONFLICTED`, `UNSUPPORTED`, `OPEN`.
