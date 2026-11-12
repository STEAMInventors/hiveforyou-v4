---
pack: iep-initial
version: 6
title: Initial IEP review (US special education)
description: Use when a parent or their advocate uploads a first IEP with its evaluations and eligibility paperwork and wants to know what was decided, whether the plan matches the testing, and what to ask before signing.
matches:
  intent: [iep, individualized education program, special education, before i sign, evaluation, eligibility]
  documents: [individualized education program, eligibility determination, evaluation report, prior written notice, consent]
jurisdiction: US federal (IDEA Part B, 34 CFR Part 300); state overlay in references/<state>.md when present
verified: 2026-11-11 - every Authority cell checked against the regulation text (eCFR / CFR, 34 CFR Part 300); reading norms checked against Hasbrouck & Tindal (2017). Exception - 300.106 confirmed by section title only.
status: federal checklist verified against primary sources; state rules not included (a state may set a different evaluation timeline and extra requirements); informational, not legal advice
---

<!-- Pack format 2. Sections are found by their H2 heading; tables by their header row. Section names are fixed:
Rules, Personas, Ask the person, Checks, Standing questions, Chains, Computed values, Reference tables, Documents usually needed,
Terms, General notes, Customer report, Professional report, Sources. Every section is optional. -->

## Rules
- This pack says what to check, what to compute, what to ask for and the order of the answer. It never supplies facts about the case.
- Every check gets one verdict from cited facts only: SHOWN, PARTLY SHOWN, NOT SHOWN, CONFLICT, NOT APPLICABLE.
- NOT SHOWN means "these documents don't show it", not "it didn't happen". It becomes a question and, where a document would settle it, a document request.
- No legal conclusions in either report. Never "violation", "illegal", "the school must". The authority column is shown in the professional report only, as "see 34 CFR ...".
- "Days" in the federal rules are calendar days unless the rule says school or business days (34 CFR 300.11(a)).
- The study date is given with the input. Judge whether the plan is current against that date (check T0), and say so first in both reports when it is not.

## Personas
Two readers use the same Study. The Study must hold what both need; each report is written for one of them.
In table cells, items are separated by ";". "Looking for" items are the questions the report must answer, in order.

### Customer
| Field | Content |
|---|---|
| Who | The child's parent or guardian |
| Situation | This is the child's first IEP. Not a specialist. Has a meeting or a signature decision coming and limited time. Often worried, and reading on a phone |
| Knows | Their child, what they see at home, what the school has said in person |
| Does not know | The vocabulary; what is typical; what the school was supposed to do; what they are allowed to ask for |
| Looking for | L1 What did the school decide about my child, and why?; L2 What help will my child get: how much, how often, where, from when?; L3 Does that match what the testing found, and is the goal big enough to catch up?; L4 What should I ask or ask for before I sign?; L5 What does signing commit me to, and what happens next? |
| Decisions | Whether to sign or consent now or ask for changes first; what to request from the school; whether to bring in someone to help |
| Useful when | Plain words; the child's name; numbers with what they mean; a short list of questions they can read aloud at the meeting; calm tone |
| Leave out | Regulation citations; compliance tables; check ids; blame; anything that reads as a legal conclusion |
| Success test | After five minutes the parent can tell someone else what the plan is, and holds seven or fewer questions and a list of documents to ask for |

