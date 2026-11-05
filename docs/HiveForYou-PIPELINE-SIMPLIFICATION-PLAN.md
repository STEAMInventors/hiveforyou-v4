# HiveForYou V4 — Pipeline simplification plan

**Date:** 2026-11-05 | **Status:** DECIDED as D-052 (simplified pipeline) and D-053 (domain agnosticism) | **Reviewed commit:** `3ce9cbb` (feat(study): enforce corpus reconciliation gate V4-004L)

> **One line:** replace the two agent loops (Study investigator, Writer) with three single-shot, tool-free model calls — **Extract → Canonicalize → Write** — and move validation from *all-or-nothing gates* to *item-level verify-or-drop*. The same code, schemas and prompts serve every domain. Keep the reader, storage, auth, workflow skeleton and A2UI. Expected size: ~2,000 lines replacing ~19,000.

---

## 1. What the pipeline is today

| # | Stage (`analysis-workflow.ts` status) | Kind | Model calls |
|---|---|---|---|
| 0 | `READING_DOCUMENTS` — Python Reader → `document_pages` | code | 0 |
| 1 | `UNDERSTANDING_REQUEST` — intent decomposition (`hive-intent/1`) | model | 1 |
| 2 | `IDENTIFYING_DOMAIN` — domain from sampled pages (`hive-domain/1`) | model | 1 |
| 3 | `DEVELOPING_QUESTIONS` — intent intelligence + investigation plan | model | 1 |
| 4 | `PLANNING_INVESTIGATION` / `BUILDING_PROMPT` / `SAVING` | code | 0 |
| 5 | `INVESTIGATING` — Study agent: 13 tools, ID choreography (E… → DF… → finish_question → finish_study) | agent loop | up to 24 rounds / 200 tool calls |
| 6 | `VERIFYING_EVIDENCE` / `ACCEPTING_STUDY` — verifier + reconciliation gate | code | 0 |
| 7 | Report run — Writer agent: editorial plan tools, compiler, semantic review, repair | agent loop | up to 5 rounds / 48 tool calls + review |

Non-test code in the planner, study and writer path: **19,215 lines** (largest: `writer-agent.ts` 3,444; `study-agent.ts` 1,835; `canonical-finding-resolver.ts` 1,703; `study-verification.ts` 1,601; `editorial-plan-compiler.ts` 1,394).

The text extraction step (stage 0) is sound and stays.

## 2. Why it breaks — root causes

1. **An agent loop running against a serverless clock.** `STUDY_AGENT_BUDGET`: 235 s wall clock, 150 s per turn, 24 rounds, 200 tool calls, 12 invalid calls, $8 cap. The agent must read pages *through tool calls* (`read_pages`), so reading the case consumes rounds. `study-investigation.ts` says it outright: *nothing here is durable or resumable* — a timeout at round 20 throws away rounds 1–19.
2. **The model is asked to choreograph identifiers across turns.** `START_MESSAGE` is a five-step dependency protocol ("never predict E… or DF… identifiers before a tool result returns them"). Every misordered or invented ID is an invalid call; the cap is 12. This is bookkeeping work that code should do.
3. **All-or-nothing verification.** `study-verification.ts` + `corpus-reconciliation.ts` encode ~35 distinct rejection reasons (e.g. `study_finding_number_ungrounded`, `study_primary_document_unread_pages`, `document_reconciliation_invalid`). Any one fails the whole run, and `MODEL_OUTPUT_INVALID` is **not retryable**. One imperfect finding out of 120 kills the Study.
4. **Planning before reading.** Three model stages (intent, domain, questions) run before the investigator sees full documents. The Study is then organised around those questions, so coverage = whatever was asked. Nothing guarantees every element of the core document is accounted for.
5. **A second agent for writing.** The Writer re-plans, composes through tools, is compiled by a 1,394-line editorial compiler, semantically reviewed, and repaired. Rendering problems seen on the test case (raw values, duplicate rows, wording that assumed a prior version of a first-time document) come from the writer re-interpreting facts instead of rendering them.
6. **Fix-on-fix.** 30 of the last 60 commits are `fix:`. Each fix adds a gate, a recovery path or a budget dimension; complexity rises and reliability does not.
7. **The right prompt is already written and unused.** `prompts/hive-extract/HiveForYou-Extract-v1.md` (`hive-extract/1`, decision **D-005**) is a per-document, domain-blind ("you are not told what kind of document this is"), "no quote, no fact", verbatim, physical-page extractor — exactly the first stage this plan needs.

## 3. Domain agnosticism — rules and tests (D-053)

