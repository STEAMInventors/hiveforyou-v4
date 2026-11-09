import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isAuthorizedCronRequest, loadCronSecret } from "./cron-auth";

const CRON = "cron-secret-0123456789abcdef";
const WORKER = "synthetic-worker-token-0123456789abcdef";

describe("cron-auth", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it("accepts a bearer CRON_SECRET", () => {
    process.env.CRON_SECRET = CRON;
    expect(loadCronSecret(process.env)).toBe(CRON);
    expect(isAuthorizedCronRequest(`Bearer ${CRON}`, process.env)).toBe(true);
  });

  it("accepts the worker token when cron secret is unset", () => {
    delete process.env.CRON_SECRET;
    process.env.HIVE_INTERNAL_WORKER_TOKEN = WORKER;
    expect(isAuthorizedCronRequest(`Bearer ${WORKER}`, process.env)).toBe(true);
  });

  it("rejects missing or wrong authorization", () => {
    process.env.CRON_SECRET = CRON;
    expect(isAuthorizedCronRequest(undefined, process.env)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer wrong", process.env)).toBe(false);
  });
});
