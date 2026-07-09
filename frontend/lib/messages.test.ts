import { createMessage } from "@/test/utils/fixtures";
import type { ChatMember } from "@/lib/api";
import {
  appendNewMessage,
  createOptimisticMessage,
  formatChatListPreview,
  isNearBottom,
  mapApiMessageToUiMessage,
  mergeOlderMessages,
  removeMessage,
  resolveSenderName,
} from "@/lib/messages";
import { describe, expect, it } from "vitest";

const members: ChatMember[] = [
  { id: "user-1", nickname: "Alice" },
  { id: "user-2", nickname: "Bob" },
];

describe("resolveSenderName", () => {
  it("returns the current user nickname for own messages", () => {
    expect(resolveSenderName("user-1", members, "user-1", "Alice")).toBe(
      "Alice",
    );
  });

  it("returns the member nickname for other users", () => {
    expect(resolveSenderName("user-2", members, "user-1", "Alice")).toBe("Bob");
  });
});

describe("formatChatListPreview", () => {
  it("prefixes own messages with You", () => {
    expect(
      formatChatListPreview("On my way", "user-1", members, "user-1", "Alice"),
    ).toBe("You: On my way");
  });

  it("prefixes other messages with the sender nickname", () => {
    expect(
      formatChatListPreview("Hey", "user-2", members, "user-1", "Alice"),
    ).toBe("Bob: Hey");
  });
});

describe("mapApiMessageToUiMessage", () => {
  const objectId = "649a1b2c3d4e5f6789012345";
  const expectedSentAt = new Date(
    Number.parseInt(objectId.slice(0, 8), 16) * 1000,
  ).toISOString();

  it("maps own messages to the current nickname", () => {
    const message = mapApiMessageToUiMessage(
      {
        id: objectId,
        chat_id: "chat-1",
        text: "Hi there",
        sender_id: "user-1",
      },
      members,
      "user-1",
      "Alice",
    );

    expect(message).toEqual({
      id: objectId,
      senderId: "user-1",
      senderName: "Alice",
      text: "Hi there",
      sentAt: expectedSentAt,
    });
  });

  it("maps other senders to their chat member nickname", () => {
    const message = mapApiMessageToUiMessage(
      {
        id: "649a1b2c3d4e5f6789012345",
        chat_id: "chat-1",
        text: "Hi there",
        sender_id: "user-2",
      },
      members,
      "user-1",
      "Alice",
    );

    expect(message.senderName).toBe("Bob");
  });

  it("falls back to a truncated id when the sender is not in members", () => {
    const message = mapApiMessageToUiMessage(
      {
        id: "649a1b2c3d4e5f6789012345",
        chat_id: "chat-1",
        text: "Hi there",
        sender_id: "abcdef123456",
      },
      members,
      "user-1",
      "Alice",
    );

    expect(message.senderName).toBe("abcdef12");
  });
});

describe("mergeOlderMessages", () => {
  it("prepends unique older messages", () => {
    const existing = [createMessage({ id: "msg-2" })];
    const older = [
      createMessage({ id: "msg-1", text: "Older" }),
      createMessage({ id: "msg-2", text: "Duplicate" }),
    ];

    expect(mergeOlderMessages(existing, older)).toEqual([
      createMessage({ id: "msg-1", text: "Older" }),
      createMessage({ id: "msg-2" }),
    ]);
  });
});

describe("createOptimisticMessage", () => {
  it("creates a pending message for the current user", () => {
    const message = createOptimisticMessage("On the way", "user-1", "Alice");

    expect(message.id).toMatch(/^pending-/);
    expect(message).toMatchObject({
      senderId: "user-1",
      senderName: "Alice",
      text: "On the way",
    });
    expect(message.sentAt).toBeTruthy();
  });
});

describe("appendNewMessage", () => {
  it("replaces a pending optimistic message with the delivered one", () => {
    const pending = createMessage({
      id: "pending-1",
      text: "Hello",
      senderId: "user-1",
    });
    const delivered = createMessage({
      id: "ws-1",
      text: "Hello",
      senderId: "user-1",
    });

    expect(appendNewMessage([pending], delivered)).toEqual([delivered]);
  });

  it("ignores duplicate ids", () => {
    const existing = [createMessage({ id: "msg-1" })];
    const duplicate = createMessage({ id: "msg-1", text: "Again" });

    expect(appendNewMessage(existing, duplicate)).toBe(existing);
  });

  it("ignores near-duplicate messages from the same sender", () => {
    const existing = [
      createMessage({
        id: "msg-1",
        senderId: "user-1",
        text: "Hello",
        sentAt: "2026-06-23T10:00:00.000Z",
      }),
    ];
    const duplicate = createMessage({
      id: "msg-2",
      senderId: "user-1",
      text: "Hello",
      sentAt: "2026-06-23T10:00:02.000Z",
    });

    expect(appendNewMessage(existing, duplicate)).toBe(existing);
  });

  it("appends genuinely new messages", () => {
    const existing = [createMessage({ id: "msg-1", text: "First" })];
    const incoming = createMessage({ id: "msg-2", text: "Second" });

    expect(appendNewMessage(existing, incoming)).toEqual([existing[0], incoming]);
  });
});

describe("removeMessage", () => {
  it("removes a message by id", () => {
    const messages = [
      createMessage({ id: "msg-1" }),
      createMessage({ id: "msg-2" }),
    ];

    expect(removeMessage(messages, "msg-1")).toEqual([messages[1]]);
  });
});

describe("isNearBottom", () => {
  it("returns true when the viewport is near the bottom", () => {
    const element = {
      scrollHeight: 1_000,
      scrollTop: 850,
      clientHeight: 100,
    } as HTMLElement;

    expect(isNearBottom(element)).toBe(true);
  });

  it("returns false when the user has scrolled up", () => {
    const element = {
      scrollHeight: 1_000,
      scrollTop: 100,
      clientHeight: 100,
    } as HTMLElement;

    expect(isNearBottom(element)).toBe(false);
  });
});
