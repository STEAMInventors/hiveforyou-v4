# intake-smallbiz - new-client intake, individual with a single-member business (synthetic)

Marcus T. Ellery owns Ellery Print and Sign LLC, a single-member company in Fernhill, Westmarch (fictional). He has stopped paying several personal and business debts, has just been sued on one of them, and has gone to a law office to prepare a filing for himself and the business. The corpus is what the office has collected so far: his own list of debts, an independent account report, tax summaries, business and lease papers, a court paper, an old certificate, and the office's first draft list. No single document organizes the case.

All names, numbers, courts and companies are fictional. The tax id `00-4417203` uses a prefix that is never issued; the SSN appears only masked.

## Case date

**Case date (study date): November 16, 2026 (`2026-11-16`).** Every day count below and in `golden.json` is measured from this date.

| Count | From | To | Days |
|---|---|---|---|
| Days until the response deadline | 2026-11-16 | 2026-12-07 | 21 |
| Served date to response deadline | 2026-11-09 | 2026-12-07 | 28 |
| Age of the certificate at the case date | 2026-04-22 | 2026-11-16 | 208 (limit 180; expired by 28) |
| Lease date to the later letter | 2024-11-01 | 2026-09-22 | 690 |
| Age of the lease at the case date | 2024-11-01 | 2026-11-16 | 745 |

## Documents

| File | Pages | Content |
|---|---|---|
| `01_client_debt_list.pdf` | 1 | The client's own list, exported from a spreadsheet October 28, 2026: 12 rows, total $133,942, personal and business mixed, notes in his words |
| `02_account_report.pdf` | 3 | Northgate Credit Data report, November 2, 2026: 14 accounts (A1-A8 personal, B1-B6 business), 13 with a balance totalling $137,074, 1 closed |
| `03_tax_return_summary_2024.pdf` | 1 | Individual return summary, tax year 2024: business net profit $41,870, adjusted gross income $39,024 |
| `04_tax_return_summary_2025.pdf` | 1 | Individual return summary, tax year 2025: business net profit $23,415, adjusted gross income $21,799 |
| `05_business_formation.pdf` | 1 | Certificate of organization, June 3, 2019: tax id 00-4417203, sole member with 100 percent |
| `06_shop_lease.pdf` | 1 | Commercial lease dated November 1, 2024, landlord Alderpoint Commercial Properties LLC, $2,450.00 a month, no personal guaranty |
| `07_balance_letter.pdf` | 1 | Kestrel Row Asset Management LLC, September 22, 2026: lease assigned to it June 1, 2026; unpaid balance $7,935.00 |
| `08_loan_commitment_letter.pdf` | 1 | Foundry Commerce Bank, August 14, 2024: $45,000.00 term loan to the business, unconditional personal guarantee |
| `09_court_summons.pdf` | 1 | Tallgrass Recovery Partners LLC v. Marcus T. Ellery, CV-26-03184: served November 9, 2026, response deadline December 7, 2026, $6,412.00 claimed |
| `10_counseling_certificate.pdf` | 1 | Certificate of counseling completed April 22, 2026 |
| `11_draft_filing_list.pdf` | 1 | The office's Draft 1 list, November 12, 2026: 12 entries, total $133,029.00 |

Regenerate with `node eval/tools/build-corpora.mts intake-smallbiz`.

## Parties

| Id | Party | Shown by |
|---|---|---|
| P1 | Marcus T. Ellery, individual | `02` page 1, `05` |
| P2 | Ellery Print and Sign LLC, business; tax id 00-4417203; P1 is sole member with 100 percent | `05` |

A record's party is `individual` (P1 only), `business` (P2 only) or `joint` (P2 with P1 personally liable as guarantor). The client's list does not assign parties; the report's "Responsibility" line, the lease and the loan letter do.

## Records: 14 accounts, 13 open obligations

| Record | List row | Report entry | Draft row | Party | Amount (list / report / draft) |
|---|---|---|---|---|---|
| D01 Harbor First Bank Visa 4471, now Tallgrass Recovery Partners | 1 | A2 | 1 | individual | $6,180 / $6,412 / $6,412.00 |
| D02 Cedar Mutual auto loan 2086 | 2 | A1 | 2 | individual | $14,863 all three |
| D03 Westmarch Student Loan Servicing 7754 | 3 | A4 | 3 | individual | $11,240 all three |
| D04 Marlow's Home Store card 3312 | 4 | A6 | 4 | individual | $1,987 all three |
| D05 Brightwell Lending personal loan 9108 | 5 | A8 | 5 | individual | $9,274 all three |
| D06 Pinecrest Medical Group 0563 | 6 | A7 | 6 | individual | $2,140 all three |
| D07 Summit Ridge Bank business Visa 6627 | 7 | B2 | 8 | joint | $8,804 all three |
| D08 Summit Ridge Bank line of credit 1175 | 8 | B4 | 9 | joint | $17,950 all three |
| D09 Orchard Equipment Finance 4490 | 9 | B5 | 10 | business | $12,480 all three |
| D10 Foundry Commerce Bank term loan 8802 | 10 | B1 | 11 | joint | $38,214 all three |
| D11 Shop rent, Alderpoint, now Kestrel Row 5120 | 11 | B3 | 12 | business | $7,350 / $7,935 / $7,350.00 |
| D12 Greywater Paper and Supply 2231 | 12 | B6 | - | business | $3,460 / $3,460 / not on draft |
| D13 Coastal Plains Bank card 5538 | - | A3 | 7 | individual | not on list / $2,315 / $2,315.00 |
| D14 Cedar Mutual Visa 6641 (closed) | - | A5 | - | individual | not on list / $0 / not on draft |

