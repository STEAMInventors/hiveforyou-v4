import type { EditorialPlan } from "./editorial-plan-contracts";
import { EDITORIAL_PLAN_SCHEMA } from "./editorial-plan-contracts";

export function l001ProEditorialPlan(): EditorialPlan {
  return {
    schema: EDITORIAL_PLAN_SCHEMA,
    audience: "PRO",
    title: "Maya Carter Initial IEP Review",
    audienceObjective:
      "Review Maya Carter's Initial IEP eligibility, present levels, annual reading fluency goal, weekly service, accommodations, progress monitoring, team participation, and expired IEP period.",
    summaryDetailLevel: "COMPREHENSIVE",
    insights: [
      {
        id: "INS1",
        meaning:
          "GOAL_READING_FLUENCY targets a verified fluency and accuracy increase from the 2024-10-18 evaluation baseline across three consecutive probes by 2025-11-11.",
        claimIds: [
          "DF12",
          "DF13",
          "DF14",
          "DF15",
          "DF16",
          "DF17",
          "DF18",
          "DF19",
          "DF20",
          "DF21",
          "DF22",
          "DF23",
          "DF24",
          "DF25",
          "DF37",
          "P2.C0",
          "P2.C1",
          "P2.A0",
        ],
        questionIds: ["P1", "P2", "P3", "P4", "P6"],
        role: "CENTRAL",
        reuseReason: "Core quantitative synthesis across summary narrative, metric, comparison, table, timeline, and evidence panel.",
      },
      {
        id: "INS2",
        meaning:
          "The Initial IEP (2024-11-12 through 2025-11-11, SLD - Reading) establishes weekly specialized reading instruction, classroom accommodations, quarterly probe reporting, and four-role IEP team participation, with no post-2024-11-12 probe records in this corpus.",
        claimIds: [
          "DF1",
          "DF6",
          "DF7",
          "DF8",
          "DF9",
          "DF10",
          "DF11",
          "DF26",
          "DF27",
          "DF28",
          "DF29",
          "DF30",
          "DF31",
          "DF32",
          "DF33",
          "DF34",
          "DF35",
          "DF36",
          "P6",
          "P6.U0",
          "P6.L0",
          "P6.D0",
        ],
        questionIds: ["P1", "P2", "P3", "P4", "P5", "P6"],
        role: "CENTRAL",
        reuseReason: "Provisions, chronology, team roles, and post-period evidentiary gaps referenced across narrative and structured views.",
      },
    ],
    priorityFindings: [
      { claimId: "DF19", priority: "HIGH", insightId: "INS1" },
      { claimId: "DF20", priority: "HIGH", insightId: "INS1" },
      { claimId: "P2.C0", priority: "HIGH", insightId: "INS1" },
      { claimId: "DF27", priority: "HIGH", insightId: "INS2" },
      { claimId: "P6.U0", priority: "HIGH", insightId: "INS2" },
    ],
    summary: {
      documentedClaimIds: ["DF1", "DF2", "DF3", "DF6", "DF8", "DF9", "DF10", "DF13", "DF14", "DF19", "DF20", "DF21", "DF27"],
      calculationBindings: [
        { calcId: "P2.C0", suffix: " WCPM increase" },
        { calcId: "P2.C1", suffix: "% increase" },
      ],
    },
    sections: [
      {
        id: "s1",
        heading: "Annual Reading Fluency Goal, Services, Team Participation, and Expired IEP Period",
        priority: "HIGH",
        insightIds: ["INS1", "INS2"],
        purpose:
          "Audit Initial IEP eligibility, present levels, goal criteria, services, accommodations, quarterly progress reporting, team participation, and open post-period questions.",
        documentedClaimIds: ["DF8", "DF15", "DF16", "DF25", "DF32", "DF37"],
        interpretation: {
          text: "Achieving GOAL_READING_FLUENCY requires a verified fluency gain and a verified accuracy gain across three consecutive probes by 2025-11-11.",
          claimRefs: ["P2.A0", "DF13", "DF14", "DF17", "DF19", "DF20", "DF21", "DF22", "DF24", "P2.C0", "P2.C1"],
        },
        uncertainty: {
          text: "No post-2024-11-12 quarterly oral-reading-fluency probe results or successor IEP records after 2025-11-11 are included in this single-document corpus, the 2024-10-18 academic evaluation and quarterly progress reports are not separately attached, and the IEP team decides whether the 75 WCPM and 95% accuracy goal was achieved.",
          claimRefs: ["DF7", "DF8", "DF12", "DF20", "DF21", "P6", "P6.U0", "P6.L0", "P6.D0"],
        },
      },
    ],
    components: [
      {
        component: "Narrative",
        sectionId: "summary",
        claimIds: ["DF1", "DF2", "DF3", "DF6", "DF8", "DF9", "DF10", "DF13", "DF14", "DF19", "DF20", "DF21", "DF27", "P2.C0", "P2.C1"],
        purpose: "Summarize student profile, eligibility, baseline, annual goal targets, weekly reading instruction, and verified target gains.",
        layout: { kind: "Narrative" },
      },
      {
        component: "Metric",
        claimIds: ["P2.C0"],
        purpose: "Display the verified 33 WCPM reading fluency increase required from baseline to annual goal target.",
        layout: {
          kind: "Metric",
          label: "Required fluency gain",
          binding: "{{calc:P2.C0}}",
          claimIds: ["P2.C0"],
          unit: "WCPM",
        },
      },
      {
        component: "Comparison",
        claimIds: ["DF13", "DF14", "DF19", "DF20", "DF21"],
        purpose: "Compare documented 2024-10-18 baseline fluency and accuracy against the 2025-11-11 annual goal criteria.",
        layout: {
          kind: "Comparison",
          title: "Present Levels Baseline vs. Annual Goal Criteria",
          leftLabel: "Documented Baseline",
          rightLabel: "Annual Goal Target",
          items: [
            {
              label: "Connected-Text Reading Fluency",
              leftClaimIds: ["DF13", "DF19"],
              rightClaimIds: ["DF20"],
            },
            {
              label: "Oral Reading Accuracy",
              leftClaimIds: ["DF14"],
              rightClaimIds: ["DF21"],
            },
          ],
        },
      },
      {
        component: "RecordTable",
        claimIds: [
          "DF1",
          "DF2",
          "DF3",
          "DF4",
          "DF5",
          "DF9",
          "DF10",
          "DF11",
          "DF17",
          "DF19",
          "DF20",
          "DF21",
          "DF22",
          "DF23",
          "DF26",
          "DF27",
          "DF28",
          "DF29",
          "DF30",
          "DF31",
          "DF32",
          "DF33",
          "DF34",
          "DF35",
        ],
        purpose: "Tabulate source-backed Initial IEP provisions across eligibility, annual goals, services, accommodations, progress monitoring, and IEP team participation.",
        layout: {
          kind: "RecordTable",
          title: "Initial IEP Key Provisions",
          columns: ["Section", "Subject", "Documented Provision"],
          rows: [
            {
              cellClaimIds: [
                ["DF9"],
                ["DF1", "DF3"],
                ["DF2", "DF4", "DF5", "DF9", "DF10", "DF11"],
              ],
            },
            {
              cellClaimIds: [
                ["DF17"],
                ["DF17", "DF23"],
                ["DF19", "DF20", "DF21", "DF22", "DF25"],
              ],
            },
            {
              cellClaimIds: [
                ["DF26"],
                ["DF27"],
                ["DF27", "DF28", "DF29"],
              ],
            },
            {
              cellClaimIds: [
                ["DF30"],
                ["DF31"],
                ["DF30", "DF31", "DF32"],
              ],
            },
            {
              cellClaimIds: [
                ["DF33", "DF34"],
                ["DF35", "DF36"],
                ["DF33", "DF34", "DF35", "DF36"],
              ],
            },
          ],
        },
      },
      {
        component: "Timeline",
        claimIds: ["DF6", "DF7", "DF9", "DF10", "DF11", "DF12", "DF13", "DF14", "DF20", "DF21", "DF22", "DF24"],
        purpose: "Order the evaluation, eligibility determination, Initial IEP start, and annual goal target dates chronologically.",
        layout: {
          kind: "Timeline",
          title: "Evaluation, Eligibility, and Initial IEP Chronology",
          events: [
            {
              dateClaimIds: ["DF12"],
              textClaimIds: ["DF13", "DF14"],
            },
            {
              dateClaimIds: ["DF11"],
              textClaimIds: ["DF9", "DF10"],
            },
            {
              dateClaimIds: ["DF7"],
              textClaimIds: ["DF6", "DF27", "DF32"],
            },
            {
              dateClaimIds: ["DF24"],
              textClaimIds: ["DF20", "DF21", "DF22"],
            },
          ],
        },
      },
      {
        component: "Narrative",
        sectionId: "s1",
        claimIds: ["DF8", "DF15", "DF16", "DF25", "DF32", "DF37", "P2.A0", "P6", "P6.U0", "P6.L0", "P6.D0"],
        purpose: "Present functional reading performance, educational impact, progress reporting schedule, goal assessment, and post-period evidentiary gaps.",
        layout: { kind: "Narrative" },
      },
      {
        component: "EvidencePanel",
        claimIds: ["DF18", "DF37", "P2.C0", "P2.C1", "P2.A0", "P6.D0"],
        purpose: "Surface verbatim goal and summary quotes, verified fluency/accuracy calculations, document-based assessment criteria, and reserved IEP team determinations.",
        layout: {
          kind: "EvidencePanel",
          title: "Supporting Quotes, Goal Criteria, and Reserved Determinations",
          claimIds: ["DF18", "DF37", "P2.C0", "P2.C1", "P2.A0", "P6.D0"],
        },
      },
    ],
    scenarios: [],
  };
}

