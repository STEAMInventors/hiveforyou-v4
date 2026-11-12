Discard every earlier prompt about domain packs. This is the only authorized scope.

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

2. Pack files. Gate: packs/HiveForYou-Pack-iep-initial.md must have "version: 5" in its front matter
   AND an H2 heading "## Personas". If either is missing, stop and tell me. Do not edit the file.
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
     use them (a later prompt does).
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
   - "general_notes": notes whose "Show when" is "always" (other conditions arrive later).
   Label "terms" and "general_notes" as general information, visually distinct from case findings.
   The model never writes general knowledge; these blocks are pack text rendered verbatim, so the
   every-sentence-cites-a-fact rule (D-011) is unchanged.
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