The report lists accounts in a different order from the client's list on purpose. Other records in `golden.json`: K01 (the lease), K02 (the loan commitment), I01 and I02 (the two tax years).

## Planted

1. **Same record, new holder (2).**
   - D01: the client lists "Harbor First Bank Visa" (row 1); the report shows Tallgrass Recovery Partners LLC with "Original creditor: Harbor First Bank (Visa)", same account ending 4471, assigned June 18, 2026 (`02` page 1, A2). The court paper confirms Tallgrass is the assignee.
   - D11: the client lists "Alderpoint Commercial Properties" with no account number (row 11); the report shows Kestrel Row Asset Management LLC with "Original creditor: Alderpoint Commercial Properties LLC" (`02` page 3, B3). No shared account number: the match rests on the original holder's name and the balance.
2. **Entry missing from the client's list (1).** D13 Coastal Plains Bank Mastercard ending 5538, $2,315, open and 120 days past due (`02` page 1, A3). Not on the client's list.
3. **Closed entry (1).** D14 Cedar Mutual Credit Union Visa ending 6641, closed and paid in full February 2025, balance $0 (`02` page 1, A5). It is correctly absent from the list and the draft, and is *not* a missing entry. The same lender also holds the open auto loan D02, so the two must not be merged.
4. **Amounts that differ between sources (2), both within 10 percent.**
   - D01: list $6,180; report $6,412; court paper $6,412.00 (difference $232, 3.6 percent).
   - D11: list $7,350; letter $7,935.00; report $7,935 (difference $585, the late charges; 7.4 percent).
   The other ten matched rows carry the same amount on the list and the report.
5. **Stale lease.** The lease (`06`) is dated November 1, 2024, two years before the case date, and names Alderpoint as landlord. The later letter (`07`, September 22, 2026) is from a different company, Kestrel Row, which says the lease was assigned to it on June 1, 2026, that rent must go to it and not to the former landlord, and that $7,935.00 is unpaid.
6. **Loan commitment with a personal guarantee.** `08`: $45,000.00 to the business, conditioned on the owner's unconditional personal guarantee; this makes D10 `joint`. The $45,000.00 is the original commitment, not the balance ($38,214).
7. **Deadline.** `09`: served November 9, 2026; a written response is due within 28 days after service; response deadline December 7, 2026, 21 days after the case date. The lawsuit is on D01.
8. **Expired certificate.** `10`: completed April 22, 2026, 208 days before the case date (limit 180).
9. **Draft differences (2).**
   - Missing: the draft (`11`) has 12 entries and omits D12 Greywater Paper and Supply, which is on the client's list (row 12) and the report (B6).
   - Value differs: the draft lists Kestrel Row at $7,350.00; Kestrel Row's own letter states $7,935.00.
   The draft has no extra entry: it includes D13 (found on the report) and leaves out the closed D14.
10. **Purpose questions (2, in the client's own words; not defects).** D05: "the loan is in my name, most of it paid for the wide-format printer". D02: the pickup is "also" used for shop deliveries. Both are individual accounts whose purpose needs a client answer.

Totals as written: list $133,942; report $137,074 (13 accounts with a balance; personal $48,231, business $88,843); draft $133,029.00.

## Not planted

- No conflict other than the two amount differences above. The tax summaries, the formation page and the loan letter agree with every other document.
- Absent on purpose but not labeled as planted gaps: income records for 2026, an identity document, business bank and financial statements, statements from individual lenders.

Anchor: none (`null`). Spine source: `PARTIES_AND_OBLIGATIONS` or `TIMELINE` (both accepted).

## golden.json

The fields the current scorer reads (`anchorDocument`, `spineSource`, `spine`, `conflicts`, `gaps`, `negativeControls`) are filled in the usual way. The fields below are extra; the scorer ignores them until the tickets that use them (IN-4 to IN-8) add scoring. Every `evidence` item is a `{ file, page, quoteFragment }` location, and every fragment was checked against its page when the corpus was built.

| Field | Content |
|---|---|
| `caseDate` | `2026-11-16` |
| `parties` | P1 and P2 with evidence; P2 carries the tax id and its owner |
| `records` | D01-D14 (kind `debt`), K01-K02 (`contract`), I01-I02 (`income`): party, party evidence, current and original holder, account last 4, status, and the row, amount and evidence in the client's list, the report and the draft (`null` where absent) |
| `matches` | M01-M12, client's list to report, one per list row; `matchKind` is `same` (10) or `new_holder` (2: D01, D11) |
| `missingEntries` | ME1: D13 |
| `closedEntries` | CE1: D14 |
| `valueDifferences` | VD1 (D01), VD2 (D11) |
| `staleDocuments` | SD1: the lease, with the later letter and the day counts |
| `deadlines` | DL1: served date, rule, due date, 21 days from the case date |
| `validity` | V1: the certificate, 208 days old, window 180, expired |
| `draftDifferences` | DD1 missing (D12), DD2 value differs (D11); `draftExtras` is empty |
| `totals` | the three totals as written |

`"reviewed": false` until the founder reviews the labels.
