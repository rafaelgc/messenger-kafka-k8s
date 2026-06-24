import {
  isMessageSentEvent,
  MESSAGE_DELIVERY_WS_URL,
} from "@/lib/message-delivery";
import { describe, expect, it } from "vitest";

describe("MESSAGE_DELIVERY_WS_URL", () => {
  it("ensures the websocket path ends with /ws", () => {
    expect(MESSAGE_DELIVERY_WS_URL.endsWith("/ws")).toBe(true);
  });
});

describe("isMessageSentEvent", () => {
  it("accepts valid message.sent payloads", () => {
    expect(
      isMessageSentEvent({
        chat_id: "chat-1",
        text: "Hello",
        sender_id: "user-1",
        recipient_ids: ["user-1", "user-2"],
      }),
    ).toBe(true);
  });

  it("rejects invalid payloads", () => {
    expect(isMessageSentEvent(null)).toBe(false);
    expect(isMessageSentEvent({})).toBe(false);
    expect(
      isMessageSentEvent({
        chat_id: "chat-1",
        text: 123,
        sender_id: "user-1",
      }),
    ).toBe(false);
  });
});
