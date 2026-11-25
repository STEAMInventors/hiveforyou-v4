# IEP domain reconciliation — Stage 4A

Status: DRAFT. Applicability verification: UNVERIFIED. Publication: UNPUBLISHED. Legal authorities remain NOT_REVIEWED.

Stage 3 definitions preserved: 245. Checks added: 30. Stage 4A definitions: 275.
Ontology checks represented in DP-1: 67. Pending: check:PP1, check:PR1, check:PR2, check:VR1.
Original document-to-check mismatches: 23. Remaining mismatches: 0. Source settlesCheckIds updates: 20. Ontology lists corrected by moving pending checks or question IDs: 6. Question IDs moved out of check lists: question:SQ3, question:SQ4, question:SQ7.
Authority records: 149. Unused classified: 16. Conflict patterns: 14. State overlays: 4. DAYS_BETWEEN candidates identified and not activated: 7.

## Authority classes

- FEDERAL_LAW: 135
- RESEARCH: 2
- PROFESSIONAL_CRITERIA: 1
- AUTHOR_PROPOSED: 10
- PLATFORM_POLICY: 1

## Pending checks

- check:PP1: Named on concerns, parent communications, and disagreements. No authority is mapped. check:P3 already covers recorded parent concerns. No distinct citation was created.
- check:PR1: Named on progress reports and progress measurements. No authority is mapped. check:G4 already covers periodic progress reports. No distinct citation was created.
- check:PR2: Named only on progress reports, with no authority. Not split away from check:G4.
- check:VR1: Named on the draft and prior IEP as a version signal. No entity rule and no authority. No version-comparison rule was invented.

## Proposed checks left outside DP-1

- check:DS1: Discipline module is deferred. The only mapped authority is a partial snippet of 34 CFR 300.530(e)(1). No ontology rule is defined, so no check was added.
- check:G3-LEGAL: Proposed split of the existing check:G3 Endrew F. citation. check:G3 is preserved. A second legal check was not added.
- check:IM2: Authority-only proposal for implementer access under 34 CFR 300.323(d). No ontology ruleId. Not added.
- check:P2b: Authority-only proposal for considering the most recent evaluation under 34 CFR 300.324(a)(1)(iii). check:S3 already uses that subject. Not added.
- check:PS2: Authority-only proposal for a Part C coordinator invitation under 34 CFR 300.321(f). Preschool / Part C transition is a deferred workflow. Not added.
- check:RV4: Authority-only proposal for an evaluation before ending eligibility under 34 CFR 300.305(e). Named in workflow notes as RV4, with no ontology ruleId. Not added.
- check:TR4: Authority-only proposal for a summary of performance under 34 CFR 300.305(e)(3). No ontology ruleId. Not added.

## Seven DAYS_BETWEEN candidates

- calculation:C1 (Days from consent received to evaluation completion): start = entity:consent.receivedDate; end = entity:evaluation.completionDate. State remains DECLARATION_ONLY.
- calculation:C2 (Days from eligibility decision to IEP meeting): start = entity:eligibility-determination.determinationDate; end = entity:iep.meetingDate. State remains DECLARATION_ONLY.
- calculation:C3 (Days from IEP date to service start): start = entity:iep.meetingDate; end = entity:service.startDate. State remains DECLARATION_ONLY.
- calculation:C14 (Days from records request to response): start = entity:records-request.requestDate; end = entity:records-request.responseDate. State remains DECLARATION_ONLY.
- calculation:C15 (Days notice before meeting): start = entity:meeting-notice.noticeDate; end = entity:iep-meeting.meetingDate. State remains DECLARATION_ONLY.
- calculation:C20 (Days from IEE request to agency response): start = entity:iee-request.requestDate; end = entity:iee-request.agencyResponseDate. State remains DECLARATION_ONLY.
- calculation:C21 (Days from evaluation completion to eligibility): start = entity:evaluation.completionDate; end = entity:eligibility-determination.determinationDate. State remains DECLARATION_ONLY.

## Stage 4B

- 4B-1: Activate only the seven DAYS_BETWEEN calculations as day counts.
- 4B-2: Leave every check at REVIEW_REQUIRED.
- 4B-3: Do not add EVERY, EXISTS, conflictPattern, stateOverlay, or factClasses to DP-1.
- 4B-4: Promote a pending check only when a cited meaning is written and mapped.
- 4B-5: Promote a proposed check only when an ontology ruleId exists and every mapped authority used as the statement is more than a partial snippet.
- 4B-6: Map an unused authority only after the candidate definition is reviewed. The Stage 4A candidates are not applied mappings.
