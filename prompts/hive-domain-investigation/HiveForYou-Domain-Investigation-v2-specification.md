# Stage 5E.4 — investigation prompt, gates, and golden test

This file is not a prompt. The prompt text is `HiveForYou-Domain-Investigation-v2.md`, id `hive.domain-investigation/2`, and that file was not rewritten. As of Stage 5E.4C it is loaded only for a pinned iep-us-federal 0.5.0 Rebuild. `hive.domain-investigation/1` stays the catalog investigation id. Unpinned Hives stay on `hive-canonicalize/1`. No deploy, SQL, or model call is authorized by this specification.

## What changed between the prompts

`hive-study-preview/1` investigates the documents first and answers questions from reusable findings. `hive-canonicalize/2` classifies every document, builds a complete spine, and separates supersession, conflict, missing records, and pack review. `hive.domain-investigation/1` is a short tool list. It does not require a central document, a full reconstruction, five kinds of absence, or a completeness review. `finish_investigation` is accepted after one field.

These strengths are carried into v2 on the current twelve tools:

| Earlier strength | v2 instruction | Tool it uses |
|---|---|---|
| Document-centered pass before questions | Phases A–D, then E | `read_pages`, then the propose tools |
| Read every non-empty anchor page | Phase B, three pages at a time | `read_pages` |
| Role of every document; no invented anchor | Phase A | `propose_document_role` |
| Anchor chain versus peers | Phase A, with three unrelated orientation examples | `propose_document_role` |
| Version, effective period, currentness | Map written dates and version words | `propose_field` |
| Do not stop after a few fields | Phase B | `propose_field` |
| One written value, reused | Rule 1 | accepted fact id |
| Cite an id only after acceptance | Rule 1 | tool result |
| Search for a later or contrary statement | Phase C | `search_case`, `read_pages` |
| Baseline, target, and later measurement stay distinct | Rules 4 and Phase C | `propose_measurement` |
| Supersession, different periods, request versus decision, and baseline versus target are not conflicts | Rule 6 | `propose_conflict` |
| Relationship is a candidate | Phase C | `propose_relationship` |
| Calculation result is Hive's | Rule 3 | no result argument |
| A verified quote names a record that is absent from the inventory | Phase D | `propose_gap` `MISSING_DOCUMENT` |
| A page shows a field blank | Phase D | `propose_gap` `MISSING_INFORMATION` |
| An unmapped required field is not missing information | Phase D | no gap |
| Searched and not found is not a missing document or missing information | Phase D | `propose_answer` `uncertainty` |
| Unknown applicability is not "not applicable" | Phase D | unanswered, with uncertainty |
| Not applicable only from a saved condition | Phase D | `propose_field` plus uncertainty |
| Checklist and legal conclusions stay with code | Rules 5 and Phase D | none |
| User questions and pack questions | Phase E | `propose_answer` |
| Open questions for a parent or professional | Phase E | `propose_determination` |
| Read coverage is not semantic coverage | Rule 8 and Phase F | `finish_investigation` is only a stop request |
| Injection in the record is ignored | Opening rules | no new tool |

These earlier behaviors do not fit the current tools, so v2 does not copy them:

| Earlier behavior | Why it is not copied |
|---|---|
| `record_evidence`, `record_document_finding`, `record_fact`, `finish_question`, `finish_study` | Replaced by the twelve investigation tools. Quotes are checked from extraction evidence and from `propose_document_role`. |
| Open-vocabulary `DF…` findings as the spine | The Domain Pack is the completeness guide. A passage with no field stays unmapped. |
| Assessment criterion, reasoning, and strength | `propose_assessment` accepts a statement and fact ids. v2 requires every clause to already be stated by those facts. |
| `evidenceNeeds` of `FOUND` / `NOT_FOUND` / `UNCERTAIN` / `NOT_REQUIRED` | No such arguments. The five absences use `propose_gap` or `uncertainty`. |
| Document reconciliation enum and `coverageNotes` | `finish_investigation` accepts only `ready`. |
| `report_ignored_instruction` | No tool. The prompt ignores the instruction and does not record it. |
| Model checklist verdicts, chain matrices, and upload satisfaction | Canonicalize v2 asked the model for these. Trusted code decides checks, relationships, and calculations. |
| Reader-facing answer paragraph | `propose_answer` has no prose field. The writer phrases Customer and Pro reports from the bindings. |
| Maya's IEP, reading goal, or meeting questions | Those belong to the pack and the request. They are fixtures in the golden test below, not prompt text. |

