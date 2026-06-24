import { mapApiChatsToUiChats } from "@/lib/chats";
import { MOCK_CHATS } from "@/lib/mock-data";
import { describe, expect, it } from "vitest";

describe("mapApiChatsToUiChats", () => {
  it("maps api chats using real ids and names", () => {
    const chats = mapApiChatsToUiChats([
      {
        id: "chat-1",
        name: "Design Team",
        members: ["user-1", "user-2"],
      },
    ]);

    expect(chats[0]?.id).toBe("chat-1");
    expect(chats[0]?.name).toBe("Design Team");
    expect(chats[0]?.messages).toEqual([]);
  });

  it("reuses mock preview data when ids match", () => {
    const mockChat = MOCK_CHATS[0]!;

    const chats = mapApiChatsToUiChats([
      {
        id: mockChat.id,
        name: mockChat.name,
        members: ["user-1"],
      },
    ]);

    expect(chats[0]).toMatchObject({
      id: mockChat.id,
      name: mockChat.name,
      avatarColor: mockChat.avatarColor,
      lastMessage: mockChat.lastMessage,
      lastMessageAt: mockChat.lastMessageAt,
      unreadCount: mockChat.unreadCount,
      messages: [],
    });
  });

  it("cycles mock previews for unknown chats", () => {
    const chats = mapApiChatsToUiChats([
      { id: "unknown-1", name: "Alpha", members: [] },
      { id: "unknown-2", name: "Beta", members: [] },
    ]);

    expect(chats[0]?.lastMessage).toBe(MOCK_CHATS[0]?.lastMessage);
    expect(chats[1]?.lastMessage).toBe(MOCK_CHATS[1]?.lastMessage);
    expect(chats[0]?.avatarColor).not.toBe(chats[1]?.avatarColor);
  });
});
