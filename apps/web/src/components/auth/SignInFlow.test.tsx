// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/auth-actions", () => ({
  requestSignInCodeAction: vi.fn(),
  verifySignInCodeAction: vi.fn(),
}));

import {
  requestSignInCodeAction,
  verifySignInCodeAction,
} from "@/server/auth/auth-actions";
import { authLinkErrorMessage } from "@/server/auth/messages";

import { filledAuthButtons } from "./auth-test-helpers";
import { SignInFlow } from "./SignInFlow";

const TEST_EMAIL = "maya.rivera@example.test";
const EMAIL_STEP_LEDE =
  "Use your email. New here? We'll set up your account. No password needed.";

const CREATE_ACCOUNT_LEDE =
  "Enter your email and we'll send you a code. No password needed.";

const mockedRequest = vi.mocked(requestSignInCodeAction);
const mockedVerify = vi.mocked(verifySignInCodeAction);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const defaultFlowProps = {
  nextPath: "/hives",
  startClients: false,
  createAccount: false,
};

async function goToCodeStep(
  next = "/hives",
  extra: Partial<{ startClients: boolean; createAccount: boolean }> = {},
) {
  mockedRequest.mockResolvedValue({ step: "code", email: TEST_EMAIL, next });
  render(<SignInFlow {...defaultFlowProps} nextPath={next} {...extra} />);
  const form = screen.getByLabelText("Email").closest("form")!;
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: TEST_EMAIL } });
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByLabelText("Code from the email")).toBeTruthy());
  await waitFor(() =>
    expect(screen.getByText(/We sent a sign-in code to/)).toBeTruthy(),
  );
}

function hiddenValue(form: HTMLFormElement, name: string): string | undefined {
  return form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;
}

