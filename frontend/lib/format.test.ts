import { formatChatListTime, formatMessageTime } from "@/lib/format";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("formatMessageTime", () => {
  it("formats an iso timestamp as a local time string", () => {
    const formatted = formatMessageTime("2026-06-23T14:30:00.000Z");
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("formatChatListTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the time for messages from today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T15:00:00.000Z"));

    const formatted = formatChatListTime("2026-06-23T11:42:00.000Z");
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });

  it("shows the weekday for messages from this week", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T15:00:00.000Z"));

    expect(formatChatListTime("2026-06-21T16:20:00.000Z")).toMatch(/^(Sun|Sat)$/);
  });

  it("shows a short date for older messages", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T15:00:00.000Z"));

    expect(formatChatListTime("2026-05-01T10:00:00.000Z")).toMatch(/May/);
  });
});
