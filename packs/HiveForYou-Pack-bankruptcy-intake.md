---
pack: bankruptcy-intake
version: 1
title: Bankruptcy intake (individual and small business)
description: Use when a bankruptcy firm is collecting a new client's documents and information to prepare a filing for an individual, their small business, or both, and needs to know what is complete, what is missing, what conflicts, and what is due.
matches:
  intent: [bankruptcy, chapter 7, chapter 11, chapter 13, subchapter v, petition, creditors, intake, file bankruptcy]
  documents: [credit report, creditor list, voluntary petition, credit counseling certificate, garnishment, summons, tax return, pay stub, bank statement, loan, lease]
jurisdiction: US federal (11 U.S.C.); district local rules and state garnishment procedure not included
verified: 2026-11-12 - Authority cells checked against 11 U.S.C. 109(h)(1), 521(a)(1), 521(b)(1), 521(e)(2)(A), 1116(1), 1187(a). Rows marked "firm practice" are common intake practice, not statutory requirements.
status: intake checklist; statutory items verified against primary sources; firm practice items labelled; informational, not legal advice
---

<!-- Pack format 2. Sections are found by their H2 heading; tables by their header row. Fixed section names:
Rules, Personas, Ask the person, Checks, Standing questions, Chains, Computed values, Reference tables,
Documents usually needed, Terms, General notes, Customer report, Professional report, Sources.
"Record kinds" is new in this pack and is read from IN-5 onward; earlier parsers must ignore it. -->

## Rules
- This pack says what an intake must collect and check, what to compute, what to ask, and the order of the answer. It never supplies facts about the case.
- Every check gets one verdict from cited facts only: SHOWN, PARTLY SHOWN, NOT SHOWN, CONFLICT, NOT APPLICABLE.
- NOT SHOWN means "these documents don't show it". It becomes a document request or a client question.
- A case may have more than one filer (an individual and their business). Every record is assigned to a party; checks that apply to one filer say so.
- A record that appears in two sources under different names (an original lender and a later buyer of the debt) is one obligation with two names until staff decide otherwise; never count it twice and never drop either name.
- No legal conclusions in either report. Never "you must file", "this debt will be discharged". The authority column is shown to staff only.
- The study date is given with the input. Dates, ages and deadlines are judged against it.

## Personas
Two readers use the same Study. Each report is written for one of them.
In table cells, items are separated by ";". "Looking for" items are the questions the report must answer, in order.

### Customer
| Field | Content |
|---|---|
| Who | The person filing, and the owner of their business if it files too |
| Situation | Under financial and time pressure; often facing a lawsuit or wage garnishment; not familiar with the process; answering the firm by email and phone between work |
| Knows | Their debts as they think of them, their income, their business |
| Does not know | Which documents count; why every debt matters; what the firm already has; what is due when |
| Looking for | L1 What do you still need from me, and by when?; L2 What do I need to sign or send back?; L3 What questions do you have for me about my debts and property?; L4 What happens next, and is anything urgent? |
| Decisions | What to gather first; how to answer questions about each debt; when to approve the filing |
| Useful when | A short to-do list; each item says why it is needed in one plain sentence; dates in words; nothing they already sent is asked again |
| Leave out | Statute citations; internal checklists; legal conclusions about outcome |
| Success test | The client can finish their to-do list without emailing the firm to ask what something means |

### Professional
| Field | Content |
|---|---|
| Who | The attorney or associate preparing the filing |
| Situation | Several cases at once; the filing date may be driven by a lawsuit or garnishment; someone else may need to pick up the case at any time |
| Knows | Bankruptcy law and the firm's practice |
| Does not know | This client's file: what has arrived, what conflicts, what is still open |
| Looking for | L1 Is the file complete enough to file, and what is still outstanding from whom?; L2 Does every debt appear once, with its current owner, the right party and its purpose?; L3 What is due and when, and is anything expired?; L4 Where do the client's list, the credit report and the documents disagree?; L5 Is the latest draft consistent with the records?; L6 What should be asked of the client next, in what order? |
| Decisions | What to request; what to ask the client; when the case is ready to file |
| Useful when | Dense; every row opens its source page; outstanding items first; days remaining beside each date; a summary someone else could pick up cold |
| Leave out | Reassurance; basic explanations; predictions of outcome |
| Success test | Another member of the firm can take over the case from this report alone, without reading the email history |

