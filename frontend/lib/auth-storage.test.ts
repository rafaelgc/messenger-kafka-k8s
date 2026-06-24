import {
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from "@/lib/auth-storage";
import { beforeEach, describe, expect, it } from "vitest";

describe("auth-storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores and reads the auth token", () => {
    setStoredToken("token-123");
    expect(getStoredToken()).toBe("token-123");
  });

  it("clears the auth token", () => {
    setStoredToken("token-123");
    clearStoredToken();
    expect(getStoredToken()).toBeNull();
  });
});
