/**
 * Prompt id for one pinned-rebuild domain investigation.
 * Environment-neutral on purpose: the shared contracts barrel names this prompt,
 * and that barrel is loaded by Next.js middleware. The investigation engine stays
 * on `@hiveforyou/contracts/investigation` because it hashes with node:crypto.
 */
export const DOMAIN_INVESTIGATION_PROMPT_ID = "hive.domain-investigation/1" as const;
