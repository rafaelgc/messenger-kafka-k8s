import { ApiError } from "@/lib/api";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSignUp = vi.fn();

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    signUp: mockSignUp,
  }),
}));

describe("SignUpForm", () => {
  beforeEach(() => {
    mockSignUp.mockReset();
  });

  it("submits nickname and password", async () => {
    const user = userEvent.setup();
    mockSignUp.mockResolvedValue(undefined);

    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Nickname"), "alice");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.type(screen.getByLabelText("Confirm password"), "secret");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith("alice", "secret");
    });
  });

  it("shows a client-side error when passwords do not match", async () => {
    const user = userEvent.setup();

    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Nickname"), "alice");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("shows api errors", async () => {
    const user = userEvent.setup();
    mockSignUp.mockRejectedValue(new ApiError(409, "That nickname is already taken."));

    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Nickname"), "alice");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.type(screen.getByLabelText("Confirm password"), "secret");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("That nickname is already taken."),
    ).toBeInTheDocument();
  });
});
