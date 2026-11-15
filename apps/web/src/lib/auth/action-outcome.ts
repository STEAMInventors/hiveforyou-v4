import "server-only";

import type { AuthActionState } from "./auth-state";
import { classifyAuthError, toAuthErrorInput } from "./map-auth-error";
import type { AuthErrorContext } from "./map-auth-error";
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
  return { error: mapped.message };
}