export function revision6CustomerEditorialPlan(): EditorialPlan {
  return {
    schema: EDITORIAL_PLAN_SCHEMA,
    audience: "CUSTOMER",
    title: "Maya's IEP review",
    audienceObjective: "Understand Maya's reading progress and prepare for the March 3, 2026 meeting.",
    summaryDetailLevel: "BALANCED",
    insights: [
      {
        id: "INS1",
        meaning: "Reading fluency rose from the baseline to 74 wcpm in Nov 2025 and held at 74 wcpm in Jan 2026.",
        claimIds: ["P1.F0", "P1.F2", "P5.F0", "P1.C0"],
        questionIds: ["P1", "P5"],
        role: "CENTRAL",
      },
    ],
    priorityFindings: [
      { claimId: "P1.F0", priority: "HIGH", insightId: "INS1" },
      { claimId: "P1.C0", priority: "HIGH", insightId: "INS1" },
    ],
    summary: {
      documentedClaimIds: ["P1.F0", "P1.F2", "P1.C0"],
      calculationBindings: [{ calcId: "P1.C0", suffix: " words gained" }],
    },
    sections: [
      {
        id: "s1",
        heading: "Reading fluency progress and open questions",
        priority: "HIGH",
        insightIds: ["INS1"],
        documentedClaimIds: ["P1.F0", "P1.F2", "P5.F0", "P1.F3", "P2.F1", "P1.K0", "P1"],
        uncertainty: {
          text: "Comprehension probe data after November 2025 was not available in the record, and the evaluation did not report a reading comprehension score before the March 3, 2026 meeting.",
          claimRefs: ["P1.U0", "P6.U0", "P6", "P6.F0", "P6.F1"],
        },
      },
    ],
    components: [
      {
        component: "Narrative",
        sectionId: "summary",
        claimIds: ["P1.F0", "P1.F2", "P1.C0"],
        layout: { kind: "Narrative" },
      },
      {
        component: "Comparison",
        claimIds: ["P1.F3", "P2.F1"],
        layout: {
          kind: "Comparison",
          title: "Annual reading goal targets",
          leftLabel: "2024 IEP",
          rightLabel: "2025 IEP",
          items: [
            {
              label: "Reading fluency target",
              leftClaimIds: ["P1.F3"],
              rightClaimIds: ["P2.F1"],
            },
          ],
        },
      },
      {
        component: "Narrative",
        sectionId: "s1",
        claimIds: ["P1.U0", "P6.U0", "P6"],
        layout: { kind: "Narrative" },
      },
    ],
    scenarios: [],
  };
}

