/**
 * Prompt id for one pinned-rebuild domain investigation.
 * Environment-neutral on purpose: the shared contracts barrel names this prompt,
 * and that barrel is loaded by Next.js middleware. The investigation engine stays
 * on `@hiveforyou/contracts/investigation` because it hashes with node:crypto.
 */
export const DOMAIN_INVESTIGATION_PROMPT_ID = "hive.domain-investigation/1" as const;
/** Pinned 0.5.0 rebuild only. v1 stays the default investigation id. */
export const DOMAIN_INVESTIGATION_PROMPT_V2_ID = "hive.domain-investigation/2" as const;