### Professional
| Field | Content |
|---|---|
| Who | A special education advocate or attorney helping the family; sometimes an educational consultant or tutor |
| Situation | Taking on or preparing a case with limited prep time. Will verify anything before relying on it. Preparing for a meeting or a written request |
| Knows | The law, the process, what a sound IEP looks like |
| Does not know | This file: what is in it, what is missing, where the numbers disagree |
| Looking for | L1 Is the record complete and current: what is missing, who holds it, and is this the plan in effect?; L2 Were the procedural steps and timelines met?; L3 Is eligibility supported, and were other causes ruled out on the record?; L4 Does each need trace to a present level, a goal, a service and a progress measure, and where does the chain break?; L5 Are the goals measurable and ambitious, and do services cover what the evaluations recommended?; L6 Where do the documents conflict or leave fields blank?; L7 What should be raised at the meeting and requested in writing, in what order? |
| Decisions | Priority of issues; what to request; the meeting agenda; what to put in a parent-concerns letter |
| Useful when | Dense; every row opens the source page; authority beside each check; day counts beside timelines; not-shown items first; text that can be lifted into a letter |
| Leave out | Explanations of basic terms; reassurance; conclusions without a source; advice on strategy or likely outcome |
| Success test | The professional can prepare for the meeting without re-reading every PDF first, and trusts the table because every row is traceable |

## Ask the person
Answers are recorded as the person's statements, never as document facts.
| Id | Audience | Question | Why it changes the report |
|---|---|---|---|
| Q1 | all | Which state is the school in? | Timelines and what a signature means differ by state |
| Q2 | all | Have you signed the IEP or a consent for services? When? | Decides whether the report is "before you sign" or "what you can still ask" |
| Q3 | all | Is there a meeting date or a date you must reply by? | Orders the questions and document requests by urgency |
| Q4 | customer | What are your two biggest worries, in your own words? | The report answers these first |
| Q5 | customer | What do you see at home (reading, homework, behaviour)? | Compared with present levels; shown as "you told us" |
| Q6 | all | Any private evaluations or diagnoses not uploaded? | Possible missing evidence |
| Q7 | professional | Your role and what you need to produce (meeting prep, letter, case assessment) | Sets depth and the closing section |

## Checks
Evidence = what must be cited for SHOWN. Question = customer wording when the verdict is not SHOWN; "-" means no question.

### Timeline and process
| Id | Check | Evidence | Authority | Question |
|---|---|---|---|---|
| T0 | The plan is current: the study date falls within the IEP's dates, and no goal date or annual review date has passed | IEP start and end dates, goal dates, meeting date, compared with the study date (C10) | 300.324(b)(1)(i) | This plan's dates have passed. Is there a newer IEP, or a review meeting I haven't seen? |
| T1 | Parent gave informed consent before the evaluation began | Signed consent date earlier than first test date | 300.300(a)(1)(i) | When did I give consent to evaluate, and can I have a copy? |
| T2 | Evaluation finished within 60 days of the school receiving consent, or within the state's own timeframe | Consent date and evaluation completion date (C1); any recorded exception (parent did not produce child; child changed district) | 300.301(c)(1)(i)-(ii); exceptions 300.301(d) | How many days did the evaluation take, and what is our state's limit? |
| T3 | IEP meeting held within 30 days of deciding the child needs special education | Eligibility date and IEP meeting date (C2) | 300.323(c)(1) | - |
| T4 | Parent was told about the meeting early enough to attend, with its purpose, time, place and who would be there | Meeting notice; parent listed as attending | 300.322(a)(1), (b)(1)(i) | - |
| T5 | Written notice, a reasonable time before each proposal or refusal (evaluate, identify, place), describing the action and the reasons | Prior written notice document(s) | 300.503(a), (b) | Can I have the prior written notice for each decision? |
| T6 | Parent was given the procedural safeguards notice at referral or request for evaluation | Receipt, checkbox or statement | 300.504(a)(1) | Can I have a copy of my procedural safeguards? |
| T7 | Consent for first-time services is separate; consent to evaluate does not count as consent for services | Consent for initial provision of services | 300.300(a)(1)(ii), 300.300(b) | What exactly am I consenting to when I sign? |
| T8 | Services are made available as soon as possible after the IEP is written | Service start dates (C3) | 300.323(c)(2) | Why do services start on that date? |
| T9 | Parent received a copy of the IEP at no cost | Statement or receipt | 300.322(f) | - |