describe("SignInFlow", () => {
  it("shows the email step with sign-in copy, the privacy line and Send code", () => {
    render(<SignInFlow {...defaultFlowProps} />);
    expect(screen.getByTestId("hive-mark")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sign in", level: 1 })).toBeTruthy();
    expect(screen.getByText(EMAIL_STEP_LEDE)).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send code" })).toBeTruthy();
    expect(
      screen.getByText("No password to remember. Each hive is visible only to the people invited to it."),
    ).toBeTruthy();
  });

  it("fills the email from a front-page prefill and leaves it editable", () => {
    render(<SignInFlow {...defaultFlowProps} createAccount prefillEmail="Dana@Firm.example" />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.value).toBe("dana@firm.example");
    expect(email.readOnly).toBe(false);
    fireEvent.change(email, { target: { value: "other@firm.example" } });
    expect(email.value).toBe("other@firm.example");
  });

  it("locks an invitation's address, and the invitation wins over a prefill", () => {
    render(
      <SignInFlow
        {...defaultFlowProps}
        initialEmail="invited@firm.example"
        lockEmail
        prefillEmail="dana@firm.example"
      />,
    );
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.value).toBe("invited@firm.example");
    expect(email.readOnly).toBe(true);
  });

  it("shows the code step with the address in the lede and quiet secondary actions", async () => {
    await goToCodeStep();
    expect(screen.getByRole("heading", { name: "Check your email", level: 1 })).toBeTruthy();
    expect(screen.getByLabelText("Code from the email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use a different email" }).className).not.toContain("bg-blue-deep");
    expect(screen.getByRole("button", { name: /Send a new code/ }).className).not.toContain("bg-blue-deep");
  });

  it('shows "Create your account" when new=1', () => {
    render(<SignInFlow {...defaultFlowProps} createAccount />);
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeTruthy();
    expect(screen.getByText(CREATE_ACCOUNT_LEDE)).toBeTruthy();
    expect(screen.queryByText(EMAIL_STEP_LEDE)).toBeNull();
  });

  it("keeps exactly one filled button on the email and code steps", async () => {
    const { unmount } = render(<SignInFlow {...defaultFlowProps} />);
    expect(filledAuthButtons()).toHaveLength(1);
    expect(filledAuthButtons()[0]?.textContent).toBe("Send code");
    unmount();

    await goToCodeStep();
    expect(filledAuthButtons()).toHaveLength(1);
    expect(filledAuthButtons()[0]?.textContent).toBe("Sign in");
  });

  it("shows the same account-setup line when start=clients", () => {
    render(<SignInFlow {...defaultFlowProps} startClients linkError={null} />);
    expect(screen.getByText(EMAIL_STEP_LEDE)).toBeTruthy();
    expect(
      screen.queryByText(
        "New here? Use your email. Signing in and creating an account are the same step.",
      ),
    ).toBeNull();
  });

  it("surfaces an expired link banner", () => {
    render(
      <SignInFlow
        {...defaultFlowProps}
        linkError="That link has already been used or has expired. Enter the code from the email, or send a new one."
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("already been used");
  });

  it("maps otp_expired query copy to a role=alert banner on the email step", () => {
    const message = authLinkErrorMessage("otp_expired");
    expect(message).toBeTruthy();
    render(<SignInFlow {...defaultFlowProps} linkError={message} />);
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("already been used");
    expect(within(banner).queryByLabelText("Email")).toBeNull();
  });

  it("keeps next, start, and new in hidden fields on the email and code steps", async () => {
    const next = "/hives/abc";
    render(<SignInFlow nextPath={next} startClients createAccount />);
    const emailForm = screen.getByRole("button", { name: "Send code" }).closest("form")!;
    expect(hiddenValue(emailForm, "next")).toBe(next);
    expect(hiddenValue(emailForm, "start")).toBe("clients");
    expect(hiddenValue(emailForm, "new")).toBe("1");

    mockedRequest.mockResolvedValue({ step: "code", email: TEST_EMAIL, next });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: TEST_EMAIL } });
    fireEvent.submit(emailForm);
    await waitFor(() => expect(screen.getByLabelText("Code from the email")).toBeTruthy());

    const verifyForm = screen.getByRole("button", { name: "Sign in" }).closest("form")!;
    expect(hiddenValue(verifyForm, "next")).toBe(next);
    expect(hiddenValue(verifyForm, "email")).toBe(TEST_EMAIL);
    expect(hiddenValue(verifyForm, "start")).toBe("clients");
    expect(hiddenValue(verifyForm, "new")).toBe("1");

    const resendForm = screen.getByRole("button", { name: /Send a new code/ }).closest("form")!;
    expect(hiddenValue(resendForm, "next")).toBe(next);
    expect(hiddenValue(resendForm, "start")).toBe("clients");
    expect(hiddenValue(resendForm, "new")).toBe("1");
  });

  it("falls back to /hives for unsafe next paths in hidden fields", () => {
    render(<SignInFlow {...defaultFlowProps} nextPath="https://evil.example" />);
    const emailForm = screen.getByRole("button", { name: "Send code" }).closest("form")!;
    expect(hiddenValue(emailForm, "next")).toBe("/hives");

    cleanup();
    render(<SignInFlow {...defaultFlowProps} nextPath="//evil.example" />);
    const form = screen.getByRole("button", { name: "Send code" }).closest("form")!;
    expect(hiddenValue(form, "next")).toBe("/hives");
  });

  describe("code step errors", () => {
    const sharedCodeFailure = "That code didn't work. Check it, or send a new one.";
    const cases = [
      { name: "wrong code", error: sharedCodeFailure },
      { name: "expired code", error: sharedCodeFailure },
      {
        name: "too many attempts",
        error: "Too many attempts. Wait a few minutes and try again.",
      },
    ] as const;

    for (const { name, error } of cases) {
      it(`shows ${name} next to the code field and keeps the email on the code step`, async () => {
        await goToCodeStep("/hives/x");
        const codeInput = screen.getByLabelText("Code from the email");
        codeInput.focus();
        mockedVerify.mockResolvedValue({
          error,
          field: "code",
          email: TEST_EMAIL,
          step: "code",
          next: "/hives/x",
        });
        fireEvent.change(codeInput, { target: { value: "123456" } });
        fireEvent.submit(codeInput.closest("form")!);

        await waitFor(() => {
          expect(screen.getByText(error)).toBeTruthy();
        });
        expect(screen.getByRole("heading", { name: "Check your email" })).toBeTruthy();
        expect(screen.getByText(new RegExp(TEST_EMAIL.replace(".", "\\.")))).toBeTruthy();
        const verifyForm = screen.getByRole("button", { name: "Sign in" }).closest("form")!;
        expect(hiddenValue(verifyForm, "email")).toBe(TEST_EMAIL);
        const field = codeInput.closest("div")!;
        expect(within(field).getByRole("alert").textContent).toBe(error);
        expect(document.activeElement).toBe(codeInput);
      });
    }
  });

  it("disables resend for 60 seconds, then resubmits via requestSignInCodeAction", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockedRequest.mockResolvedValue({ step: "code", email: TEST_EMAIL, next: "/hives" });
      render(<SignInFlow {...defaultFlowProps} />);
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: TEST_EMAIL } });
      fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
      await waitFor(() => expect(screen.getByLabelText("Code from the email")).toBeTruthy());

      const resend = screen.getByRole("button", { name: /Send a new code/ });
      expect(resend.hasAttribute("disabled")).toBe(true);
      expect(resend.textContent).toMatch(/\(60s\)/);

      await vi.advanceTimersByTimeAsync(60_000);

      await waitFor(() => {
        const enabled = screen.getByRole("button", { name: "Send a new code" });
        expect(enabled.hasAttribute("disabled")).toBe(false);
      });

      mockedRequest.mockClear();
      mockedRequest.mockResolvedValue({ step: "code", email: TEST_EMAIL, next: "/hives" });
      fireEvent.submit(screen.getByRole("button", { name: "Send a new code" }).closest("form")!);

      await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns to the email step with the address filled when choosing "Use a different email"', async () => {
    await goToCodeStep();
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByRole("heading", { name: "Sign in", level: 1 })).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(TEST_EMAIL);
  });
});