## Orchestration the current loop already does

`runDomainMappingInvestigation` posts the prompt the pinned path supplies, `hive.domain-investigation/2`, with the twelve tools. `hive.domain-investigation/1` remains a valid id on that task. The planner returns calls unexecuted. The ledger checks quotes, written values, catalog ids, and measurement roles. The study engine then:

- accepts a field only when the proposed value is the written value and the quote contains it
- admits a relationship only when a compiled source structure matches
- publishes a supported calculation only when the operator contract matches
- keeps a progress "has been met" assessment off the supported spine when no later measurement is accepted
- keeps a baseline-versus-target proposal out of `conflicts` when the two facts are different fields
- leaves review-only checks `NOT_ASSESSED`
- builds `hive.canonical-study/1` documents, spine, outside-spine notes, conflicts, timeline, gaps, checklist, and persona coverage
- fails the run on a hard binder reason, without replacing an accepted revision

## Orchestration that has to change before v2 is loaded

Do not load v2 until these call sites match it. None of them are implemented in this proposal.

1. **Finish nudge.** After the last window the loop says: "Call finish_investigation with ready true if the accepted fields are complete." That closes on field count. The v2 stop message has to require Phase F: every manifest document has a role, shown questions have an answer or uncertainty, and unexamined anchor elements are recorded. A shortcut that finishes on accepted fields contradicts the prompt.

2. **Window contents.** `renderInvestigationWindow` rotates eight questions, eight checks, and eight document kinds. It does not include chain links, calculation ids, referenced-document descriptions, or blank-field labels. Intent and personas are only on window 0, truncated to 2,000 characters. v2 tells the model to use chains, calculations, referenced documents, and blank fields when the window shows them, and to keep the request in force on later windows. The window has to carry those lists, and the request has to be present on every window. Page text stays out of the window.

3. **Round budget.** Allowance is `windows + 2` rounds, capped at 32. Phase B reads an anchor three pages at a time and Phase C reads the supporting documents. A case with more pages than that allowance cannot finish Phase F. Budget exhaustion already fails the run. The allowance has to grow with anchor pages and question count, under the existing hard ceilings, or a stopped loop must be stored as incomplete rather than retried into a false finish.

4. **Quantity adaptation.** `adaptCandidates` emits a `QUANTITY` as `{ valueType, value }` with no unit. The binder requires `unit`, and `FIELD_COERCION` rejects the whole run. On pack 0.5.0, `service.minutesPerWeek` is `QUANTITY` with unit `minutes/week`. The L001 page writes "150 minutes weekly", which is not that unit token. A mapping of the bare number must become an unsupported conversion on `outsideSpine`, with the other accepted fields kept. It must not return `INVALID_EVIDENCE` for the study. The prompt already tells the model to use a text field, such as `frequencyAsWritten`, when the catalog unit is not the unit written on the page.

5. **Document orientation on the study.** `projectStudy` sets `documents[].version` to null. `documents[].date` comes from extraction `keyDates`, not from a mapped date field. `chainPosition` is the date order of proposed anchors. v2 can propose the written version and dates, but the study will not show them until projection copies a verified version field and a verified document date. An empty `keyDates` list is why a mapped determination date can appear on the timeline while the document row stays undated.

6. **Chains.** The canonical study schema has `chains`. `projectStudy` does not write that key, so the array stays empty even when the pack defines chains. Projection has to emit one row per compiled chain, with fact ids or an explicit missing link. A missing link is "not found in the saved facts," not "the record does not exist."

