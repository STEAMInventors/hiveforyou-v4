import "server-only";

import type { AuthActionState } from "./auth-state";
import { classifyAuthError, publicAuthOutcome, toAuthErrorInput } from "./map-auth-error";
import type { AuthErrorContext } from "./map-auth-error";
import { RESEND_ACCEPTED, RESET_REQUEST_ACCEPTED } from "./messages";
import { logAuthFailure } from "./action-support";

export function providerAuthFailure(
  route: string,
  correlationId: string,
  error: unknown,
  context: AuthErrorContext,
  started: number,
): AuthActionState {
  const mapped = classifyAuthError(toAuthErrorInput(error), context);
  logAuthFailure(route, correlationId, mapped, Date.now() - started);
  if (
    (context === "recovery_request" || context === "resend") &&
    publicAuthOutcome(context, mapped) === "neutral"
  ) {
    return { info: context === "resend" ? RESEND_ACCEPTED : RESET_REQUEST_ACCEPTED };
  }
  return { error: mapped.message };
}
