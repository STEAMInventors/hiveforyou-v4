import { isAuthorizedWorkerRequest, loadInternalWorkerToken } from "./dispatch";

const MIN_CRON_SECRET_LENGTH = 16;

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is configured. */
export function loadCronSecret(env: NodeJS.ProcessEnv): string | null {
  const secret = env.CRON_SECRET?.trim() ?? "";
  return secret.length >= MIN_CRON_SECRET_LENGTH ? secret : null;
}

/**
 * Cron route auth: prefers CRON_SECRET; also accepts HIVE_INTERNAL_WORKER_TOKEN for manual ops.
 */
export function isAuthorizedCronRequest(
  authorization: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const cronSecret = loadCronSecret(env);
  if (cronSecret && isAuthorizedWorkerRequest(authorization, cronSecret)) return true;
  const workerToken = loadInternalWorkerToken(env);
  return workerToken !== null && isAuthorizedWorkerRequest(authorization, workerToken);
}