### Evaluation and eligibility
| Id | Check | Evidence | Authority | Question |
|---|---|---|---|---|
| E1 | Testing used a variety of tools, did not rest on a single measure, drew on several sources including parent input, and covered every area related to the suspected disability | Referral concerns vs areas assessed; list of measures | 300.304(b)(1)-(2), (c)(4); 300.306(c)(1)(i) | Which concerns from the referral were not tested, and why? |
| E2 | Eligibility was decided by a group of qualified professionals and the parent; category and educational need are both stated | Eligibility determination | 300.306(a)(1) | - |
| E3 | Team considered whether lack of appropriate instruction in reading or math, or limited English, is the deciding factor | Eligibility form section or statement | 300.306(b)(1) | How did the team rule out other causes? |
| E4 | Learning disability only: the team found the results are not mainly due to vision, hearing or motor disability, intellectual disability, emotional disturbance, cultural factors, environmental or economic disadvantage, or limited English | Exclusionary-factors section completed | 300.309(a)(3); 300.311(a)(6) | How did the team rule out other causes? |
| E5 | Learning disability only: data shows appropriate instruction by qualified staff before or during referral, and repeated progress checks that were given to the parents | Intervention / progress-monitoring data; evidence parents received it | 300.309(b)(1)-(2) | Can I see the intervention data collected before the referral? Was it sent to me at the time? |
| E6 | Learning disability only: the child was observed in the learning environment, including the regular classroom | Observation report with date, observer and setting; behaviour noted in the eligibility report | 300.310(a)-(b); 300.311(a)(3) | Who observed my child in class, and when? |
| E7 | Learning disability only: each team member certified in writing whether the report reflects their conclusion; any dissent is attached | Signatures / certification | 300.311(b) | - |
| E8 | Parent received the evaluation report and the eligibility documentation at no cost | Statement or receipt | 300.306(a)(2) | Can I have copies of every evaluation report? |
| E9 | Learning disability only, where a response-to-intervention process was used: the report records the strategies and data, and that parents were told about the data to be collected, strategies to speed learning, and their right to request an evaluation | Eligibility report section | 300.311(a)(7) | - |

### IEP content
| Id | Check | Evidence | Authority | Question |
|---|---|---|---|---|
| P1 | Present levels of academic and functional performance say how the disability affects progress in the general curriculum | Present-levels statement | 300.320(a)(1)(i) | - |
| P2 | Every number in present levels matches the evaluation it came from | Same measure, same value, same date (C6) | consistency check | The IEP and the evaluation give different numbers for the same test. Which is right? |
| P3 | Child's strengths and the parent's concerns are recorded | Strengths; parent input section not blank | 300.324(a)(1)(i)-(ii) | Where are my concerns written down? |
| G1 | Each need found in the evaluations has a measurable annual goal (academic or functional) | Chain 2 | 300.320(a)(2)(i) | Which goal covers this need? |
| G2 | Each goal has a baseline, a target, how it is measured, a mastery rule and a date | Goal text | 300.320(a)(2)(i), (a)(3)(i) | How will we know this goal is met? |
| G3 | The target is ambitious for the time allowed | Gain per week (C4) and gap to typical (C8, C9) when the measure is WCPM | Endrew F. v. Douglas County (2017) | How was this target chosen? Will it narrow the gap with classmates? |
| G4 | How progress is measured and when periodic reports go to parents | Progress-reporting section | 300.320(a)(3)(i)-(ii) | When will I get progress reports, and what will they show? |
| S1 | Every service lists start date, frequency, location and duration | Service grid | 300.320(a)(4), (a)(7) | - |
| S2 | Each goal has a service that delivers it | Chain 2 | 300.320(a)(4) | Who works on this goal, and for how many minutes? |
| S3 | Each evaluation recommendation is in the IEP, or the record says why not | Chain 3; prior written notice for refusals | 300.324(a)(1)(iii); 300.503(b) | The evaluation made a recommendation that I can't find in the plan. Where is it? |
| S4 | The instruction or program is named, and rests on peer-reviewed research where practicable; supports or training for staff are listed if needed | Service description | 300.320(a)(4) | What program or method will be used, and what is it based on? |
| L1 | Time away from classmates without disabilities is stated and explained | Setting, minutes (C5), explanation | 300.320(a)(5); 300.114(a)(2) | Why is this done outside the classroom? |
| A1 | Classroom accommodations are listed, and accommodations for state and district tests | Accommodations section | 300.320(a)(6)(i) | - |
| A2 | Special factors were each answered (behaviour, limited English, vision, communication, assistive technology) | Checkboxes completed | 300.324(a)(2) | - |
| A3 | Extended school year was considered | ESY section completed | 300.106 | - |
| A4 | Transition goals and services, if the IEP will be in effect when the child turns 16 (or younger if the team decides) | Transition section | 300.320(b) | - |
| M1 | Required people attended or were excused in writing with the parent's agreement: parent, regular education teacher, special education teacher, district representative, someone who can explain what the test results mean for teaching | Attendance / signature page; excusal forms | 300.321(a)(1)-(5), (e) | Who explained the test results at the meeting? |
| F1 | No blank fields, unticked required boxes, empty "Other (specify)", or dates and names that disagree | Form fields | observation | Part of the form is blank. What should it say? |

