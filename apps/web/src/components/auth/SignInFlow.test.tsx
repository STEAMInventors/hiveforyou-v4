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

import { SignInFlow } from "./SignInFlow";

const TEST_EMAIL = "maya.rivera@example.test";

const mockedRequest = vi.mocked(requestSignInCodeAction);
const mockedVerify = vi.mocked(verifySignInCodeAction);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

async function goToCodeStep(next = "/hives") {
  mockedRequest.mockResolvedValue({ step: "code", email: TEST_EMAIL, next });
  render(<SignInFlow nextPath={next} startClients={false} />);
  const form = screen.getByLabelText("Email").closest("form")!;
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: TEST_EMAIL } });
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByLabelText("Sign-in code")).toBeTruthy());
}

describe("SignInFlow", () => {
  it("shows the email step with prototype copy", () => {
    render(<SignInFlow nextPath="/hives" startClients={false} />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("to continue to HiveForYou")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByText("No password. We email you a code and a link.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
  });

  it("shows the new-here note when start=clients", () => {
    render(<SignInFlow nextPath="/hives" startClients linkError={null} />);
    expect(
      screen.getByText(
        "New here? Use your email. Signing in and creating an account are the same step.",
      ),
    ).toBeTruthy();
  });

  it("surfaces an expired link banner", () => {
    render(
      <SignInFlow
        nextPath="/hives"
        startClients={false}
        linkError="That link has already been used or has expired. Enter the code from the email, or send a new one."
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("already been used");
  });

  it("maps otp_expired query copy to a role=alert banner on the email step", () => {
    const message = authLinkErrorMessage("otp_expired");
    expect(message).toBeTruthy();
    render(<SignInFlow nextPath="/hives" startClients={false} linkError={message} />);
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("already been used");
    expect(within(banner).queryByLabelText("Email")).toBeNull();
  });

  it("keeps a safe next path in hidden fields on the email and code steps", async () => {
    const next = "/hives/abc";
    render(<SignInFlow nextPath={next} startClients={false} />);
    const emailForm = screen.getByRole("button", { name: "Next" }).closest("form")!;
    expect(emailForm.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe(next);

    mockedRequest.mockResolvedValue({ step: "code", email: TEST_EMAIL, next });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: TEST_EMAIL } });
    fireEvent.submit(emailForm);
    await waitFor(() => expect(screen.getByLabelText("Sign-in code")).toBeTruthy());

    const verifyForm = screen.getByRole("button", { name: "Sign in" }).closest("form")!;
    expect(verifyForm.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe(next);
    expect(verifyForm.querySelector<HTMLInputElement>('input[name="email"]')?.value).toBe(TEST_EMAIL);

    const resendForm = screen.getByRole("button", { name: /Send a new code/ }).closest("form")!;
    expect(resendForm.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe(next);
  });

  it("falls back to /hives for unsafe next paths in hidden fields", () => {
    render(<SignInFlow nextPath="https://evil.example" startClients={false} />);
    const emailForm = screen.getByRole("button", { name: "Next" }).closest("form")!;
    expect(emailForm.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe("/hives");

    cleanup();
    render(<SignInFlow nextPath="//evil.example" startClients={false} />);
    const form = screen.getByRole("button", { name: "Next" }).closest("form")!;
    expect(form.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe("/hives");
  });

  describe("code step errors", () => {
    const cases = [
      {
        name: "wrong code",
        error: "That code is wrong or has expired. Check the email and try again.",
      },
      {
        name: "expired code",
        error: "That code has expired. Send a new one and try again.",
      },
      {
        name: "too many attempts",
        error: "Too many attempts. Wait a few minutes and try again.",
      },
    ] as const;

    for (const { name, error } of cases) {
      it(`shows ${name} next to the code field and keeps the email on the code step`, async () => {
        await goToCodeStep("/hives/x");
        const codeInput = screen.getByLabelText("Sign-in code");
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
        expect(verifyForm.querySelector<HTMLInputElement>('input[name="email"]')?.value).toBe(
          TEST_EMAIL,
        );
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
      render(<SignInFlow nextPath="/hives" startClients={false} />);
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: TEST_EMAIL } });
      fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
      await waitFor(() => expect(screen.getByLabelText("Sign-in code")).toBeTruthy());

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
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(TEST_EMAIL);
  });
});