7. **Intent uncertainty.** A catalog answer with no fact ids keeps `uncertainty` in `personaCoverage.missing`, cut to 120 characters, and the status becomes `NOT_ANSWERABLE`. An `intent:N` answer with uncertainty and no fact ids is stored as outside-spine text "not answered from the saved evidence," and the uncertainty sentence is dropped. The uncertainty has to be kept on the intent row.

8. **Completeness is not finish.** `finish_investigation` succeeds when `ready` is true and at least one field was accepted. The assembled study is then a successful investigation. v2 says the call only stops the loop. The run has to carry a completeness result that is separate from tool success.

## Completeness gates

Trusted code records these gates. The model does not grade itself. A gate failure does not invent evidence and does not discard accepted quotes. It marks the investigation incomplete and lists the unfinished items. An incomplete investigation is not shown as a complete Study and does not replace Customer or Pro reports by presenting itself as complete.

| Gate | Complete when | Incomplete when |
|---|---|---|
| Document inventory | Every manifest document has one quoted role, or an explicit unresolved reason after its pages were offered | A document has no role. Zero anchors is complete when every document is `SUPPORTING` or `REFERENCE` |
| Anchor read | Every non-empty page of each `ANCHOR` was returned by `read_pages` | An anchor page was not read. The ledger does not record reads today |
| Central document | Each required field of an entity that already has an accepted field on an anchor is mapped, or has a `MISSING_INFORMATION` gap | A required field on a started anchor entity is neither mapped nor gap-recorded. A field that was never in a window is unfinished, not missing |
| Supporting findings | A verified fact whose quote bears on an accepted anchor field is mapped, cited, or left on the unmapped-fact note | Silent drop of a verified fact |
| Plan tasks | Each question, check, chain, and calculation that was shown has an answer, a code disposition, or an explicit "not in this window" carry | A shown question has no answer. A shown chain has no row |
| User questions | Each `intent:N` question has fact ids or a retained uncertainty | The question is dropped, or its uncertainty is discarded |
| Unsupported claims | Supported spine rows are verified fields, admitted relationships, and published calculations | An assessment, determination, or progress sentence is a supported spine row |
| Tool success | Recorded separately | `finish_investigation` accepted, or every call parsed, is not this gate |

`NOT_ASSESSED` remains the disposition for a review-only check and for a requirement whose applicability is unknown. `NOT_APPLICABLE` remains a code disposition and requires a saved fact that the condition is absent. `NOT_SHOWN` remains "not in the saved documents."

## Golden test — Maya L001, scripted, no model

Harness: `packages/contracts` vitest. Corpus: `eval/corpora/special-ed-l001/docs` (eight synthetic PDFs) and `golden.json`. Pack: `iep-us-federal` 0.5.0, digest `2108f8297a240b5daee6d175c2ba6e3699b952613e4b329ff1712d0a25a7a066`. Tools: `CoordinatedInvestigationLedger` over text extracted in Node, then `runInvestigationStudyEngine`. No planner, no network, no Hive pin.

The existing test `domain-investigation-l001.test.ts` is a tool-contract test. It checks that the eight PDF quotes contain the golden fragments, accepts a partial script, and checks a few labels, the progress refusal, and an empty conflict list. Its v0.5.0 case maps three facts. It does not score G1–G15. Passing it is not a complete Study.

### Fixture

Build one extraction fact per golden evidence row. `valueAsWritten` is the quote fragment, or the written scalar when the fragment contains a single mapped number or date (`42`, `75`, `2024-11-01`, `2024-11-12`). The quote is the fragment, the page is the golden page, and `keyDates` stays empty unless a separate orientation case sets them. Do not add a referenced document that the page does not name. Golden `gaps` is `[]`. "reported quarterly" is G11, a present obligation, not a missing progress report.

Intent text, in this order, so the ids are `intent:1` through `intent:5`:

1. What is the initial IEP, and when is it in effect?
2. What did the evaluations find about reading?
3. What goal, services, and accommodations does the IEP provide?
4. What progress evidence is in the file, and is the plan current?
5. What should a parent ask before a meeting?