export function l001CustomerEditorialPlan(): EditorialPlan {
  return {
    schema: EDITORIAL_PLAN_SCHEMA,
    audience: "CUSTOMER",
    title: "Maya Carter Initial IEP Overview",
    audienceObjective:
      "Give Maya Carter's parent a concise overview of the Initial IEP, direct answers on reading goals and weekly services, and practical questions to ask the school team.",
    summaryDetailLevel: "CONCISE",
    insights: [
      {
        id: "INS1",
        meaning:
          "Maya Carter's Initial IEP sets a reading fluency goal from 42 WCPM (86% accuracy) to 75 WCPM (95% accuracy) supported by 150 minutes weekly specialized reading instruction.",
        claimIds: ["DF1", "DF3", "DF8", "DF13", "DF14", "DF19", "DF20", "DF21", "DF27", "P2.C0", "P2.C1"],
        questionIds: ["P1", "P2", "P3", "P4", "P5", "P6"],
        role: "CENTRAL",
        reuseReason: "Summarized in overview and compared side by side for the parent.",
      },
    ],
    priorityFindings: [
      { claimId: "DF19", priority: "HIGH", insightId: "INS1" },
      { claimId: "DF20", priority: "HIGH", insightId: "INS1" },
      { claimId: "DF27", priority: "HIGH", insightId: "INS1" },
    ],
    summary: {
      documentedClaimIds: ["DF1", "DF3", "DF8", "DF19", "DF20", "DF21", "DF27"],
      calculationBindings: [
        { calcId: "P2.C0", suffix: " WCPM target gain" },
        { calcId: "P2.C1", suffix: "% accuracy gain" },
      ],
    },
    sections: [
      {
        id: "s1",
        heading: "Reading Goal, Weekly Services, and What Is Missing",
        priority: "HIGH",
        insightIds: ["INS1"],
        purpose: "Explain the reading goal, accommodations, expired IEP period, and missing progress records for the parent.",
        documentedClaimIds: ["DF26", "DF27", "DF30", "DF31", "DF32"],
        interpretation: {
          text: "Reaching GOAL_READING_FLUENCY requires a verified fluency gain and a verified accuracy gain across three consecutive probes by 2025-11-11.",
          claimRefs: ["P2.A0", "DF13", "DF14", "DF17", "DF19", "DF20", "DF21", "DF22", "DF24", "P2.C0", "P2.C1"],
        },
        uncertainty: {
          text: "The documented 2024-11-12 through 2025-11-11 IEP period ended before the report date without establishing current plan status, no quarterly oral-reading-fluency probe results after 2024-11-12 or newer IEP records are included in this file, the 2024-10-18 academic evaluation is not separately attached, and the IEP team decides whether the 75 WCPM and 95% accuracy goal was met.",
          claimRefs: ["DF7", "DF8", "DF12", "DF20", "DF21", "P6", "P6.U0", "P6.L0", "P6.D0"],
        },
      },
    ],
    components: [
      {
        component: "Narrative",
        sectionId: "summary",
        claimIds: ["DF1", "DF3", "DF8", "DF19", "DF20", "DF21", "DF27", "P2.C0", "P2.C1"],
        purpose: "Concise document overview and direct summary of Maya Carter's Initial IEP.",
        layout: { kind: "Narrative" },
      },
      {
        component: "Metric",
        claimIds: ["P2.C0"],
        purpose: "Show the 33 WCPM reading fluency gain targeted by the annual goal.",
        layout: {
          kind: "Metric",
          label: "Target fluency gain",
          binding: "{{calc:P2.C0}}",
          claimIds: ["P2.C0"],
          unit: "WCPM",
        },
      },
      {
        component: "Comparison",
        claimIds: ["DF13", "DF14", "DF19", "DF20", "DF21"],
        purpose: "Compare Maya's baseline reading fluency and accuracy with the annual goal targets.",
        layout: {
          kind: "Comparison",
          title: "Reading Fluency Baseline vs. Annual Goal",
          leftLabel: "Documented Baseline",
          rightLabel: "Annual Target",
          items: [
            {
              label: "Reading Fluency Rate",
              leftClaimIds: ["DF13", "DF19"],
              rightClaimIds: ["DF20"],
            },
            {
              label: "Reading Accuracy",
              leftClaimIds: ["DF14"],
              rightClaimIds: ["DF21"],
            },
          ],
        },
      },
      {
        component: "Narrative",
        sectionId: "s1",
        claimIds: ["DF8", "DF26", "DF27", "DF30", "DF31", "DF32", "P2.A0", "P6", "P6.U0", "P6.L0", "P6.D0"],
        purpose: "Explain weekly services, accommodations, ended IEP period, and missing quarterly probe records.",
        layout: { kind: "Narrative" },
      },
    ],
    scenarios: [],
  };
}

