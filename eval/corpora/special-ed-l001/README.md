# special-ed-l001 - initial special education evaluation and IEP (synthetic)

Maya Carter (synthetic student, grade 2, Synthetic District) is referred by her teacher on 2024-08-20 for difficulty reading connected grade-level text. After an evaluation plan, parent consent and three evaluations (psychoeducational, academic, speech-language), the team finds her eligible on 2024-11-01 under Specific Learning Disability (SLD) - Reading, and an **initial** IEP is written on 2024-11-12. There is no prior IEP.

Source: NestIEP corpus, `cases/L001/clean/` (copied unchanged). The PDFs are supplied, not generated, so this corpus has no `source/` folder.

## Documents

| File | Pages | Content |
|---|---|---|
| `01_initial_referral.pdf` | 1 | Teacher referral, 2024-08-20, reading fluency |
| `02_evaluation_plan.pdf` | 1 | Initial evaluation plan, 2024-08-28 |
| `03_parent_evaluation_consent.pdf` | 1 | Parent consent for initial evaluation, 2024-09-04 |
| `04_psychoeducational_evaluation.pdf` | 2 | 2024-10-15: no global cognitive limitation as primary explanation |
| `05_academic_evaluation.pdf` | 1 | 2024-10-18: 42 WCPM, 86% accuracy, comprehension below level |
| `06_speech_language_evaluation.pdf` | 1 | 2024-10-22: no separate speech-language need, no service |
| `07_eligibility_determination.pdf` | 2 | 2024-11-01: eligible, SLD - Reading, primary need Reading Fluency |
| `08_initial_iep.pdf` | 3 | Initial IEP 2024-11-12 to 2025-11-11: goal 75 WCPM at 95%, 150 minutes weekly, two accommodations |

## Planted

- **No conflicts and no gaps.** The documents are consistent. The only planted issue in the source `case.yaml` (ISSUE_001, a draft annual IEP showing a 52 WCPM baseline against the true 42) is in a later document that is not part of this corpus.
- **Regression target G1:** the anchor is an *initial* IEP with no prior IEP. An earlier pipeline treated it as a revision of a prior IEP; G1 checks that this is recognized.

Anchor: `08_initial_iep.pdf` (`ANCHOR`).

## External baseline

`baseline-notebooklm.txt` — NotebookLM answer on the same documents; external baseline, not a golden label. Do not score against it until a later eval ticket.

## Golden label provenance

`generated_metadata/*.json` in the source case lists expected facts with a page and verbatim needle. All 19 of those facts are carried into spine elements G3-G10 and G12-G15 (see each element's `origin`). Where a needle was too generic to identify the fact (for example `"Reading Fluency"`, `"95%"`), a longer fragment from the same page is used. G1, G2 and G11 were drafted from the PDFs.