## Standing questions
Worth asking whenever the condition holds, even if every check is SHOWN. The study marks which apply, citing the facts that make the condition true; code shows the question text as written. They join the check questions in one priority order.
| Id | Audience | Ask when | Question |
|---|---|---|---|
| SQ1 | all | A service is delivered outside the general classroom | How will the time outside class be scheduled each week, and which lessons will my child miss? |
| SQ2 | all | A service is delivered outside the general classroom | How will what my child learns in those sessions carry over into the regular classroom? |
| SQ3 | all | Progress is reported quarterly or less often | Can I see the progress-monitoring numbers between report cards, for example once a month? |
| SQ4 | all | At least one accommodation is listed | How will each accommodation be used in class and on tests, and who makes sure it happens? |
| SQ5 | all | At least one academic goal is listed | What can we do at home to support this goal without turning it into a struggle? |
| SQ6 | all | The plan or the evaluations mention test results the parent may not have seen in full | Can someone walk me through each test result and what it means for teaching? |

## Chains
Build one row per starting item; a missing link is a finding.
| Id | Label | Links, in order |
|---|---|---|
| CH1 | Concern to testing | Referral concern; Area assessed; Result |
| CH2 | Need to progress | Need in evaluation; Present-level statement; Annual goal; Service (minutes, setting); Progress measure and reporting date |
| CH3 | Recommendation to plan | Evaluation recommendation; IEP service, accommodation or goal; Recorded reason if not adopted |

## Computed values
Code does the arithmetic from cited values. Ops: DAYS_BETWEEN(start, end), DIFFERENCE(a, b), RATE_PER_WEEK(from, to, start, end), SUM_BY(value, group), ADD_INTERVAL(date, interval), REFERENCE_GAP(value, table, row, column).
| Id | Label | Op | Inputs | Per |
|---|---|---|---|---|
| C1 | Days from consent to evaluation completion | DAYS_BETWEEN | start = date consent received; end = last evaluation date | case |
| C2 | Days from eligibility decision to IEP meeting | DAYS_BETWEEN | start = eligibility date; end = IEP meeting date | case |
| C3 | Days from IEP date to service start | DAYS_BETWEEN | start = IEP date; end = service start date | service |
| C4 | Gain needed per week | RATE_PER_WEEK | from = baseline value; to = target value; start = baseline date; end = goal date | goal |
| C5 | Service minutes per week by setting | SUM_BY | value = minutes per week; group = setting | case |
| C6 | Difference between evaluation and present-level figure | DIFFERENCE | a = evaluation figure; b = present-level figure for the same measure | measure |
| C7a | Annual review due | ADD_INTERVAL | date = IEP date; interval = 1 year | case |
| C7b | Re-evaluation due | ADD_INTERVAL | date = eligibility date; interval = 3 years | case |
| C8 | Gap to typical reader at baseline | REFERENCE_GAP | value = baseline WCPM; table = Oral reading fluency norms; row = grade; column = 50th percentile for the season of the baseline date | goal |
| C9 | Gap to typical reader at goal date | REFERENCE_GAP | value = target WCPM; table = Oral reading fluency norms; row = grade at goal date; column = 50th percentile for the season of the goal date | goal |
| C10 | Days since the latest goal or annual review date | DAYS_BETWEEN | start = latest goal date or annual review date; end = study date | case |
Authority for C7a: 300.324(b)(1)(i). For C7b: 300.303(b)(2), unless parent and school agree a re-evaluation is unnecessary.

