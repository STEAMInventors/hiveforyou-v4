import {
  signInAction as v3SignInAction,
  signOutAction as v3SignOutAction,
  signUpAction as v3SignUpAction,
  verifyEmailOtpAction as v3VerifyEmailOtpAction,
  requestPasswordResetAction as v3RequestPasswordResetAction,
  resendConfirmationAction as v3ResendConfirmationAction,
  updatePasswordFromRecoveryAction as v3UpdatePasswordFromRecoveryAction,
  backToLoginFromRecoveryAction as v3BackToLoginFromRecoveryAction,
  changePasswordAction as v3ChangePasswordAction,
  type AuthActionState,
} from "@/lib/auth/index";

export type { AuthActionState };

export async function signInAction(
  prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return v3SignInAction(prev, formData);
}

export async function signUpAction(
  prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return v3SignUpAction(prev, formData);
}

export async function signOutAction(): Promise<void> {
  return v3SignOutAction();
}

export async function verifyEmailOtpAction(
  prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return v3VerifyEmailOtpAction(prev, formData);
}

export async function requestPasswordResetAction(
  prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return v3RequestPasswordResetAction(prev, formData);
}

export async function resendConfirmationAction(
  prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return v3ResendConfirmationAction(prev, formData);
}

export async function updatePasswordFromRecoveryAction(
  prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return v3UpdatePasswordFromRecoveryAction(prev, formData);
}

export async function backToLoginFromRecoveryAction(): Promise<void> {
  return v3BackToLoginFromRecoveryAction();
}

export async function changePasswordAction(
  prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return v3ChangePasswordAction(prev, formData);
}