export function mayaEditorialPlan(audience: "CUSTOMER" | "PRO" = "CUSTOMER"): EditorialPlan {
  const isPro = audience === "PRO";
  return {
    schema: EDITORIAL_PLAN_SCHEMA,
    audience,
    title: isPro ? "IEP progress and service delivery review" : "Maya's reading and services",
    audienceObjective: isPro
      ? "Audit source-backed baselines, service delivery shortfalls, assessment criteria, and evidentiary gaps to advise on compensatory services and IEP team determinations."
      : "Explain what Maya's IEP and progress records show in plain words, highlight what is missing, and prepare for the upcoming IEP meeting.",
    summaryDetailLevel: isPro ? "COMPREHENSIVE" : "CONCISE",
    insights: [
      {
        id: "INS1",
        meaning: "Reading fluency rose from 62 to 74 words correct per minute toward the 90-word March 2026 goal (+12 wcpm).",
        claimIds: ["P1.F0", "P1.F1", "P1.F2", "P1.C0", "P1.A0", "P1.D0"],
        questionIds: ["P1"],
        role: "CENTRAL",
        reuseReason: "Core reading trajectory summarized in overview and analyzed in section s1.",
      },
      {
        id: "INS2",
        meaning: "360 of 480 required speech therapy minutes were delivered (75% of semester requirement).",
        claimIds: ["P2.F0", "P2.F1", "P2.C0"],
        questionIds: ["P2"],
        role: "CENTRAL",
        reuseReason: "Quantified in speech section and scenario explorer.",
      },
    ],
    priorityFindings: isPro
      ? [
          { claimId: "P2.C0", priority: "HIGH", insightId: "INS2" },
          { claimId: "P3", priority: "HIGH" },
          { claimId: "P1.A0", priority: "HIGH", insightId: "INS1" },
          { claimId: "P1.D0", priority: "HIGH", insightId: "INS1" },
          { claimId: "P1.U0", priority: "MEDIUM" },
        ]
      : [
          { claimId: "P1.C0", priority: "HIGH", insightId: "INS1" },
          { claimId: "P2.C0", priority: "HIGH", insightId: "INS2" },
          { claimId: "P1.U0", priority: "HIGH" },
          { claimId: "P3", priority: "MEDIUM" },
        ],
    summary: {
      documentedClaimIds: ["P1.F0", "P1.F2"],
      calculationBindings: [{ calcId: "P1.C0", suffix: " words per minute gained" }],
    },
    sections: [
      {
        id: "s1",
        heading: "Reading progress",
        priority: "HIGH",
        insightIds: ["INS1"],
        purpose: "Explain reading fluency baseline, March 2026 goal, general-knowledge assessment criterion, and single-point measurement limitation.",
        documentedClaimIds: ["P1.F1"],
        interpretation: {
          text: "Maya is improving toward the fluency goal, and whether the gain is sufficient is decided by the IEP team.",
          claimRefs: ["P1.A0", "P1.D0"],
        },
        uncertainty: {
          text: "Only one progress measurement was available after the baseline, and the remaining gap could not be confirmed.",
          claimRefs: ["P1.U0", "P1.C1"],
        },
      },
      {
        id: "s2",
        heading: "Speech services",
        priority: "HIGH",
        insightIds: ["INS2"],
        purpose: "Present delivered vs required speech therapy minutes from the service log.",
        documentedClaimIds: ["P2.F0", "P2.F1", "P2.C0"],
      },
      {
        id: "s3",
        heading: "What is missing",
        priority: "HIGH",
        purpose: "Surface missing reading comprehension evaluation score and single-evaluation limitation.",
        uncertainty: {
          text: "The evaluation did not include a reading comprehension score, and only one evaluation document was in the Hive.",
          claimRefs: ["P3", "P3.F0", "P3.L0"],
        },
      },
    ],
    components: isPro
      ? [
          {
            component: "Narrative",
            sectionId: "summary",
            claimIds: ["P1.F0", "P1.F2", "P1.C0"],
            purpose: "Synthesize case posture and verified calculations for specialist review.",
            layout: { kind: "Narrative" },
          },
          {
            component: "Comparison",
            claimIds: ["P2.F0", "P2.F1"],
            purpose: "Compare delivered vs required speech minutes side by side.",
            layout: {
              kind: "Comparison",
              title: "Speech therapy minutes",
              leftLabel: "Delivered",
              rightLabel: "Required",
              items: [
                {
                  label: "Semester minutes",
                  leftClaimIds: ["P2.F0"],
                  rightClaimIds: ["P2.F1"],
                },
              ],
            },
          },
          {
            component: "RecordTable",
            claimIds: ["P1.F0", "P1.F1", "P1.F2", "P2.F0", "P2.F1"],
            purpose: "Provide a source-backed ledger of measurements, targets, and service logs.",
            layout: {
              kind: "RecordTable",
              title: "Documented measurements and service log",
              columns: ["Baseline & Progress", "Goal & Services"],
              rows: [
                { cellClaimIds: [["P1.F0", "P1.F2"], ["P1.F1"]] },
                { cellClaimIds: [["P2.F0"], ["P2.F1"]] },
              ],
            },
          },
          {
            component: "Narrative",
            sectionId: "s1",
            claimIds: ["P1.F1", "P1.A0", "P1.D0", "P1.U0", "P1.C1"],
            layout: { kind: "Narrative" },
          },
          {
            component: "Narrative",
            sectionId: "s2",
            claimIds: ["P2.F0", "P2.F1", "P2.C0"],
            layout: { kind: "Narrative" },
          },
          {
            component: "ScenarioExplorer",
            scenarioId: "S1",
            claimIds: ["P2.F0", "P2.F1"],
            purpose: "Model weekly compensatory service schedules.",
            layout: { kind: "ScenarioExplorer" },
          },
          {
            component: "Narrative",
            sectionId: "s3",
            claimIds: ["P3", "P3.F0", "P3.L0"],
            layout: { kind: "Narrative" },
          },
          {
            component: "EvidencePanel",
            claimIds: ["P1.A0", "P1.D0", "P2.C0"],
            purpose: "Inspect verbatim quotes, general-knowledge assessment criteria, and reserved determinations.",
            layout: {
              kind: "EvidencePanel",
              title: "Supporting quotes and criteria",
              claimIds: ["P1.A0", "P1.D0", "P2.C0"],
            },
          },
        ]
      : [
          {
            component: "Narrative",
            sectionId: "summary",
            claimIds: ["P1.F0", "P1.F2", "P1.C0"],
            purpose: "Summarize Maya's reading gain in plain words.",
            layout: { kind: "Narrative" },
          },
          {
            component: "Metric",
            claimIds: ["P1.C0"],
            purpose: "Highlight the verified 12 WCPM reading fluency gain.",
            layout: {
              kind: "Metric",
              label: "Reading gain",
              binding: "{{calc:P1.C0}}",
              claimIds: ["P1.C0"],
              unit: "words per minute",
            },
          },
          {
            component: "Narrative",
            sectionId: "s1",
            claimIds: ["P1.F1", "P1.A0", "P1.D0", "P1.U0", "P1.C1"],
            layout: { kind: "Narrative" },
          },
          {
            component: "Timeline",
            claimIds: ["P1.F2"],
            purpose: "Show the dated November 2025 progress checkpoint.",
            layout: {
              kind: "Timeline",
              title: "Key dates",
              events: [
                {
                  dateClaimIds: ["P1.F2"],
                  textClaimIds: ["P1.F2"],
                },
              ],
            },
          },
          {
            component: "Narrative",
            sectionId: "s2",
            claimIds: ["P2.F0", "P2.F1", "P2.C0"],
            layout: { kind: "Narrative" },
          },
          {
            component: "ScenarioExplorer",
            scenarioId: "S1",
            claimIds: ["P2.F0", "P2.F1"],
            purpose: "Explore how many extra minutes per week would make up the missed speech time.",
            layout: { kind: "ScenarioExplorer" },
          },
          {
            component: "Narrative",
            sectionId: "s3",
            claimIds: ["P3", "P3.F0", "P3.L0"],
            layout: { kind: "Narrative" },
          },
          {
            component: "KeyFindings",
            claimIds: ["P1.F2", "P2.C0"],
            purpose: "Highlight the main numbers to bring to the meeting.",
            layout: {
              kind: "KeyFindings",
              title: "Key findings",
              claimIds: ["P1.F2", "P2.C0"],
            },
          },
        ],
    scenarios: [
      {
        id: "S1",
        title: "Catching up on speech minutes",
        question: "How many extra minutes a week would close the gap?",
        rationale: "The log shows fewer minutes than required.",
        claimRefs: ["P2.F0", "P2.F1"],
        parameters: [
          { name: "required", label: "Required minutes", value: "480", unit: "minutes", basis: "DOCUMENTED", claimRef: "P2.F1" },
          { name: "delivered", label: "Delivered minutes", value: "360", unit: "minutes", basis: "DOCUMENTED", claimRef: "P2.F0" },
          { name: "weeks", label: "Weeks left", value: "8", unit: "weeks", basis: "ASSUMPTION", claimRef: null },
        ],
        results: [
          { id: "R1", label: "Minutes short", unit: "minutes", formula: { op: "-", args: [{ param: "required" }, { param: "delivered" }] } },
          { id: "R2", label: "Extra minutes per week", unit: "minutes", formula: { op: "/", args: [{ ref: "R1" }, { param: "weeks" }] } },
        ],
      },
    ],
  };
}
