# HiveForYou — Cursor prompts: domain packs in reports

**Date:** 2026-11-11 (rev 2: personas added) | **Supersedes:** the "Domain pack prompt (Cursor)" block formerly in `claude/HiveForYou-V5-STATUS.md` | **Pack:** `claude/HiveForYou-Pack-iep-initial.md` **v5** (pack format 2)

Which prompt to paste:
- DP-1 not yet run: paste **DP-1** below (personas are already in it).
- DP-1 already run against pack v4: replace the pack file with v5, then paste **DP-1b**.
- Then **DP-2**.

## Design in one page

A pack is data. Generic code parses it; the model fills it in from cited facts; code verifies, computes and renders. No domain word enters `apps/` or `packages/` (D-053).

| Pack section | Who uses it | What comes out |
|---|---|---|
| Front matter `matches` | code (selection, no model call) | pack id + version on the run |
| Personas | canonicalize gets **both** personas' "Looking for" questions; write gets the **one** persona for its audience | `personaCoverage[]` in the Study; each report opens by answering its reader's questions |
| Rules, Checks, Chains | canonicalize prompt | `checklist[]`, `chains[]` with fact ids |
| Computed values, Reference tables | canonicalize binds inputs to fact ids; **code** does the arithmetic | `computed[]` |
| Documents usually needed | code | not-shown checks become classified document requests (existing D-056 component) |
| Ask the person | UI + write prompt | person statements, shown as "You told us" |
| Terms, General notes | **code** renders verbatim | "Words used", "In general" blocks; the model never writes general knowledge |
| Customer report / Professional report | write prompt + code | section order, which blocks go where, voice |

Personas and D-007 (one Study, many views): the Study always receives both personas, whoever is looking, so it stays the same for every viewer. Only the write stage is persona-specific.

Why the model never writes general knowledge: today every sentence must cite a fact id or it is dropped. Keeping that rule intact and rendering pack text by code means D-011 needs no exception. The same applies to persona questions the documents cannot answer: code lists them as "These documents don't show", the model does not write that sentence.

Verify-or-drop additions (same philosophy as V5):
- Unknown check id, chain id, compute id or persona question id: dropped and counted.
- Verdict SHOWN, PARTLY_SHOWN or CONFLICT with no valid fact id: downgraded to NOT_SHOWN and counted. Persona coverage ANSWERABLE or PARTLY with no valid fact id: downgraded to NOT_ANSWERABLE and counted.
- Computed value whose inputs do not parse as the type the op needs: dropped and counted, never estimated.
- A pack that fails to parse: the run continues with no pack and records why.

---

## Prompt DP-1 — Pack loader, personas, checklist verdicts, report templates