Domain agnosticism is a **requirement**, not a hope. It holds because everything domain-specific is either *read from the documents* or *typed by the user*; nothing is encoded in code, schemas or prompt templates.

### Rules

1. **Fixed, domain-free schemas.** Every stage uses the same shapes for every case:
   - *Fact:* `subject · attribute · value (as written) · period/as-of · modality · asserted by · evidence[doc, page, quote]`.
   - *Spine element:* `label · kind (commitment, figure, date, obligation, decision, claim…) · status · supporting / contradicting / updating fact IDs · missing evidence`.
   - *Conflict, timeline event, gap:* same shapes everywhere.
   No field, enum value or table column names a domain concept.
2. **The anchor is defined structurally, not by document type.** The anchor is *the document whose commitments, decisions or claims the other documents most bear on.* The model identifies it from the extracted facts. The code never holds a list of anchor document types.
3. **The spine always has a fallback.** Spine source, in order: anchor document → anchor chain (several versions) → dated timeline → index of parties and obligations.
4. **No domain words in code.** A test fails the build if application or contract source (`apps/`, `packages/`) contains domain nouns. Fixtures and eval data are exempt.
5. **Prompts stay domain-blind.** Prompt templates contain no domain vocabulary. Any example in a prompt is either abstract or drawn from at least three unrelated domains.
6. **Domain knowledge is optional context, never a dependency.** The domain brief (§7) may sharpen gap detection. The pipeline must produce a correct study with no brief at all; the eval runs both ways.
7. **Perspective is free text.** The audience or professional lens is whatever the user says, passed to the Write stage only. There is no enum of professions.

### Tests

- **Multi-domain golden set (V5-001).** Four synthetic corpora: special education (L001), a consumer bankruptcy case, an elder-care benefits denial, and one corpus with **no anchor document**. Same code, same prompts, same thresholds for all four. Each golden file also lists negative controls: claims a correct study must not make.
- **No-brief run.** Every eval runs with and without the domain brief.
- **Domain-word lint** in CI.

## 4. Target pipeline

```
READ (keep)          EXTRACT (new)             CANONICALIZE (new)          WRITE (new)
Python Reader   →    hive-extract/1            one call, whole case        one call per audience
document_pages       1 call per document       spine + evidence            prose with fact IDs
                     parallel, cached          conflicts, gaps, timeline   tables rendered by code
                     code: verify quotes       code: verify references     code: verify citations
```

### Design rules

- **No tool loops.** Each stage is one structured-output call. A call either returns parseable JSON or is retried once with the parse error appended. Nothing else is retried automatically.
- **Code owns identifiers.** The model never invents an ID that another stage depends on. After extraction, code assigns `F-<doc>-<n>` to facts and `P-<doc>-<n>` to people. Later stages cite those IDs; code checks they exist.
- **Verify or drop, per item.** A fact whose quote is not on its page is dropped and counted, not fatal. A canonical element citing an unknown fact ID loses that citation; if it has none left it is marked `UNSUPPORTED`. A run fails only on infrastructure errors or unparseable output after one retry. Drop rates are recorded per run — they are the quality signal.
- **Extract once, view many.** Extraction and the canonical study do not depend on the user's intent or audience. Intent and perspective enter only at the Write stage. (Keeps **D-007**.)
- **Documents in context, not behind tools.** Long documents are split into 20-page ranges at extraction; each range is verified against its own pages and merged.

### Stage 1 — Extract (`hive-extract/1`)

- Input: one document's page text with `=== PAGE n ===` markers (20-page ranges for longer documents).
- Output: `hive.doc-extraction/1` JSON.
- Code: verify every quote against its page (`normalizeQuoteText`), drop unverified items, assign final IDs, persist.
- Cache key: document content + prompt digest + model. Re-analysis or a new upload only extracts what changed.
- Runs as one workflow step **per document**, so a failure costs one document and the run resumes at document granularity.

### Stage 2 — Canonicalize (`hive-canonicalize/1`)

- Input: all verified extractions and, if available, the domain brief (§7).
- Output (`hive.canonical-study/1`): `documents[]` with roles and anchor chain; `spineSource`; `spine[]` with status and supporting / contradicting / updating fact IDs and missing evidence; `outsideSpine[]`; `conflicts[]`; `timeline[]`; `gaps[]`.
- Code: check every cited fact ID exists; drop unknown ones; mark empty elements `UNSUPPORTED`; persist as a Study revision.
- This one call replaces the old intent, domain, questions, plan, investigation and reconciliation stages.

### Stage 3 — Write (`hive-write/1`, one call per audience)

