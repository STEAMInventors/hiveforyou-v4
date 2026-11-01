// Synthetic demonstration data for the HiveForYou V4 prototype. Every value is invented.
(function () {
  const S = {};

  S.medicaid = {
    id: 'medicaid', label: 'Medicaid financial review',
    hiveTitle: "Mom's Medicaid application",
    purpose: 'Five-year financial review for a Medicaid application',
    ask: "I need to understand five years of bank statements for my mother's Medicaid application.",
    goal: 'Prepare a five-year financial review packet.',
    deliverable: 'Evidence-backed financial review packet',
    likelyWork: 'Document inventory, coverage checking, transaction reconciliation, exception review and packet preparation.',
    lastActivity: 'Today, 9:42 AM', studyRev: 3,
    studyRevs: [
      { rev: 1, date: 'Oct 20', note: 'First Study built from 6 files' },
      { rev: 2, date: 'Oct 21', note: 'Added 2026 statements and agency letter' },
      { rev: 3, date: 'Oct 28', note: 'Added savings statements; duplicate set aside' }
    ],
    order: { understand: 3, plan: 1, compare: 2, exceptions: 1, timeline: 4, ops: 5 },
    docs: [
      { id: 'm1', file: 'chk4421_2022.pdf', role: 'Checking 4421 · 2022', type: 'Bank statements (12 monthly)', period: 'Jan–Dec 2022', pages: 24, cov: 100, org: 'Synthetic Community Bank', flags: [] },
      { id: 'm2', file: 'chk4421_2023_partial.pdf', role: 'Checking 4421 · 2023', type: 'Bank statements (9 monthly)', period: 'Jan–Mar, Jul–Dec 2023', pages: 18, cov: 100, org: 'Synthetic Community Bank', flags: [{ k: 'missing', t: 'Apr–Jun not included' }] },
      { id: 'm3', file: 'Scan_0042.pdf', role: 'Checking 4421 · 2024', type: 'Bank statements (12 monthly)', period: 'Jan–Dec 2024', pages: 24, cov: 96, org: 'Synthetic Community Bank', unreadable: [11], flags: [{ k: 'missing', t: 'p.11 unreadable' }] },
      { id: 'm4', file: 'chk_2025.pdf', role: 'Checking 4421 · 2025', type: 'Bank statements (12 monthly)', period: 'Jan–Dec 2025', pages: 24, cov: 100, org: 'Synthetic Community Bank', flags: [] },
      { id: 'm5', file: 'chk_2025 (1).pdf', role: 'Checking 4421 · 2025 (copy)', type: 'Duplicate', period: 'Jan–Dec 2025', pages: 24, cov: null, org: 'Synthetic Community Bank', dup: true, flags: [{ k: 'changed', t: 'Exact copy of chk_2025.pdf' }] },
      { id: 'm6', file: 'chk4421_2026.pdf', role: 'Checking 4421 · 2026', type: 'Bank statements (6 monthly)', period: 'Jan–Jun 2026', pages: 12, cov: 100, org: 'Synthetic Community Bank', flags: [] },
      { id: 'm7', file: 'savings_3819_2023-25.pdf', role: 'Savings 3819 · 2023–25', type: 'Bank statements (12 quarterly)', period: 'Jan 2023 – Dec 2025', pages: 36, cov: 100, org: 'Synthetic Community Bank', flags: [] },
      { id: 'm8', file: 'savings_3819_Q1_2026.pdf', role: 'Savings 3819 · Q1 2026', type: 'Bank statement (quarterly)', period: 'Jan–Mar 2026', pages: 3, cov: 100, org: 'Synthetic Community Bank', flags: [] },
      { id: 'm9', file: 'agency_letter.pdf', role: 'Agency checklist letter', type: 'Letter', period: 'Aug 4, 2026', pages: 2, cov: 100, org: 'County Department of Social Services (synthetic)', flags: [] }
    ],
    ev: {
      e1: { doc: 'm9', page: 1, quote: 'Please provide statements for all accounts from January 2022 through August 2026.', supports: 'Review period: Jan 2022 – Aug 2026', status: 'verified' },
      e2: { doc: 'm7', page: 14, quote: '03/14/2024   Transfer to acct ****7710   -12,000.00', supports: '$12,000.00 transfer to an outside account', status: 'verified', unc: 'No uploaded document identifies who holds account 7710.' },
      e3: { doc: 'm4', page: 15, quote: '08/02/2025   Check 1184   R. Ellis   -8,500.00', supports: '$8,500.00 check to R. Ellis', status: 'verified', unc: 'These records don’t show who R. Ellis is or what the check was for.' },
      e4: { doc: 'm2', page: 11, quote: '09/05/2023   Transfer to Savings ****3819   -5,000.00', supports: '$5,000.00 leaving Checking 4421', status: 'verified' },
      e5: { doc: 'm7', page: 8, quote: '09/05/2023   Transfer from Checking ****4421   +5,000.00', supports: '$5,000.00 arriving in Savings 3819', status: 'verified' },
      e6: { doc: 'm3', page: 21, quote: '11/20/2024   Branch withdrawal   -2,400.00', supports: '$2,400.00 withdrawal from Checking 4421', status: 'verified', unc: 'The withdrawal doesn’t say where the money went.' },
      e7: { doc: 'm7', page: 23, quote: '11/22/2024   Branch deposit   +2,400.00', supports: '$2,400.00 deposit into Savings 3819', status: 'uncertain', unc: 'Same amount two days later, but the deposit doesn’t name its source.' },
      e8: { doc: 'm3', page: 24, quote: 'Closing balance 12/31/2024   $14,212.40', supports: 'December 2024 closing balance', status: 'verified' },
      e9: { doc: 'm4', page: 1, quote: 'Opening balance 01/01/2025   $14,012.40', supports: 'January 2025 opening balance', status: 'verified' },
      e10: { doc: 'm2', page: 6, quote: 'Statement period 03/01/2023 – 03/31/2023', supports: 'Last checking statement before the gap', status: 'verified' },
      e11: { doc: 'm2', page: 7, quote: 'Statement period 07/01/2023 – 07/31/2023', supports: 'First checking statement after the gap', status: 'verified' },
      e12: { doc: 'm3', page: 11, quote: '(page too blurred to read)', supports: 'June 2024 checking statement, page 1', status: 'unreadable', unc: 'Hive could not read this page. Its transactions are not part of any check.' },
      e13: { doc: 'm6', page: 12, quote: 'Statement period 06/01/2026 – 06/30/2026', supports: 'Latest checking statement provided', status: 'verified' },
      e14: { doc: 'm8', page: 3, quote: 'Statement period 01/01/2026 – 03/31/2026', supports: 'Latest savings statement provided', status: 'verified' },
      e15: { doc: 'm7', page: 1, quote: 'MARGARET ELLIS · Savings ****3819 · Statement period 01/01/2023 – 03/31/2023', supports: 'Earliest savings statement; account holder', status: 'verified' },
      e16: { doc: 'm1', page: 1, quote: 'MARGARET ELLIS · Checking ****4421 · Statement period 01/01/2022 – 01/31/2022', supports: 'Earliest checking statement; account holder', status: 'verified' }
    },
    matrix: {
      title: 'Statement coverage', sub: 'Review period from the agency letter: Jan 2022 – Aug 2026', rowHead: 'Account',
      cols: ['2022', '2023', '2024', '2025', '2026'],
      rows: [
        { label: 'Checking 4421', cells: [
          { s: 'complete', note: '12 monthly statements, January to December.', docs: ['m1'], ev: ['e16'] },
          { s: 'gap', note: 'April, May and June 2023 are not in any uploaded file.', docs: ['m2'], ev: ['e10', 'e11'], x: 'x4' },
          { s: 'complete', note: '12 monthly statements. Page 11 (June, page 1) is unreadable.', docs: ['m3'], ev: ['e12'], x: 'x8' },
          { s: 'complete', note: '12 monthly statements. A second, identical copy was set aside.', docs: ['m4', 'm5'], ev: ['e9'] },
          { s: 'partial', note: 'January to June provided. July and August are within the review period.', docs: ['m6'], ev: ['e13'], x: 'x5' }
        ] },
        { label: 'Savings 3819', cells: [
          { s: 'unknown', note: 'No 2022 documents. These records don’t show whether this account was open in 2022.', docs: [], ev: ['e15'], x: 'x7' },
          { s: 'complete', note: '4 quarterly statements.', docs: ['m7'], ev: ['e15'] },
          { s: 'complete', note: '4 quarterly statements.', docs: ['m7'], ev: ['e7'] },
          { s: 'complete', note: '4 quarterly statements.', docs: ['m7'], ev: [] },
          { s: 'partial', note: 'First quarter provided. April to August are within the review period.', docs: ['m8'], ev: ['e14'], x: 'x6' }
        ] }
      ]
    },
    understand: {
      metrics: [
        { label: 'Files read', value: '9', sub: '8 unique · 1 exact duplicate' },
        { label: 'Accounts found', value: '2', sub: 'Checking 4421 · Savings 3819', ev: ['e16', 'e15'] },
        { label: 'Flagged transfers out', calc: 'c1', sub: 'No matching deposit in another uploaded account' }
      ],
      groups: [
        { title: 'People and accounts', items: [
          { text: 'Margaret Ellis is the account holder on Checking 4421 and Savings 3819.', ev: ['e16', 'e15'] },
          { text: 'Account 7710 appears only as a transfer destination.', ev: ['e2'] },
          { text: 'R. Ellis appears once, as the payee on check 1184.', ev: ['e3'] }
        ] },
        { title: 'Dates and periods', items: [
          { text: 'The agency letter asks for statements from January 2022 through August 2026.', ev: ['e1'] },
          { text: 'Checking statements run from January 2022 to June 2026, with April–June 2023 missing.', ev: ['e16', 'e13'] },
          { text: 'Savings statements run from January 2023 to March 2026.', ev: ['e15', 'e14'] }
        ] },
        { title: 'Relationships', items: [
          { text: '$5,000.00 left Checking on September 5, 2023 and arrived in Savings the same day.', ev: ['e4', 'e5'] },
          { text: 'chk_2025 (1).pdf is an exact copy of chk_2025.pdf and was set aside.', ev: [] }
        ] },
        { title: 'Uncertain', unc: true, items: [
          { text: 'The $2,400.00 deposit on November 22, 2024 may be the November 20 withdrawal. The deposit doesn’t name its source.', ev: ['e6', 'e7'] },
          { text: 'These records don’t show who R. Ellis is.', ev: ['e3'] }
        ] }
      ]
    },
    compare: {
      title: 'Transfer reconciliation', sub: 'Transfers of $1,000.00 or more, matched across the uploaded accounts',
      cols: ['Date', 'Leaving', 'Arriving', 'Amount'],
      rows: [
        { cells: ['Sep 5, 2023', 'Checking 4421', 'Savings 3819', '$5,000.00'], ev: ['e4', 'e5'], result: 'Matched on both statements', rs: 'same' },
        { cells: ['Mar 14, 2024', 'Savings 3819', 'Account 7710 (outside)', '$12,000.00'], ev: ['e2'], result: 'No matching deposit', rs: 'needs', x: 'x1' },
        { cells: ['Nov 20–22, 2024', 'Checking 4421', 'Savings 3819?', '$2,400.00'], ev: ['e6', 'e7'], result: 'Proposed match', rs: 'needs', x: 'x3' },
        { cells: ['Aug 2, 2025', 'Checking 4421', 'R. Ellis (check 1184)', '$8,500.00'], ev: ['e3'], result: 'No matching deposit', rs: 'needs', x: 'x2' }
      ]
    },
    timeline: [
      { date: 'Jan 2022', text: 'Review period begins', ev: ['e1'] },
      { date: 'Sep 5, 2023', text: '$5,000.00 Checking → Savings (matched)', ev: ['e4', 'e5'] },
      { date: 'Mar 14, 2024', text: '$12,000.00 Savings → account 7710', ev: ['e2'] },
      { date: 'Nov 20, 2024', text: '$2,400.00 withdrawn from Checking', ev: ['e6'] },
      { date: 'Aug 2, 2025', text: '$8,500.00 check to R. Ellis', ev: ['e3'] },
      { date: 'Aug 4, 2026', text: 'Agency checklist letter', ev: ['e1'] }
    ],
    calcs: {
      c1: { title: 'Flagged transfers out', unit: 'usd', method: 'Add every withdrawal or transfer of $1,000.00 or more that has no matching deposit in another uploaded account.',
        inputs: [
          { label: 'Mar 14, 2024 · Savings 3819 → account 7710', value: 12000, sign: 1, ev: 'e2' },
          { label: 'Aug 2, 2025 · Check 1184 to R. Ellis', value: 8500, sign: 1, ev: 'e3' },
          { label: 'Nov 20, 2024 · Withdrawal (you rejected the match)', value: 2400, sign: 1, ev: 'e6', when: { x: 'x3', status: 'rejected' } }
        ],
        excluded: [
          { label: 'Sep 5, 2023 · $5,000.00 matched to a Savings deposit', ev: 'e4' },
          { label: 'Nov 20, 2024 · $2,400.00 proposed match, awaiting your decision', ev: 'e6', when: { x: 'x3', status: 'open' } },
          { label: 'Nov 20, 2024 · $2,400.00 match accepted by you', ev: 'e6', when: { x: 'x3', status: 'accepted' } }
        ] }
    },
    tasks: [
      { id: 't1', title: 'Sort and identify every document', does: 'Know what each file is, and which account and period it covers.', by: 'hive', state: 'COMPLETED', inputs: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'], method: 'Read each page, identify the issuer, account number and statement period, and compare file contents for duplicates.', result: '9 files: 8 unique, 1 exact duplicate (chk_2025 (1).pdf).', op: 'o1', why: 'Every review starts from a reliable inventory.' },
      { id: 't2', title: 'Check statement coverage, Jan 2022 – Aug 2026', does: 'Find every month in the review period with no statement.', by: 'hive', state: 'COMPLETED', deps: ['t1'], inputs: ['e1', 'e10', 'e11', 'e13', 'e14'], method: 'List each statement period by account, then compare against the months requested in the agency letter.', result: '2 accounts checked. 4 gaps and 1 unreadable page found.', op: 'o3', why: 'The agency letter asks for every month of every account.' },
      { id: 't3', title: 'Match transfers between your own accounts', does: 'Separate money moving between Margaret’s accounts from money leaving them.', by: 'hive', state: 'NEEDS_REVIEW', deps: ['t1'], inputs: ['e4', 'e5', 'e6', 'e7'], method: 'Pair withdrawals and deposits of the same amount within 3 days across the two accounts. Pairs with a named counterpart are matched; pairs without one are proposed.', result: '1 matched ($5,000.00, Sep 5, 2023). 1 proposed match needs your decision ($2,400.00).', derive: ['x3'], op: 'o4', why: 'Internal transfers don’t need explaining; transfers out do.' },
      { id: 't4', title: 'Flag transfers of $1,000 or more leaving these accounts', does: 'List the transfers a reviewer is likely to ask about.', by: 'hive', state: 'COMPLETED', deps: ['t3'], inputs: ['e2', 'e3'], method: 'Every outgoing item of $1,000.00 or more with no matching deposit in another uploaded account.', result: '2 transfers to outside parties, $20,500.00 total.', op: 'o5', why: 'Large transfers out during the review period usually need an explanation.' },
      { id: 't5', title: 'Explain the flagged transfers', does: 'Add what you know about each one. Hive records your note; it doesn’t change the statements.', by: 'you', state: 'READY', deps: ['t4'], derive: ['x1', 'x2'], why: 'Only you can say what these payments were for.' },
      { id: 't6', title: 'Request the missing records', does: 'Draft a request for each missing statement or unreadable page.', by: 'you', state: 'READY', deps: ['t2'], derive: ['x4', 'x5', 'x6', 'x7', 'x8'], why: 'Gaps in coverage will be visible to any reviewer.' },
      { id: 't7', title: 'Check that balances carry over between statements', does: 'Compare each closing balance with the next opening balance.', by: 'hive', state: 'PROPOSED', deps: ['t1'], inputs: ['e8', 'e9'], method: 'For each account, compare the closing balance of every statement with the opening balance of the next one.', runResult: 'Checked every consecutive pair of statements. 1 difference: $200.00 between Dec 31, 2024 and Jan 1, 2025.', reveals: ['x9'], revealsOp: 'o7', why: 'A balance that doesn’t carry over can point to a missing statement or a misread page.' },
      { id: 't8', title: 'Read page 11 of the 2024 checking file', does: 'Extract the transactions on the June 2024 statement, page 1.', by: 'hive', state: 'FAILED', deps: ['t1'], inputs: ['e12'], method: 'Re-read the page at higher resolution.', result: 'The page is too blurred to read reliably.', failMsg: 'Still unreadable. Upload a clearer copy of the June 2024 statement.', why: 'Transactions on this page aren’t part of any check until it can be read.' },
      { id: 't9', title: 'Assemble the review packet', does: 'Put the inventory, coverage, transfers, notes and requests into one packet.', by: 'hive', state: 'BLOCKED', deps: ['t3', 't5', 't6'], method: 'Build each section from the accepted Study and link every row to its source page.', runResult: 'Packet prepared in Reports.', makesReport: true, why: 'This is the deliverable.' },
      { id: 't10', title: 'Value real property', does: 'Record property values from deeds or tax bills.', by: 'hive', state: 'SKIPPED', why: 'Suggested because Medicaid reviews often include property.', result: 'Skipped by you on Oct 27: no property records.' }
    ],
    exceptions: [
      { id: 'x1', kind: 'needs', title: '$12,000.00 transfer to an outside account', detail: 'Savings 3819 sent $12,000.00 to account ending 7710 on March 14, 2024. No uploaded document identifies account 7710.', why: 'The packet needs an explanation for transfers out during the review period.', ev: ['e2'], acts: ['source', 'explain', 'na'] },
      { id: 'x2', kind: 'needs', title: '$8,500.00 check to R. Ellis', detail: 'Check 1184 for $8,500.00 cleared on August 2, 2025. These records don’t show who R. Ellis is or what it was for.', why: 'The packet needs an explanation for transfers out during the review period.', ev: ['e3'], acts: ['source', 'explain', 'na'] },
      { id: 'x3', kind: 'needs', title: 'Proposed match: $2,400.00 withdrawal and deposit', detail: '$2,400.00 left Checking on November 20, 2024 and $2,400.00 arrived in Savings on November 22. The deposit doesn’t name its source.', why: 'If they match, it’s an internal transfer. If not, the withdrawal joins the flagged transfers.', ev: ['e6', 'e7'], acts: ['source', 'accept', 'reject'], acceptLabel: 'Accept match', rejectLabel: 'Not a match' },
      { id: 'x4', kind: 'missing', title: 'Three months of checking statements are missing', detail: 'These records don’t include Checking 4421 statements for April, May or June 2023.', why: 'The agency letter asks for every month from January 2022 through August 2026.', ev: ['e10', 'e11'], acts: ['coverage', 'source', 'request', 'na'], cell: [0, 1], request: 'Checking account ending 4421 — monthly statements for April, May and June 2023.' },
      { id: 'x5', kind: 'missing', title: 'Checking statements after June 2026 aren’t included', detail: 'The latest checking statement ends June 30, 2026. July and August 2026 are in the review period.', why: 'The review period runs through August 2026.', ev: ['e13'], acts: ['coverage', 'source', 'request', 'na'], cell: [0, 4], request: 'Checking account ending 4421 — monthly statements for July and August 2026.' },
      { id: 'x6', kind: 'missing', title: 'Savings statements after March 2026 aren’t included', detail: 'The latest savings statement ends March 31, 2026.', why: 'The review period runs through August 2026.', ev: ['e14'], acts: ['coverage', 'source', 'request', 'na'], cell: [1, 4], request: 'Savings account ending 3819 — statements covering April through August 2026.' },
      { id: 'x7', kind: 'missing', title: 'No savings records for 2022', detail: 'The earliest savings statement begins January 1, 2023. These records don’t show whether the account was open in 2022.', why: 'If the account was open, 2022 statements are part of the review period.', ev: ['e15'], acts: ['coverage', 'request', 'na'], cell: [1, 0], request: 'Savings account ending 3819 — statements for 2022, or the date the account was opened.' },
      { id: 'x8', kind: 'missing', title: 'Page 11 of the 2024 checking file is unreadable', detail: 'Page 1 of the June 2024 statement is too blurred to read. Its transactions aren’t part of any check.', why: 'Transactions on this page can’t be included until it’s readable.', ev: ['e12'], acts: ['coverage', 'source', 'request', 'na'], cell: [0, 2], request: 'Checking account ending 4421 — a clear copy of the June 2024 statement.' },
      { id: 'x9', kind: 'changed', hidden: true, title: '$200.00 balance difference, Dec 2024 to Jan 2025', detail: 'The December 2024 statement closes at $14,212.40. The January 2025 statement opens at $14,012.40.', why: 'A balance that doesn’t carry over can point to a missing statement or a bank adjustment.', ev: ['e8', 'e9'], acts: ['source', 'explain', 'request'], request: 'Checking account ending 4421 — any adjustment notice or statement covering December 31, 2024 to January 1, 2025.' }
    ],
    ops: [
      { id: 'o1', title: 'Document classification', method: 'Issuer, account and statement period read from each first page; page counts checked.', inputs: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'], output: '9 files identified: 8 bank statement files, 1 agency letter.', ev: ['e16', 'e15', 'e1'] },
      { id: 'o2', title: 'Duplicate detection', method: 'Page-by-page comparison of extracted text.', inputs: ['m4', 'm5'], output: 'chk_2025 (1).pdf matches chk_2025.pdf on all 24 pages. Set aside; not deleted.', ev: ['e9'] },
      { id: 'o3', title: 'Date coverage check', method: 'Statement periods by account, compared with the months requested in the agency letter.', inputs: ['m1', 'm2', 'm3', 'm4', 'm6', 'm7', 'm8', 'm9'], output: '4 gaps: Checking Apr–Jun 2023, Checking Jul–Aug 2026, Savings Apr–Aug 2026, Savings 2022 unknown.', ev: ['e1', 'e10', 'e11', 'e13', 'e14'] },
      { id: 'o4', title: 'Transfer matching', method: 'Same amount, opposite direction, within 3 days, across the two accounts.', inputs: ['m2', 'm3', 'm7'], output: '1 matched pair, 1 proposed pair.', ev: ['e4', 'e5', 'e6', 'e7'] },
      { id: 'o5', title: 'Flagged transfer total', method: 'Deterministic sum. See calculation.', inputs: ['m4', 'm7'], output: 'See calculation.', calc: 'c1', ev: ['e2', 'e3'] },
      { id: 'o6', title: 'Transfer chronology', method: 'Transfers of $1,000.00 or more ordered by posting date.', inputs: ['m2', 'm3', 'm4', 'm7'], output: '4 transfers placed on the timeline.', ev: ['e4', 'e2', 'e6', 'e3'] },
      { id: 'o7', title: 'Balance continuity check', hidden: true, method: 'Closing balance compared with the next opening balance, per account.', inputs: ['m1', 'm2', 'm3', 'm4', 'm6', 'm7', 'm8'], output: '1 difference of $200.00 (Dec 31, 2024 → Jan 1, 2025).', ev: ['e8', 'e9'] }
    ],
    reportSections: [
      { title: 'Financial record inventory', src: 'inventory', intro: 'Every file you uploaded, what it is and the period it covers.' },
      { title: 'Statement coverage matrix', src: 'matrix', intro: 'Which months of each account are covered by a statement.' },
      { title: 'Account and transaction summary', src: 'static', intro: 'The accounts found and the statements available for each.', headers: ['Account', 'Covered', 'Statements'], rows: [
        { cells: ['Checking 4421', 'Jan 2022 – Jun 2026 (gap Apr–Jun 2023)', '51 monthly'], ev: ['e16', 'e13'] },
        { cells: ['Savings 3819', 'Jan 2023 – Mar 2026', '13 quarterly'], ev: ['e15', 'e14'] }
      ] },
      { title: 'Transfer exception log', src: 'compare', intro: 'Transfers of $1,000.00 or more and how each was resolved.' },
      { title: 'Flagged transfer calculation', src: 'calc', calc: 'c1', intro: 'How the flagged total was calculated.' },
      { title: 'Missing-document requests', src: 'requests', intro: 'Records that aren’t in this packet, and whether a request was drafted.' },
      { title: 'Review notes', src: 'notes', intro: 'Your explanations and decisions, in the order you made them.' },
      { title: 'Supporting-document index', src: 'evidence', intro: 'Every source page this packet cites.' }
    ]
  };

  S.iep = {
    id: 'iep', label: 'IEP meeting preparation',
    hiveTitle: "Maya's IEP meeting",
    purpose: 'Prepare for the annual IEP review on November 12',
    ask: "Help me prepare for my daughter's IEP meeting next month.",
    goal: 'Prepare for Maya’s annual IEP meeting on November 12, 2026.',
    deliverable: 'Meeting preparation brief with source-linked questions',
    likelyWork: 'Document inventory, a timeline of plans and evaluations, service and goal comparisons, missing-record checks and a question list.',
    lastActivity: 'Yesterday, 4:15 PM', studyRev: 2,
    studyRevs: [
      { rev: 1, date: 'Oct 23', note: 'First Study built from 6 files' },
      { rev: 2, date: 'Oct 26', note: 'Added draft IEP and meeting notice' }
    ],
    order: { understand: 2, plan: 3, compare: 1, exceptions: 1, timeline: 1, ops: 5 },
    docs: [
      { id: 'i1', file: 'IEP_2025-11.pdf', role: 'Prior IEP', type: 'IEP', period: 'Nov 14, 2025', pages: 14, cov: 100, org: 'Synthetic Unified School District', flags: [] },
      { id: 'i2', file: 'Draft_IEP_2026.pdf', role: 'Draft IEP', type: 'Draft IEP', period: 'Oct 20, 2026', pages: 15, cov: 100, org: 'Synthetic Unified School District', flags: [] },
      { id: 'i3', file: 'Psychoed_eval_2024.pdf', role: 'Evaluation 2024', type: 'Psychoeducational evaluation', period: 'Mar 6, 2024', pages: 18, cov: 100, org: 'Synthetic Unified School District', flags: [] },
      { id: 'i4', file: 'SLP_eval_2026.pdf', role: 'Speech evaluation', type: 'Speech-language evaluation', period: 'Sep 18, 2026', pages: 8, cov: 100, org: 'Synthetic Unified School District', flags: [] },
      { id: 'i5', file: 'progress_Jan2026.pdf', role: 'Progress report (original)', type: 'Progress report', period: 'Jan 2026', pages: 4, cov: 100, org: 'Synthetic Unified School District', flags: [{ k: 'changed', t: 'Superseded by corrected copy' }] },
      { id: 'i6', file: 'progress_Jan2026_corrected.pdf', role: 'Progress report (corrected)', type: 'Progress report · revision', period: 'Jan 2026', pages: 4, cov: 100, org: 'Synthetic Unified School District', flags: [{ k: 'changed', t: 'Revision of progress_Jan2026.pdf' }] },
      { id: 'i7', file: 'meeting_notice.pdf', role: 'Meeting notice', type: 'Notice', period: 'Oct 22, 2026', pages: 1, cov: 100, org: 'Synthetic Unified School District', flags: [] },
      { id: 'i8', file: 'report_card_2025-26.pdf', role: 'Report card 2025–26', type: 'Report card', period: '2025–26', pages: 2, cov: 100, org: 'Synthetic Elementary School', flags: [] }
    ],
    ev: {
      f1: { doc: 'i1', page: 6, quote: 'Speech-Language Therapy | 90 min/week | Therapy room', supports: 'Prior IEP: speech therapy 90 minutes a week', status: 'verified' },
      f2: { doc: 'i2', page: 7, quote: 'Speech-Language Therapy | 60 min/week | Therapy room', supports: 'Draft IEP: speech therapy 60 minutes a week', status: 'verified' },
      f3: { doc: 'i1', page: 6, quote: 'Specialized reading instruction | 45 min, 5x/week | Resource room', supports: 'Prior IEP: reading instruction', status: 'verified' },
      f4: { doc: 'i2', page: 7, quote: 'Specialized reading instruction | 45 min, 5x/week | Resource room', supports: 'Draft IEP: reading instruction', status: 'verified' },
      f5: { doc: 'i1', page: 8, quote: 'Progress toward goals will be reported three times per year.', supports: 'Progress reporting schedule', status: 'verified' },
      f6: { doc: 'i6', page: 1, quote: 'Progress Report — Reporting period 1 of 3 — January 2026', supports: 'Only progress report provided', status: 'verified' },
      f7: { doc: 'i4', page: 6, quote: 'Maya’s expressive language scores fall in the below-average range. Continued speech-language services are recommended.', supports: 'Speech evaluation finding and recommendation', status: 'verified' },
      f8: { doc: 'i2', page: 9, quote: 'Occupational therapy consult | 30 min/month | Classroom — see OT evaluation', supports: 'New OT consult; refers to an OT evaluation', status: 'verified' },
      f9: { doc: 'i3', page: 14, quote: 'Reading fluency: 38 words correct per minute (grade-level benchmark: 87).', supports: '2024 reading fluency', status: 'verified' },
      f10: { doc: 'i2', page: 4, quote: 'Annual goal 1: Maya will read grade-level text at 70 words correct per minute.', supports: 'Draft IEP reading goal', status: 'verified' },
      f11: { doc: 'i1', page: 4, quote: 'Annual goal 1: Maya will read grade-level text at 60 words correct per minute.', supports: 'Prior IEP reading goal', status: 'verified' },
      f12: { doc: 'i7', page: 1, quote: 'Annual IEP review meeting: November 12, 2026, 3:30 PM', supports: 'Meeting date', status: 'verified' },
      f13: { doc: 'i4', page: 1, quote: 'Speech-language evaluation · Evaluation date: September 18, 2026', supports: 'Speech evaluation date', status: 'verified' },
      f14: { doc: 'i5', page: 2, quote: 'Goal 1: 41 words correct per minute', supports: 'Original progress report figure', status: 'verified', unc: 'A corrected copy of this report shows a different figure.' },
      f15: { doc: 'i6', page: 2, quote: 'Goal 1: 47 words correct per minute (corrected)', supports: 'Corrected progress report figure', status: 'verified' },
      f16: { doc: 'i3', page: 1, quote: 'Psychoeducational evaluation · Evaluation date: March 6, 2024', supports: 'Evaluation date', status: 'verified' },
      f17: { doc: 'i2', page: 11, quote: 'Extended school year: To be determined', supports: 'Draft IEP extended school year', status: 'verified' },
      f19: { doc: 'i3', page: 16, quote: 'Recommendation: preferential seating near the point of instruction.', supports: '2024 evaluation recommendation', status: 'verified' },
      f20: { doc: 'i1', page: 6, quote: 'Math support (general education classroom) | 30 min, 3x/week', supports: 'Prior IEP math support', status: 'verified' },
      f21: { doc: 'i2', page: 7, quote: 'Math support (general education classroom) | 30 min, 3x/week', supports: 'Draft IEP math support', status: 'verified' },
      f22: { doc: 'i1', page: 9, quote: 'Extended time (1.5x) on classroom tests', supports: 'Prior IEP accommodation', status: 'verified' },
      f23: { doc: 'i2', page: 10, quote: 'Extended time (1.5x) on classroom tests', supports: 'Draft IEP accommodation', status: 'verified' },
      f24: { doc: 'i1', page: 11, quote: 'Extended school year: Not eligible', supports: 'Prior IEP extended school year', status: 'verified' },
      f25: { doc: 'i1', page: 1, quote: 'Student: Maya R. · Grade 3 · Meeting date: November 14, 2025', supports: 'Prior IEP date; Maya’s grade', status: 'verified' },
      f26: { doc: 'i2', page: 1, quote: 'DRAFT — prepared October 20, 2026 · Grade 4', supports: 'Draft IEP date', status: 'verified' },
      f27: { doc: 'i1', page: 5, quote: 'Annual goal 2: Maya will write a five-sentence paragraph with a topic sentence.', supports: 'Prior IEP writing goal', status: 'verified' },
      f28: { doc: 'i2', page: 5, quote: 'Annual goal 2: Maya will write a five-sentence paragraph with a topic sentence.', supports: 'Draft IEP writing goal', status: 'verified' },
      f29: { doc: 'i8', page: 1, quote: 'Reading: Approaching grade level', supports: '2025–26 report card, reading', status: 'verified' }
    },
    matrix: {
      title: 'Records by school year', sub: 'What the uploaded records cover', rowHead: 'Record',
      cols: ['2023–24', '2024–25', '2025–26', '2026–27'],
      rows: [
        { label: 'Evaluations', cells: [
          { s: 'complete', note: 'Psychoeducational evaluation, March 6, 2024.', docs: ['i3'], ev: ['f16'] },
          { s: 'unknown', note: 'No evaluation uploaded for this year. One may not have been required.', docs: [], ev: [] },
          { s: 'unknown', note: 'No evaluation uploaded for this year.', docs: [], ev: [] },
          { s: 'partial', note: 'Speech-language evaluation, September 18, 2026. The draft IEP refers to an OT evaluation that isn’t included.', docs: ['i4'], ev: ['f13', 'f8'], x: 'y5' }
        ] },
        { label: 'IEPs', cells: [
          { s: 'unknown', note: 'These records don’t include IEPs before November 2025.', docs: [], ev: [] },
          { s: 'unknown', note: 'These records don’t include IEPs before November 2025.', docs: [], ev: [] },
          { s: 'complete', note: 'IEP dated November 14, 2025.', docs: ['i1'], ev: ['f25'] },
          { s: 'partial', note: 'Draft only, prepared October 20, 2026.', docs: ['i2'], ev: ['f26'] }
        ] },
        { label: 'Progress reports', cells: [
          { s: 'unknown', note: 'None uploaded.', docs: [], ev: [] },
          { s: 'unknown', note: 'None uploaded.', docs: [], ev: [] },
          { s: 'gap', note: '1 of 3 reports. The prior IEP says progress is reported three times per year.', docs: ['i5', 'i6'], ev: ['f5', 'f6'], x: 'y2' },
          { s: 'unknown', note: 'None due yet in these records.', docs: [], ev: [] }
        ] },
        { label: 'Report cards', cells: [
          { s: 'unknown', note: 'None uploaded.', docs: [], ev: [] },
          { s: 'unknown', note: 'None uploaded.', docs: [], ev: [] },
          { s: 'complete', note: 'Full-year report card.', docs: ['i8'], ev: ['f29'] },
          { s: 'unknown', note: 'None yet.', docs: [], ev: [] }
        ] }
      ]
    },
    understand: {
      metrics: [
        { label: 'Meeting', value: 'Nov 12, 2026', sub: '3:30 PM, per the meeting notice', ev: ['f12'] },
        { label: 'Services compared', value: '6', sub: '3 same · 1 reduced · 1 new · 1 changed' },
        { label: 'Speech therapy change', calc: 'c1', sub: 'Prior IEP compared with the draft' }
      ],
      groups: [
        { title: 'Maya', items: [
          { text: 'Maya was in grade 3 at the November 2025 IEP and is in grade 4 in the draft.', ev: ['f25', 'f26'] },
          { text: 'The 2024 evaluation measured reading fluency at 38 words correct per minute; the benchmark listed was 87.', ev: ['f9'] },
          { text: 'The September 2026 speech evaluation places expressive language in the below-average range.', ev: ['f7'] }
        ] },
        { title: 'Plans and dates', items: [
          { text: 'The draft IEP was prepared October 20, 2026, ahead of the November 12 meeting.', ev: ['f26', 'f12'] },
          { text: 'The reading goal target rises from 60 to 70 words correct per minute.', ev: ['f11', 'f10'] }
        ] },
        { title: 'What stays the same', items: [
          { text: 'Reading instruction stays at 45 minutes, five times a week, in the resource room.', ev: ['f3', 'f4'] },
          { text: 'Extended time (1.5x) on classroom tests appears in both plans.', ev: ['f22', 'f23'] }
        ] },
        { title: 'Uncertain', unc: true, items: [
          { text: 'Two versions of the January progress report give different figures for goal 1.', ev: ['f14', 'f15'] },
          { text: 'The draft IEP refers to an OT evaluation. These records don’t include one.', ev: ['f8'] }
        ] }
      ]
    },
    compare: {
      title: 'Services: prior IEP and draft IEP', sub: 'November 2025 plan compared with the October 2026 draft',
      cols: ['Service', 'Prior IEP (Nov 2025)', 'Draft IEP (Oct 2026)'],
      rows: [
        { cells: ['Specialized reading instruction', '45 min, 5x/week', '45 min, 5x/week'], ev: ['f3', 'f4'], result: 'Same', rs: 'same' },
        { cells: ['Speech-language therapy', '90 min/week', '60 min/week'], ev: ['f1', 'f2'], result: 'Reduced by 30 minutes a week', rs: 'changed', x: 'y1' },
        { cells: ['Occupational therapy consult', 'Not listed', '30 min/month'], ev: ['f1', 'f8'], result: 'New', rs: 'changed', x: 'y5' },
        { cells: ['Math support in class', '30 min, 3x/week', '30 min, 3x/week'], ev: ['f20', 'f21'], result: 'Same', rs: 'same' },
        { cells: ['Extended time on tests', '1.5x', '1.5x'], ev: ['f22', 'f23'], result: 'Same', rs: 'same' },
        { cells: ['Extended school year', 'Not eligible', 'To be determined'], ev: ['f24', 'f17'], result: 'Changed', rs: 'changed', x: 'y4' }
      ]
    },
    timeline: [
      { date: 'Mar 6, 2024', text: 'Psychoeducational evaluation', ev: ['f16'] },
      { date: 'Nov 14, 2025', text: 'IEP meeting (prior IEP)', ev: ['f25'] },
      { date: 'Jan 2026', text: 'Progress report 1 of 3 (corrected copy issued)', ev: ['f6'] },
      { date: 'Sep 18, 2026', text: 'Speech-language evaluation', ev: ['f13'] },
      { date: 'Oct 20, 2026', text: 'Draft IEP prepared', ev: ['f26'] },
      { date: 'Nov 12, 2026', text: 'Annual IEP review meeting', ev: ['f12'] }
    ],
    calcs: {
      c1: { title: 'Speech therapy change', unit: 'min', method: 'Draft IEP weekly minutes minus prior IEP weekly minutes.',
        inputs: [
          { label: 'Draft IEP · speech-language therapy', value: 60, sign: 1, ev: 'f2' },
          { label: 'Prior IEP · speech-language therapy', value: 90, sign: -1, ev: 'f1' }
        ], excluded: [] }
    },
    tasks: [
      { id: 'a1', title: 'Sort and identify every document', does: 'Know what each file is and when it was written.', by: 'hive', state: 'COMPLETED', inputs: ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8'], method: 'Read the first pages for document type, date and author.', result: '8 files: 7 unique documents and 1 corrected revision.', op: 'o1', why: 'Every review starts from a reliable inventory.' },
      { id: 'a2', title: 'Build a timeline of plans, evaluations and reports', does: 'Put every dated record in order.', by: 'hive', state: 'COMPLETED', deps: ['a1'], inputs: ['f16', 'f25', 'f6', 'f13', 'f26', 'f12'], method: 'Order records by the date written on each document.', result: '6 dated events from March 2024 to November 2026.', op: 'o2', why: 'Meetings go better when the sequence is clear.' },
      { id: 'a3', title: 'Compare services: prior IEP and draft', does: 'Show what changes in the services Maya receives.', by: 'hive', state: 'COMPLETED', deps: ['a1'], inputs: ['f1', 'f2', 'f3', 'f4', 'f8', 'f17'], method: 'Line up each service by name and compare minutes, frequency and setting.', result: '6 services compared: 3 same, 1 reduced, 1 new, 1 changed.', op: 'o3', why: 'Service changes are usually the main topic of an annual review.' },
      { id: 'a4', title: 'Compare annual goals', does: 'Show which goals carry over and which change.', by: 'hive', state: 'COMPLETED', deps: ['a1'], inputs: ['f10', 'f11', 'f27', 'f28'], method: 'Match goals by area and compare the target wording.', result: '2 goals compared: 1 target changed, 1 carried over.', op: 'o4', why: 'Goal targets shape what progress is measured.' },
      { id: 'a5', title: 'Choose which progress report to use', does: 'Two versions of the January report disagree.', by: 'you', state: 'NEEDS_REVIEW', deps: ['a1'], derive: ['y3'], why: 'The brief should cite one figure, and note the other.' },
      { id: 'a6', title: 'Write the questions to bring', does: 'Turn each change or open item into a question you can ask.', by: 'you', state: 'READY', deps: ['a3', 'a4'], derive: ['y1', 'y4', 'y6', 'y7'], why: 'Questions keep the meeting focused on what the records show.' },
      { id: 'a7', title: 'Check accommodations against the 2024 evaluation', does: 'See whether each recommendation appears in the draft IEP.', by: 'hive', state: 'PROPOSED', deps: ['a1'], inputs: ['f19', 'f22', 'f23'], method: 'Match each recommendation in the evaluation to accommodations listed in the draft IEP.', runResult: '5 recommendations checked. 4 appear in the draft IEP; 1 doesn’t (preferential seating).', reveals: ['y7'], revealsOp: 'o7', why: 'Evaluations often recommend supports that are worth confirming.' },
      { id: 'a8', title: 'Request the missing records', does: 'Draft a request for each record the documents refer to but don’t include.', by: 'you', state: 'READY', deps: ['a2'], derive: ['y2', 'y5'], why: 'Missing reports leave gaps in the picture of Maya’s progress.' },
      { id: 'a9', title: 'Assemble the meeting brief', does: 'One brief with the timeline, changes, questions and sources.', by: 'hive', state: 'BLOCKED', deps: ['a5', 'a6', 'a8'], method: 'Build each section from the accepted Study and link every row to its source page.', runResult: 'Brief prepared in Reports.', makesReport: true, why: 'This is the deliverable.' }
    ],
    exceptions: [
      { id: 'y1', kind: 'changed', title: 'Speech therapy goes from 90 to 60 minutes a week', detail: 'The prior IEP lists 90 minutes a week of speech-language therapy; the draft lists 60. The September 2026 evaluation recommends continued services.', why: 'Service changes are a central topic for the meeting.', ev: ['f1', 'f2', 'f7'], acts: ['source', 'question'], question: 'The new IEP lists 60 minutes of speech therapy a week; the last one listed 90. What led to the change?' },
      { id: 'y2', kind: 'missing', title: 'No progress report after January 2026', detail: 'The prior IEP says progress is reported three times per year. These records include one report, from January 2026.', why: 'Without later reports, the brief can’t show progress through the year.', ev: ['f5', 'f6'], acts: ['coverage', 'source', 'request', 'na'], cell: [2, 2], request: 'Progress reports for reporting periods 2 and 3 of the 2025–26 school year.' },
      { id: 'y3', kind: 'changed', title: 'Two versions of the January progress report disagree', detail: 'The original shows 41 words correct per minute for goal 1. The corrected copy shows 47.', why: 'The brief should cite one figure and note the other.', ev: ['f14', 'f15'], acts: ['source', 'accept', 'reject'], acceptLabel: 'Use corrected copy', rejectLabel: 'Use original' },
      { id: 'y4', kind: 'needs', title: 'Extended school year is “To be determined”', detail: 'The prior IEP says Maya was not eligible. The draft says “To be determined”.', why: 'The meeting may be the place this gets decided.', ev: ['f24', 'f17'], acts: ['source', 'question'], question: 'The draft lists extended school year as “To be determined”. How and when will that be decided?' },
      { id: 'y5', kind: 'missing', title: 'The draft refers to an OT evaluation that isn’t included', detail: 'The new occupational therapy consult says “see OT evaluation”. These records don’t include one.', why: 'The new service is based on a document you haven’t seen.', ev: ['f8'], acts: ['coverage', 'source', 'request', 'na'], cell: [0, 3], request: 'The occupational therapy evaluation referred to on page 9 of the draft IEP.' },
      { id: 'y6', kind: 'changed', title: 'Reading goal target rises from 60 to 70 words correct per minute', detail: 'The January progress report shows 47 (corrected) or 41 (original).', why: 'Worth understanding how the new target was set.', ev: ['f11', 'f10', 'f15'], acts: ['source', 'question'], question: 'The reading goal moves from 60 to 70 words correct per minute. What progress data was this based on?' },
      { id: 'y7', kind: 'needs', hidden: true, title: 'Preferential seating is recommended but not in the draft', detail: 'The 2024 evaluation recommends preferential seating near the point of instruction. The draft IEP accommodations don’t list it.', why: 'Worth confirming whether it was considered.', ev: ['f19', 'f23'], acts: ['source', 'question'], question: 'The 2024 evaluation recommends preferential seating. Was it considered for the new IEP?' }
    ],
    ops: [
      { id: 'o1', title: 'Document classification', method: 'Type, author and date read from the first pages.', inputs: ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8'], output: '8 files identified; 1 is a corrected revision of another.', ev: ['f25', 'f26', 'f16', 'f13'] },
      { id: 'o2', title: 'Chronology', method: 'Records ordered by the date printed on each.', inputs: ['i1', 'i2', 'i3', 'i4', 'i6', 'i7'], output: '6 dated events.', ev: ['f16', 'f25', 'f6', 'f13', 'f26', 'f12'] },
      { id: 'o3', title: 'Service comparison', method: 'Services matched by name; minutes, frequency and setting compared.', inputs: ['i1', 'i2'], output: '3 same, 1 reduced, 1 new, 1 changed.', ev: ['f1', 'f2', 'f3', 'f4', 'f8'] },
      { id: 'o4', title: 'Goal comparison', method: 'Goals matched by area; target wording compared.', inputs: ['i1', 'i2'], output: '1 target changed, 1 carried over.', ev: ['f10', 'f11', 'f27', 'f28'] },
      { id: 'o5', title: 'Revision detection', method: 'Page-by-page text comparison of the two January reports.', inputs: ['i5', 'i6'], output: '1 difference, page 2: goal 1 figure.', ev: ['f14', 'f15'] },
      { id: 'o6', title: 'Speech minutes calculation', method: 'Deterministic difference. See calculation.', inputs: ['i1', 'i2'], output: 'See calculation.', calc: 'c1', ev: ['f1', 'f2'] },
      { id: 'o7', title: 'Accommodation check', hidden: true, method: 'Evaluation recommendations matched to draft accommodations.', inputs: ['i3', 'i2'], output: '4 of 5 recommendations appear in the draft.', ev: ['f19'] }
    ],
    reportSections: [
      { title: 'Meeting preparation brief', src: 'summary', intro: 'What this brief covers and what is still open.' },
      { title: 'Key timeline', src: 'timeline', intro: 'Plans, evaluations and reports in order.' },
      { title: 'Evaluations and identified needs', src: 'static', intro: 'What each evaluation found.', headers: ['Evaluation', 'Date', 'What it found'], rows: [
        { cells: ['Psychoeducational', 'Mar 6, 2024', 'Reading fluency 38 words correct per minute; benchmark listed as 87'], ev: ['f16', 'f9'] },
        { cells: ['Psychoeducational', 'Mar 6, 2024', 'Recommends preferential seating near the point of instruction'], ev: ['f19'] },
        { cells: ['Speech-language', 'Sep 18, 2026', 'Expressive language in the below-average range; continued services recommended'], ev: ['f13', 'f7'] }
      ] },
      { title: 'Goals and service comparisons', src: 'compare', intro: 'Each service in the prior IEP and the draft.' },
      { title: 'Goal targets', src: 'static', intro: 'Annual goals in the prior IEP and the draft.', headers: ['Goal', 'Prior IEP', 'Draft IEP'], rows: [
        { cells: ['Reading fluency', '60 words correct per minute', '70 words correct per minute'], ev: ['f11', 'f10'] },
        { cells: ['Writing', 'Five-sentence paragraph', 'Five-sentence paragraph'], ev: ['f27', 'f28'] }
      ] },
      { title: 'Missing or referenced records', src: 'requests', intro: 'Records the documents refer to but don’t include.' },
      { title: 'Questions to bring', src: 'questions', intro: 'Each question points to the page it comes from.' },
      { title: 'Source-linked supporting evidence', src: 'evidence', intro: 'Every source page this brief cites.' }
    ]
  };

  S.insurance = {
    id: 'insurance', label: 'Insurance claim comparison',
    hiveTitle: 'Kitchen water damage claim',
    purpose: 'Compare the adjuster’s and contractor’s estimates',
    ask: 'Compare the adjuster’s estimate with my contractor’s estimate for the kitchen leak.',
    goal: 'Compare both estimates and list every unresolved issue for the adjuster.',
    deliverable: 'Unresolved-issues packet',
    likelyWork: 'Document inventory, line-item matching, difference calculations, policy checks and a question list.',
    lastActivity: 'Oct 27, 11:08 AM', studyRev: 1,
    studyRevs: [{ rev: 1, date: 'Oct 25', note: 'First Study built from 8 files' }],
    order: { understand: 3, plan: 2, compare: 1, exceptions: 1, timeline: 4, ops: 5 },
    docs: [
      { id: 'n1', file: 'policy_declarations.pdf', role: 'Policy declarations', type: 'Declarations page', period: 'Mar 2026 – Mar 2027', pages: 4, cov: 100, org: 'Synthetic Mutual Insurance', flags: [] },
      { id: 'n2', file: 'policy_full.pdf', role: 'Policy', type: 'Homeowners policy', period: 'Mar 2026 – Mar 2027', pages: 38, cov: 100, org: 'Synthetic Mutual Insurance', flags: [] },
      { id: 'n3', file: 'adjuster_estimate_v2.pdf', role: 'Adjuster estimate, Sep 30', type: 'Estimate', period: 'Sep 30, 2026', pages: 9, cov: 100, org: 'Synthetic Mutual Insurance', flags: [{ k: 'changed', t: 'Revision of adjuster_estimate_v1.pdf' }] },
      { id: 'n4', file: 'adjuster_estimate_v1.pdf', role: 'Adjuster estimate, Sep 12', type: 'Estimate · superseded', period: 'Sep 12, 2026', pages: 8, cov: 100, org: 'Synthetic Mutual Insurance', flags: [{ k: 'changed', t: 'Superseded' }] },
      { id: 'n5', file: 'contractor_estimate.pdf', role: 'Contractor estimate', type: 'Estimate', period: 'Sep 22, 2026', pages: 6, cov: 100, org: 'Synthetic Builders LLC', flags: [] },
      { id: 'n6', file: 'photos_kitchen.pdf', role: 'Damage photos', type: 'Photos with captions', period: 'Aug 30, 2026', pages: 12, cov: 50, org: 'Uploaded by you', flags: [{ k: 'missing', t: 'Captions only; images not interpreted' }] },
      { id: 'n7', file: 'claim_letter_oct.pdf', role: 'Claim letter, Oct 8', type: 'Letter', period: 'Oct 8, 2026', pages: 2, cov: 100, org: 'Synthetic Mutual Insurance', flags: [] },
      { id: 'n8', file: 'plumber_invoice.pdf', role: 'Plumber invoice', type: 'Invoice', period: 'Aug 29, 2026', pages: 1, cov: 100, org: 'Synthetic Plumbing Co.', flags: [] }
    ],
    ev: {
      g1: { doc: 'n1', page: 2, quote: 'Deductible: $1,000', supports: 'Deductible amount', status: 'verified' },
      g2: { doc: 'n3', page: 9, quote: 'Total replacement cost value: $7,300.00', supports: 'Adjuster total (Sep 30)', status: 'verified' },
      g3: { doc: 'n5', page: 6, quote: 'Total: $14,100.00', supports: 'Contractor total', status: 'verified' },
      g4: { doc: 'n3', page: 4, quote: 'Floor — luxury vinyl plank — 180.00 SF @ 12.50 = 2,250.00', supports: 'Adjuster flooring: 180 sq ft', status: 'verified' },
      g5: { doc: 'n5', page: 3, quote: 'LVP flooring, kitchen and hallway — 220 sq ft @ $16.00 — $3,520.00', supports: 'Contractor flooring: 220 sq ft', status: 'verified', unc: 'The contractor’s line includes the hallway; the adjuster’s doesn’t mention it.' },
      g6: { doc: 'n5', page: 4, quote: 'Remove and replace lower cabinets (water damaged) — $4,600.00', supports: 'Contractor cabinets line', status: 'verified' },
      g7: { doc: 'n3', page: 3, quote: 'Ceiling — drywall replacement — 1,240.00', supports: 'Adjuster ceiling', status: 'verified' },
      g8: { doc: 'n5', page: 2, quote: 'Kitchen ceiling drywall, tape, texture — $1,980.00', supports: 'Contractor ceiling', status: 'verified' },
      g9: { doc: 'n3', page: 5, quote: 'Paint — walls and ceiling — 960.00', supports: 'Adjuster painting', status: 'verified' },
      g10: { doc: 'n5', page: 5, quote: 'Painting, kitchen — $1,150.00', supports: 'Contractor painting', status: 'verified' },
      g11: { doc: 'n3', page: 2, quote: 'Water mitigation — 3 days drying — 2,850.00', supports: 'Adjuster mitigation', status: 'verified' },
      g12: { doc: 'n5', page: 1, quote: 'Water mitigation (completed by others) — $2,850.00', supports: 'Contractor mitigation', status: 'verified' },
      g13: { doc: 'n4', page: 8, quote: 'Total replacement cost value: $6,880.00', supports: 'Adjuster total (Sep 12, superseded)', status: 'verified' },
      g14: { doc: 'n7', page: 1, quote: 'We are issuing payment of $6,300.00 after your $1,000 deductible.', supports: 'Payment amount', status: 'verified' },
      g15: { doc: 'n1', page: 3, quote: 'Endorsement HO 04 90 — attached', supports: 'Referenced endorsement', status: 'verified', unc: 'No uploaded file contains this endorsement.' },
      g16: { doc: 'n2', page: 17, quote: 'We do not cover loss caused by continuous or repeated seepage or leakage of water over a period of 14 or more days.', supports: 'Seepage exclusion', status: 'verified' },
      g17: { doc: 'n8', page: 1, quote: 'Leak located at dishwasher supply line — found 08/29/2026', supports: 'Date the leak was found', status: 'verified', unc: 'These records don’t say when the leak started.' },
      g18: { doc: 'n6', page: 3, quote: 'Photo 5 — Kitchen ceiling, stain approx. 4 ft across', supports: 'Ceiling photo caption', status: 'verified' },
      g19: { doc: 'n6', page: 8, quote: 'Photo 11 — Kitchen floor, cupped planks near dishwasher', supports: 'Floor photo caption', status: 'verified' },
      g20: { doc: 'n1', page: 1, quote: 'Policy period 03/01/2026 – 03/01/2027', supports: 'Policy period', status: 'verified' }
    },
    matrix: {
      title: 'Evidence by damage area', sub: 'Which documents address each area', rowHead: 'Area',
      cols: ['Photos', 'Adjuster', 'Contractor', 'Policy'],
      rows: [
        { label: 'Kitchen ceiling', cells: [
          { s: 'complete', note: 'Photo 5 caption.', docs: ['n6'], ev: ['g18'] },
          { s: 'complete', note: 'Ceiling drywall line.', docs: ['n3'], ev: ['g7'] },
          { s: 'complete', note: 'Ceiling drywall line.', docs: ['n5'], ev: ['g8'] },
          { s: 'complete', note: 'Dwelling coverage applies.', docs: ['n1'], ev: ['g20'] }
        ] },
        { label: 'Flooring', cells: [
          { s: 'complete', note: 'Photo 11 caption.', docs: ['n6'], ev: ['g19'] },
          { s: 'complete', note: '180 sq ft.', docs: ['n3'], ev: ['g4'] },
          { s: 'complete', note: '220 sq ft, includes hallway.', docs: ['n5'], ev: ['g5'] },
          { s: 'complete', note: 'Dwelling coverage applies.', docs: ['n1'], ev: ['g20'] }
        ] },
        { label: 'Lower cabinets', cells: [
          { s: 'missing', note: 'No photo caption mentions the cabinets.', docs: ['n6'], ev: [], x: 'z3' },
          { s: 'missing', note: 'Not listed in either adjuster estimate.', docs: ['n3', 'n4'], ev: [], x: 'z2' },
          { s: 'complete', note: '$4,600.00 to remove and replace.', docs: ['n5'], ev: ['g6'] },
          { s: 'complete', note: 'Dwelling coverage applies.', docs: ['n1'], ev: ['g20'] }
        ] },
        { label: 'Policy endorsements', cells: [
          { s: 'unknown', note: 'Not applicable.', docs: [], ev: [] },
          { s: 'unknown', note: 'Not mentioned.', docs: [], ev: [] },
          { s: 'unknown', note: 'Not mentioned.', docs: [], ev: [] },
          { s: 'gap', note: 'Endorsement HO 04 90 is referenced but not included.', docs: ['n1'], ev: ['g15'], x: 'z5' }
        ] }
      ]
    },
    understand: {
      metrics: [
        { label: 'Difference between estimates', calc: 'c1', sub: 'Contractor total minus adjuster total' },
        { label: 'Payment check', calc: 'c2', sub: 'Matches the Oct 8 claim letter', ev: ['g14'] },
        { label: 'Line items compared', value: '5', sub: '1 same · 4 differ' }
      ],
      groups: [
        { title: 'Claim', items: [
          { text: 'The plumber found the leak at the dishwasher supply line on August 29, 2026.', ev: ['g17'] },
          { text: 'The policy period runs March 1, 2026 to March 1, 2027, with a $1,000 deductible.', ev: ['g20', 'g1'] }
        ] },
        { title: 'Estimates', items: [
          { text: 'The Sep 30 adjuster estimate totals $7,300.00. The contractor estimate totals $14,100.00.', ev: ['g2', 'g3'] },
          { text: 'The Sep 30 adjuster estimate replaces a Sep 12 version that totaled $6,880.00.', ev: ['g13', 'g2'] },
          { text: 'Water mitigation is $2,850.00 in both estimates.', ev: ['g11', 'g12'] }
        ] },
        { title: 'Payment', items: [
          { text: 'The claim letter’s $6,300.00 payment equals the Sep 30 estimate minus the $1,000 deductible.', ev: ['g14', 'g2', 'g1'] }
        ] },
        { title: 'Uncertain', unc: true, items: [
          { text: 'The contractor’s flooring line includes the hallway; the adjuster’s doesn’t mention it.', ev: ['g5', 'g4'] },
          { text: 'Endorsement HO 04 90 is referenced on the declarations page. No uploaded file contains it.', ev: ['g15'] }
        ] }
      ]
    },
    compare: {
      title: 'Estimate comparison', sub: 'Adjuster (Sep 30) and contractor (Sep 22), before deductible',
      cols: ['Line item', 'Adjuster', 'Contractor'],
      rows: [
        { cells: ['Water mitigation', '$2,850.00', '$2,850.00'], ev: ['g11', 'g12'], result: 'Same', rs: 'same' },
        { cells: ['Kitchen ceiling drywall', '$1,240.00', '$1,980.00'], ev: ['g7', 'g8'], result: '$740.00 more', rs: 'changed' },
        { cells: ['Flooring', '$2,250.00 (180 sq ft)', '$3,520.00 (220 sq ft)'], ev: ['g4', 'g5'], result: '$1,270.00 more', rs: 'changed', x: 'z1' },
        { cells: ['Lower cabinets', 'Not listed', '$4,600.00'], ev: ['g6'], result: '$4,600.00 more', rs: 'needs', x: 'z2' },
        { cells: ['Painting', '$960.00', '$1,150.00'], ev: ['g9', 'g10'], result: '$190.00 more', rs: 'changed' },
        { cells: ['Total', '$7,300.00', '$14,100.00'], ev: ['g2', 'g3'], result: '$6,800.00 more', rs: 'total' }
      ]
    },
    timeline: [
      { date: 'Mar 1, 2026', text: 'Policy period begins', ev: ['g20'] },
      { date: 'Aug 29, 2026', text: 'Plumber finds leak at dishwasher line', ev: ['g17'] },
      { date: 'Sep 12, 2026', text: 'Adjuster estimate, $6,880.00', ev: ['g13'] },
      { date: 'Sep 22, 2026', text: 'Contractor estimate, $14,100.00', ev: ['g3'] },
      { date: 'Sep 30, 2026', text: 'Revised adjuster estimate, $7,300.00', ev: ['g2'] },
      { date: 'Oct 8, 2026', text: 'Claim letter: payment of $6,300.00', ev: ['g14'] }
    ],
    calcs: {
      c1: { title: 'Difference between estimates', unit: 'usd', method: 'Contractor total minus adjuster total, both before the deductible.',
        inputs: [
          { label: 'Contractor estimate total', value: 14100, sign: 1, ev: 'g3' },
          { label: 'Adjuster estimate total (Sep 30)', value: 7300, sign: -1, ev: 'g2' }
        ], excluded: [{ label: 'Sep 12 adjuster estimate ($6,880.00), superseded', ev: 'g13' }] },
      c2: { title: 'Payment check', unit: 'usd', method: 'Adjuster total minus deductible, compared with the payment in the claim letter ($6,300.00).',
        inputs: [
          { label: 'Adjuster estimate total (Sep 30)', value: 7300, sign: 1, ev: 'g2' },
          { label: 'Deductible', value: 1000, sign: -1, ev: 'g1' }
        ], excluded: [] }
    },
    tasks: [
      { id: 'b1', title: 'Sort and identify every document', does: 'Know what each file is and which version is current.', by: 'hive', state: 'COMPLETED', inputs: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'], method: 'Read the first pages for author, date and document type; compare versions.', result: '8 files: 7 current documents, 1 superseded estimate.', op: 'o1', why: 'Every review starts from a reliable inventory.' },
      { id: 'b2', title: 'Match line items across the two estimates', does: 'Line up the same work in both estimates.', by: 'hive', state: 'COMPLETED', deps: ['b1'], inputs: ['g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10', 'g11', 'g12'], method: 'Match items by area and type of work.', result: '5 line items: 1 same, 3 priced differently, 1 in the contractor estimate only.', op: 'o2', why: 'Differences only make sense item by item.' },
      { id: 'b3', title: 'Calculate the differences', does: 'Show how far apart the estimates are, and where.', by: 'hive', state: 'COMPLETED', deps: ['b2'], inputs: ['g2', 'g3'], method: 'Deterministic subtraction for each line and the totals.', result: 'The contractor total is $6,800.00 more than the adjuster’s.', op: 'o3', why: 'The size of each gap shows what to ask about first.' },
      { id: 'b4', title: 'Check the payment against the estimate', does: 'Confirm how the payment amount was reached.', by: 'hive', state: 'COMPLETED', deps: ['b1'], inputs: ['g2', 'g1', 'g14'], method: 'Adjuster total minus deductible, compared with the claim letter.', result: '$7,300.00 − $1,000.00 = $6,300.00, the amount in the claim letter.', op: 'o4', why: 'A payment that doesn’t follow from the estimate would be the first question.' },
      { id: 'b5', title: 'Choose which adjuster estimate to use', does: 'There are two versions.', by: 'you', state: 'NEEDS_REVIEW', deps: ['b1'], derive: ['z4'], why: 'The comparison should use one version and note the other.' },
      { id: 'b6', title: 'Check each item against the policy terms', does: 'Find the policy sections that apply to each damage area.', by: 'hive', state: 'PROPOSED', deps: ['b1'], inputs: ['g16', 'g17'], method: 'Search the policy for coverage and exclusion language relevant to water damage and each line item.', runResult: 'Policy sections located for all 3 damage areas. 1 exclusion may be relevant; worth asking.', reveals: ['z6'], revealsOp: 'o6', why: 'Knowing the relevant policy language helps you ask clear questions.' },
      { id: 'b7', title: 'Write the questions for the adjuster', does: 'Turn each difference into a question.', by: 'you', state: 'READY', deps: ['b3'], derive: ['z1', 'z2', 'z6'], why: 'Clear questions get clear answers.' },
      { id: 'b8', title: 'Request the missing items', does: 'Draft requests for records that are referenced but missing.', by: 'you', state: 'READY', deps: ['b1'], derive: ['z3', 'z5'], why: 'The packet should note what isn’t on file.' },
      { id: 'b9', title: 'Assemble the unresolved-issues packet', does: 'Comparison, questions, missing items and sources in one packet.', by: 'hive', state: 'BLOCKED', deps: ['b5', 'b7', 'b8'], method: 'Build each section from the accepted Study and link every row to its source page.', runResult: 'Packet prepared in Reports.', makesReport: true, why: 'This is the deliverable.' }
    ],
    exceptions: [
      { id: 'z1', kind: 'changed', title: 'Floor measured as 180 sq ft and 220 sq ft', detail: 'The adjuster lists 180 sq ft; the contractor lists 220 sq ft and includes the hallway.', why: 'Flooring is the second-largest difference, $1,270.00.', ev: ['g4', 'g5'], acts: ['source', 'question'], question: 'The estimates list 180 and 220 square feet of flooring. Does the adjuster’s measurement include the hallway?' },
      { id: 'z2', kind: 'needs', title: 'Lower cabinets appear only in the contractor’s estimate', detail: 'The contractor includes $4,600.00 to remove and replace the lower cabinets. Neither adjuster estimate lists them.', why: 'This is the largest single difference.', ev: ['g6', 'g2'], acts: ['source', 'question'], question: 'The contractor’s estimate includes $4,600.00 for lower cabinets. Were the cabinets inspected?' },
      { id: 'z3', kind: 'missing', title: 'No photos of the lower cabinets', detail: 'None of the photo captions mention the cabinets.', why: 'Photos would help show the damage the contractor describes.', ev: ['g18', 'g19'], acts: ['coverage', 'source', 'request', 'na'], cell: [2, 0], request: 'Photos of the lower kitchen cabinets showing water damage.' },
      { id: 'z4', kind: 'changed', title: 'Two adjuster estimates: $6,880.00 and $7,300.00', detail: 'The Sep 12 estimate totals $6,880.00. The Sep 30 estimate totals $7,300.00 and appears to replace it.', why: 'The comparison should use one version.', ev: ['g13', 'g2'], acts: ['source', 'accept', 'reject'], acceptLabel: 'Use Sep 30 estimate', rejectLabel: 'Use Sep 12 estimate' },
      { id: 'z5', kind: 'missing', title: 'Endorsement HO 04 90 is referenced but not included', detail: 'The declarations page lists it as attached. No uploaded file contains it.', why: 'Endorsements can change what the policy covers.', ev: ['g15'], acts: ['coverage', 'source', 'request', 'na'], cell: [3, 3], request: 'A copy of Endorsement HO 04 90, listed on page 3 of the declarations.' },
      { id: 'z6', kind: 'needs', hidden: true, title: 'A policy exclusion mentions leaks lasting 14 days or more', detail: 'The plumber invoice says the leak was found on August 29, 2026. These records don’t say when it started.', why: 'Worth understanding whether this exclusion was considered.', ev: ['g16', 'g17'], acts: ['source', 'question'], question: 'The policy excludes leaks lasting 14 days or more. Was this considered for this claim, and on what information?' }
    ],
    ops: [
      { id: 'o1', title: 'Document classification', method: 'Author, date and type read from first pages; versions compared.', inputs: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'], output: '8 files identified; 1 superseded estimate.', ev: ['g20', 'g2', 'g13', 'g3'] },
      { id: 'o2', title: 'Line-item matching', method: 'Items matched by area and type of work.', inputs: ['n3', 'n5'], output: '5 matched lines.', ev: ['g4', 'g5', 'g7', 'g8', 'g9', 'g10', 'g11', 'g12'] },
      { id: 'o3', title: 'Estimate difference', method: 'Deterministic subtraction. See calculation.', inputs: ['n3', 'n5'], output: 'See calculation.', calc: 'c1', ev: ['g2', 'g3'] },
      { id: 'o4', title: 'Payment check', method: 'Deterministic subtraction. See calculation.', inputs: ['n1', 'n3', 'n7'], output: 'See calculation.', calc: 'c2', ev: ['g14'] },
      { id: 'o5', title: 'Revision detection', method: 'Adjuster estimates compared page by page.', inputs: ['n3', 'n4'], output: 'Sep 30 version adds $420.00 and replaces Sep 12.', ev: ['g13', 'g2'] },
      { id: 'o6', title: 'Policy terms check', hidden: true, method: 'Coverage and exclusion language located for each damage area.', inputs: ['n2'], output: '1 potentially relevant exclusion.', ev: ['g16'] }
    ],
    reportSections: [
      { title: 'Claim summary', src: 'summary', intro: 'What this packet covers and what is still open.' },
      { title: 'Document inventory', src: 'inventory', intro: 'Every file, what it is and which version is current.' },
      { title: 'Estimate comparison', src: 'compare', intro: 'Each line item in both estimates.' },
      { title: 'Payment check', src: 'calc', calc: 'c2', intro: 'How the payment amount follows from the estimate.' },
      { title: 'Questions for the adjuster', src: 'questions', intro: 'Each question points to the page it comes from.' },
      { title: 'Missing items', src: 'requests', intro: 'Records referenced but not on file.' },
      { title: 'Timeline', src: 'timeline', intro: 'Claim events in order.' },
      { title: 'Supporting evidence', src: 'evidence', intro: 'Every source page this packet cites.' }
    ]
  };

  const intents = [
    { id: 'iep', label: 'Prepare for an IEP meeting', scen: 'iep',
      accepts: ['Current and prior IEPs', 'Evaluations', 'Progress reports', 'Report cards', 'Meeting notices', 'Emails from school'],
      work: ['Puts every plan, evaluation and report in order', 'Compares services and goals line by line', 'Finds records the documents refer to but don’t include', 'Turns each change into a question you can ask'],
      gets: 'A meeting brief with a timeline, the changes between plans, and questions to bring, each linked to its page.',
      finding: { text: 'The new IEP lists 60 minutes of speech therapy a week; the last one listed 90. Worth asking what changed.', ev: ['f1', 'f2'] } },
    { id: 'fin', label: 'Reconcile financial statements', scen: 'medicaid',
      accepts: ['Bank and savings statements', 'Scans and photos of statements', 'Agency checklists', 'Duplicates and partial years'],
      work: ['Checks which months of each account are covered', 'Matches transfers between accounts', 'Adds up large transfers out, step by step', 'Drafts requests for missing statements'],
      gets: 'A financial review packet: inventory, coverage matrix, transfer log, missing-document requests and a source index.',
      finding: { text: 'These records don’t include Checking 4421 statements for April, May or June 2023.', ev: ['e10', 'e11'] } },
    { id: 'ins', label: 'Review an insurance claim', scen: 'insurance',
      accepts: ['Policy and declarations', 'Adjuster estimates', 'Contractor estimates', 'Claim letters', 'Invoices and photo captions'],
      work: ['Matches line items across estimates', 'Calculates each difference', 'Checks the payment against the estimate and deductible', 'Locates the policy language that applies'],
      gets: 'An unresolved-issues packet with the comparison, conflicting figures and questions for the adjuster.',
      finding: { text: 'The adjuster lists 180 sq ft of flooring; the contractor lists 220 sq ft and includes the hallway.', ev: ['g4', 'g5'] } },
    { id: 'app', label: 'Organize an application package', scen: 'medicaid',
      accepts: ['Whatever the agency asked for', 'Statements, letters and notices', 'Old, partial or out-of-order files'],
      work: ['Reads the agency’s checklist', 'Checks each requested item against what you have', 'Names exactly what’s missing', 'Drafts the requests'],
      gets: 'A review-ready package with an inventory, a coverage check and a list of what’s still needed.',
      finding: { text: 'The agency letter asks for statements from January 2022 through August 2026.', ev: ['e1'] } }
  ];

  window.HIVE_DATA = { S, intents };
})();
