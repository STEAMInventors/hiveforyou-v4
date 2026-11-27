/**
 * Identity of the pack-guided completion.
 * This is not `hive-canonicalize/1`, `hive.canonical-study/1`, or a domain-investigation prompt.
 * The Oracle planner allowlist does not accept this id yet. Callers still name it on
 * `POST /v1/plan-completion` task `canonicalize` and do not send it as a study-agent turn.
 */
export const PACK_GUIDED_CANONICALIZE_PROMPT_ID = "hive.pack-guided-canonicalize/1" as const;
export const PACK_GUIDED_OUTPUT_SCHEMA = "hive.pack-guided-output/1" as const;
export const PACK_GUIDED_RESOLUTION_SCHEMA = "hive.pack-guided-resolution/1" as const;

export const PACK_GUIDED_PROPOSAL_KINDS = ["FIELD", "RELATIONSHIP", "DOCUMENT", "STATEMENT", "GAP"] as const;
export type PackGuidedProposalKind = (typeof PACK_GUIDED_PROPOSAL_KINDS)[number];

/** One completion plus the existing bounded retry. Stays under the study-agent round ceiling. */
export const PACK_GUIDED_MAX_ATTEMPTS = 2 as const;
