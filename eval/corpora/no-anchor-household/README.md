# no-anchor-household - household paperwork with no central document (synthetic)

Priya and Tomas Lindqvist-Rao rent Unit 3 at 48 Alder Court. In August 2026 they have utility bills due, a renters insurance renewal, and a kitchen-sink leak: they report it, the landlord's plumber repairs it, and the property manager asks them to reimburse the repair. No single document organizes the case; the useful structure is who owes what to whom, and by when.

## Documents

| File | Pages | Content |
|---|---|---|
| `01_electric_bill.pdf` | 1 | Brightwater Electric: $142.37 due August 22, 2026 |
| `02_water_bill.pdf` | 1 | Fernhill Municipal Water: $88.60 due September 15, 2026; usage up 38%; leak adjustment within 60 days |
| `03_insurance_renewal.pdf` | 1 | Halden Mutual renters renewal: $312.00 (was $276.00), term from September 1, 2026; water-damage terms |
| `04_lease_clause.pdf` | 1 | Lease excerpt: utilities; landlord pays plumbing repairs unless tenant negligence; 48-hour written report; move-in checklist "attached as Exhibit B" |
| `05_repair_invoice.pdf` | 1 | Keel and Sons Plumbing invoice to the landlord: $386.50; cause corrosion due to age, no misuse |
| `06_email_leak_report.pdf` | 1 | Tenant's email reporting the leak on August 14, 2026 |
| `07_email_reimbursement_request.pdf` | 1 | Property manager's email asking the tenants to reimburse "the plumber's invoice of $468.50" with September rent |

## Planted

- **Conflict C1 - repair amount:** the invoice totals $386.50 (`05`, page 1); the property manager's email cites $468.50 (`07`, page 1).
- **Gap X1 - missing exhibit:** lease section 14.5 records the move-in condition in an inspection checklist "attached as Exhibit B", which is not supplied. (That the lease is an excerpt is not itself labeled as a gap.)
- The reimbursement request is also questionable under lease 14.1 (the invoice records no misuse); golden marks it `CONFLICTED` for the amount only.

Anchor: none (`null`). Spine source: `PARTIES_AND_OBLIGATIONS` or `TIMELINE` (both accepted).
