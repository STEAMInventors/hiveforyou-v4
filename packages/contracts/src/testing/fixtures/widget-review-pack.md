---
pack: widget-review
version: 2
title: Widget batch review (neutral fixture)
description: Use when a requester uploads a first widget shipment folder and wants to know what was decided, whether specs match the test logs, and what to ask before accepting.
matches:
  intent: [widget, batch review, acceptance test, before i accept, quality check]
  documents: [widget spec sheet, acceptance log, calibration card, shipment manifest, change notice]
jurisdiction: neutral test jurisdiction
verified: 2026-11-11 - fixture only; not verified against any external authority
status: test fixture; informational only
---

## Rules
- This pack says what to check, what to compute, what to ask for and the order of the answer. It never supplies facts about the case.
- Every check gets one verdict from cited facts only: SHOWN, PARTLY SHOWN, NOT SHOWN, CONFLICT, NOT APPLICABLE.
- NOT SHOWN means "these documents don't show it", not "it did not happen".

## Personas
Two readers use the same Study. The Study must hold what both need; each report is written for one of them.
In table cells, items are separated by ";". "Looking for" items are the questions the report must answer, in order.

### Customer
| Field | Content |
|---|---|
| Who | The person receiving the widget batch |
| Situation | First shipment review. Not a specialist. Has a delivery window and limited time. Often reading on a phone |
| Knows | Their process, what they see on the line, what the vendor said in person |
| Does not know | The vocabulary; what is typical; what the vendor was supposed to do; what they are allowed to ask for |
| Looking for | L1 What did the vendor decide about this batch, and why?; L2 What support and parts will we get: how much, how often, from when?; L3 Does that match what the tests found? |
| Decisions | Whether to accept now or ask for changes first; what to request from the vendor |
| Useful when | Plain words; short lists of questions they can read aloud; calm tone |
| Leave out | Internal check ids; blame; jargon without explanation |
| Success test | After five minutes they can tell someone else what the batch includes |

### Professional
| Field | Content |
|---|---|
| Who | A quality engineer or operations lead helping the receiver |
| Situation | Taking on a review with limited prep time. Will verify anything before relying on it |
| Knows | The process, what a sound batch looks like |
| Does not know | This file: what is in it, what is missing, where numbers disagree |
| Looking for | L1 Is the record complete: what is missing, and who holds it?; L2 Were the procedural steps and timelines met?; L3 Where do the documents conflict or leave fields blank? |
| Decisions | Priority of issues; what to request; the acceptance agenda |
| Useful when | Dense; every row opens the source page; not-shown items first |
| Leave out | Basic term tutorials; conclusions without a source |
| Success test | The professional can prepare for the meeting without re-reading every PDF first |

## Ask the person
| Id | Audience | Question | Why it changes the report |
|---|---|---|---|
| Q1 | all | Which site receives the batch? | Timelines differ by site |
| Q2 | all | Have you signed an acceptance form? When? | Decides before vs after acceptance wording |
| Q3 | customer | What are your two biggest worries, in your own words? | The report answers these first |

## Checks

### Timeline and process
| Id | Check | Evidence | Authority | Question |
|---|---|---|---|---|
| T1 | Vendor gave notice before testing began | Signed notice date earlier than first test date | REF-1 | When did we approve testing, and can we have a copy? |
| T2 | Testing finished within the stated window | Notice date and completion date | REF-2 | - |

### Spec alignment
| Id | Check | Evidence | Authority | Question |
|---|---|---|---|---|
| S1 | Every serial in the manifest appears in the acceptance log | Manifest vs log | consistency check | Which units are missing from the log? |

## Standing questions
| Id | Audience | Ask when | Question |
|---|---|---|---|
| SQ1 | all | A service is delivered off the main line | How will off-line time be scheduled each week? |
| SQ2 | customer | At least one spec line is listed | Which spec lines should I double-check before accepting? |

## Chains
| Id | Label | Links |
|---|---|---|
| CH1 | Concern to testing | Stated concern; Area tested; Result |
| CH2 | Need to delivery | Need in test log; Spec line; Shipment line; Progress measure |

## Computed values
| Id | Label | Op | Inputs | Per |
|---|---|---|---|---|
| C1 | Days from notice to test completion | DAYS_BETWEEN | start = notice date; end = last test date | case |
| C2 | Units per week by line | SUM_BY | value = units per week; group = line | case |

## Reference tables
### Throughput norms
Fixture table for reference lookups.
| Grade | 50th fall | 50th winter |
|---|---|---|
| A | 10 | 14 |
| B | 20 | 24 |

## Documents usually needed
| Document | Holder | When | Settles |
|---|---|---|---|
| Signed notice before testing | THIRD_PARTY (vendor) | before signing | T1, T2 |
| Calibration card for line 2 | ASKER_OR_CLIENT | if available | S1 |
| Weekly progress log | THIRD_PARTY (vendor) | each reporting period (later) | - |

## Terms
| Term | Plain meaning |
|---|---|
| WPM | Widget parts per minute |
| Acceptance log | Where the batch is now; the starting line for each requirement |
| Pull line | Assembly outside the main floor. Push line is support inside it |

## General notes
| Id | Show when | Text |
|---|---|---|
| N1 | always | Agreeing to a test run is not agreeing to full shipment. A separate sign-off is needed before transfer. |
| N2 | C1 present | Compare elapsed days with the stated window in the spec header. |

## Customer report
Title: {batch name} widget review: what it says and what to ask
| Order | Section | Built from |
|---|---|---|
| 1 | The short answer | narrative: answer the Customer "Looking for" questions L1 to L3 in order; block unanswered (L1, L2, L3) |
| 2 | What the vendor decided | narrative: batch status and requirements (L1) |
| 3 | Questions before you accept | block questions: at most seven (L3) |
| 4 | Words used in these documents | block terms |
Voice: plain language; address the receiver as "you"; no check ids or verdict labels.

## Professional report
Title: Widget batch file review: {batch id}
| Order | Section | Built from |
|---|---|---|
| 1 | Bottom line | narrative: answer the Professional "Looking for" questions L1 to L3 in order; block unanswered |
| 2 | Checklist | block checklist: id, check, verdict, evidence, authority (L2, L3) |
| 3 | Alignment | block chains (CH1, CH2) with missing links marked (L3) |
| 4 | Document requests | block gaps (L1) |
Voice: dense; typed values as written; no strategy advice.

## Sources
- Neutral fixture references only.
- Throughput norms table invented for tests.
