import { avatarColorFromNickname } from "@/lib/avatar";
import { describe, expect, it } from "vitest";

describe("avatarColorFromNickname", () => {
  it("returns the same color for the same nickname", () => {
    expect(avatarColorFromNickname("carol")).toBe(avatarColorFromNickname("carol"));
  });

  it("is case-insensitive", () => {
    expect(avatarColorFromNickname("Carol")).toBe(avatarColorFromNickname("carol"));
  });

  it("returns different colors for different nicknames", () => {
    expect(avatarColorFromNickname("alice")).not.toBe(
      avatarColorFromNickname("bob"),
    );
  });
});