```
Scope: packs/ folder at repo root (files already placed by me); new
packages/contracts/src/pipeline/pack-contracts.ts; apps/web/src/server/pipeline/ (pack loader,
selection, canonicalize runner, write runner, study view builder); prompts/hive-canonicalize and
prompts/hive-write; planner prompt ids if they are pinned; Study and Reports UI header and the new
blocks; one migration. Implementation is authorized for exactly this scope. Respect D-053: no domain
words in apps/ or packages/ source or tests - unit tests use a neutral fixture pack (e.g.
"widget-review") under packages/contracts/src/testing/fixtures/. Respect D-055: no new triggers.
Respect D-008: no new feature flags; a pack either matches or not.

Goal: when a case matches a pack, the Study gains a verdict checklist, alignment chains and coverage
of each reader's questions, all built from cited facts, and each report is written for its reader and
follows the pack's section order. With no matching pack, behaviour is exactly as today.

1. Decision record. Add to docs/HiveForYou-DECISIONS.md:
   D-058 DECIDED (founder, 2026-11-11): Domain packs are optional, versioned data files (pack format 2)
   that supply the two reader personas and what each is looking for, a verdict checklist, alignment
   chains, computed values, document expectations, intake questions and per-audience report templates.
   Generic code parses them; the model assigns verdicts only from cited facts; code computes, verifies
   and renders. The Study always receives both personas (D-007 unchanged); only the write stage is
   persona-specific. Refines D-004; D-011 and D-053 unchanged.

2. Pack files. packs/HiveForYou-Pack-iep-initial.md must exist with "version: 5" in its front matter;
   if it is missing or a different version, stop and tell me. Do not edit it.
   packs/HiveForYou-Pack-chapter13-confirmation.md is v1: it has no format-2 sections and must load
   as "brief only" (step 3). Do not edit it either.

3. pack-contracts.ts, schema "hive.pack/2": types and a hand-written parser for the markdown file.
   - Front matter: pack, version, title, description, matches.intent[], matches.documents[],
     jurisdiction, verified, status.
   - Sections are located by H2 heading text; tables by header row. Fixed section names: Rules,
     Personas, Ask the person, Checks, Chains, Computed values, Reference tables, Documents usually
     needed, Terms, General notes, Customer report, Professional report, Sources. All optional.
   - Personas: each H3 under Personas is one persona; its heading maps to an audience key
     ("Customer" -> customer, "Professional" -> professional). Table columns Field, Content. Fields:
     Who, Situation, Knows, Does not know, Looking for, Decisions, Useful when, Leave out, Success
     test. Cells with ";" are lists. "Looking for" items start with an id (L1, L2, ...) followed by
     the question; ids are unique within a persona.
   - Checks: rows from every table under the Checks H2 (H3 sub-headings become the row's group).
     Columns Id, Check, Evidence, Authority, Question ("-" = none). Ids unique or the pack is invalid.
   - Chains: Id, Label, Links (split on ";").
   - Documents usually needed: Document, Holder, When, Settles (comma-separated check ids). Map Holder
     and When onto the existing gap classification (holder type; REQUESTABLE_DOCUMENT for
     "before signing"/"if ..." rows, FUTURE_RECORD for rows containing "(later)").
   - Terms: Term, Plain meaning. General notes: Id, Show when, Text.
   - Customer report / Professional report: the Title line, the table (Order, Section, Built from)
     and the Voice line. In "Built from", tokens "block <name>" list deterministic blocks; the text
     after "narrative:" is the instruction for the model; a trailing "(L1, L2)" names the persona
     questions that section serves.
   - Computed values, Reference tables, Ask the person: parse and expose, but this prompt does not
     use them (DP-2 does).
   - A file with none of these sections is valid: body = brief only (today's behaviour).
   Tests on the neutral fixture: every section parsed, duplicate id rejected, brief-only pack accepted.

4. Selection (generic, no model call): after extraction, score each pack by case-insensitive matches of
   matches.intent against the request text and matches.documents against extracted document
   types/titles; pick the top pack above a threshold constant, else none. Record
   { id, version, score } under key "domainPack" via patch_processing_run_workflow_state - add the key
   to its allowlist in a NEW migration that starts from the function's LATEST definition (grep all
   migrations). Pin pack id + version on the Study revision so reports render against the same pack.

5. Canonicalize (the Study). Bump the prompt to hive-canonicalize/2 (keep /1 loadable for old
   revisions; mirror the id wherever prompt ids are pinned, including infra/oracle if applicable, and
   report the deploy steps). When a pack is selected, add to the input: Rules; BOTH personas (Who,
   Situation, Looking for, Decisions only); Checks (Id, Check, Evidence only - never Authority or
   Question); Chains; and the Document column of Documents usually needed.
   Add one domain-blind instruction block:
     "Two kinds of reader will use this study; they are described under Readers with the questions
      each is trying to answer. Build one study that serves both: make sure the spine, findings,
      conflicts and gaps contain what is needed to answer every reader question. Then, for each
      reader question, say whether these facts can answer it: ANSWERABLE, PARTLY or NOT_ANSWERABLE,
      citing the fact ids that carry the answer and, if not fully answerable, naming in at most 20
      words what is missing. Do not write the answer itself.
      A specialist checklist is attached. For every check return one verdict: SHOWN, PARTLY_SHOWN,
      NOT_SHOWN, CONFLICT or NOT_APPLICABLE. SHOWN, PARTLY_SHOWN and CONFLICT must cite fact ids;
      CONFLICT cites both sides. NOT_SHOWN means the facts do not show it - never that it did not
      happen. NOT_APPLICABLE needs a fact id showing why, or the note 'condition not present'.
      Add a note of at most 25 words saying what is or is not shown. For each chain, return one row
      per starting item with a cell per link: the fact ids for that link, or missing. Do not use the
      readers, the checklist or the chains as a source of facts about this case."
   Output additions to hive.canonical-study (additive, optional):
     personaCoverage: [ { audience, questionId, status, factIds[], checkIds[], missing } ]
     checklist: [ { checkId, verdict, factIds[], note } ]
     chains: [ { chainId, rows: [ { label, links: [ { factIds[] } | { missing: true } ] } ] } ]
     questionOrder: [ checkId ]  // not-SHOWN checks that have a Question, most important first
   Code, verify-or-drop:
   - unknown check id, chain id or persona question id: dropped and counted;
   - SHOWN, PARTLY_SHOWN or CONFLICT with no valid fact id: downgraded to NOT_SHOWN and counted;
   - ANSWERABLE or PARTLY with no valid fact id: downgraded to NOT_ANSWERABLE and counted;
   - a check or persona question the model omitted: recorded NOT_ASSESSED and counted;
   - a pack that fails to parse: the run continues with no pack and records why.
   For each check that is NOT_SHOWN or PARTLY_SHOWN and appears in a "Settles" cell, create or merge a
   gap using that row's document name, holder and timing, linked to the check id (dedupe against gaps
   the model already raised by document name).

6. Study view blocks, built BY CODE (extend hive.study-view):
   - "checklist": one row per check: id, group, check text, verdict, note, source refs; Authority from
     the pack. Sort not-SHOWN first.
   - "chains": one table per chain, missing links marked.
   - "questions": for each id in questionOrder, the pack's Question text verbatim plus the source refs
     of that check's facts (if any). The model does not write or reword questions.
   - "unanswered": for the report's audience, each persona question whose coverage is NOT_ANSWERABLE
     or PARTLY, shown as the pack's question text plus the "missing" note, under the existing
     "These documents don't show" wording. Empty block is omitted.
   - "terms": pack terms whose Term occurs (case-insensitive) in any verified fact quote or value.
   - "general_notes": notes whose "Show when" is "always" (other conditions arrive in DP-2).
   Label "terms" and "general_notes" as general information, visually distinct from case findings.
   On the Study tab show a compact "What each reader needs" card: per persona, its questions with a
   covered / partly / not shown mark and source refs.

7. Write. Bump to hive-write/2. Input adds, for the chosen audience only (Customer -> persona
   "customer" + "Customer report"; Professional-format -> persona "professional" + "Professional
   report"): the full persona (all fields); that persona's coverage rows; the report title, ordered
   sections with their narrative instructions and served question ids; the voice line; and a compact
   view of checklist verdicts and chains (ids, verdicts, notes, fact ids).
   Add one domain-blind instruction block:
     "You are writing for the reader described under Reader. Use Situation, Knows and Does not know
      to choose what to explain and what to assume. Answer the reader's questions in the order given,
      in the sections that name them; answer only questions whose coverage is ANSWERABLE or PARTLY,
      from the cited facts - the unanswered ones are listed for you by a block. Follow Useful when
      and Leave out. Before finishing, apply the Success test and cut anything that does not help the
      reader meet it."
   Output: sections in the pack's order; each has heading, optional paragraphs (every sentence cites
   fact ids, as today) and the blocks listed for that section. Code places blocks; the model may not
   add, drop or reorder sections, restate a block's contents, or mention check ids or authorities in
   the Customer audience (code strips Authority and ids from Customer renders regardless). Unknown
   block names, and blocks not built yet ("computed"), are skipped and counted. Customer "questions"
   block is capped at 7; Professional shows all.

8. UI: "Reviewed with: <pack title> (v<version>)" on the Study and report headers, with the pack's
   "verified" line on hover; under the report title a one-line "Written for: <persona Who>";
   "Rebuild without checklist" action. Checklist and chains blocks appear on the Study tab under the
   summary. Reuse existing A2UI table/list primitives; new components only if nothing fits, and list
   them in the report.

9. Tests: parser (including personas); selection (match / below threshold / two packs); canonicalize
   verify-or-drop for coverage, checklist and chains; canonicalize input contains both personas
   regardless of who requested the run; write input contains exactly one persona; gap creation from
   Settles; study-view blocks; write section order enforced; Customer render contains no check id or
   Authority text; a no-pack run has the same structure as today. Full web suite with
   NODE_OPTIONS=--max-old-space-size=8192, typecheck both packages, clean build, domain-word lint.

Stop. Report: files changed, the migration file name (I run it by hand before pushing), any planner /
Oracle steps, drop counters added, and view.html for special-ed-l001 Customer and Professional built
with the pack. Do not commit.
```

