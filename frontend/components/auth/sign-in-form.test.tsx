import { ApiError } from "@/lib/api";
import { SignInForm } from "@/components/auth/sign-in-form";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSignIn = vi.fn();

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    signIn: mockSignIn,
  }),
}));

describe("SignInForm", () => {
  beforeEach(() => {
    mockSignIn.mockReset();
  });

  it("submits nickname and password", async () => {
    const user = userEvent.setup();
    mockSignIn.mockResolvedValue(undefined);

    render(<SignInForm />);

    await user.type(screen.getByLabelText("Nickname"), "alice");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith("alice", "secret");
    });
  });

  it("shows api errors", async () => {
    const user = userEvent.setup();
    mockSignIn.mockRejectedValue(new ApiError(401, "Invalid nickname or password."));

    render(<SignInForm />);

    await user.type(screen.getByLabelText("Nickname"), "alice");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Invalid nickname or password."),
    ).toBeInTheDocument();
  });

  it("shows a loading label while submitting", async () => {
    const user = userEvent.setup();
    let resolveSignIn: (() => void) | undefined;
    mockSignIn.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSignIn = resolve;
        }),
    );

    render(<SignInForm />);

    await user.type(screen.getByLabelText("Nickname"), "alice");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByRole("button", { name: "Signing in..." }),
    ).toBeDisabled();

    resolveSignIn?.();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    });
  });
});