## Ask the person
Answers are recorded as the person's statements, never as document facts.
| Id | Audience | Question | Why it changes the report |
|---|---|---|---|
| Q1 | all | Who is filing: you, your business, or both? | Sets the parties and which checks apply |
| Q2 | customer | Is anyone suing you, garnishing your wages, or threatening to? When were you served? | Drives the deadline |
| Q3 | customer | Are there debts that might not be on your credit report (family, friends, medical, taxes, a co-signed loan)? | Completes the creditor list |
| Q4 | customer | Roughly what are your own assets worth, and your business's (a range is fine)? | Fills the asset estimate |
| Q5 | customer | Is your income likely to change soon (a bonus that may not come, a new job)? | Income can be described accurately |
| Q6 | professional | Target filing date and the reason for it | Orders the to-do list |

## Checks
Evidence = what must be cited for SHOWN. Question = client wording when the verdict is not SHOWN; "-" means no question.

### Eligibility and timing
| Id | Check | Evidence | Authority | Question |
|---|---|---|---|---|
| T1 | Each individual filer has a credit counseling certificate dated within the 180 days before the filing date | Certificate with completion date (C1) | 11 U.S.C. 109(h)(1); 521(b)(1) | Your counseling certificate is more than 180 days old or missing. Can you complete the course again and send the new certificate? |
| T2 | Any lawsuit, judgment or garnishment is identified with its served date and answer or response deadline | Summons, garnishment or court notice (C2) | statement of financial affairs, 521(a)(1)(B)(iii) | Is anyone suing you or garnishing your wages? Please send any papers you were served with. |
| T3 | The planned filing date is before the earliest adverse deadline | Deadlines (C2) and the target date (Q6) | firm practice | - |

### Creditors and records
| Id | Check | Evidence | Authority | Question |
|---|---|---|---|---|
| R1 | Every account on the credit report appears on the client's creditor list, or is marked closed or paid | Chain CH1; reconcile result | 11 U.S.C. 521(a)(1)(A) | This account is on your credit report but not on your list. Do you still owe it? |
| R2 | Every debt on the client's list is supported by a statement, report line or letter | Chain CH1 | 521(a)(1)(A) | Do you have a statement or letter for this debt? |
| R3 | Debts sold to a buyer or collector are listed under the current holder, with the original lender kept as a name | Reconcile result: "assigned to" matches | 521(a)(1)(A); firm practice | This debt now seems to be owned by a collection company. Have you received letters from them? |
| R4 | Each debt is assigned to a party (individual, business, joint) | Party assignment | firm practice | Is this debt in your name, your business's name, or both? |
| R5 | For each debt that could be personal or business, its purpose is stated | Purpose field | firm practice | Was this loan or card used for the business, even partly? |
| R6 | Secured debts state the collateral | Loan documents | schedules, 521(a)(1)(B)(i) | What property secures this loan? |
| R7 | Documents describing a current obligation are current (a lease or contract is not superseded by later correspondence from a different party) | Dates of the document and of later letters (C3) | observation | Is this still the current lease, and who is the landlord now? |
| R8 | The client's amounts and the statements' amounts agree | Same debt, two amounts (C4) | observation | Your list and the statement show different amounts. Which is current? |

### Income, assets and identity
| Id | Check | Evidence | Authority | Question |
|---|---|---|---|---|
| I1 | Most recent federal income tax return is in the file | Return for the latest tax year (C5) | 11 U.S.C. 521(e)(2)(A)(i) | Please send your most recent federal tax return. |
| I2 | Payment advices (pay stubs) cover the 60 days before filing | Pay stubs and their dates | 521(a)(1)(B)(iv) | Please send your pay stubs for the last two months. |
| I3 | Assets are estimated, at least as a range, for each filer | Client statement (Q4) or documents | schedules, 521(a)(1)(B)(i) | About how much are your belongings and accounts worth? A range is fine. |
| I4 | Photo ID and proof of Social Security number are in the file | ID images | firm practice | Please send a photo ID and your Social Security card. |

