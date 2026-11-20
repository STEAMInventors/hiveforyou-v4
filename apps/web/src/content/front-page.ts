/**
 * Front page content (DESIGN.md §3 "Front page"). Marketing copy and the synthetic example hive
 * live here, not in components. This is the one file where the domain-word guard does not apply.
 */

export type FrontExampleDocument = {
  role: string;
  issuer: string;
  kind: string;
  pages: number;
  meta: readonly string[];
  lines: readonly (readonly [label: string, value: string])[];
  /** Index into `lines` of the cited line. */
  highlight: number;
};

export type FrontExampleStatement = {
  topic: string;
  text: string;
  /** Index into `documents`. */
  document: number;
  page: number;
};

export type FrontExampleContent = {
  client: string;
  purpose: string;
  badge: string;
  documentsIn: number;
  documentsAsked: number;
  statementsTitle: string;
  missingTitle: string;
  checkedLabel: string;
  documents: readonly FrontExampleDocument[];
  statements: readonly FrontExampleStatement[];
  missing: readonly string[];
};

export const FRONT_EXAMPLE: FrontExampleContent = {
  client: "Chris Morgan",
  purpose: "Chapter 7 intake",
  badge: "Example · synthetic documents",
  documentsIn: 11,
  documentsAsked: 14,
  statementsTitle: "What the documents show",
  missingTitle: "Still to come",
  checkedLabel: "Checked against the page",
  documents: [
    {
      role: "Pay stub",
      issuer: "Example Logistics Co.",
      kind: "Earnings statement",
      pages: 2,
      meta: ["Employee: Chris Morgan", "Pay period 10/01/2026 – 10/14/2026", "Pay date 10/17/2026"],
      lines: [
        ["Regular hours", "80.00"],
        ["Gross pay", "$2,140.00"],
        ["Federal income tax", "$187.22"],
        ["Social Security", "$132.68"],
        ["Medicare", "$31.03"],
        ["Net pay", "$1,789.07"],
      ],
      highlight: 1,
    },
    {
      role: "Bank statement",
      issuer: "Example Community Bank",
      kind: "Checking account statement",
      pages: 3,
      meta: ["Account holder: Chris Morgan", "Statement period 09/01/2026 – 09/30/2026", "Account ending 0000"],
      lines: [
        ["Beginning balance", "$1,036.54"],
        ["Deposits and credits", "$3,578.14"],
        ["Withdrawals and debits", "$4,202.50"],
        ["Ending balance", "$412.18"],
      ],
      highlight: 3,
    },
    {
      role: "Auto loan statement",
      issuer: "Example Auto Finance",
      kind: "Monthly loan statement",
      pages: 1,
      meta: ["Borrower: Chris Morgan", "Statement date 10/05/2026", "Vehicle: 2019 sedan"],
      lines: [
        ["Payment due", "$386.00"],
        ["Due date", "10/25/2026"],
        ["Interest rate", "7.9%"],
        ["Principal balance", "$9,860.40"],
      ],
      highlight: 3,
    },
  ],
  statements: [
    { topic: "Income", text: "Gross pay is $2,140.00 for each two-week pay period.", document: 0, page: 1 },
    { topic: "Accounts", text: "The checking account ended September with $412.18.", document: 1, page: 1 },
    { topic: "Debts", text: "$9,860.40 is still owed on the car loan.", document: 2, page: 1 },
  ],
  missing: ["October pay stubs", "2025 tax return", "Credit card statements"],
};

export const FRONT_PAGE_COPY = {
  heroTitle: "What are you working on?",
  heroLede:
    "Upload the paperwork. HiveForYou reads every page, shows what's missing, and links every point to the page it came from.",
  audienceLabel: "Who is this for",
  audienceClients: "For my clients",
  audienceSelf: "For myself",
  emailLabel: "Your work email",
  start: "Start",
  addDocuments: "Add documents",
  noteClients: "Set up your practice, then invite your first client. You sign in with a code sent to your email.",
  noteSelf: "You get your own hive. Old, partial or out of order is fine. You sign in with a code sent to your email.",
  noteInvited: "Invited by your lawyer or advocate? Open the link in your invitation email.",
  signIn: "Sign in",
  exampleTitle: "What you get back",
  exampleSub: "An example hive for a Chapter 7 intake. Click a statement to see the page it comes from.",
  howTitle: "How it works",
  how: [
    {
      title: "Ask for the documents",
      text: "Your client gets a list of what to send, on their phone. Old, partial or out of order is fine.",
    },
    {
      title: "HiveForYou reads every page",
      text: "It says what the documents show, what changed, and what is still missing.",
    },
    {
      title: "Review from the page",
      text: "Every point opens the page it came from, highlighted. Talk with your client in the same place.",
    },
  ],
  whoTitle: "Who sees what",
  who: [
    { label: "Your client", text: "Their own documents, their report and their messages with your team." },
    {
      label: "Your team",
      text: "Everything in the hive, including the questions your client asks the assistant. Team notes stay with your team.",
    },
    { label: "The assistant", text: "Answers only from the documents. It never decides anything about the case." },
    { label: "Anyone else", text: "Nothing. A hive is visible only to the people invited to it." },
  ],
  coversTitle: "What it covers",
  coversRulebook: "Each area has its own rulebook for what to ask for and what to check.",
  slogan: "The complicated, made simple.",
  startAHive: "Start a hive",
  disclaimer: "Not legal, financial or medical advice.",
} as const;

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** "What it covers" paragraph from the titles of the domain packs that exist. Null when there are none. */
export function coveredAreasParagraph(areaTitles: readonly string[]): string | null {
  const titles = areaTitles.map((title) => title.trim()).filter(Boolean);
  if (titles.length === 0) return null;
  return `Built for ${joinList(titles)}. ${FRONT_PAGE_COPY.coversRulebook}`;
}