## Reference tables
### Oral reading fluency norms
Hasbrouck & Tindal (2017). Words correct per minute on unpracticed grade-level passages.
| Grade | 50th fall | 50th winter | 50th spring | 25th fall | 25th winter | 25th spring |
|---|---|---|---|---|---|---|
| 1 | - | 29 | 60 | - | 16 | 34 |
| 2 | 50 | 84 | 100 | 36 | 59 | 72 |
| 3 | 83 | 97 | 112 | 59 | 79 | 91 |
| 4 | 94 | 120 | 133 | 75 | 95 | 105 |
| 5 | 121 | 133 | 146 | 87 | 109 | 119 |
| 6 | 132 | 145 | 146 | 112 | 116 | 122 |

## Documents usually needed
| Document | Holder | When | Settles |
|---|---|---|---|
| Prior written notice for evaluation, eligibility and placement | THIRD_PARTY (district) | before signing | T5, S3 |
| Procedural safeguards notice | THIRD_PARTY (district) | before signing | T6 |
| Signed consent to evaluate; consent for services | ASKER_OR_CLIENT or THIRD_PARTY (district) | before signing | T1, T2, T7 |
| Referral or request for evaluation | ASKER_OR_CLIENT or THIRD_PARTY (school) | before signing | E1 |
| Exclusionary-factors review (learning disability) | THIRD_PARTY (school) | before signing | E3, E4 |
| Classroom observation | THIRD_PARTY (school) | before signing | E6 |
| Intervention / response-to-intervention data | THIRD_PARTY (teacher) | before signing | E5, E9 |
| Parent input record | THIRD_PARTY (school) | before signing | P3, E1 |
| Meeting notice, attendance page, any excusal forms | THIRD_PARTY (school) | before signing | T4, M1 |
| Report cards, state test results, attendance | ASKER_OR_CLIENT | if available | P1, E3 |
| Private evaluations | ASKER_OR_CLIENT | if any | E1, S3 |
| Progress reports | THIRD_PARTY (school) | each reporting period (later) | G4 |
| Service logs | THIRD_PARTY (school) | if progress is slow (later) | S1 |

## Terms
| Term | Plain meaning |
|---|---|
| WCPM | Words read correctly in one minute |
| Present levels | Where the child is now; the starting line for each goal |
| Accommodation | The same work with support. A modification changes what is expected |
| Pull-out | Teaching outside the general classroom. Push-in is support inside it |
| Related services | Speech, occupational therapy, counselling and similar supports |
| Prior written notice | The district's written explanation of a decision, including what it refused |
| Least restrictive environment | Learning alongside classmates without disabilities as much as is appropriate |
| Extended school year | Services during school breaks when needed to keep skills |
| Standard score | A test score where 100 is average; most children score between 85 and 115 |
| Percentile | The share of same-age children who scored the same or lower. It is not percent correct |

