export type AuthActionState = {
  error?: string;
  info?: string;
};

export type SignInStep = "email" | "code";

export type SignInActionState = AuthActionState & {
  step?: SignInStep;
  email?: string;
  next?: string;
  field?: "email" | "code" | "startingView";
};
