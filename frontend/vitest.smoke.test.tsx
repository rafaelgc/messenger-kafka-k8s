import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("test tooling", () => {
  it("runs vitest with jsdom", () => {
    expect(window).toBeDefined();
  });

  it("renders with React Testing Library", () => {
    render(<p>Messaging frontend tests</p>);
    expect(screen.getByText("Messaging frontend tests")).toBeInTheDocument();
  });
});