## General notes
Shown as written under "In general"; never proof about this child.
| Id | Show when | Text |
|---|---|---|
| N1 | always | Agreeing to testing is not agreeing to services. The school needs a separate consent before it starts special education for the first time. |
| N2 | always | What a signature on the IEP form itself means (attendance only, or agreement) depends on the state and the form. Ask before you sign. |
| N3 | always | You are entitled to a copy of the IEP and of the evaluation reports at no cost. |
| N4 | C8 or C9 present | The reading numbers are compared with a national table of typical readers. A score 10 or more words below the middle of the table usually means a child needs extra fluency support. A goal that only matches typical growth keeps the gap the same size; closing it needs faster growth. If the school's own test has its own norms, those are the better comparison. |
| N6 | always | You can share what you see at home: what your child enjoys, when they feel confident, and when schoolwork is tiring or stressful. The team is required to consider a parent's concerns when it writes the IEP. |
| N5 | any score table present | Grade or age equivalents are rough and should not be read as "reads like a first grader". |

## Customer report
Title: {first name}'s first IEP: what it says and what to ask
| Order | Section | Built from |
|---|---|---|
| 1 | The short answer | narrative: if check T0 is not SHOWN, say first, in one sentence, that this plan's dates have passed and the parent may need the newer one; then answer the Customer "Looking for" questions L1 to L3 in order, one or two sentences each; then the person's worries (Q4) if given; block unanswered |
| 2 | What the school decided | narrative: eligibility, category, the need (L1) |
| 3 | What {first name} will get | narrative + block spine_table: each goal as "from baseline to target by date, measured by how"; each service as "minutes, times a week, where, starting when"; accommodations as a short list; block computed (C4, C8, C9) (L2) |
| 4 | Does the plan match the testing? | block chains, as two lists: Matches, Worth asking (L3) |
| 5 | Questions to ask before you sign | block questions: check questions and standing questions together, at most seven, most important first (L4); block general_notes (N6) |
| 6 | What to ask the school for | block gaps (document requests by holder, ask now before later) (L4) |
| 7 | What signing means | block general_notes (N1-N3) (L5) |
| 8 | What happens next | block computed (C7a) + narrative: progress report dates (L5) |
| 9 | Words used in these documents | block terms |
Voice: about an 8th-grade reading level; the child's first name; address the parent as "you"; numbers exactly as written with units; "Your documents show", "These documents don't show", "Worth asking"; no check ids, no regulation citations, no verdict labels.

## Professional report
Title: Initial IEP file review: {student}
| Order | Section | Built from |
|---|---|---|
| 1 | Bottom line | narrative: if check T0 is not SHOWN, state that first with the dates; then answer the Professional "Looking for" questions L1 to L7 in order, one sentence each; block unanswered |
| 2 | Snapshot | narrative: student, grade, school, category, key dates, state, the request; block documents |
| 3 | Chronology | block timeline + block computed (C1, C2, C3, C7a, C7b); flag "state timeline not verified" when no overlay (L2) |
| 4 | Checklist | block checklist: id, check, verdict, evidence, authority; rows that are not SHOWN first (L2, L3) |
| 5 | Alignment | block chains (CH1, CH2, CH3) with missing links marked (L4) |
| 6 | Goal analysis | block spine_table (goals) + block computed (C4, C8, C9) (L5) |
| 7 | Services against recommendations | block spine_table (services) + block computed (C5) + narrative on S3, S4 (L5) |
| 8 | Conflicts and inconsistencies | block conflicts + block computed (C6) (L6) |
| 9 | Document requests | block gaps with the check each one settles (L1) |
| 10 | Meeting agenda | block questions (all, check and standing) + narrative: points for a parent-concerns letter (L7) |
| 11 | Coverage and caveats | narrative: unreadable pages, checks not applicable, state rules not verified; pack version and verification date |
Voice: dense; typed values as written; original quotes on expand; no advice on strategy or outcome; "see 34 CFR ..." rather than a conclusion.

## Sources
- 34 CFR Part 300, Subparts B, D and E (eCFR): 300.11, 300.106, 300.114, 300.300-300.311, 300.320-300.324, 300.503, 300.504.
- Hasbrouck, J. & Tindal, G. (2017). An update to compiled ORF norms (Technical Report No. 1702). University of Oregon.
- Endrew F. v. Douglas County School District RE-1, 580 U.S. 386 (2017).
