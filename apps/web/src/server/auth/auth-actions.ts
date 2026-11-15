import {
  requestSignInCodeAction as libRequestSignInCodeAction,
  setStartingViewAction as libSetStartingViewAction,
  signOutAction as libSignOutAction,
  switchStartingViewAction as libSwitchStartingViewAction,
  verifySignInCodeAction as libVerifySignInCodeAction,
  type SignInActionState,
} from "@/lib/auth/index";

export type { SignInActionState };

export async function requestSignInCodeAction(
  prev: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  return libRequestSignInCodeAction(prev, formData);
}

export async function verifySignInCodeAction(
  prev: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  return libVerifySignInCodeAction(prev, formData);
}

export async function setStartingViewAction(
  prev: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  return libSetStartingViewAction(prev, formData);
}

export async function signOutAction(): Promise<void> {
  return libSignOutAction();
}

export async function switchStartingViewAction(): Promise<void> {
  return libSwitchStartingViewAction();
}