---

## Prompt DP-1b — Add personas (only if DP-1 was already run without them)

```
Scope: the files DP-1 touched (pack-contracts.ts, pack loader, canonicalize and write runners and
prompts, study view builder, Study/Reports UI). Same constraints as DP-1. No migration.

packs/HiveForYou-Pack-iep-initial.md is now "version: 5" and has a new H2 section "Personas". If the
file is not version 5, stop and tell me.

1. Parser: add "Personas" to the fixed section names. Each H3 under it is one persona; its heading
   maps to an audience key ("Customer" -> customer, "Professional" -> professional). Table columns
   Field, Content. Fields: Who, Situation, Knows, Does not know, Looking for, Decisions, Useful when,
   Leave out, Success test. Cells with ";" are lists. "Looking for" items start with an id (L1, ...)
   then the question; ids unique within a persona. In report templates, a trailing "(L1, L2)" in
   "Built from" names the persona questions that section serves. Extend the neutral fixture and tests.

2. Canonicalize: add BOTH personas (Who, Situation, Looking for, Decisions only) to the input,
   whoever requested the run (D-007: the Study is the same for every viewer). Prepend to the pack
   instruction block:
     "Two kinds of reader will use this study; they are described under Readers with the questions
      each is trying to answer. Build one study that serves both: make sure the spine, findings,
      conflicts and gaps contain what is needed to answer every reader question. Then, for each
      reader question, say whether these facts can answer it: ANSWERABLE, PARTLY or NOT_ANSWERABLE,
      citing the fact ids that carry the answer and, if not fully answerable, naming in at most 20
      words what is missing. Do not write the answer itself. Do not use the readers as a source of
      facts about this case."
   Output addition: personaCoverage: [ { audience, questionId, status, factIds[], checkIds[],
   missing } ]. Verify-or-drop: unknown question id dropped; ANSWERABLE or PARTLY with no valid fact
   id downgraded to NOT_ANSWERABLE; omitted question recorded NOT_ASSESSED; all counted.

3. Study view: new block "unanswered" built by code - for the report's audience, each persona question
   with coverage NOT_ANSWERABLE or PARTLY, as the pack's question text plus the "missing" note, under
   the existing "These documents don't show" wording; omitted when empty. On the Study tab add a
   compact "What each reader needs" card: per persona, its questions with covered / partly / not
   shown and source refs.

4. Write: add, for the chosen audience only, the full persona (all fields) and its coverage rows, and
   this instruction:
     "You are writing for the reader described under Reader. Use Situation, Knows and Does not know
      to choose what to explain and what to assume. Answer the reader's questions in the order given,
      in the sections that name them; answer only questions whose coverage is ANSWERABLE or PARTLY,
      from the cited facts - the unanswered ones are listed for you by a block. Follow Useful when
      and Leave out. Before finishing, apply the Success test and cut anything that does not help the
      reader meet it."
   The pack's report templates changed (Customer section 1 and a new Professional section 1 "Bottom
   line"); they are read from the pack, so no code change should be needed - confirm.

5. UI: under the report title, "Written for: <persona Who>".

6. Tests: canonicalize input contains both personas regardless of requester; write input contains
   exactly one; coverage verify-or-drop; "unanswered" block. Full suite (8 GB), typecheck, clean
   build, domain-word lint. If prompt ids were bumped to /2 in DP-1 and not yet deployed, keep /2;
   if already deployed, bump to /3 and report the deploy steps.

Stop. Report files changed and view.html for special-ed-l001, both audiences. Do not commit.
```