- Input: the canonical study (not raw documents), the user's intent, the audience/perspective as free text.
- Output: narrative sections, each sentence carrying fact IDs, plus an ordered list of deterministic blocks to show (`documents`, `spine_table`, `conflicts`, `timeline`, `gaps`, `outside_spine`).
- Code: drop sentences with no valid fact ID; render tables, values, dates and lists directly from canonical data. The model writes narrative only.

## 5. Keep · retire · add

**Keep:** source upload and reading, `document_pages`, auth, Hives, storage, error/observability framework, the stage-lease workflow skeleton, A2UI primitives, `normalizeQuoteText` (moved to `pipeline/verify-quotes.ts`).

**Retire after cutover (no feature flag — D-008):** the Study agent, verifier, reconciliation and finding resolver; the planning contracts and prompt builder; the Writer agent, editorial plan compiler and semantic review; the prompts `hive-intent`, `hive-intent-intelligence`, `hive-domain`, `hive-plan`, `hive-study`, `hive-writer` (archived, not deleted from history).

**Add (~2,000 lines including tests):** extract, canonicalize and write runners; reference verification; three schemas; two prompts; one migration (`doc_extractions`, study revision format); the eval harness; the domain-word lint.

## 6. Sequence

| Ticket | Scope |
|---|---|
| **V5-000** | Decisions D-052/D-053, this plan in `docs/`, planner tasks `extract`, `canonicalize`, `write` |
| **V5-001** | Four synthetic corpora with reviewed golden labels and negative controls; eval harness |
| **V5-002** | Extract stage and quote verification |
| **V5-003** | Canonicalize stage |
| **V5-004** | Write stage and study view |
| **V5-005** | Additive migration; wire the new stages into the workflow and UI; export UI runs to the eval |
| **V5-006** | Surgical removal of the old pipeline by reachability; docs sync |

Founder decision (2026-11-05): V5-002 to V5-004 are built and unit-tested offline; paid evaluation runs happen through the UI after V5-005, scored with the eval harness via an export script.

## 7. Domain brief — optional context, generated, never required

A ~10-line text block the model writes from the case's own document identities the first time it meets a domain: which document is usually central, its key sections, typical supporting documents, and what a professional checks first. Cached by domain label; the founder or a professional may review, edit or replace it (for example with a firm's own checklist), but never has to author one. It only sharpens `missing` and `gaps`. Per §3 rule 6, the pipeline must pass the eval without it. Keeps **D-004** (pack-free by default): domain knowledge lives in data, never in code or schemas.

## 8. Risks and decisions

- **D-022** (`hive-extract/1` contract clarifications) and a proposed `hive-extract/2` with domain-neutral examples are evaluated against the `/1` baseline before adoption.
- **Run time:** each call fits inside the stage lease and Vercel's limit; per-call latency is logged. If UI runs show timeouts, the founder chooses between an Oracle worker and Inngest (**D-016**).
- **Planner reachability:** the planner needs a permanent address (named Cloudflare tunnel); quick tunnels change name on restart.
- **D-017 / D-018** (provider, retention, tokenization) are unchanged and still gate real PHI.
- **Decisions recorded:** **D-052** (simplified pipeline) supersedes the implementations of D-041 (stage list), D-042 (agentic investigation), D-045/D-047 (agentic writer), D-050 (corpus reconciliation gate) and D-051 (Study agent execution policy). **D-053** makes domain agnosticism a hard constraint. D-011 (no source, no claim) is unchanged and strengthened: every rendered sentence and table cell traces to a verified quote.

## 9. Appendix — canonicalize prompt sketch (domain-blind)

```
You receive verified facts extracted from every document in one case. Each fact has an ID,
a document, a page and a verbatim quote. You never see the documents themselves, and you
are not told what field the case belongs to. Work that out from the facts.

1. Classify each document: ANCHOR (the document whose commitments, decisions or claims the
   other documents most bear on), SUPPORTING, or REFERENCE. If several versions of the
   anchor exist, order them as a chain.
2. Choose the spine source: the anchor, the anchor chain, or — if no document plays that
   role — the dated timeline, or failing that, the parties and their obligations.
3. Build the spine: list every commitment, figure, date, obligation, decision and claim in
   the spine source as a separate element.
4. For each element, cite the fact IDs that support it, contradict it or update it, and
   state what evidence a careful professional would expect but cannot find.
5. List findings outside the spine, conflicts (both sides cited), a dated timeline, and
   case-level gaps.

Cite only fact IDs that appear in the input. Do not state anything without at least one
fact ID. If there is no anchor document, say so as the first gap.
```