Script the negative controls as proposals the engine must reject from the supported spine: an assessment that a prior IEP exists; an assessment that speech-language services are provided; an assessment that the speech-language finding means there is no reading need; a conflict between the 42 and 75 values; an assessment that the goal has been met, citing only baseline and target.

### Six measures, asserted separately

A tool-contract pass (every call accepted, including `finish_investigation`) is reported and is not one of these measures.

1. **Document coverage.** Eight document rows. `08` is the only `ANCHOR`. No document is placed in an anchor chain. Roles for `01`–`07` are quoted `SUPPORTING` or `REFERENCE`. Document `version` and document `date` are scored on their own line: today both stay null when `keyDates` is empty, even if a date field was mapped. That line stays failing until projection is implemented. It does not fail the quote checks.

2. **Central-document completeness.** For each of G1–G15, the supported spine has a row whose fact id points at the extraction fact for that golden quote, and the quote contains the fragment. Credit is not given because an assessment label happens to contain the words. Elements the pack can hold as written values include the category, reading need, baseline, accuracy, goal text, service name, accommodation text, and dates whose written form is already `YYYY-MM-DD`. Elements whose words are a conclusion ("there is no prior IEP", "no speech-language service is recommended") count only when a text field or an unmapped verified fact preserves that sentence and the spine cites it. An unmapped fact that appears only as an outside-spine note is visible and is not a supported finding.

3. **User-question coverage.** `intent:1`, `intent:2`, and `intent:3` have fact ids and may be answered. `intent:4` keeps uncertainty that progress is not shown by baseline and target, and that currentness comes from the written effective period. `intent:5` is an open determination, not a finding. Dropping the uncertainty sentence fails this measure even if the question text is still on `outsideSpine`.

4. **Missing-evidence accuracy.** No `REQUESTABLE_DOCUMENT` whose title is a prior IEP, a progress report, or any record the pages do not name. A search that finds no later measurement is uncertainty on `intent:4`, not a missing document. Information absent from a supplied document, when recorded, is `MISSING_INFORMATION` or an observation gap, not a requestable document. Unknown applicability stays `NOT_ASSESSED`. A not-applicable row requires a saved fact. Golden `gaps: []` means the script must not invent a gap to look thorough.

5. **Provenance.** Every supported spine fact id exists in the extractions. The cited quote contains the value. A quote from a different document, a snippet, or a value the page does not contain is rejected. `invented_value` and `quote_not_on_page` stay rejection codes.

6. **Unsupported-claim rejection.** The supported spine does not contain N1, N2, N3, or N4, and does not contain a progress conclusion drawn only from baseline and target. N4 also stays out of `conflicts`. Today N1 and N2 can still become supported spine rows if they are submitted as `propose_assessment` with any accepted fact ids, because projection copies a non-progress assessment onto the spine. That measure stays failing until assessments are kept off the supported spine. The progress regex and the same-field conflict check already hold the "has been met" claim and N4.

### What this run may satisfy before the code changes

With a script that maps only values the pack type already accepts, the engine can accept the calls, reject a bad quote and an invented number, refuse the progress conclusion and the baseline-versus-target conflict, publish a calculation whose inputs match (the 0.5.0 reevaluation date from a written determination date), leave review-only checks `NOT_ASSESSED`, and list all eight documents. Those results are the current L001 test. They do not satisfy measures 2 through 6 as specified above.

## Implementation after approval

1. Keep v1 loaded. Add v2 to the catalog only as a named, unloaded candidate until the founder accepts the text.
2. Change the finish nudge, window payload, and round allowance as listed above.
3. Treat a unitless quantity as an unsupported conversion.
4. Project verified document dates, versions, and chain rows.
5. Retain intent uncertainty.
6. Add the completeness result and stop promoting assessments to the supported spine.
7. Add the six-measure L001 test. Do not weaken the current tool-contract test to make the golden comparison pass.
8. A later ticket may run one allowlisted synthetic Hive. This specification does not authorize that run.
