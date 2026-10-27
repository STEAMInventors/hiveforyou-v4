export type AuthOtpPurpose = "signup" | "recovery";

export type AuthActionState = {
  error?: string;
  info?: string;
  unconfirmedEmail?: string;
  otpChallenge?: { purpose: AuthOtpPurpose; email: string };
};