### Business filer (only when a business files)
| Id | Check | Evidence | Authority | Question |
|---|---|---|---|---|
| B1 | Legal name, EIN and ownership of the business are stated | Formation document or statement | firm practice | What is your business's exact legal name, EIN, and who owns it? |
| B2 | Small business debtor (including Subchapter V): most recent balance sheet, statement of operations, cash-flow statement and federal tax return, or a sworn statement that none were prepared or filed | Those documents or statement | 11 U.S.C. 1116(1); 1187(a) | Does your business have a balance sheet, profit and loss statement, cash-flow statement or a business tax return? |
| B3 | Business bank balance as of the filing date | Bank statement or screenshot dated near filing | firm practice | Please send your business's latest bank statement or a screenshot of the balance. |
| B4 | Business receivables and inventory are stated (or stated as none) | Statement | schedules | Is your business owed any money, and does it own equipment or stock? Roughly what is it worth? |
| B5 | The business's current address is stated | Statement or document | firm practice | Where does the business operate now? |

## Standing questions
Worth asking whenever the condition holds, even if every check is SHOWN.
| Id | Audience | Ask when | Question |
|---|---|---|---|
| SQ1 | all | Any creditor list exists | Is there anyone else you might owe money to, even family or friends? |
| SQ2 | all | Any debt is joint or co-signed | Who else signed for this debt, and are they also filing? |
| SQ3 | all | Any debt was repaid or reduced in the past year | Have you paid back any family member, friend or business partner in the past year? |
| SQ4 | all | Any property or vehicle appears in the documents | Have you sold, transferred or given away anything valuable in the past two years? |
| SQ5 | all | A bank account was closed by the bank | Which accounts are open today, and where does your income go now? |
| SQ6 | all | Income includes a variable part (bonus, commission) | How likely is the variable part of your income this year? |

## Chains
Build one row per starting item; a missing link is a finding.
| Id | Label | Links, in order |
|---|---|---|
| CH1 | Debt to filing | Source (statement, report line or letter); Client list row; Current holder; Party; Purpose; Draft schedule row |
| CH2 | Lawsuit to deadline | Court paper; Served date; Response deadline; Planned filing date |

## Record kinds
Read from IN-5 onward. Keys are used to match the same record across sources.
| Kind | Fields | Match keys | Party required |
|---|---|---|---|
| debt | creditor; original creditor; account last 4; balance; date opened; purpose; collateral | creditor or original creditor name and aliases; account last 4; balance within 10 percent; date opened | yes |
| asset | description; value; owner | description; owner | yes |
| income | source; amount; frequency; variable part | source | yes |
| contract | counterparty; type; date; current holder | counterparty; date | yes |

## Computed values
Code does the arithmetic from cited values. Ops: DAYS_BETWEEN(start, end), DIFFERENCE(a, b), RATE_PER_WEEK(from, to, start, end), SUM_BY(value, group), ADD_INTERVAL(date, interval), REFERENCE_GAP(value, table, row, column).
| Id | Label | Op | Inputs | Per |
|---|---|---|---|---|
| C1 | Age of counseling certificate in days | DAYS_BETWEEN | start = certificate completion date; end = study date | person |
| C2 | Days until response deadline | DAYS_BETWEEN | start = study date; end = response deadline | case |
| C3 | Days between a contract and the latest correspondence about it | DAYS_BETWEEN | start = contract date; end = latest letter date | contract |
| C4 | Difference between client amount and statement amount | DIFFERENCE | a = client list amount; b = statement amount | debt |
| C5 | Years since the latest tax return in the file | DIFFERENCE | a = study year; b = return tax year | person |
| C6 | Total listed debt by party | SUM_BY | value = balance; group = party | case |

## Documents usually needed
| Document | Holder | When | Settles |
|---|---|---|---|
| Credit counseling certificate (within 180 days of filing) | ASKER_OR_CLIENT | before filing | T1 |
| Credit report (one bureau) | ASKER_OR_CLIENT | before filing | R1, R3 |
| Client's list of creditors | ASKER_OR_CLIENT | before filing | R1, R2 |
| Statements or letters for each debt | ASKER_OR_CLIENT | before filing | R2, R8 |
| Loan and security documents | ASKER_OR_CLIENT | before filing | R6 |
| Lawsuit, judgment or garnishment papers | ASKER_OR_CLIENT | before filing | T2 |
| Federal income tax returns (last two years) | ASKER_OR_CLIENT | before filing | I1 |
| Pay stubs (60 days before filing) | ASKER_OR_CLIENT | before filing | I2 |
| Photo ID | ASKER_OR_CLIENT | before filing | I4 |
| Social Security card | ASKER_OR_CLIENT | before filing | I4 |
| Business formation or ownership record | ASKER_OR_CLIENT | before filing | B1 |
| Business balance sheet, profit and loss, cash-flow statement, business tax return | ASKER_OR_CLIENT | before filing | B2 |
| Business bank statement near the filing date | ASKER_OR_CLIENT | before filing | B3 |
| Current lease or contracts | ASKER_OR_CLIENT | before filing | R7 |
| Bank statement on the filing date | ASKER_OR_CLIENT | after filing (later) | B3 |

