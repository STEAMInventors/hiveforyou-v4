# bankruptcy-c13 - consumer Chapter 13 case (synthetic)

Dana R. Whitfield files a Chapter 13 case (No. 26-40217-C13, fictional District of Westmarch) on March 2, 2026. The Trustee objects to the first plan; the Debtor files a First Amended Plan on April 28, 2026 that raises the payment and pays the car lender in full. The mortgage servicer says the arrears are larger than the plan provides. Confirmation hearing: May 14, 2026.

## Documents

| File | Pages | Content |
|---|---|---|
| `01_petition_schedules.pdf` | 35 | Voluntary petition (pp. 1-8), summary (9), Schedules A/B (10-16), C (17-18), D (19-20), E/F (21-25), G (26), H (27), I (28-29), J (30-31), declaration (32), Statement of Financial Affairs (33-35) |
| `02_chapter13_plan.pdf` | 2 | Original plan: $510.00 x 60, mortgage arrears $9,600.00, car crammed down to $11,200.00, 12% unsecured dividend |
| `03_trustee_objection.pdf` | 1 | Objection: income not reconciled, car (910-day) treatment, missing Exhibit C; hearing notice |
| `04_amended_plan.pdf` | 2 | First Amended Plan: $640.00 x 60, car claim $14,850.00 paid in full, arrears still $9,600.00, 15% dividend |
| `05_income_statement.pdf` | 1 | Employer payment advice summary, six months, average gross $5,325.00 |
| `06_creditor_letter.pdf` | 1 | Cobalt Ridge Mortgage: arrears $12,180.00 as of the petition date |

## Planted

- **Conflict C1 - gross monthly wages:** Schedule I says $4,850.00 (`01`, page 29, deliberately past page 20 so extraction must cross a page-range boundary); the payment advice summary says $5,325.00 (`05`, page 1). The Trustee's objection mentions the mismatch without figures.
- **Filler:** pages 2-28 and 30-35 of `01` are plausible schedule entries (ten unsecured creditors, exemptions, contracts, financial affairs). Their totals are internally consistent and are not labeled.
- **Conflict C2 - mortgage arrears:** both plans cure $9,600.00 (`04`, page 1); the servicer's letter states $12,180.00 (`06`, page 1).
- **Missing document X1:** the 2025 federal income tax return, "Exhibit C", is referenced in `02` Section 9, `03` and `04` Section 9 but is not supplied.
- **Not a conflict (supersession):** the payment ($510.00 to $640.00), the car treatment and the dividend (12% to 15%) change between `02` and `04`; the amended plan expressly replaces the original.

Anchor: `04_amended_plan.pdf`, as the current link of the plan chain `02` -> `04` (`ANCHOR_CHAIN`).
