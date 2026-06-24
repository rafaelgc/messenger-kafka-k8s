import { createTestToken } from "@/test/utils/fixtures";
import { decodeJwtPayload, isTokenExpired } from "@/lib/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("decodeJwtPayload", () => {
  it("decodes a valid token payload", () => {
    const token = createTestToken({
      sub: "user-123",
      nickname: "alice",
      exp: 4_102_444_800,
    });

    expect(decodeJwtPayload(token)).toEqual({
      sub: "user-123",
      nickname: "alice",
      exp: 4_102_444_800,
    });
  });

  it("throws for malformed tokens", () => {
    expect(() => decodeJwtPayload("not-a-jwt")).toThrow("Invalid token format");
    expect(() => decodeJwtPayload("only.two")).toThrow("Invalid token format");
  });
});

describe("isTokenExpired", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false when the token is still valid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T10:00:00.000Z"));

    expect(
      isTokenExpired({
        sub: "user-123",
        nickname: "alice",
        exp: Math.floor(new Date("2026-06-24T10:00:00.000Z").getTime() / 1000),
      }),
    ).toBe(false);
  });

  it("returns true when the token has expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T10:00:00.000Z"));

    expect(
      isTokenExpired({
        sub: "user-123",
        nickname: "alice",
        exp: Math.floor(new Date("2026-06-22T10:00:00.000Z").getTime() / 1000),
      }),
    ).toBe(true);
  });
});