## Terms
| Term | Plain meaning |
|---|---|
| Petition | The papers that start a bankruptcy case |
| Schedules | The lists filed with the petition: what you own, what you owe, your income and expenses |
| Statement of financial affairs | Questions about your recent finances, lawsuits, payments and transfers |
| Creditor | Anyone you owe money to |
| Notice party | Someone who is told about the case without being listed as owed money |
| Debt buyer | A company that bought a debt from the original lender and now collects it |
| Garnishment | A court order that takes part of your wages or bank account to pay a debt |
| Credit counseling certificate | Proof you took an approved budget briefing before filing |
| Meeting of creditors | A meeting with the trustee after filing where you answer questions under oath |
| Subchapter V | A faster form of business reorganisation for small businesses |

## General notes
Shown as written under "In general"; never proof about this case.
| Id | Show when | Text |
|---|---|---|
| N1 | always | List every debt you might owe, even ones you plan to keep paying. A debt left off the filing may not be wiped out. |
| N2 | always | Listing a debt does not by itself stop you from continuing to pay it; ask your attorney about any debt you want to keep. |
| N3 | C1 present | The counseling certificate has to be from the 180 days before the filing date. If the filing is delayed, it may need to be taken again. |
| N4 | B3 not SHOWN | The firm may ask for a bank balance again on the filing date itself. |

## Customer report
Title: What we still need from you
| Order | Section | Built from |
|---|---|---|
| 1 | The short answer | narrative: if any deadline is within 14 days (C2), say so first with the date; then how many items are left and the single most urgent one (L1, L4) |
| 2 | Documents to send | block gaps (ask now first, each with one plain reason) (L1) |
| 3 | Questions for you | block questions: at most ten, most urgent first (L3) |
| 4 | Things to sign | block signatures (when available) (L2) |
| 5 | Dates to know | block computed (C1, C2) + narrative: what happens next (L4) |
| 6 | Good to know | block general_notes (N1, N2, N3) |
| 7 | Words used | block terms |
Voice: plain words; one sentence per reason; dates in words; address the client as "you"; never ask again for something already received.

## Professional report
Title: Intake status: {client}
| Order | Section | Built from |
|---|---|---|
| 1 | Bottom line | narrative: ready to file or not, the earliest deadline with days remaining, and the three items blocking filing; then answer L1 to L6 in one sentence each; block unanswered |
| 2 | Next actions | narrative: up to five actions in order, each citing the item it resolves (L6) |
| 3 | Deadlines and expiries | block computed (C1, C2, C5) + block timeline (L3) |
| 4 | Reconcile | block chains (CH1) + block conflicts + block computed (C4, C6): on the report but not the list, on the list but unsupported, debt buyers, amount differences (L2, L4) |
| 5 | Checklist | block checklist: not SHOWN first (L1) |
| 6 | Outstanding requests | block gaps with holder and age (L1) |
| 7 | Client questions | block questions (all) (L6) |
| 8 | Draft check | block draft_check (when available) (L5) |
| 9 | Coverage and caveats | narrative: unreadable pages, local rules not included, pack version and verification date |
Voice: dense; values as written; every row opens its source; written so another member of the firm can take over from it.

## Sources
- 11 U.S.C. 109(h)(1) (credit counseling within 180 days before filing).
- 11 U.S.C. 521(a)(1) (list of creditors, schedules, statement of financial affairs, payment advices within 60 days), 521(b)(1) (counseling certificate), 521(e)(2)(A) (tax return to trustee 7 days before the first meeting of creditors).
- 11 U.S.C. 1116(1) and 1187(a) (small business and Subchapter V debtor documents).