---

## Prompt DP-2 — Intake questions, computed values, eval

```
Scope: pipeline pack-contracts and runners from DP-1; new apps/web/src/server/pipeline/compute.ts;
Study tab intake card; one migration; eval scripts. Same constraints as DP-1.

Goal: the report can use what only the person knows, and every number that needs arithmetic is
computed by code from cited values.

1. Intake ("Ask the person"). On the Study tab, when the selected pack has questions for the current
   audience (Audience = all, customer or professional), show a card "A few questions that sharpen the
   report" with free-text answers, all optional, editable later. Store answers per Hive as person
   statements { id: "S-<n>", questionId, text, answeredBy, answeredAt } through a new RPC (no trigger;
   owner-only RLS like other Hive data). Changing an answer shows the existing "rebuild to include"
   banner for reports only - the Study does not depend on answers (D-007).
   Write input gains personStatements[]. A sentence may cite statement ids instead of fact ids; code
   renders such sentences with a "You told us" marker and never mixes statement ids into document
   source chips. Statements never enter the canonical study.

2. Computed values. compute.ts implements exactly these domain-free ops on typed values:
   DAYS_BETWEEN(start, end) -> integer days; DIFFERENCE(a, b); RATE_PER_WEEK(from, to, start, end) ->
   (to - from) / weeks, one decimal; SUM_BY(value, group) -> totals per group; ADD_INTERVAL(date,
   interval) -> date; REFERENCE_GAP(value, table, row, column) -> value minus the table cell.
   Canonicalize input adds the pack's Computed values table (Id, Label, Op, Inputs, Per) and the
   names, row keys and column headers of Reference tables (not the cell values). Instruction:
     "For each computed value, bind every named input to one fact id whose value is that input. Where
      'Per' is not 'case', return one binding per instance with a short label. For REFERENCE_GAP also
      return the row key and the column header to use, each supported by a fact id. Do not calculate."
   Output addition: computedInputs: [ { computeId, instance, inputs: { name: factId },
   row?, column?, rowFactId?, columnFactId? } ].
   Code: read each bound fact's typed value (date or number with unit); if any input is missing or
   does not parse, drop that instance and count it. Compute; store computed: [ { computeId, instance,
   label, value, unit, inputRefs } ] on the Study revision. Render block "computed" (label, value,
   inputs as source chips, and for REFERENCE_GAP the table name and cell used). General notes whose
   "Show when" names compute ids appear only when those values exist.
   Unit tests: each op, including month-end dates, negative gaps, missing inputs, unit mismatch.

3. Pass computed[] (id, instance, value) to the write stage so narrative can refer to "the table
   above" without restating numbers.

4. Eval. Extend scripts/eval.ts: per corpus, with and without pack - golden spine coverage, conflicts
   found, checklist verdict distribution, checks NOT_ASSESSED, persona questions by coverage status
   per audience, gaps by kind, computed values produced vs dropped, uncited sentences, tokens,
   latency, cost. Add to special-ed-l001 golden.json an optional "checklist" map of expected verdicts
   and a "personaCoverage" map, which I will label after the first run ("reviewed": false until then).
   Run special-ed-l001 and bankruptcy-c13 (brief-only pack).

Full tests (8 GB), typecheck, clean build, domain-word lint.

Stop. Report the eval table, the migration file name, and view.html for both audiences. Do not commit.
```

---

## How to judge Maya's reports

Each persona in the pack carries its own success test; use those.

Customer: after five minutes a parent can tell someone else what the plan is, and holds seven or fewer questions and a list of documents to ask for. No check ids, no citations, no "violation".

Professional: an advocate can prepare for the meeting without re-reading every PDF first: day counts beside the timelines; the verdict table with not-shown rows on top; the alignment matrix with missing links; every row with source chips.

Then: label the expected verdicts and persona coverage in `golden.json`, bring the Chapter 13 pack to format 2 (with its own personas: debtor and debtor's attorney), and add the state overlay once Maya's state is known.
